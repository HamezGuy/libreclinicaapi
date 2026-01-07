/**
 * Dashboard Service
 * 
 * Provides analytics and statistics for dashboards
 * This is a RED X feature - LibreClinica has NO dashboard functionality!
 * 
 * Dashboard Features:
 * - Enrollment statistics (by month, quarter, year)
 * - Form completion rates
 * - Query statistics
 * - User activity tracking
 * - Study progress metrics
 * 
 * All data EXISTS in LibreClinica DB, we just need to query and aggregate it!
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import {
  EnrollmentStats,
  CompletionStats,
  QueryStats,
  UserActivityStats,
  MonthlyEnrollment
} from '../../types';

/**
 * Get enrollment statistics
 * RED X Feature: Enrollment Dashboard
 */
export const getEnrollmentStats = async (
  studyId: number,
  startDate?: Date,
  endDate?: Date
): Promise<EnrollmentStats> => {
  logger.info('Getting enrollment statistics', { studyId, startDate, endDate });

  try {
    const start = startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1));
    const end = endDate || new Date();

    // Get overall counts
    const countsQuery = `
      SELECT 
        COUNT(*) as total_subjects,
        COUNT(CASE WHEN st.name = 'available' THEN 1 END) as active_subjects,
        COUNT(CASE WHEN st.name = 'signed' THEN 1 END) as completed_subjects,
        COUNT(CASE WHEN st.name = 'removed' OR st.name = 'withdrawn' THEN 1 END) as withdrawn_subjects,
        COUNT(CASE WHEN st.name = 'screening' THEN 1 END) as screened_subjects
      FROM study_subject ss
      LEFT JOIN status st ON ss.status_id = st.status_id
      WHERE ss.study_id = $1
    `;

    const countsResult = await pool.query(countsQuery, [studyId]);
    const counts = countsResult.rows[0];

    // Get enrollment by month
    const monthlyQuery = `
      SELECT 
        TO_CHAR(ss.enrollment_date, 'Mon') as month,
        EXTRACT(YEAR FROM ss.enrollment_date) as year,
        COUNT(*) as count
      FROM study_subject ss
      WHERE ss.study_id = $1
        AND ss.enrollment_date >= $2
        AND ss.enrollment_date <= $3
      GROUP BY TO_CHAR(ss.enrollment_date, 'Mon'), EXTRACT(YEAR FROM ss.enrollment_date), EXTRACT(MONTH FROM ss.enrollment_date)
      ORDER BY year, EXTRACT(MONTH FROM ss.enrollment_date)
    `;

    const monthlyResult = await pool.query(monthlyQuery, [studyId, start, end]);

    // Calculate cumulative enrollment
    let cumulative = 0;
    const enrollmentByMonth: MonthlyEnrollment[] = monthlyResult.rows.map(row => {
      cumulative += parseInt(row.count);
      return {
        month: row.month,
        year: parseInt(row.year),
        count: parseInt(row.count),
        cumulative
      };
    });

    // Calculate enrollment rate (subjects per month)
    const monthsActive = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
    const enrollmentRate = parseInt(counts.total_subjects) / monthsActive;

    // Get target enrollment from study table
    const targetQuery = `
      SELECT expected_total_enrollment
      FROM study
      WHERE study_id = $1
    `;

    const targetResult = await pool.query(targetQuery, [studyId]);
    const targetEnrollment = targetResult.rows[0]?.expected_total_enrollment || null;

    const stats: EnrollmentStats = {
      totalSubjects: parseInt(counts.total_subjects),
      activeSubjects: parseInt(counts.active_subjects),
      completedSubjects: parseInt(counts.completed_subjects),
      withdrawnSubjects: parseInt(counts.withdrawn_subjects),
      screenedSubjects: parseInt(counts.screened_subjects),
      enrollmentByMonth,
      enrollmentRate: Math.round(enrollmentRate * 100) / 100,
      targetEnrollment
    };

    logger.info('Enrollment statistics retrieved', {
      studyId,
      totalSubjects: stats.totalSubjects
    });

    return stats;
  } catch (error: any) {
    logger.error('Enrollment statistics error', {
      error: error.message,
      studyId
    });

    throw error;
  }
};

/**
 * Get form completion statistics
 * RED X Feature: Completion Dashboard
 */
