/**
 * Retention Management Routes - 21 CFR Part 11 & HIPAA Compliant
 * 
 * REST API routes for retention policy and legal hold management.
 * All routes require authentication and administrative privileges.
 * 
 * HIPAA §164.530(j): Retention periods
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import { Router, Request, Response } from 'express';
import { 
  getRetentionPolicies,
  getRetentionPolicyByName,
  upsertRetentionPolicy,
  getLegalHolds,
  createLegalHold,
  releaseLegalHold,
  performAutomatedCleanup,
  verifyBackupIntegrity,
  getRetentionStatistics
} from '../services/backup/retention-manager.service';
import { 
  getEncryptionStatus, 
  generateEncryptionKey 
} from '../services/backup/encryption.service';
import { 
  getCloudStorageStatus 
} from '../services/backup/cloud-storage.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';

const router = Router();

// Apply authentication to all retention routes
router.use(authMiddleware);

/**
 * @route GET /api/retention/policies
 * @desc Get all active retention policies
 * @access Admin only
 * @query recordType - Optional filter by record type
 */
router.get('/policies', async (req: Request, res: Response) => {
  try {
    const recordType = req.query.recordType as string | undefined;
    const policies = await getRetentionPolicies(recordType);
    
    res.json({
      success: true,
      data: policies,
      count: policies.length
    });
  } catch (error: any) {
    logger.error('Failed to get retention policies', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve retention policies',
      error: error.message
    });
  }
});

/**
 * @route GET /api/retention/policies/:policyName
 * @desc Get a specific retention policy by name
 * @access Admin only
 */
router.get('/policies/:policyName', async (req: Request, res: Response) => {
  try {
    const policyName = req.params.policyName as string;
    const policy = await getRetentionPolicyByName(policyName);
    
    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Policy not found'
      });
    }
    
    res.json({
      success: true,
      data: policy
    });
  } catch (error: any) {
    logger.error('Failed to get retention policy', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve retention policy',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/policies
 * @desc Create or update a retention policy
 * @access Admin only
 * @body RetentionPolicy fields
 */
router.post('/policies', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    
    const result = await upsertRetentionPolicy(req.body, userId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create/update policy',
        error: result.error
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Retention policy saved',
      data: { id: result.id }
    });
  } catch (error: any) {
    logger.error('Failed to save retention policy', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to save retention policy',
      error: error.message
    });
  }
});

/**
 * @route GET /api/retention/legal-holds
 * @desc Get all legal holds with optional filtering
 * @access Admin only
 * @query studyId - Filter by study
 * @query subjectId - Filter by subject
 * @query backupId - Filter by backup
 * @query activeOnly - Only show active holds (default: true)
 */
router.get('/legal-holds', async (req: Request, res: Response) => {
  try {
    const filters = {
      studyId: req.query.studyId ? parseInt(req.query.studyId as string) : undefined,
      subjectId: req.query.subjectId ? parseInt(req.query.subjectId as string) : undefined,
      backupId: req.query.backupId as string | undefined,
      activeOnly: req.query.activeOnly !== 'false'
    };
    
    const holds = await getLegalHolds(filters);
    
    res.json({
      success: true,
      data: holds,
      count: holds.length
    });
  } catch (error: any) {
    logger.error('Failed to get legal holds', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve legal holds',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/legal-holds
 * @desc Create a new legal hold
 * @access Admin only
 * @body LegalHold fields
 */
router.post('/legal-holds', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    const username = user?.userName || user?.username || 'system';
    
    const { holdName, holdReason, holdType } = req.body;
    
    if (!holdName || !holdReason || !holdType) {
      return res.status(400).json({
        success: false,
        message: 'holdName, holdReason, and holdType are required'
      });
    }
    
    const result = await createLegalHold(req.body, userId, username);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create legal hold',
        error: result.error
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Legal hold created',
      data: { id: result.id }
    });
  } catch (error: any) {
    logger.error('Failed to create legal hold', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to create legal hold',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/legal-holds/:holdId/release
 * @desc Release a legal hold
 * @access Admin only
 * @body { reason: string }
 */
router.post('/legal-holds/:holdId/release', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    const username = user?.userName || user?.username || 'system';
    const holdId = parseInt(req.params.holdId as string);
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason for release is required'
      });
    }
    
    const result = await releaseLegalHold(holdId, userId, username, reason);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to release legal hold',
        error: result.error
      });
    }
    
    res.json({
      success: true,
      message: 'Legal hold released'
    });
  } catch (error: any) {
    logger.error('Failed to release legal hold', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to release legal hold',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/cleanup
 * @desc Run automated cleanup of expired backups
 * @access Admin only
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    const username = user?.userName || user?.username || 'system';
    
    const result = await performAutomatedCleanup(userId, username);
    
    res.json({
      success: result.success,
      message: `Cleanup completed: ${result.filesDeleted} files deleted, ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB freed`,
      data: result
    });
  } catch (error: any) {
    logger.error('Cleanup failed', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Cleanup operation failed',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/verify/:backupId
 * @desc Verify backup integrity
 * @access Admin only
 */
router.post('/verify/:backupId', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    const username = user?.userName || user?.username || 'system';
    const backupId = req.params.backupId as string;
    
    const result = await verifyBackupIntegrity(backupId, userId, username);
    
    res.json({
      success: result.success,
      message: result.success ? 'Backup integrity verified' : 'Verification failed',
      data: result
    });
  } catch (error: any) {
    logger.error('Verification failed', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
});

/**
 * @route GET /api/retention/statistics
 * @desc Get retention system statistics
 * @access Admin only
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const stats = await getRetentionStatistics();
    
    res.json({
      success: true,
      data: {
        ...stats,
        totalSizeFormatted: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`
      }
    });
  } catch (error: any) {
    logger.error('Failed to get statistics', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve statistics',
      error: error.message
    });
  }
});

/**
 * @route GET /api/retention/encryption-status
 * @desc Get encryption configuration status
 * @access Admin only
 */
router.get('/encryption-status', async (req: Request, res: Response) => {
  try {
    const status = getEncryptionStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve encryption status',
      error: error.message
    });
  }
});

/**
 * @route GET /api/retention/cloud-status
 * @desc Get cloud storage configuration status
 * @access Admin only
 */
router.get('/cloud-status', async (req: Request, res: Response) => {
  try {
    const status = getCloudStorageStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cloud storage status',
      error: error.message
    });
  }
});

/**
 * @route POST /api/retention/generate-encryption-key
 * @desc Generate a new encryption key (for initial setup)
 * @access Admin only
 * 
 * WARNING: This key must be securely stored!
 * The key is only displayed once and should be saved to
 * a secure location like AWS Secrets Manager or Azure Key Vault.
 */
router.post('/generate-encryption-key', async (req: Request, res: Response) => {
  try {
    const key = generateEncryptionKey();
    
    logger.warn('New encryption key generated - ensure secure storage', {
      user: (req as any).user?.username
    });
    
    res.json({
      success: true,
      message: 'New encryption key generated. Store this securely - it will not be shown again!',
      data: {
        key,
        keyLength: '256-bit',
        algorithm: 'AES-256-GCM',
        instructions: 'Set BACKUP_ENCRYPTION_KEY environment variable to this value'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate encryption key',
      error: error.message
    });
  }
});

export default router;
