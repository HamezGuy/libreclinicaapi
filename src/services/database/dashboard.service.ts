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
    // Note: audit_user_login has columns: id, user_name, audit_date, login_attempt_date, login_status, details, version
    const loginStatsQuery = `
      SELECT 
        COUNT(*) as total_logins
      FROM audit_user_login aul
      WHERE aul.audit_date >= $1
        AND aul.login_status = 1
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

export default {
  getEnrollmentStats,
  getCompletionStats,
  getQueryStatistics,
  getUserActivityStats,
  getStudyProgress
};