export const getCompletionStats = async (studyId: number): Promise<CompletionStats> => {
  logger.info('Getting completion statistics', { studyId });

  try {
    // Get overall completion counts
    const overallQuery = `
      SELECT 
        COUNT(*) as total_crfs,
        COUNT(CASE WHEN cs.name IN ('complete', 'signed') THEN 1 END) as completed_crfs,
        COUNT(CASE WHEN cs.name NOT IN ('complete', 'signed') THEN 1 END) as incomplete_crfs
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE ss.study_id = $1
    `;

    const overallResult = await pool.query(overallQuery, [studyId]);
    const overall = overallResult.rows[0];

    const totalCRFs = parseInt(overall.total_crfs);
    const completedCRFs = parseInt(overall.completed_crfs);
    const incompleteCRFs = parseInt(overall.incomplete_crfs);
    const completionPercentage = totalCRFs > 0 
      ? Math.round((completedCRFs / totalCRFs) * 100) 
      : 0;

    // Get completion by form
    const byFormQuery = `
      SELECT 
        c.crf_id,
        c.name as crf_name,
        COUNT(*) as total_expected,
        COUNT(CASE WHEN cs.name IN ('complete', 'signed') THEN 1 END) as completed,
        ROUND(COUNT(CASE WHEN cs.name IN ('complete', 'signed') THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as completion_percentage
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE ss.study_id = $1
      GROUP BY c.crf_id, c.name
      ORDER BY completion_percentage DESC
    `;

    const byFormResult = await pool.query(byFormQuery, [studyId]);

    const completionByForm = byFormResult.rows.map(row => ({
      crfId: row.crf_id,
      crfName: row.crf_name,
      totalExpected: parseInt(row.total_expected),
      completed: parseInt(row.completed),
      completionPercentage: parseFloat(row.completion_percentage)
    }));

    // Calculate average completion time
    const avgTimeQuery = `
      SELECT 
        AVG(EXTRACT(EPOCH FROM (ec.date_updated - ec.date_created)) / 86400) as avg_days
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE ss.study_id = $1
        AND cs.name IN ('complete', 'signed')
        AND ec.date_updated IS NOT NULL
    `;

    const avgTimeResult = await pool.query(avgTimeQuery, [studyId]);
    const averageCompletionTime = parseFloat(avgTimeResult.rows[0].avg_days) || 0;

    const stats: CompletionStats = {
      totalCRFs,
      completedCRFs,
      incompleteCRFs,
      completionPercentage,
      completionByForm,
      averageCompletionTime: Math.round(averageCompletionTime * 10) / 10
    };

    logger.info('Completion statistics retrieved', {
      studyId,
      completionPercentage
    });

    return stats;
  } catch (error: any) {
    logger.error('Completion statistics error', {
      error: error.message,
      studyId
    });

    throw error;
  }
};

/**
 * Get query/discrepancy statistics
 * RED X Feature: Query Dashboard
 */
export const getQueryStatistics = async (
  studyId: number,
  timeframe: 'week' | 'month' | 'quarter' | 'year' = 'month'
): Promise<QueryStats> => {
  logger.info('Getting query statistics', { studyId, timeframe });

  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();

    switch (timeframe) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    // Get overall query counts
    const overallQuery = `
      SELECT 
        COUNT(*) as total_queries,
        COUNT(CASE WHEN rs.name NOT IN ('Closed', 'Not Applicable') THEN 1 END) as open_queries,
        COUNT(CASE WHEN rs.name IN ('Closed', 'Not Applicable') THEN 1 END) as closed_queries
      FROM discrepancy_note dn
      LEFT JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
        AND dn.date_created >= $2
    `;

    const overallResult = await pool.query(overallQuery, [studyId, startDate]);
    const overall = overallResult.rows[0];

    // Get queries by type
    const byTypeQuery = `
      SELECT 
        dnt.name as type,
        COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
        AND dn.date_created >= $2
      GROUP BY dnt.name
      ORDER BY count DESC
    `;

    const byTypeResult = await pool.query(byTypeQuery, [studyId, startDate]);

    const queriesByType = byTypeResult.rows.map(row => ({
      type: row.type,
      count: parseInt(row.count)
    }));

    // Get queries by status
    const byStatusQuery = `
      SELECT 
        rs.name as status,
        COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
        AND dn.date_created >= $2
      GROUP BY rs.name
      ORDER BY count DESC
    `;

    const byStatusResult = await pool.query(byStatusQuery, [studyId, startDate]);

    const queriesByStatus = byStatusResult.rows.map(row => ({
      status: row.status,
      count: parseInt(row.count)
    }));

    // Calculate average resolution time
    const resolutionTimeQuery = `
      SELECT 
        AVG(EXTRACT(EPOCH FROM (closed.date_created - dn.date_created)) / 86400) as avg_days
      FROM discrepancy_note dn
      INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      LEFT JOIN discrepancy_note closed ON closed.parent_dn_id = dn.discrepancy_note_id 
        AND closed.resolution_status_id = (SELECT resolution_status_id FROM resolution_status WHERE name = 'Closed')
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
        AND rs.name = 'Closed'
        AND closed.date_created IS NOT NULL
    `;

    const resolutionTimeResult = await pool.query(resolutionTimeQuery, [studyId]);
    const averageResolutionTime = parseFloat(resolutionTimeResult.rows[0].avg_days) || 0;

    // Calculate query rate (queries per subject)
    // Note: discrepancy_note does NOT have study_subject_id - use study_id filter instead
    const rateQuery = `
      SELECT 
        (SELECT COUNT(DISTINCT discrepancy_note_id) FROM discrepancy_note WHERE study_id = $1 AND parent_dn_id IS NULL)::numeric 
        / NULLIF((SELECT COUNT(*) FROM study_subject WHERE study_id = $1), 0) as query_rate
    `;

    const rateResult = await pool.query(rateQuery, [studyId]);
    const queryRate = parseFloat(rateResult.rows[0].query_rate) || 0;

    const stats: QueryStats = {
      totalQueries: parseInt(overall.total_queries),
      openQueries: parseInt(overall.open_queries),
      closedQueries: parseInt(overall.closed_queries),
      queriesByType,
      queriesByStatus,
      averageResolutionTime: Math.round(averageResolutionTime * 10) / 10,
      queryRate: Math.round(queryRate * 100) / 100
    };

    logger.info('Query statistics retrieved', {
      studyId,
      totalQueries: stats.totalQueries
    });

    return stats;
  } catch (error: any) {
    logger.error('Query statistics error', {
      error: error.message,
      studyId
    });

    throw error;
  }
};

