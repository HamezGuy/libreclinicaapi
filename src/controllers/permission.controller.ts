/**
 * Permission Controller
 * 
 * Per-user custom permission overrides (à la carte).
 * 
 * Two read paths:
 *   /me        — self-service, uses JWT userId (any user)
 *   /:userId   — admin reading another user (requires admin/coordinator role)
 * 
 * Both return the same shape: { success, data: { userId, customPermissions } }
 * 
 * 21 CFR Part 11 §11.10(d) - Limiting system access to authorized individuals
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as permissionService from '../services/database/permission.service';
import { logger } from '../config/logger';

/**
 * GET /api/permissions/available
 * List all permission keys with descriptions (any authenticated user)
 */
export const getAvailable = asyncHandler(async (req: Request, res: Response) => {
  const permissions = permissionService.getAvailablePermissions();

  const grouped: Record<string, { key: string; label: string }[]> = {};
  for (const perm of permissions) {
    if (!grouped[perm.category]) grouped[perm.category] = [];
    grouped[perm.category].push({ key: perm.key, label: perm.label });
  }

  res.json({ success: true, data: { permissions, grouped } });
});

/**
 * GET /api/permissions/me
 * Read YOUR OWN custom overrides (any authenticated user).
 * Uses the userId from the JWT — can't be spoofed.
 */
export const getMyPermissions = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const customPermissions = await permissionService.getUserCustomPermissions(user.userId);
  res.json({ success: true, data: { userId: user.userId, customPermissions } });
});

/**
 * GET /api/permissions/:userId
 * Read another user's custom overrides (admin only).
 * Used by the user-management UI when editing another user's permissions.
 */
export const getUserPermissions = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) {
    res.status(400).json({ success: false, message: 'Invalid userId' });
    return;
  }

  const customPermissions = await permissionService.getUserCustomPermissions(userId);
  res.json({ success: true, data: { userId, customPermissions } });
});

/**
 * PUT /api/permissions/:userId
 * Set/update custom overrides for a user (admin only).
 * Body: { permissions: { canExportData: true, canSignForms: false, canFillForms: null } }
 *   true/false = set override, null = remove override (revert to role default)
 */
export const setUserPermissions = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const caller = (req as any).user;

  if (isNaN(userId)) {
    res.status(400).json({ success: false, message: 'Invalid userId' });
    return;
  }

  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object') {
    res.status(400).json({ success: false, message: '"permissions" object is required' });
    return;
  }

  const result = await permissionService.setUserCustomPermissions(userId, permissions, caller.userId);
  logger.info('Custom permissions set', { targetUserId: userId, grantedBy: caller.userId, updated: result.updated });
  res.json(result);
});

/**
 * DELETE /api/permissions/:userId/:permissionKey
 * Remove a single override for a user (admin only).
 */
export const removePermission = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const { permissionKey } = req.params;

  if (isNaN(userId)) {
    res.status(400).json({ success: false, message: 'Invalid userId' });
    return;
  }
  if (!permissionKey) {
    res.status(400).json({ success: false, message: 'permissionKey is required' });
    return;
  }

  const result = await permissionService.removePermissionOverride(userId, permissionKey);
  res.json(result);
});

export default { getAvailable, getMyPermissions, getUserPermissions, setUserPermissions, removePermission };
