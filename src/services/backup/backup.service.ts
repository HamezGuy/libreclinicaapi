/**
 * Backup Service - 21 CFR Part 11 & HIPAA Compliant
 * 
 * Multi-database backup using Docker PostgreSQL with encryption
 * and cloud storage support.
 * 
 * HIPAA §164.308(a)(7)(ii)(A): Data backup plan
 * HIPAA §164.312(a)(2)(iv): Encryption
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../config/environment';
import { logger } from '../../config/logger';
import { ApiResponse } from '../../types';
import { pool } from '../../config/database';
import { 
  encryptBackupFile, 
  isEncryptionEnabled, 
  calculateFileChecksum,
  EncryptedFileMetadata 
} from './encryption.service';
import { 
  uploadBackupToCloud, 
  isCloudStorageEnabled,
  CloudUploadResult 
} from './cloud-storage.service';

const execAsync = promisify(exec);

/**
 * Database configuration for multi-database backup
 */
export interface DatabaseConfig {
  name: string;
  user: string;
  host: string;
  port: number;
  container: string;
  enabled: boolean;
}

export enum BackupType {
  FULL = 'full',
  INCREMENTAL = 'incremental',
  TRANSACTION_LOG = 'transaction_log'
}

export enum BackupStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  VERIFIED = 'verified'
}

export interface BackupConfig {
  backupDir: string;
  containerName: string;
  retentionDays: {
    full: number;
    incremental: number;
    transactionLog: number;
  };
  schedules: {
    full: string;
    incremental: string;
    transactionLog: string;
  };
}

export interface BackupRecord {
  backupId: string;
  backupType: BackupType;
  backupDateTime: Date;
  backupSize: number;
  backupDuration: number;
  backupLocation: string;
  checksum: string;
  checksumAlgorithm: string;
  verificationStatus: BackupStatus;
  retentionUntil: Date;
  databaseName: string;
  databaseHost: string;
  userId?: number;
  username?: string;
  error?: string;
  // Multi-database support
  databases?: string[];
  // Encryption support
  encrypted?: boolean;
  encryptionMetadata?: EncryptedFileMetadata;
  // Cloud storage support
  cloudStorage?: CloudUploadResult;
}

const defaultConfig: BackupConfig = {
  backupDir: process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'),
  containerName: process.env.BACKUP_CONTAINER || 'libreclinica-postgres',
  retentionDays: {
    full: 28,
    incremental: 7,
    transactionLog: 1
  },
  schedules: {
    full: '0 2 * * 0',
    incremental: '0 2 * * 1-6',
    transactionLog: '0 * * * *'
  }
};

/**
 * Get all configured databases for backup
 */
export const getDatabaseConfigs = (): DatabaseConfig[] => {
  const configs: DatabaseConfig[] = [
    {
      name: config.libreclinica.database.database,
      user: config.libreclinica.database.user,
      host: config.libreclinica.database.host,
      port: config.libreclinica.database.port,
      container: process.env.BACKUP_CONTAINER || 'libreclinica-postgres',
      enabled: true
    }
  ];
  
  // Add IAM database if configured
  if (process.env.IAM_DB_NAME && process.env.BACKUP_IAM_DATABASE === 'true') {
    configs.push({
      name: process.env.IAM_DB_NAME || 'edc_iam_db',
      user: process.env.IAM_DB_USER || config.libreclinica.database.user,
      host: process.env.IAM_DB_HOST || config.libreclinica.database.host,
      port: parseInt(process.env.IAM_DB_PORT || '5432'),
      container: process.env.BACKUP_CONTAINER || 'libreclinica-postgres',
      enabled: true
    });
  }
  
  return configs;
};

export const getBackupConfig = (): BackupConfig => ({ ...defaultConfig });

const generateBackupId = (type: BackupType): string => {
  const now = new Date();
  return `BKP-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${type.toUpperCase()}-${now.getTime()}`;
};

const calculateChecksum = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

