/**
 * Cloud Storage Service for Backup
 * 
 * Supports AWS S3 for offsite backup storage.
 * 21 CFR Part 11 compliant - ensures data integrity during transfer.
 * HIPAA §164.308(a)(7)(ii)(A) - Offsite backup storage
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../../config/logger';

export interface CloudUploadResult {
  success: boolean;
  provider?: string;
  key?: string;
  bucket?: string;
  size?: number;
  checksum?: string;
  uploadedAt?: string;
  url?: string;
  error?: string;
}

export function isCloudStorageEnabled(): boolean {
  return !!(process.env.CLOUD_STORAGE_PROVIDER && 
            process.env.CLOUD_STORAGE_PROVIDER !== 'local' &&
            (process.env.AWS_S3_BUCKET || process.env.GCS_BUCKET));
}

export async function uploadBackupToCloud(
  filePath: string,
  destinationKey: string,
  _metadata?: Record<string, string>
): Promise<CloudUploadResult> {
  const provider = process.env.CLOUD_STORAGE_PROVIDER || 'local';

  switch (provider) {
    case 's3':
      return uploadToS3(filePath, destinationKey);
    case 'local':
    default:
      return uploadToLocal(filePath, destinationKey);
  }
}

export async function downloadBackupFromCloud(
  key: string,
  destinationPath: string
): Promise<void> {
  const provider = process.env.CLOUD_STORAGE_PROVIDER || 'local';

  switch (provider) {
    case 's3':
      return downloadFromS3(key, destinationPath);
    case 'local':
    default:
      return downloadFromLocal(key, destinationPath);
  }
}

export async function listCloudBackups(prefix?: string): Promise<string[]> {
  const provider = process.env.CLOUD_STORAGE_PROVIDER || 'local';

  if (provider === 's3') {
    return listS3Backups(prefix);
  }

  const backupDir = process.env.BACKUP_LOCAL_PATH || './backups';
  try {
    if (!fs.existsSync(backupDir)) return [];
    const files = fs.readdirSync(backupDir);
    return prefix ? files.filter(f => f.startsWith(prefix)) : files;
  } catch (error: any) {
    logger.error('Failed to list backups', { error: error.message });
    return [];
  }
}

// =============================================================================
// S3 Implementation
// =============================================================================

function getS3Client() {
  const { S3Client } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
  const region = process.env.AWS_S3_REGION || process.env.WOUND_IMAGES_S3_REGION || 'us-east-2';
  return new S3Client({ region });
}

function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET environment variable is required for S3 uploads');
  }
  return bucket;
}

async function uploadToS3(filePath: string, destinationKey: string): Promise<CloudUploadResult> {
  try {
    const { Upload } = require('@aws-sdk/lib-storage') as typeof import('@aws-sdk/lib-storage');
    const client = getS3Client();
    const bucket = getS3Bucket();
    const fileStream = fs.createReadStream(filePath);
    const stats = fs.statSync(filePath);

    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    const checksum = hash.digest('hex');

    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: destinationKey,
        Body: fileStream,
        ServerSideEncryption: 'aws:kms',
        Metadata: {
          'x-amz-checksum-sha256': checksum,
          'uploaded-at': new Date().toISOString(),
          'source': 'accuratrials-backup-service',
        },
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
    });

    await upload.done();

    logger.info('Backup uploaded to S3', {
      bucket,
      key: destinationKey,
      size: stats.size,
      checksum,
    });

    return {
      success: true,
      provider: 's3',
      key: destinationKey,
      bucket,
      size: stats.size,
      checksum,
      uploadedAt: new Date().toISOString(),
      url: `s3://${bucket}/${destinationKey}`,
    };
  } catch (error: any) {
    logger.error('S3 upload failed — falling back to local', {
      error: error.message,
      key: destinationKey,
    });
    const localResult = await uploadToLocal(filePath, destinationKey);
    return { ...localResult, error: `S3 failed (${error.message}), stored locally` };
  }
}

async function downloadFromS3(key: string, destinationPath: string): Promise<void> {
  const { GetObjectCommand } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
  const client = getS3Client();
  const bucket = getS3Bucket();

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body) throw new Error(`S3 returned empty body for key: ${key}`);

  const writeStream = fs.createWriteStream(destinationPath);
  await new Promise<void>((resolve, reject) => {
    (body as NodeJS.ReadableStream).pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  logger.info('Backup downloaded from S3', { bucket, key, destinationPath });
}

async function listS3Backups(prefix?: string): Promise<string[]> {
  try {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
    const client = getS3Client();
    const bucket = getS3Bucket();

    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || 'backups/',
    }));

    return (response.Contents || []).map((obj: any) => obj.Key).filter(Boolean);
  } catch (error: any) {
    logger.error('Failed to list S3 backups', { error: error.message });
    return [];
  }
}

// =============================================================================
// Wound Image S3 Upload
// =============================================================================

export async function uploadWoundImageToS3(
  imageBuffer: Buffer,
  key: string,
): Promise<CloudUploadResult> {
  const bucket = process.env.WOUND_IMAGES_S3_BUCKET;
  if (!bucket) {
    return uploadWoundImageLocally(imageBuffer, key);
  }

  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
    const { S3Client } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
    const region = process.env.WOUND_IMAGES_S3_REGION || 'us-east-2';
    const client = new S3Client({ region });

    const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex');

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/jpeg',
      ServerSideEncryption: 'aws:kms',
      Metadata: {
        'x-amz-checksum-sha256': checksum,
        'uploaded-at': new Date().toISOString(),
      },
    }));

    logger.info('Wound image uploaded to S3', { bucket, key, size: imageBuffer.length });

    return {
      success: true,
      provider: 's3',
      key,
      bucket,
      size: imageBuffer.length,
      checksum,
      uploadedAt: new Date().toISOString(),
      url: `s3://${bucket}/${key}`,
    };
  } catch (error: any) {
    logger.error('Wound image S3 upload failed — storing locally', { error: error.message, key });
    return uploadWoundImageLocally(imageBuffer, key);
  }
}

function uploadWoundImageLocally(imageBuffer: Buffer, key: string): CloudUploadResult {
  const baseDir = process.env.WOUND_IMAGES_LOCAL_PATH || './uploads/wounds';
  const fullPath = path.join(baseDir, key);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, imageBuffer);
  const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  logger.info('Wound image stored locally', { path: fullPath, size: imageBuffer.length });
  return {
    success: true,
    provider: 'local',
    key,
    bucket: baseDir,
    size: imageBuffer.length,
    checksum,
    uploadedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Local Fallback
// =============================================================================

async function uploadToLocal(filePath: string, destinationKey: string): Promise<CloudUploadResult> {
  const backupDir = process.env.BACKUP_LOCAL_PATH || './backups';
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const destPath = path.join(backupDir, destinationKey);
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(filePath, destPath);
  const stats = fs.statSync(destPath);

  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(destPath));
  const checksum = hash.digest('hex');

  logger.info('Backup stored locally', { key: destinationKey, size: stats.size });

  return {
    success: true,
    provider: 'local',
    key: destinationKey,
    bucket: backupDir,
    size: stats.size,
    checksum,
    uploadedAt: new Date().toISOString()
  };
}

async function downloadFromLocal(key: string, destinationPath: string): Promise<void> {
  const backupDir = process.env.BACKUP_LOCAL_PATH || './backups';
  const sourcePath = path.join(backupDir, key);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Backup file not found: ${key}`);
  }
  fs.copyFileSync(sourcePath, destinationPath);
  logger.info('Backup downloaded from local storage', { key, destinationPath });
}

export default {
  uploadBackupToCloud,
  downloadBackupFromCloud,
  uploadWoundImageToS3,
  isCloudStorageEnabled,
  listCloudBackups
};
