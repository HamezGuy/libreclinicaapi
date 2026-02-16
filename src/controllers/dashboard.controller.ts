/**
 * Dashboard Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as dashboardService from '../services/database/dashboard.service';

/**
 * Get dashboard summary (combined stats for frontend)
 * Returns empty data gracefully if study has no data
 */
export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  const sid = parseInt(studyId as string) || 1;

  try {
    const [enrollment, completion, queries] = await Promise.all([
      dashboardService.getEnrollmentStats(sid).catch(() => ({
        totalSubjects: 0,
        activeSubjects: 0,
        completedSubjects: 0,
        withdrawnSubjects: 0,
        screenedSubjects: 0,
        enrollmentByMonth: [],
        enrollmentRate: 0,
        targetEnrollment: null
      })),
      dashboardService.getCompletionStats(sid).catch(() => ({
        totalCRFs: 0,
        completedCRFs: 0,
        incompleteCRFs: 0,
        completionPercentage: 0,
        completionByForm: [],
        averageCompletionTime: 0
      })),
      dashboardService.getQueryStatistics(sid, 'month').catch(() => ({
        totalQueries: 0,
        openQueries: 0,
        closedQueries: 0,
        queriesByType: [],
        queriesByStatus: [],
        averageResolutionTime: 0,
        queryRate: 0
      }))
    ]);

    res.json({
      success: true,
      data: {
        studyId: sid,
        enrollment,
        completion,
        queries,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    // Return empty summary on error
    res.json({
      success: true,
      data: {
        studyId: sid,
        enrollment: { totalSubjects: 0, activeSubjects: 0, completedSubjects: 0, withdrawnSubjects: 0, screenedSubjects: 0, enrollmentByMonth: [], enrollmentRate: 0, targetEnrollment: null },
        completion: { totalCRFs: 0, completedCRFs: 0, incompleteCRFs: 0, completionPercentage: 0, completionByForm: [], averageCompletionTime: 0 },
        queries: { totalQueries: 0, openQueries: 0, closedQueries: 0, queriesByType: [], queriesByStatus: [], averageResolutionTime: 0, queryRate: 0 },
        lastUpdated: new Date()
      }
    });
  }
});

/**
 * Get dashboard stats (alias for summary, for frontend compatibility)
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  const sid = parseInt(studyId as string) || 1;

  try {
    const healthScore = await dashboardService.getStudyHealthScore(sid).catch(() => ({
      score: 0,
      factors: { enrollment: 0, dataCompletion: 0, queryResolution: 0, protocolCompliance: 0 }
    }));

    const dataQuality = await dashboardService.getDataQualityMetrics(sid).catch(() => ({
      totalQueries: 0,
      openQueries: 0,
      resolvedQueries: 0,
      queryResolutionRate: 100,
      sdvVerified: 0,
      totalCRFs: 0,
      sdvRate: 0,
      auditEvents30Days: 0
    }));

    res.json({
      success: true,
      data: {
        studyId: sid,
        healthScore,
        dataQuality,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        studyId: sid,
        healthScore: { score: 0, factors: {} },
        dataQuality: {},
        lastUpdated: new Date()
      }
    });
  }
});

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
  const user = (req as any).user;
  const { studyId } = req.query;

  const result = await dashboardService.getFormCompletionRates(
    parseInt(studyId as string),
    user?.userId
  );

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

/**
 * Get detailed user analytics
 * Includes: login patterns, activity metrics, role breakdown, top performers
 */
export const getUserAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;

  const result = await dashboardService.getUserAnalytics(
    parseInt(studyId as string) || 1,
    parseInt(days as string) || 30
  );

  res.json({ success: true, data: result });
});

/**
 * Get top performers (most active users)
 */
export const getTopPerformers = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days, limit } = req.query;

  const result = await dashboardService.getTopPerformers(
    parseInt(studyId as string) || 1,
    parseInt(days as string) || 30,
    parseInt(limit as string) || 10
  );

  res.json({ success: true, data: result });
});

export default { 
  getSummary,
  getStats,
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
  getStudyHealthScore,
  getUserAnalytics,
  getTopPerformers
};

