/**
 * Data Locks Controller
 * 
 * Endpoints for data locking/unlocking with validation
 * Supports locking at form, event, and subject levels
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dataLocksService from '../services/database/data-locks.service';
import { pool } from '../config/database';

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

  // Unlock all forms in this event
  try {
    const eventCrfResult = await pool.query(
      `SELECT event_crf_id FROM event_crf WHERE study_event_id = $1 AND status_id = 6`,
      [parseInt(studyEventId)]
    );

    let unlocked = 0;
    for (const row of eventCrfResult.rows) {
      const result = await dataLocksService.unlockRecord(row.event_crf_id, user.userId);
      if (result.success) unlocked++;
    }

    // Audit
    await pool.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (NOW(), 'study_event', $1, $2, 'Event Data Unlocked', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [user.userId, parseInt(studyEventId), reason]);

    res.json({ success: true, message: `Unlocked ${unlocked} forms for event`, data: { unlocked } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
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
  batchSDV
};
