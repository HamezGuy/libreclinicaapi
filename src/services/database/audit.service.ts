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

/**
 * Get audit event types from database
 */
export const getAuditEventTypes = async (): Promise<any[]> => {
  logger.info('Getting audit event types');

  try {
    const query = `
      SELECT 
        audit_log_event_type_id as id,
        name,
        description
      FROM audit_log_event_type
      ORDER BY audit_log_event_type_id
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Get audit event types error', { error: error.message });
    return [];
  }
};

/**
 * Get auditable tables list
 */
export const getAuditableTables = async (): Promise<any[]> => {
  logger.info('Getting auditable tables');

  try {
    const query = `
      SELECT DISTINCT audit_table as name,
        COUNT(*) as event_count
      FROM audit_log_event
      GROUP BY audit_table
      ORDER BY event_count DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Get auditable tables error', { error: error.message });
    return [];
  }
};

/**
 * Get form/CRF specific audit trail
 */
export const getFormAudit = async (eventCrfId: number): Promise<any[]> => {
  logger.info('Getting form audit', { eventCrfId });

  try {
    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.audit_table,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        ale.entity_id,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        alet.name as event_type,
        ale.reason_for_change
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.event_crf_id = $1
      ORDER BY ale.audit_date DESC
    `;

    const result = await pool.query(query, [eventCrfId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get form audit error', { error: error.message });
    return [];
  }
};

/**
 * Get audit by date range with summary
 */
export const getAuditSummary = async (startDate: string, endDate: string): Promise<any> => {
  logger.info('Getting audit summary', { startDate, endDate });

  try {
    const query = `
      SELECT 
        DATE(ale.audit_date) as date,
        alet.name as event_type,
        COUNT(*) as count
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2
      GROUP BY DATE(ale.audit_date), alet.name
      ORDER BY date DESC, count DESC
    `;

    const result = await pool.query(query, [startDate, endDate]);

    // Group by date
    const summary: any = {};
    for (const row of result.rows) {
      const dateKey = row.date?.toISOString().split('T')[0];
      if (!summary[dateKey]) {
        summary[dateKey] = { date: dateKey, events: {}, total: 0 };
      }
      summary[dateKey].events[row.event_type] = parseInt(row.count);
      summary[dateKey].total += parseInt(row.count);
    }

    return {
      success: true,
      data: Object.values(summary)
    };
  } catch (error: any) {
    logger.error('Get audit summary error', { error: error.message });
    return { success: false, data: [] };
  }
};

/**
 * Get compliance report
 * Returns audit data formatted for 21 CFR Part 11 compliance reports
 */
export const getComplianceReport = async (request: {
  startDate: string;
  endDate: string;
  studyId?: number;
}): Promise<any> => {
  logger.info('Generating compliance report', request);

  try {
    const { startDate, endDate } = request;

    // Get summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT ale.user_id) as unique_users,
        COUNT(DISTINCT DATE(ale.audit_date)) as active_days,
        MIN(ale.audit_date) as first_event,
        MAX(ale.audit_date) as last_event
      FROM audit_log_event ale
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2
    `;

    const statsResult = await pool.query(statsQuery, [startDate, endDate]);
    const stats = statsResult.rows[0];

    // Get events by type
    const typeQuery = `
      SELECT 
        alet.name as event_type,
        COUNT(*) as count
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2
      GROUP BY alet.name
      ORDER BY count DESC
    `;

    const typeResult = await pool.query(typeQuery, [startDate, endDate]);

    // Get user activity
    const userQuery = `
      SELECT 
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        COUNT(*) as event_count
      FROM audit_log_event ale
      INNER JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2
      GROUP BY u.user_name, u.first_name, u.last_name
      ORDER BY event_count DESC
    `;

    const userResult = await pool.query(userQuery, [startDate, endDate]);

    // Get login events
    const loginQuery = `
      SELECT 
        aul.login_attempt_date,
        aul.user_name,
        aul.login_status
      FROM audit_user_login aul
      WHERE aul.login_attempt_date >= $1 AND aul.login_attempt_date <= $2
      ORDER BY aul.login_attempt_date DESC
      LIMIT 100
    `;

    const loginResult = await pool.query(loginQuery, [startDate, endDate]);

    return {
      success: true,
      data: {
        reportPeriod: { startDate, endDate },
        generatedAt: new Date().toISOString(),
        summary: {
          totalEvents: parseInt(stats.total_events),
          uniqueUsers: parseInt(stats.unique_users),
          activeDays: parseInt(stats.active_days),
          firstEvent: stats.first_event,
          lastEvent: stats.last_event
        },
        eventsByType: typeResult.rows.map(r => ({
          type: r.event_type,
          count: parseInt(r.count)
        })),
        userActivity: userResult.rows.map(r => ({
          userName: r.user_name,
          fullName: r.user_full_name,
          eventCount: parseInt(r.event_count)
        })),
        recentLogins: loginResult.rows
      }
    };
  } catch (error: any) {
    logger.error('Compliance report error', { error: error.message });
    return { success: false, message: error.message };
  }
};

export default {
  getAuditTrail,
  getSubjectAudit,
  getRecentAuditEvents,
  exportAuditTrailCSV,
  getAuditStatistics,
  getAuditEventTypes,
  getAuditableTables,
  getFormAudit,
  getAuditSummary,
  getComplianceReport
};

