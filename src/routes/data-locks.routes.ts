/**
 * Data Locks Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as dataLocksController from '../controllers/data-locks.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', dataLocksController.list);
router.post('/', requireRole('monitor', 'coordinator', 'admin'), dataLocksController.lock);
router.delete('/:eventCrfId', requireRole('admin'), dataLocksController.unlock);

export default router;
