/**
 * SDV (Source Data Verification) Service
 * Queries event_crf.sdv_status from LibreClinica
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export const getSDVRecords = async (filters: {
  studyId?: number;
  subjectId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) => {
  logger.info('Getting SDV records', filters);

  try {
    const { studyId, subjectId, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['ec.status_id != 5'];
    const params: any[] = [];
    let paramIndex = 1;

    if (studyId) {
      conditions.push(`ss.study_id = $${paramIndex++}`);
      params.push(studyId);
    }

    if (subjectId) {
      conditions.push(`ss.study_subject_id = $${paramIndex++}`);
      params.push(subjectId);
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

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ${whereClause.replace(/\$\d+/g, (match) => {
        const idx = parseInt(match.slice(1));
        // Adjust for the limit/offset params we added
        return idx <= params.length - 2 ? match : '';
      }).replace(/LIMIT.*OFFSET.*/, '')}
    `;
    
    // Build count params (exclude limit and offset)
    const countParams = params.slice(0, -2);
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM event_crf ec
       INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
       INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
       WHERE ${conditions.join(' AND ')}`,
      countParams
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    return {
      success: true,
      data: result.rows,
      pagination: { page, limit, total }
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
      ss.study_subject_id,
      sed.name as event_name,
      sed.study_event_definition_id,
      c.name as crf_name,
      c.crf_id,
      cv.name as crf_version_name,
      verifier.user_name as verified_by,
      se.date_start as event_start_date,
      se.date_end as event_end_date,
      ec.date_completed,
      ec.date_interviewed,
      ec.interviewer_name
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    INNER JOIN crf c ON cv.crf_id = c.crf_id
    LEFT JOIN user_account verifier ON ec.sdv_update_id = verifier.user_id
    WHERE ec.event_crf_id = $1
  `;

  const result = await pool.query(query, [eventCrfId]);
  return result.rows[0] || null;
};

/**
 * Get form data for SDV preview
 * Returns all item_data for a given event_crf
 */
export const getSDVFormData = async (eventCrfId: number) => {
  logger.info('Getting SDV form data for preview', { eventCrfId });

  try {
    const query = `
      SELECT 
        id.item_data_id,
        i.item_id,
        i.name as item_name,
        i.description as item_description,
        i.oc_oid as item_oid,
        idt.name as data_type,
        id.value,
        id.status_id,
        id.date_created,
        id.date_updated,
        s.label as section_label,
        ig.name as group_name,
        ifm.ordinal,
        ifm.required
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      LEFT JOIN section s ON ifm.section_id = s.section_id
      LEFT JOIN item_group_metadata igm ON i.item_id = igm.item_id
      LEFT JOIN item_group ig ON igm.item_group_id = ig.item_group_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
      ORDER BY COALESCE(ifm.ordinal, 0), i.name
    `;

    const result = await pool.query(query, [eventCrfId]);

    return {
      success: true,
      data: result.rows.map(row => ({
        itemDataId: row.item_data_id,
        itemId: row.item_id,
        name: row.item_name,
        description: row.item_description,
        oid: row.item_oid,
        dataType: row.data_type,
        value: row.value,
        statusId: row.status_id,
        section: row.section_label,
        group: row.group_name,
        ordinal: row.ordinal,
        required: row.required,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }))
    };
  } catch (error: any) {
    logger.error('Get SDV form data error', { error: error.message });
    return { success: false, data: [], error: error.message };
  }
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