/**
 * User Routes
 */

import express from 'express';
import * as controller from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, userSchemas, commonSchemas } from '../middleware/validation.middleware';
import { userCreationRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);
router.use(requireRole('admin', 'coordinator'));

// User CRUD
router.get('/', validate({ query: userSchemas.list }), controller.list);
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.post('/', userCreationRateLimiter, validate({ body: userSchemas.create }), controller.create);
router.put('/:id', validate({ params: commonSchemas.idParam, body: userSchemas.update }), controller.update);
router.delete('/:id', validate({ params: commonSchemas.idParam }), controller.remove);

// Role management
router.get('/meta/roles', controller.getRoles);
router.post('/:id/assign-study', validate({ params: commonSchemas.idParam }), controller.assignToStudy);
router.get('/:id/role/:studyId', controller.getUserRole);

export default router;

