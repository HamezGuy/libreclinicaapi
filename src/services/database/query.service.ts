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
 * Helper: get org member user IDs for the caller.
 * Returns null if the caller has no org membership (root admin sees all).
 */
const getOrgMemberUserIds = async (callerUserId: number): Promise<number[] | null> => {
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [callerUserId]
  );
  const callerOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
  if (callerOrgIds.length === 0) return null; // No org = super-admin, see all

  const memberCheck = await pool.query(
    `SELECT DISTINCT user_id FROM acc_organization_member WHERE organization_id = ANY($1::int[]) AND status = 'active'`,
    [callerOrgIds]
  );
  return memberCheck.rows.map((r: any) => r.user_id);
};

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
  },
  callerUserId?: number
): Promise<PaginatedResponse<any>> => {
  logger.info('Getting queries', { ...filters, callerUserId });

  try {
    const { studyId, subjectId, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['dn.parent_dn_id IS NULL']; // Only parent queries
    const params: any[] = [];
    let paramIndex = 1;

    // Org-scoping: only show queries owned by users in the same org
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        conditions.push(`dn.owner_id = ANY($${paramIndex++}::int[])`);
        params.push(orgUserIds);
      }
    }
    
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

    // Get queries - join through mapping tables to get subject info
    // Note: discrepancy_note uses mapping tables (dn_study_subject_map, dn_event_crf_map, etc.)
    // instead of a direct entity_id column
    const dataQuery = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.detailed_notes,
        dn.entity_type,
        dnt.name as type_name,
        dnst.name as status_name,
        dn.date_created,
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
      LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
      LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
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
export const getQueryById = async (queryId: number, callerUserId?: number): Promise<any> => {
  logger.info('Getting query by ID', { queryId, callerUserId });

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
      LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
      LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
      WHERE dn.discrepancy_note_id = $1
    `;

    const parentResult = await pool.query(parentQuery, [queryId]);

    if (parentResult.rows.length === 0) {
      return null;
    }

    const parent = parentResult.rows[0];

    // Org-scoping: verify caller can see this query
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds && !orgUserIds.includes(parent.owner_id)) {
        return null;
      }
    }

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
    subjectId?: number; // Alias for studySubjectId (frontend compatibility)
    description: string;
    detailedNotes?: string;
    typeId?: number;
    queryType?: string; // Frontend sends this as string
    assignedUserId?: number; // User to assign the query to
  },
  userId: number
): Promise<{ success: boolean; queryId?: number; message?: string }> => {
  logger.info('Creating query', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Map queryType string to typeId
    const queryTypeMap: Record<string, number> = {
      'Failed Validation Check': 1,
      'Annotation': 2,
      'Query': 3,
      'Reason for Change': 4
    };
    
    // Use typeId if provided, otherwise map from queryType, default to Query (3)
    const typeId = data.typeId || (data.queryType ? queryTypeMap[data.queryType] : 3) || 3;
    
    // Use studySubjectId or subjectId (alias)
    const studySubjectId = data.studySubjectId || data.subjectId;

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

    // Insert discrepancy note (main record) - include assigned_user_id if provided
    const insertNoteQuery = `
      INSERT INTO discrepancy_note (
        description, detailed_notes, discrepancy_note_type_id,
        resolution_status_id, study_id, entity_type,
        owner_id, assigned_user_id, date_created
      ) VALUES (
        $1, $2, $3, 1, $4, $5, $6, $7, NOW()
      )
      RETURNING discrepancy_note_id
    `;

    const noteResult = await client.query(insertNoteQuery, [
      data.description,
      data.detailedNotes || '',
      typeId,
      data.studyId,
      data.entityType,
      userId,
      data.assignedUserId || null  // Set assigned user if provided
    ]);

    const queryId = noteResult.rows[0].discrepancy_note_id;

    // Insert into appropriate mapping table
    // Note: For studySubject entity type, the mapping table already uses study_subject_id
    // so we don't need to add it again
    const needsStudySubjectColumn = studySubjectId && 
      data.entityType !== 'studySubject' && 
      mapping.idColumn !== 'study_subject_id';
    
    const insertMapQuery = `
      INSERT INTO ${mapping.table} (
        discrepancy_note_id, ${mapping.idColumn}
        ${needsStudySubjectColumn ? ', study_subject_id' : ''}
      ) VALUES (
        $1, $2
        ${needsStudySubjectColumn ? ', $3' : ''}
      )
    `;

    const mapParams = [queryId, data.entityId];
    if (needsStudySubjectColumn) {
      mapParams.push(studySubjectId);
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
 * Creates a child discrepancy_note with parent_dn_id pointing to the parent query.
 * Optionally updates the parent status (e.g., to "Updated" when responding).
 */
export const addQueryResponse = async (
  parentQueryId: number,
  data: {
    description: string;
    detailedNotes?: string;
    newStatusId?: number;  // Optional: update parent status (2=Updated, 3=Resolution Proposed)
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
    const oldStatusId = parent.resolution_status_id;

    // Insert response as child discrepancy_note
    const insertQuery = `
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      ) VALUES (
        $1, $2, $3, 3, $4, $5, $6, $7, NOW()
      )
      RETURNING discrepancy_note_id
    `;

    const insertResult = await client.query(insertQuery, [
      parentQueryId,
      data.description,
      data.detailedNotes || '',
      data.newStatusId || 2, // Default to Updated status for responses
      parent.study_id,
      parent.entity_type,
      userId
    ]);

    const responseId = insertResult.rows[0].discrepancy_note_id;

    // Update parent status if specified, or set to Updated (2) by default
    const newStatusId = data.newStatusId || 2;
    if (newStatusId !== oldStatusId) {
      await client.query(`
        UPDATE discrepancy_note
        SET resolution_status_id = $1
        WHERE discrepancy_note_id = $2
      `, [newStatusId, parentQueryId]);
    }

    // Log audit event for the response
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Response',
        $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%updated%' LIMIT 1)
      )
    `, [
      userId, 
      parentQueryId, 
      `Status: ${oldStatusId}`,
      `Status: ${newStatusId}, Response: ${data.description.substring(0, 200)}`,
      'Query response added'
    ]);

    await client.query('COMMIT');

    logger.info('Query response added successfully', { responseId, parentQueryId });

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
 * Update query status with full audit trail
 * 
 * Resolution Status IDs:
 * 1 = New, 2 = Updated, 3 = Resolution Proposed, 4 = Closed, 5 = Not Applicable
 */
