/**
 * Medical Coding Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import * as codingController from '../controllers/coding.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', codingController.list);
router.post('/', codingController.code);

export default router;
