/**
 * Backup Scheduler Service - 21 CFR Part 11 Compliant
 * 
 * Implements automatic backup scheduling per SOP-008 7.3.1:
 * - Full Backup: Weekly (Sunday 2:00 AM) - Retention: 4 weeks
 * - Incremental Backup: Daily (2:00 AM) - Retention: 7 days
 * - Transaction Log Backup: Hourly - Retention: 24 hours
 * 
 * Uses node-cron for scheduling with audit trail for all operations.
 */

import * as cron from 'node-cron';
import { logger } from '../../config/logger';
import * as backupService from './backup.service';
import { BackupType } from './backup.service';
import { pool } from '../../config/database';

// Type for scheduled task
type ScheduledTask = ReturnType<typeof cron.schedule>;

/**
 * Scheduled task references
 */
interface ScheduledTasks {
  fullBackup: ScheduledTask | null;
  incrementalBackup: ScheduledTask | null;
  transactionLogBackup: ScheduledTask | null;
  cleanup: ScheduledTask | null;
}

const scheduledTasks: ScheduledTasks = {
  fullBackup: null,
  incrementalBackup: null,
  transactionLogBackup: null,
  cleanup: null
};

/**
 * Scheduler status
 */
interface SchedulerStatus {
  running: boolean;
  startedAt: Date | null;
  lastFullBackup: Date | null;
  lastIncrementalBackup: Date | null;
  lastTransactionLogBackup: Date | null;
  lastCleanup: Date | null;
  nextFullBackup: Date | null;
  nextIncrementalBackup: Date | null;
  errors: string[];
}

const schedulerStatus: SchedulerStatus = {
  running: false,
  startedAt: null,
  lastFullBackup: null,
  lastIncrementalBackup: null,
  lastTransactionLogBackup: null,
  lastCleanup: null,
  nextFullBackup: null,
  nextIncrementalBackup: null,
  errors: []
};

/**
 * Record scheduler audit event directly to database
 * Uses only columns that exist in native LibreClinica audit_log_event table:
 * - audit_log_event_type_id, audit_date, audit_table, entity_id, entity_name, 
 * - user_id, old_value, new_value, reason_for_change, event_crf_id
 */
