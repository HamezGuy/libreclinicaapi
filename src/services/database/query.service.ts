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
import * as notificationService from './notification.service';
import { resolveAllQueryAssignees } from './workflow-config.provider';
import { verifyAndUpgrade } from '../../utils/password.util';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from '../../middleware/errorHandler.middleware';

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
 * Check if a caller can edit (respond to, close, update status) a query.
 * Allowed editors:
 *   - The assigned user
 *   - The query owner/creator
 *   - Users with elevated roles: admin, data_manager, monitor
 * Returns { allowed: true } or { allowed: false, message }.
 */
export const canEditQuery = async (
  queryId: number,
  callerUserId: number,
  callerRole?: string
): Promise<{ allowed: boolean; message?: string }> => {
  // Elevated roles can always edit
  const elevatedRoles = ['admin', 'data_manager', 'monitor'];
  if (callerRole && elevatedRoles.includes(callerRole.toLowerCase())) {
    return { allowed: true };
  }

  try {
    const result = await pool.query(
      `SELECT owner_id, assigned_user_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );
    if (result.rows.length === 0) {
      return { allowed: false, message: 'Query not found' };
    }
    const { owner_id, assigned_user_id } = result.rows[0];

    if (callerUserId === owner_id || callerUserId === assigned_user_id) {
      return { allowed: true };
    }

    return {
      allowed: false,
      message: 'You can only modify queries assigned to you or that you created'
    };
  } catch (error: any) {
    logger.error('Error checking query edit permission', { queryId, callerUserId, error: error.message });
    return { allowed: false, message: 'Permission check failed' };
  }
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

    // Count - must include the same JOINs as the data query when subjectId filter is used
    const countQuery = `
      SELECT COUNT(*) as total
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      ${subjectId ? 'LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id' : ''}
      ${subjectId ? 'LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id' : ''}
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
        dn.resolution_status_id,
        dn.discrepancy_note_type_id,
        dn.owner_id,
        dn.assigned_user_id,
        dnt.name as type_name,
        dnst.name as status_name,
        dn.date_created,
        u1.user_name as created_by,
        u1.first_name || ' ' || u1.last_name as owner_name,
        u2.user_name as assigned_to,
        u2.first_name || ' ' || u2.last_name as assigned_user_name,
        dn.study_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count,
        dn.severity,
        dn.due_date
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

    // Fetch linked item_data for field-level queries so the frontend
    // can display the current value and offer data correction.
    let linkedItemData: any = null;
    let linkedEventCrf: any = null;
    let canCorrectValue = false;

    try {
      const linkedDataQuery = `
        SELECT
          dim.item_data_id,
          id.item_id,
          id.value AS current_value,
          id.event_crf_id,
          i.name AS field_name,
          i.oc_oid AS field_oid,
          dim.column_name,
          c.name AS form_name,
          cv.name AS form_version
        FROM dn_item_data_map dim
        INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
        INNER JOIN item i ON id.item_id = i.item_id
        LEFT JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
        LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        LEFT JOIN crf c ON cv.crf_id = c.crf_id
        WHERE dim.discrepancy_note_id = $1
        LIMIT 1
      `;
      const linkedResult = await pool.query(linkedDataQuery, [queryId]);

      if (linkedResult.rows.length > 0) {
        const r = linkedResult.rows[0];
        linkedItemData = {
          itemDataId: r.item_data_id,
          itemId: r.item_id,
          eventCrfId: r.event_crf_id,
          fieldName: r.field_name,
          fieldOid: r.field_oid,
          columnName: r.column_name,
          currentValue: r.current_value,
          formName: r.form_name,
          formVersion: r.form_version
        };
        linkedEventCrf = {
          eventCrfId: r.event_crf_id,
          formName: r.form_name,
          formVersion: r.form_version
        };
        canCorrectValue = true;
      } else {
        // Check event_crf-level linkage (no field-level correction possible)
        const ecrfLink = await pool.query(
          `SELECT decm.event_crf_id, decm.column_name,
                  c.name AS form_name, cv.name AS form_version
           FROM dn_event_crf_map decm
           LEFT JOIN event_crf ec ON decm.event_crf_id = ec.event_crf_id
           LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
           LEFT JOIN crf c ON cv.crf_id = c.crf_id
           WHERE decm.discrepancy_note_id = $1 LIMIT 1`,
          [queryId]
        );
        if (ecrfLink.rows.length > 0) {
          linkedEventCrf = {
            eventCrfId: ecrfLink.rows[0].event_crf_id,
            columnName: ecrfLink.rows[0].column_name,
            formName: ecrfLink.rows[0].form_name,
            formVersion: ecrfLink.rows[0].form_version
          };
        }
      }
    } catch (linkedErr: any) {
      logger.warn('Failed to fetch linked item data for query', { queryId, error: linkedErr.message });
    }

    return {
      ...parent,
      responses: responsesResult.rows,
      linkedItemData,
      linkedEventCrf,
      canCorrectValue
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
    subjectId?: number;
    description: string;
    detailedNotes?: string;
    typeId?: number;
    queryType?: string;
    assignedUserId?: number;
    severity?: string;
    dueDate?: string | null;
  },
  userId: number
): Promise<{ success: true; queryId: number; message: string }> => {
  logger.info('Creating query', { data, userId });

  const client = await pool.connect();
  let txStarted = false;

  try {
    await client.query('BEGIN');
    txStarted = true;

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
      throw new BadRequestError('Invalid entity type. Must be: itemData, eventCrf, studySubject, or studyEvent');
    }

    // Resolve query assignment via shared workflow-config.provider.
    // Always resolve workflow-configured recipients first.
    // If a manual assignedUserId is provided, it is ADDED as an additional recipient
    // alongside the workflow-resolved ones — it does NOT replace them.
    let resolvedAssignedUserId: number | null = null;
    let workflowAdditionalIds: number[] = [];

    if (data.entityType === 'eventCrf' || data.entityType === 'itemData') {
      try {
        let eventCrfIdForLookup: number | undefined;

        if (data.entityType === 'eventCrf') {
          eventCrfIdForLookup = data.entityId;
        } else if (data.entityType === 'itemData') {
          // The frontend may send item.item_id as entityId; use eventCrfId directly if available
          const ecId = (data as any).eventCrfId;
          if (ecId) {
            eventCrfIdForLookup = ecId;
          } else {
            const idResult = await client.query(
              `SELECT event_crf_id FROM item_data WHERE item_data_id = $1`,
              [data.entityId]
            );
            if (idResult.rows.length > 0) eventCrfIdForLookup = idResult.rows[0].event_crf_id;
          }
        }

        const assignees = await resolveAllQueryAssignees(
          undefined, data.studyId, eventCrfIdForLookup
        );
        if (assignees.primaryUserId) {
          resolvedAssignedUserId = assignees.primaryUserId;
          workflowAdditionalIds = assignees.additionalUserIds;
        }
      } catch (e: any) {
        logger.warn('Could not resolve workflow assignee for query:', e.message);
      }
    }

    // If no workflow primary found, fall back to manual selection as primary
    if (!resolvedAssignedUserId && data.assignedUserId) {
      resolvedAssignedUserId = data.assignedUserId;
    } else if (data.assignedUserId && data.assignedUserId !== resolvedAssignedUserId) {
      // Manual selection is appended as additional recipient (deduped below)
      workflowAdditionalIds = [...workflowAdditionalIds, data.assignedUserId];
    }

    // Deduplicate additional IDs and remove the primary so we don't double-notify
    const uniqueAdditionalIds = [...new Set(workflowAdditionalIds)].filter(
      id => id !== resolvedAssignedUserId
    );
    (data as any)._additionalAssigneeIds = uniqueAdditionalIds;

    // Insert discrepancy note (main record) with resolved assignment
    const insertNoteQuery = `
      INSERT INTO discrepancy_note (
        description, detailed_notes, discrepancy_note_type_id,
        resolution_status_id, study_id, entity_type,
        owner_id, assigned_user_id, date_created,
        severity, due_date
      ) VALUES (
        $1, $2, $3, 1, $4, $5, $6, $7, NOW(),
        $8, $9
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
      resolvedAssignedUserId,
      data.severity || 'minor',
      data.dueDate || null  // Workflow-resolved or explicitly provided
    ]);

    const queryId = noteResult.rows[0].discrepancy_note_id;

    // Resolve the correct entity ID for the mapping table.
    let resolvedEntityId = data.entityId;

    // For eventCrf type: entityId or eventCrfId must resolve to a valid event_crf row
    if (data.entityType === 'eventCrf') {
      if (!resolvedEntityId && (data as any).eventCrfId) {
        resolvedEntityId = (data as any).eventCrfId;
      }
      if (!resolvedEntityId) {
        throw new BadRequestError(
          'Cannot create eventCrf query: entityId or eventCrfId is required. ' +
          'Please save the form before creating a query.'
        );
      }
      // Validate the event_crf actually exists
      const ecCheck = await client.query(
        'SELECT event_crf_id FROM event_crf WHERE event_crf_id = $1',
        [resolvedEntityId]
      );
      if (ecCheck.rows.length === 0) {
        throw new BadRequestError(
          `Cannot create query: event_crf_id ${resolvedEntityId} does not exist. ` +
          'The form may not have been saved yet.'
        );
      }
    }

    // For studySubject type: validate the subject exists
    if (data.entityType === 'studySubject' && resolvedEntityId) {
      const ssCheck = await client.query(
        'SELECT study_subject_id FROM study_subject WHERE study_subject_id = $1',
        [resolvedEntityId]
      );
      if (ssCheck.rows.length === 0) {
        throw new BadRequestError(
          `Cannot create query: study_subject_id ${resolvedEntityId} does not exist.`
        );
      }
    }

    if (data.entityType === 'itemData') {
      if ((data as any).itemDataId) {
        resolvedEntityId = (data as any).itemDataId;
      } else {
        const eventCrfId = (data as any).eventCrfId;
        let itemId = (data as any).itemId || data.entityId;
        const fieldName = (data as any).fieldName;

        if (!eventCrfId) {
          throw new BadRequestError(
            'Cannot create field-level query: eventCrfId is required to resolve the data row. ' +
            'Please save the form before creating a query on this field.'
          );
        }

        // If itemId is not provided but fieldName is, resolve itemId from the
        // field name by joining through event_crf → crf_version → item.
        // The match is case-insensitive and handles underscore/space differences
        // because the item.name stores labels like "Heart Rate" while the frontend
        // uses fieldName like "heart_rate".
        if (!itemId && fieldName) {
          const normalizedName = fieldName.toLowerCase();
          // Try matching by item name, OID, or fieldName embedded in description.
          // The form save service stores fieldName inside ---EXTENDED_PROPS--- in
          // item.description and resolves it via extProps.fieldName.toLowerCase().
          const itemLookup = await client.query(`
            SELECT i.item_id
            FROM item i
            INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
            INNER JOIN crf_version cv ON ifm.crf_version_id = cv.crf_version_id
            INNER JOIN event_crf ec ON cv.crf_version_id = ec.crf_version_id
            WHERE ec.event_crf_id = $1
              AND (
                LOWER(i.name) = $2
                OR LOWER(i.oc_oid) = $2
                OR LOWER(REPLACE(i.name, ' ', '_')) = $2
                OR LOWER(REPLACE(i.name, ' ', '')) = REPLACE($2, '_', '')
                OR i.description ILIKE '%"fieldName":"' || $2 || '"%'
              )
            LIMIT 1
          `, [eventCrfId, normalizedName]);
          if (itemLookup.rows.length > 0) {
            itemId = itemLookup.rows[0].item_id;
            logger.info('Resolved itemId from fieldName', { fieldName, itemId, eventCrfId });
          }
        }

        if (!itemId) {
          throw new BadRequestError(
            'Cannot create field-level query: itemId or fieldName is required to identify the field.'
          );
        }

        const itemDataLookup = await client.query(`
          SELECT item_data_id FROM item_data
          WHERE event_crf_id = $1 AND item_id = $2 AND deleted = false
          ORDER BY item_data_id DESC LIMIT 1
        `, [eventCrfId, itemId]);

        if (itemDataLookup.rows.length === 0) {
          throw new BadRequestError(
            'Cannot create field-level query: this field has no saved data yet. ' +
            'Please save the form first, then create the query.'
          );
        }

        resolvedEntityId = itemDataLookup.rows[0].item_data_id;
        logger.info('Resolved item_data_id from eventCrfId + itemId', {
          eventCrfId, itemId, resolvedItemDataId: resolvedEntityId
        });
      }
    }

    // Insert into the mapping table with the validated entity ID
    const fieldPath = (data as any).fieldName || (data as any).fieldPath || (data as any).columnName;
    if (fieldPath && (mapping.table === 'dn_event_crf_map' || mapping.table === 'dn_item_data_map')) {
      await client.query(`
        INSERT INTO ${mapping.table} (discrepancy_note_id, ${mapping.idColumn}, column_name)
        VALUES ($1, $2, $3)
      `, [queryId, resolvedEntityId, fieldPath]);
    } else {
      await client.query(`
        INSERT INTO ${mapping.table} (discrepancy_note_id, ${mapping.idColumn})
        VALUES ($1, $2)
      `, [queryId, resolvedEntityId]);
    }

    // Also create a dn_study_subject_map entry if we have a subjectId
    // and the primary mapping was NOT already dn_study_subject_map
    if (studySubjectId && mapping.table !== 'dn_study_subject_map') {
      try {
        await client.query(`
          INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)
          VALUES ($1, $2, 'value')
        `, [queryId, studySubjectId]);
      } catch (e: any) {
        // Non-critical: don't fail query creation if subject linkage fails
        logger.warn('Could not link query to study subject', { queryId, studySubjectId, error: e.message });
      }
    }

    // Create child discrepancy notes for additional assignees (multi-user routing)
    const additionalAssigneeIds: number[] = uniqueAdditionalIds;
    for (const additionalUserId of additionalAssigneeIds) {
      try {
        const childResult = await client.query(`
          INSERT INTO discrepancy_note (
            description, detailed_notes, discrepancy_note_type_id,
            resolution_status_id, study_id, entity_type,
            owner_id, assigned_user_id, parent_dn_id, date_created
          ) VALUES (
            $1, $2, $3, 1, $4, $5, $6, $7, $8, NOW()
          )
          RETURNING discrepancy_note_id
        `, [
          data.description,
          data.detailedNotes || '',
          typeId,
          data.studyId,
          data.entityType,
          userId,
          additionalUserId,
          queryId  // Link to parent query
        ]);
        
        const childNoteId = childResult.rows[0].discrepancy_note_id;
        await client.query(`
          INSERT INTO ${mapping.table} (discrepancy_note_id, ${mapping.idColumn})
          VALUES ($1, $2)
        `, [childNoteId, resolvedEntityId]);

        logger.info('Created child query for additional assignee', { 
          parentQueryId: queryId, childNoteId, additionalUserId 
        });
      } catch (childError: any) {
        logger.warn('Failed to create child query for additional assignee', { 
          parentQueryId: queryId, additionalUserId, error: childError.message 
        });
      }
    }

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

    // Fire-and-forget: create in-app notifications for all assigned users
    try {
      if (resolvedAssignedUserId) {
        await notificationService.notifyQueryAssigned(
          resolvedAssignedUserId, data.description || 'New query', queryId, data.studyId
        );
      }
      for (const addlId of additionalAssigneeIds) {
        await notificationService.notifyQueryAssigned(
          addlId, data.description || 'New query', queryId, data.studyId
        );
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send query assignment notifications', { error: notifErr.message });
    }

    return { success: true, queryId, message: 'Query created successfully' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in createQuery', { rbErr: rbErr.message })
      );
    }
    logger.error('Create query error', { error: error.message, data });
    throw error; // propagate — asyncHandler → errorHandler converts it to HTTP response
  } finally {
    client.release();
  }
};

/**
 * Add response to query
 * Creates a child discrepancy_note with parent_dn_id pointing to the parent query.
 * Status update (newStatusId) is performed atomically in the same transaction so
 * a second PUT /status call from the frontend is never required.
 */
export const addQueryResponse = async (
  parentQueryId: number,
  data: {
    description: string;
    detailedNotes?: string;
    newStatusId?: number;
    correctedValue?: string;
    correctionReason?: string;
  },
  userId: number
): Promise<{ success: true; responseId: number; message: string; correctionApplied?: boolean }> => {
  logger.info('Adding query response', { parentQueryId, userId });

  // Guarantee a non-empty description — an empty description violates NOT NULL
  const safeDescription = (data.description || '').trim();
  if (!safeDescription) {
    throw new BadRequestError('Response text is required');
  }

  const client = await pool.connect();
  let txStarted = false;

  try {
    await client.query('BEGIN');
    txStarted = true;

    // Get parent query details
    const parentResult = await client.query(
      `SELECT * FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [parentQueryId]
    );

    if (parentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }

    const parent = parentResult.rows[0];
    const oldStatusId = parent.resolution_status_id;

    // Determine the new parent status atomically.
    // Provided newStatusId takes precedence; default to Updated (2).
    const newStatusId = data.newStatusId || 2;

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
      safeDescription,
      data.detailedNotes || '',
      newStatusId,
      parent.study_id,
      parent.entity_type,
      userId
    ]);

    const responseId = insertResult.rows[0].discrepancy_note_id;

    // Update parent status atomically within the same transaction
    if (newStatusId !== oldStatusId) {
      await client.query(`
        UPDATE discrepancy_note
        SET resolution_status_id = $1
        WHERE discrepancy_note_id = $2
      `, [newStatusId, parentQueryId]);
    }

    // Log audit event for the response
    const statusNames: Record<number, string> = {
      1: 'New', 2: 'Updated', 3: 'Resolution Proposed', 4: 'Closed', 5: 'Not Applicable'
    };
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Response',
        $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1)
      )
    `, [
      userId,
      parentQueryId,
      `Status: ${statusNames[oldStatusId] || oldStatusId}`,
      `Status: ${statusNames[newStatusId] || newStatusId}, Response: ${safeDescription.substring(0, 200)}`,
      'Query response added'
    ]);

    // ── DATA CORRECTION: update the linked item_data value if provided ──
    let correctionApplied = false;

    if (data.correctedValue !== undefined && data.correctedValue !== null && data.correctedValue !== '') {
      try {
        const linkedData = await client.query(`
          SELECT dim.item_data_id, id.value AS old_value, id.event_crf_id,
                 i.name AS field_name, i.item_id, i.description AS item_description
          FROM dn_item_data_map dim
          INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
          INNER JOIN item i ON id.item_id = i.item_id
          WHERE dim.discrepancy_note_id = $1
          LIMIT 1
        `, [parentQueryId]);

        if (linkedData.rows.length > 0) {
          const { item_data_id, old_value, event_crf_id, field_name, item_id, item_description } = linkedData.rows[0];

          // Resolve the technical fieldName from extended_props for JSONB sync.
          // The patient_event_form.form_data may be keyed by the technical name
          // (e.g., "heart_rate") rather than the display name (e.g., "Heart Rate").
          let technicalFieldName: string | null = null;
          if (item_description?.includes('---EXTENDED_PROPS---')) {
            try {
              const json = item_description.split('---EXTENDED_PROPS---')[1]?.trim();
              if (json) {
                const ext = JSON.parse(json);
                if (ext.fieldName) technicalFieldName = ext.fieldName;
              }
            } catch { /* ignore parse errors */ }
          }

          // Check lock/freeze status — query-driven corrections are ALLOWED on
          // locked/frozen forms (EDC standard) but we log an explicit audit entry
          let lockNote = '';
          if (event_crf_id) {
            const lockCheck = await client.query(
              `SELECT status_id, COALESCE(frozen, false) AS frozen FROM event_crf WHERE event_crf_id = $1`,
              [event_crf_id]
            );
            if (lockCheck.rows.length > 0) {
              if (lockCheck.rows[0].status_id === 6) lockNote = ' [LOCKED RECORD — query correction override]';
              else if (lockCheck.rows[0].frozen) lockNote = ' [FROZEN RECORD — query correction override]';
            }
          }

          // Detect if this is a structured field (table/question_table) where the
          // real data lives in patient_event_form.form_data JSONB, not item_data.
          const isStructuredField = old_value === '__STRUCTURED_DATA__';
          let correctedValueForItemData = data.correctedValue;

          if (isStructuredField) {
            // Keep the marker in item_data — the real update goes to JSONB below
            correctedValueForItemData = '__STRUCTURED_DATA__';
          }

          // 1. Update item_data value (marker preserved for structured fields)
          await client.query(`
            UPDATE item_data SET value = $1, date_updated = NOW(), update_id = $2
            WHERE item_data_id = $3
          `, [correctedValueForItemData, userId, item_data_id]);

          // 2. Write audit trail for the data correction
          const correctionReason = (data.correctionReason || 'Query resolution data correction') + lockNote;
          await client.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_id,
              old_value, new_value, audit_log_event_type_id,
              event_crf_id, reason_for_change
            ) VALUES (NOW(), 'item_data', $1, $2, $3, $4,
              (SELECT audit_log_event_type_id FROM audit_log_event_type
               WHERE name ILIKE '%updated%' LIMIT 1),
              $5, $6)
          `, [
            userId, item_data_id, old_value, data.correctedValue,
            event_crf_id, correctionReason
          ]);

          // 3. Write audit trail for the query-driven correction (separate entry
          //    on discrepancy_note table for the full query audit history)
          await client.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_id, entity_name,
              old_value, new_value, reason_for_change,
              audit_log_event_type_id
            ) VALUES (
              NOW(), 'discrepancy_note', $1, $2, 'Query Data Correction',
              $3, $4, $5,
              COALESCE(
                (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
                1
              )
            )
          `, [
            userId, parentQueryId,
            `Field: ${field_name}, Value: ${old_value}`,
            `Field: ${field_name}, Corrected Value: ${data.correctedValue}`,
            correctionReason
          ]);

          // 4. Sync corrected value into patient_event_form JSONB snapshot.
          //    Try both the technical fieldName and display name to ensure the
          //    JSONB key matches regardless of how the form was originally saved.
          //    For table/question_table fields, the correctedValue is JSON (array
          //    or object) — store as native JSONB, not double-escaped string.
          if (event_crf_id) {
            let jsonbLiteral: string;
            try {
              const parsed = JSON.parse(data.correctedValue);
              if (typeof parsed === 'object' && parsed !== null) {
                jsonbLiteral = data.correctedValue;
              } else {
                jsonbLiteral = JSON.stringify(data.correctedValue);
              }
            } catch {
              jsonbLiteral = JSON.stringify(data.correctedValue);
            }

            const keysToTry = [technicalFieldName, field_name].filter(Boolean) as string[];
            for (const key of keysToTry) {
              try {
                const updateResult = await client.query(`
                  UPDATE patient_event_form
                  SET form_data = jsonb_set(
                        COALESCE(form_data, '{}'::jsonb),
                        $1::text[], $2::jsonb
                      ),
                      date_updated = NOW()
                  WHERE event_crf_id = $3
                    AND form_data ? $4
                `, [[key], jsonbLiteral, event_crf_id, key]);
                if ((updateResult as any).rowCount > 0) {
                  logger.info('Synced correction to patient_event_form', { 
                    event_crf_id, key, queryId: parentQueryId 
                  });
                  break;
                }
              } catch (snapErr: any) {
                logger.warn('Failed to sync correction to patient_event_form', {
                  error: snapErr.message, event_crf_id, key
                });
              }
            }
            if (keysToTry.length > 0) {
              try {
                const fallbackKey = technicalFieldName || field_name;
                await client.query(`
                  UPDATE patient_event_form
                  SET form_data = jsonb_set(
                        COALESCE(form_data, '{}'::jsonb),
                        $1::text[], $2::jsonb
                      ),
                      date_updated = NOW()
                  WHERE event_crf_id = $3
                    AND NOT (form_data ? $4)
                `, [[fallbackKey], jsonbLiteral, event_crf_id, fallbackKey]);
              } catch { /* non-blocking */ }
            }
          }

          correctionApplied = true;
          logger.info('Data correction applied via query resolution', {
            queryId: parentQueryId, item_data_id, field_name,
            technicalFieldName,
            oldValue: old_value, newValue: data.correctedValue
          });
        } else {
          logger.warn('correctedValue provided but no linked item_data found for query', {
            queryId: parentQueryId
          });
        }
      } catch (correctionErr: any) {
        logger.error('Data correction failed — rolling back', { error: correctionErr.message });
        throw correctionErr;
      }
    }

    await client.query('COMMIT');

    logger.info('Query response added successfully', {
      responseId, parentQueryId, newStatusId, correctionApplied
    });

    // Resolve responder's display name for notifications
    let responderName = 'A user';
    try {
      const responderResult = await pool.query(
        `SELECT first_name, last_name FROM user_account WHERE user_id = $1`, [userId]
      );
      if (responderResult.rows[0]) {
        responderName = `${responderResult.rows[0].first_name} ${responderResult.rows[0].last_name}`.trim();
      }
    } catch { /* ignore */ }

    // Fire-and-forget: notify relevant parties based on the new status
    try {
      const ownerUserId = parent.owner_id;
      const assignedUserId = parent.assigned_user_id;

      if (newStatusId === 4) {
        // Closed — notify owner and assigned user (skip self)
        const toNotify = [...new Set([ownerUserId, assignedUserId].filter(Boolean))];
        for (const uid of toNotify) {
          if (uid !== userId) {
            await notificationService.notifyQueryClosed(
              uid, safeDescription, parentQueryId, responderName, parent.study_id
            );
          }
        }
      } else if (newStatusId === 3) {
        // Resolution proposed — notify owner
        if (ownerUserId && ownerUserId !== userId) {
          await notificationService.notifyResolutionProposed(
            ownerUserId, safeDescription, parentQueryId, responderName, parent.study_id
          );
        }
      } else {
        // Updated — notify owner and assigned user of the response
        if (ownerUserId && ownerUserId !== userId) {
          await notificationService.notifyQueryResponse(
            ownerUserId, safeDescription, parentQueryId, responderName
          );
        }
        if (assignedUserId && assignedUserId !== userId && assignedUserId !== ownerUserId) {
          await notificationService.notifyQueryResponse(
            assignedUserId, safeDescription, parentQueryId, responderName
          );
        }
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send query response notification', { error: notifErr.message });
    }

    return {
      success: true, responseId,
      message: correctionApplied
        ? 'Response added and data correction applied'
        : 'Response added successfully',
      correctionApplied
    };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in addQueryResponse', { rbErr: rbErr.message })
      );
    }
    logger.error('Add query response error', { error: error.message });
    throw error;
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
): Promise<{ success: true; message: string }> => {
  logger.info('Updating query status', { queryId, statusId, userId, options });

  const client = await pool.connect();
  let txStarted = false;

  try {
    await client.query('BEGIN');
    txStarted = true;

    // Get current status for audit
    const currentResult = await client.query(
      `SELECT resolution_status_id, description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    if (currentResult.rows.length === 0) {
      throw new NotFoundError('Query not found');
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

    return { success: true, message: `Query ${actionName.toLowerCase()} successfully` };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in updateQueryStatus', { rbErr: rbErr.message })
      );
    }
    logger.error('Update query status error', { error: error.message });
    throw error;
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
): Promise<{ success: true; message: string }> => {
  logger.info('Closing query with signature', { queryId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Query both MD5 and bcrypt hashes (dual-auth, matching login system)
    let userResult;
    try {
      userResult = await client.query(
        `SELECT u.passwd, u.user_name, u.first_name, u.last_name, uae.bcrypt_passwd
         FROM user_account u
         LEFT JOIN user_account_extended uae ON u.user_id = uae.user_id
         WHERE u.user_id = $1`,
        [userId]
      );
    } catch {
      userResult = await client.query(
        `SELECT passwd, user_name, first_name, last_name FROM user_account WHERE user_id = $1`,
        [userId]
      );
    }

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];

    const verification = await verifyAndUpgrade(
      data.password,
      user.passwd,
      user.bcrypt_passwd || null
    );

    if (!verification.valid) {
      logger.warn('Invalid password for query signature', { queryId, userId });
      throw new ForbiddenError('Invalid password. Electronic signature verification failed.');
    }

    if (verification.shouldUpdateDatabase && verification.upgradedBcryptHash) {
      try {
        await client.query(`
          INSERT INTO user_account_extended (user_id, bcrypt_passwd, passwd_upgraded_at, password_version)
          VALUES ($1, $2, NOW(), 2)
          ON CONFLICT (user_id) DO UPDATE SET bcrypt_passwd = $2, passwd_upgraded_at = NOW(), password_version = 2
        `, [userId, verification.upgradedBcryptHash]);
      } catch { /* non-blocking */ }
    }

    return closeQueryWithSignatureVerified(queryId, userId, {
      reason: data.reason,
      meaning: data.meaning
    }, client, user);
  } catch (error: any) {
    await client.query('ROLLBACK').catch((rbErr: any) =>
      logger.warn('ROLLBACK failed in closeQueryWithSignature', { rbErr: rbErr.message })
    );
    logger.error('Close query with signature error', { error: error.message });
    throw error;
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
): Promise<{ success: true; message: string }> => {
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
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in closeQueryWithSignatureVerified', { rbErr: rbErr.message })
      );
    }
    logger.error('Close query with signature error', { error: error.message });
    throw error;
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
    // Get audit events for the query itself
    const queryAuditSql = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.entity_name as action,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change,
        ale.user_id,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type,
        ale.audit_table
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_table = 'discrepancy_note'
        AND ale.entity_id = $1
    `;

    // Also fetch audit events for any linked item_data corrections driven by this query.
    // These are stored with reason_for_change containing 'Query resolution data correction'
    // and the item_data_id matching the query's dn_item_data_map.
    const dataCorrectionAuditSql = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        'Data Correction (via Query)' as action,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change,
        ale.user_id,
        u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type,
        ale.audit_table
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      INNER JOIN dn_item_data_map dim ON dim.discrepancy_note_id = $1
      WHERE ale.audit_table = 'item_data'
        AND ale.entity_id = dim.item_data_id
        AND ale.reason_for_change ILIKE '%query%correction%'
    `;

    const combinedSql = `
      (${queryAuditSql})
      UNION ALL
      (${dataCorrectionAuditSql})
      ORDER BY audit_date DESC
    `;

    const result = await pool.query(combinedSql, [queryId]);

    // Org-scoping: verify caller can see this query's audit trail
    if (callerUserId && result.rows.length > 0) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        return result.rows.filter((r: any) => orgUserIds.includes(r.user_id));
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get query audit trail error', { error: error.message });
    throw error;
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
    throw error;
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
    throw error;
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
        dn.discrepancy_note_type_id,
        dnt.name as type_name,
        dn.resolution_status_id,
        dnst.name as status_name,
        dn.severity,
        dn.due_date,
        dn.entity_type,
        dn.date_created,
        u1.user_name as created_by,
        u2.user_name as assigned_to,
        dn.assigned_user_id,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count,
        didm.column_name as field_name,
        i.name as item_name,
        i.item_id as item_id,
        i.description as item_description
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      LEFT JOIN dn_event_crf_map decm ON dn.discrepancy_note_id = decm.discrepancy_note_id
      LEFT JOIN dn_item_data_map didm ON dn.discrepancy_note_id = didm.discrepancy_note_id
      LEFT JOIN item_data id2 ON didm.item_data_id = id2.item_data_id
      LEFT JOIN item i ON id2.item_id = i.item_id
      WHERE dn.parent_dn_id IS NULL
        AND (decm.event_crf_id = $1 OR id2.event_crf_id = $1)${orgFilter}
      ORDER BY dn.date_created DESC
    `;

    const result = await pool.query(query, params);

    // Post-process: resolve fieldName from extended_properties if column_name is missing
    for (const row of result.rows) {
      if (!row.field_name && row.item_description) {
        try {
          if (row.item_description.includes('---EXTENDED_PROPS---')) {
            const json = row.item_description.split('---EXTENDED_PROPS---')[1]?.trim();
            if (json) {
              const ext = JSON.parse(json);
              if (ext.fieldName) row.field_name = ext.fieldName;
            }
          }
        } catch { /* ignore parse errors */ }
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get form queries error', { error: error.message });
    throw error;
  }
};

/**
 * Reassign query to another user
 */
export const reassignQuery = async (
  queryId: number,
  assignedUserId: number,
  userId: number
): Promise<{ success: true; message: string }> => {
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
      throw new NotFoundError('Query not found');
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
    await client.query('ROLLBACK').catch((rbErr: any) =>
      logger.warn('ROLLBACK failed in reassignQuery', { rbErr: rbErr.message })
    );
    logger.error('Reassign query error', { error: error.message });
    throw error;
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
    throw error;
  }
};

/**
 * Get query thread (conversation history)
 */
export const getQueryThread = async (queryId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query thread', { queryId, callerUserId });

  try {
    // The thread uses a recursive CTE to walk parent → children.
    // We must exclude "routing copies" — child notes created automatically
    // in createQuery() for additional assignees. They share the root query's
    // description and are created within ~1 second of the root, so we filter
    // them by checking: (level > 0) AND description == root.description AND
    // created within 10 seconds of root. Real responses always differ in text.
    //
    // We also carry root_description and root_created through the CTE so the
    // final SELECT can apply that filter cleanly.
    // Build the conversation thread with routing-copy exclusion.
    // Routing copies are child notes auto-created in createQuery() for additional
    // assignees — they have the SAME description as the root and are created within
    // ~1 second.  We wrap the CTE in a subquery so the outer WHERE can safely
    // reference the computed columns without alias-resolution issues.
    const query = `
      SELECT
        t.discrepancy_note_id,
        t.parent_dn_id,
        t.description,
        t.detailed_notes,
        t.date_created,
        t.resolution_status_id,
        t.owner_id,
        t.created_by,
        t.user_full_name,
        t.thread_level
      FROM (
        WITH RECURSIVE query_thread AS (
          -- Root query (thread_level = 0)
          SELECT
            dn.discrepancy_note_id,
            dn.parent_dn_id,
            dn.description,
            dn.detailed_notes,
            dn.date_created,
            dn.resolution_status_id,
            dn.owner_id,
            u.user_name AS created_by,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.user_name) AS user_full_name,
            0 AS thread_level,
            dn.description AS root_description,
            dn.date_created AS root_created
          FROM discrepancy_note dn
          LEFT JOIN user_account u ON dn.owner_id = u.user_id
          WHERE dn.discrepancy_note_id = $1

          UNION ALL

          -- Responses and nested responses
          SELECT
            dn.discrepancy_note_id,
            dn.parent_dn_id,
            dn.description,
            dn.detailed_notes,
            dn.date_created,
            dn.resolution_status_id,
            dn.owner_id,
            u.user_name AS created_by,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.user_name) AS user_full_name,
            qt.thread_level + 1,
            qt.root_description,
            qt.root_created
          FROM discrepancy_note dn
          INNER JOIN query_thread qt ON dn.parent_dn_id = qt.discrepancy_note_id
          LEFT JOIN user_account u ON dn.owner_id = u.user_id
        )
        SELECT * FROM query_thread
      ) t
      WHERE
        t.thread_level = 0                                              -- always include root
        OR t.description != t.root_description                         -- real response: different text
        OR t.date_created > t.root_created + INTERVAL '30 seconds'    -- or created much later (human-typed)
      ORDER BY t.date_created ASC, t.thread_level ASC
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
    
    // Org-scoping: only return queries owned by users in the caller's org
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

