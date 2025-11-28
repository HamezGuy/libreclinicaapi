/**
 * Randomization Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as randomizationService from '../services/database/randomization.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, page, limit } = req.query;

  const result = await randomizationService.getRandomizations({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

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

/**
 * Get randomization statistics for a study
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await randomizationService.getRandomizationStats(parseInt(studyId as string));

  res.json(result);
});

/**
 * Check if subject can be randomized
 */
export const canRandomize = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await randomizationService.canRandomize(parseInt(subjectId));

  res.json(result);
});

/**
 * Get subject's randomization info
 */
export const getSubjectRandomization = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await randomizationService.getSubjectRandomization(parseInt(subjectId));

  res.json(result);
});

/**
 * Remove randomization
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { subjectId } = req.params;

  const result = await randomizationService.removeRandomization(
    parseInt(subjectId),
    user.userId
  );

  res.json(result);
});

/**
 * Get unblinding events
 */
export const getUnblindingEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await randomizationService.getUnblindingEvents(parseInt(studyId as string));

  res.json(result);
});

/**
 * Unblind a subject
 */
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
  list, 
  create, 
  getGroups, 
  getStats, 
  canRandomize, 
  getSubjectRandomization, 
  remove, 
  getUnblindingEvents, 
  unblind 
};
