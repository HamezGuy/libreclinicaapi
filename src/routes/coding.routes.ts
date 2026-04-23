/**
 * Medical Coding Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as codingController from '../controllers/coding.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', codingController.list);
router.post('/', requireRole('admin', 'data_manager', 'coordinator'), codingController.code);

export default router;
