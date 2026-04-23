/**
 * Query Statistics — counts, breakdowns, and overdue/assigned query views
 */

import { pool } from '../../../config/database';
import { logger } from '../../../config/logger';
import { getOrgMemberUserIds } from './query-helpers';

/**
 * Get query statistics for a study
 */
export const getQueryStats = async (studyId: number, callerUserId?: number): Promise<any> => {
  logger.info('Getting query statistics', { studyId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [studyId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT 
        dnst.name as status,
        COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL${orgFilter}
      GROUP BY dnst.name
      ORDER BY count DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get query stats error', { error: error.message });
    throw error;
  }
};

/**
 * Get query counts by status
 */
export const getQueryCountByStatus = async (studyId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query count by status', { studyId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [studyId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT 
        rs.resolution_status_id as status_id,
        rs.name as status_name,
        COUNT(dn.discrepancy_note_id) as count
      FROM resolution_status rs
      LEFT JOIN discrepancy_note dn ON rs.resolution_status_id = dn.resolution_status_id 
        AND dn.study_id = $1 AND dn.parent_dn_id IS NULL${orgFilter}
      GROUP BY rs.resolution_status_id, rs.name
      ORDER BY rs.resolution_status_id
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get query count by status error', { error: error.message });
    throw error;
  }
};

/**
 * Get query counts by type
 */
export const getQueryCountByType = async (studyId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query count by type', { studyId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [studyId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT 
        dnt.discrepancy_note_type_id as type_id,
        dnt.name as type_name,
        COUNT(dn.discrepancy_note_id) as count
      FROM discrepancy_note_type dnt
      LEFT JOIN discrepancy_note dn ON dnt.discrepancy_note_type_id = dn.discrepancy_note_type_id 
        AND dn.study_id = $1 AND dn.parent_dn_id IS NULL${orgFilter}
      GROUP BY dnt.discrepancy_note_type_id, dnt.name
      ORDER BY dnt.discrepancy_note_type_id
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get query count by type error', { error: error.message });
    throw error;
  }
};

/**
 * Get open and overdue query counts grouped by study_subject_id for a study.
 */
