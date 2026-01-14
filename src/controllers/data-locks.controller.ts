/**
 * Data Locks Controller
 * 
 * Endpoints for data locking/unlocking with validation
 * Supports locking at form, event, and subject levels
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dataLocksService from '../services/database/data-locks.service';

// ═══════════════════════════════════════════════════════════════════
// LIST & QUERY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, page, limit } = req.query;

  const result = await dataLocksService.getLockedRecords({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY CHECK ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a subject's data is eligible for locking
 * GET /api/data-locks/eligibility/subject/:studySubjectId
 */
export const checkSubjectEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { studySubjectId } = req.params;

  if (!studySubjectId) {
    res.status(400).json({ success: false, message: 'studySubjectId is required' });
    return;
  }

  const eligibility = await dataLocksService.checkSubjectLockEligibility(parseInt(studySubjectId));

  res.json({
    success: true,
    data: eligibility
  });
});

/**
 * Check if a study event's data is eligible for locking
 * GET /api/data-locks/eligibility/event/:studyEventId
 */
export const checkEventEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  if (!studyEventId) {
    res.status(400).json({ success: false, message: 'studyEventId is required' });
    return;
  }

  const eligibility = await dataLocksService.checkEventLockEligibility(parseInt(studyEventId));

  res.json({
    success: true,
    data: eligibility
  });
});

// ═══════════════════════════════════════════════════════════════════
// FORM-LEVEL LOCK/UNLOCK (Original functionality)
// ═══════════════════════════════════════════════════════════════════

/**
 * Lock a single form (event CRF)
 * POST /api/data-locks
 */
export const lock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId } = req.body;

  if (!eventCrfId) {
    res.status(400).json({ success: false, message: 'eventCrfId is required' });
    return;
  }

  const result = await dataLocksService.lockRecord(eventCrfId, user.userId);

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Unlock a single form (event CRF)
 * DELETE /api/data-locks/:eventCrfId
 */
export const unlock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId } = req.params;

  const result = await dataLocksService.unlockRecord(parseInt(eventCrfId), user.userId);

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════
// SUBJECT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

/**
 * Lock all data for a subject
 * POST /api/data-locks/subject/:studySubjectId
 * Body: { reason: string, skipValidation?: boolean }
 */
export const lockSubject = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studySubjectId } = req.params;
  const { reason, skipValidation } = req.body;

  if (!studySubjectId) {
    res.status(400).json({ success: false, message: 'studySubjectId is required' });
    return;
  }

  if (!reason) {
    res.status(400).json({ success: false, message: 'reason is required' });
    return;
  }

  // Only admins can skip validation
  const canSkipValidation = skipValidation && user.role === 'admin';

  const result = await dataLocksService.lockSubjectData(
    parseInt(studySubjectId),
    user.userId,
    reason,
    canSkipValidation
  );

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Unlock all data for a subject
 * DELETE /api/data-locks/subject/:studySubjectId
 * Body: { reason: string }
 */
export const unlockSubject = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studySubjectId } = req.params;
  const { reason } = req.body;

  if (!studySubjectId) {
    res.status(400).json({ success: false, message: 'studySubjectId is required' });
    return;
  }

  if (!reason) {
    res.status(400).json({ success: false, message: 'reason is required for unlocking' });
    return;
  }

  const result = await dataLocksService.unlockSubjectData(
    parseInt(studySubjectId),
    user.userId,
    reason
  );

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════
// EVENT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

/**
 * Lock all data for a study event (visit)
 * POST /api/data-locks/event/:studyEventId
 * Body: { reason: string, skipValidation?: boolean }
 */
export const lockEvent = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyEventId } = req.params;
  const { reason, skipValidation } = req.body;

  if (!studyEventId) {
    res.status(400).json({ success: false, message: 'studyEventId is required' });
    return;
  }

  if (!reason) {
    res.status(400).json({ success: false, message: 'reason is required' });
    return;
  }

  const canSkipValidation = skipValidation && user.role === 'admin';

  const result = await dataLocksService.lockEventData(
    parseInt(studyEventId),
    user.userId,
    reason,
    canSkipValidation
  );

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Unlock all data for a study event (visit)
 * DELETE /api/data-locks/event/:studyEventId
 * Body: { reason: string }
 */
export const unlockEvent = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyEventId } = req.params;
  const { reason } = req.body;

  if (!studyEventId) {
    res.status(400).json({ success: false, message: 'studyEventId is required' });
    return;
  }

  if (!reason) {
    res.status(400).json({ success: false, message: 'reason is required for unlocking' });
    return;
  }

  // Reuse the individual form unlock for each form in the event
  // For now, we'll use the subject unlock as a basis
  // TODO: Add specific event unlock to service
  res.status(501).json({ success: false, message: 'Event unlock not yet implemented' });
});

export default { 
  list, 
  lock, 
  unlock, 
  checkSubjectEligibility,
  checkEventEligibility,
  lockSubject,
  unlockSubject,
  lockEvent,
  unlockEvent
};
