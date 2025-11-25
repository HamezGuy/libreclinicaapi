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