/**
 * Get user activity statistics
 * RED X Feature: User Activity Dashboard
 * Note: audit_log_event does NOT have study_id column
 * We filter by users assigned to the study instead
 */
export const getUserActivityStats = async (
  studyId: number,
  days: number = 30
): Promise<UserActivityStats> => {
  logger.info('Getting user activity statistics', { studyId, days });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get active users count - users in study who have audit events
    const activeUsersQuery = `
      SELECT COUNT(DISTINCT ale.user_id) as active_users
      FROM audit_log_event ale
      INNER JOIN user_account u ON ale.user_id = u.user_id
      INNER JOIN study_user_role sur ON u.user_name = sur.user_name
      WHERE sur.study_id = $1
        AND ale.audit_date >= $2
    `;

    const activeUsersResult = await pool.query(activeUsersQuery, [studyId, startDate]);
    const activeUsers = parseInt(activeUsersResult.rows[0].active_users) || 0;

    // Get login statistics from audit_user_login table
    // Note: audit_user_login has columns: id, user_name, user_account_id, login_attempt_date, login_status_code, version, details
    const loginStatsQuery = `
      SELECT 
        COUNT(*) as total_logins
      FROM audit_user_login aul
      WHERE aul.login_attempt_date >= $1
        AND aul.login_status_code = 1
    `;

    const loginStatsResult = await pool.query(loginStatsQuery, [startDate]);
    const loginStats = loginStatsResult.rows[0];

    // Get activity by user (for users assigned to this study)
    const byUserQuery = `
      SELECT 
        u.user_id,
        u.user_name,
        COUNT(ale.audit_id) as activity_count,
        MAX(ale.audit_date) as last_activity,
        COUNT(CASE WHEN alet.name LIKE '%Data%' THEN 1 END) as data_entry_count
      FROM user_account u
      INNER JOIN study_user_role sur ON u.user_name = sur.user_name
      LEFT JOIN audit_log_event ale ON u.user_id = ale.user_id AND ale.audit_date >= $2
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE sur.study_id = $1
        AND sur.status_id = 1
      GROUP BY u.user_id, u.user_name
      ORDER BY activity_count DESC
      LIMIT 20
    `;

    const byUserResult = await pool.query(byUserQuery, [studyId, startDate]);

    const activityByUser = byUserResult.rows.map(row => ({
      userId: row.user_id,
      username: row.user_name,
      loginCount: parseInt(row.activity_count) || 0,
      lastLogin: row.last_activity,
      dataEntryCount: parseInt(row.data_entry_count) || 0
    }));

    // Get activity by day (global, filtered by date)
    const byDayQuery = `
      SELECT 
        DATE(ale.audit_date) as date,
        COUNT(DISTINCT CASE WHEN alet.name LIKE '%Login%' THEN ale.user_id END) as logins,
        COUNT(CASE WHEN alet.name LIKE '%Data%' THEN 1 END) as data_entries,
        COUNT(CASE WHEN alet.name LIKE '%Query%' THEN 1 END) as queries
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_date >= $1
      GROUP BY DATE(ale.audit_date)
      ORDER BY date DESC
      LIMIT 30
    `;

    const byDayResult = await pool.query(byDayQuery, [startDate]);

    const activityByDay = byDayResult.rows.map(row => ({
      date: row.date ? row.date.toISOString().split('T')[0] : '',
      logins: parseInt(row.logins) || 0,
      dataEntries: parseInt(row.data_entries) || 0,
      queries: parseInt(row.queries) || 0
    }));

    const stats: UserActivityStats = {
      activeUsers,
      totalLogins: parseInt(loginStats.total_logins) || 0,
      averageSessionDuration: 0, // audit_user_login doesn't track session duration
      activityByUser,
      activityByDay
    };

    logger.info('User activity statistics retrieved', {
      studyId,
      activeUsers
    });

    return stats;
  } catch (error: any) {
    logger.error('User activity statistics error', {
      error: error.message,
      studyId
    });

    throw error;
  }
};

