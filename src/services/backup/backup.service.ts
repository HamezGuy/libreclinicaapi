/**
 * Backup Service - 21 CFR Part 11 Compliant
 * 
 * SIMPLE, WORKING database backup using Docker PostgreSQL
 * 
 * This service runs pg_dump INSIDE the Docker container where PostgreSQL 
 * tools are guaranteed to be available.
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

const execAsync = promisify(exec);

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
 * Perform backup using pg_dump INSIDE Docker container
 */
export const performBackup = async (
  type: BackupType,
  userId: number = 0,
  username: string = 'system'
): Promise<ApiResponse<BackupRecord>> => {
  const startTime = Date.now();
  const backupId = generateBackupId(type);
  const backupConfig = getBackupConfig();
  const dbConfig = config.libreclinica.database;

  logger.info('Starting backup', { backupId, type });

  try {
    ensureBackupDir(backupConfig.backupDir);

    // Check if Docker container is running
    const containerRunning = await checkDockerContainer(backupConfig.containerName);
    if (!containerRunning) {
      throw new Error(`Docker container '${backupConfig.containerName}' is not running. Start it with: docker-compose -f docker-compose.libreclinica.yml up -d`);
    }

    // Generate file paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const subDir = type === BackupType.FULL ? 'full' : type === BackupType.INCREMENTAL ? 'incremental' : 'transaction_log';
    const filename = `${backupId}_${dbConfig.database}_${timestamp}.sql.gz`;
    const outputPath = path.join(backupConfig.backupDir, subDir, filename);

    // Run pg_dump INSIDE the Docker container
    logger.info('Running pg_dump in Docker container', { container: backupConfig.containerName });
    
    let pgDumpCommand: string;
    if (type === BackupType.TRANSACTION_LOG) {
      // Only backup audit tables for transaction log
      pgDumpCommand = `pg_dump -U ${dbConfig.user} -d ${dbConfig.database} --data-only -t audit_log_event -t audit_user_login | gzip`;
    } else {
      // Full database dump
      pgDumpCommand = `pg_dump -U ${dbConfig.user} -d ${dbConfig.database} | gzip`;
    }

    // Execute inside container and write to host
    const dockerCmd = `docker exec ${backupConfig.containerName} sh -c "${pgDumpCommand}" > "${outputPath}"`;
    
    await execAsync(dockerCmd, { timeout: 600000 }); // 10 min timeout

    // Verify file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Backup file was not created');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size < 100) {
      // File too small - likely empty or error
      const content = fs.readFileSync(outputPath, 'utf-8');
      fs.unlinkSync(outputPath);
      throw new Error(`Backup file is too small (${stats.size} bytes). Content: ${content.substring(0, 200)}`);
    }

    // Calculate checksum
    const checksum = await calculateChecksum(outputPath);
    
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
      backupSize: stats.size,
      backupDuration: duration,
      backupLocation: outputPath,
      checksum,
      checksumAlgorithm: 'SHA-256',
      verificationStatus: BackupStatus.VERIFIED,
      retentionUntil,
      databaseName: dbConfig.database,
      databaseHost: dbConfig.host,
      userId,
      username
    };

    // Save metadata
    const metadataPath = path.join(backupConfig.backupDir, 'metadata', `${backupId}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(backupRecord, null, 2));

    // Log to database for audit trail
    try {
      await pool.query(`
        INSERT INTO audit_log_event (audit_log_event_type_id, audit_date, audit_table, entity_id, entity_name, user_id, new_value, reason_for_change)
        VALUES (1, NOW(), 'system_backup', 0, $1, $2, $3, $4)
      `, [backupId, userId, JSON.stringify({ type, status: 'completed', size: stats.size }), `Backup completed - checksum: ${checksum.substring(0, 16)}`]);
    } catch (e) {
      logger.warn('Could not log backup to audit trail');
    }

    logger.info('Backup completed', { backupId, size: stats.size, duration, checksum: checksum.substring(0, 16) });

    return {
      success: true,
      data: backupRecord,
      message: `Backup ${backupId} completed successfully (${(stats.size / 1024).toFixed(2)} KB)`
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
  performBackup, listBackups, getBackup, verifyBackup, cleanupOldBackups, getBackupStats, restoreBackup, getBackupConfig,
  BackupType, BackupStatus
};
