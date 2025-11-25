/**
 * System Monitoring Routes
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import * as monitoringController from '../controllers/monitoring.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/stats', monitoringController.getStats);
router.get('/alerts', monitoringController.getAlerts);
router.get('/metrics', monitoringController.getMetrics);

export default router;
