/**
 * Event Routes
 * 
 * Study Event (Phase) management routes
 * Includes CRF (Template) assignment to events
 * 
 * 21 CFR Part 11 Compliance:
 * - Event creation/modification requires electronic signature (§11.50)
 * - CRF assignment requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import * as controller from '../controllers/event.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, eventSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

router.use(authMiddleware);

// Root route - returns events filtered by query params (for frontend compatibility)
router.get('/', controller.listEvents);

// Read operations - all authenticated users (no signature required)
router.get('/study/:studyId', validate({ params: commonSchemas.studyIdParam }), controller.getStudyEvents);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.getEvent);
router.get('/:id/crfs', validate({ params: commonSchemas.idParam }), controller.getEventCRFs);
router.get('/subject/:subjectId', validate({ params: commonSchemas.subjectIdParam }), controller.getSubjectEvents);

// Get patient's event_crfs for a specific study_event instance (editable copies)
router.get('/instance/:studyEventId/crfs', controller.getPatientEventCRFs);

// Create/Update/Delete - require coordinator or admin role + signature
router.post('/', 
  requireRole('admin', 'coordinator'), 
  validate({ body: eventSchemas.create }), 
  requireSignatureFor(SignatureMeanings.EVENT_CREATE),
  controller.create
);
router.put('/:id', 
  requireRole('admin', 'coordinator'), 
  validate({ params: commonSchemas.idParam, body: eventSchemas.update }), 
  requireSignatureFor(SignatureMeanings.EVENT_UPDATE),
  controller.update
);
router.delete('/:id', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.EVENT_DELETE),
  controller.remove
);

// Schedule event - require data entry or coordinator role + signature
router.post('/schedule', 
  requireRole('coordinator', 'data_entry', 'investigator'), 
  soapRateLimiter, 
  validate({ body: eventSchemas.schedule }), 
  requireSignatureFor(SignatureMeanings.EVENT_SCHEDULE),
  controller.scheduleEvent
);

// ============================================
// EVENT CRF ASSIGNMENT ROUTES
// ============================================

// Get available CRFs that can be assigned to an event (no signature required)
router.get('/study/:studyId/event/:eventId/available-crfs', controller.getAvailableCrfs);

// Assign CRF to event (signature required)
router.post('/:eventId/crfs', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_ASSIGN),
  controller.assignCrf
);

// Update CRF assignment settings (signature required)
router.put('/crf-assignment/:crfAssignmentId', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.updateEventCrf
);

// Remove CRF from event (signature required)
router.delete('/crf-assignment/:crfAssignmentId', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.removeCrf
);

// Reorder CRFs within an event (signature required)
router.put('/:eventId/crfs/reorder', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.reorderCrfs
);

// Bulk assign CRFs to event (signature required)
router.post('/:eventId/crfs/bulk', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_ASSIGN),
  controller.bulkAssignCrfs
);

export default router;

