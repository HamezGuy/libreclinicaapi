/**
 * Permission Routes
 * 
 * Per-user custom permission overrides (à la carte).
 * 
 * Endpoints:
 *   GET  /available          — List all permission keys (any authenticated user)
 *   GET  /me                 — Read YOUR OWN overrides (any authenticated user, uses JWT userId)
 *   GET  /:userId            — Read ANOTHER user's overrides (admin only)
 *   PUT  /:userId            — Set overrides for a user (admin only)
 *   DELETE /:userId/:key     — Remove one override (admin only)
 */

import express from 'express';
import * as controller from '../controllers/permission.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

router.use(authMiddleware);

// Any authenticated user
router.get('/available', controller.getAvailable);
router.get('/me', controller.getMyPermissions);

// Admin-only (managing other users)
router.get('/:userId', requireRole('admin', 'data_manager'), controller.getUserPermissions);
router.put('/:userId', requireRole('admin', 'data_manager'), controller.setUserPermissions);
router.delete('/:userId/:permissionKey', requireRole('admin', 'data_manager'), controller.removePermission);

export default router;
