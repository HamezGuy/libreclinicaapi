/**
 * Backup Routes - 21 CFR Part 11 Compliant
 * 
 * REST API routes for database backup and recovery management.
 * All routes require authentication and administrative privileges.
 * 
 * Implements SOP-008 Section 7.3 (Record Backup) and 7.4 (Record Recovery) requirements.
 */

import { Router } from 'express';
import * as backupController from '../controllers/backup.controller';

const router = Router();

/**
 * @route GET /api/backup/status
 * @desc Get backup system status including statistics and scheduler state
 * @access Admin only
 * 
 * Response includes:
 * - Total backups count and size
 * - Last backup timestamps by type
 * - Scheduler status (running, next scheduled backups)
 * - Health warnings if any
 */
router.get('/status', backupController.getBackupStatus);

/**
 * @route GET /api/backup/config
 * @desc Get backup configuration (encryption key is redacted)
 * @access Admin only
 */
router.get('/config', backupController.getBackupConfig);

/**
 * @route GET /api/backup/list
 * @desc List all backups with optional filtering
 * @access Admin only
 * @query type - Filter by backup type (full|incremental|transaction_log)
 * @query limit - Maximum number of results (default: 50)
 */
router.get('/list', backupController.listBackups);

/**
 * @route GET /api/backup/scheduler/status
 * @desc Get backup scheduler status
 * @access Admin only
 */
router.get('/scheduler/status', backupController.getSchedulerStatus);

/**
 * @route GET /api/backup/:backupId
 * @desc Get details of a specific backup
 * @access Admin only
 * @param backupId - Backup identifier (format: BKP-YYYY-MM-DD-TYPE-timestamp)
 */
router.get('/:backupId', backupController.getBackup);

/**
 * @route POST /api/backup/trigger
 * @desc Trigger an immediate manual backup
 * @access Admin only
 * @body { type: 'full' | 'incremental' | 'transaction_log' }
 * 
 * Part 11 Compliance:
 * - Operation is fully audited
 * - User identity is recorded
 * - Timestamp is captured
 */
router.post('/trigger', backupController.triggerBackup);

/**
 * @route POST /api/backup/scheduler/start
 * @desc Start the automatic backup scheduler
 * @access Admin only
 * 
 * Schedule per SOP-008 7.3.1:
 * - Full backup: Weekly (Sunday 2 AM)
 * - Incremental backup: Daily (Mon-Sat 2 AM)
 * - Transaction log: Hourly
 */
router.post('/scheduler/start', backupController.startScheduler);

/**
 * @route POST /api/backup/scheduler/stop
 * @desc Stop the automatic backup scheduler
 * @access Admin only
 * 
 * Warning: Stopping the scheduler will disable automatic backups.
 * Manual backups can still be triggered via /trigger endpoint.
 */
router.post('/scheduler/stop', backupController.stopScheduler);

/**
 * @route POST /api/backup/cleanup
 * @desc Run cleanup to remove expired backups per retention policy
 * @access Admin only
 * 
 * Retention policy per SOP-008 7.3.1:
 * - Full backups: 4 weeks
 * - Incremental backups: 7 days
 * - Transaction logs: 24 hours
 */
router.post('/cleanup', backupController.cleanupBackups);

/**
 * @route POST /api/backup/:backupId/verify
 * @desc Verify backup integrity (checksum validation)
 * @access Admin only
 * @param backupId - Backup identifier
 * 
 * Part 11 Compliance (§11.10(c)):
 * - Verifies SHA-256 checksum matches original
 * - Records verification in audit trail
 */
router.post('/:backupId/verify', backupController.verifyBackup);

/**
 * @route POST /api/backup/:backupId/restore
 * @desc Initiate backup restore (requires explicit confirmation)
 * @access Admin only
 * @param backupId - Backup identifier
 * @body { targetDatabase?: string, confirmRestore: boolean }
 * 
 * Part 11 Compliance:
 * - Requires confirmRestore: true for safety
 * - Full audit trail of restore operation
 * - Verifies backup integrity before restore
 * - Documents recovery per SOP-008 7.4.2
 */
router.post('/:backupId/restore', backupController.restoreBackup);

export default router;

