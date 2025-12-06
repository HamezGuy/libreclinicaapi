/**
 * Monitoring Controller
 * System-level monitoring with REAL query/SDV/validation counts
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { pool } from '../config/database';
import { logger } from '../config/logger';

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  // Get system stats from database
  const userCountResult = await pool.query('SELECT COUNT(*) as count FROM user_account WHERE status_id = 1');
  const studyCountResult = await pool.query('SELECT COUNT(*) as count FROM study WHERE status_id = 1');
  
  // Get REAL query counts from discrepancy_note table
  // resolution_status_id: 1=New, 2=Updated, 3=Resolution Proposed, 4=Closed, 5=Not Applicable
  let queryStats = { total: 0, open: 0, critical: 0 };
  try {
    const queryResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN resolution_status_id IN (1, 2, 3) THEN 1 END) as open,
        COUNT(CASE WHEN discrepancy_note_type_id = 4 THEN 1 END) as critical
      FROM discrepancy_note
    `);
    if (queryResult.rows[0]) {
      queryStats = {
        total: parseInt(queryResult.rows[0].total) || 0,
        open: parseInt(queryResult.rows[0].open) || 0,
        critical: parseInt(queryResult.rows[0].critical) || 0
      };
    }
  } catch (error) {
    logger.warn('Could not fetch query stats', { error });
  }
  
  // Get REAL SDV counts from event_crf table
  let sdvStats = { total: 0, pending: 0 };
  try {
    const sdvResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN sdv_status = false OR sdv_status IS NULL THEN 1 END) as pending
      FROM event_crf
      WHERE status_id NOT IN (5, 7)
    `);
    if (sdvResult.rows[0]) {
      sdvStats = {
        total: parseInt(sdvResult.rows[0].total) || 0,
        pending: parseInt(sdvResult.rows[0].pending) || 0
      };
    }
  } catch (error) {
    logger.warn('Could not fetch SDV stats', { error });
  }
  
  // Get validation counts (forms with incomplete data)
  let validationStats = { total: 0, pending: 0 };
  try {
    const validationResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN date_completed IS NULL THEN 1 END) as pending
      FROM event_crf
      WHERE status_id NOT IN (5, 7)
    `);
    if (validationResult.rows[0]) {
      validationStats = {
        total: parseInt(validationResult.rows[0].total) || 0,
        pending: parseInt(validationResult.rows[0].pending) || 0
      };
    }
  } catch (error) {
    logger.warn('Could not fetch validation stats', { error });
  }
  
  // Get data quality metrics
  let dataQuality = { completeness: 0, accuracy: 100 };
  try {
    const qualityResult = await pool.query(`
      SELECT 
        CASE 
          WHEN COUNT(*) = 0 THEN 100
          ELSE ROUND((COUNT(CASE WHEN date_completed IS NOT NULL THEN 1 END)::numeric / COUNT(*)) * 100, 1)
        END as completeness
      FROM event_crf
      WHERE status_id NOT IN (5, 7)
    `);
    if (qualityResult.rows[0]) {
      dataQuality.completeness = parseFloat(qualityResult.rows[0].completeness) || 0;
    }
  } catch (error) {
    logger.warn('Could not fetch data quality stats', { error });
  }
  
  const stats = {
    systemHealth: {
      status: 'healthy',
      uptime: process.uptime(),
      lastCheck: new Date().toISOString()
    },
    activeUsers: parseInt(userCountResult.rows[0].count),
    activeStudies: parseInt(studyCountResult.rows[0].count),
    // Query stats
    totalQueries: queryStats.total,
    openQueries: queryStats.open,
    criticalQueries: queryStats.critical,
    // Validation stats
    totalValidations: validationStats.total,
    pendingValidations: validationStats.pending,
    // SDV stats
    totalSDV: sdvStats.total,
    pendingSDV: sdvStats.pending,
    // Dropped verifications (SDV items that were unverified)
    droppedVerifications: 0, // Would need audit trail to track this
    dataQuality
  };

  res.json({ success: true, data: stats });
});

export const getAlerts = asyncHandler(async (req: Request, res: Response) => {
  // Get recent audit events as alerts
  const result = await pool.query(`
    SELECT audit_id, audit_date, audit_table, entity_name, user_id
    FROM audit_log_event
    ORDER BY audit_date DESC
    LIMIT 10
  `);

  res.json({ success: true, data: result.rows });
});

export const getMetrics = asyncHandler(async (req: Request, res: Response) => {
  const timeRange = req.query.timeRange as string || '24h';

  // Get form completion metrics
  const metricsResult = await pool.query(`
    SELECT 
      COUNT(*) as total_forms,
      COUNT(CASE WHEN sdv_status = true THEN 1 END) as verified_forms
    FROM event_crf
    WHERE status_id != 5
  `);

  res.json({
    success: true,
    data: {
      timeRange,
      metrics: metricsResult.rows[0]
    }
  });
});

export default { getStats, getAlerts, getMetrics };