export const updateQueryStatus = async (
  queryId: number,
  statusId: number,
  userId: number,
  options?: {
    reason?: string;
    signature?: boolean;  // Whether this is a signed action (e.g., closing a query)
  }
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating query status', { queryId, statusId, userId, options });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current status for audit
    const currentResult = await client.query(
      `SELECT resolution_status_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    if (currentResult.rows.length === 0) {
      throw new Error('Query not found');
    }

    const oldStatusId = currentResult.rows[0].resolution_status_id;
    const queryDescription = currentResult.rows[0].description;

    // Get status names for audit trail
    const statusNames: Record<number, string> = {
      1: 'New',
      2: 'Updated',
      3: 'Resolution Proposed',
      4: 'Closed',
      5: 'Not Applicable'
    };

    // Update the query status
    await client.query(`
      UPDATE discrepancy_note
      SET resolution_status_id = $1
      WHERE discrepancy_note_id = $2
    `, [statusId, queryId]);

    // Determine action type for audit
    let actionName = 'Query status changed';
    if (statusId === 4) {
      actionName = options?.signature ? 'Query closed with signature' : 'Query closed';
    } else if (statusId === 1 && oldStatusId === 4) {
      actionName = 'Query reopened';
    } else if (statusId === 3) {
      actionName = 'Resolution proposed';
    }

    // Log comprehensive audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, $3,
        $4, $5, $6,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%updated%' LIMIT 1)
      )
    `, [
      userId, 
      queryId, 
      actionName,
      `Status: ${statusNames[oldStatusId] || oldStatusId}`,
      `Status: ${statusNames[statusId] || statusId}${options?.signature ? ' (Signed)' : ''}`,
      options?.reason || `Status changed from ${statusNames[oldStatusId]} to ${statusNames[statusId]}`
    ]);

    await client.query('COMMIT');

    logger.info('Query status updated successfully', { queryId, oldStatusId, newStatusId: statusId });

    return {
      success: true,
      message: `Query ${actionName.toLowerCase()} successfully`
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
 * Close query with electronic signature (password verification)
 * 21 CFR Part 11 compliant - requires password re-authentication
 */
export const closeQueryWithSignature = async (
  queryId: number,
  userId: number,
  data: {
    password: string;
    reason: string;
    meaning?: string;  // Signature meaning (e.g., "I have reviewed this data")
  }
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Closing query with signature', { queryId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify password (get user's password hash)
    const userResult = await client.query(
      `SELECT passwd, user_name, first_name, last_name FROM user_account WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];
    
    // LibreClinica uses MD5 hash for passwords
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('md5').update(data.password).digest('hex');

    if (passwordHash !== user.passwd) {
      logger.warn('Invalid password for query signature', { queryId, userId });
      return {
        success: false,
        message: 'Invalid password. Electronic signature verification failed.'
      };
    }

    // Password verified - delegate to the verified function
    return closeQueryWithSignatureVerified(queryId, userId, {
      reason: data.reason,
      meaning: data.meaning
    }, client, user);
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Close query with signature error', { error: error.message });

    return {
      success: false,
      message: `Failed to close query: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Close query with verified electronic signature
 * Called when password has already been verified by middleware
 * 21 CFR Part 11 compliant
 */
export const closeQueryWithSignatureVerified = async (
  queryId: number,
  userId: number,
  data: {
    reason: string;
    meaning?: string;
  },
  existingClient?: any,
  existingUser?: any
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Closing query with verified signature', { queryId, userId });

  const client = existingClient || await pool.connect();
  const needsRelease = !existingClient;

  try {
    if (!existingClient) {
      await client.query('BEGIN');
    }

    // Get user info if not provided
    let user = existingUser;
    if (!user) {
      const userResult = await client.query(
        `SELECT user_name, first_name, last_name FROM user_account WHERE user_id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }
      user = userResult.rows[0];
    }

    // Get current query status
    const queryResult = await client.query(
      `SELECT resolution_status_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    if (queryResult.rows.length === 0) {
      throw new Error('Query not found');
    }

    const oldStatusId = queryResult.rows[0].resolution_status_id;

    // Update query to Closed status (4)
    await client.query(`
      UPDATE discrepancy_note
      SET resolution_status_id = 4
      WHERE discrepancy_note_id = $1
    `, [queryId]);

    // Add closing note as a child discrepancy_note
    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT 
        $1, $2, $3, 3, 4, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [
      queryId, 
      `[SIGNED] ${data.reason}`, 
      data.meaning || 'Electronic signature applied',
      userId
    ]);

    // Log comprehensive audit event with signature details
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Closed with Electronic Signature',
        $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%complete%password%' LIMIT 1)
      )
    `, [
      userId,
      queryId,
      `Status: ${oldStatusId}`,
      `Status: Closed (Signed by ${user.first_name} ${user.last_name})`,
      `${data.reason}. Signature meaning: ${data.meaning || 'Query resolved'}`
    ]);

    if (!existingClient) {
      await client.query('COMMIT');
    }

    logger.info('Query closed with signature successfully', { queryId, userId, userName: user.user_name });

    return {
      success: true,
      message: 'Query closed with electronic signature successfully'
    };
  } catch (error: any) {
    if (!existingClient) {
      await client.query('ROLLBACK');
    }
    logger.error('Close query with signature error', { error: error.message });

    return {
      success: false,
      message: `Failed to close query: ${error.message}`
    };
  } finally {
    if (needsRelease) {
      client.release();
    }
  }
};

/**
 * Get query audit trail
 */
export const getQueryAuditTrail = async (queryId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query audit trail', { queryId, callerUserId });

  try {
    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.entity_name as action,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_table = 'discrepancy_note'
        AND ale.entity_id = $1
      ORDER BY ale.audit_date DESC
    `;

    const result = await pool.query(query, [queryId]);

    // Org-scoping: verify caller can see this query's audit trail
    if (callerUserId && result.rows.length > 0) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        return result.rows.filter((r: any) => orgUserIds.includes(r.user_id || 0));
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get query audit trail error', { error: error.message });
    return [];
  }
};

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
        orgFilter = ` AND dn.owner_id = ANY($2::int[])`;
        params.push(orgUserIds);
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
 * Get query types from database
 */
export const getQueryTypes = async (): Promise<any[]> => {
  logger.info('Getting query types');

  try {
    const query = `
      SELECT 
        discrepancy_note_type_id as id,
        name,
        description
      FROM discrepancy_note_type
      ORDER BY discrepancy_note_type_id
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Get query types error', { error: error.message });
    return [];
  }
};

/**
 * Get resolution statuses from database
 */
export const getResolutionStatuses = async (): Promise<any[]> => {
  logger.info('Getting resolution statuses');

  try {
    const query = `
      SELECT 
        resolution_status_id as id,
        name
      FROM resolution_status
      ORDER BY resolution_status_id
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Get resolution statuses error', { error: error.message });
    return [];
  }
};

/**
 * Get queries for a specific form (event_crf)
 */
export const getFormQueries = async (eventCrfId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting form queries', { eventCrfId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [eventCrfId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND dn.owner_id = ANY($2::int[])`;
        params.push(orgUserIds);
      }
    }

    const query = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.detailed_notes,
        dnt.name as type_name,
        dnst.name as status_name,
        dn.date_created,
        u1.user_name as created_by,
        u2.user_name as assigned_to,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      INNER JOIN dn_event_crf_map decm ON dn.discrepancy_note_id = decm.discrepancy_note_id
      WHERE decm.event_crf_id = $1
        AND dn.parent_dn_id IS NULL${orgFilter}
      ORDER BY dn.date_created DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get form queries error', { error: error.message });
    return [];
  }
};

