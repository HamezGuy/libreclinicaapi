/**
 * Data Locks Service
 * Uses event_crf.status_id = 6 (locked) from LibreClinica
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export const getLockedRecords = async (filters: {
  studyId?: number;
  page?: number;
  limit?: number;
}) => {
  logger.info('Getting locked records', filters);

  try {
    const { studyId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    let whereClause = 'ec.status_id = 6';
    const params: any[] = [];

    if (studyId) {
      whereClause += ' AND ss.study_id = $1';
      params.push(studyId);
    }

    const query = `
      SELECT 
        ec.event_crf_id,
        ec.status_id,
        st.name as status_name,
        ec.date_updated as lock_date,
        ss.study_subject_id,
        ss.label as subject_label,
        se.study_event_id,
        sed.name as event_name,
        c.name as crf_name,
        locker.user_name as locked_by
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN status st ON ec.status_id = st.status_id
      LEFT JOIN user_account locker ON ec.update_id = locker.user_id
      WHERE ${whereClause}
      ORDER BY ec.date_updated DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);
    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows,
      total: result.rows.length
    };
  } catch (error: any) {
    logger.error('Get locked records error', { error: error.message });
    throw error;
  }
};

export const lockRecord = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE event_crf
      SET status_id = 6, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id != 6
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or already locked' };
    }

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Locked',
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

export const unlockRecord = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE event_crf
      SET status_id = 1, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id = 6
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or not locked' };
    }

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Unlocked',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return { success: true, message: 'Data unlocked successfully' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
