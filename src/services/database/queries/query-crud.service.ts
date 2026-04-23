/**
 * Query CRUD — core read/write operations, thread, form/field queries
 */

import { pool } from '../../../config/database';
import { logger } from '../../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../../types';
import * as notificationService from '../notification.service';
import * as emailTriggers from '../../email/notification-triggers';
import { resolveAllQueryAssignees } from '../workflow-config.provider';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from '../../../middleware/errorHandler.middleware';
import { buildFieldTypeInfo, parseResponseSetOptions, resolveCellTypeInfo } from '../../../utils/query-correction.helper';
import { parseExtendedProps } from '../../../utils/extended-props';
import { resolveFieldType, isStructuredDataType } from '../../../utils/field-type.utils';
import {
  updateFormQueryCounts,
  resolveEventCrfIdsForQuery,
  getOrgMemberUserIds,
} from './query-helpers';

/**
 * Check if a caller can edit (respond to, close, update status) a query.
 */
export const canEditQuery = async (
  queryId: number,
  callerUserId: number,
  callerRole?: string
): Promise<{ allowed: boolean; message?: string }> => {
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
    const { ownerId, assignedUserId } = result.rows[0];

    if (callerUserId === ownerId || callerUserId === assignedUserId) {
      return { allowed: true };
    }

    const additionalCheck = await pool.query(
      `SELECT 1 FROM discrepancy_note
       WHERE parent_dn_id = $1 AND assigned_user_id = $2
       LIMIT 1`,
      [queryId, callerUserId]
    );
    if (additionalCheck.rows.length > 0) {
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

    const conditions: string[] = ['dn.parent_dn_id IS NULL'];
    const params: any[] = [];
    let paramIndex = 1;

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        conditions.push(`(dn.owner_id = ANY($${paramIndex}::int[]) OR dn.assigned_user_id = $${paramIndex + 1})`);
        params.push(orgUserIds, callerUserId);
        paramIndex += 2;
      }
    }
    
    if (studyId) {
      conditions.push(`dn.study_id = $${paramIndex++}`);
      params.push(studyId);
    }

    if (subjectId) {
      conditions.push(`ss.study_subject_id = $${paramIndex++}`);
      params.push(subjectId);
    }

    if (status) {
      conditions.push(`dnst.name ILIKE $${paramIndex++}`);
      params.push(`%${status}%`);
    }

    const whereClause = conditions.join(' AND ');

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
        dn.due_date,
        dn.generation_type
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
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
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

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds && !orgUserIds.includes(parent.ownerId) && parent.assignedUserId !== callerUserId) {
        return null;
      }
    }

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
          i.description AS item_description,
          i.item_data_type_id,
          dim.column_name,
          dim.cell_target,
          c.crf_id,
          c.name AS form_name,
          cv.crf_version_id,
          cv.name AS form_version,
          rs.options_text,
          rs.options_values,
          rt.name AS response_type_name
        FROM dn_item_data_map dim
        INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
        INNER JOIN item i ON id.item_id = i.item_id
        LEFT JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
        LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        LEFT JOIN crf c ON cv.crf_id = c.crf_id
        LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = ec.crf_version_id
        LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
        LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
        WHERE dim.discrepancy_note_id = $1
        LIMIT 1
      `;
      const linkedResult = await pool.query(linkedDataQuery, [queryId]);

      if (linkedResult.rows.length > 0) {
        const r = linkedResult.rows[0];

        const fieldTypeInfo = buildFieldTypeInfo(
          r.itemDescription, r.itemDataTypeId, r.responseTypeName, r.optionsText, r.optionsValues
        );

        let resolvedCurrentValue: any = r.currentValue;
        if (fieldTypeInfo.isStructured && r.eventCrfId) {
          const ext = parseExtendedProps(r.itemDescription);
          const fieldKey = ext.fieldName || r.fieldName;
          try {
            const jsonbResult = await pool.query(
              `SELECT form_data->$1 AS val FROM patient_event_form WHERE event_crf_id = $2 LIMIT 1`,
              [fieldKey, r.eventCrfId]
            );
            if (jsonbResult.rows.length > 0 && jsonbResult.rows[0].val != null) {
              resolvedCurrentValue = jsonbResult.rows[0].val;
            }
          } catch { /* fall back to item_data.value */ }
        }

        linkedItemData = {
          itemDataId: r.itemDataId, itemId: r.itemId, eventCrfId: r.eventCrfId,
          crfId: r.crfId, crfVersionId: r.crfVersionId,
          fieldName: r.fieldName, fieldOid: r.fieldOid,
          columnName: r.columnName, cellTarget: r.cellTarget || null,
          currentValue: resolvedCurrentValue,
          formName: r.formName, formVersion: r.formVersion, fieldTypeInfo
        };

        const cellTypeInfo = resolveCellTypeInfo(r.cellTarget || r.columnName, fieldTypeInfo);
        if (cellTypeInfo) {
          linkedItemData.cellTypeInfo = cellTypeInfo;
        }
        linkedEventCrf = {
          eventCrfId: r.eventCrfId, crfId: r.crfId, crfVersionId: r.crfVersionId,
          formName: r.formName, formVersion: r.formVersion
        };
        canCorrectValue = true;
      } else {
        const ecrfLink = await pool.query(
          `SELECT decm.event_crf_id, decm.column_name,
                  c.crf_id, cv.crf_version_id,
                  c.name AS form_name, cv.name AS form_version
           FROM dn_event_crf_map decm
           LEFT JOIN event_crf ec ON decm.event_crf_id = ec.event_crf_id
           LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
           LEFT JOIN crf c ON cv.crf_id = c.crf_id
           WHERE decm.discrepancy_note_id = $1 LIMIT 1`,
          [queryId]
        );
        if (ecrfLink.rows.length > 0) {
          const eRow = ecrfLink.rows[0];
          linkedEventCrf = {
            eventCrfId: eRow.eventCrfId, crfId: eRow.crfId, crfVersionId: eRow.crfVersionId,
            columnName: eRow.columnName, formName: eRow.formName, formVersion: eRow.formVersion
          };

          const cellPathStr = eRow.columnName;
          if (cellPathStr && (cellPathStr.includes('[') || (cellPathStr.split('.').length === 3))) {
            try {
              const dtMatch = cellPathStr.match(/^(.+)\[\d+\]\.(.+)$/);
              const qtMatch = cellPathStr.match(/^([^.[]+)\.[^.]+\.([^.]+)$/);
              const fieldKey = dtMatch ? dtMatch[1] : (qtMatch ? qtMatch[1] : null);
              const colKey = dtMatch ? dtMatch[2] : (qtMatch ? qtMatch[2] : null);

              if (fieldKey && colKey) {
                const itemLookup = await pool.query(
                  `SELECT i.description FROM item i
                   INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
                   WHERE ifm.crf_version_id = $1
                     AND i.description LIKE $2`,
                  [eRow.crfVersionId, `%"fieldName":"${fieldKey}"%`]
                );

                if (itemLookup.rows.length > 0 && itemLookup.rows[0].description) {
                  const parentTypeInfo = buildFieldTypeInfo(itemLookup.rows[0].description, null, null, null, null);
                  const cellInfo = resolveCellTypeInfo(cellPathStr, parentTypeInfo);
                  if (cellInfo) {
                    (linkedEventCrf as any).cellTypeInfo = cellInfo;
                    canCorrectValue = true;
                  }
                }
              }
            } catch { /* ignore template lookup errors */ }
          }
        }
      }
    } catch (linkedErr: any) {
      logger.warn('Failed to fetch linked item data for query', { queryId, error: linkedErr.message });
    }

    const hasPendingCorrection = !!parent.pendingCorrectionValue;
    let pendingCorrectionValue: any = undefined;
    let pendingCorrectionReason: string | undefined;
    if (hasPendingCorrection) {
      try { pendingCorrectionValue = JSON.parse(parent.pendingCorrectionValue); }
      catch { pendingCorrectionValue = parent.pendingCorrectionValue; }
      pendingCorrectionReason = parent.pendingCorrectionReason || undefined;
    }

    return {
      ...parent,
      responses: responsesResult.rows,
      linkedItemData, linkedEventCrf, canCorrectValue, hasPendingCorrection,
      pendingCorrectionValue: hasPendingCorrection ? pendingCorrectionValue : undefined,
      pendingCorrectionReason
    };
  } catch (error: any) {
    logger.error('Get query by ID error', { error: error.message });
    throw error;
  }
};

/**
 * Create query
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

    const queryTypeMap: Record<string, number> = {
      'Failed Validation Check': 1, 'Annotation': 2, 'Query': 3, 'Reason for Change': 4
    };
    
    const typeId = data.typeId || (data.queryType ? queryTypeMap[data.queryType] : 3) || 3;
    const studySubjectId = data.studySubjectId || data.subjectId;

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

    let resolvedAssignedUserId: number | null = null;
    let workflowAdditionalIds: number[] = [];

    if (data.entityType === 'eventCrf' || data.entityType === 'itemData') {
      try {
        let eventCrfIdForLookup: number | undefined;
        if (data.entityType === 'eventCrf') {
          eventCrfIdForLookup = data.entityId;
        } else if (data.entityType === 'itemData') {
          const ecId = (data as any).eventCrfId;
          if (ecId) {
            eventCrfIdForLookup = ecId;
          } else {
            const idResult = await client.query(
              `SELECT event_crf_id FROM item_data WHERE item_data_id = $1`, [data.entityId]
            );
            if (idResult.rows.length > 0) eventCrfIdForLookup = idResult.rows[0].eventCrfId;
          }
        }
        const assignees = await resolveAllQueryAssignees(undefined, data.studyId, eventCrfIdForLookup);
        if (assignees.primaryUserId) {
          resolvedAssignedUserId = assignees.primaryUserId;
          workflowAdditionalIds = assignees.additionalUserIds;
        }
      } catch (e: any) {
        logger.warn('Could not resolve workflow assignee for query:', e.message);
      }
    }

    if (data.assignedUserId) {
      if (!resolvedAssignedUserId) {
        resolvedAssignedUserId = data.assignedUserId;
      } else if (resolvedAssignedUserId !== data.assignedUserId) {
        if (!workflowAdditionalIds.includes(data.assignedUserId)) {
          workflowAdditionalIds = [...workflowAdditionalIds, data.assignedUserId];
        }
      }
    } else if (!resolvedAssignedUserId) {
      // leave unassigned
    }

    if (!resolvedAssignedUserId && data.assignedUserId === undefined) {
      resolvedAssignedUserId = userId;
      logger.info('No workflow or manual assignee resolved — defaulting to query creator', {
        userId, studyId: data.studyId
      });
    }

    const uniqueAdditionalIds = [...new Set(workflowAdditionalIds)].filter(
      id => id !== resolvedAssignedUserId
    );
    (data as any)._additionalAssigneeIds = uniqueAdditionalIds;

    const generationType = (data as any).generationType || 'manual';

    if (data.dueDate) {
      const parsed = new Date(data.dueDate);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid dueDate format: "${data.dueDate}". Expected ISO date string (YYYY-MM-DD).`);
      }
    }

    const insertNoteQuery = `
      INSERT INTO discrepancy_note (
        description, detailed_notes, discrepancy_note_type_id,
        resolution_status_id, study_id, entity_type,
        owner_id, assigned_user_id, date_created,
        severity, due_date, generation_type
      ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, NOW(), $8, $9, $10)
      RETURNING discrepancy_note_id
    `;

    const noteResult = await client.query(insertNoteQuery, [
      data.description, data.detailedNotes || '', typeId,
      data.studyId, data.entityType, userId, resolvedAssignedUserId,
      data.severity || 'minor', data.dueDate || null, generationType
    ]);

    const queryId = noteResult.rows[0].discrepancyNoteId;

    let resolvedEntityId = data.entityId;

    if (data.entityType === 'eventCrf') {
      if (!resolvedEntityId && (data as any).eventCrfId) {
        resolvedEntityId = (data as any).eventCrfId;
      }
      if (!resolvedEntityId) {
        throw new BadRequestError('Cannot create eventCrf query: entityId or eventCrfId is required. Please save the form before creating a query.');
      }
      const ecCheck = await client.query('SELECT event_crf_id FROM event_crf WHERE event_crf_id = $1', [resolvedEntityId]);
      if (ecCheck.rows.length === 0) {
        throw new BadRequestError(`Cannot create query: event_crf_id ${resolvedEntityId} does not exist. The form may not have been saved yet.`);
      }
    }

    if (data.entityType === 'studySubject' && resolvedEntityId) {
      const ssCheck = await client.query('SELECT study_subject_id FROM study_subject WHERE study_subject_id = $1', [resolvedEntityId]);
      if (ssCheck.rows.length === 0) {
        throw new BadRequestError(`Cannot create query: study_subject_id ${resolvedEntityId} does not exist.`);
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
          throw new BadRequestError('Cannot create field-level query: eventCrfId is required to resolve the data row. Please save the form before creating a query on this field.');
        }

        if (!itemId && fieldName) {
          const normalizedName = fieldName.toLowerCase();
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
            itemId = itemLookup.rows[0].itemId;
            logger.info('Resolved itemId from fieldName', { fieldName, itemId, eventCrfId });
          }
        }

        if (!itemId) {
          throw new BadRequestError('Cannot create field-level query: itemId or fieldName is required to identify the field.');
        }

        const itemDataLookup = await client.query(`
          SELECT item_data_id FROM item_data
          WHERE event_crf_id = $1 AND item_id = $2 AND deleted = false
          ORDER BY item_data_id DESC LIMIT 1
        `, [eventCrfId, itemId]);

        if (itemDataLookup.rows.length === 0) {
          throw new BadRequestError(
            `Cannot create field-level query: no item_data row found for item_id=${itemId} on event_crf_id=${eventCrfId}. The form must be saved before creating a query. If the form was saved, this field may not have been included in the save payload.`
          );
        }

        resolvedEntityId = itemDataLookup.rows[0].itemDataId;
        logger.info('Resolved item_data_id from eventCrfId + itemId', {
          eventCrfId, itemId, resolvedItemDataId: resolvedEntityId
        });
      }
    }

    const cellTarget = (data as any).cellTarget || null;
    const cellPath = (data as any).cellPath;
    const fieldPath = cellPath || (data as any).fieldName || (data as any).fieldPath || (data as any).columnName;

    if (fieldPath && (mapping.table === 'dn_event_crf_map' || mapping.table === 'dn_item_data_map')) {
      await client.query(`
        INSERT INTO ${mapping.table} (discrepancy_note_id, ${mapping.idColumn}, column_name, cell_target)
        VALUES ($1, $2, $3, $4)
      `, [queryId, resolvedEntityId, fieldPath, cellTarget ? JSON.stringify(cellTarget) : null]);
    } else {
      await client.query(`
        INSERT INTO ${mapping.table} (discrepancy_note_id, ${mapping.idColumn})
        VALUES ($1, $2)
      `, [queryId, resolvedEntityId]);
    }

    if (studySubjectId && mapping.table !== 'dn_study_subject_map') {
      try {
        await client.query(`
          INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)
          VALUES ($1, $2, 'value')
        `, [queryId, studySubjectId]);
      } catch (e: any) {
        logger.warn('Could not link query to study subject', { queryId, studySubjectId, error: e.message });
      }
    }

    const additionalAssigneeIds: number[] = uniqueAdditionalIds;
    for (const additionalUserId of additionalAssigneeIds) {
      try {
        await client.query(`
          INSERT INTO discrepancy_note (
            description, detailed_notes, discrepancy_note_type_id,
            resolution_status_id, study_id, entity_type,
            owner_id, assigned_user_id, parent_dn_id, date_created
          ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, NOW())
          RETURNING discrepancy_note_id
        `, [
          data.description, data.detailedNotes || '', typeId,
          data.studyId, data.entityType, userId, additionalUserId, queryId
        ]);
        logger.info('Created child query for additional assignee', { parentQueryId: queryId, additionalUserId });
      } catch (childError: any) {
        logger.warn('Failed to create child query for additional assignee', { 
          parentQueryId: queryId, additionalUserId, error: childError.message 
        });
      }
    }

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Query Created' LIMIT 1)
      )
    `, [userId, queryId, data.description]);

    if (resolvedAssignedUserId) {
      try {
        const taskTableCheck = await client.query(`
          SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists
        `);
        if (taskTableCheck.rows[0].exists) {
          const allQueryAssigneeIds = [resolvedAssignedUserId, ...uniqueAdditionalIds];
          await client.query(`
            INSERT INTO acc_workflow_tasks (
              task_type, title, description, status, priority,
              entity_type, entity_id, event_crf_id, study_id,
              assigned_to_user_ids, created_by, metadata
            ) VALUES ('query', $1, $2, 'pending', $3, 'discrepancy_note', $4, $5, $6, $7, $8, $9)
          `, [
            `Query: ${data.description.substring(0, 100)}`, data.description,
            data.severity === 'critical' ? 'high' : data.severity === 'major' ? 'medium' : 'low',
            queryId, (data as any).eventCrfId || null, data.studyId,
            allQueryAssigneeIds, userId,
            JSON.stringify({
              generationType, queryType: data.queryType || 'Query',
              severity: data.severity || 'minor', entityType: data.entityType
            })
          ]);
          logger.info('Created workflow task for query', { queryId, assignees: allQueryAssigneeIds });
        }
      } catch (taskError: any) {
        logger.warn('Workflow task creation for query failed (non-blocking)', { queryId, error: taskError.message });
      }
    }

    const eventCrfIdForCounts = (data.entityType === 'eventCrf')
      ? resolvedEntityId
      : (data as any).eventCrfId || null;
    if (eventCrfIdForCounts) {
      await updateFormQueryCounts(client, eventCrfIdForCounts);
    } else if (data.entityType === 'itemData' && resolvedEntityId) {
      const ecLookup = await client.query(
        'SELECT event_crf_id FROM item_data WHERE item_data_id = $1', [resolvedEntityId]
      );
      if (ecLookup.rows.length > 0) {
        await updateFormQueryCounts(client, ecLookup.rows[0].eventCrfId);
      }
    }

    await client.query('COMMIT');
    logger.info('Query created successfully', { queryId });

    try {
      if (resolvedAssignedUserId) {
        await notificationService.notifyQueryAssigned(
          resolvedAssignedUserId, data.description || 'New query', queryId, data.studyId
        );
      }
      for (const addlId of additionalAssigneeIds) {
        await notificationService.notifyQueryAssigned(addlId, data.description || 'New query', queryId, data.studyId);
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send query assignment notifications', { error: notifErr.message });
    }

    try {
      const allAssigned = [
        ...(resolvedAssignedUserId ? [resolvedAssignedUserId] : []),
        ...additionalAssigneeIds
      ];
      for (const assigneeId of allAssigned) {
        emailTriggers.triggerQueryOpened(
          queryId, data.studyId, data.eventCrfId || null, studySubjectId || null,
          userId, assigneeId, data.description || 'New query'
        ).catch(e => logger.warn('Email trigger failed for query opened', { error: e.message }));
      }
    } catch (emailErr: any) {
      logger.warn('Failed to queue query email notifications', { error: emailErr.message });
    }

    return { success: true, queryId, message: 'Query created successfully' };
  } catch (error: any) {
    if (txStarted) {
      await client.query('ROLLBACK').catch((rbErr: any) =>
        logger.warn('ROLLBACK failed in createQuery', { rbErr: rbErr.message })
      );
    }
    logger.error('Create query error', { error: error.message, data });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get query audit trail
 */
export const getQueryAuditTrail = async (queryId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query audit trail', { queryId, callerUserId });

  try {
    const queryAuditSql = `
      SELECT 
        ale.audit_id, ale.audit_date, ale.entity_name as action,
        ale.old_value, ale.new_value, ale.reason_for_change,
        ale.user_id, u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type, ale.audit_table
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      WHERE ale.audit_table = 'discrepancy_note' AND ale.entity_id = $1
    `;

    const dataCorrectionAuditSql = `
      SELECT 
        ale.audit_id, ale.audit_date, 'Data Correction (via Query)' as action,
        ale.old_value, ale.new_value, ale.reason_for_change,
        ale.user_id, u.user_name,
        u.first_name || ' ' || u.last_name as user_full_name,
        alet.name as event_type, ale.audit_table
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      INNER JOIN dn_item_data_map dim ON dim.discrepancy_note_id = $1
      WHERE ale.audit_table = 'item_data'
        AND ale.entity_id = dim.item_data_id
        AND ale.reason_for_change ILIKE '%query%correction%'
    `;

    const combinedSql = `
      (${queryAuditSql}) UNION ALL (${dataCorrectionAuditSql})
      ORDER BY audit_date DESC
    `;

    const result = await pool.query(combinedSql, [queryId]);

    if (callerUserId && result.rows.length > 0) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        return result.rows.filter((r: any) => orgUserIds.includes(r.userId));
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get query audit trail error', { error: error.message });
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
      SELECT discrepancy_note_type_id as id, name, description
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
      SELECT resolution_status_id as id, name
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
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT DISTINCT ON (dn.discrepancy_note_id)
        dn.discrepancy_note_id, dn.description, dn.detailed_notes,
        dn.discrepancy_note_type_id, dnt.name as type_name,
        dn.resolution_status_id, dnst.name as status_name,
        dn.severity, dn.due_date, dn.entity_type, dn.date_created,
        u1.user_name as created_by, u2.user_name as assigned_to,
        dn.assigned_user_id,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count,
        COALESCE(didm.column_name, decm.column_name) as field_name,
        COALESCE(didm.cell_target, decm.cell_target) as cell_target,
        i.name as item_name, i.item_id as item_id,
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
      ORDER BY dn.discrepancy_note_id, dn.date_created DESC
    `;

    const result = await pool.query(query, params);

    const cellPathPattern = /^(.+)\[(\d+|\*)\]\.(.+)$|^([^.[]+)\.([^.]+)\.([^.]+)$/;

    for (const row of result.rows) {
      try {
        const hasCellTarget = row.cellTarget != null;
        const hasCellPath = !hasCellTarget && row.fieldName && cellPathPattern.test(row.fieldName);

        if (hasCellTarget && row.itemDescription) {
          const ext = parseExtendedProps(row.itemDescription);
          if (!row.fieldName && ext.fieldName) row.fieldName = ext.fieldName;
          const parentTypeInfo = buildFieldTypeInfo(row.itemDescription, null, null, null, null);
          const cellInfo = resolveCellTypeInfo(row.cellTarget, parentTypeInfo);
          if (cellInfo) {
            row.cellType = cellInfo.cellType;
            row.cellOptions = cellInfo.cellOptions;
            row.cellMin = cellInfo.cellMin;
            row.cellMax = cellInfo.cellMax;
          }
        } else if (hasCellTarget && !row.itemDescription) {
          const fieldKey = row.cellTarget.tableFieldPath;
          if (fieldKey) {
            const itemLookup = await pool.query(
              `SELECT i.description FROM item i
               INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
               INNER JOIN event_crf ec ON ifm.crf_version_id = ec.crf_version_id
               WHERE ec.event_crf_id = $1 AND i.description LIKE $2 LIMIT 1`,
              [eventCrfId, `%"fieldName":"${fieldKey}"%`]
            );
            if (itemLookup.rows.length > 0 && itemLookup.rows[0].description) {
              const parentTypeInfo = buildFieldTypeInfo(itemLookup.rows[0].description, null, null, null, null);
              const cellInfo = resolveCellTypeInfo(row.cellTarget, parentTypeInfo);
              if (cellInfo) {
                row.cellType = cellInfo.cellType;
                row.cellOptions = cellInfo.cellOptions;
                row.cellMin = cellInfo.cellMin;
                row.cellMax = cellInfo.cellMax;
              }
            }
          }
        } else if (row.itemDescription) {
          const ext = parseExtendedProps(row.itemDescription);
          if (!row.fieldName && ext.fieldName) row.fieldName = ext.fieldName;
          if (row.fieldName && cellPathPattern.test(row.fieldName)) {
            const parentTypeInfo = buildFieldTypeInfo(row.itemDescription, null, null, null, null);
            const cellInfo = resolveCellTypeInfo(row.fieldName, parentTypeInfo);
            if (cellInfo) {
              row.cellType = cellInfo.cellType;
              row.cellOptions = cellInfo.cellOptions;
              row.cellMin = cellInfo.cellMin;
              row.cellMax = cellInfo.cellMax;
            }
          }
        } else if (hasCellPath && !row.cellType) {
          const dtMatch = row.fieldName.match(/^(.+)\[\d+\]\.(.+)$/);
          const qtMatch = row.fieldName.match(/^([^.[]+)\.[^.]+\.([^.]+)$/);
          const fieldKey = dtMatch ? dtMatch[1] : (qtMatch ? qtMatch[1] : null);
          if (fieldKey) {
            const itemLookup = await pool.query(
              `SELECT i.description FROM item i
               INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
               INNER JOIN event_crf ec ON ifm.crf_version_id = ec.crf_version_id
               WHERE ec.event_crf_id = $1 AND i.description LIKE $2 LIMIT 1`,
              [eventCrfId, `%"fieldName":"${fieldKey}"%`]
            );
            if (itemLookup.rows.length > 0 && itemLookup.rows[0].description) {
              const parentTypeInfo = buildFieldTypeInfo(itemLookup.rows[0].description, null, null, null, null);
              const cellInfo = resolveCellTypeInfo(row.fieldName, parentTypeInfo);
              if (cellInfo) {
                row.cellType = cellInfo.cellType;
                row.cellOptions = cellInfo.cellOptions;
                row.cellMin = cellInfo.cellMin;
                row.cellMax = cellInfo.cellMax;
              }
            }
          }
        }
      } catch (rowErr: any) {
        logger.warn('Failed to enrich form query row (non-blocking)', {
          discrepancyNoteId: row.discrepancyNoteId, fieldName: row.fieldName, error: rowErr.message
        });
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get form queries error', { error: error.message });
    throw error;
  }
};

/**
 * Get queries for a specific field (item_data)
 */
export const getFieldQueries = async (itemDataId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting field queries', { itemDataId, callerUserId });

  try {
    const params: any[] = [itemDataId];
    let orgFilter = '';

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT 
        dn.discrepancy_note_id, dn.description, dn.detailed_notes,
        dnt.name as type_name, dnst.name as status_name,
        dn.date_created, u1.user_name as created_by, u2.user_name as assigned_to,
        dim.column_name, i.description as item_description,
        (SELECT COUNT(*) FROM discrepancy_note WHERE parent_dn_id = dn.discrepancy_note_id) as response_count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN resolution_status dnst ON dn.resolution_status_id = dnst.resolution_status_id
      LEFT JOIN user_account u1 ON dn.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON dn.assigned_user_id = u2.user_id
      INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
      INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE dim.item_data_id = $1
        AND dn.parent_dn_id IS NULL${orgFilter}
      ORDER BY dn.date_created DESC
    `;

    const result = await pool.query(query, params);

    for (const row of result.rows) {
      const colName = row.columnName;
      if (colName && row.itemDescription && (colName.includes('[') || (colName.split('.').length === 3))) {
        try {
          const parentTypeInfo = buildFieldTypeInfo(row.itemDescription, null, null, null, null);
          const cellInfo = resolveCellTypeInfo(colName, parentTypeInfo);
          if (cellInfo) {
            row.cellType = cellInfo.cellType;
            row.cellOptions = cellInfo.cellOptions;
            row.cellMin = cellInfo.cellMin;
            row.cellMax = cellInfo.cellMax;
          }
        } catch { /* ignore */ }
      }
    }

    return result.rows;
  } catch (error: any) {
    logger.error('Get field queries error', { error: error.message });
    throw error;
  }
};

/**
 * Get queries for a field by event_crf_id and field name
 */
export const getQueriesByField = async (eventCrfId: number, fieldName: string, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting queries by field', { eventCrfId, fieldName });

  try {
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

    const itemDataId = itemDataResult.rows[0].itemDataId;
    return await getFieldQueries(itemDataId, callerUserId);
  } catch (error: any) {
    logger.error('Get queries by field error', { error: error.message });
    throw error;
  }
};

/**
 * Get open query count for all fields in a form
 */
export const getFormFieldQueryCounts = async (eventCrfId: number, callerUserId?: number): Promise<Record<string, number>> => {
  logger.info('Getting form field query counts', { eventCrfId, callerUserId });

  try {
    let orgFilter = '';
    const params: any[] = [eventCrfId];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgFilter = ` AND (dn.owner_id = ANY($2::int[]) OR dn.assigned_user_id = $3)`;
        params.push(orgUserIds, callerUserId);
      }
    }

    const query = `
      SELECT 
        i.item_id, i.name as field_name, i.description,
        COUNT(dn.discrepancy_note_id) as query_count
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      INNER JOIN dn_item_data_map dim ON id.item_data_id = dim.item_data_id
      INNER JOIN discrepancy_note dn ON dim.discrepancy_note_id = dn.discrepancy_note_id
      INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
        AND dn.parent_dn_id IS NULL
        AND rs.name NOT IN ('Closed', 'Not Applicable')
        AND (
          dim.column_name IS NULL
          OR dim.column_name = 'value'
          OR (POSITION('[' IN dim.column_name) = 0
              AND array_length(string_to_array(dim.column_name, '.'), 1) <> 3)
        )${orgFilter}
      GROUP BY i.item_id, i.name, i.description
    `;

    const result = await pool.query(query, params);
    
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      const count = parseInt(row.queryCount);
      counts[row.fieldName] = count;
      counts[`item_${row.itemId}`] = count;
      try {
        const ext = parseExtendedProps(row.description);
        if (ext.fieldName) counts[ext.fieldName] = count;
      } catch { /* ignore parse errors */ }
    }
    
    return counts;
  } catch (error: any) {
    logger.error('Get form field query counts error', { error: error.message });
    return {};
  }
};

/**
 * Get query thread (conversation history)
 */
export const getQueryThread = async (queryId: number, callerUserId?: number): Promise<any[]> => {
  logger.info('Getting query thread', { queryId, callerUserId });

  try {
    const query = `
      SELECT
        t.discrepancy_note_id, t.parent_dn_id, t.description,
        t.detailed_notes, t.date_created, t.resolution_status_id,
        t.owner_id, t.created_by, t.user_full_name, t.thread_level
      FROM (
        WITH RECURSIVE query_thread AS (
          SELECT
            dn.discrepancy_note_id, dn.parent_dn_id, dn.description,
            dn.detailed_notes, dn.date_created, dn.resolution_status_id,
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

          SELECT
            dn.discrepancy_note_id, dn.parent_dn_id, dn.description,
            dn.detailed_notes, dn.date_created, dn.resolution_status_id,
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
        t.thread_level = 0
        OR t.description != t.root_description
        OR t.date_created > t.root_created + INTERVAL '30 seconds'
        OR t.owner_id != (SELECT owner_id FROM discrepancy_note WHERE discrepancy_note_id = $1)
      ORDER BY t.date_created ASC, t.thread_level ASC
    `;

    const result = await pool.query(query, [queryId]);

    if (callerUserId && result.rows.length > 0) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        const hasAccess = result.rows.some((r: any) => {
          const creatorId = r.ownerId || r.createdById;
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
