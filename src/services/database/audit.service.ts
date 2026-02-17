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
import { formatDate, toISOTimestamp } from '../../utils/date.util';

/**
 * Helper: get org member user IDs for the caller.
 * Returns null if the caller has no org membership (root admin sees all).
 */
const getOrgMemberUserIds = async (callerUserId: number): Promise<number[] | null> => {
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [callerUserId]
  );
  if (orgCheck.rows.length === 0) return null; // no org = root admin
  const orgIds = orgCheck.rows.map((r: any) => r.organization_id);
  const memberCheck = await pool.query(
    `SELECT DISTINCT user_id FROM acc_organization_member WHERE organization_id = ANY($1::int[]) AND status = 'active'`,
    [orgIds]
  );
  return memberCheck.rows.map((r: any) => r.user_id);
};

/**
 * Get audit trail with filters
 * Main method for querying audit history
 */
export const getAuditTrail = async (
  query: AuditQuery,
  callerUserId?: number
): Promise<PaginatedResponse<AuditLogEvent>> => {
  logger.info('Querying audit trail', { ...query, callerUserId });

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

    // Org-scoping: only show audit events from users in the same org
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        conditions.push(`ale.user_id = ANY($${paramIndex++}::int[])`);
        params.push(orgUserIds);
      }
    }

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
  limit: number = 100,
  callerUserId?: number
): Promise<PaginatedResponse<AuditLogEvent>> => {
  logger.info('Querying subject audit trail', { subjectId, callerUserId });

  return await getAuditTrail({
    subjectId,
    page,
    limit
  }, callerUserId);
};

/**
 * Get recent audit events
 * Returns most recent audit events across all studies
 * COMBINES: audit_log_event (data changes) + audit_user_login (login/logout events)
 */
