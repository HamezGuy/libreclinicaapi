/**
 * Dashboard Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dashboardService from '../services/database/dashboard.service';

export const getEnrollment = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, startDate, endDate } = req.query;

  const result = await dashboardService.getEnrollmentStats(
    parseInt(studyId as string),
    startDate ? new Date(startDate as string) : undefined,
    endDate ? new Date(endDate as string) : undefined
  );

  res.json({ success: true, data: result });
});

export const getCompletion = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getCompletionStats(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

export const getQueries = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, timeframe } = req.query;

  const result = await dashboardService.getQueryStatistics(
    parseInt(studyId as string),
    (timeframe as 'week' | 'month' | 'quarter' | 'year') || 'month'
  );

  res.json({ success: true, data: result });
});

export const getActivity = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;

  const result = await dashboardService.getUserActivityStats(
    parseInt(studyId as string),
    parseInt(days as string) || 30
  );

  res.json({ success: true, data: result });
});

export default { getEnrollment, getCompletion, getQueries, getActivity };

