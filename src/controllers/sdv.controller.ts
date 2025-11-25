/**
 * SDV (Source Data Verification) Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as sdvService from '../services/database/sdv.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status, page, limit } = req.query;

  const result = await sdvService.getSDVRecords({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    status: status as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await sdvService.getSDVById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'SDV record not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await sdvService.verifySDV(parseInt(id), user.userId);

  res.json(result);
});

export default { list, get, verify };
