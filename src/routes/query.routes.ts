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

router.get('/', validate({ query: querySchemas.list }), controller.list);
router.get('/stats', controller.stats);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.post('/', requireRole('data_entry', 'investigator', 'monitor'), validate({ body: querySchemas.create }), controller.create);
router.post('/:id/respond', validate({ params: commonSchemas.idParam, body: querySchemas.respond }), controller.respond);
router.put('/:id/status', requireRole('monitor', 'coordinator', 'admin'), validate({ params: commonSchemas.idParam, body: querySchemas.updateStatus }), controller.updateStatus);

export default router;