export const getQueryCountsBySubject = async (
  studyId: number,
  callerUserId?: number
): Promise<{ studySubjectId: number; openCount: number; overdueCount: number; closedCount: number }[]> => {
  logger.info('Getting query counts by subject', { studyId, callerUserId });
  try {
    const orgFilter = callerUserId ? await getOrgMemberUserIds(callerUserId) : null;
    let orgClause = '';
    const params: any[] = [studyId];
    if (orgFilter) {
      orgClause = `AND dn.owner_id = ANY($2::int[])`;
      params.push(orgFilter);
    }

    const sql = `
      WITH note_subjects AS (
        SELECT DISTINCT ON (dn.discrepancy_note_id)
          dn.discrepancy_note_id,
          dn.resolution_status_id,
          dn.due_date,
          COALESCE(
            dssm.study_subject_id,
            ec_item.study_subject_id,
            ec_form.study_subject_id
          ) AS study_subject_id
        FROM discrepancy_note dn
        LEFT JOIN dn_study_subject_map dssm
          ON dn.discrepancy_note_id = dssm.discrepancy_note_id
        LEFT JOIN LATERAL (
          SELECT ec.study_subject_id
          FROM dn_item_data_map didm
          INNER JOIN item_data id ON didm.item_data_id = id.item_data_id
          INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
          WHERE didm.discrepancy_note_id = dn.discrepancy_note_id
          LIMIT 1
        ) ec_item ON true
        LEFT JOIN LATERAL (
          SELECT ec.study_subject_id
          FROM dn_event_crf_map decm
          INNER JOIN event_crf ec ON decm.event_crf_id = ec.event_crf_id
          WHERE decm.discrepancy_note_id = dn.discrepancy_note_id
          LIMIT 1
        ) ec_form ON true
        WHERE dn.parent_dn_id IS NULL
          AND dn.study_id = $1
          ${orgClause}
        ORDER BY dn.discrepancy_note_id
      )
      SELECT
        study_subject_id,
        COUNT(*) FILTER (WHERE resolution_status_id NOT IN (4, 5))::int AS open_count,
        COUNT(*) FILTER (
          WHERE resolution_status_id NOT IN (4, 5)
            AND due_date IS NOT NULL
            AND due_date < NOW()
        )::int AS overdue_count,
        COUNT(*) FILTER (WHERE resolution_status_id IN (4, 5))::int AS closed_count
      FROM note_subjects
      WHERE study_subject_id IS NOT NULL
      GROUP BY study_subject_id
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((r: any) => ({
      studySubjectId: r.studySubjectId,
      openCount: r.openCount || 0,
      overdueCount: r.overdueCount || 0,
      closedCount: r.closedCount || 0
    }));
  } catch (error: any) {
    logger.error('Error getting query counts by subject', { error: error.message });
    throw error;
  }
};

/**
 * Get per-form query counts for ALL forms belonging to a study subject.
 */
export const getFormQueryCountsBySubject = async (
  studySubjectId: number
): Promise<{ eventCrfId: number; studyEventId: number; openCount: number; overdueCount: number; closedCount: number }[]> => {
  logger.info('Getting form query counts by subject', { studySubjectId });
  try {
    const sql = `
      SELECT
        ec.event_crf_id,
        se.study_event_id,
        COALESCE(pef.open_query_count, 0)::int AS open_count,
        COALESCE(pef.overdue_query_count, 0)::int AS overdue_count,
        COALESCE(pef.closed_query_count, 0)::int AS closed_count
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      LEFT JOIN patient_event_form pef ON pef.event_crf_id = ec.event_crf_id
      WHERE se.study_subject_id = $1
        AND ec.status_id NOT IN (5, 7)
    `;
    const result = await pool.query(sql, [studySubjectId]);
    return result.rows.map((r: any) => ({
      eventCrfId: r.eventCrfId,
      studyEventId: r.studyEventId,
      openCount: r.openCount || 0,
      overdueCount: r.overdueCount || 0,
      closedCount: r.closedCount || 0
    }));
  } catch (error: any) {
    logger.error('Error getting form query counts by subject', { error: error.message });
    throw error;
  }
};

/**
 * Get per-form (eventCrfId) open and overdue query counts for all forms in a study event.
 */
export const getFormQueryStatusByEvent = async (
  studyEventId: number,
  callerUserId?: number
): Promise<{ eventCrfId: number; openCount: number; overdueCount: number; closedCount: number }[]> => {
  logger.info('Getting form query status by event', { studyEventId, callerUserId });
  try {
    const orgFilter = callerUserId ? await getOrgMemberUserIds(callerUserId) : null;
    let orgClause = '';
    const params: any[] = [studyEventId];
    if (orgFilter) {
      orgClause = `AND dn.owner_id = ANY($2::int[])`;
      params.push(orgFilter);
    }

    const sql = `
      SELECT
        event_crf_id,
        SUM(open_count)::int AS open_count,
        SUM(overdue_count)::int AS overdue_count,
        SUM(closed_count)::int AS closed_count
      FROM (
        SELECT
          id.event_crf_id,
          COUNT(*) FILTER (WHERE dn.resolution_status_id NOT IN (4, 5))::int AS open_count,
          COUNT(*) FILTER (
            WHERE dn.resolution_status_id NOT IN (4, 5)
              AND dn.due_date IS NOT NULL
              AND dn.due_date < NOW()
          )::int AS overdue_count,
          COUNT(*) FILTER (WHERE dn.resolution_status_id IN (4, 5))::int AS closed_count
        FROM event_crf ec
        INNER JOIN item_data id ON ec.event_crf_id = id.event_crf_id
        INNER JOIN dn_item_data_map didm ON id.item_data_id = didm.item_data_id
        INNER JOIN discrepancy_note dn ON didm.discrepancy_note_id = dn.discrepancy_note_id
        WHERE ec.study_event_id = $1
          AND dn.parent_dn_id IS NULL
          ${orgClause}
        GROUP BY id.event_crf_id

        UNION ALL

        SELECT
          decm.event_crf_id,
          COUNT(*) FILTER (WHERE dn.resolution_status_id NOT IN (4, 5))::int AS open_count,
          COUNT(*) FILTER (
            WHERE dn.resolution_status_id NOT IN (4, 5)
              AND dn.due_date IS NOT NULL
              AND dn.due_date < NOW()
          )::int AS overdue_count,
          COUNT(*) FILTER (WHERE dn.resolution_status_id IN (4, 5))::int AS closed_count
        FROM dn_event_crf_map decm
        INNER JOIN event_crf ec ON decm.event_crf_id = ec.event_crf_id
        INNER JOIN discrepancy_note dn ON decm.discrepancy_note_id = dn.discrepancy_note_id
        WHERE ec.study_event_id = $1
          AND dn.parent_dn_id IS NULL
          ${orgClause}
        GROUP BY decm.event_crf_id
      ) combined
      GROUP BY event_crf_id
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((r: any) => ({
      eventCrfId: r.eventCrfId,
      openCount: r.openCount || 0,
      overdueCount: r.overdueCount || 0,
      closedCount: r.closedCount || 0
    }));
  } catch (error: any) {
    logger.error('Error getting form query status by event', { error: error.message });
    throw error;
  }
};

/**
 * Get overdue queries
 */
export const getOverdueQueries = async (studyId: number, daysThreshold: number = 7, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting overdue queries', { studyId, daysThreshold });

  try {
    const query = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.date_created,
        EXTRACT(DAY FROM NOW() - dn.date_created) as days_open,
        dnt.name as type_name,
        dnst.name as status_name,
        ss.label as subject_label,
        u.user_name as assigned_to
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u ON dn.assigned_user_id = u.user_id
      LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
      LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
        AND dnst.name IN ('New', 'Updated', 'Resolution Proposed')
        AND dn.date_created < NOW() - INTERVAL '1 day' * $2
      ORDER BY dn.date_created ASC
    `;

    const params: any[] = [studyId, Math.max(0, Math.floor(daysThreshold))];
    
    let orgFilteredQuery = query;
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilteredQuery = query.replace('ORDER BY', `AND dn.owner_id = ANY($3::int[]) ORDER BY`);
        params.push(orgUserIds);
      }
    }

    const result = await pool.query(orgFilteredQuery, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get overdue queries error', { error: error.message });
    throw error;
  }
};

/**
 * Get my assigned queries
 */
export const getMyAssignedQueries = async (userId: number, studyId?: number): Promise<any[]> => {
  logger.info('Getting my assigned queries', { userId, studyId });

  try {
    let query = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.date_created,
        dn.severity,
        dn.due_date,
        dn.discrepancy_note_type_id,
        dnt.name as type_name,
        dnst.name as status_name,
        ss.label as subject_label,
        s.name as study_name
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN study s ON dn.study_id = s.study_id
      LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
      LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
      WHERE dn.assigned_user_id = $1
        AND dn.parent_dn_id IS NULL
        AND dnst.name NOT IN ('Closed', 'Not Applicable')
    `;

    const params = [userId];

    if (studyId) {
      query += ` AND dn.study_id = $2`;
      params.push(studyId);
    }

    query += ` ORDER BY dn.date_created DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get my assigned queries error', { error: error.message });
    throw error;
  }
};
