/**
 * Study Routes
 * 
 * API endpoints for study management including:
 * - CRUD operations
 * - Metadata, forms, sites, events
 * - Statistics and users
 */

import express from 'express';
import * as controller from '../controllers/study.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, studySchemas, commonSchemas } from '../middleware/validation.middleware';

const router = express.Router();

router.use(authMiddleware);

// Read operations - all authenticated users
router.get('/', validate({ query: studySchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/metadata', validate({ params: commonSchemas.idParam }), controller.getMetadata);
router.get('/:id/forms', validate({ params: commonSchemas.idParam }), controller.getForms);
router.get('/:id/sites', validate({ params: commonSchemas.idParam }), controller.getSites);
router.get('/:id/events', validate({ params: commonSchemas.idParam }), controller.getEvents);
router.get('/:id/stats', validate({ params: commonSchemas.idParam }), controller.getStats);
router.get('/:id/users', validate({ params: commonSchemas.idParam }), controller.getUsers);

// Create/Update/Delete - require admin or coordinator role
router.post('/', requireRole('admin', 'coordinator'), validate({ body: studySchemas.create }), controller.create);
router.put('/:id', requireRole('admin', 'coordinator'), validate({ params: commonSchemas.idParam, body: studySchemas.update }), controller.update);
router.delete('/:id', requireRole('admin'), validate({ params: commonSchemas.idParam }), controller.remove);

export default router;

