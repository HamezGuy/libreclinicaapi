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

export default { list, create, getGroups };
