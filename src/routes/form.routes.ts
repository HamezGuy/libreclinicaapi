/**
 * Form Routes
 * 
 * CRUD operations for form templates (CRFs) and form data
 */

import express from 'express';
import * as controller from '../controllers/form.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, formSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);

// Form templates (CRFs) - read operations
router.get('/', controller.list);
router.get('/by-study', controller.getByStudy);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:crfId/metadata', controller.getMetadata);

// Form templates (CRFs) - write operations
router.post('/', requireRole('admin', 'coordinator'), controller.create);
router.put('/:id', requireRole('admin', 'coordinator'), validate({ params: commonSchemas.idParam }), controller.update);
router.delete('/:id', requireRole('admin'), validate({ params: commonSchemas.idParam }), controller.remove);

// Form data operations
router.post('/save', requireRole('data_entry', 'investigator'), soapRateLimiter, validate({ body: formSchemas.saveData }), controller.saveData);
router.get('/data/:eventCrfId', controller.getData);
router.get('/status/:eventCrfId', controller.getStatus);

export default router;