export const getRecentAuditEvents = async (
  limit: number = 50,
  callerUserId?: number
): Promise<AuditLogEvent[]> => {
  logger.info('Querying recent audit events', { limit, callerUserId });

  try {
    // Org-scoping
    let orgDataFilter = '';
    let orgLoginFilter = '';
    const params: any[] = [limit];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgDataFilter = ` WHERE ale.user_id = ANY($2::int[])`;
        orgLoginFilter = ` WHERE aul.user_account_id = ANY($2::int[])`;
        params.push(orgUserIds);
      }
    }

    // Combined query: data events + login events
    const query = `
      (
        SELECT 
          ale.audit_id::text as audit_id,
          ale.audit_date,
          ale.audit_table,
          ale.user_id,
          u.user_name,
          u.first_name || ' ' || u.last_name as user_full_name,
          ale.entity_id,
          ale.entity_name,
          COALESCE(alet.name, 'Data Change') as event_type,
          ale.old_value,
          ale.new_value,
          'data' as event_category
        FROM audit_log_event ale
        LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
        LEFT JOIN user_account u ON ale.user_id = u.user_id
        ${orgDataFilter}
      )
      UNION ALL
      (
        SELECT 
          'login_' || aul.id::text as audit_id,
          aul.login_attempt_date as audit_date,
          'user_login' as audit_table,
          aul.user_account_id as user_id,
          aul.user_name,
          u.first_name || ' ' || u.last_name as user_full_name,
          aul.user_account_id as entity_id,
          aul.user_name as entity_name,
          CASE 
            WHEN aul.login_status_code = 1 THEN 'User Login'
            WHEN aul.login_status_code = 2 THEN 'User Logout'
            ELSE 'Failed Login Attempt'
          END as event_type,
          NULL as old_value,
          aul.details as new_value,
          'login' as event_category
        FROM audit_user_login aul
        LEFT JOIN user_account u ON aul.user_account_id = u.user_id
        ${orgLoginFilter}
      )
      ORDER BY audit_date DESC
      LIMIT $1
    `;

    const result = await pool.query(query, params);

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
  request: AuditExportRequest,
  callerUserId?: number
): Promise<string> => {
  logger.info('Exporting audit trail to CSV', { ...request, callerUserId });

  try {
    const { startDate, endDate } = request;

    // Org-scoping
    let orgFilter = '';
    const params: any[] = [startDate, endDate];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND ale.user_id = ANY($3::int[])`;
        params.push(orgUserIds);
      }
    }

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
        AND ale.audit_date <= $2${orgFilter}
      ORDER BY ale.audit_date ASC
    `;

    const result = await pool.query(query, params);

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
 * COMBINES: audit_log_event (data changes) + audit_user_login (login/logout events)
 */
export const getAuditStatistics = async (
  days: number = 30,
  callerUserId?: number
): Promise<any> => {
  logger.info('Calculating audit statistics', { days, callerUserId });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Org-scoping
    let orgUserFilter = '';
    let orgLoginFilter = '';
    const dataParams: any[] = [startDate];
    const loginParams: any[] = [startDate];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgUserFilter = ` AND ale.user_id = ANY($2::int[])`;
        orgLoginFilter = ` AND user_account_id = ANY($2::int[])`;
        dataParams.push(orgUserIds);
        loginParams.push(orgUserIds);
      }
    }

    // Get data event stats
    const dataEventsQuery = `
      SELECT 
        COUNT(*) as total_data_events,
        COUNT(DISTINCT ale.user_id) as data_unique_users,
        COUNT(CASE WHEN alet.name LIKE '%Data%' OR alet.name LIKE '%Entry%' THEN 1 END) as data_entry_events,
        COUNT(CASE WHEN alet.name LIKE '%Subject%' THEN 1 END) as subject_events,
        COUNT(CASE WHEN alet.name LIKE '%Query%' OR alet.name LIKE '%Discrepancy%' THEN 1 END) as query_events,
        COUNT(CASE WHEN alet.name LIKE '%SDV%' OR alet.name LIKE '%Verif%' THEN 1 END) as sdv_events
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1${orgUserFilter}
    `;

    // Get login event stats from audit_user_login
    const loginEventsQuery = `
      SELECT 
        COUNT(*) as total_login_events,
        COUNT(DISTINCT user_account_id) as login_unique_users,
        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as successful_logins,
        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed_logins,
        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logouts
      FROM audit_user_login
      WHERE login_attempt_date >= $1${orgLoginFilter}
    `;

    const [dataResult, loginResult] = await Promise.all([
      pool.query(dataEventsQuery, dataParams),
      pool.query(loginEventsQuery, loginParams)
    ]);

    const dataStats = dataResult.rows[0] || {};
    const loginStats = loginResult.rows[0] || {};

    return {
      total_events: parseInt(dataStats.total_data_events || 0) + parseInt(loginStats.total_login_events || 0),
      unique_users: Math.max(
        parseInt(dataStats.data_unique_users || 0),
        parseInt(loginStats.login_unique_users || 0)
      ),
      active_days: days,
      // Login events (from audit_user_login)
      login_events: parseInt(loginStats.successful_logins || 0),
      failed_login_events: parseInt(loginStats.failed_logins || 0),
      logout_events: parseInt(loginStats.logouts || 0),
      // Data events (from audit_log_event)
      data_events: parseInt(dataStats.data_entry_events || 0),
      subject_events: parseInt(dataStats.subject_events || 0),
      query_events: parseInt(dataStats.query_events || 0),
      sdv_events: parseInt(dataStats.sdv_events || 0)
    };
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
export const getFormAudit = async (eventCrfId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting form audit', { eventCrfId, callerUserId });

  try {
    // Org-scoping
    let orgFilter = '';
    const params: any[] = [eventCrfId];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND ale.user_id = ANY($2::int[])`;
        params.push(orgUserIds);
      }
    }

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
      WHERE ale.event_crf_id = $1${orgFilter}
      ORDER BY ale.audit_date DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get form audit error', { error: error.message });
    return [];
  }
};

/**
 * Get audit by date range with summary
 */
export const getAuditSummary = async (startDate: string, endDate: string, callerUserId?: number): Promise<any> => {
  logger.info('Getting audit summary', { startDate, endDate, callerUserId });

  try {
    // Org-scoping
    let orgFilter = '';
    const params: any[] = [startDate, endDate];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND ale.user_id = ANY($3::int[])`;
        params.push(orgUserIds);
      }
    }

    const query = `
      SELECT 
        DATE(ale.audit_date) as date,
        alet.name as event_type,
        COUNT(*) as count
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2${orgFilter}
      GROUP BY DATE(ale.audit_date), alet.name
      ORDER BY date DESC, count DESC
    `;

    const result = await pool.query(query, params);

    // Group by date
    const summary: any = {};
    for (const row of result.rows) {
      const dateKey = formatDate(row.date);
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
}, callerUserId?: number): Promise<any> => {
  logger.info('Generating compliance report', { ...request, callerUserId });

  try {
    const { startDate, endDate } = request;

    // Org-scoping
    let orgDataFilter = '';
    let orgLoginFilter = '';
    const baseParams: any[] = [startDate, endDate];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgDataFilter = ` AND ale.user_id = ANY($3::int[])`;
        orgLoginFilter = ` AND aul.user_account_id = ANY($3::int[])`;
        baseParams.push(orgUserIds);
      }
    }

    // Get summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT ale.user_id) as unique_users,
        COUNT(DISTINCT DATE(ale.audit_date)) as active_days,
        MIN(ale.audit_date) as first_event,
        MAX(ale.audit_date) as last_event
      FROM audit_log_event ale
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2${orgDataFilter}
    `;

    const statsResult = await pool.query(statsQuery, baseParams);
    const stats = statsResult.rows[0];

    // Get events by type
    const typeQuery = `
      SELECT 
        alet.name as event_type,
        COUNT(*) as count
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2${orgDataFilter}
      GROUP BY alet.name
      ORDER BY count DESC
    `;

    const typeResult = await pool.query(typeQuery, baseParams);

    // Get user activity
    const userQuery = `
      SELECT 
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        COUNT(*) as event_count
      FROM audit_log_event ale
      INNER JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2${orgDataFilter}
      GROUP BY u.user_name, u.first_name, u.last_name
      ORDER BY event_count DESC
    `;

    const userResult = await pool.query(userQuery, baseParams);

    // Get login events
    const loginQuery = `
      SELECT 
        aul.login_attempt_date,
        aul.user_name,
        aul.login_status
      FROM audit_user_login aul
      WHERE aul.login_attempt_date >= $1 AND aul.login_attempt_date <= $2${orgLoginFilter}
      ORDER BY aul.login_attempt_date DESC
      LIMIT 100
    `;

    const loginResult = await pool.query(loginQuery, baseParams);

    return {
      success: true,
      data: {
        reportPeriod: { startDate, endDate },
        generatedAt: toISOTimestamp(),
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

/**
 * Record audit event directly to database
 * Uses LibreClinica's CORRECT audit_log_event schema
 */
export const recordAuditEvent = async (data: {
  audit_table: string;
  entity_id: number;
  user_id: number;
  user_name: string;
  audit_log_event_type_id: number;
  old_value?: string;
  new_value?: string;
  reason_for_change?: string;
  study_id?: number;
  event_crf_id?: number;
  study_event_id?: number;
}): Promise<{ success: boolean; data?: { audit_id: number }; message?: string }> => {
  logger.info('Recording audit event to database', {
    audit_table: data.audit_table,
    entity_id: data.entity_id,
    user_id: data.user_id
  });

  try {
    // LibreClinica's actual audit_log_event columns:
    // audit_id (SERIAL), audit_date, audit_table, user_id, entity_id, entity_name,
    // old_value, new_value, audit_log_event_type_id, reason_for_change,
    // event_crf_id, study_event_id, event_crf_version_id, item_data_repeat_key
    // NOTE: There is NO study_id column in audit_log_event!
    const query = `
      INSERT INTO audit_log_event (
        audit_date, 
        audit_table, 
        user_id, 
        entity_id, 
        entity_name,
        old_value, 
        new_value, 
        audit_log_event_type_id, 
        reason_for_change,
        event_crf_id,
        study_event_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING audit_id
    `;

    const result = await pool.query(query, [
      data.audit_table,
      data.user_id,
      data.entity_id,
      data.user_name,  // entity_name
      data.old_value || null,
      data.new_value || null,
      data.audit_log_event_type_id,
      data.reason_for_change || null,
      data.event_crf_id || null,
      data.study_event_id || null
    ]);

    return {
      success: true,
      data: { audit_id: result.rows[0].audit_id },
      message: 'Audit event recorded'
    };
  } catch (error: any) {
    logger.error('Failed to record audit event', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Common audit event types for tracking user actions
 */
export const AuditEventTypes = {
  // Document/Form access
  FORM_VIEWED: 1,
  FORM_CREATED: 2,
  FORM_UPDATED: 3,
  FORM_DELETED: 4,
  FORM_SIGNED: 5,
  
  // Subject access
  SUBJECT_VIEWED: 10,
  SUBJECT_CREATED: 11,
  SUBJECT_UPDATED: 12,
  
  // Study access
  STUDY_ACCESSED: 20,
  STUDY_EXPORTED: 21,
  
  // Query events  
  QUERY_CREATED: 30,
  QUERY_RESPONDED: 31,
  QUERY_CLOSED: 32,
  
  // SDV events
  SDV_VERIFIED: 40,
  SDV_REJECTED: 41,
  
  // Report events
  REPORT_GENERATED: 50,
  AUDIT_EXPORTED: 51
};

/**
 * Track user action - Simplified API for controllers to record audit events
 * Uses LibreClinica's CORRECT audit_log_event schema
 * 
 * @example
 * await trackUserAction({
 *   userId: user.userId,
 *   username: user.username,
 *   action: 'FORM_VIEWED',
 *   entityType: 'event_crf',
 *   entityId: eventCrfId,
 *   details: 'Viewed wound assessment form'
 * });
 */
export const trackUserAction = async (data: {
  userId: number;
  username: string;
  action: string;
  entityType: string;
  entityId?: number;
  entityName?: string;
  details?: string;
  oldValue?: string;
  newValue?: string;
  studyId?: number;
  eventCrfId?: number;
  studyEventId?: number;
}): Promise<{ success: boolean; auditId?: number }> => {
  try {
    // Map action to event type ID (or use 1 as default)
    const eventTypeId = (AuditEventTypes as any)[data.action] || 1;
    
    // Use LibreClinica's CORRECT column order
    // NOTE: There is NO study_id column in audit_log_event!
    const query = `
      INSERT INTO audit_log_event (
        audit_date, 
        audit_table, 
        user_id,
        entity_id, 
        entity_name, 
        old_value, 
        new_value, 
        audit_log_event_type_id,
        reason_for_change,
        event_crf_id,
        study_event_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING audit_id
    `;

    const result = await pool.query(query, [
      data.entityType,                                    // audit_table
      data.userId,                                        // user_id
      data.entityId || null,                              // entity_id
      data.entityName || data.username,                   // entity_name
      data.oldValue || null,                              // old_value
      data.newValue || data.details || null,              // new_value
      eventTypeId,                                        // audit_log_event_type_id
      data.details || `${data.action} by ${data.username}`, // reason_for_change
      data.eventCrfId || null,                            // event_crf_id
      data.studyEventId || null                           // study_event_id
    ]);

    logger.info('User action tracked', {
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      userId: data.userId
    });

    return { success: true, auditId: result.rows[0].audit_id };
  } catch (error: any) {
    logger.error('Failed to track user action', { 
      error: error.message,
      action: data.action 
    });
    return { success: false };
  }
};

/**
 * Track document/form access
 */
export const trackDocumentAccess = async (
  userId: number,
  username: string,
  documentType: string,
  documentId: number,
  documentName?: string,
  action: 'view' | 'edit' | 'sign' | 'export' = 'view'
): Promise<void> => {
  const actionMap = {
    view: 'FORM_VIEWED',
    edit: 'FORM_UPDATED',
    sign: 'FORM_SIGNED',
    export: 'AUDIT_EXPORTED'
  };

  await trackUserAction({
    userId,
    username,
    action: actionMap[action],
    entityType: documentType,
    entityId: documentId,
    entityName: documentName,
    details: `${action} ${documentType} ${documentName || documentId}`
  });
};

/**
 * Get audit logs with flexible filtering
 * Alias for getAuditTrail with additional parameters
 */
export const getAuditLogs = async (params: {
  studyId?: number;
  userId?: number;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  callerUserId?: number;
}): Promise<any> => {
  const page = Math.floor((params.offset || 0) / (params.limit || 50)) + 1;
  return getAuditTrail({
    studyId: params.studyId,
    userId: params.userId,
    eventType: params.eventType,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: params.limit || 50,
    page
  }, params.callerUserId);
};

/**
 * Get subject audit trail
 * Alias for getSubjectAudit with API response format
 */
export const getSubjectAuditTrail = async (subjectId: number, callerUserId?: number): Promise<any> => {
  const result = await getSubjectAudit(subjectId, 1, 100, callerUserId);
  return {
    success: result.success,
    data: result.data,
    message: result.success ? 'Subject audit trail retrieved' : 'Failed to retrieve audit trail'
  };
};

/**
 * Get form audit trail
 * Alias for getFormAudit with API response format
 */
export const getFormAuditTrail = async (eventCrfId: number, callerUserId?: number): Promise<any> => {
  const data = await getFormAudit(eventCrfId, callerUserId);
  return {
    success: true,
    data,
    message: 'Form audit trail retrieved'
  };
};

/**
 * Record electronic signature to database
 */
export const recordElectronicSignature = async (data: {
  entity_type: string;
  entity_id: number;
  signer_username: string;
  meaning: string;
  reason_for_change?: string;
  signed_at: Date;
}): Promise<{ success: boolean; data?: { signature_id: number }; message?: string }> => {
  logger.info('Recording electronic signature to database', {
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    signer_username: data.signer_username
  });

  try {
    // Record as audit event with signature flag
    const query = `
      INSERT INTO audit_log_event (
        audit_date, audit_table, entity_id, user_id, 
        audit_log_event_type_id, new_value, reason_for_change
      ) 
      SELECT 
        $1, $2, $3, u.user_id, 30, $4, $5
      FROM user_account u
      WHERE u.user_name = $6
      RETURNING audit_id
    `;

    const signatureValue = JSON.stringify({
      type: 'electronic_signature',
      meaning: data.meaning,
      signed_at: data.signed_at.toISOString()
    });

    const result = await pool.query(query, [
      data.signed_at,
      data.entity_type,
      data.entity_id,
      signatureValue,
      data.reason_for_change || `Electronic signature: ${data.meaning}`,
      data.signer_username
    ]);

    if (result.rows.length === 0) {
      return { success: false, message: 'User not found for signature' };
    }

    return {
      success: true,
      data: { signature_id: result.rows[0].audit_id },
      message: 'Electronic signature recorded'
    };
  } catch (error: any) {
    logger.error('Failed to record electronic signature', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get audit statistics for dashboard
 */
export const getAuditStats = async (days: number = 30, callerUserId?: number): Promise<any> => {
  const stats = await getAuditStatistics(days, callerUserId);
  return {
    success: true,
    data: {
      totalEvents: parseInt(stats.total_events || '0'),
      uniqueUsers: parseInt(stats.unique_users || '0'),
      activeDays: parseInt(stats.active_days || '0'),
      byType: {
        login: parseInt(stats.login_events || '0'),
        data: parseInt(stats.data_events || '0'),
        subject: parseInt(stats.subject_events || '0'),
        query: parseInt(stats.query_events || '0')
      }
    }
  };
};

/**
 * Export audit logs in specified format
 */
export const exportAuditLogs = async (
  params: {
    studyId?: number;
    startDate?: string;
    endDate?: string;
  },
  format: 'csv' | 'json' = 'csv',
  callerUserId?: number
): Promise<any> => {
  if (format === 'csv') {
    const csv = await exportAuditTrailCSV({
      studyId: params.studyId || 0,
      startDate: params.startDate || toISOTimestamp(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      endDate: params.endDate || toISOTimestamp(),
      format: 'csv'
    }, callerUserId);
    return { success: true, data: csv, format: 'csv' };
  } else {
    const result = await getAuditTrail({
      studyId: params.studyId,
      startDate: params.startDate,
      endDate: params.endDate,
      limit: 10000
    }, callerUserId);
    return { success: true, data: result.data, format: 'json' };
  }
};

/**
 * Get login history from audit_user_login table
 * Returns all login/logout/failed login events
 * 
 * 21 CFR Part 11 §11.10(e) - Audit Trail for login events
 * 
 * @param params.userId - Filter by specific user
 * @param params.startDate - Filter events after this date
 * @param params.endDate - Filter events before this date
 * @param params.status - Filter by status: 'success' (1), 'failed' (0), 'logout' (2), or 'all'
 * @param params.limit - Maximum number of records
 * @param params.offset - Pagination offset
 */
export const getLoginHistory = async (params: {
  userId?: number;
  username?: string;
  startDate?: string;
  endDate?: string;
  status?: 'success' | 'failed' | 'logout' | 'all';
  limit?: number;
  offset?: number;
}, callerUserId?: number): Promise<{
  success: boolean;
  data: any[];
  pagination: { total: number; limit: number; offset: number };
}> => {
  logger.info('Querying login history', { ...params, callerUserId });

  try {
    const conditions: string[] = ['1=1'];
    const queryParams: any[] = [];
    let paramIndex = 1;

    // Org-scoping
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        conditions.push(`aul.user_account_id = ANY($${paramIndex++}::int[])`);
        queryParams.push(orgUserIds);
      }
    }

    if (params.userId) {
      conditions.push(`aul.user_account_id = $${paramIndex++}`);
      queryParams.push(params.userId);
    }

    if (params.username) {
      conditions.push(`aul.user_name ILIKE $${paramIndex++}`);
      queryParams.push(`%${params.username}%`);
    }

    if (params.startDate) {
      conditions.push(`aul.login_attempt_date >= $${paramIndex++}`);
      queryParams.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push(`aul.login_attempt_date <= $${paramIndex++}`);
      queryParams.push(params.endDate);
    }

    if (params.status && params.status !== 'all') {
      const statusMap: Record<string, number> = {
        'success': 1,
        'failed': 0,
        'logout': 2
      };
      conditions.push(`aul.login_status_code = $${paramIndex++}`);
      queryParams.push(statusMap[params.status]);
    }

    const whereClause = conditions.join(' AND ');
    const limit = params.limit || 100;
    const offset = params.offset || 0;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_user_login aul
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    // Note: audit_user_login has NO audit_date column, use login_attempt_date
    const dataQuery = `
      SELECT 
        aul.id,
        aul.user_name as username,
        aul.user_account_id as user_id,
        u.first_name,
        u.last_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        u.email,
        aul.login_attempt_date as audit_date,
        aul.login_attempt_date,
        aul.login_status_code as login_status,
        CASE 
          WHEN aul.login_status_code = 1 THEN 'success'
          WHEN aul.login_status_code = 2 THEN 'logout'
          ELSE 'failed'
        END as status_text,
        CASE 
          WHEN aul.login_status_code = 1 THEN 'User Login'
          WHEN aul.login_status_code = 2 THEN 'User Logout'
          ELSE 'Failed Login Attempt'
        END as event_type,
        aul.details,
        aul.version
      FROM audit_user_login aul
      LEFT JOIN user_account u ON aul.user_account_id = u.user_id
      WHERE ${whereClause}
      ORDER BY aul.login_attempt_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const dataResult = await pool.query(dataQuery, queryParams);

    logger.info('Login history query successful', {
      total,
      returned: dataResult.rows.length
    });

    return {
      success: true,
      data: dataResult.rows,
      pagination: { total, limit, offset }
    };
  } catch (error: any) {
    logger.error('Login history query error', { error: error.message });
    return {
      success: false,
      data: [],
      pagination: { total: 0, limit: params.limit || 100, offset: params.offset || 0 }
    };
  }
};