const recordSchedulerAudit = async (
  action: string,
  details: Record<string, any>
): Promise<void> => {
  try {
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id,
        audit_date,
        audit_table,
        entity_id,
        entity_name,
        user_id,
        new_value
      ) VALUES (
        COALESCE(
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%system%' OR name ILIKE '%other%' LIMIT 1),
          1
        ), 
        NOW(), 
        'backup_scheduler', 
        0, 
        $1, 
        0, 
        $2
      )
    `, [action, JSON.stringify(details)]);
  } catch (error: any) {
    logger.warn('Could not record scheduler audit', { error: error.message, action });
  }
};

/**
 * Calculate next run time from cron expression
 */
const getNextRunTime = (cronExpression: string): Date | null => {
  try {
    const now = new Date();
    
    // Simple calculation for common patterns
    if (cronExpression === '0 2 * * 0') {
      // Sunday 2 AM
      const next = new Date(now);
      next.setHours(2, 0, 0, 0);
      const daysUntilSunday = (7 - next.getDay()) % 7;
      next.setDate(next.getDate() + (daysUntilSunday === 0 && now.getHours() >= 2 ? 7 : daysUntilSunday));
      return next;
    } else if (cronExpression === '0 2 * * 1-6') {
      // Mon-Sat 2 AM
      const next = new Date(now);
      next.setHours(2, 0, 0, 0);
      if (now.getHours() >= 2) {
        next.setDate(next.getDate() + 1);
      }
      if (next.getDay() === 0) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    } else if (cronExpression === '0 * * * *') {
      // Every hour
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }
    
    return null;
  } catch {
    return null;
  }
};

/**
 * Execute backup with error handling and logging
 */
const executeBackup = async (type: BackupType, description: string): Promise<void> => {
  logger.info(`Scheduled ${description} starting`, { type });
  
  try {
    const result = await backupService.performBackup(type, 0, 'scheduler');
    
    if (result.success) {
      logger.info(`Scheduled ${description} completed`, {
        type,
        backupId: result.data?.backupId,
        size: result.data?.backupSize
      });
      
      // Update status
      switch (type) {
        case BackupType.FULL:
          schedulerStatus.lastFullBackup = new Date();
          break;
        case BackupType.INCREMENTAL:
          schedulerStatus.lastIncrementalBackup = new Date();
          break;
        case BackupType.TRANSACTION_LOG:
          schedulerStatus.lastTransactionLogBackup = new Date();
          break;
      }
      
      // Clear old errors for this type
      schedulerStatus.errors = schedulerStatus.errors.filter(e => !e.includes(description));
    } else {
      const errorMsg = `${description} failed: ${result.message}`;
      logger.error(errorMsg);
      schedulerStatus.errors.push(`${new Date().toISOString()}: ${errorMsg}`);
      
      // Keep only last 10 errors
      if (schedulerStatus.errors.length > 10) {
        schedulerStatus.errors = schedulerStatus.errors.slice(-10);
      }
    }
  } catch (error: any) {
    const errorMsg = `${description} error: ${error.message}`;
    logger.error(errorMsg, { error });
    schedulerStatus.errors.push(`${new Date().toISOString()}: ${errorMsg}`);
  }
};

/**
 * Execute cleanup with error handling
 */
const executeCleanup = async (): Promise<void> => {
  logger.info('Scheduled backup cleanup starting');
  
  try {
    const result = await backupService.cleanupOldBackups(0, 'scheduler');
    
    if (result.success) {
      schedulerStatus.lastCleanup = new Date();
      logger.info('Scheduled backup cleanup completed', {
        deleted: result.data?.deleted,
        freed: result.data?.freed
      });
    } else {
      logger.error('Scheduled backup cleanup failed', { message: result.message });
    }
  } catch (error: any) {
    logger.error('Scheduled backup cleanup error', { error: error.message });
  }
};

/**
 * Start backup scheduler
 * 
 * @param fullBackupCron - Cron expression for full backups (default: Sunday 2 AM)
 * @param incrementalBackupCron - Cron expression for incremental backups (default: Mon-Sat 2 AM)
 * @param transactionLogCron - Cron expression for transaction log backups (default: every hour)
 */
export const startScheduler = async (
  fullBackupCron: string = '0 2 * * 0',
  incrementalBackupCron: string = '0 2 * * 1-6',
  transactionLogCron: string = '0 * * * *'
): Promise<void> => {
  if (schedulerStatus.running) {
    logger.warn('Backup scheduler is already running');
    return;
  }
  
  logger.info('Starting backup scheduler', {
    fullBackupCron,
    incrementalBackupCron,
    transactionLogCron
  });
  
  // Audit: Scheduler started
  await recordSchedulerAudit('scheduler_started', {
    fullBackupCron,
    incrementalBackupCron,
    transactionLogCron
  });
  
  // Get timezone from environment or default to UTC
  const timezone = process.env.BACKUP_TIMEZONE || 'UTC';
  
  // Schedule full backup (Weekly - Sunday 2 AM)
  if (cron.validate(fullBackupCron)) {
    scheduledTasks.fullBackup = cron.schedule(fullBackupCron, () => {
      executeBackup(BackupType.FULL, 'full backup');
    }, {
      timezone
    });
    logger.info('Full backup scheduled', { cron: fullBackupCron, timezone });
  } else {
    logger.error('Invalid full backup cron expression', { cron: fullBackupCron });
  }
  
  // Schedule incremental backup (Daily - Mon-Sat 2 AM)
  if (cron.validate(incrementalBackupCron)) {
    scheduledTasks.incrementalBackup = cron.schedule(incrementalBackupCron, () => {
      executeBackup(BackupType.INCREMENTAL, 'incremental backup');
    }, {
      timezone
    });
    logger.info('Incremental backup scheduled', { cron: incrementalBackupCron, timezone });
  } else {
    logger.error('Invalid incremental backup cron expression', { cron: incrementalBackupCron });
  }
  
  // Schedule transaction log backup (Hourly)
  if (cron.validate(transactionLogCron)) {
    scheduledTasks.transactionLogBackup = cron.schedule(transactionLogCron, () => {
      executeBackup(BackupType.TRANSACTION_LOG, 'transaction log backup');
    }, {
      timezone
    });
    logger.info('Transaction log backup scheduled', { cron: transactionLogCron, timezone });
  } else {
    logger.error('Invalid transaction log backup cron expression', { cron: transactionLogCron });
  }
  
  // Schedule cleanup (Daily at 3 AM)
  const cleanupCron = '0 3 * * *';
  if (cron.validate(cleanupCron)) {
    scheduledTasks.cleanup = cron.schedule(cleanupCron, () => {
      executeCleanup();
    }, {
      timezone
    });
    logger.info('Backup cleanup scheduled', { cron: cleanupCron, timezone });
  }
  
  schedulerStatus.running = true;
  schedulerStatus.startedAt = new Date();
  schedulerStatus.nextFullBackup = getNextRunTime(fullBackupCron);
  schedulerStatus.nextIncrementalBackup = getNextRunTime(incrementalBackupCron);
  
  logger.info('Backup scheduler started successfully');
};

/**
 * Stop backup scheduler
 */
export const stopScheduler = async (): Promise<void> => {
  if (!schedulerStatus.running) {
    logger.warn('Backup scheduler is not running');
    return;
  }
  
  logger.info('Stopping backup scheduler');
  
  // Stop all scheduled tasks
  if (scheduledTasks.fullBackup) {
    scheduledTasks.fullBackup.stop();
    scheduledTasks.fullBackup = null;
  }
  
  if (scheduledTasks.incrementalBackup) {
    scheduledTasks.incrementalBackup.stop();
    scheduledTasks.incrementalBackup = null;
  }
  
  if (scheduledTasks.transactionLogBackup) {
    scheduledTasks.transactionLogBackup.stop();
    scheduledTasks.transactionLogBackup = null;
  }
  
  if (scheduledTasks.cleanup) {
    scheduledTasks.cleanup.stop();
    scheduledTasks.cleanup = null;
  }
  
  // Audit: Scheduler stopped
  await recordSchedulerAudit('scheduler_stopped', {});
  
  schedulerStatus.running = false;
  
  logger.info('Backup scheduler stopped');
};

/**
 * Get scheduler status
 */
export const getSchedulerStatus = (): SchedulerStatus => {
  return { ...schedulerStatus };
};

/**
 * Trigger immediate backup (manual trigger)
 */
export const triggerImmediateBackup = async (
  type: BackupType,
  userId: number,
  username: string
): Promise<{ success: boolean; backupId?: string; message: string }> => {
  logger.info('Manual backup triggered', { type, userId, username });
  
  const result = await backupService.performBackup(type, userId, username);
  
  return {
    success: result.success,
    backupId: result.data?.backupId,
    message: result.message || ''
  };
};

/**
 * Initialize scheduler on application startup if enabled
 */
export const initializeScheduler = async (): Promise<void> => {
  const enabled = process.env.BACKUP_SCHEDULER_ENABLED !== 'false';
  
  if (enabled) {
    logger.info('Backup scheduler auto-start enabled');
    
    try {
      const config = backupService.getBackupConfig();
      await startScheduler(
        config.schedules.full,
        config.schedules.incremental,
        config.schedules.transactionLog
      );
    } catch (error: any) {
      logger.error('Failed to start backup scheduler', { error: error.message });
    }
  } else {
    logger.info('Backup scheduler auto-start disabled (set BACKUP_SCHEDULER_ENABLED=true to enable)');
  }
};

export default {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  triggerImmediateBackup,
  initializeScheduler
};
