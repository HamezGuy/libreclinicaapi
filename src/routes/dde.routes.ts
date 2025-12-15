/**
 * Double Data Entry (DDE) Routes
 * 
 * API endpoints for DDE workflow including:
 * - Status checks
 * - Second entry submission
 * - Comparison retrieval
 * - Discrepancy resolution
 * - Finalization
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  isDDERequired,
  getDDEStatus,
  canUserPerformDDE,
  markFirstEntryComplete,
  submitSecondEntry,
  compareEntries,
  resolveDiscrepancy,
  finalizeDDE,
  getDDEDashboard
} from '../services/database/dde.service';

const router = Router();

/**
 * Require data manager role for resolution operations
 */
const requireDataManager = async (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  const allowedRoles = ['admin', 'data_manager', 'clinical_research_coordinator'];
  if (!allowedRoles.includes(user.role)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Data manager role required for this operation' 
    });
  }

  next();
};

// ============================================================================
// Status & Checks
// ============================================================================

/**
 * GET /api/dde/forms/:eventCrfId/status
 * Get DDE status for a form
 */
router.get('/forms/:eventCrfId/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    
    const [isRequired, status] = await Promise.all([
      isDDERequired(eventCrfId),
      getDDEStatus(eventCrfId)
    ]);

    res.json({
      success: true,
      data: {
        isRequired,
        status
      }
    });
  } catch (error: any) {
    logger.error('Error getting DDE status', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/dde/forms/:eventCrfId/can-enter
 * Check if current user can perform DDE entry
 */
router.get('/forms/:eventCrfId/can-enter', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const userId = (req as any).user?.userId;

    const result = await canUserPerformDDE(eventCrfId, userId);

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Error checking DDE permission', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Entry Operations
// ============================================================================

/**
 * POST /api/dde/forms/:eventCrfId/first-entry-complete
 * Mark first entry as complete (called when initial form is submitted)
 */
router.post('/forms/:eventCrfId/first-entry-complete', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const userId = (req as any).user?.userId;

    const status = await markFirstEntryComplete(eventCrfId, userId);

    res.json({ success: true, data: status });
  } catch (error: any) {
    logger.error('Error marking first entry complete', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/dde/forms/:eventCrfId/second-entry
 * Submit second entry data
 */
router.post('/forms/:eventCrfId/second-entry', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const userId = (req as any).user?.userId;
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'entries array is required'
      });
    }

    const status = await submitSecondEntry({
      eventCrfId,
      entries,
      userId
    });

    res.json({ success: true, data: status });
  } catch (error: any) {
    logger.error('Error submitting second entry', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Comparison & Resolution
// ============================================================================

/**
 * GET /api/dde/forms/:eventCrfId/comparison
 * Get comparison results between first and second entries
 */
router.get('/forms/:eventCrfId/comparison', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const comparison = await compareEntries(eventCrfId);

    res.json({ success: true, data: comparison });
  } catch (error: any) {
    logger.error('Error getting comparison', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/dde/discrepancies/:discrepancyId/resolve
 * Resolve a discrepancy
 */
router.post('/discrepancies/:discrepancyId/resolve', authMiddleware, requireDataManager, async (req: Request, res: Response) => {
  try {
    const discrepancyId = parseInt(req.params.discrepancyId);
    const { resolution, newValue, adjudicationNotes } = req.body;
    const userId = (req as any).user?.userId;

    if (!resolution) {
      return res.status(400).json({
        success: false,
        message: 'resolution is required (first_correct, second_correct, new_value, or adjudicated)'
      });
    }

    if ((resolution === 'new_value' || resolution === 'adjudicated') && !newValue) {
      return res.status(400).json({
        success: false,
        message: 'newValue is required for this resolution type'
      });
    }

    await resolveDiscrepancy({
      discrepancyId,
      resolution,
      newValue,
      adjudicationNotes,
      resolvedBy: userId
    });

    res.json({ success: true, message: 'Discrepancy resolved' });
  } catch (error: any) {
    logger.error('Error resolving discrepancy', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/dde/forms/:eventCrfId/finalize
 * Finalize DDE (all discrepancies must be resolved)
 */
router.post('/forms/:eventCrfId/finalize', authMiddleware, requireDataManager, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const userId = (req as any).user?.userId;

    const status = await finalizeDDE(eventCrfId, userId);

    res.json({ success: true, data: status });
  } catch (error: any) {
    logger.error('Error finalizing DDE', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Dashboard
// ============================================================================

/**
 * GET /api/dde/dashboard
 * Get DDE dashboard with pending work items
 */
router.get('/dashboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const siteId = req.query.siteId ? parseInt(req.query.siteId as string) : undefined;

    const dashboard = await getDDEDashboard(userId, siteId);

    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    logger.error('Error getting DDE dashboard', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

