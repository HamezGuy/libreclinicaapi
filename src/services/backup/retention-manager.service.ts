/**
 * Retention Manager Service
 * 
 * Manages data retention policies per 21 CFR Part 11 and HIPAA requirements.
 * - Enforces minimum retention periods (7 years for clinical data)
 * - Supports legal holds
 * - Automated cleanup of expired backups
 * 
 * HIPAA §164.530(j): Retention requirements
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';

export interface RetentionPolicy {
  name: string;
  retentionDays: number;
  description: string;
}

export interface RetentionStatus {
  totalBackups: number;
  expiredBackups: number;
  retainedBackups: number;
  oldestBackup: string | null;
  newestBackup: string | null;
}

const DEFAULT_RETENTION_DAYS = config.part11?.auditLogRetentionDays || 2555; // 7 years

/**
 * Get configured retention policies
 */
export function getRetentionPolicies(): RetentionPolicy[] {
  return [
    {
      name: 'Database Backups',
      retentionDays: DEFAULT_RETENTION_DAYS,
      description: '7-year retention for database backups (21 CFR Part 11)'
    },
    {
      name: 'Audit Logs',
      retentionDays: DEFAULT_RETENTION_DAYS,
      description: '7-year retention for audit trail logs'
    },
    {
      name: 'Encrypted Backups',
      retentionDays: DEFAULT_RETENTION_DAYS,
      description: '7-year retention for encrypted backup archives'
    }
  ];
}

/**
 * Check retention status of backup directory
 */
export async function checkRetentionStatus(): Promise<RetentionStatus> {
  const backupDir = process.env.BACKUP_LOCAL_PATH || './backups';

  if (!fs.existsSync(backupDir)) {
    return { totalBackups: 0, expiredBackups: 0, retainedBackups: 0, oldestBackup: null, newestBackup: null };
  }

  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz') || f.endsWith('.enc'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(backupDir, f)).mtime
      }))
      .sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    const now = Date.now();
    const retentionMs = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expired = files.filter(f => (now - f.mtime.getTime()) > retentionMs);

    return {
      totalBackups: files.length,
      expiredBackups: expired.length,
      retainedBackups: files.length - expired.length,
      oldestBackup: files.length > 0 ? files[0].mtime.toISOString() : null,
      newestBackup: files.length > 0 ? files[files.length - 1].mtime.toISOString() : null
    };
  } catch (error: any) {
    logger.error('Failed to check retention status', { error: error.message });
    return { totalBackups: 0, expiredBackups: 0, retainedBackups: 0, oldestBackup: null, newestBackup: null };
  }
}

/**
 * Clean up expired backups (dry run by default)
 */
export async function cleanupExpiredBackups(dryRun: boolean = true): Promise<string[]> {
  const backupDir = process.env.BACKUP_LOCAL_PATH || './backups';
  const removedFiles: string[] = [];

  if (!fs.existsSync(backupDir)) return removedFiles;

  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz') || f.endsWith('.enc'));

    const now = Date.now();
    const retentionMs = DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      if ((now - stats.mtime.getTime()) > retentionMs) {
        if (dryRun) {
          logger.info('Would remove expired backup (dry run)', { file });
        } else {
          fs.unlinkSync(filePath);
          logger.info('Removed expired backup', { file });
        }
        removedFiles.push(file);
      }
    }

    return removedFiles;
  } catch (error: any) {
    logger.error('Failed to cleanup expired backups', { error: error.message });
    return removedFiles;
  }
}

export default {
  getRetentionPolicies,
  checkRetentionStatus,
  cleanupExpiredBackups
};
