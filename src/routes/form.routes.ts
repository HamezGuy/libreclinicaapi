/**
 * Form Routes
 * 
 * CRUD operations for form templates (CRFs) and form data
 * 
 * 21 CFR Part 11 Compliance:
 * - All data modifications require electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import * as controller from '../controllers/form.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, formSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

router.use(authMiddleware);

// Form templates (CRFs) - read operations (no signature required)
router.get('/', controller.list);
router.get('/by-study', controller.getByStudy);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:crfId/metadata', controller.getMetadata);

// Version history (no signature required - read only)
router.get('/:id/versions', validate({ params: commonSchemas.idParam }), controller.getVersions);

// Form templates (CRFs) - write operations (signature required per §11.50)
router.post('/', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor(SignatureMeanings.CRF_CREATE),
  controller.create
);
router.put('/:id', 
  requireRole('admin', 'coordinator'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.update
);
router.delete('/:id', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.remove
);

// ============================================================================
// 21 CFR PART 11 ARCHIVE OPERATIONS
// Forms are NEVER permanently deleted - they are archived for compliance
// ============================================================================

// Get archived forms (admin only)
router.get('/archived', 
  requireRole('admin'),
  controller.getArchivedForms
);

// Archive a form (admin only) - replaces delete for compliance
router.post('/:id/archive', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.archive
);

// Restore an archived form (admin only)
router.post('/:id/restore', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.restore
);

// Template Forking/Versioning - write operations (signature required per §11.50)
// Create new version of existing CRF
router.post('/:id/versions', 
  requireRole('admin', 'coordinator'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_CREATE),
  controller.createVersion
);

// Fork (copy) entire CRF to new independent form
router.post('/:id/fork', 
  requireRole('admin', 'coordinator'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_CREATE),
  controller.fork
);

// Form data operations (signature required for data entry per §11.50)
router.post('/save', 
  requireRole('data_entry', 'investigator', 'coordinator'), 
  soapRateLimiter, 
  validate({ body: formSchemas.saveData }), 
  requireSignatureFor(SignatureMeanings.FORM_DATA_SAVE),
  controller.saveData
);
router.get('/data/:eventCrfId', controller.getData);
router.get('/status/:eventCrfId', controller.getStatus);

// Single field update with validation (for real-time validation on field change)
// This endpoint:
// 1. Validates the field value against all applicable rules
// 2. Optionally creates queries for validation failures
// 3. Updates the field data if validation passes (or if validateOnly=false)
router.patch('/field/:eventCrfId', 
  requireRole('data_entry', 'investigator', 'coordinator'),
  controller.updateField
);

// Validate only (no data update) - for real-time validation feedback
router.post('/validate-field/:eventCrfId',
  requireRole('data_entry', 'investigator', 'coordinator'),
  controller.validateField
);

export default router;