/**
 * Get overall study progress
 * Combines multiple metrics
 */
export const getStudyProgress = async (studyId: number): Promise<any> => {
  logger.info('Getting study progress', { studyId });

  try {
    const [enrollment, completion, queries] = await Promise.all([
      getEnrollmentStats(studyId),
      getCompletionStats(studyId),
      getQueryStatistics(studyId, 'month')
    ]);

    // Calculate overall progress percentage
    const enrollmentProgress = enrollment.targetEnrollment 
      ? (enrollment.totalSubjects / enrollment.targetEnrollment) * 100
      : null;

    const overallProgress = completion.completionPercentage;

    return {
      studyId,
      overallProgress: Math.round(overallProgress),
      enrollmentProgress: enrollmentProgress ? Math.round(enrollmentProgress) : null,
      enrollment,
      completion,
      queries,
      lastUpdated: new Date()
    };
  } catch (error: any) {
    logger.error('Study progress error', {
      error: error.message,
      studyId
    });

    throw error;
  }
};

/**
 * Get enrollment trend over time
 */
export const getEnrollmentTrend = async (
  studyId: number,
  days: number = 30
): Promise<any[]> => {
  logger.info('Getting enrollment trend', { studyId, days });

  try {
    const query = `
      SELECT 
        DATE(ss.enrollment_date) as date,
        COUNT(*) as enrolled,
        SUM(COUNT(*)) OVER (ORDER BY DATE(ss.enrollment_date)) as cumulative
      FROM study_subject ss
      WHERE ss.study_id = $1
        AND ss.enrollment_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(ss.enrollment_date)
      ORDER BY date
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows.map(row => ({
      date: row.date?.toISOString().split('T')[0],
      enrolled: parseInt(row.enrolled),
      cumulative: parseInt(row.cumulative)
    }));
  } catch (error: any) {
    logger.error('Enrollment trend error', { error: error.message });
    return [];
  }
};

/**
 * Get completion trend over time
 * Note: Uses date_updated when completion_status_id indicates complete (4 or 5)
 */
export const getCompletionTrend = async (
  studyId: number,
  days: number = 30
): Promise<any[]> => {
  logger.info('Getting completion trend', { studyId, days });

  try {
    const query = `
      SELECT 
        DATE(ec.date_updated) as date,
        COUNT(*) as completed
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE ss.study_id = $1
        AND cs.name IN ('complete', 'signed')
        AND ec.date_updated >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(ec.date_updated)
      ORDER BY date
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows.map(row => ({
      date: row.date?.toISOString().split('T')[0],
      completed: parseInt(row.completed)
    }));
  } catch (error: any) {
    logger.error('Completion trend error', { error: error.message });
    return [];
  }
};

/**
 * Get site performance metrics
 */
export const getSitePerformance = async (studyId: number): Promise<any[]> => {
  logger.info('Getting site performance', { studyId });

  try {
    // Sites are child studies with parent_study_id = studyId
    const query = `
      SELECT 
        s.study_id as site_id,
        s.name as site_name,
        s.unique_identifier as site_number,
        COUNT(DISTINCT ss.study_subject_id) as enrolled_subjects,
        COUNT(DISTINCT ec.event_crf_id) as total_forms,
        COUNT(DISTINCT CASE WHEN cs.name IN ('complete', 'signed') THEN ec.event_crf_id END) as completed_forms,
        COUNT(DISTINCT dn.discrepancy_note_id) as open_queries
      FROM study s
      LEFT JOIN study_subject ss ON ss.study_id = s.study_id
      LEFT JOIN study_event se ON se.study_subject_id = ss.study_subject_id
      LEFT JOIN event_crf ec ON ec.study_event_id = se.study_event_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN discrepancy_note dn ON dn.study_id = s.study_id AND dn.resolution_status_id IN (1,2,3)
      WHERE s.parent_study_id = $1
      GROUP BY s.study_id, s.name, s.unique_identifier
      ORDER BY s.name
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows.map(row => ({
      siteId: row.site_id,
      siteName: row.site_name,
      siteNumber: row.site_number,
      enrolledSubjects: parseInt(row.enrolled_subjects) || 0,
      totalForms: parseInt(row.total_forms) || 0,
      completedForms: parseInt(row.completed_forms) || 0,
      completionRate: row.total_forms > 0 
        ? Math.round((parseInt(row.completed_forms) / parseInt(row.total_forms)) * 100) 
        : 0,
      openQueries: parseInt(row.open_queries) || 0
    }));
  } catch (error: any) {
    logger.error('Site performance error', { error: error.message });
    return [];
  }
};

/**
 * Get form completion rates by CRF
 */
export const getFormCompletionRates = async (studyId: number): Promise<any[]> => {
  logger.info('Getting form completion rates', { studyId });

  try {
    const query = `
      SELECT 
        c.crf_id,
        c.name as form_name,
        COUNT(ec.event_crf_id) as total_instances,
        COUNT(CASE WHEN cs.name IN ('complete', 'signed') THEN 1 END) as completed,
        COUNT(CASE WHEN cs.name NOT IN ('complete', 'signed') THEN 1 END) as incomplete
      FROM crf c
      INNER JOIN crf_version cv ON c.crf_id = cv.crf_id
      INNER JOIN event_definition_crf edc ON cv.crf_version_id = edc.default_version_id OR cv.crf_id = c.crf_id
      INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id
      LEFT JOIN event_crf ec ON ec.crf_version_id = cv.crf_version_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE sed.study_id = $1
      GROUP BY c.crf_id, c.name
      ORDER BY c.name
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows.map(row => ({
      formId: row.crf_id,
      formName: row.form_name,
      totalInstances: parseInt(row.total_instances) || 0,
      completed: parseInt(row.completed) || 0,
      incomplete: parseInt(row.incomplete) || 0,
      completionRate: row.total_instances > 0 
        ? Math.round((parseInt(row.completed) / parseInt(row.total_instances)) * 100) 
        : 0
    }));
  } catch (error: any) {
    logger.error('Form completion rates error', { error: error.message });
    return [];
  }
};

