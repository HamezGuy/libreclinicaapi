/**
 * SDV (Source Data Verification) Routes
 * 
 * Provides endpoints for Source Data Verification in LibreClinica.
 * SDV is at the FORM level (event_crf), not field level.
 * 
 * 21 CFR Part 11 Compliance:
 * - SDV verification requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 * 
 * Key endpoints:
 * - GET /api/sdv - List SDV records with filters
 * - GET /api/sdv/stats - Get SDV statistics for a study
 * - GET /api/sdv/by-visit - Get SDV grouped by visit/event
 * - GET /api/sdv/:id - Get specific SDV record
 * - GET /api/sdv/:id/form-data - Get form data for SDV preview
 * - PUT /api/sdv/:id/verify - Verify an SDV item
 * - PUT /api/sdv/:id/unverify - Unverify an SDV item
 * - POST /api/sdv/bulk-verify - Bulk verify multiple items
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireEntityStudyAccess } from '../middleware/study-scope.middleware';
import { requirePart11 } from '../middleware/part11.middleware';
import { SIGNATURE_MEANINGS } from '@accura-trial/shared-types';
import { validate, sdvSchemas } from '../middleware/validation.middleware';
import * as sdvController from '../controllers/sdv.controller';

const router = express.Router();

router.use(authMiddleware);

// List and statistics (no signature required)
router.get('/', sdvController.list);
router.get('/stats', sdvController.getStats);
router.get('/by-visit', sdvController.getByVisit);
router.get('/subject/:subjectId', sdvController.getSubjectStatus);

// Individual record with form data preview (no signature required)
router.get('/:id', sdvController.get);
router.get('/:id/form-data',
  requireEntityStudyAccess('eventCrf', 'id'),
  sdvController.getFormData
);

// Verification actions (requires monitor or admin role + signature)
router.put('/:id/verify', 
  requireRole('monitor', 'admin'), 
  requireEntityStudyAccess('eventCrf', 'id'),
  requirePart11({ meaning: SIGNATURE_MEANINGS.VERIFY }),
  sdvController.verify
);
router.put('/:id/unverify', 
  requireRole('monitor', 'admin'), 
  requireEntityStudyAccess('eventCrf', 'id'),
  requirePart11({ meaning: 'I authorize removal of SDV verification' }),
  sdvController.unverify
);
router.post('/bulk-verify', 
  requireRole('monitor', 'admin'), 
  validate({ body: sdvSchemas.bulkVerify }),
  requirePart11({ meaning: SIGNATURE_MEANINGS.VERIFY }),
  sdvController.bulkVerify
);

export default router;
