/**
 * Data Locks Routes
 * 
 * 21 CFR Part 11 Compliance:
 * - Locking/unlocking data requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 * - Validation ensures all queries are closed and forms complete before locking
 * 
 * Lock Levels:
 * - Form: Individual event CRF (original functionality)
 * - Event: All forms for a study event/visit
 * - Subject: All forms for a subject across all events
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireEntityStudyAccess } from '../middleware/study-scope.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';
import { validate, dataLockSchemas, commonSchemas } from '../middleware/validation.middleware';
import * as dataLocksController from '../controllers/data-locks.controller';

const router = express.Router();

router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
// LIST & QUERY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks - List all locked records
router.get('/', dataLocksController.list);

// ═══════════════════════════════════════════════════════════════════
// CASEBOOK READINESS ENDPOINTS (Read-only)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/readiness/subject/:id - Casebook readiness for a subject
router.get('/readiness/subject/:id',
  requireRole('monitor', 'data_manager', 'admin'),
  dataLocksController.getSubjectReadiness
);

// GET /api/data-locks/readiness/study/:studyId - Study-wide casebook readiness
router.get('/readiness/study/:studyId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: commonSchemas.studyIdParam }),
  dataLocksController.getStudyReadiness
);

// ═══════════════════════════════════════════════════════════════════
// LOCK AUDIT HISTORY ENDPOINTS (Read-only)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/history/subject/:id - Lock history for all subject forms
router.get('/history/subject/:id',
  requireRole('monitor', 'data_manager', 'admin', 'investigator'),
  dataLocksController.getSubjectLockHistory
);

// GET /api/data-locks/history/:eventCrfId - Lock history for a single form
router.get('/history/:eventCrfId',
  requireRole('monitor', 'data_manager', 'admin', 'investigator'),
  validate({ params: dataLockSchemas.eventCrfIdParam }),
  dataLocksController.getFormLockHistory
);

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY CHECK ENDPOINTS (No signature required - read only)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/eligibility/subject/:studySubjectId
router.get('/eligibility/subject/:studySubjectId', 
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: dataLockSchemas.studySubjectIdParam }),
  dataLocksController.checkSubjectEligibility
);

// GET /api/data-locks/eligibility/event/:studyEventId
router.get('/eligibility/event/:studyEventId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: dataLockSchemas.studyEventIdParam }),
  dataLocksController.checkEventEligibility
);

// ═══════════════════════════════════════════════════════════════════
// FORM-LEVEL LOCK/UNLOCK (Original functionality)
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks - Lock a single form (eventCrfId)
router.post('/', 
  requireRole('monitor', 'data_manager', 'admin'), 
  validate({ body: dataLockSchemas.lock }),
  requireEntityStudyAccess('eventCrf', 'eventCrfId'),
  requireSignatureFor(SignatureMeanings.FORM_LOCK),
  dataLocksController.lock
);

// DELETE /api/data-locks/:eventCrfId - Unlock a single form
// Deprecated: prefer POST /:eventCrfId/unlock — DELETE with body is unreliable through proxies/CDNs
router.delete('/:eventCrfId', 
  requireRole('admin'), 
  validate({ params: dataLockSchemas.eventCrfIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('eventCrf', 'eventCrfId'),
  requireSignatureFor('I authorize unlocking this form for editing'),
  dataLocksController.unlock
);

// POST /api/data-locks/:eventCrfId/unlock - Unlock a single form (proxy-safe alternative)
router.post('/:eventCrfId/unlock',
  requireRole('admin'),
  validate({ params: dataLockSchemas.eventCrfIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('eventCrf', 'eventCrfId'),
  requireSignatureFor('I authorize unlocking this form for editing'),
  dataLocksController.unlock
);

// ═══════════════════════════════════════════════════════════════════
// SUBJECT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/subject/:studySubjectId - Lock all subject data
router.post('/subject/:studySubjectId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: dataLockSchemas.studySubjectIdParam, body: dataLockSchemas.lockSubject }),
  requireEntityStudyAccess('studySubject', 'studySubjectId'),
  requireSignatureFor('I confirm that all data has been reviewed and is ready for locking'),
  dataLocksController.lockSubject
);

// DELETE /api/data-locks/subject/:studySubjectId - Unlock all subject data
// Deprecated: prefer POST /subject/:studySubjectId/unlock — DELETE with body is unreliable through proxies/CDNs
router.delete('/subject/:studySubjectId',
  requireRole('admin'),
  validate({ params: dataLockSchemas.studySubjectIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('studySubject', 'studySubjectId'),
  requireSignatureFor('I authorize unlocking this subject data for editing'),
  dataLocksController.unlockSubject
);

// POST /api/data-locks/subject/:studySubjectId/unlock - Unlock all subject data (proxy-safe alternative)
router.post('/subject/:studySubjectId/unlock',
  requireRole('admin'),
  validate({ params: dataLockSchemas.studySubjectIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('studySubject', 'studySubjectId'),
  requireSignatureFor('I authorize unlocking this subject data for editing'),
  dataLocksController.unlockSubject
);

// ═══════════════════════════════════════════════════════════════════
// EVENT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/event/:studyEventId - Lock all event data
router.post('/event/:studyEventId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: dataLockSchemas.studyEventIdParam, body: dataLockSchemas.lockEvent }),
  requireEntityStudyAccess('studyEvent', 'studyEventId'),
  requireSignatureFor('I confirm that all data for this visit has been reviewed and is ready for locking'),
  dataLocksController.lockEvent
);

// DELETE /api/data-locks/event/:studyEventId - Unlock all event data
// Deprecated: prefer POST /event/:studyEventId/unlock — DELETE with body is unreliable through proxies/CDNs
router.delete('/event/:studyEventId',
  requireRole('admin'),
  validate({ params: dataLockSchemas.studyEventIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('studyEvent', 'studyEventId'),
  requireSignatureFor('I authorize unlocking this visit data for editing'),
  dataLocksController.unlockEvent
);

// POST /api/data-locks/event/:studyEventId/unlock - Unlock all event data (proxy-safe alternative)
router.post('/event/:studyEventId/unlock',
  requireRole('admin'),
  validate({ params: dataLockSchemas.studyEventIdParam, body: dataLockSchemas.unlockBody }),
  requireEntityStudyAccess('studyEvent', 'studyEventId'),
  requireSignatureFor('I authorize unlocking this visit data for editing'),
  dataLocksController.unlockEvent
);

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE (two-stage protection before lock)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/freeze?studyId=X - List frozen records
router.get('/freeze',
  requireRole('monitor', 'data_manager', 'admin'),
  dataLocksController.listFrozenRecords
);

// POST /api/data-locks/freeze/subject/:id - Freeze all subject data
router.post('/freeze/subject/:id',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm this subject data is ready to be frozen'),
  dataLocksController.freezeSubject
);

// DELETE /api/data-locks/freeze/subject/:id - Unfreeze all subject data
// Deprecated: prefer POST /freeze/subject/:id/unfreeze — DELETE with body is unreliable through proxies/CDNs
router.delete('/freeze/subject/:id',
  requireRole('data_manager', 'admin'),
  requireSignatureFor('I authorize unfreezing this subject data for editing'),
  dataLocksController.unfreezeSubject
);

// POST /api/data-locks/freeze/subject/:id/unfreeze - Unfreeze all subject data (proxy-safe alternative)
router.post('/freeze/subject/:id/unfreeze',
  requireRole('data_manager', 'admin'),
  requireSignatureFor('I authorize unfreezing this subject data for editing'),
  dataLocksController.unfreezeSubject
);

// POST /api/data-locks/freeze/:eventCrfId - Freeze a single form
router.post('/freeze/:eventCrfId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: dataLockSchemas.eventCrfIdParam, body: dataLockSchemas.freeze }),
  requireSignatureFor('I confirm this form data is ready to be frozen'),
  dataLocksController.freeze
);

// DELETE /api/data-locks/freeze/:eventCrfId - Unfreeze a single form
// Deprecated: prefer POST /freeze/:eventCrfId/unfreeze — DELETE with body is unreliable through proxies/CDNs
router.delete('/freeze/:eventCrfId',
  requireRole('data_manager', 'admin'),
  validate({ params: dataLockSchemas.eventCrfIdParam, body: dataLockSchemas.unfreeze }),
  requireSignatureFor('I authorize unfreezing this form for editing'),
  dataLocksController.unfreeze
);

// POST /api/data-locks/freeze/:eventCrfId/unfreeze - Unfreeze a single form (proxy-safe alternative)
router.post('/freeze/:eventCrfId/unfreeze',
  requireRole('data_manager', 'admin'),
  validate({ params: dataLockSchemas.eventCrfIdParam, body: dataLockSchemas.unfreeze }),
  requireSignatureFor('I authorize unfreezing this form for editing'),
  dataLocksController.unfreeze
);

// POST /api/data-locks/batch/freeze - Batch freeze multiple CRFs
router.post('/batch/freeze',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: dataLockSchemas.batchIds }),
  requireSignatureFor('I confirm these forms are ready to be frozen'),
  dataLocksController.batchFreeze
);

// ═══════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/batch/lock - Batch lock multiple CRFs
router.post('/batch/lock',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: dataLockSchemas.batchIds }),
  requireSignatureFor(SignatureMeanings.FORM_LOCK),
  dataLocksController.batchLock
);

// POST /api/data-locks/batch/unlock - Batch unlock multiple CRFs
router.post('/batch/unlock',
  requireRole('admin'),
  validate({ body: dataLockSchemas.batchIds }),
  requireSignatureFor('I authorize unlocking these forms for editing'),
  dataLocksController.batchUnlock
);

// POST /api/data-locks/batch/sdv - Batch mark multiple CRFs as SDV verified
router.post('/batch/sdv',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: dataLockSchemas.batchIds }),
  requireSignatureFor('I confirm source data verification of these forms'),
  dataLocksController.batchSDV
);

// ═══════════════════════════════════════════════════════════════════
// UNLOCK REQUEST WORKFLOW
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/unlock-requests - List requests (admin/DM see all; others see own)
router.get('/unlock-requests',
  dataLocksController.listUnlockRequests
);

// POST /api/data-locks/unlock-requests - Submit an unlock request
router.post('/unlock-requests',
  validate({ body: dataLockSchemas.createUnlockRequest }),
  dataLocksController.createUnlockRequest
);

// PUT /api/data-locks/unlock-requests/:requestId/review - Approve or reject (admin/DM + e-sig)
router.put('/unlock-requests/:requestId/review',
  requireRole('admin', 'data_manager'),
  validate({ params: dataLockSchemas.requestIdParam, body: dataLockSchemas.reviewUnlockRequest }),
  requireSignatureFor('I authorize this unlock request decision'),
  dataLocksController.reviewUnlockRequest
);

// DELETE /api/data-locks/unlock-requests/:requestId - Cancel a pending request
router.delete('/unlock-requests/:requestId',
  validate({ params: dataLockSchemas.requestIdParam }),
  dataLocksController.cancelUnlockRequest
);

// ═══════════════════════════════════════════════════════════════════
// DATA SANITATION (Pre-lock quality review)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/sanitation/:studyId - Study-wide data quality snapshot
router.get('/sanitation/:studyId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: commonSchemas.studyIdParam }),
  dataLocksController.getSanitationReport
);

// GET /api/data-locks/sanitation/:studyId/subjects - Per-subject breakdown
router.get('/sanitation/:studyId/subjects',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: commonSchemas.studyIdParam }),
  dataLocksController.getSanitationSubjects
);

// ═══════════════════════════════════════════════════════════════════
// STUDY-LEVEL LOCK
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/study/:studyId/status - Get study lock status
router.get('/study/:studyId/status',
  requireRole('monitor', 'data_manager', 'admin', 'investigator'),
  validate({ params: commonSchemas.studyIdParam }),
  dataLocksController.getStudyLockStatus
);

// POST /api/data-locks/study/:studyId - Lock the entire study dataset (dual sig)
router.post('/study/:studyId',
  requireRole('admin', 'investigator'),
  validate({ params: commonSchemas.studyIdParam, body: dataLockSchemas.lockStudy }),
  requireSignatureFor('I authorize the final lock of this study dataset'),
  dataLocksController.lockStudy
);

// DELETE /api/data-locks/study/:studyId - Unlock the study dataset (admin only)
// Deprecated: prefer POST /study/:studyId/unlock — DELETE with body is unreliable through proxies/CDNs
router.delete('/study/:studyId',
  requireRole('admin'),
  validate({ params: commonSchemas.studyIdParam, body: dataLockSchemas.unlockBody }),
  requireSignatureFor('I authorize unlocking this study dataset'),
  dataLocksController.unlockStudy
);

// POST /api/data-locks/study/:studyId/unlock - Unlock the study dataset (proxy-safe alternative)
router.post('/study/:studyId/unlock',
  requireRole('admin'),
  validate({ params: commonSchemas.studyIdParam, body: dataLockSchemas.unlockBody }),
  requireSignatureFor('I authorize unlocking this study dataset'),
  dataLocksController.unlockStudy
);

export default router;
