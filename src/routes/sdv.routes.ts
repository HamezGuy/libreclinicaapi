/**
 * SDV (Source Data Verification) Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as sdvController from '../controllers/sdv.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', sdvController.list);
router.get('/:id', sdvController.get);
router.put('/:id/verify', requireRole('monitor', 'admin'), sdvController.verify);

export default router;