/**
 * Reassign query to another user
 */
export const reassignQuery = async (
  queryId: number,
  assignedUserId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Reassigning query', { queryId, assignedUserId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current assignment
    const currentQuery = await client.query(
      'SELECT assigned_user_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
      [queryId]
    );

    if (currentQuery.rows.length === 0) {
      throw new Error('Query not found');
    }

    const oldAssignedUserId = currentQuery.rows[0].assigned_user_id;

    // Update assignment
    await client.query(`
      UPDATE discrepancy_note
      SET assigned_user_id = $1
      WHERE discrepancy_note_id = $2
    `, [assignedUserId, queryId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Reassigned', $3::text, $4::text,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Query Updated' LIMIT 1)
      )
    `, [userId, queryId, oldAssignedUserId, assignedUserId]);

    await client.query('COMMIT');

    return { success: true, message: 'Query reassigned successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Reassign query error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
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
        orgFilter = ` AND dn.owner_id = ANY($2::int[])`;
        params.push(orgUserIds);
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
    return [];
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
        orgFilter = ` AND dn.owner_id = ANY($2::int[])`;
        params.push(orgUserIds);
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
    return [];
  }
};

/**
 * Get query thread (conversation history)
 */
export const getQueryThread = async (queryId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query thread', { queryId, callerUserId });

  try {
    const query = `
      WITH RECURSIVE query_thread AS (
        -- Get the parent query
        SELECT 
          dn.discrepancy_note_id,
          dn.parent_dn_id,
          dn.description,
          dn.detailed_notes,
          dn.date_created,
          u.user_name as created_by,
          u.first_name || ' ' || u.last_name as user_full_name,
          0 as level
        FROM discrepancy_note dn
        LEFT JOIN user_account u ON dn.owner_id = u.user_id
        WHERE dn.discrepancy_note_id = $1
        
        UNION ALL
        
        -- Get all responses
        SELECT 
          dn.discrepancy_note_id,
          dn.parent_dn_id,
          dn.description,
          dn.detailed_notes,
          dn.date_created,
          u.user_name as created_by,
          u.first_name || ' ' || u.last_name as user_full_name,
          qt.level + 1
        FROM discrepancy_note dn
        INNER JOIN query_thread qt ON dn.parent_dn_id = qt.discrepancy_note_id
        LEFT JOIN user_account u ON dn.owner_id = u.user_id
      )
      SELECT * FROM query_thread
      ORDER BY date_created ASC
    `;

    const result = await pool.query(query, [queryId]);

    // Org-scoping: verify caller can see this query thread
    if (callerUserId && result.rows.length > 0) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        const parentOwner = result.rows[0];
        // Check if any user in the thread is in the caller's org
        const hasAccess = result.rows.some((r: any) => {
          const creatorId = r.owner_id || r.created_by_id;
          return orgUserIds.includes(creatorId);
        });
        if (!hasAccess) return [];
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get query thread error', { error: error.message });
    return [];
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
        AND dn.date_created < NOW() - INTERVAL '${daysThreshold} days'${callerUserId ? ` AND dn.owner_id = ANY($2::int[])` : ''}
      ORDER BY dn.date_created ASC
    `;

    const params: any[] = [studyId];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) params.push(orgUserIds);
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get overdue queries error', { error: error.message });
    return [];
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
    return [];
  }
};