/**
 * Get data quality metrics
 */
export const getDataQualityMetrics = async (studyId: number): Promise<any> => {
  logger.info('Getting data quality metrics', { studyId });

  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM discrepancy_note WHERE study_id = $1 AND parent_dn_id IS NULL) as total_queries,
        (SELECT COUNT(*) FROM discrepancy_note WHERE study_id = $1 AND parent_dn_id IS NULL AND resolution_status_id IN (1,2,3)) as open_queries,
        (SELECT COUNT(*) FROM discrepancy_note WHERE study_id = $1 AND parent_dn_id IS NULL AND resolution_status_id = 4) as resolved_queries,
        (SELECT COUNT(*) FROM event_crf ec 
         INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
         INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
         WHERE ss.study_id = $1 AND ec.sdv_status = true) as sdv_verified,
        (SELECT COUNT(*) FROM event_crf ec 
         INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
         INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
         WHERE ss.study_id = $1) as total_crfs,
        (SELECT COUNT(*) FROM audit_log_event ale
         WHERE ale.audit_date >= CURRENT_DATE - INTERVAL '30 days') as audit_events_30d
    `;

    const result = await pool.query(query, [studyId]);
    const row = result.rows[0];

    return {
      totalQueries: parseInt(row.total_queries) || 0,
      openQueries: parseInt(row.open_queries) || 0,
      resolvedQueries: parseInt(row.resolved_queries) || 0,
      queryResolutionRate: row.total_queries > 0 
        ? Math.round((parseInt(row.resolved_queries) / parseInt(row.total_queries)) * 100) 
        : 0, // No queries = no resolution data
      sdvVerified: parseInt(row.sdv_verified) || 0,
      totalCRFs: parseInt(row.total_crfs) || 0,
      sdvRate: row.total_crfs > 0 
        ? Math.round((parseInt(row.sdv_verified) / parseInt(row.total_crfs)) * 100) 
        : 0,
      auditEvents30Days: parseInt(row.audit_events_30d) || 0
    };
  } catch (error: any) {
    logger.error('Data quality metrics error', { error: error.message });
    return {};
  }
};

/**
 * Get subject status distribution
 */
export const getSubjectStatusDistribution = async (studyId: number): Promise<any[]> => {
  logger.info('Getting subject status distribution', { studyId });

  try {
    const query = `
      SELECT 
        st.name as status,
        COUNT(ss.study_subject_id) as count
      FROM status st
      LEFT JOIN study_subject ss ON ss.status_id = st.status_id AND ss.study_id = $1
      WHERE st.status_id IN (1,2,3,4,5)
      GROUP BY st.name, st.status_id
      ORDER BY st.status_id
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows.map(row => ({
      status: row.status,
      count: parseInt(row.count) || 0
    }));
  } catch (error: any) {
    logger.error('Subject status distribution error', { error: error.message });
    return [];
  }
};

/**
 * Get real-time activity feed
 */
export const getActivityFeed = async (studyId: number, limit: number = 20): Promise<any[]> => {
  logger.info('Getting activity feed', { studyId, limit });

  try {
    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.audit_table,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        alet.name as event_type,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      ORDER BY ale.audit_date DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows.map(row => ({
      id: row.audit_id,
      timestamp: row.audit_date,
      table: row.audit_table,
      entityName: row.entity_name,
      eventType: row.event_type,
      oldValue: row.old_value,
      newValue: row.new_value,
      userName: row.user_name,
      userFullName: row.user_full_name
    }));
  } catch (error: any) {
    logger.error('Activity feed error', { error: error.message });
    return [];
  }
};

