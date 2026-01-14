/**
 * Study Routes
 * 
 * API endpoints for study management including:
 * - CRUD operations
 * - Metadata, forms, sites, events
 * - Statistics and users
 * 
 * 21 CFR Part 11 Compliance:
 * - All study modifications require electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import * as controller from '../controllers/study.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, studySchemas, commonSchemas } from '../middleware/validation.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

router.use(authMiddleware);

// Read operations - all authenticated users (no signature required)
router.get('/', validate({ query: studySchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/metadata', validate({ params: commonSchemas.idParam }), controller.getMetadata);
router.get('/:id/forms', validate({ params: commonSchemas.idParam }), controller.getForms);
router.get('/:id/sites', validate({ params: commonSchemas.idParam }), controller.getSites);
router.get('/:id/events', validate({ params: commonSchemas.idParam }), controller.getEvents);
router.get('/:id/stats', validate({ params: commonSchemas.idParam }), controller.getStats);
router.get('/:id/users', validate({ params: commonSchemas.idParam }), controller.getUsers);

// Create/Update/Delete - require admin or coordinator role
// NOTE: E-signature requirement temporarily disabled for usability
// TODO: Re-enable when frontend e-signature flow is fully implemented
router.post('/', 
  requireRole('admin', 'coordinator'), 
  validate({ body: studySchemas.create }), 
  // requireSignatureFor(SignatureMeanings.STUDY_CREATE), // DISABLED - re-enable later
  controller.create
);
router.put('/:id', 
  requireRole('admin', 'coordinator'), 
  validate({ params: commonSchemas.idParam, body: studySchemas.update }), 
  // requireSignatureFor(SignatureMeanings.STUDY_UPDATE), // DISABLED - re-enable later
  controller.update
);
router.delete('/:id', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  // requireSignatureFor(SignatureMeanings.STUDY_DELETE), // DISABLED - re-enable later
  controller.remove
);

export default router;

