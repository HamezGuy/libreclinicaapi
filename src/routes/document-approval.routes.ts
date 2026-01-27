/**
 * Document Approval Workflow Routes
 * 
 * 21 CFR Part 11 Compliant Formal Document Approval
 * 
 * API endpoints for:
 * - Document workflow creation and management
 * - Approval step processing
 * - Pending approval tracking
 * - Audit trail access
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  createWorkflow,
  getWorkflow,
  getWorkflows,
  submitForReview,
  processApprovalStep,
  getPendingApprovals,
  getWorkflowAuditTrail,
  DocumentType,
  WorkflowStatus
} from '../services/database/document-approval.service';

const router = Router();

// ============================================================================
// Workflow Management
// ============================================================================

/**
 * @route POST /api/document-approval/workflows
 * @desc Create a new document approval workflow
 * @access Private
 */
router.post('/workflows', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      documentType,
      documentName,
      documentVersion,
      documentPath,
      studyId,
      description,
      changeSummary,
      effectiveDate,
      expirationDate,
      approvalSteps
    } = req.body;

    if (!documentType || !documentName || !documentVersion || !approvalSteps?.length) {
      return res.status(400).json({
        success: false,
        message: 'documentType, documentName, documentVersion, and approvalSteps are required'
      });
    }

    const result = await createWorkflow(
      {
        documentType,
        documentName,
        documentVersion,
        documentPath,
        studyId,
        description,
        changeSummary,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
        expirationDate: expirationDate ? new Date(expirationDate) : undefined,
        approvalSteps
      },
      userId,
      username
    );

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error creating workflow', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/document-approval/workflows
 * @desc Get workflows with filtering
 * @access Private
 */
router.get('/workflows', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { studyId, documentType, status, pendingFor, page, pageSize } = req.query;

    const result = await getWorkflows({
      studyId: studyId ? parseInt(studyId as string, 10) : undefined,
      documentType: documentType as DocumentType,
      status: status as WorkflowStatus,
      pendingFor: pendingFor ? parseInt(pendingFor as string, 10) : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting workflows', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/document-approval/workflows/:id
 * @desc Get workflow by ID with all steps
 * @access Private
 */
router.get('/workflows/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workflowId = parseInt(req.params.id, 10);
    const result = await getWorkflow(workflowId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error: any) {
    logger.error('Error getting workflow', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/document-approval/workflows/:id/submit
 * @desc Submit workflow for review
 * @access Private
 */
router.post('/workflows/:id/submit', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const workflowId = parseInt(req.params.id, 10);

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await submitForReview(workflowId, userId, username);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error submitting workflow', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/document-approval/workflows/:id/audit
 * @desc Get workflow audit trail
 * @access Private
 */
router.get('/workflows/:id/audit', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workflowId = parseInt(req.params.id, 10);
    const result = await getWorkflowAuditTrail(workflowId);
    res.json(result);
  } catch (error: any) {
    logger.error('Error getting audit trail', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// Approval Step Processing
// ============================================================================

/**
 * @route POST /api/document-approval/steps/:stepId/approve
 * @desc Approve an approval step
 * @access Private
 */
router.post('/steps/:stepId/approve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const stepId = parseInt(req.params.stepId, 10);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                      req.socket.remoteAddress || '';

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { comments, signatureMeaning, password, deviceFingerprint } = req.body;

    // TODO: Verify password for e-signature if required

    const result = await processApprovalStep(
      stepId,
      {
        workflowId: 0, // Will be looked up from step
        action: 'approved',
        comments,
        signatureMeaning,
        password
      },
      userId,
      username,
      ipAddress,
      deviceFingerprint
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error approving step', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/document-approval/steps/:stepId/reject
 * @desc Reject an approval step
 * @access Private
 */
router.post('/steps/:stepId/reject', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const stepId = parseInt(req.params.stepId, 10);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                      req.socket.remoteAddress || '';

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { comments, deviceFingerprint } = req.body;

    if (!comments) {
      return res.status(400).json({ 
        success: false, 
        message: 'Rejection reason is required' 
      });
    }

    const result = await processApprovalStep(
      stepId,
      {
        workflowId: 0,
        action: 'rejected',
        comments
      },
      userId,
      username,
      ipAddress,
      deviceFingerprint
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error rejecting step', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/document-approval/steps/:stepId/delegate
 * @desc Delegate an approval step to another user
 * @access Private
 */
router.post('/steps/:stepId/delegate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const stepId = parseInt(req.params.stepId, 10);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                      req.socket.remoteAddress || '';

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { delegateTo, comments, deviceFingerprint } = req.body;

    if (!delegateTo) {
      return res.status(400).json({ 
        success: false, 
        message: 'delegateTo user ID is required' 
      });
    }

    const result = await processApprovalStep(
      stepId,
      {
        workflowId: 0,
        action: 'delegated',
        delegateTo,
        comments
      },
      userId,
      username,
      ipAddress,
      deviceFingerprint
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error delegating step', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// Pending Approvals
// ============================================================================

/**
 * @route GET /api/document-approval/pending
 * @desc Get pending approvals for current user
 * @access Private
 */
router.get('/pending', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await getPendingApprovals(userId);
    res.json(result);
  } catch (error: any) {
    logger.error('Error getting pending approvals', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;

