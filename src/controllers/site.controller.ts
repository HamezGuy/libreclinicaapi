/**
 * Site Controller
 * 
 * Handles all site/location-related API endpoints including:
 * - CRUD operations for sites
 * - Patient-to-site assignments
 * - Site staff management
 * - Site statistics
 * 
 * 21 CFR Part 11 Compliance:
 * - All site modifications require electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as siteService from '../services/database/site.service';
import { logger } from '../config/logger';

/**
 * Get all sites for a study
 * GET /api/sites/study/:studyId
 */
export const getSitesForStudy = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;
  const { status, includeStats } = req.query;

  logger.info('📍 Get sites for study request', { studyId, status, includeStats });

  const result = await siteService.getSitesForStudy(parseInt(studyId), {
    status: status as string,
    includeStats: includeStats === 'true'
  });

  res.json(result);
});

/**
 * Get a single site by ID
 * GET /api/sites/:id
 */
export const getSiteById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('📍 Get site by ID request', { siteId: id });

  const result = await siteService.getSiteById(parseInt(id));

  if (!result.success) {
    res.status(404).json(result);
    return;
  }

  res.json(result);
});

/**
 * Create a new site
 * POST /api/sites
 */
export const createSite = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  logger.info('📍 Create site request', { 
    body: req.body,
    userId: user.userId
  });

  const result = await siteService.createSite(req.body, user.userId);

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Update a site
 * PUT /api/sites/:id
 */
export const updateSite = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  logger.info('📍 Update site request', { 
    siteId: id, 
    body: req.body,
    userId: user.userId
  });

  const result = await siteService.updateSite(parseInt(id), req.body, user.userId);

  res.json(result);
});

/**
 * Delete a site
 * DELETE /api/sites/:id
 */
export const deleteSite = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  logger.info('📍 Delete site request', { siteId: id, userId: user.userId });

  const result = await siteService.deleteSite(parseInt(id), user.userId);

  res.json(result);
});

/**
 * Get patients for a site
 * GET /api/sites/:id/patients
 */
export const getSitePatients = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, page, limit } = req.query;

  logger.info('📍 Get site patients request', { siteId: id, status, page, limit });

  const result = await siteService.getSitePatients(parseInt(id), {
    status: status as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50
  });

  res.json(result);
});

/**
 * Transfer a patient to a different site
 * POST /api/sites/transfer
 */
export const transferPatient = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studySubjectId, targetSiteId, reason } = req.body;

  logger.info('📍 Transfer patient request', { 
    studySubjectId, 
    targetSiteId, 
    reason,
    userId: user.userId 
  });

  if (!studySubjectId || !targetSiteId || !reason) {
    res.status(400).json({ 
      success: false, 
      message: 'studySubjectId, targetSiteId, and reason are required' 
    });
    return;
  }

  const result = await siteService.transferPatientToSite(
    parseInt(studySubjectId),
    parseInt(targetSiteId),
    reason,
    user.userId
  );

  res.json(result);
});

/**
 * Get site staff
 * GET /api/sites/:id/staff
 */
export const getSiteStaff = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('📍 Get site staff request', { siteId: id });

  const result = await siteService.getSiteStaff(parseInt(id));

  res.json(result);
});

/**
 * Assign staff to a site
 * POST /api/sites/:id/staff
 */
export const assignStaff = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { username, roleName } = req.body;

  logger.info('📍 Assign staff request', { 
    siteId: id, 
    username, 
    roleName,
    userId: user.userId 
  });

  if (!username || !roleName) {
    res.status(400).json({ 
      success: false, 
      message: 'username and roleName are required' 
    });
    return;
  }

  const result = await siteService.assignStaffToSite(
    parseInt(id),
    username,
    roleName,
    user.userId
  );

  res.json(result);
});

/**
 * Remove staff from a site
 * DELETE /api/sites/:id/staff/:username
 */
export const removeStaff = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id, username } = req.params;

  logger.info('📍 Remove staff request', { 
    siteId: id, 
    username,
    userId: user.userId 
  });

  const result = await siteService.removeStaffFromSite(
    parseInt(id),
    username,
    user.userId
  );

  res.json(result);
});

/**
 * Get site statistics for a study
 * GET /api/sites/study/:studyId/stats
 */
export const getSiteStatistics = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  logger.info('📍 Get site statistics request', { studyId });

  const result = await siteService.getSiteStatistics(parseInt(studyId));

  res.json(result);
});

export default {
  getSitesForStudy,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  getSitePatients,
  transferPatient,
  getSiteStaff,
  assignStaff,
  removeStaff,
  getSiteStatistics
};

