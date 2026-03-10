/**
 * Data Locks Controller
 * 
 * Endpoints for data locking/unlocking with validation
 * Supports locking at form, event, and subject levels
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dataLocksService from '../services/database/data-locks.service';
import * as unlockRequestsService from '../services/database/unlock-requests.service';

// ═══════════════════════════════════════════════════════════════════
// LIST & QUERY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, page, limit } = req.query;

  const result = await dataLocksService.getLockedRecords({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    subjectId: subjectId ? parseInt(subjectId as string) : undefined,
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
  const { eventCrfId, reason } = req.body;

  const result = await dataLocksService.lockRecord(eventCrfId, user.userId, reason);

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Unlock a single form (event CRF)
 * DELETE /api/data-locks/:eventCrfId
 */
export const unlock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId } = req.params;
  const { reason } = req.body;

  const result = await dataLocksService.unlockRecord(parseInt(eventCrfId), user.userId, reason);

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
  const canSkipValidation = skipValidation && user.role === 'admin';

  const result = await dataLocksService.lockSubjectData(
    parseInt(studySubjectId), user.userId, reason, canSkipValidation
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

  const result = await dataLocksService.unlockSubjectData(
    parseInt(studySubjectId), user.userId, reason
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
  const canSkipValidation = skipValidation && user.role === 'admin';

  const result = await dataLocksService.lockEventData(
    parseInt(studyEventId), user.userId, reason, canSkipValidation
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

  const result = await dataLocksService.unlockEventData(
    parseInt(studyEventId), user.userId, reason
  );
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE
// ═══════════════════════════════════════════════════════════════════

/**
 * Freeze a single CRF record
 * POST /api/data-locks/freeze/:eventCrfId
 */
export const freeze = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const eventCrfId = parseInt(req.params.eventCrfId);

  const result = await dataLocksService.freezeRecord(eventCrfId, user.userId);
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

/**
 * Unfreeze a single CRF record
 * DELETE /api/data-locks/freeze/:eventCrfId
 */
export const unfreeze = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const eventCrfId = parseInt(req.params.eventCrfId);
  const { reason } = req.body;

  if (!reason) {
    res.status(400).json({ success: false, message: 'Reason is required for unfreezing' });
    return;
  }

  const result = await dataLocksService.unfreezeRecord(eventCrfId, user.userId, reason);
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

/**
 * Batch freeze multiple CRF records
 * POST /api/data-locks/batch/freeze
 */
export const batchFreeze = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfIds } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchFreezeRecords(eventCrfIds, user.userId);
  res.json({ success: result.success, data: result });
});

// ═══════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Batch lock multiple CRF records
 * POST /api/data-locks/batch/lock
 * Body: { eventCrfIds: number[] }
 */
export const batchLock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfIds } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchLockRecords(eventCrfIds, user.userId);
  res.json({ success: result.success, data: result });
});

/**
 * Batch unlock multiple CRF records
 * POST /api/data-locks/batch/unlock
 * Body: { eventCrfIds: number[] }
 */
export const batchUnlock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfIds } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchUnlockRecords(eventCrfIds, user.userId);
  res.json({ success: result.success, data: result });
});

/**
 * Batch SDV multiple CRF records
 * POST /api/data-locks/batch/sdv
 * Body: { eventCrfIds: number[] }
 */
export const batchSDV = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfIds } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchSDV(eventCrfIds, user.userId);
  res.json({ success: result.success, data: result });
});

// ═══════════════════════════════════════════════════════════════════
// UNLOCK REQUEST WORKFLOW
// ═══════════════════════════════════════════════════════════════════

/**
 * List unlock requests
 * GET /api/data-locks/unlock-requests
 */
export const listUnlockRequests = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status, page, limit } = req.query;
  const user = (req as any).user;

  const filters: any = {
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  };
  if (studyId) filters.studyId = parseInt(studyId as string);
  if (status)  filters.status  = status as string;

  // Non-admins can only see their own requests
  const elevatedRoles = ['admin', 'data_manager', 'monitor'];
  if (!elevatedRoles.includes(user.role?.toLowerCase())) {
    filters.requestedById = user.userId;
  }

  const result = await unlockRequestsService.getUnlockRequests(filters);
  res.json(result);
});

/**
 * Create an unlock request
 * POST /api/data-locks/unlock-requests
 */
export const createUnlockRequest = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId, studySubjectId, studyId, reason, priority } = req.body;

  const result = await unlockRequestsService.createUnlockRequest(
    { eventCrfId, studySubjectId, studyId, reason, priority },
    user.userId
  );
  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Review (approve or reject) an unlock request
 * PUT /api/data-locks/unlock-requests/:requestId/review
 */
export const reviewUnlockRequest = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const requestId = parseInt(req.params.requestId);
  const { action, reviewNotes } = req.body;

  const result = await unlockRequestsService.reviewUnlockRequest(
    requestId, action, reviewNotes || '', user.userId
  );
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Cancel a pending unlock request
 * DELETE /api/data-locks/unlock-requests/:requestId
 */
export const cancelUnlockRequest = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const requestId = parseInt(req.params.requestId);

  const result = await unlockRequestsService.cancelUnlockRequest(
    requestId, user.userId, user.role
  );
  res.status(result.success ? 200 : 400).json(result);
});

// ═══════════════════════════════════════════════════════════════════
// DATA SANITATION
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/data-locks/sanitation/:studyId
 * Study-wide data quality snapshot used on the Data Sanitation tab.
 */
export const getSanitationReport = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  if (isNaN(studyId) || studyId <= 0) {
    res.status(400).json({ success: false, message: 'studyId must be a positive integer' });
    return;
  }

  const report = await dataLocksService.getStudySanitationReport(studyId);
  res.json({ success: true, data: report });
});

/**
 * GET /api/data-locks/sanitation/:studyId/subjects
 * Per-subject breakdown for the sanitation panel table.
 */
export const getSanitationSubjects = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const page  = parseInt(req.query.page  as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;

  if (isNaN(studyId) || studyId <= 0) {
    res.status(400).json({ success: false, message: 'studyId must be a positive integer' });
    return;
  }

  const result = await dataLocksService.getSanitationSubjects(studyId, page, limit);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════
// STUDY-LEVEL LOCK
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/data-locks/study/:studyId/status
 */
export const getStudyLockStatus = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const status = await dataLocksService.getStudyLockStatus(studyId);
  res.json({ success: true, data: status });
});

/**
 * POST /api/data-locks/study/:studyId
 * Lock the entire study dataset (admin + investigator dual e-sig enforced at route level).
 */
export const lockStudy = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const studyId = parseInt(req.params.studyId);
  const { reason } = req.body;

  const result = await dataLocksService.lockStudy(studyId, user.userId, reason);
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * DELETE /api/data-locks/study/:studyId
 * Unlock the study dataset (admin only).
 */
export const unlockStudy = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const studyId = parseInt(req.params.studyId);
  const { reason } = req.body;

  const result = await dataLocksService.unlockStudy(studyId, user.userId, reason);
  res.status(result.success ? 200 : 400).json(result);
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
  unlockEvent,
  freeze,
  unfreeze,
  batchFreeze,
  batchLock,
  batchUnlock,
  batchSDV,
  listUnlockRequests,
  createUnlockRequest,
  reviewUnlockRequest,
  cancelUnlockRequest,
  getSanitationReport,
  getSanitationSubjects,
  getStudyLockStatus,
  lockStudy,
  unlockStudy
};
