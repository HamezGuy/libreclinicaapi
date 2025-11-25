/**
 * Dashboard Routes
 */

import express from 'express';
import * as controller from '../controllers/dashboard.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate, dashboardSchemas } from '../middleware/validation.middleware';

const router = express.Router();

router.use(authMiddleware);

router.get('/enrollment', validate({ query: dashboardSchemas.enrollment }), controller.getEnrollment);
router.get('/completion', validate({ query: dashboardSchemas.completion }), controller.getCompletion);
router.get('/queries', validate({ query: dashboardSchemas.queries }), controller.getQueries);
router.get('/activity', validate({ query: dashboardSchemas.activity }), controller.getActivity);

export default router;