/**
 * Get queries for a specific field (item_data)
 * 
 * This retrieves queries linked to a specific data point via dn_item_data_map.
 * Used for displaying field-level query indicators in the UI.
 */
export const getFieldQueries = async (itemDataId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting field queries', { itemDataId, callerUserId });

  try {
    const query = `
      SELECT 
        dn.discrepancy_note_id,
        dn.description,
        dn.detailed_notes,
        dnt.name as type_name,
        dnst.name as status_name,
        dn.date_created,
        u1.user_name as created_by,
        u2.user_name as assigned_to,
        dim.column_name,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
      WHERE dim.item_data_id = $1
        AND dn.parent_dn_id IS NULL${callerUserId ? ` AND dn.owner_id = ANY($2::int[])` : ''}
      ORDER BY dn.date_created DESC
    `;

    const params: any[] = [itemDataId];
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) params.push(orgUserIds);
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get field queries error', { error: error.message });
    return [];
  }
};

/**
 * Get queries for a field by event_crf_id and field name
 * 
 * This retrieves queries linked to a specific field within a form instance.
 * Used when itemDataId is not known but eventCrfId and fieldName are available.
 */
export const getQueriesByField = async (eventCrfId: number, fieldName: string, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting queries by field', { eventCrfId, fieldName });

  try {
    // First, find the item_data_id for this field
    const itemDataQuery = `
      SELECT id.item_data_id
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1
        AND (LOWER(i.name) = LOWER($2) OR LOWER(i.oc_oid) = LOWER($2))
        AND id.deleted = false
      LIMIT 1
    `;

    const itemDataResult = await pool.query(itemDataQuery, [eventCrfId, fieldName]);
    
    if (itemDataResult.rows.length === 0) {
      // Field not found - return empty array
      return [];
    }

    const itemDataId = itemDataResult.rows[0].item_data_id;
    return await getFieldQueries(itemDataId, callerUserId);
  } catch (error: any) {
    logger.error('Get queries by field error', { error: error.message });
    return [];
  }
};

