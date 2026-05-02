/**
 * Monitoring Service
 *
 * Provides system-level monitoring with REAL query/SDV/validation counts.
 * Extracted from monitoring.controller.ts — all SQL lives here.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Types returned by this service
// ---------------------------------------------------------------------------

export interface SystemStats {
  systemHealth: {
    status: string;
    uptime: number;
    lastCheck: string;
  };
  activeUsers: number;
  activeStudies: number;
  totalQueries: number;
  openQueries: number;
  criticalQueries: number;
  totalValidations: number;
  pendingValidations: number;
  totalSDV: number;
  pendingSDV: number;
  droppedVerifications: number;
  dataQuality: {
    completeness: number;
    accuracy: number;
  };
}

export interface AlertEntry {
  auditId: number;
  auditDate: string;
  auditTable: string;
  entityName: string;
  userId: number;
}

export interface SystemMetrics {
  timeRange: string;
  metrics: {
    totalForms: number;
    verifiedForms: number;
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export const getSystemStats = async (): Promise<SystemStats> => {
  logger.info('Fetching system stats');

  const userCountResult = await pool.query(
    'SELECT COUNT(*) as count FROM user_account WHERE status_id = 1',
  );
  const studyCountResult = await pool.query(
    'SELECT COUNT(*) as count FROM study WHERE status_id = 1',
  );

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
        critical: parseInt(queryResult.rows[0].critical) || 0,
      };
    }
  } catch (error) {
    logger.warn('Could not fetch query stats', { error });
  }

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
        pending: parseInt(sdvResult.rows[0].pending) || 0,
      };
    }
  } catch (error) {
    logger.warn('Could not fetch SDV stats', { error });
  }

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
        pending: parseInt(validationResult.rows[0].pending) || 0,
      };
    }
  } catch (error) {
    logger.warn('Could not fetch validation stats', { error });
  }

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
      dataQuality.completeness =
        parseFloat(qualityResult.rows[0].completeness) || 0;
    }
  } catch (error) {
    logger.warn('Could not fetch data quality stats', { error });
  }

  return {
    systemHealth: {
      status: 'healthy',
      uptime: process.uptime(),
      lastCheck: new Date().toISOString(),
    },
    activeUsers: parseInt(userCountResult.rows[0].count),
    activeStudies: parseInt(studyCountResult.rows[0].count),
    totalQueries: queryStats.total,
    openQueries: queryStats.open,
    criticalQueries: queryStats.critical,
    totalValidations: validationStats.total,
    pendingValidations: validationStats.pending,
    totalSDV: sdvStats.total,
    pendingSDV: sdvStats.pending,
    droppedVerifications: 0,
    dataQuality,
  };
};

export const getRecentAlerts = async (
  limit: number = 10,
): Promise<AlertEntry[]> => {
  logger.info('Fetching recent alerts', { limit });

  const result = await pool.query(
    `
    SELECT audit_id, audit_date, audit_table, entity_name, user_id
    FROM audit_log_event
    ORDER BY audit_date DESC
    LIMIT $1
  `,
    [limit],
  );

  return result.rows.map((row: any) => ({
    auditId: row.auditId,
    auditDate: row.auditDate,
    auditTable: row.auditTable,
    entityName: row.entityName,
    userId: row.userId,
  }));
};

export const getSystemMetrics = async (
  timeRange: string = '24h',
): Promise<SystemMetrics> => {
  logger.info('Fetching system metrics', { timeRange });

  const metricsResult = await pool.query(`
    SELECT 
      COUNT(*) as total_forms,
      COUNT(CASE WHEN sdv_status = true THEN 1 END) as verified_forms
    FROM event_crf
    WHERE status_id != 5
  `);

  const raw = metricsResult.rows[0] || {};

  return {
    timeRange,
    metrics: {
      totalForms: parseInt(raw.total_forms) || 0,
      verifiedForms: parseInt(raw.verified_forms) || 0,
    },
  };
};
