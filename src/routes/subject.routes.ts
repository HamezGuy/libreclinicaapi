/**
 * Subject Routes
 * 
 * API endpoints for subject/patient management including:
 * - List and search subjects
 * - CRUD operations
 * - Progress tracking
 * - Events and forms
 */

import express from 'express';
import * as controller from '../controllers/subject.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, subjectSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);

// Read operations
router.get('/', validate({ query: subjectSchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/progress', validate({ params: commonSchemas.idParam }), controller.getProgress);
router.get('/:id/events', validate({ params: commonSchemas.idParam }), controller.getEvents);
router.get('/:id/forms', validate({ params: commonSchemas.idParam }), controller.getForms);

// Create/Update operations - require coordinator or investigator role
router.post('/', requireRole('coordinator', 'investigator'), soapRateLimiter, validate({ body: subjectSchemas.create }), controller.create);
router.put('/:id', requireRole('coordinator', 'investigator'), validate({ params: commonSchemas.idParam }), controller.update);
router.put('/:id/status', requireRole('coordinator', 'investigator'), validate({ params: commonSchemas.idParam }), controller.updateStatus);

// Delete operation - require admin role (soft delete)
router.delete('/:id', requireRole('admin', 'coordinator'), validate({ params: commonSchemas.idParam }), controller.remove);

export default router;

