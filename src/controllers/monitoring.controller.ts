/**
 * Monitoring Controller
 * System-level monitoring with REAL query/SDV/validation counts
 */

import { Request, Response } from 'express';
import type { ApiResponse, HealthCheckResponse } from '@accura-trial/shared-types';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { logger } from '../config/logger';
import {
  getSystemStats as fetchSystemStats,
  getRecentAlerts as fetchRecentAlerts,
  getSystemMetrics as fetchSystemMetrics,
  SystemStats,
  AlertEntry,
  SystemMetrics,
} from '../services/database/monitoring.service';

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await fetchSystemStats();

  const response: ApiResponse<SystemStats> = { success: true, data: stats };
  res.json(response);
});

export const getAlerts = asyncHandler(async (_req: Request, res: Response) => {
  const alerts = await fetchRecentAlerts(10);

  const response: ApiResponse<AlertEntry[]> = { success: true, data: alerts };
  res.json(response);
});

export const getMetrics = asyncHandler(async (req: Request, res: Response) => {
  const timeRange = (req.query.timeRange as string) || '24h';
  const metrics = await fetchSystemMetrics(timeRange);

  const response: ApiResponse<SystemMetrics> = { success: true, data: metrics };
  res.json(response);
});

export default { getStats, getAlerts, getMetrics };
