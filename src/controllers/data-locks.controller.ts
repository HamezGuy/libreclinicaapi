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
import { logger } from '../config/logger';
import type { Part11Request } from '../middleware/part11.middleware';
import type { ApiResponse, LockEligibility, CasebookReadiness, SanitationReport, StudyLockStatus, LockHistory } from '@accura-trial/shared-types';

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

/**
 * Get lock/freeze status for a single form (event CRF)
 * GET /api/data-locks/status/:eventCrfId
 */
export const getRecordLockStatus = asyncHandler(async (req: Request, res: Response) => {
  const eventCrfId = parseInt(req.params.eventCrfId);
  if (isNaN(eventCrfId) || eventCrfId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }

  const result = await dataLocksService.getRecordLockStatus(eventCrfId);
  res.json({ success: true, data: result });
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

  const response: ApiResponse<LockEligibility> = { success: true, data: eligibility };
  res.json(response);
});

/**
 * Check if a study event's data is eligible for locking
 * GET /api/data-locks/eligibility/event/:studyEventId
 */
export const checkEventEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;
  const eligibility = await dataLocksService.checkEventLockEligibility(parseInt(studyEventId));

  const response: ApiResponse<LockEligibility> = { success: true, data: eligibility };
  res.json(response);
});

// ═══════════════════════════════════════════════════════════════════
// FORM-LEVEL LOCK/UNLOCK (Original functionality)
// ═══════════════════════════════════════════════════════════════════

/**
 * Lock a single form (event CRF)
 * POST /api/data-locks
 */
export const lock = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Data lock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to lock a form (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Data unlock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unlock a form (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Subject lock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to lock subject data (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Subject unlock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unlock subject data (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Event lock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to lock event data (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Event unlock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unlock event data (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Freeze attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to freeze a form (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Unfreeze attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unfreeze a form (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Batch freeze attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to batch freeze forms (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Batch lock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to batch lock forms (21 CFR Part 11 §11.50)' });
    return;
  }
  const user = (req as any).user;
  const { eventCrfIds, reason } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchLockRecords(eventCrfIds, user.userId, reason);
  res.json({ success: result.success, data: result });
});

/**
 * Batch unlock multiple CRF records
 * POST /api/data-locks/batch/unlock
 * Body: { eventCrfIds: number[] }
 */
export const batchUnlock = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Batch unlock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to batch unlock forms (21 CFR Part 11 §11.50)' });
    return;
  }
  const user = (req as any).user;
  const { eventCrfIds, reason } = req.body;

  if (!eventCrfIds?.length) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await dataLocksService.batchUnlockRecords(eventCrfIds, user.userId, reason);
  res.json({ success: result.success, data: result });
});

/**
 * Batch SDV multiple CRF records
 * POST /api/data-locks/batch/sdv
 * Body: { eventCrfIds: number[] }
 */
export const batchSDV = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Batch SDV attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required for batch SDV (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Unlock request review attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to review unlock requests (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const response: ApiResponse<SanitationReport> = { success: true, data: report };
  res.json(response);
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
  const response: ApiResponse<StudyLockStatus> = { success: true, data: status };
  res.json(response);
});

/**
 * POST /api/data-locks/study/:studyId
 * Lock the entire study dataset (admin + investigator dual e-sig enforced at route level).
 */
export const lockStudy = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Study lock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to lock study dataset (21 CFR Part 11 §11.50)' });
    return;
  }
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
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Study unlock attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unlock study dataset (21 CFR Part 11 §11.50)' });
    return;
  }
  const user = (req as any).user;
  const studyId = parseInt(req.params.studyId);
  const { reason } = req.body;

  const result = await dataLocksService.unlockStudy(studyId, user.userId, reason);
  res.status(result.success ? 200 : 400).json(result);
});

// ═══════════════════════════════════════════════════════════════════
// CASEBOOK READINESS
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/data-locks/readiness/subject/:id
 */