/**
 * Get queries for a specific field (item_data)
 * 
 * This retrieves queries linked to a specific data point via dn_item_data_map.
 * Used for displaying field-level query indicators in the UI.
 */
export const getFieldQueries = async (itemDataId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting field queries', { itemDataId, callerUserId });

  try {
    const params: any[] = [itemDataId];
    let orgFilter = '';

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
        dim.column_name,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
      WHERE dim.item_data_id = $1
        AND dn.parent_dn_id IS NULL${orgFilter}
      ORDER BY dn.date_created DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    logger.error('Get field queries error', { error: error.message });
    throw error;
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
    // Find item_data_id matching by item.name, oc_oid, OR technical fieldName
    // from extended props. The frontend may send any of these identifiers.
    const itemDataQuery = `
      SELECT id.item_data_id
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
        AND (
          LOWER(i.name) = LOWER($2) 
          OR LOWER(i.oc_oid) = LOWER($2)
          OR i.item_id::text = $2
          OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2)
        )
      LIMIT 1
    `;

    let itemDataResult = await pool.query(itemDataQuery, [eventCrfId, fieldName]);
    
    // Fallback: check extended_props for technical fieldName
    if (itemDataResult.rows.length === 0) {
      const extPropsQuery = `
        SELECT id.item_data_id
        FROM item_data id
        INNER JOIN item i ON id.item_id = i.item_id
        WHERE id.event_crf_id = $1 AND id.deleted = false
          AND i.description LIKE '%---EXTENDED_PROPS---%'
          AND LOWER(i.description) LIKE LOWER($2)
      `;
      itemDataResult = await pool.query(extPropsQuery, [eventCrfId, `%"fieldName":"${fieldName}"%`]);
    }
    
    if (itemDataResult.rows.length === 0) {
      return [];
    }

    const itemDataId = itemDataResult.rows[0].item_data_id;
    return await getFieldQueries(itemDataId, callerUserId);
  } catch (error: any) {
    logger.error('Get queries by field error', { error: error.message });
    throw error;
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
        i.item_id,
        i.name as field_name,
        i.description,
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
      GROUP BY i.item_id, i.name, i.description
    `;

    const result = await pool.query(query, params);
    
    // Return counts keyed by EVERY possible identifier so the frontend
    // can match regardless of whether it uses fieldName, item.name, or itemId.
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      const count = parseInt(row.query_count);
      // Key by display name (item.name)
      counts[row.field_name] = count;
      // Key by itemId for reliable programmatic matching
      counts[`item_${row.item_id}`] = count;
      // Key by technical fieldName from extended props (what the frontend form controls use)
      try {
        if (row.description?.includes('---EXTENDED_PROPS---')) {
          const json = row.description.split('---EXTENDED_PROPS---')[1]?.trim();
          if (json) {
            const ext = JSON.parse(json);
            if (ext.fieldName) counts[ext.fieldName] = count;
          }
        }
      } catch { /* ignore parse errors */ }
    }
    
    return counts;
  } catch (error: any) {
    logger.error('Get form field query counts error', { error: error.message });
    return {};
  }
};

// ═══════════════════════════════════════════════════════════════════
// RESOLUTION APPROVAL WORKFLOW
// ═══════════════════════════════════════════════════════════════════

/**
 * Accept a proposed resolution.
 *
 * Intended for: Monitor, CRO, PI, or admin reviewing a "Resolution Proposed" query.
 * - Adds an acceptance note to the thread
 * - Sets status to 4 (Closed)
 * - Notifies the proposer and all parties
 *
 * Requires query to be in status 3 (Resolution Proposed).
 */
export const acceptResolution = async (
  queryId: number,
  userId: number,
  data: { reason?: string; meaning?: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Accepting proposed resolution', { queryId, userId });

  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query('BEGIN');
    txStarted = true;

    const qResult = await client.query(
      `SELECT resolution_status_id, description, study_id, owner_id, assigned_user_id
       FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );
    if (qResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }
    const q = qResult.rows[0];
    if (q.resolution_status_id !== 3) {
      await client.query('ROLLBACK');
      throw new ConflictError('Query is not in "Resolution Proposed" status. Only proposed resolutions can be accepted.');
    }

    const reason = (data.reason || 'Resolution accepted').trim();
    const meaning = data.meaning || 'I have reviewed the proposed resolution and confirm it is acceptable';

    // Add acceptance note to thread
    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 4, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[ACCEPTED] ${reason}`, meaning, userId]);

    // Close the parent query
    await client.query(
      `UPDATE discrepancy_note SET resolution_status_id = 4 WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    // Audit log
    const userResult = await client.query(
      `SELECT first_name, last_name, user_name FROM user_account WHERE user_id = $1`, [userId]
    );
    const userName = userResult.rows[0]
      ? `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`.trim()
      : 'Unknown';

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Resolution Accepted',
        'Status: Resolution Proposed', $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%complete%' LIMIT 1)
      )
    `, [userId, queryId, `Status: Closed (Accepted by ${userName})`, reason]);

    await client.query('COMMIT');

    // Notify proposer and owner
    try {
      const toNotify = [...new Set([q.owner_id, q.assigned_user_id].filter(Boolean))];
      for (const uid of toNotify) {
        if (uid !== userId) {
          await notificationService.notifyQueryClosed(uid, q.description, queryId, userName, q.study_id);
        }
      }
    } catch { /* non-blocking */ }

    return { success: true, message: 'Resolution accepted — query closed' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in acceptResolution', { rbErr: rbErr.message })
      );
    }
    logger.error('Accept resolution error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reject a proposed resolution.
 *
 * Intended for: Monitor, CRO, PI, or admin reviewing a "Resolution Proposed" query.
 * - Adds a rejection note to the thread
 * - Sets status back to 1 (New) so the assignee must re-investigate
 * - Notifies the proposer with the rejection reason
 *
 * Requires query to be in status 3 (Resolution Proposed).
 */
export const rejectResolution = async (
  queryId: number,
  userId: number,
  data: { reason: string }
): Promise<{ success: true; message: string }> => {
  logger.info('Rejecting proposed resolution', { queryId, userId });

  if (!data.reason?.trim()) {
    throw new BadRequestError('A reason is required when rejecting a resolution');
  }

  const client = await pool.connect();
  let txStarted = false;
  try {
    await client.query('BEGIN');
    txStarted = true;

    const qResult = await client.query(
      `SELECT resolution_status_id, description, study_id, owner_id, assigned_user_id
       FROM discrepancy_note WHERE discrepancy_note_id = $1`,
      [queryId]
    );
    if (qResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Query not found');
    }
    const q = qResult.rows[0];
    if (q.resolution_status_id !== 3) {
      await client.query('ROLLBACK');
      throw new ConflictError('Query is not in "Resolution Proposed" status. Only proposed resolutions can be rejected.');
    }

    const reason = data.reason.trim();

    // Add rejection note to thread
    await client.query(`
      INSERT INTO discrepancy_note (
        parent_dn_id, description, detailed_notes,
        discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, date_created
      )
      SELECT $1, $2, $3, 3, 1, study_id, entity_type, $4, NOW()
      FROM discrepancy_note WHERE discrepancy_note_id = $1
    `, [queryId, `[REJECTED] ${reason}`, 'Resolution rejected — please re-investigate', userId]);

    // Set status back to New (1)
    await client.query(
      `UPDATE discrepancy_note SET resolution_status_id = 1 WHERE discrepancy_note_id = $1`,
      [queryId]
    );

    // Audit log
    const userResult = await client.query(
      `SELECT first_name, last_name, user_name FROM user_account WHERE user_id = $1`, [userId]
    );
    const userName = userResult.rows[0]
      ? `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`.trim()
      : 'Unknown';

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Resolution Rejected',
        'Status: Resolution Proposed', $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1)
      )
    `, [userId, queryId, `Status: New (Rejected by ${userName})`, reason]);

    await client.query('COMMIT');

    // Notify the person who proposed the resolution (owner and/or assigned user)
    try {
      const toNotify = [...new Set([q.owner_id, q.assigned_user_id].filter(Boolean))];
      for (const uid of toNotify) {
        if (uid !== userId) {
          await notificationService.notifyResolutionRejected(uid, q.description, queryId, userName, reason, q.study_id);
        }
      }
    } catch { /* non-blocking */ }

    return { success: true, message: 'Resolution rejected — query returned to New status for re-investigation' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in rejectResolution', { rbErr: rbErr.message })
      );
    }
    logger.error('Reject resolution error', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// QUERY REOPEN
// ═══════════════════════════════════════════════════════════════════

/**
 * Reopen a closed query.  Sets status back to New (1) and logs an audit event.
 */
export const reopenQuery = async (
  queryId: number,
  userId: number,
  reason: string
): Promise<{ success: true; message: string }> => {
  logger.info('Reopening query', { queryId, userId, reason });

  const result = await pool.query(
    `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
    [queryId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Query not found');
  }
  const currentStatusId = result.rows[0].resolution_status_id;
  if (currentStatusId !== 4 && currentStatusId !== 5) {
    throw new ConflictError(
      'Only closed or not-applicable queries can be reopened. Current status is not eligible for reopen.'
    );
  }

  return updateQueryStatus(queryId, 1, userId, { reason: reason || 'Query reopened' });
};

// ═══════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Bulk update status for multiple queries.
 * Each query is updated independently so a single failure doesn't block the rest.
 * All failures are collected and reported in the return value.
 */
export const bulkUpdateStatus = async (
  queryIds: number[],
  statusId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; updated: number; failed: number; errors: string[] }> => {
  logger.info('Bulk updating query statuses', { count: queryIds.length, statusId, userId });
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await updateQueryStatus(qid, statusId, userId, { reason });
      updated++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, updated, failed, errors };
};

/**
 * Bulk close queries with a shared reason.
 * Each query is closed independently so a single failure doesn't block the rest.
 */
export const bulkCloseQueries = async (
  queryIds: number[],
  userId: number,
  reason: string
): Promise<{ success: boolean; closed: number; failed: number; errors: string[] }> => {
  if (!reason || reason.trim().length === 0) {
    return { success: false, closed: 0, failed: queryIds.length, errors: ['Reason is required to bulk close queries'] };
  }
  logger.info('Bulk closing queries', { count: queryIds.length, userId });
  let closed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await updateQueryStatus(qid, 4, userId, { reason, signature: false });
      closed++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, closed, failed, errors };
};

/**
 * Bulk reassign queries to a new user.
 * Each query is reassigned independently so a single failure doesn't block the rest.
 */
export const bulkReassignQueries = async (
  queryIds: number[],
  newAssignedUserId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; reassigned: number; failed: number; errors: string[] }> => {
  logger.info('Bulk reassigning queries', { count: queryIds.length, newAssignedUserId, userId });
  let reassigned = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const qid of queryIds) {
    try {
      await reassignQuery(qid, newAssignedUserId, userId);
      reassigned++;
    } catch (e: any) {
      failed++;
      errors.push(`Query ${qid}: ${e.message}`);
    }
  }

  return { success: failed === 0, reassigned, failed, errors };
};

export default {
  getQueries,
  getQueryById,
  createQuery,
  addQueryResponse,
  updateQueryStatus,
  closeQueryWithSignature,
  closeQueryWithSignatureVerified,
  acceptResolution,
  rejectResolution,
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
  getMyAssignedQueries,
  reopenQuery,
  bulkUpdateStatus,
  bulkCloseQueries,
  bulkReassignQueries
};
