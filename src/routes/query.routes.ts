/**
 * Query Routes
 */

import express from 'express';
import * as controller from '../controllers/query.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, querySchemas, commonSchemas } from '../middleware/validation.middleware';

const router = express.Router();

router.use(authMiddleware);

// List and statistics
router.get('/', validate({ query: querySchemas.list }), controller.list);
router.get('/stats', controller.stats);
router.get('/types', controller.getQueryTypes);
router.get('/statuses', controller.getResolutionStatuses);
router.get('/count-by-status', controller.countByStatus);
router.get('/count-by-type', controller.countByType);
router.get('/overdue', controller.getOverdue);
router.get('/my-assigned', controller.getMyAssigned);

// Form-specific queries
router.get('/form/:eventCrfId', controller.getFormQueries);

// Single query operations
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/thread', controller.getThread);

// Create and update operations
router.post('/', requireRole('data_entry', 'investigator', 'monitor'), validate({ body: querySchemas.create }), controller.create);
router.post('/:id/respond', validate({ params: commonSchemas.idParam, body: querySchemas.respond }), controller.respond);
router.put('/:id/status', requireRole('monitor', 'coordinator', 'admin'), validate({ params: commonSchemas.idParam, body: querySchemas.updateStatus }), controller.updateStatus);
router.put('/:id/reassign', requireRole('coordinator', 'admin'), controller.reassign);

export default router;