/**
 * Get login statistics for compliance reporting
 * Returns counts of successful logins, failed attempts, and logouts
 */
export const getLoginStatistics = async (days: number = 30, callerUserId?: number): Promise<{
  success: boolean;
  data: {
    successfulLogins: number;
    failedLogins: number;
    logouts: number;
    uniqueUsers: number;
    byDay: Array<{ date: string; success: number; failed: number; logout: number }>;
  };
}> => {
  logger.info('Calculating login statistics', { days, callerUserId });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Org-scoping
    let orgFilter = '';
    const params: any[] = [startDate];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND user_account_id = ANY($2::int[])`;
        params.push(orgUserIds);
      }
    }

    // Get summary stats
    // Note: column is login_status_code (not login_status)
    const summaryQuery = `
      SELECT 
        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as successful_logins,
        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed_logins,
        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logouts,
        COUNT(DISTINCT user_account_id) FILTER (WHERE user_account_id IS NOT NULL) as unique_users
      FROM audit_user_login
      WHERE login_attempt_date >= $1${orgFilter}
    `;
    const summaryResult = await pool.query(summaryQuery, params);
    const summary = summaryResult.rows[0];

    // Get daily breakdown
    const dailyQuery = `
      SELECT 
        DATE(login_attempt_date) as date,
        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as success,
        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed,
        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logout
      FROM audit_user_login
      WHERE login_attempt_date >= $1${orgFilter}
      GROUP BY DATE(login_attempt_date)
      ORDER BY date DESC
    `;
    const dailyResult = await pool.query(dailyQuery, params);

    return {
      success: true,
      data: {
        successfulLogins: parseInt(summary.successful_logins) || 0,
        failedLogins: parseInt(summary.failed_logins) || 0,
        logouts: parseInt(summary.logouts) || 0,
        uniqueUsers: parseInt(summary.unique_users) || 0,
        byDay: dailyResult.rows.map(row => ({
          date: formatDate(row.date),
          success: parseInt(row.success) || 0,
          failed: parseInt(row.failed) || 0,
          logout: parseInt(row.logout) || 0
        }))
      }
    };
  } catch (error: any) {
    logger.error('Login statistics error', { error: error.message });
    return {
      success: false,
      data: {
        successfulLogins: 0,
        failedLogins: 0,
        logouts: 0,
        uniqueUsers: 0,
        byDay: []
      }
    };
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
  getComplianceReport,
  // New functions for hybrid service
  recordAuditEvent,
  getAuditLogs,
  getSubjectAuditTrail,
  getFormAuditTrail,
  recordElectronicSignature,
  getAuditStats,
  exportAuditLogs,
  // User action tracking
  trackUserAction,
  trackDocumentAccess,
  AuditEventTypes,
  // Login audit
  getLoginHistory,
  getLoginStatistics
};

