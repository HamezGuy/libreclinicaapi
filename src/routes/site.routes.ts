/**
 * Site Routes
 *
 * Sites in LibreClinica are child studies (study records with parent_study_id set).
 * This provides a dedicated API for site management operations.
 */

import express from 'express';
import * as siteController from '../controllers/site.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, siteSchemas } from '../middleware/validation.middleware';

const router = express.Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════

router.get('/study/:studyId',       siteController.listByStudy);
router.get('/study/:studyId/stats', siteController.stats);
router.get('/:siteId',             siteController.get);
router.get('/:siteId/patients',    siteController.listPatients);
router.get('/:siteId/staff',       siteController.listStaff);

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS (role-restricted)
// ═══════════════════════════════════════════════════════════════════

router.post('/',                    requireRole('admin', 'data_manager'), validate({ body: siteSchemas.create }),       siteController.create);
router.put('/:siteId',             requireRole('admin', 'data_manager'), validate({ body: siteSchemas.update }),       siteController.update);
router.patch('/:siteId/status',    requireRole('admin'),                 validate({ body: siteSchemas.updateStatus }), siteController.updateStatus);
router.post('/transfer',           requireRole('admin', 'data_manager'), validate({ body: siteSchemas.transfer }),     siteController.transfer);
router.post('/:siteId/staff',      requireRole('admin', 'data_manager'), validate({ body: siteSchemas.assignStaff }), siteController.assignStaff);
router.delete('/:siteId/staff/:username', requireRole('admin', 'data_manager'),                                       siteController.removeStaff);

export default router;
