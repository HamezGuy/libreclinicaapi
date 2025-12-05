/**
 * SDV (Source Data Verification) Routes
 * 
 * Provides endpoints for Source Data Verification in LibreClinica.
 * SDV is at the FORM level (event_crf), not field level.
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
import * as sdvController from '../controllers/sdv.controller';

const router = express.Router();

router.use(authMiddleware);

// List and statistics
router.get('/', sdvController.list);
router.get('/stats', sdvController.getStats);
router.get('/by-visit', sdvController.getByVisit);
router.get('/subject/:subjectId', sdvController.getSubjectStatus);

// Individual record with form data preview
router.get('/:id', sdvController.get);
router.get('/:id/form-data', sdvController.getFormData);

// Verification actions (requires monitor or admin role)
router.put('/:id/verify', requireRole('monitor', 'admin'), sdvController.verify);
router.put('/:id/unverify', requireRole('monitor', 'admin'), sdvController.unverify);
router.post('/bulk-verify', requireRole('monitor', 'admin'), sdvController.bulkVerify);

export default router;
