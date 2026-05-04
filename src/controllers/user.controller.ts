/**
 * User Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as userService from '../services/database/user.service';
import * as featureAccessService from '../services/database/feature-access.service';
import { pool } from '../config/database';
import { logger } from '../config/logger';
import type { ApiResponse, UserAccount, FeatureDefinition, UserFeatureAccess } from '@accura-trial/shared-types';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, role, enabled, page, limit } = req.query;
  const user = (req as any).user;

  const result = await userService.getUsers({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    role: role as string,
    enabled: enabled !== undefined ? enabled === 'true' : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  }, user?.userId);

  res.json(result as unknown as ApiResponse<UserAccount[]>);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const caller = (req as any).user;

  const result = await userService.getUserById(parseInt(id), caller?.userId);

  if (!result) {
    res.status(404).json({ success: false, message: 'User not found' } as ApiResponse<null>);
    return;
  }

  const response: ApiResponse<unknown> = { success: true, data: result };
  res.json(response);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const creator = (req as any).user;

  const result: ApiResponse<unknown> = await userService.createUser(req.body, creator.userId);

  res.status(result.success ? 201 : 400).json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const updater = (req as any).user;
  const { id } = req.params;

  const result: ApiResponse<unknown> = await userService.updateUser(parseInt(id), req.body, updater.userId);

  res.json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const deleter = (req as any).user;
  const { id } = req.params;

  const result = await userService.deleteUser(parseInt(id), deleter.userId);

  res.json(result);
});

/**
 * Get available roles
 */
export const getRoles = asyncHandler(async (req: Request, res: Response) => {
  const roles = userService.getAvailableRoles();

  const response: ApiResponse<typeof roles> = { success: true, data: roles };
  res.json(response);
});

/**
 * Assign user to study with role
 */
export const assignToStudy = asyncHandler(async (req: Request, res: Response) => {
  const assigner = (req as any).user;
  const { id } = req.params;
  const { studyId, roleName } = req.body;

  if (!studyId || !roleName) {
    res.status(400).json({
      success: false,
      message: 'studyId and roleName are required'
    } as ApiResponse<null>);
    return;
  }

  const result = await userService.assignUserToStudy(
    parseInt(id),
    parseInt(studyId),
    roleName,
    assigner.userId
  );

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Get user's role for a specific study
 */
export const getUserRole = asyncHandler(async (req: Request, res: Response) => {
  const { id, studyId } = req.params;

  const result = await userService.getUserStudyRole(
    parseInt(id),
    parseInt(studyId)
  );

  if (!result) {
    res.status(404).json({
      success: false,
      message: 'User not assigned to this study'
    } as ApiResponse<null>);
    return;
  }

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

/**
 * Get all features available in the system
 */
export const getAllFeatures = asyncHandler(async (req: Request, res: Response) => {
  const features = await featureAccessService.getAllFeatures();
  const response: ApiResponse<FeatureDefinition[]> = { success: true, data: features };
  res.json(response);
});

/**
 * Get a user's effective feature access
 */
export const getUserFeatures = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const features = await featureAccessService.getUserFeatureAccess(parseInt(id));
  const response: ApiResponse<UserFeatureAccess[]> = { success: true, data: features };
  res.json(response);
});

/**
 * Bulk set feature access for a user
 * Body: { features: [{ featureKey: string, isEnabled: boolean }] }
 */
export const setUserFeatures = asyncHandler(async (req: Request, res: Response) => {
  const updater = (req as any).user;
  const { id } = req.params;
  const { features } = req.body;

  if (!features || !Array.isArray(features)) {
    res.status(400).json({ success: false, message: 'features array is required' } as ApiResponse<null>);
    return;
  }

  const result = await featureAccessService.bulkSetUserFeatureAccess(
    parseInt(id),
    features,
    updater.userId
  );

  res.json(result);
});

/**
 * Set a single feature access for a user
 * Body: { isEnabled: boolean, notes?: string }
 */
export const setOneUserFeature = asyncHandler(async (req: Request, res: Response) => {
  const updater = (req as any).user;
  const { id, featureKey } = req.params;
  const { isEnabled, notes } = req.body;

  if (isEnabled === undefined) {
    res.status(400).json({ success: false, message: 'isEnabled is required' } as ApiResponse<null>);
    return;
  }

  const result = await featureAccessService.setUserFeatureAccess(
    parseInt(id),
    featureKey,
    isEnabled,
    updater.userId,
    notes
  );

  res.json(result);
});

/**
 * Remove a per-user feature override (fall back to role default)
 */
export const removeFeatureOverride = asyncHandler(async (req: Request, res: Response) => {
  const { id, featureKey } = req.params;

  const result = await featureAccessService.removeUserFeatureOverride(parseInt(id), featureKey);
  res.json(result);
});

/**
 * §11.300(c) — Emergency session revocation for compromised accounts.
 * Blocks all active tokens for the target user and optionally locks the account.
 */
export const revokeSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);
  const { lockAccount: shouldLock, reason } = req.body || {};

  const { revokeAllUserSessions } = await import('../services/database/token-blocklist.service');
  const hadActiveSession = revokeAllUserSessions(userId);

  if (shouldLock) {
    await pool.query('UPDATE user_account SET status_id = 5 WHERE user_id = $1', [userId]);
  }

  const adminUser = (req as Record<string, unknown>).user as { userId: number; userName?: string } | undefined;
  const adminUsername = adminUser?.userName || 'unknown';

  await pool.query(`
    INSERT INTO audit_log_event (
      audit_date, audit_table, user_id, entity_id, entity_name,
      new_value, audit_log_event_type_id, reason_for_change
    ) VALUES (
      NOW(), 'user_account', $1, $2, 'Emergency Session Revocation (§11.300(c))',
      $3,
      (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
      $4
    )
  `, [
    adminUser?.userId || 0,
    userId,
    JSON.stringify({ accountLocked: Boolean(shouldLock), hadActiveSession, revokedBy: adminUsername }),
    reason || 'Emergency session revocation — compromised account'
  ]);

  logger.warn('Emergency session revocation (§11.300(c))', {
    targetUserId: userId,
    accountLocked: Boolean(shouldLock),
    hadActiveSession,
    revokedBy: adminUser?.userId,
  });

  res.json({
    success: true,
    message: shouldLock
      ? 'All sessions revoked and account locked'
      : 'All sessions revoked',
  });
});

export default {
  list, get, create, update, remove, getRoles, assignToStudy, getUserRole,
  getAllFeatures, getUserFeatures, setUserFeatures, setOneUserFeature, removeFeatureOverride,
  revokeSessions
};