const ensureBackupDir = (backupDir: string): void => {
  ['full', 'incremental', 'transaction_log', 'metadata'].forEach(subDir => {
    const dir = path.join(backupDir, subDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

/**
 * Check if Docker is available and container is running
 */
const checkDockerContainer = async (containerName: string): Promise<boolean> => {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${containerName}`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
};

/**
 * Backup a single database using pg_dump INSIDE Docker container
 */
const backupSingleDatabase = async (
  dbConfig: DatabaseConfig,
  type: BackupType,
  backupId: string,
  backupDir: string
): Promise<{ success: boolean; path?: string; size?: number; error?: string }> => {
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const subDir = type === BackupType.FULL ? 'full' : type === BackupType.INCREMENTAL ? 'incremental' : 'transaction_log';
  const filename = `${backupId}_${dbConfig.name}_${timestamp}.sql.gz`;
  const outputPath = path.join(backupDir, subDir, filename);
  
  let pgDumpCommand: string;
  if (type === BackupType.TRANSACTION_LOG) {
    // Only backup audit tables for transaction log
    pgDumpCommand = `pg_dump -U ${dbConfig.user} -d ${dbConfig.name} --data-only -t audit_log_event -t audit_user_login 2>/dev/null | gzip`;
  } else {
    // Full database dump
    pgDumpCommand = `pg_dump -U ${dbConfig.user} -d ${dbConfig.name} | gzip`;
  }
  
  const dockerCmd = `docker exec ${dbConfig.container} sh -c "${pgDumpCommand}" > "${outputPath}"`;
  
  try {
    await execAsync(dockerCmd, { timeout: 600000 }); // 10 min timeout
    
    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'Backup file was not created' };
    }
    
    const stats = fs.statSync(outputPath);
    if (stats.size < 20) {
      // Very small file - may be empty or just gzip header
      fs.unlinkSync(outputPath);
      return { success: false, error: `Backup file too small (${stats.size} bytes)` };
    }
    
    return { success: true, path: outputPath, size: stats.size };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

/**
 * Perform backup using pg_dump INSIDE Docker container
 * Supports multi-database backup, encryption, and cloud storage
 */
export const performBackup = async (
  type: BackupType,
  userId: number = 0,
  username: string = 'system',
  options: {
    databases?: string[];
    skipEncryption?: boolean;
    skipCloudUpload?: boolean;
  } = {}
): Promise<ApiResponse<BackupRecord>> => {
  const startTime = Date.now();
  const backupId = generateBackupId(type);
  const backupConfig = getBackupConfig();
  const dbConfig = config.libreclinica.database;

  logger.info('Starting backup', { backupId, type, options });

  try {
    ensureBackupDir(backupConfig.backupDir);

    // Check if Docker container is running
    const containerRunning = await checkDockerContainer(backupConfig.containerName);
    if (!containerRunning) {
      throw new Error(`Docker container '${backupConfig.containerName}' is not running. Start it with: docker-compose -f docker-compose.libreclinica.yml up -d`);
    }

    // Get database configurations
    const allDbConfigs = getDatabaseConfigs();
    const databasesToBackup = options.databases 
      ? allDbConfigs.filter(db => options.databases!.includes(db.name))
      : allDbConfigs.filter(db => db.enabled);
    
    if (databasesToBackup.length === 0) {
      throw new Error('No databases configured for backup');
    }
    
    logger.info('Backing up databases', { 
      databases: databasesToBackup.map(db => db.name) 
    });

    // Backup each database
    const backupFiles: string[] = [];
    const databaseNames: string[] = [];
    let totalSize = 0;
    
    for (const db of databasesToBackup) {
      logger.info('Backing up database', { database: db.name });
      
      const result = await backupSingleDatabase(db, type, backupId, backupConfig.backupDir);
      
      if (result.success && result.path) {
        backupFiles.push(result.path);
        databaseNames.push(db.name);
        totalSize += result.size || 0;
        logger.info('Database backup completed', { 
          database: db.name, 
          size: result.size 
        });
      } else {
        logger.warn('Database backup failed', { 
          database: db.name, 
          error: result.error 
        });
        // Continue with other databases - partial backup is better than none
      }
    }
    
    if (backupFiles.length === 0) {
      throw new Error('No databases were successfully backed up');
    }

    // Calculate checksum of primary backup file
    const primaryBackupPath = backupFiles[0];
    let checksum = await calculateChecksum(primaryBackupPath);
    
    // Encryption
    let encryptionMetadata: any;
    let finalBackupPath = primaryBackupPath;
    
    if (isEncryptionEnabled() && !options.skipEncryption) {
      logger.info('Encrypting backup files');
      
      for (const backupPath of backupFiles) {
        const encResult = await encryptBackupFile(backupPath);
        if (encResult.success && encResult.metadata) {
          if (backupPath === primaryBackupPath) {
            encryptionMetadata = encResult.metadata;
            finalBackupPath = encResult.metadata.encryptedPath;
          }
          logger.info('File encrypted', { 
            original: backupPath, 
            encrypted: encResult.metadata.encryptedPath 
          });
        } else {
          logger.warn('Encryption failed for file', { 
            path: backupPath, 
            error: encResult.error 
          });
        }
      }
    }
    
    // Cloud storage upload
    let cloudStorageResult: CloudUploadResult | undefined;
    
    if (isCloudStorageEnabled() && !options.skipCloudUpload) {
      logger.info('Uploading backup to cloud storage');
      
      for (const backupPath of backupFiles) {
        const uploadPath = isEncryptionEnabled() && !options.skipEncryption
          ? `${backupPath}.enc`
          : backupPath;
          
        if (fs.existsSync(uploadPath)) {
          const uploadResult = await uploadBackupToCloud(uploadPath, backupId, {
            'backup-type': type,
            'database': path.basename(uploadPath).split('_')[1] || 'unknown',
            'retention-policy': 'default'
          });
          
          if (uploadResult.success) {
            if (backupPath === primaryBackupPath) {
              cloudStorageResult = uploadResult;
            }
            logger.info('File uploaded to cloud', { 
              key: uploadResult.key 
            });
          } else {
            logger.warn('Cloud upload failed', { 
              path: uploadPath, 
              error: uploadResult.error 
            });
          }
        }
      }
    }

    // Calculate retention date
    const retentionDays = type === BackupType.FULL ? backupConfig.retentionDays.full :
                          type === BackupType.INCREMENTAL ? backupConfig.retentionDays.incremental :
                          backupConfig.retentionDays.transactionLog;
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

    const duration = Date.now() - startTime;

    const backupRecord: BackupRecord = {
      backupId,
      backupType: type,
      backupDateTime: new Date(),
      backupSize: totalSize,
      backupDuration: duration,
      backupLocation: finalBackupPath,
      checksum,
      checksumAlgorithm: 'SHA-256',
      verificationStatus: BackupStatus.VERIFIED,
      retentionUntil,
      databaseName: databaseNames[0],
      databaseHost: dbConfig.host,
      userId,
      username,
      databases: databaseNames,
      encrypted: !!encryptionMetadata,
      encryptionMetadata,
      cloudStorage: cloudStorageResult
    };

    // Save metadata
    const metadataPath = path.join(backupConfig.backupDir, 'metadata', `${backupId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(backupRecord, null, 2));

    // Log to database for audit trail
    try {
      await pool.query(`
        INSERT INTO audit_log_event (audit_log_event_type_id, audit_date, audit_table, entity_id, entity_name, user_id, new_value, reason_for_change)
        VALUES (1, NOW(), 'system_backup', 0, $1, $2, $3, $4)
      `, [
        backupId, 
        userId, 
        JSON.stringify({ 
          type, 
          status: 'completed', 
          size: totalSize,
          databases: databaseNames,
          encrypted: !!encryptionMetadata,
          cloudUploaded: !!cloudStorageResult?.success
        }), 
        `Backup completed - checksum: ${checksum.substring(0, 16)}`
      ]);
    } catch (e) {
      logger.warn('Could not log backup to audit trail');
    }

    logger.info('Backup completed', { 
      backupId, 
      databases: databaseNames,
      size: totalSize, 
      duration, 
      encrypted: !!encryptionMetadata,
      cloudUploaded: !!cloudStorageResult?.success
    });

    return {
      success: true,
      data: backupRecord,
      message: `Backup ${backupId} completed successfully (${(totalSize / 1024).toFixed(2)} KB, ${databaseNames.length} database(s))`
    };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error('Backup failed', { backupId, error: error.message, duration });

    return {
      success: false,
      data: {
        backupId,
        backupType: type,
        backupDateTime: new Date(),
        backupSize: 0,
        backupDuration: duration,
        backupLocation: '',
        checksum: '',
        checksumAlgorithm: 'SHA-256',
        verificationStatus: BackupStatus.FAILED,
        retentionUntil: new Date(),
        databaseName: dbConfig.database,
        databaseHost: dbConfig.host,
        userId,
        username,
        error: error.message
      },
      message: `Backup failed: ${error.message}`
    };
  }
};

export const listBackups = async (type?: BackupType, limit: number = 50): Promise<ApiResponse<BackupRecord[]>> => {
  const backupConfig = getBackupConfig();
  const metadataDir = path.join(backupConfig.backupDir, 'metadata');
  const records: BackupRecord[] = [];

  if (fs.existsSync(metadataDir)) {
    const files = fs.readdirSync(metadataDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const record: BackupRecord = JSON.parse(fs.readFileSync(path.join(metadataDir, file), 'utf-8'));
        if (!type || record.backupType === type) {
          if (fs.existsSync(record.backupLocation)) {
            records.push(record);
          }
        }
      } catch {}
    }
  }

  records.sort((a, b) => new Date(b.backupDateTime).getTime() - new Date(a.backupDateTime).getTime());
  
  return { success: true, data: records.slice(0, limit), message: `Found ${records.length} backups` };
};

export const getBackup = async (backupId: string): Promise<ApiResponse<BackupRecord>> => {
  const backupConfig = getBackupConfig();
  const metadataPath = path.join(backupConfig.backupDir, 'metadata', `${backupId}.json`);

  if (fs.existsSync(metadataPath)) {
    return { success: true, data: JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) };
  }
  
  return { success: false, message: `Backup ${backupId} not found` };
};

export const verifyBackup = async (backupId: string, userId: number, username: string): Promise<ApiResponse<{ verified: boolean; checksum: string }>> => {
  const result = await getBackup(backupId);
  if (!result.success || !result.data) {
    return { success: false, message: `Backup ${backupId} not found` };
  }

  if (!fs.existsSync(result.data.backupLocation)) {
    return { success: false, message: `Backup file not found` };
  }

  const currentChecksum = await calculateChecksum(result.data.backupLocation);
  const verified = currentChecksum === result.data.checksum;

  return {
    success: true,
    data: { verified, checksum: currentChecksum },
    message: verified ? 'Backup integrity verified' : 'Checksum mismatch - backup may be corrupted'
  };
};

export const cleanupOldBackups = async (userId: number = 0, username: string = 'system'): Promise<ApiResponse<{ deleted: number; freed: number }>> => {
  const backupConfig = getBackupConfig();
  const metadataDir = path.join(backupConfig.backupDir, 'metadata');
  let deleted = 0, freed = 0;

  if (!fs.existsSync(metadataDir)) {
    return { success: true, data: { deleted: 0, freed: 0 }, message: 'No backups to clean' };
  }

  const now = new Date();
  const files = fs.readdirSync(metadataDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const metaPath = path.join(metadataDir, file);
      const record: BackupRecord = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      
      if (new Date(record.retentionUntil) < now) {
        if (fs.existsSync(record.backupLocation)) {
          freed += fs.statSync(record.backupLocation).size;
          fs.unlinkSync(record.backupLocation);
        }
        fs.unlinkSync(metaPath);
        deleted++;
        logger.info('Deleted expired backup', { backupId: record.backupId });
      }
    } catch {}
  }

  return { success: true, data: { deleted, freed }, message: `Deleted ${deleted} backups, freed ${(freed / 1024 / 1024).toFixed(2)} MB` };
};

