/**
 * Randomization Service
 * Queries subject_group_map, study_group, study_group_class from LibreClinica
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export const getRandomizations = async (filters: {
  studyId?: number;
  page?: number;
  limit?: number;
}) => {
  logger.info('Getting randomizations', filters);

  try {
    const { studyId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        sgm.subject_group_map_id,
        sgm.study_group_id,
        sg.name as group_name,
        sgc.name as group_class_name,
        ss.study_subject_id,
        ss.label as subject_label,
        sgm.date_created
      FROM subject_group_map sgm
      INNER JOIN study_group sg ON sgm.study_group_id = sg.study_group_id
      INNER JOIN study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id
      INNER JOIN study_subject ss ON sgm.study_subject_id = ss.study_subject_id
      WHERE sgc.study_id = $1
      ORDER BY sgm.date_created DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [studyId, limit, offset]);

    return {
      success: true,
      data: result.rows,
      pagination: { page, limit, total: result.rows.length }
    };
  } catch (error: any) {
    logger.error('Get randomizations error', { error: error.message });
    throw error;
  }
};

export const getGroupsByStudy = async (studyId: number) => {
  const query = `
    SELECT 
      sg.study_group_id,
      sg.name as group_name,
      sg.description,
      sgc.name as class_name,
      sgc.study_group_class_id,
      (SELECT COUNT(*) FROM subject_group_map WHERE study_group_id = sg.study_group_id) as subject_count
    FROM study_group sg
    INNER JOIN study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id
    WHERE sgc.study_id = $1
    ORDER BY sgc.name, sg.name
  `;

  const result = await pool.query(query, [studyId]);
  return { success: true, data: result.rows };
};

export const createRandomization = async (data: {
  studySubjectId: number;
  studyGroupId: number;
}, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO subject_group_map (study_subject_id, study_group_id, owner_id, date_created)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [data.studySubjectId, data.studyGroupId, userId]);

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'subject_group_map', $1, $2, 'Subject Randomized',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1))
    `, [userId, result.rows[0].subject_group_map_id]);

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
 * Get randomization statistics for a study
 */
export const getRandomizationStats = async (studyId: number) => {
  logger.info('Getting randomization stats', { studyId });

  try {
    const query = `
      SELECT 
        sg.study_group_id,
        sg.name as group_name,
        sgc.name as class_name,
        COUNT(sgm.subject_group_map_id) as subject_count
      FROM study_group sg
      INNER JOIN study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id
      LEFT JOIN subject_group_map sgm ON sg.study_group_id = sgm.study_group_id
      WHERE sgc.study_id = $1
      GROUP BY sg.study_group_id, sg.name, sgc.name
      ORDER BY sgc.name, sg.name
    `;

    const result = await pool.query(query, [studyId]);
    
    const totalRandomized = result.rows.reduce((sum, row) => sum + parseInt(row.subject_count || 0), 0);

    return {
      success: true,
      data: {
        totalRandomized,
        groups: result.rows.map(row => ({
          groupId: row.study_group_id,
          groupName: row.group_name,
          className: row.class_name,
          subjectCount: parseInt(row.subject_count) || 0,
          percentage: totalRandomized > 0 
            ? Math.round((parseInt(row.subject_count) / totalRandomized) * 100) 
            : 0
        }))
      }
    };
  } catch (error: any) {
    logger.error('Get randomization stats error', { error: error.message });
    throw error;
  }
};

/**
 * Check if subject can be randomized
 */
export const canRandomize = async (subjectId: number) => {
  logger.info('Checking if subject can be randomized', { subjectId });

  try {
    // Check if already randomized
    const existingQuery = `
      SELECT COUNT(*) as count
      FROM subject_group_map
      WHERE study_subject_id = $1
    `;

    const existing = await pool.query(existingQuery, [subjectId]);
    const alreadyRandomized = parseInt(existing.rows[0].count) > 0;

    // Check subject status
    const subjectQuery = `
      SELECT ss.status_id, st.name as status_name
      FROM study_subject ss
      INNER JOIN status st ON ss.status_id = st.status_id
      WHERE ss.study_subject_id = $1
    `;

    const subject = await pool.query(subjectQuery, [subjectId]);
    const isActive = subject.rows[0]?.status_name === 'available';

    return {
      success: true,
      data: {
        canRandomize: !alreadyRandomized && isActive,
        alreadyRandomized,
        isActive,
        reason: alreadyRandomized ? 'Subject already randomized' 
               : !isActive ? 'Subject is not in active status' 
               : null
      }
    };
  } catch (error: any) {
    logger.error('Can randomize check error', { error: error.message });
    throw error;
  }
};

/**
 * Get subject's randomization info
 */
export const getSubjectRandomization = async (subjectId: number) => {
  logger.info('Getting subject randomization', { subjectId });

  try {
    const query = `
      SELECT 
        sgm.*,
        sg.name as group_name,
        sg.description as group_description,
        sgc.name as class_name,
        u.user_name as randomized_by
      FROM subject_group_map sgm
      INNER JOIN study_group sg ON sgm.study_group_id = sg.study_group_id
      INNER JOIN study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id
      LEFT JOIN user_account u ON sgm.owner_id = u.user_id
      WHERE sgm.study_subject_id = $1
    `;

    const result = await pool.query(query, [subjectId]);

    if (result.rows.length === 0) {
      return { success: true, data: null, message: 'Subject not randomized' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error: any) {
    logger.error('Get subject randomization error', { error: error.message });
    throw error;
  }
};

/**
 * Remove randomization (for corrections)
 */
export const removeRandomization = async (subjectId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const deleteQuery = `
      DELETE FROM subject_group_map
      WHERE study_subject_id = $1
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [subjectId]);

    if (result.rows.length > 0) {
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
        VALUES (CURRENT_TIMESTAMP, 'subject_group_map', $1, $2, 'Randomization Removed',
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Deleted' LIMIT 1))
      `, [userId, result.rows[0].subject_group_map_id]);
    }

    await client.query('COMMIT');

    return { 
      success: true, 
      message: result.rows.length > 0 ? 'Randomization removed' : 'No randomization found'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get unblinded subjects (for unblinding functionality)
 */
export const getUnblindingEvents = async (studyId: number) => {
  logger.info('Getting unblinding events', { studyId });

  try {
    // Get audit events related to unblinding
    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_table = 'subject_group_map'
        AND ale.entity_name LIKE '%Unblind%'
      ORDER BY ale.audit_date DESC
      LIMIT 100
    `;

    const result = await pool.query(query);

    return { success: true, data: result.rows };
  } catch (error: any) {
    logger.error('Get unblinding events error', { error: error.message });
    return { success: true, data: [] };
  }
};

/**
 * Unblind a subject
 */
export const unblindSubject = async (subjectId: number, userId: number, reason: string) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the randomization info
    const randomization = await getSubjectRandomization(subjectId);
    
    if (!randomization.data) {
      throw new Error('Subject is not randomized');
    }

    // Log the unblinding event
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'subject_group_map', $1, $2, 'Subject Unblinded', 'Blinded', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, randomization.data.subject_group_map_id, `Unblinded - Reason: ${reason}`]);

    await client.query('COMMIT');

    return { 
      success: true, 
      data: {
        subjectId,
        groupName: randomization.data.group_name,
        className: randomization.data.class_name,
        unblindedAt: new Date(),
        reason
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};