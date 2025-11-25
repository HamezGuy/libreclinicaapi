/**
 * Randomization Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as randomizationController from '../controllers/randomization.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', randomizationController.list);
router.post('/', requireRole('investigator', 'coordinator', 'admin'), randomizationController.create);
router.get('/groups/:studyId', randomizationController.getGroups);

export default router;
