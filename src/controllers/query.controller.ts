/**
 * Query Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as queryService from '../services/database/query.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, status, page, limit } = req.query;

  const result = await queryService.getQueries({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    subjectId: subjectId ? parseInt(subjectId as string) : undefined,
    status: status as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await queryService.getQueryById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Query not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await queryService.createQuery(req.body, user.userId);

  res.status(result.success ? 201 : 400).json(result);
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await queryService.addQueryResponse(
    parseInt(id), 
    req.body, 
    user.userId
  );

  res.json(result);
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { statusId } = req.body;

  const result = await queryService.updateQueryStatus(
    parseInt(id), 
    statusId, 
    user.userId
  );

  res.json(result);
});

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await queryService.getQueryStats(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

export default { list, get, create, respond, updateStatus, stats };