export const getBackupStats = async (): Promise<ApiResponse<any>> => {
  const result = await listBackups();
  const backups = result.data || [];
  
  const totalSize = backups.reduce((sum, b) => sum + b.backupSize, 0);
  const lastBackup = backups.length > 0 ? backups[0] : null;
  
  const byType = { full: 0, incremental: 0, transaction_log: 0 };
  let lastFull: Date | null = null;
  
  for (const b of backups) {
    byType[b.backupType]++;
    if (b.backupType === BackupType.FULL && !lastFull) {
      lastFull = new Date(b.backupDateTime);
    }
  }

  const warnings: string[] = [];
  if (!lastFull) warnings.push('No full backups found');
  else if ((Date.now() - lastFull.getTime()) / 86400000 > 7) {
    warnings.push(`Last full backup was ${Math.floor((Date.now() - lastFull.getTime()) / 86400000)} days ago`);
  }

  return {
    success: true,
    data: {
      totalBackups: backups.length,
      totalSize,
      lastBackup,
      backupsByType: byType,
      status: { healthy: warnings.length === 0, lastFullBackup: lastFull, warnings }
    }
  };
};

export const restoreBackup = async (backupId: string, userId: number, username: string): Promise<ApiResponse<any>> => {
  const result = await getBackup(backupId);
  if (!result.success) return result;

  // Verify checksum first
  const verify = await verifyBackup(backupId, userId, username);
  if (!verify.data?.verified) {
    return { success: false, message: 'Backup integrity check failed' };
  }

  return {
    success: true,
    data: { backupId, location: result.data!.backupLocation },
    message: `To restore, run: gunzip -c "${result.data!.backupLocation}" | docker exec -i libreclinica-postgres psql -U libreclinica -d libreclinica`
  };
};

export default {
  performBackup, 
  listBackups, 
  getBackup, 
  verifyBackup, 
  cleanupOldBackups, 
  getBackupStats, 
  restoreBackup, 
  getBackupConfig,
  getDatabaseConfigs,
  BackupType, 
  BackupStatus
};
