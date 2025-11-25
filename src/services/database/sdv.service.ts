/**
 * SDV (Source Data Verification) Service
 * Queries event_crf.sdv_status from LibreClinica
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export const getSDVRecords = async (filters: {
  studyId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) => {
  logger.info('Getting SDV records', filters);

  try {
    const { studyId, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['ec.status_id != 5'];
    const params: any[] = [];
    let paramIndex = 1;

    if (studyId) {
      conditions.push(`ss.study_id = $${paramIndex++}`);
      params.push(studyId);
    }

    if (status === 'verified') {
      conditions.push('ec.sdv_status = true');
    } else if (status === 'pending') {
      conditions.push('ec.sdv_status = false');
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT 
        ec.event_crf_id,
        ec.sdv_status,
        ec.date_updated,
        ss.study_subject_id,
        ss.label as subject_label,
        se.study_event_id,
        sed.name as event_name,
        c.name as crf_name,
        verifier.user_name as verified_by
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN user_account verifier ON ec.sdv_update_id = verifier.user_id
      WHERE ${whereClause}
      ORDER BY ec.date_updated DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);
    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows,
      pagination: { page, limit, total: result.rows.length }
    };
  } catch (error: any) {
    logger.error('Get SDV records error', { error: error.message });
    throw error;
  }
};

export const getSDVById = async (eventCrfId: number) => {
  const query = `
    SELECT 
      ec.*,
      ss.label as subject_label,
      sed.name as event_name,
      c.name as crf_name
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    INNER JOIN crf c ON cv.crf_id = c.crf_id
    WHERE ec.event_crf_id = $1
  `;

  const result = await pool.query(query, [eventCrfId]);
  return result.rows[0] || null;
};

export const verifySDV = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE event_crf
      SET sdv_status = true, sdv_update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'SDV Verified',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return { success: true, data: result.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
