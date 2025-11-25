/**
 * Data Locks Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dataLocksService from '../services/database/data-locks.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, page, limit } = req.query;

  const result = await dataLocksService.getLockedRecords({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

export const lock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId } = req.body;

  if (!eventCrfId) {
    res.status(400).json({ success: false, message: 'eventCrfId is required' });
    return;
  }

  const result = await dataLocksService.lockRecord(eventCrfId, user.userId);

  res.status(result.success ? 201 : 400).json(result);
});

export const unlock = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfId } = req.params;

  const result = await dataLocksService.unlockRecord(parseInt(eventCrfId), user.userId);

  res.json(result);
});

export default { list, lock, unlock };
