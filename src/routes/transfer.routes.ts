/**
 * Transfer Routes
 * 
 * API endpoints for subject transfer between sites.
 * Includes e-signature requirements for 21 CFR Part 11 compliance.
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
 */
router.post('/initiate', authMiddleware, requireTransferRole, async (req: Request, res: Response) => {
  try {
    const { studySubjectId, destinationSiteId, reasonForTransfer, notes, requiresApprovals } = req.body;
    const userId = (req as any).user?.userId;

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

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error initiating transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/approve
 * Approve a transfer (source or destination site)
 */
router.post('/:transferId/approve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const { approvalType, password } = req.body;
    const userId = (req as any).user?.userId;

    if (!approvalType || !password) {
      return res.status(400).json({
        success: false,
        message: 'approvalType and password are required'
      });
    }

    if (!['source', 'destination'].includes(approvalType)) {
      return res.status(400).json({
        success: false,
        message: 'approvalType must be "source" or "destination"'
      });
    }

    const transfer = await approveTransfer({
      transferId,
      approvalType,
      approvedBy: userId,
      password
    });

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error approving transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/complete
 * Complete a transfer (move subject to new site)
 */
router.post('/:transferId/complete', authMiddleware, requireTransferRole, async (req: Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const userId = (req as any).user?.userId;

    const transfer = await completeTransfer(transferId, userId);

    res.json({ success: true, data: transfer });
  } catch (error: any) {
    logger.error('Error completing transfer', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/transfers/:transferId/cancel
 * Cancel a pending transfer
 */
router.post('/:transferId/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    const transferId = parseInt(req.params.transferId);
    const { cancelReason } = req.body;
    const userId = (req as any).user?.userId;

    if (!cancelReason) {
      return res.status(400).json({
        success: false,
        message: 'cancelReason is required'
      });
    }

    const transfer = await cancelTransfer({
      transferId,
      cancelledBy: userId,
      cancelReason
    });

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

