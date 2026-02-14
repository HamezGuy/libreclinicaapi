/**
 * User Routes
 * 
 * IMPORTANT: /meta/* routes MUST come before /:id routes,
 * otherwise Express treats "meta" as an :id parameter.
 */

import express from 'express';
import * as controller from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, userSchemas, commonSchemas } from '../middleware/validation.middleware';
import { userCreationRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);
router.use(requireRole('admin', 'data_manager'));

// ── Meta routes (MUST be before /:id to avoid Express treating "meta" as an id) ──
router.get('/meta/roles', controller.getRoles);
router.get('/meta/features', controller.getAllFeatures);

// ── User CRUD ──
router.get('/', validate({ query: userSchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.post('/', userCreationRateLimiter, validate({ body: userSchemas.create }), controller.create);
router.put('/:id', validate({ params: commonSchemas.idParam, body: userSchemas.update }), controller.update);
router.delete('/:id', validate({ params: commonSchemas.idParam }), controller.remove);

// ── Role management ──
router.post('/:id/assign-study', validate({ params: commonSchemas.idParam }), controller.assignToStudy);
router.get('/:id/role/:studyId', controller.getUserRole);

// ── Feature access management ──
router.get('/:id/features', validate({ params: commonSchemas.idParam }), controller.getUserFeatures);
router.put('/:id/features', validate({ params: commonSchemas.idParam }), controller.setUserFeatures);
router.put('/:id/features/:featureKey', validate({ params: commonSchemas.idParam }), controller.setOneUserFeature);
router.delete('/:id/features/:featureKey', validate({ params: commonSchemas.idParam }), controller.removeFeatureOverride);

export default router;