/**
 * Get study health score
 */
export const getStudyHealthScore = async (studyId: number): Promise<any> => {
  logger.info('Getting study health score', { studyId });

  try {
    // Get various metrics and calculate health score
    const [enrollment, completion, queries] = await Promise.all([
      getEnrollmentStats(studyId),
      getCompletionStats(studyId),
      getQueryStatistics(studyId, 'month')
    ]);

    // Calculate factor scores (0-100)
    const enrollmentScore = enrollment.targetEnrollment 
      ? Math.min(100, Math.round((enrollment.totalSubjects / enrollment.targetEnrollment) * 100))
      : 50;

    const dataCompletionScore = completion.completionPercentage || 0;

    const queryResolutionScore = queries.totalQueries > 0
      ? Math.round((queries.closedQueries / queries.totalQueries) * 100)
      : 0; // No queries = no resolution score (not 100%)

    // Protocol compliance: Calculate from actual protocol deviation queries
    // Only count if there are protocol-related queries in the discrepancy notes
    // For now, we calculate based on the ratio of completed forms without queries
    let protocolComplianceScore = 0;
    if (completion.totalCRFs > 0 && queries.totalQueries >= 0) {
      // Protocol compliance = forms without protocol deviation queries / total forms
      // If query rate is low (<0.1 queries per form), compliance is high
      const queriesPerForm = completion.totalCRFs > 0 ? queries.totalQueries / completion.totalCRFs : 0;
      protocolComplianceScore = Math.max(0, Math.round((1 - queriesPerForm) * 100));
    }

    // Overall score is weighted average (only if we have data)
    const hasData = enrollment.totalSubjects > 0 || completion.totalCRFs > 0 || queries.totalQueries > 0;
    const overallScore = hasData ? Math.round(
      (enrollmentScore * 0.25) +
      (dataCompletionScore * 0.35) +
      (queryResolutionScore * 0.25) +
      (protocolComplianceScore * 0.15)
    ) : 0;

    return {
      score: overallScore,
      factors: {
        enrollment: enrollmentScore,
        dataCompletion: dataCompletionScore,
        queryResolution: queryResolutionScore,
        protocolCompliance: protocolComplianceScore
      },
      lastUpdated: new Date()
    };
  } catch (error: any) {
    logger.error('Study health score error', { error: error.message });
    return {
      score: 0,
      factors: {
        enrollment: 0,
        dataCompletion: 0,
        queryResolution: 0,
        protocolCompliance: 0
      }
    };
  }
};

/**
 * Get detailed user analytics
 * Provides comprehensive user activity tracking including:
 * - Login frequency and patterns
 * - Data entry activity
 * - Session metrics
 * - Role-based breakdown
 */
