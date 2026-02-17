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

// Get CRF completion statuses for a patient's visit instance (used by data entry UI)
router.get('/instance/:studyEventId/crfs/status', controller.getPatientEventCRFStatuses);

// Get ALL forms for a patient's visit (template forms + patient status in one call)
router.get('/instance/:studyEventId/visit-forms', controller.getVisitForms);

// Create/Update/Delete - require coordinator or admin role + signature
router.post('/', 
  requireRole('admin', 'data_manager'), 
  validate({ body: eventSchemas.create }), 
  requireSignatureFor(SignatureMeanings.EVENT_CREATE),
  controller.create
);
router.put('/:id', 
  requireRole('admin', 'data_manager'), 
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
  requireRole('data_manager', 'coordinator', 'investigator'), 
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
  requireRole('admin', 'data_manager'), 
  validate({ body: eventSchemas.assignCrf }),
  requireSignatureFor(SignatureMeanings.CRF_ASSIGN),
  controller.assignCrf
);

// Update CRF assignment settings (signature required)
router.put('/crf-assignment/:crfAssignmentId', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.updateEventCrf
);

// Remove CRF from event (signature required)
router.delete('/crf-assignment/:crfAssignmentId', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.removeCrf
);

// Reorder CRFs within an event (signature required)
router.put('/:eventId/crfs/reorder', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.reorderCrfs
);

// Bulk assign CRFs to event (signature required)
router.post('/:eventId/crfs/bulk', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor(SignatureMeanings.CRF_ASSIGN),
  controller.bulkAssignCrfs
);

// ============================================
// PATIENT-SPECIFIC VISIT/FORM ROUTES
// ============================================

// Assign form to a specific patient visit instance (does NOT modify template)
router.post('/instance/:studyEventId/crfs', 
  requireRole('admin', 'data_manager', 'coordinator'),
  validate({ body: eventSchemas.assignFormToPatientVisit }),
  controller.assignFormToPatientVisit
);

// Create an unscheduled visit on the fly for a patient
router.post('/unscheduled', 
  requireRole('admin', 'data_manager', 'coordinator', 'investigator'),
  validate({ body: eventSchemas.createUnscheduled }),
  controller.createUnscheduledVisit
);

// Get patient form snapshots for a visit
router.get('/instance/:studyEventId/form-snapshots', 
  controller.getPatientFormSnapshots
);

// Save patient form data to a snapshot
router.put('/patient-form/:patientEventFormId/data', 
  validate({ body: eventSchemas.savePatientFormData }),
  controller.savePatientFormData
);

// ============================================
// VERIFICATION / TEST QUERIES
// ============================================

// Compare study source-of-truth with patient copies (events, forms, snapshots)
router.get('/verify/subject/:subjectId',
  controller.verifyPatientFormIntegrity
);

// Repair missing patient_event_form snapshots
router.post('/verify/subject/:subjectId/repair',
  requireRole('admin', 'data_manager'),
  controller.repairMissingSnapshots
);

export default router;

