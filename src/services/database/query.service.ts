/**
 * Query Service (Hybrid)
 * 
 * Discrepancy Note (Query) management combining SOAP and Database
 * - Use Database for reading queries
 * - Use SOAP for creating/updating queries (GxP compliant)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../types';

/**
 * Get queries with filters
 */
export const getQueries = async (
  filters: {
    studyId?: number;
    subjectId?: number;
    status?: string;
    page?: number;
    limit?: number;
  }
): Promise<PaginatedResponse<any>> => {
  logger.info('Getting queries', filters);

  try {
    const { studyId, subjectId, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['dn.parent_dn_id IS NULL']; // Only parent queries
    const params: any[] = [];
    let paramIndex = 1;

    if (studyId) {
      conditions.push(`dn.study_id = $${paramIndex++}`);
      params.push(studyId);
    }

    if (subjectId) {
      // discrepancy_note doesn't have study_subject_id - get it through entity relationships
      conditions.push(`ss.study_subject_id = $${paramIndex++}`);
      params.push(subjectId);
    }

    if (status) {
      conditions.push(`dnst.name ILIKE $${paramIndex++}`);
      params.push(`%${status}%`);
    }

    const whereClause = conditions.join(' AND ');

    // Count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get queries - join through entity relationships to get subject info
    const dataQuery = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.detailed_notes,
        dn.entity_type,
        dn.entity_id,
        dnt.name as type_name,
        dnst.name as status_name,
        dn.date_created,
        dn.thread_number,
        u1.user_name as created_by,
        u2.user_name as assigned_to,
        dn.study_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      LEFT JOIN study s ON dn.study_id = s.study_id
      LEFT JOIN event_crf ec ON dn.entity_type = 'event_crf' AND dn.entity_id = ec.event_crf_id
      LEFT JOIN study_event se ON ec.study_event_id = se.study_event_id
      LEFT JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ${whereClause}
      ORDER BY dn.date_created DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

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
    logger.error('Get queries error', { error: error.message });
    throw error;
  }
};

/**
 * Get query by ID with responses
 */
export const getQueryById = async (queryId: number): Promise<any> => {
  logger.info('Getting query by ID', { queryId });

  try {
    // Get parent query with subject info through entity relationships
    const parentQuery = `
      SELECT 
        dn.*,
        dnt.name as type_name,
        dnst.name as status_name,
        u1.user_name as created_by,
        u2.user_name as assigned_to,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      LEFT JOIN study s ON dn.study_id = s.study_id
      LEFT JOIN event_crf ec ON dn.entity_type = 'event_crf' AND dn.entity_id = ec.event_crf_id
      LEFT JOIN study_event se ON ec.study_event_id = se.study_event_id
      LEFT JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE dn.discrepancy_note_id = $1
    `;

    const parentResult = await pool.query(parentQuery, [queryId]);

    if (parentResult.rows.length === 0) {
      return null;
    }

    const parent = parentResult.rows[0];

    // Get responses
    const responsesQuery = `
      SELECT 
        dn.*,
        dnt.name as type_name,
        u.user_name as created_by
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      LEFT JOIN user_account u ON dn.owner_id = u.user_id
      WHERE dn.parent_dn_id = $1
      ORDER BY dn.date_created ASC
    `;

    const responsesResult = await pool.query(responsesQuery, [queryId]);

    return {
      ...parent,
      responses: responsesResult.rows
    };
  } catch (error: any) {
    logger.error('Get query by ID error', { error: error.message });
    throw error;
  }
};

/**
 * Create query
 * Note: discrepancy_note links to entities via mapping tables (dn_item_data_map, etc.)
 */
export const createQuery = async (
  data: {
    entityType: string;
    entityId: number;
    studyId: number;
    studySubjectId?: number;
    description: string;
    detailedNotes?: string;
    typeId?: number;
  },
  userId: number
): Promise<{ success: boolean; queryId?: number; message?: string }> => {
  logger.info('Creating query', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate entity type and get mapping table
    const mappingConfig: Record<string, { table: string; idColumn: string }> = {
      'itemData': { table: 'dn_item_data_map', idColumn: 'item_data_id' },
      'eventCrf': { table: 'dn_event_crf_map', idColumn: 'event_crf_id' },
      'studySubject': { table: 'dn_study_subject_map', idColumn: 'study_subject_id' },
      'studyEvent': { table: 'dn_study_event_map', idColumn: 'study_event_id' }
    };

    const mapping = mappingConfig[data.entityType];
    if (!mapping) {
      return {
        success: false,
        message: 'Invalid entity type. Must be: itemData, eventCrf, studySubject, or studyEvent'
      };
    }

    // Insert discrepancy note (main record)
    const insertNoteQuery = `
      INSERT INTO discrepancy_note (
        description, detailed_notes, discrepancy_note_type_id,
        resolution_status_id, study_id, entity_type,
        owner_id, date_created
      ) VALUES (
        $1, $2, $3, 1, $4, $5, $6, NOW()
      )
      RETURNING discrepancy_note_id
    `;

    const noteResult = await client.query(insertNoteQuery, [
      data.description,
      data.detailedNotes || '',
      data.typeId || 3, // Default to Query type (3)
      data.studyId,
      data.entityType,
      userId
    ]);

    const queryId = noteResult.rows[0].discrepancy_note_id;

    // Insert into appropriate mapping table
    const insertMapQuery = `
      INSERT INTO ${mapping.table} (
        discrepancy_note_id, ${mapping.idColumn}
        ${data.studySubjectId ? ', study_subject_id' : ''}
      ) VALUES (
        $1, $2
        ${data.studySubjectId ? ', $3' : ''}
      )
    `;

    const mapParams = [queryId, data.entityId];
    if (data.studySubjectId) {
      mapParams.push(data.studySubjectId);
    }

    await client.query(insertMapQuery, mapParams);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Query Created' LIMIT 1)
      )
    `, [userId, queryId, data.description]);

    await client.query('COMMIT');

    logger.info('Query created successfully', { queryId });

    return {
      success: true,
      queryId,
      message: 'Query created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create query error', { error: error.message, data });

    return {
      success: false,
      message: `Failed to create query: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Add response to query
 */
export const addQueryResponse = async (
  parentQueryId: number,
  data: {
    description: string;
    detailedNotes?: string;
  },
  userId: number
): Promise<{ success: boolean; responseId?: number; message?: string }> => {
  logger.info('Adding query response', { parentQueryId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get parent query details
    const parentQuery = `
      SELECT * FROM discrepancy_note WHERE discrepancy_note_id = $1
    `;
    const parentResult = await client.query(parentQuery, [parentQueryId]);

    if (parentResult.rows.length === 0) {
      return {
        success: false,
        message: 'Parent query not found'
      };
    }

    const parent = parentResult.rows[0];

    // Insert response
    const insertQuery = `
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, owner_id, date_created
      ) VALUES (
        $1, $2, $3, 3, $4, $5, $6, NOW()
      )
      RETURNING discrepancy_note_id
    `;

    const insertResult = await client.query(insertQuery, [
      parentQueryId,
      data.description,
      data.detailedNotes || '',
      parent.resolution_status_id, // Keep same status
      parent.study_id,
      userId
    ]);

    const responseId = insertResult.rows[0].discrepancy_note_id;

    await client.query('COMMIT');

    logger.info('Query response added successfully', { responseId });

    return {
      success: true,
      responseId,
      message: 'Response added successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Add query response error', { error: error.message });

    return {
      success: false,
      message: `Failed to add response: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update query status
 */
export const updateQueryStatus = async (
  queryId: number,
  statusId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating query status', { queryId, statusId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE discrepancy_note
      SET resolution_status_id = $1, date_updated = NOW(), update_id = $2
      WHERE discrepancy_note_id = $3
    `, [statusId, userId, queryId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Query Updated' LIMIT 1)
      )
    `, [userId, queryId]);

    await client.query('COMMIT');

    logger.info('Query status updated successfully', { queryId });

    return {
      success: true,
      message: 'Query status updated successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update query status error', { error: error.message });

    return {
      success: false,
      message: `Failed to update status: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get query statistics for a study
 */
export const getQueryStats = async (studyId: number): Promise<any> => {
  logger.info('Getting query statistics', { studyId });

  try {
    const query = `
      SELECT 
        dnst.name as status,
        COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      WHERE dn.study_id = $1
        AND dn.parent_dn_id IS NULL
      GROUP BY dnst.name
      ORDER BY count DESC
    `;

    const result = await pool.query(query, [studyId]);

    return result.rows;
  } catch (error: any) {
    logger.error('Get query stats error', { error: error.message });
    throw error;
  }
};

export default {
  getQueries,
  getQueryById,
  createQuery,
  addQueryResponse,
  updateQueryStatus,
  getQueryStats
};
