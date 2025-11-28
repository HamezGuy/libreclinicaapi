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

/**
 * Get enrollment trend over time
 */
export const getEnrollmentTrend = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;

  const result = await dashboardService.getEnrollmentTrend(
    parseInt(studyId as string),
    parseInt(days as string) || 30
  );

  res.json({ success: true, data: result });
});

/**
 * Get completion trend over time
 */
export const getCompletionTrend = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;

  const result = await dashboardService.getCompletionTrend(
    parseInt(studyId as string),
    parseInt(days as string) || 30
  );

  res.json({ success: true, data: result });
});

/**
 * Get site performance metrics
 */
export const getSitePerformance = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getSitePerformance(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get form completion rates
 */
export const getFormCompletionRates = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getFormCompletionRates(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get data quality metrics
 */
export const getDataQualityMetrics = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getDataQualityMetrics(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get subject status distribution
 */
export const getSubjectStatusDistribution = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getSubjectStatusDistribution(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get activity feed
 */
export const getActivityFeed = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, limit } = req.query;

  const result = await dashboardService.getActivityFeed(
    parseInt(studyId as string),
    parseInt(limit as string) || 20
  );

  res.json({ success: true, data: result });
});

/**
 * Get study health score
 */
export const getStudyHealthScore = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  const result = await dashboardService.getStudyHealthScore(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

export default { 
  getEnrollment, 
  getCompletion, 
  getQueries, 
  getActivity,
  getEnrollmentTrend,
  getCompletionTrend,
  getSitePerformance,
  getFormCompletionRates,
  getDataQualityMetrics,
  getSubjectStatusDistribution,
  getActivityFeed,
  getStudyHealthScore
};

