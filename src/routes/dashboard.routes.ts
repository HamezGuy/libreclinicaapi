/**
 * Dashboard Routes
 */

import express from 'express';
import * as controller from '../controllers/dashboard.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate, dashboardSchemas } from '../middleware/validation.middleware';

const router = express.Router();

router.use(authMiddleware);

// Summary endpoint - returns combined stats (alias for frontend compatibility)
router.get('/summary', controller.getSummary);
router.get('/stats', controller.getStats);

router.get('/enrollment', validate({ query: dashboardSchemas.enrollment }), controller.getEnrollment);
router.get('/completion', validate({ query: dashboardSchemas.completion }), controller.getCompletion);
router.get('/queries', validate({ query: dashboardSchemas.queries }), controller.getQueries);
router.get('/activity', validate({ query: dashboardSchemas.activity }), controller.getActivity);

// New enhanced dashboard endpoints
router.get('/enrollment-trend', controller.getEnrollmentTrend);
router.get('/completion-trend', controller.getCompletionTrend);
router.get('/site-performance', controller.getSitePerformance);
router.get('/form-completion-rates', controller.getFormCompletionRates);
router.get('/data-quality', controller.getDataQualityMetrics);
router.get('/subject-status-distribution', controller.getSubjectStatusDistribution);
router.get('/activity-feed', controller.getActivityFeed);
router.get('/health-score', controller.getStudyHealthScore);

export default router;

