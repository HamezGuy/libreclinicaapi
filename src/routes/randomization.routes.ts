/**
 * Randomization Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as randomizationController from '../controllers/randomization.controller';

const router = express.Router();

router.use(authMiddleware);

// List and statistics
router.get('/', randomizationController.list);
router.get('/stats', randomizationController.getStats);
router.get('/groups/:studyId', randomizationController.getGroups);
router.get('/unblinding-events', randomizationController.getUnblindingEvents);

// Subject-specific
router.get('/subject/:subjectId', randomizationController.getSubjectRandomization);
router.get('/subject/:subjectId/can-randomize', randomizationController.canRandomize);

// Actions
router.post('/', requireRole('investigator', 'coordinator', 'admin'), randomizationController.create);
router.delete('/subject/:subjectId', requireRole('admin'), randomizationController.remove);
router.post('/subject/:subjectId/unblind', requireRole('investigator', 'admin'), randomizationController.unblind);

export default router;
