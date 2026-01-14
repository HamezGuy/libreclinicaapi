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
  requireRole('monitor', 'coordinator', 'admin'),
  dataLocksController.checkSubjectEligibility
);

// GET /api/data-locks/eligibility/event/:studyEventId
router.get('/eligibility/event/:studyEventId',
  requireRole('monitor', 'coordinator', 'admin'),
  dataLocksController.checkEventEligibility
);

// ═══════════════════════════════════════════════════════════════════
// FORM-LEVEL LOCK/UNLOCK (Original functionality)
// ═══════════════════════════════════════════════════════════════════

// POST /api/data-locks - Lock a single form (eventCrfId)
router.post('/', 
  requireRole('monitor', 'coordinator', 'admin'), 
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
  requireRole('monitor', 'coordinator', 'admin'),
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
  requireRole('monitor', 'coordinator', 'admin'),
  requireSignatureFor('I confirm that all data for this visit has been reviewed and is ready for locking'),
  dataLocksController.lockEvent
);

// DELETE /api/data-locks/event/:studyEventId - Unlock all event data
router.delete('/event/:studyEventId',
  requireRole('admin'),
  requireSignatureFor('I authorize unlocking this visit data for editing'),
  dataLocksController.unlockEvent
);

export default router;
