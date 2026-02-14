/**
 * User Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as userService from '../services/database/user.service';
import * as featureAccessService from '../services/database/feature-access.service';

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

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const caller = (req as any).user;

  const result = await userService.getUserById(parseInt(id), caller?.userId);

  if (!result) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const creator = (req as any).user;

  const result = await userService.createUser(req.body, creator.userId);

  res.status(result.success ? 201 : 400).json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const updater = (req as any).user;
  const { id } = req.params;

  const result = await userService.updateUser(parseInt(id), req.body, updater.userId);

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

  res.json({
    success: true,
    data: roles,
    message: 'Available LibreClinica roles'
  });
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
    });
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
    });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Get all features available in the system
 */
export const getAllFeatures = asyncHandler(async (req: Request, res: Response) => {
  const features = await featureAccessService.getAllFeatures();
  res.json({ success: true, data: features });
});

/**
 * Get a user's effective feature access
 */
export const getUserFeatures = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const features = await featureAccessService.getUserFeatureAccess(parseInt(id));
  res.json({ success: true, data: features });
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
    res.status(400).json({ success: false, message: 'features array is required' });
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
    res.status(400).json({ success: false, message: 'isEnabled is required' });
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

export default {
  list, get, create, update, remove, getRoles, assignToStudy, getUserRole,
  getAllFeatures, getUserFeatures, setUserFeatures, setOneUserFeature, removeFeatureOverride
};

