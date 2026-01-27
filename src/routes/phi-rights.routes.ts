/**
 * PHI Rights Routes
 * 
 * HIPAA Privacy Rule - Individual Rights Management
 * 
 * API endpoints for managing:
 * - PHI access requests
 * - Amendment requests
 * - Disclosure accounting
 * - Restriction requests
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  createPhiRequest,
  getPhiRequests,
  updatePhiRequestStatus,
  logPhiDisclosure,
  getDisclosureAccounting,
  createPhiAmendment,
  processPhiAmendment,
  getPhiRightsDashboard,
  PhiRequestType,
  PhiRequestStatus
} from '../services/database/phi-rights.service';

const router = Router();

// ============================================================================
// PHI Access Requests
// ============================================================================

/**
 * @route POST /api/phi-rights/requests
 * @desc Create a new PHI access/rights request
 * @access Private
 */
router.post('/requests', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;

    const result = await createPhiRequest(req.body, userId, username);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Error creating PHI request', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/phi-rights/requests
 * @desc Get PHI requests with filtering
 * @access Private (Admin/Privacy Officer)
 */
router.get('/requests', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, requestType, page, pageSize, overdue } = req.query;

    const result = await getPhiRequests({
      status: status as PhiRequestStatus,
      requestType: requestType as PhiRequestType,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
      overdue: overdue === 'true'
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting PHI requests', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route PATCH /api/phi-rights/requests/:id/status
 * @desc Update PHI request status
 * @access Private (Admin/Privacy Officer)
 */
router.patch('/requests/:id/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const requestId = parseInt(req.params.id, 10);

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { status, responseDetails, denialReason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const result = await updatePhiRequestStatus(
      requestId,
      { status, responseDetails, denialReason },
      userId,
      username
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error updating PHI request status', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// PHI Disclosures
// ============================================================================

/**
 * @route POST /api/phi-rights/disclosures
 * @desc Log a PHI disclosure
 * @access Private
 */
router.post('/disclosures', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await logPhiDisclosure(req.body, userId, username);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Error logging PHI disclosure', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/phi-rights/disclosures
 * @desc Get disclosure accounting for a subject
 * @access Private
 */
router.get('/disclosures', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { subjectId, subjectIdentifier, startDate, endDate } = req.query;

    const result = await getDisclosureAccounting({
      subjectId: subjectId ? parseInt(subjectId as string, 10) : undefined,
      subjectIdentifier: subjectIdentifier as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting disclosure accounting', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// PHI Amendments
// ============================================================================

/**
 * @route POST /api/phi-rights/amendments
 * @desc Create PHI amendment request
 * @access Private
 */
router.post('/amendments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await createPhiAmendment(req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Error creating PHI amendment', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route PATCH /api/phi-rights/amendments/:id
 * @desc Process PHI amendment (approve/deny)
 * @access Private (Admin/Privacy Officer)
 */
router.patch('/amendments/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const username = authReq.user?.userName;
    const amendmentId = parseInt(req.params.id, 10);

    if (!userId || !username) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { status, amendedData, denialReason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const result = await processPhiAmendment(
      amendmentId,
      { status, amendedData, denialReason },
      userId,
      username
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error processing PHI amendment', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// Dashboard
// ============================================================================

/**
 * @route GET /api/phi-rights/dashboard
 * @desc Get PHI rights dashboard summary
 * @access Private (Admin/Privacy Officer)
 */
router.get('/dashboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await getPhiRightsDashboard();

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting PHI rights dashboard', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;

