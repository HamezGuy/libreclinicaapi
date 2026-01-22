/**
 * Cloud Storage Service - 21 CFR Part 11 & HIPAA Compliant
 * 
 * Implements cloud storage integration for off-site backup storage.
 * Supports AWS S3 with cross-region replication.
 * 
 * HIPAA §164.308(a)(7)(ii)(A): Data backup plan
 * HIPAA §164.312(e)(2)(ii): Encryption in transit
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { logger } from '../../config/logger';
import { calculateFileChecksum } from './encryption.service';

/**
 * Cloud storage configuration
 */
export interface CloudStorageConfig {
  provider: 'aws-s3' | 'azure-blob' | 'gcp-storage' | 'local';
  bucket: string;
  region: string;
  replicationEnabled: boolean;
  replicationRegion?: string;
  replicationBucket?: string;
  prefix: string;
  storageClass: 'STANDARD' | 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE';
}

/**
 * Upload result interface
 */
export interface CloudUploadResult {
  success: boolean;
  provider: string;
  bucket: string;
  key: string;
  versionId?: string;
  etag?: string;
  size: number;
  checksum: string;
  uploadedAt: string;
  replicationStatus?: string;
  error?: string;
}

/**
 * Cloud file metadata
 */
export interface CloudFileMetadata {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
  versionId?: string;
  storageClass: string;
  checksum?: string;
  tags?: Record<string, string>;
}

/**
 * Get default configuration from environment
 */
export const getCloudStorageConfig = (): CloudStorageConfig => {
  return {
    provider: (process.env.CLOUD_STORAGE_PROVIDER as CloudStorageConfig['provider']) || 'local',
    bucket: process.env.AWS_S3_BUCKET || 'edc-backups',
    region: process.env.AWS_REGION || 'us-east-1',
    replicationEnabled: process.env.S3_REPLICATION_ENABLED === 'true',
    replicationRegion: process.env.S3_REPLICATION_REGION || 'us-west-2',
    replicationBucket: process.env.S3_REPLICATION_BUCKET,
    prefix: process.env.S3_BACKUP_PREFIX || 'backups/',
    storageClass: (process.env.S3_STORAGE_CLASS as CloudStorageConfig['storageClass']) || 'STANDARD'
  };
};

/**
 * Create S3 client
 */
const createS3Client = (region?: string): S3Client => {
  const config = getCloudStorageConfig();
  
  return new S3Client({
    region: region || config.region,
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    } : undefined
  });
};

/**
 * Check if cloud storage is enabled
 */
export const isCloudStorageEnabled = (): boolean => {
  const config = getCloudStorageConfig();
  return config.provider !== 'local' && !!process.env.AWS_S3_BUCKET;
};

/**
 * Upload a backup file to cloud storage
 * 
 * @param filePath - Local path to the backup file
 * @param backupId - Unique backup identifier
 * @param metadata - Additional metadata to store with the file
 * @returns Upload result
 */
