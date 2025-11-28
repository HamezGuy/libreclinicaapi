/**
 * SDV (Source Data Verification) Routes
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
router.get('/:id', sdvController.get);

// Verification actions
router.put('/:id/verify', requireRole('monitor', 'admin'), sdvController.verify);
router.put('/:id/unverify', requireRole('monitor', 'admin'), sdvController.unverify);
router.post('/bulk-verify', requireRole('monitor', 'admin'), sdvController.bulkVerify);

export default router;
