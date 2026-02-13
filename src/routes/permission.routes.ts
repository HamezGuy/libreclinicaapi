/**
 * Permission Routes
 * 
 * Per-user custom permission overrides (à la carte permissions).
 * All routes require authentication + admin/coordinator role.
 */

import express from 'express';
import * as controller from '../controllers/permission.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Available permissions (any authenticated user can see the list)
router.get('/available', controller.getAvailable);

// User-specific permission management (admin/coordinator only)
router.get('/:userId', requireRole('admin', 'coordinator'), controller.getUserPermissions);
router.put('/:userId', requireRole('admin', 'coordinator'), controller.setUserPermissions);
router.delete('/:userId/:permissionKey', requireRole('admin', 'coordinator'), controller.removePermission);

export default router;
