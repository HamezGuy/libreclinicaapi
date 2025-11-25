/**
 * Event Routes
 * 
 * Study Event (Phase) management routes
 */

import express from 'express';
import * as controller from '../controllers/event.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, eventSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);

// Read operations - all authenticated users
router.get('/study/:studyId', validate({ params: commonSchemas.idParam }), controller.getStudyEvents);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.getEvent);
router.get('/:id/crfs', validate({ params: commonSchemas.idParam }), controller.getEventCRFs);
router.get('/subject/:subjectId', validate({ params: commonSchemas.idParam }), controller.getSubjectEvents);

// Create/Update/Delete - require coordinator or admin role
router.post('/', requireRole('admin', 'coordinator'), validate({ body: eventSchemas.create }), controller.create);
router.put('/:id', requireRole('admin', 'coordinator'), validate({ params: commonSchemas.idParam, body: eventSchemas.update }), controller.update);
router.delete('/:id', requireRole('admin'), validate({ params: commonSchemas.idParam }), controller.remove);

// Schedule event - require data entry or coordinator role, use SOAP rate limiter
router.post('/schedule', requireRole('coordinator', 'data_entry', 'investigator'), soapRateLimiter, validate({ body: eventSchemas.schedule }), controller.scheduleEvent);

export default router;