/**
 * Get open query count for all fields in a form
 * 
 * Returns a map of fieldName -> openQueryCount for efficient UI rendering.
 */
export const getFormFieldQueryCounts = async (eventCrfId: number, callerUserId?: number): Promise<Record<string, number>> => {
  logger.info('Getting form field query counts', { eventCrfId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [eventCrfId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND dn.owner_id = ANY($2::int[])`;
        params.push(orgUserIds);
      }
    }

    const query = `
      SELECT 
        i.name as field_name,
        COUNT(dn.discrepancy_note_id) as query_count
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      INNER JOIN dn_item_data_map dim ON id.item_data_id = dim.item_data_id
      INNER JOIN discrepancy_note dn ON dim.discrepancy_note_id = dn.discrepancy_note_id
      INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
        AND dn.parent_dn_id IS NULL
        AND rs.name NOT IN ('Closed', 'Not Applicable')${orgFilter}
      GROUP BY i.name
    `;

    const result = await pool.query(query, params);
    
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.field_name] = parseInt(row.query_count);
    }
    
    return counts;
  } catch (error: any) {
    logger.error('Get form field query counts error', { error: error.message });
    return {};
  }
};

export default {
  getQueries,
  getQueryById,
  createQuery,
  addQueryResponse,
  updateQueryStatus,
  closeQueryWithSignature,
  closeQueryWithSignatureVerified,
  getQueryAuditTrail,
  getQueryStats,
  getQueryTypes,
  getResolutionStatuses,
  getFormQueries,
  getFieldQueries,
  getQueriesByField,
  getFormFieldQueryCounts,
  reassignQuery,
  getQueryCountByStatus,
  getQueryCountByType,
  getQueryThread,
  getOverdueQueries,
  getMyAssignedQueries
};
