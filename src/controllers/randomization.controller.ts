/**
 * Randomization Controller
 * 
 * Handles both the new engine-based randomization (sealed lists)
 * and legacy manual assignment for backward compatibility.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as randomizationService from '../services/database/randomization.service';
import * as engine from '../services/database/randomization-engine.service';

// ============================================================================
// CONFIGURATION ENDPOINTS
// ============================================================================

/**
 * Get randomization config for a study
 */
export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  const config = await engine.getConfig(parseInt(studyId));

  if (!config) {
    res.json({ success: true, data: null, message: 'No randomization scheme configured for this study' });
    return;
  }

  // If active, also get list stats
  let listStats = null;
  if (config.configId && config.isActive) {
    listStats = await engine.getListStats(config.configId);
  }

  res.json({ success: true, data: { ...config, listStats } });
});

/**
 * Create a new randomization config
 */
export const createConfig = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const {
    studyId, name, description, randomizationType, blindingLevel,
    blockSize, blockSizeVaried, blockSizesList,
    allocationRatios, stratificationFactors,
    studyGroupClassId, totalSlots,
    drugKitManagement, drugKitPrefix, siteSpecific
  } = req.body;

  if (!studyId || !name) {
    res.status(400).json({ success: false, message: 'studyId and name are required' });
    return;
  }

  if (!allocationRatios || Object.keys(allocationRatios).length < 2) {
    res.status(400).json({ success: false, message: 'At least 2 treatment groups with allocation ratios are required' });
    return;
  }

  const result = await engine.saveConfig({
    studyId,
    name,
    description,
    randomizationType: randomizationType || 'block',
    blindingLevel: blindingLevel || 'double_blind',
    blockSize: blockSize || 4,
    blockSizeVaried: blockSizeVaried || false,
    blockSizesList,
    allocationRatios,
    stratificationFactors,
    studyGroupClassId,
    totalSlots: totalSlots || 100,
    isActive: false,
    isLocked: false,
    drugKitManagement: drugKitManagement || false,
    drugKitPrefix,
    siteSpecific: siteSpecific || false,
  }, user.userId);

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Update a randomization config (only if not locked)
 */
export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { configId } = req.params;

  const result = await engine.updateConfig(parseInt(configId), req.body, user.userId);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Generate the sealed randomization list
 */
export const generateList = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { configId } = req.params;

  const result = await engine.generateList(parseInt(configId), user.userId);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Activate the randomization scheme
 */
export const activateConfig = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { configId } = req.params;

  const result = await engine.activateConfig(parseInt(configId), user.userId);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * Test a config by generating a preview
 */
export const testConfig = asyncHandler(async (req: Request, res: Response) => {
  const { configId } = req.params;

  const config = await engine.getConfigById(parseInt(configId));

  if (!config) {
    res.status(404).json({ success: false, message: 'Config not found' });
    return;
  }

  const result = await engine.testConfig(config);
  res.json(result);
});

/**
 * Get list usage statistics
 */
export const getListStats = asyncHandler(async (req: Request, res: Response) => {
  const { configId } = req.params;

  const stats = await engine.getListStats(parseInt(configId));
  res.json({ success: true, data: stats });
});

// ============================================================================
// CORE RANDOMIZATION (Engine-based)
// ============================================================================

/**
 * Randomize a subject using the sealed list engine.
 * The server determines the treatment assignment — no manual group selection.
 */
export const randomize = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId, studySubjectId, stratumValues } = req.body;

  if (!studyId || !studySubjectId) {
    res.status(400).json({ success: false, message: 'studyId and studySubjectId are required' });
    return;
  }

  const result = await engine.randomizeSubject(
    parseInt(studyId),
    parseInt(studySubjectId),
    user.userId,
    stratumValues
  );

  if (result.success) {
    res.status(201).json({ success: true, data: result });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// ============================================================================
// LEGACY ENDPOINTS (backward compatible — manual assignment)
// ============================================================================

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, page, limit } = req.query;

  const result = await randomizationService.getRandomizations({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

/**
 * Legacy manual randomization (for backward compatibility).
 * Prefer POST /randomize for proper engine-based randomization.
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studySubjectId, studyGroupId } = req.body;

  const result = await randomizationService.createRandomization(
    { studySubjectId, studyGroupId },
    user.userId
  );

  res.status(201).json(result);
});

export const getGroups = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  const result = await randomizationService.getGroupsByStudy(parseInt(studyId));

  res.json(result);
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await randomizationService.getRandomizationStats(parseInt(studyId as string));

  res.json(result);
});

export const canRandomize = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await randomizationService.canRandomize(parseInt(subjectId));

  res.json(result);
});

export const getSubjectRandomization = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await randomizationService.getSubjectRandomization(parseInt(subjectId));

  res.json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { subjectId } = req.params;

  const result = await randomizationService.removeRandomization(
    parseInt(subjectId),
    user.userId
  );

  res.json(result);
});

export const getUnblindingEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await randomizationService.getUnblindingEvents(parseInt(studyId as string));

  res.json(result);
});

export const unblind = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { subjectId } = req.params;
  const { reason } = req.body;

  if (!reason) {
    res.status(400).json({ success: false, message: 'Reason is required for unblinding' });
    return;
  }

  const result = await randomizationService.unblindSubject(
    parseInt(subjectId),
    user.userId,
    reason
  );

  res.json(result);
});

export default {
  getConfig, createConfig, updateConfig, generateList, activateConfig, testConfig, getListStats,
  randomize,
  list, create, getGroups, getStats, canRandomize, getSubjectRandomization,
  remove, getUnblindingEvents, unblind
};
