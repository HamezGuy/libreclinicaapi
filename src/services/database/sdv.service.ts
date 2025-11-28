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

/**
 * Bulk verify multiple SDV records
 */
export const bulkVerifySDV = async (eventCrfIds: number[], userId: number) => {
  const client = await pool.connect();
  const results: any[] = [];
  const errors: any[] = [];

  try {
    await client.query('BEGIN');

    for (const eventCrfId of eventCrfIds) {
      try {
        const updateQuery = `
          UPDATE event_crf
          SET sdv_status = true, sdv_update_id = $2, date_updated = CURRENT_TIMESTAMP
          WHERE event_crf_id = $1
          RETURNING event_crf_id
        `;

        const result = await client.query(updateQuery, [eventCrfId, userId]);
        if (result.rows[0]) {
          results.push(result.rows[0].event_crf_id);
        }
      } catch (e: any) {
        errors.push({ eventCrfId, error: e.message });
      }
    }

    // Log bulk operation
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, `Bulk SDV: ${results.length} records verified`]);

    await client.query('COMMIT');

    return { 
      success: true, 
      verified: results.length,
      failed: errors.length,
      errors 
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get SDV status for a specific subject
 */
export const getSubjectSDVStatus = async (subjectId: number) => {
  logger.info('Getting subject SDV status', { subjectId });

  try {
    const query = `
      SELECT 
        COUNT(ec.event_crf_id) as total_forms,
        COUNT(CASE WHEN ec.sdv_status = true THEN 1 END) as verified_forms,
        COUNT(CASE WHEN ec.sdv_status = false THEN 1 END) as pending_forms
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.status_id != 5
    `;

    const result = await pool.query(query, [subjectId]);
    const row = result.rows[0];

    const total = parseInt(row.total_forms) || 0;
    const verified = parseInt(row.verified_forms) || 0;

    return {
      success: true,
      data: {
        subjectId,
        totalForms: total,
        verifiedForms: verified,
        pendingForms: parseInt(row.pending_forms) || 0,
        completionRate: total > 0 ? Math.round((verified / total) * 100) : 0
      }
    };
  } catch (error: any) {
    logger.error('Get subject SDV status error', { error: error.message });
    throw error;
  }
};

/**
 * Get SDV statistics for a study
 */
export const getSDVStats = async (studyId: number) => {
  logger.info('Getting SDV stats', { studyId });

  try {
    const query = `
      SELECT 
        COUNT(ec.event_crf_id) as total,
        COUNT(CASE WHEN ec.sdv_status = true THEN 1 END) as verified,
        COUNT(CASE WHEN ec.sdv_status = false THEN 1 END) as pending
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = $1
        AND ec.status_id != 5
    `;

    const result = await pool.query(query, [studyId]);
    const row = result.rows[0];

    const total = parseInt(row.total) || 0;
    const verified = parseInt(row.verified) || 0;

    return {
      success: true,
      data: {
        total,
        verified,
        pending: parseInt(row.pending) || 0,
        verificationRate: total > 0 ? Math.round((verified / total) * 100) : 0
      }
    };
  } catch (error: any) {
    logger.error('Get SDV stats error', { error: error.message });
    throw error;
  }
};

/**
 * Get SDV by visit/event
 */
export const getSDVByVisit = async (studyId: number) => {
  logger.info('Getting SDV by visit', { studyId });

  try {
    const query = `
      SELECT 
        sed.study_event_definition_id as event_id,
        sed.name as event_name,
        COUNT(ec.event_crf_id) as total_forms,
        COUNT(CASE WHEN ec.sdv_status = true THEN 1 END) as verified_forms
      FROM study_event_definition sed
      INNER JOIN study_event se ON sed.study_event_definition_id = se.study_event_definition_id
      INNER JOIN event_crf ec ON se.study_event_id = ec.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE sed.study_id = $1
        AND ec.status_id != 5
      GROUP BY sed.study_event_definition_id, sed.name
      ORDER BY sed.ordinal
    `;

    const result = await pool.query(query, [studyId]);

    return {
      success: true,
      data: result.rows.map(row => ({
        eventId: row.event_id,
        eventName: row.event_name,
        totalForms: parseInt(row.total_forms) || 0,
        verifiedForms: parseInt(row.verified_forms) || 0,
        verificationRate: row.total_forms > 0 
          ? Math.round((parseInt(row.verified_forms) / parseInt(row.total_forms)) * 100) 
          : 0
      }))
    };
  } catch (error: any) {
    logger.error('Get SDV by visit error', { error: error.message });
    throw error;
  }
};

/**
 * Unverify SDV (undo verification)
 */
export const unverifySDV = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE event_crf
      SET sdv_status = false, sdv_update_id = NULL, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId]);

    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'SDV Unverified',
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