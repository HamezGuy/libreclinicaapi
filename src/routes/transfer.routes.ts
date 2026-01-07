/**
 * Transfer Routes
 * 
 * API endpoints for subject transfer between sites.
 * Includes e-signature requirements for 21 CFR Part 11 compliance.
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all transfer operations
 * - §11.50: Electronic signature required for transfer approval
 * - §11.10(k): UTC timestamps for all events
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  initiateTransfer,
  approveTransfer,
  completeTransfer,
  cancelTransfer,
  getTransferDetails,
  getTransferHistory,
  getPendingTransfers,
  hasPendingTransfer,
  getAvailableSites
} from '../services/database/transfer.service';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  requireSignature,
  formatPart11Timestamp
} from '../middleware/part11.middleware';

const router = Router();

/**
 * Require admin or investigator role
 */
const requireTransferRole = async (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  const allowedRoles = ['admin', 'investigator', 'clinical_research_coordinator'];
  if (!allowedRoles.includes(user.role)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Transfer operations require admin or investigator role' 
    });
  }

  next();
};

// ============================================================================
// Transfer Operations
// ============================================================================

/**
 * POST /api/transfers/initiate
 * Initiate a subject transfer
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Records transfer initiation with full audit trail
 */
router.post('/initiate', authMiddleware, requireTransferRole, async (req: Part11Request, res: Response) => {
  try {
    const { studySubjectId, destinationSiteId, reasonForTransfer, notes, requiresApprovals } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!studySubjectId || !destinationSiteId || !reasonForTransfer) {
      return res.status(400).json({
        success: false,
        message: 'studySubjectId, destinationSiteId, and reasonForTransfer are required'
      });
    }

    const transfer = await initiateTransfer({
      studySubjectId,
      destinationSiteId,
      reasonForTransfer,
      notes,
      initiatedBy: userId,
      requiresApprovals: requiresApprovals !== false
    });

    // Part 11 Audit: Record transfer initiation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.TRANSFER_INITIATED,
      'acc_transfer_log',
      transfer.transferId,
      `Transfer for subject ${studySubjectId}`,
      null,
      {
        studySubjectId,
        destinationSiteId,
        reasonForTransfer,
        status: 'pending',
        initiatedAt: formatPart11Timestamp()
      },
      reasonForTransfer,
      { ipAddress: req.ip }
    );

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error initiating transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/approve
 * Approve a transfer (source or destination site)
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.50: REQUIRES electronic signature (password verification)
 * - §11.10(e): Records approval with signature details
 */
router.post('/:transferId/approve', authMiddleware, requireSignature, async (req: Part11Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const { approvalType } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!approvalType) {
      return res.status(400).json({
        success: false,
        message: 'approvalType is required'
      });
    }

    if (!['source', 'destination'].includes(approvalType)) {
      return res.status(400).json({
        success: false,
        message: 'approvalType must be "source" or "destination"'
      });
    }

    // Get transfer details before approval
    const transferBefore = await getTransferDetails(transferId);

    const transfer = await approveTransfer({
      transferId,
      approvalType,
      approvedBy: userId,
      password: req.body.password // Already verified by requireSignature middleware
    });

    // Part 11 Audit: Record transfer approval with e-signature (§11.10(e), §11.50)
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.TRANSFER_APPROVED,
      'acc_transfer_log',
      transferId,
      `Transfer ${transferId} - ${approvalType} approval`,
      { status: transferBefore?.transferStatus },
      {
        status: transfer.transferStatus,
        approvalType,
        approvedAt: formatPart11Timestamp(),
        electronicSignature: true,
        signatureMeaning: req.body.signatureMeaning || `Approved ${approvalType} site transfer`
      },
      `${approvalType} site approved transfer with electronic signature`,
      { ipAddress: req.ip, signatureMeaning: req.body.signatureMeaning }
    );

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error approving transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/complete
 * Complete a transfer (move subject to new site)
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Records transfer completion with full audit trail
 */
router.post('/:transferId/complete', authMiddleware, requireTransferRole, async (req: Part11Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get transfer details before completion
    const transferBefore = await getTransferDetails(transferId);

    const transfer = await completeTransfer(transferId, userId);

    // Part 11 Audit: Record transfer completion (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.TRANSFER_COMPLETED,
      'acc_transfer_log',
      transferId,
      `Transfer ${transferId} completed`,
      { status: transferBefore?.transferStatus },
      {
        status: 'completed',
        completedAt: formatPart11Timestamp(),
        studySubjectId: transfer.studySubjectId,
        newSiteId: transfer.destinationSiteId
      },
      'Subject transfer completed - subject moved to new site',
      { ipAddress: req.ip }
    );

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error completing transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/cancel
 * Cancel a pending transfer
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Records transfer cancellation with reason
 */
router.post('/:transferId/cancel', authMiddleware, async (req: Part11Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const { cancelReason } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!cancelReason) {
      return res.status(400).json({
        success: false,
        message: 'cancelReason is required'
      });
    }

    // Get transfer details before cancellation
    const transferBefore = await getTransferDetails(transferId);

    const transfer = await cancelTransfer({
      transferId,
      cancelledBy: userId,
      cancelReason
    });

    // Part 11 Audit: Record transfer cancellation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.TRANSFER_CANCELLED,
      'acc_transfer_log',
      transferId,
      `Transfer ${transferId} cancelled`,
      { status: transferBefore?.transferStatus },
      {
        status: 'cancelled',
        cancelledAt: formatPart11Timestamp(),
        cancelReason
      },
      cancelReason,
      { ipAddress: req.ip }
    );

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error cancelling transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Transfer Queries
// ============================================================================

/**
 * GET /api/transfers/:transferId
 * Get transfer details
 */
router.get('/:transferId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const transfer = await getTransferDetails(transferId);
    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error getting transfer details', { error: error.message });
    res.status(404).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/transfers/pending/site/:siteId
 * Get pending transfers for a site
 */
router.get('/pending/site/:siteId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const siteId = parseInt(req.params.siteId);
    const transfers = await getPendingTransfers(siteId);
    res.json({ success: true, data: transfers });
  } catch (error: any) {
    logger.error('Error getting pending transfers', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/transfers/history/subject/:studySubjectId
 * Get transfer history for a subject
 */
router.get('/history/subject/:studySubjectId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const transfers = await getTransferHistory(studySubjectId);
    res.json({ success: true, data: transfers });
  } catch (error: any) {
    logger.error('Error getting transfer history', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/transfers/check/:studySubjectId
 * Check if subject has a pending transfer
 */
router.get('/check/:studySubjectId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const hasPending = await hasPendingTransfer(studySubjectId);
    res.json({ success: true, data: { hasPendingTransfer: hasPending } });
  } catch (error: any) {
    logger.error('Error checking pending transfer', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/transfers/available-sites/:studySubjectId
 * Get available destination sites for transfer
 */
router.get('/available-sites/:studySubjectId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const userId = (req as any).user?.userId;
    const sites = await getAvailableSites(studySubjectId, userId);
    res.json({ success: true, data: sites });
  } catch (error: any) {
    logger.error('Error getting available sites', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

