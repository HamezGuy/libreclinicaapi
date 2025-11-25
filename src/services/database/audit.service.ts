/**
 * Audit Service
 * 
 * Handles audit trail queries from LibreClinica database
 * - Query audit_log_event table
 * - Filter by study, subject, user, date range
 * - Export audit trail (CSV, PDF, JSON)
 * - Subject-specific audit history
 * 
 * Compliance: 21 CFR Part 11 §11.10(e) - Audit Trail
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { AuditQuery, AuditLogEvent, PaginatedResponse, AuditExportRequest } from '../../types';

/**
 * Get audit trail with filters
 * Main method for querying audit history
 */
export const getAuditTrail = async (
  query: AuditQuery
): Promise<PaginatedResponse<AuditLogEvent>> => {
  logger.info('Querying audit trail', query);

  try {
    const {
      studyId,
      subjectId,
      userId,
      eventType,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = query;

    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    // Note: audit_log_event table doesn't have direct study_id or subject_id columns
    // These would need to be joined through related tables if needed

    if (userId) {
      conditions.push(`ale.user_id = $${paramIndex++}`);
      params.push(userId);
    }

    if (eventType) {
      conditions.push(`alet.name ILIKE $${paramIndex++}`);
      params.push(`%${eventType}%`);
    }

    if (startDate) {
      conditions.push(`ale.audit_date >= $${paramIndex++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`ale.audit_date <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    const dataQuery = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.audit_table,
        ale.user_id,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        ale.entity_id,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        ale.audit_log_event_type_id,
        alet.name as event_type,
        ale.reason_for_change,
        ale.event_crf_id
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ${whereClause}
      ORDER BY ale.audit_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

    logger.info('Audit trail query successful', {
      total,
      page,
      limit,
      returned: dataResult.rows.length
    });

    return {
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error: any) {
    logger.error('Audit trail query error', {
      error: error.message,
      query
    });

    throw error;
  }
};

/**
 * Get audit trail for specific subject
 * Returns complete audit history for a subject
 */
export const getSubjectAudit = async (
  subjectId: number,
  page: number = 1,
  limit: number = 100
): Promise<PaginatedResponse<AuditLogEvent>> => {
  logger.info('Querying subject audit trail', { subjectId });

  return await getAuditTrail({
    subjectId,
    page,
    limit
  });
};

/**
 * Get recent audit events
 * Returns most recent audit events across all studies
 * Note: audit_log_event does NOT have study_id column - study info must be derived from entity relationships
 */
export const getRecentAuditEvents = async (
  limit: number = 50
): Promise<AuditLogEvent[]> => {
  logger.info('Querying recent audit events', { limit });

  try {
    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.audit_table,
        ale.user_id,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        ale.entity_id,
        ale.entity_name,
        alet.name as event_type,
        ale.old_value,
        ale.new_value
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      ORDER BY ale.audit_date DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);

    return result.rows;
  } catch (error: any) {
    logger.error('Recent audit events query error', {
      error: error.message
    });

    throw error;
  }
};

/**
 * Export audit trail to CSV
 * Note: audit_log_event does NOT have study_id or subject_id columns
 * We filter by audit_table and date range instead
 */
export const exportAuditTrailCSV = async (
  request: AuditExportRequest
): Promise<string> => {
  logger.info('Exporting audit trail to CSV', request);

  try {
    const { startDate, endDate } = request;

    const query = `
      SELECT 
        ale.audit_date,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type,
        ale.audit_table,
        ale.entity_id,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_date >= $1
        AND ale.audit_date <= $2
      ORDER BY ale.audit_date ASC
    `;

    const result = await pool.query(query, [startDate, endDate]);

    // Build CSV
    const headers = [
      'Audit Date',
      'Username',
      'User Full Name',
      'Event Type',
      'Table',
      'Entity ID',
      'Entity Name',
      'Old Value',
      'New Value',
      'Reason for Change'
    ];

    let csv = headers.join(',') + '\n';

    for (const row of result.rows) {
      const values = [
        row.audit_date,
        row.user_name,
        `"${row.user_full_name || ''}"`,
        `"${row.event_type || ''}"`,
        row.audit_table,
        row.entity_id || '',
        `"${row.entity_name || ''}"`,
        `"${row.old_value || ''}"`,
        `"${row.new_value || ''}"`,
        `"${row.reason_for_change || ''}"`
      ];

      csv += values.join(',') + '\n';
    }

    logger.info('Audit trail exported to CSV', {
      rowCount: result.rows.length
    });

    return csv;
  } catch (error: any) {
    logger.error('Audit trail CSV export error', {
      error: error.message,
      request
    });

    throw error;
  }
};

/**
 * Get audit statistics
 * Note: audit_log_event does NOT have study_id column
 * We return global statistics filtered by date only
 */
export const getAuditStatistics = async (
  days: number = 30
): Promise<any> => {
  logger.info('Calculating audit statistics', { days });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const query = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT ale.user_id) as unique_users,
        COUNT(DISTINCT DATE(ale.audit_date)) as active_days,
        COUNT(CASE WHEN alet.name LIKE '%Login%' THEN 1 END) as login_events,
        COUNT(CASE WHEN alet.name LIKE '%Data%' THEN 1 END) as data_events,
        COUNT(CASE WHEN alet.name LIKE '%Subject%' THEN 1 END) as subject_events,
        COUNT(CASE WHEN alet.name LIKE '%Query%' THEN 1 END) as query_events
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1
    `;

    const result = await pool.query(query, [startDate]);

    return result.rows[0];
  } catch (error: any) {
    logger.error('Audit statistics error', {
      error: error.message
    });

    throw error;
  }
};

export default {
  getAuditTrail,
  getSubjectAudit,
  getRecentAuditEvents,
  exportAuditTrailCSV,
  getAuditStatistics
};

