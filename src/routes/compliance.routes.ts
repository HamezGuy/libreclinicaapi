/**
 * 21 CFR Part 11 Compliance Routes
 * 
 * Endpoints for checking and managing compliance status
 */

import express, { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import * as complianceService from '../services/database/compliance.service';

const router = express.Router();

// All compliance routes require authentication
router.use(authMiddleware);

/**
 * GET /api/compliance/status
 * Get 21 CFR Part 11 compliance status
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const result = await complianceService.getComplianceStatus();
  res.json(result);
}));

/**
 * GET /api/compliance/audit-trail/:entityType/:entityId
 * Get audit trail for an entity
 */
router.get('/audit-trail/:entityType/:entityId', asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  const validTypes = ['event_crf', 'study_event', 'study_subject', 'item_data'];
  if (!validTypes.includes(entityType)) {
    res.status(400).json({
      success: false,
      message: `Invalid entityType. Must be one of: ${validTypes.join(', ')}`
    });
    return;
  }

  const result = await complianceService.getAuditTrail(
    entityType as any,
    parseInt(entityId),
    limit
  );

  res.json(result);
}));

/**
 * GET /api/compliance/event-types
 * Get list of LibreClinica audit event types
 */
router.get('/event-types', asyncHandler(async (req: Request, res: Response) => {
  const eventTypes = Object.entries(complianceService.LibreClinicaAuditEventType)
    .filter(([key]) => isNaN(Number(key)))
    .map(([name, id]) => ({ id, name }));

  res.json({
    success: true,
    data: eventTypes
  });
}));

export default router;

