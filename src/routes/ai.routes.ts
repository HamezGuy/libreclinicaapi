/**
 * AI Assistant Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import * as aiController from '../controllers/ai.controller';

const router = express.Router();

router.use(authMiddleware);

router.post('/chat', aiController.chat);
router.get('/history', aiController.getHistory);
router.delete('/history', aiController.clearHistory);

export default router;
