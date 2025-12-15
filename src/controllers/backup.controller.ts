/**
 * Backup Controller - 21 CFR Part 11 Compliant
 * 
 * REST API endpoints for backup management with full audit trail.
 * Implements SOP-008 Section 7.3 (Record Backup) requirements.
 * 
 * All operations require administrative privileges and are fully audited.
 */

import { Request, Response } from 'express';
import { logger } from '../config/logger';
import * as backupService from '../services/backup/backup.service';
import * as schedulerService from '../services/backup/backup-scheduler.service';
import { BackupType } from '../services/backup/backup.service';

/**
 * Get backup system status and statistics
 * GET /api/backup/status
 */
export const getBackupStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const [statsResult, schedulerStatus] = await Promise.all([
      backupService.getBackupStats(),
      Promise.resolve(schedulerService.getSchedulerStatus())
    ]);
    
    res.json({
      success: true,
      data: {
        statistics: statsResult.data,
        scheduler: schedulerStatus,
        config: backupService.getBackupConfig()
      }
    });
  } catch (error: any) {
    logger.error('Failed to get backup status', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get backup status',
      error: error.message
    });
  }
};

/**
 * List all backups
 * GET /api/backup/list
 * Query params: type (full|incremental|transaction_log), limit
 */
export const listBackups = async (req: Request, res: Response): Promise<void> => {
  try {
    const type = req.query.type as BackupType | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const result = await backupService.listBackups(type, limit);
    
    res.json({
      success: result.success,
      data: result.data,
      message: result.message
    });
  } catch (error: any) {
    logger.error('Failed to list backups', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to list backups',
      error: error.message
    });
  }
};

/**
 * Get specific backup details
 * GET /api/backup/:backupId
 */
export const getBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupId } = req.params;
    
    const result = await backupService.getBackup(backupId);
    
    if (!result.success) {
      res.status(404).json({
        success: false,
        message: result.message
      });
      return;
    }
    
    res.json({
      success: true,
      data: result.data
    });
  } catch (error: any) {
    logger.error('Failed to get backup', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get backup',
      error: error.message
    });
  }
};

/**
 * Trigger manual backup
 * POST /api/backup/trigger
 * Body: { type: 'full' | 'incremental' | 'transaction_log' }
 */
export const triggerBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.body;
    const userId = (req as any).user?.id || 0;
    const username = (req as any).user?.username || 'api_user';
    
    if (!type || !Object.values(BackupType).includes(type)) {
      res.status(400).json({
        success: false,
        message: `Invalid backup type. Must be one of: ${Object.values(BackupType).join(', ')}`
      });
      return;
    }
    
    logger.info('Manual backup triggered via API', { type, userId, username });
    
    const result = await schedulerService.triggerImmediateBackup(type, userId, username);
    
    res.json({
      success: result.success,
      data: {
        backupId: result.backupId
      },
      message: result.message
    });
  } catch (error: any) {
    logger.error('Failed to trigger backup', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to trigger backup',
      error: error.message
    });
  }
};

/**
 * Verify backup integrity
 * POST /api/backup/:backupId/verify
 */
export const verifyBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupId } = req.params;
    const userId = (req as any).user?.id || 0;
    const username = (req as any).user?.username || 'api_user';
    
    const result = await backupService.verifyBackup(backupId, userId, username);
    
    res.json({
      success: result.success,
      data: result.data,
      message: result.message
    });
  } catch (error: any) {
    logger.error('Failed to verify backup', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to verify backup',
      error: error.message
    });
  }
};

/**
 * Initiate backup restore (requires confirmation)
 * POST /api/backup/:backupId/restore
 * Body: { targetDatabase?: string, confirmRestore: boolean }
 */
export const restoreBackup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupId } = req.params;
    const { targetDatabase, confirmRestore } = req.body;
    const userId = (req as any).user?.id || 0;
    const username = (req as any).user?.username || 'api_user';
    
    if (!confirmRestore) {
      res.status(400).json({
        success: false,
        message: 'Restore operation requires explicit confirmation. Set confirmRestore: true to proceed.',
        warning: 'This operation will restore data from the specified backup. Ensure you understand the implications.'
      });
      return;
    }
    
    logger.warn('Backup restore initiated', { backupId, targetDatabase, userId, username });
    
    const result = await backupService.restoreBackup(backupId, userId, username);
    
    res.json({
      success: result.success,
      data: result.data,
      message: result.message
    });
  } catch (error: any) {
    logger.error('Failed to restore backup', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to restore backup',
      error: error.message
    });
  }
};

/**
 * Start backup scheduler
 * POST /api/backup/scheduler/start
 */
export const startScheduler = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = backupService.getBackupConfig();
    
    await schedulerService.startScheduler(
      config.schedules.full,
      config.schedules.incremental,
      config.schedules.transactionLog
    );
    
    res.json({
      success: true,
      data: schedulerService.getSchedulerStatus(),
      message: 'Backup scheduler started'
    });
  } catch (error: any) {
    logger.error('Failed to start scheduler', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to start scheduler',
      error: error.message
    });
  }
};

/**
 * Stop backup scheduler
 * POST /api/backup/scheduler/stop
 */
export const stopScheduler = async (req: Request, res: Response): Promise<void> => {
  try {
    await schedulerService.stopScheduler();
    
    res.json({
      success: true,
      data: schedulerService.getSchedulerStatus(),
      message: 'Backup scheduler stopped'
    });
  } catch (error: any) {
    logger.error('Failed to stop scheduler', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to stop scheduler',
      error: error.message
    });
  }
};

/**
 * Get scheduler status
 * GET /api/backup/scheduler/status
 */
export const getSchedulerStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = schedulerService.getSchedulerStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    logger.error('Failed to get scheduler status', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduler status',
      error: error.message
    });
  }
};

/**
 * Run cleanup of expired backups
 * POST /api/backup/cleanup
 */
export const cleanupBackups = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id || 0;
    const username = (req as any).user?.username || 'api_user';
    
    const result = await backupService.cleanupOldBackups(userId, username);
    
    res.json({
      success: result.success,
      data: result.data,
      message: result.message
    });
  } catch (error: any) {
    logger.error('Failed to cleanup backups', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup backups',
      error: error.message
    });
  }
};

/**
 * Get backup configuration
 * GET /api/backup/config
 */
export const getBackupConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = backupService.getBackupConfig();
    
    // Return config safely
    const safeConfig = {
      ...config
    };
    
    res.json({
      success: true,
      data: safeConfig
    });
  } catch (error: any) {
    logger.error('Failed to get backup config', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get backup config',
      error: error.message
    });
  }
};

export default {
  getBackupStatus,
  listBackups,
  getBackup,
  triggerBackup,
  verifyBackup,
  restoreBackup,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  cleanupBackups,
  getBackupConfig
};