export const uploadBackupToCloud = async (
  filePath: string,
  backupId: string,
  metadata: Record<string, string> = {}
): Promise<CloudUploadResult> => {
  const startTime = Date.now();
  const config = getCloudStorageConfig();
  
  logger.info('Starting cloud backup upload', { 
    filePath, 
    backupId, 
    provider: config.provider,
    bucket: config.bucket
  });
  
  // If cloud storage is disabled, return early
  if (!isCloudStorageEnabled()) {
    logger.info('Cloud storage disabled, skipping upload');
    return {
      success: true,
      provider: 'local',
      bucket: 'local',
      key: filePath,
      size: fs.statSync(filePath).size,
      checksum: await calculateFileChecksum(filePath),
      uploadedAt: new Date().toISOString()
    };
  }
  
  try {
    const s3Client = createS3Client();
    const fileName = path.basename(filePath);
    const key = `${config.prefix}${backupId}/${fileName}`;
    
    // Calculate checksum before upload
    const checksum = await calculateFileChecksum(filePath);
    const stats = fs.statSync(filePath);
    
    // Prepare metadata
    const s3Metadata: Record<string, string> = {
      'backup-id': backupId,
      'original-checksum': checksum,
      'original-size': stats.size.toString(),
      'uploaded-by': 'edc-backup-service',
      'uploaded-at': new Date().toISOString(),
      ...metadata
    };
    
    // Use multipart upload for large files
    const fileStream = fs.createReadStream(filePath);
    
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.bucket,
        Key: key,
        Body: fileStream,
        ContentType: 'application/octet-stream',
        StorageClass: config.storageClass,
        Metadata: s3Metadata,
        ServerSideEncryption: 'AES256', // S3 server-side encryption
        ChecksumAlgorithm: 'SHA256'
      },
      // Configure multipart upload
      queueSize: 4,
      partSize: 1024 * 1024 * 10, // 10 MB parts
      leavePartsOnError: false
    });
    
    // Track upload progress
    upload.on('httpUploadProgress', (progress) => {
      if (progress.loaded && progress.total) {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        if (percent % 25 === 0) {
          logger.debug('Upload progress', { key, percent });
        }
      }
    });
    
    const result = await upload.done();
    
    // Add tags for lifecycle management
    await s3Client.send(new PutObjectTaggingCommand({
      Bucket: config.bucket,
      Key: key,
      Tagging: {
        TagSet: [
          { Key: 'backup-type', Value: metadata['backup-type'] || 'unknown' },
          { Key: 'database', Value: metadata['database'] || 'unknown' },
          { Key: 'compliance', Value: 'cfr11-hipaa' },
          { Key: 'retention-policy', Value: metadata['retention-policy'] || 'default' }
        ]
      }
    }));
    
    const duration = Date.now() - startTime;
    
    logger.info('Cloud backup upload completed', {
      key,
      bucket: config.bucket,
      size: stats.size,
      durationMs: duration,
      etag: result.ETag,
      versionId: result.VersionId
    });
    
    return {
      success: true,
      provider: config.provider,
      bucket: config.bucket,
      key,
      versionId: result.VersionId,
      etag: result.ETag,
      size: stats.size,
      checksum,
      uploadedAt: new Date().toISOString()
    };
    
  } catch (error: any) {
    logger.error('Cloud backup upload failed', { 
      filePath, 
      backupId, 
      error: error.message 
    });
    
    return {
      success: false,
      provider: config.provider,
      bucket: config.bucket,
      key: '',
      size: 0,
      checksum: '',
      uploadedAt: new Date().toISOString(),
      error: error.message
    };
  }
};

/**
 * Download a backup file from cloud storage
 * 
 * @param key - S3 object key
 * @param outputPath - Local path to save the downloaded file
 * @param versionId - Optional version ID for versioned buckets
 * @returns Download result
 */
export const downloadBackupFromCloud = async (
  key: string,
  outputPath: string,
  versionId?: string
): Promise<{ success: boolean; path?: string; error?: string }> => {
  const startTime = Date.now();
  const config = getCloudStorageConfig();
  
  logger.info('Starting cloud backup download', { 
    key, 
    outputPath, 
    versionId 
  });
  
  if (!isCloudStorageEnabled()) {
    return {
      success: false,
      error: 'Cloud storage is not enabled'
    };
  }
  
  try {
    const s3Client = createS3Client();
    
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      VersionId: versionId
    }));
    
    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write to file
    const writeStream = fs.createWriteStream(outputPath);
    await pipeline(response.Body as Readable, writeStream);
    
    // Verify checksum if metadata is available
    if (response.Metadata?.['original-checksum']) {
      const downloadedChecksum = await calculateFileChecksum(outputPath);
      if (downloadedChecksum !== response.Metadata['original-checksum']) {
        fs.unlinkSync(outputPath);
        throw new Error('Downloaded file checksum mismatch');
      }
    }
    
    const duration = Date.now() - startTime;
    
    logger.info('Cloud backup download completed', {
      key,
      outputPath,
      size: response.ContentLength,
      durationMs: duration
    });
    
    return {
      success: true,
      path: outputPath
    };
    
  } catch (error: any) {
    logger.error('Cloud backup download failed', { 
      key, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * List backup files in cloud storage
 * 
 * @param prefix - Optional prefix to filter by
 * @param maxResults - Maximum number of results
 * @returns List of cloud file metadata
 */
export const listCloudBackups = async (
  prefix?: string,
  maxResults: number = 1000
): Promise<CloudFileMetadata[]> => {
  const config = getCloudStorageConfig();
  
  if (!isCloudStorageEnabled()) {
    logger.debug('Cloud storage disabled, returning empty list');
    return [];
  }
  
  try {
    const s3Client = createS3Client();
    const fullPrefix = prefix ? `${config.prefix}${prefix}` : config.prefix;
    
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: fullPrefix,
      MaxKeys: maxResults
    }));
    
    const files: CloudFileMetadata[] = (response.Contents || []).map(obj => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
      etag: obj.ETag || '',
      storageClass: obj.StorageClass || 'STANDARD'
    }));
    
    logger.debug('Listed cloud backups', { 
      prefix: fullPrefix, 
      count: files.length 
    });
    
    return files;
    
  } catch (error: any) {
    logger.error('Failed to list cloud backups', { error: error.message });
    return [];
  }
};

/**
 * Verify a cloud backup exists and is intact
 * 
 * @param key - S3 object key
 * @param expectedChecksum - Expected checksum for verification
 * @returns Verification result
 */