export const getSubjectReadiness = asyncHandler(async (req: Request, res: Response) => {
  const studySubjectId = parseInt(req.params.id);
  if (isNaN(studySubjectId) || studySubjectId <= 0) {
    res.status(400).json({ success: false, message: 'Subject ID must be a positive integer' });
    return;
  }

  const readiness = await dataLocksService.getSubjectCasebookReadiness(studySubjectId);
  const response: ApiResponse<CasebookReadiness> = { success: true, data: readiness };
  res.json(response);
});

/**
 * GET /api/data-locks/readiness/study/:studyId
 */
export const getStudyReadiness = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  if (isNaN(studyId) || studyId <= 0) {
    res.status(400).json({ success: false, message: 'studyId must be a positive integer' });
    return;
  }

  const readiness = await dataLocksService.getStudyCasebookReadiness(studyId);
  const response: ApiResponse<typeof readiness> = { success: true, data: readiness };
  res.json(response);
});

// ═══════════════════════════════════════════════════════════════════
// LOCK AUDIT HISTORY
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/data-locks/history/:eventCrfId
 */
export const getFormLockHistory = asyncHandler(async (req: Request, res: Response) => {
  const eventCrfId = parseInt(req.params.eventCrfId);
  if (isNaN(eventCrfId) || eventCrfId <= 0) {
    res.status(400).json({ success: false, message: 'eventCrfId must be a positive integer' });
    return;
  }

  const history = await dataLocksService.getFormLockHistory(eventCrfId);
  const response: ApiResponse<LockHistory[]> = { success: true, data: history };
  res.json(response);
});

/**
 * GET /api/data-locks/history/subject/:id
 */
export const getSubjectLockHistory = asyncHandler(async (req: Request, res: Response) => {
  const studySubjectId = parseInt(req.params.id);
  if (isNaN(studySubjectId) || studySubjectId <= 0) {
    res.status(400).json({ success: false, message: 'Subject ID must be a positive integer' });
    return;
  }

  const history = await dataLocksService.getSubjectLockHistory(studySubjectId);
  const response: ApiResponse<LockHistory[]> = { success: true, data: history };
  res.json(response);
});

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE SUBJECT-LEVEL
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/data-locks/freeze/subject/:id
 */
export const freezeSubject = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Subject freeze attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to freeze subject data (21 CFR Part 11 §11.50)' });
    return;
  }
  const user = (req as any).user;
  const studySubjectId = parseInt(req.params.id);
  const { reason } = req.body;

  const result = await dataLocksService.freezeSubjectData(studySubjectId, user.userId, reason);
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * DELETE /api/data-locks/freeze/subject/:id
 */
export const unfreezeSubject = asyncHandler(async (req: Request, res: Response) => {
  const p11 = req as Part11Request;
  if (!p11.signatureVerified) {
    logger.warn('Subject unfreeze attempted without verified e-signature', { userId: p11.user?.userId, path: req.path });
    res.status(403).json({ success: false, message: 'Electronic signature required to unfreeze subject data (21 CFR Part 11 §11.50)' });
    return;
  }
  const user = (req as any).user;
  const studySubjectId = parseInt(req.params.id);
  const { reason } = req.body;

  if (!reason) {
    res.status(400).json({ success: false, message: 'Reason is required for unfreezing' });
    return;
  }

  const result = await dataLocksService.unfreezeSubjectData(studySubjectId, user.userId, reason);
  res.status(result.success ? 200 : 400).json(result);
});

// ═══════════════════════════════════════════════════════════════════
// LIST FROZEN RECORDS
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/data-locks/freeze?studyId=X
 */
export const listFrozenRecords = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, page, limit } = req.query;

  const result = await dataLocksService.getFrozenRecords({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

export default { 
  list,
  getRecordLockStatus,
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
  unlockStudy,
  getSubjectReadiness,
  getStudyReadiness,
  getFormLockHistory,
  getSubjectLockHistory,
  freezeSubject,
  unfreezeSubject,
  listFrozenRecords
};
