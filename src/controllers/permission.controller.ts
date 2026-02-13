/**
 * Permission Controller
 * 
 * Manages per-user custom permission overrides (à la carte permissions).
 * All endpoints require admin or coordinator role.
 * 
 * 21 CFR Part 11 §11.10(d) - Limiting system access to authorized individuals
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as permissionService from '../services/database/permission.service';
import { logger } from '../config/logger';

/**
 * GET /api/permissions/available
 * List all available permission keys with descriptions
 */
export const getAvailable = asyncHandler(async (req: Request, res: Response) => {
  const permissions = permissionService.getAvailablePermissions();

  // Group by category
  const grouped: Record<string, { key: string; label: string }[]> = {};
  for (const perm of permissions) {
    if (!grouped[perm.category]) {
      grouped[perm.category] = [];
    }
    grouped[perm.category].push({ key: perm.key, label: perm.label });
  }

  res.json({
    success: true,
    data: {
      permissions,
      grouped,
    },
    message: 'Available permission keys',
  });
});

/**
 * GET /api/permissions/:userId
 * Get custom permission overrides for a specific user
 */
export const getUserPermissions = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);

  if (isNaN(userId)) {
    res.status(400).json({ success: false, message: 'Invalid userId' });
    return;
  }

  const customPermissions = await permissionService.getUserCustomPermissions(userId);

  res.json({
    success: true,
    data: {
      userId,
      customPermissions,
    },
  });
});

/**
 * PUT /api/permissions/:userId
 * Set/update custom permissions for a user (bulk)
 * 
 * Body: { permissions: { canExportData: true, canCreateStudy: false, canManageUsers: null } }
 *   - true/false = set override
 *   - null = remove override (revert to role default)
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
    res.status(400).json({
      success: false,
      message: 'Request body must include a "permissions" object',
    });
    return;
  }

  const result = await permissionService.setUserCustomPermissions(
    userId,
    permissions,
    caller.userId
  );

  logger.info('Custom permissions set via API', {
    targetUserId: userId,
    grantedBy: caller.userId,
    updated: result.updated,
  });

  res.json(result);
});

/**
 * DELETE /api/permissions/:userId/:permissionKey
 * Remove a single permission override
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

export default { getAvailable, getUserPermissions, setUserPermissions, removePermission };