export const verifyCloudBackup = async (
  key: string,
  expectedChecksum?: string
): Promise<{ valid: boolean; error?: string; metadata?: CloudFileMetadata }> => {
  const config = getCloudStorageConfig();
  
  if (!isCloudStorageEnabled()) {
    return { valid: false, error: 'Cloud storage is not enabled' };
  }
  
  try {
    const s3Client = createS3Client();
    
    // Get object metadata
    const response = await s3Client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key
    }));
    
    // Verify checksum if provided and stored
    if (expectedChecksum && response.Metadata?.['original-checksum']) {
      if (response.Metadata['original-checksum'] !== expectedChecksum) {
        return { 
          valid: false, 
          error: 'Stored checksum does not match expected checksum' 
        };
      }
    }
    
    const metadata: CloudFileMetadata = {
      key,
      size: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      etag: response.ETag || '',
      versionId: response.VersionId,
      storageClass: response.StorageClass || 'STANDARD',
      checksum: response.Metadata?.['original-checksum']
    };
    
    return { valid: true, metadata };
    
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return { valid: false, error: 'Backup file not found in cloud storage' };
    }
    return { valid: false, error: error.message };
  }
};

/**
 * Delete a backup from cloud storage
 * 
 * @param key - S3 object key
 * @param versionId - Optional version ID
 * @returns Deletion result
 */
export const deleteCloudBackup = async (
  key: string,
  versionId?: string
): Promise<{ success: boolean; error?: string }> => {
  const config = getCloudStorageConfig();
  
  if (!isCloudStorageEnabled()) {
    return { success: false, error: 'Cloud storage is not enabled' };
  }
  
  try {
    const s3Client = createS3Client();
    
    await s3Client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
      VersionId: versionId
    }));
    
    logger.info('Deleted cloud backup', { key, versionId });
    
    return { success: true };
    
  } catch (error: any) {
    logger.error('Failed to delete cloud backup', { 
      key, 
      error: error.message 
    });
    return { success: false, error: error.message };
  }
};

/**
 * Replicate a backup to another region
 * 
 * This is manual cross-region copy for environments where
 * S3 Cross-Region Replication is not configured.
 * 
 * @param key - S3 object key
 * @returns Replication result
 */
export const replicateBackupToSecondaryRegion = async (
  key: string
): Promise<{ success: boolean; destinationKey?: string; error?: string }> => {
  const config = getCloudStorageConfig();
  
  if (!config.replicationEnabled || !config.replicationBucket) {
    logger.debug('Cross-region replication not enabled');
    return { success: true }; // Not an error, just disabled
  }
  
  try {
    const sourceClient = createS3Client(config.region);
    const destClient = createS3Client(config.replicationRegion);
    
    // For cross-region copy, we download and re-upload
    // This is a simplified approach; in production, use S3 CRR
    
    logger.info('Starting cross-region replication', {
      sourceKey: key,
      sourceRegion: config.region,
      destRegion: config.replicationRegion
    });
    
    // Get source object
    const getResponse = await sourceClient.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key
    }));
    
    if (!getResponse.Body) {
      throw new Error('Empty source object');
    }
    
    // Upload to destination
    const destKey = key; // Same key in destination bucket
    
    const upload = new Upload({
      client: destClient,
      params: {
        Bucket: config.replicationBucket,
        Key: destKey,
        Body: getResponse.Body as Readable,
        ContentType: getResponse.ContentType,
        Metadata: getResponse.Metadata,
        ServerSideEncryption: 'AES256'
      }
    });
    
    await upload.done();
    
    logger.info('Cross-region replication completed', {
      destinationBucket: config.replicationBucket,
      destinationKey: destKey
    });
    
    return {
      success: true,
      destinationKey: destKey
    };
    
  } catch (error: any) {
    logger.error('Cross-region replication failed', { 
      key, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get cloud storage status
 */
export const getCloudStorageStatus = (): {
  enabled: boolean;
  provider: string;
  bucket: string;
  region: string;
  replicationEnabled: boolean;
  replicationRegion?: string;
} => {
  const config = getCloudStorageConfig();
  
  return {
    enabled: isCloudStorageEnabled(),
    provider: config.provider,
    bucket: config.bucket,
    region: config.region,
    replicationEnabled: config.replicationEnabled,
    replicationRegion: config.replicationRegion
  };
};

export default {
  uploadBackupToCloud,
  downloadBackupFromCloud,
  listCloudBackups,
  verifyCloudBackup,
  deleteCloudBackup,
  replicateBackupToSecondaryRegion,
  isCloudStorageEnabled,
  getCloudStorageConfig,
  getCloudStorageStatus
};