export const getUserAnalytics = async (
  studyId: number,
  days: number = 30
): Promise<any> => {
  logger.info('Getting detailed user analytics', { studyId, days });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get comprehensive user statistics
    const userStatsQuery = `
      WITH user_logins AS (
        SELECT 
          aul.user_name,
          aul.user_account_id,
          COUNT(*) as total_logins,
          COUNT(CASE WHEN aul.login_attempt_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as logins_last_7_days,
          COUNT(CASE WHEN aul.login_attempt_date >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as logins_today,
          MIN(aul.login_attempt_date) as first_login,
          MAX(aul.login_attempt_date) as last_login
        FROM audit_user_login aul
        WHERE aul.login_status_code = 1
          AND aul.login_attempt_date >= $1
        GROUP BY aul.user_name, aul.user_account_id
      ),
      user_activities AS (
        SELECT 
          ale.user_id,
          COUNT(*) as total_actions,
          COUNT(CASE WHEN alet.name LIKE '%Create%' OR alet.name LIKE '%Insert%' THEN 1 END) as create_actions,
          COUNT(CASE WHEN alet.name LIKE '%Update%' OR alet.name LIKE '%Modify%' THEN 1 END) as update_actions,
          COUNT(CASE WHEN alet.name LIKE '%Data%' THEN 1 END) as data_entry_actions,
          COUNT(CASE WHEN ale.audit_date >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as actions_today,
          COUNT(CASE WHEN ale.audit_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as actions_last_7_days,
          MAX(ale.audit_date) as last_activity
        FROM audit_log_event ale
        LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
        WHERE ale.audit_date >= $1
        GROUP BY ale.user_id
      )
      SELECT 
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        u.email,
        u.institutional_affiliation,
        st.name as status,
        sur.role_name,
        COALESCE(ul.total_logins, 0) as total_logins,
        COALESCE(ul.logins_last_7_days, 0) as logins_last_7_days,
        COALESCE(ul.logins_today, 0) as logins_today,
        ul.first_login,
        ul.last_login,
        COALESCE(ua.total_actions, 0) as total_actions,
        COALESCE(ua.create_actions, 0) as create_actions,
        COALESCE(ua.update_actions, 0) as update_actions,
        COALESCE(ua.data_entry_actions, 0) as data_entry_actions,
        COALESCE(ua.actions_today, 0) as actions_today,
        COALESCE(ua.actions_last_7_days, 0) as actions_last_7_days,
        ua.last_activity,
        CASE 
          WHEN ul.total_logins > 0 THEN 
            ROUND(EXTRACT(EPOCH FROM (ul.last_login - ul.first_login)) / 86400 / ul.total_logins, 2)
          ELSE 0 
        END as avg_days_between_logins
      FROM user_account u
      LEFT JOIN status st ON u.status_id = st.status_id
      LEFT JOIN study_user_role sur ON u.user_name = sur.user_name AND sur.study_id = $2
      LEFT JOIN user_logins ul ON u.user_name = ul.user_name
      LEFT JOIN user_activities ua ON u.user_id = ua.user_id
      WHERE (sur.study_id = $2 OR $2 IS NULL)
        AND u.status_id = 1
      ORDER BY COALESCE(ua.total_actions, 0) DESC, COALESCE(ul.total_logins, 0) DESC
      LIMIT 50
    `;

    const userStatsResult = await pool.query(userStatsQuery, [startDate, studyId]);

    const users = userStatsResult.rows.map(row => ({
      userId: row.user_id,
      userName: row.user_name,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.user_name,
      email: row.email,
      institution: row.institutional_affiliation,
      status: row.status,
      role: row.role_name,
      logins: {
        total: parseInt(row.total_logins) || 0,
        last7Days: parseInt(row.logins_last_7_days) || 0,
        today: parseInt(row.logins_today) || 0,
        firstLogin: row.first_login,
        lastLogin: row.last_login,
        avgDaysBetweenLogins: parseFloat(row.avg_days_between_logins) || 0
      },
      activity: {
        totalActions: parseInt(row.total_actions) || 0,
        createActions: parseInt(row.create_actions) || 0,
        updateActions: parseInt(row.update_actions) || 0,
        dataEntryActions: parseInt(row.data_entry_actions) || 0,
        actionsToday: parseInt(row.actions_today) || 0,
        actionsLast7Days: parseInt(row.actions_last_7_days) || 0,
        lastActivity: row.last_activity
      }
    }));

    // Get summary statistics
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT u.user_id) as total_users,
        COUNT(DISTINCT CASE WHEN ua.last_activity >= CURRENT_DATE - INTERVAL '1 day' THEN u.user_id END) as active_today,
        COUNT(DISTINCT CASE WHEN ua.last_activity >= CURRENT_DATE - INTERVAL '7 days' THEN u.user_id END) as active_last_7_days,
        COUNT(DISTINCT CASE WHEN ua.last_activity >= CURRENT_DATE - INTERVAL '30 days' THEN u.user_id END) as active_last_30_days,
        ROUND(AVG(ua.total_actions), 1) as avg_actions_per_user,
        ROUND(AVG(ul.total_logins), 1) as avg_logins_per_user
      FROM user_account u
      LEFT JOIN study_user_role sur ON u.user_name = sur.user_name AND sur.study_id = $2
      LEFT JOIN (
        SELECT user_id, COUNT(*) as total_actions, MAX(audit_date) as last_activity
        FROM audit_log_event
        WHERE audit_date >= $1
        GROUP BY user_id
      ) ua ON u.user_id = ua.user_id
      LEFT JOIN (
        SELECT user_account_id, COUNT(*) as total_logins
        FROM audit_user_login
        WHERE login_status_code = 1 AND login_attempt_date >= $1
        GROUP BY user_account_id
      ) ul ON u.user_id = ul.user_account_id
      WHERE (sur.study_id = $2 OR $2 IS NULL)
        AND u.status_id = 1
    `;

    const summaryResult = await pool.query(summaryQuery, [startDate, studyId]);
    const summary = summaryResult.rows[0];

    // Get activity by role
    const roleActivityQuery = `
      SELECT 
        sur.role_name,
        COUNT(DISTINCT u.user_id) as user_count,
        COALESCE(SUM(ua.total_actions), 0) as total_actions,
        COALESCE(SUM(ul.total_logins), 0) as total_logins
      FROM user_account u
      INNER JOIN study_user_role sur ON u.user_name = sur.user_name AND sur.study_id = $2
      LEFT JOIN (
        SELECT user_id, COUNT(*) as total_actions
        FROM audit_log_event
        WHERE audit_date >= $1
        GROUP BY user_id
      ) ua ON u.user_id = ua.user_id
      LEFT JOIN (
        SELECT user_account_id, COUNT(*) as total_logins
        FROM audit_user_login
        WHERE login_status_code = 1 AND login_attempt_date >= $1
        GROUP BY user_account_id
      ) ul ON u.user_id = ul.user_account_id
      WHERE u.status_id = 1
      GROUP BY sur.role_name
      ORDER BY total_actions DESC
    `;

    const roleActivityResult = await pool.query(roleActivityQuery, [startDate, studyId]);
    const activityByRole = roleActivityResult.rows.map(row => ({
      role: row.role_name,
      userCount: parseInt(row.user_count) || 0,
      totalActions: parseInt(row.total_actions) || 0,
      totalLogins: parseInt(row.total_logins) || 0,
      avgActionsPerUser: row.user_count > 0 
        ? Math.round(parseInt(row.total_actions) / parseInt(row.user_count)) 
        : 0
    }));

    // Get login patterns by hour
    const loginPatternQuery = `
      SELECT 
        EXTRACT(HOUR FROM login_attempt_date) as hour,
        COUNT(*) as login_count
      FROM audit_user_login
      WHERE login_status_code = 1
        AND login_attempt_date >= $1
      GROUP BY EXTRACT(HOUR FROM login_attempt_date)
      ORDER BY hour
    `;

    const loginPatternResult = await pool.query(loginPatternQuery, [startDate]);
    const loginsByHour = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0
    }));
    
    loginPatternResult.rows.forEach(row => {
      const hour = parseInt(row.hour);
      loginsByHour[hour].count = parseInt(row.login_count) || 0;
    });

    // Get activity trend by day
    const activityTrendQuery = `
      SELECT 
        DATE(audit_date) as date,
        COUNT(*) as action_count,
        COUNT(DISTINCT user_id) as unique_users
      FROM audit_log_event
      WHERE audit_date >= $1
      GROUP BY DATE(audit_date)
      ORDER BY date DESC
      LIMIT 30
    `;

    const activityTrendResult = await pool.query(activityTrendQuery, [startDate]);
    const activityTrend = activityTrendResult.rows.map(row => ({
      date: row.date?.toISOString().split('T')[0],
      actionCount: parseInt(row.action_count) || 0,
      uniqueUsers: parseInt(row.unique_users) || 0
    })).reverse();

    return {
      summary: {
        totalUsers: parseInt(summary.total_users) || 0,
        activeToday: parseInt(summary.active_today) || 0,
        activeLast7Days: parseInt(summary.active_last_7_days) || 0,
        activeLast30Days: parseInt(summary.active_last_30_days) || 0,
        avgActionsPerUser: parseFloat(summary.avg_actions_per_user) || 0,
        avgLoginsPerUser: parseFloat(summary.avg_logins_per_user) || 0
      },
      users,
      activityByRole,
      loginsByHour,
      activityTrend,
      reportPeriod: {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        days
      }
    };
  } catch (error: any) {
    logger.error('User analytics error', { error: error.message, studyId });
    return {
      summary: {},
      users: [],
      activityByRole: [],
      loginsByHour: [],
      activityTrend: []
    };
  }
};

/**
 * Get top performers (most active users)
 */
export const getTopPerformers = async (
  studyId: number,
  days: number = 30,
  limit: number = 10
): Promise<any[]> => {
  logger.info('Getting top performers', { studyId, days, limit });

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const query = `
      SELECT 
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        sur.role_name,
        COUNT(DISTINCT ale.audit_id) as total_actions,
        COUNT(DISTINCT CASE WHEN alet.name LIKE '%Data%' THEN ale.audit_id END) as data_entry_count,
        COUNT(DISTINCT DATE(ale.audit_date)) as active_days,
        MIN(ale.audit_date) as first_activity,
        MAX(ale.audit_date) as last_activity
      FROM user_account u
      INNER JOIN study_user_role sur ON u.user_name = sur.user_name AND sur.study_id = $2
      LEFT JOIN audit_log_event ale ON u.user_id = ale.user_id AND ale.audit_date >= $1
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE u.status_id = 1
      GROUP BY u.user_id, u.user_name, u.first_name, u.last_name, sur.role_name
      HAVING COUNT(ale.audit_id) > 0
      ORDER BY total_actions DESC
      LIMIT $3
    `;

    const result = await pool.query(query, [startDate, studyId, limit]);
    
    return result.rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      userName: row.user_name,
      fullName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.user_name,
      role: row.role_name,
      totalActions: parseInt(row.total_actions) || 0,
      dataEntryCount: parseInt(row.data_entry_count) || 0,
      activeDays: parseInt(row.active_days) || 0,
      firstActivity: row.first_activity,
      lastActivity: row.last_activity,
      avgActionsPerDay: row.active_days > 0 
        ? Math.round(parseInt(row.total_actions) / parseInt(row.active_days)) 
        : 0
    }));
  } catch (error: any) {
    logger.error('Top performers error', { error: error.message });
    return [];
  }
};

export default {
  getEnrollmentStats,
  getCompletionStats,
  getQueryStatistics,
  getUserActivityStats,
  getStudyProgress,
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

