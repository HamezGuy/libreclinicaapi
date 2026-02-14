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
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';
import * as dataLocksController from '../controllers/data-locks.controller';

const router = express.Router();

router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
// LIST & QUERY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks - List all locked records
router.get('/', dataLocksController.list);

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY CHECK ENDPOINTS (No signature required - read only)
// ═══════════════════════════════════════════════════════════════════

// GET /api/data-locks/eligibility/subject/:studySubjectId
router.get('/eligibility/subject/:studySubjectId', 
  requireRole('monitor', 'data_manager', 'admin'),
  dataLocksController.checkSubjectEligibility
);

// GET /api/data-locks/eligibility/event/:studyEventId
router.get('/eligibility/event/:studyEventId',
  requireRole('monitor', 'data_manager', 'admin'),
  dataLocksController.checkEventEligibility
);

// ═══════════════════════════════════════════════════════════════════
// FORM-LEVEL LOCK/UNLOCK (Original functionality)
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks - Lock a single form (eventCrfId)
router.post('/', 
  requireRole('monitor', 'data_manager', 'admin'), 
  requireSignatureFor(SignatureMeanings.FORM_LOCK),
  dataLocksController.lock
);

// DELETE /api/data-locks/:eventCrfId - Unlock a single form
router.delete('/:eventCrfId', 
  requireRole('admin'), 
  requireSignatureFor('I authorize unlocking this form for editing'),
  dataLocksController.unlock
);

// ═══════════════════════════════════════════════════════════════════
// SUBJECT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/subject/:studySubjectId - Lock all subject data
router.post('/subject/:studySubjectId',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm that all data has been reviewed and is ready for locking'),
  dataLocksController.lockSubject
);

// DELETE /api/data-locks/subject/:studySubjectId - Unlock all subject data
router.delete('/subject/:studySubjectId',
  requireRole('admin'),
  requireSignatureFor('I authorize unlocking this subject data for editing'),
  dataLocksController.unlockSubject
);

// ═══════════════════════════════════════════════════════════════════
// EVENT-LEVEL LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/event/:studyEventId - Lock all event data
router.post('/event/:studyEventId',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm that all data for this visit has been reviewed and is ready for locking'),
  dataLocksController.lockEvent
);

// DELETE /api/data-locks/event/:studyEventId - Unlock all event data
router.delete('/event/:studyEventId',
  requireRole('admin'),
  requireSignatureFor('I authorize unlocking this visit data for editing'),
  dataLocksController.unlockEvent
);

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE (two-stage protection before lock)
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/freeze/:eventCrfId - Freeze a single form
router.post('/freeze/:eventCrfId',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm this form data is ready to be frozen'),
  dataLocksController.freeze
);

// DELETE /api/data-locks/freeze/:eventCrfId - Unfreeze a single form
router.delete('/freeze/:eventCrfId',
  requireRole('data_manager', 'admin'),
  requireSignatureFor('I authorize unfreezing this form for editing'),
  dataLocksController.unfreeze
);

// POST /api/data-locks/batch/freeze - Batch freeze multiple CRFs
router.post('/batch/freeze',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm these forms are ready to be frozen'),
  dataLocksController.batchFreeze
);

// ═══════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks/batch/lock - Batch lock multiple CRFs
router.post('/batch/lock',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor(SignatureMeanings.FORM_LOCK),
  dataLocksController.batchLock
);

// POST /api/data-locks/batch/unlock - Batch unlock multiple CRFs
router.post('/batch/unlock',
  requireRole('admin'),
  requireSignatureFor('I authorize unlocking these forms for editing'),
  dataLocksController.batchUnlock
);

// POST /api/data-locks/batch/sdv - Batch mark multiple CRFs as SDV verified
router.post('/batch/sdv',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I confirm source data verification of these forms'),
  dataLocksController.batchSDV
);

export default router;
