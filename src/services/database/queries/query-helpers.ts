/**
 * Query Helpers — shared utilities, interfaces, and internal helpers
 * used by the other query modules.
 */

import { pool } from '../../../config/database';
import { logger } from '../../../config/logger';
import { getOrgMemberUserIds as getOrgMemberUserIdsShared } from '../../../utils/org.util';
import { buildFieldTypeInfo, serializeCorrectionForStorage, resolveCellTypeInfo } from '../../../utils/query-correction.helper';
import { parseExtendedProps } from '../../../utils/extended-props';

// ─── Interfaces ──────────────────────────────────────────────────

export interface QueryRow {
  discrepancyNoteId: number;
  description: string;
  detailedNotes?: string;
  entityType: string;
  resolutionStatusId: number;
  discrepancyNoteTypeId: number;
  ownerId: number;
  assignedUserId?: number;
  parentDnId?: number;
  studyId: number;
  dateCreated: string;
  severity?: string;
  dueDate?: string;
  generationType?: string;
  typeName?: string;
  statusName?: string;
  ownerName?: string;
  assignedUserName?: string;
  subjectLabel?: string;
  formName?: string;
  eventName?: string;
  fieldName?: string;
  fieldValue?: string;
  childCount?: number;
}

export interface QueryThreadEntry {
  discrepancyNoteId: number;
  description: string;
  detailedNotes?: string;
  resolutionStatusId: number;
  statusName?: string;
  ownerId: number;
  ownerName?: string;
  dateCreated: string;
  isParent: boolean;
}

// ─── Shared helpers ──────────────────────────────────────────────

/**
 * Recalculate and update the denormalized query counts on patient_event_form
 * for a given event_crf_id. Call this inside the same transaction as any
 * query mutation (create, status change, close, reopen) to keep the counts
 * consistent without extra round-trips.
 *
 * Resolves notes linked via dn_item_data_map (field-level) and
 * dn_event_crf_map (form-level), counting only root notes (parent_dn_id IS NULL).
 */
export const updateFormQueryCounts = async (client: any, eventCrfId: number | null | undefined): Promise<void> => {
  if (!eventCrfId) return;
  try {
    await client.query(`
      UPDATE patient_event_form pef
      SET
        open_query_count   = COALESCE(sub.open_count, 0),
        overdue_query_count = COALESCE(sub.overdue_count, 0),
        closed_query_count = COALESCE(sub.closed_count, 0)
      FROM (
        SELECT
          COUNT(*) FILTER (WHERE resolution_status_id NOT IN (4, 5))::int AS open_count,
          COUNT(*) FILTER (WHERE resolution_status_id NOT IN (4, 5)
                           AND due_date IS NOT NULL AND due_date < NOW())::int AS overdue_count,
          COUNT(*) FILTER (WHERE resolution_status_id IN (4, 5))::int AS closed_count
        FROM (
          SELECT DISTINCT dn.discrepancy_note_id, dn.resolution_status_id, dn.due_date
          FROM discrepancy_note dn
          INNER JOIN dn_item_data_map didm ON dn.discrepancy_note_id = didm.discrepancy_note_id
          INNER JOIN item_data id ON didm.item_data_id = id.item_data_id
          WHERE id.event_crf_id = $1 AND dn.parent_dn_id IS NULL
          UNION
          SELECT DISTINCT dn.discrepancy_note_id, dn.resolution_status_id, dn.due_date
          FROM discrepancy_note dn
          INNER JOIN dn_event_crf_map decm ON dn.discrepancy_note_id = decm.discrepancy_note_id
          WHERE decm.event_crf_id = $1 AND dn.parent_dn_id IS NULL
        ) all_notes
      ) sub
      WHERE pef.event_crf_id = $1
    `, [eventCrfId]);
  } catch (e: any) {
    logger.warn('updateFormQueryCounts failed (non-blocking)', { eventCrfId, error: e.message });
  }
};

/**
 * Resolve the event_crf_id(s) linked to a discrepancy_note.
 * Checks both dn_item_data_map and dn_event_crf_map paths.
 */
export const resolveEventCrfIdsForQuery = async (client: any, queryId: number): Promise<number[]> => {
  const result = await client.query(`
    SELECT DISTINCT ec_id FROM (
      SELECT id.event_crf_id AS ec_id
      FROM dn_item_data_map didm
      INNER JOIN item_data id ON didm.item_data_id = id.item_data_id
      WHERE didm.discrepancy_note_id = $1
      UNION
      SELECT decm.event_crf_id AS ec_id
      FROM dn_event_crf_map decm
      WHERE decm.discrepancy_note_id = $1
    ) t WHERE ec_id IS NOT NULL
  `, [queryId]);
  return result.rows.map((r: any) => r.ecId);
};

/**
 * Helper: get org member user IDs for the caller.
 * Returns [callerUserId] if the caller has no org membership (only see own data).
 */
export const getOrgMemberUserIds = async (callerUserId: number): Promise<number[] | null> => {
  return getOrgMemberUserIdsShared(pool, callerUserId);
};

/**
 * Get all users who have participated in a query thread.
 * Includes: owner, current assignee, and anyone who added a child response.
 * Used to notify all stakeholders when a query is responded to or closed.
 */
export const getQueryParticipants = async (queryId: number): Promise<number[]> => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT u_id FROM (
        SELECT owner_id AS u_id FROM discrepancy_note WHERE discrepancy_note_id = $1
        UNION
        SELECT assigned_user_id AS u_id FROM discrepancy_note WHERE discrepancy_note_id = $1
        UNION
        SELECT owner_id AS u_id FROM discrepancy_note WHERE parent_dn_id = $1
        UNION
        SELECT assigned_user_id AS u_id FROM discrepancy_note WHERE parent_dn_id = $1
      ) sub WHERE u_id IS NOT NULL
    `, [queryId]);
    return result.rows.map((r: any) => r.uId);
  } catch (error: any) {
    logger.warn('Failed to get query participants', { error: error.message, queryId });
    return [];
  }
};

/**
 * Apply a data correction to the linked item_data row and sync to patient_event_form.
 * Shared by both:
 *   - addQueryResponse (immediate path when caller closes directly)
 *   - acceptResolution (deferred path when Monitor/DM/Admin approves)
 *
 * Returns true if the correction was applied, false otherwise.
 */
export const applyCorrectionToItemData = async (
  client: any,
  queryId: number,
  linkedRow: any,
  correctedValue: any,
  correctionReason: string,
  userId: number
): Promise<boolean> => {
  const { itemDataId, oldValue, eventCrfId, fieldName,
          itemDescription, itemDataTypeId,
          optionsText, optionsValues, responseTypeName,
          columnName, cellTarget } = linkedRow;

  const ext = parseExtendedProps(itemDescription);
  const technicalFieldName: string | null = ext.fieldName || null;

  const fieldInfo = buildFieldTypeInfo(
    itemDescription, itemDataTypeId, responseTypeName, optionsText, optionsValues
  );

  const isCellCorrection = cellTarget != null
    || (columnName && typeof columnName === 'string'
        && (columnName.includes('[') || columnName.split('.').length === 3)
        && columnName !== 'value');

  let lockNote = '';
  if (eventCrfId) {
    const lockCheck = await client.query(
      `SELECT status_id, COALESCE(frozen, false) AS frozen FROM event_crf WHERE event_crf_id = $1`,
      [eventCrfId]
    );
    if (lockCheck.rows.length > 0) {
      const isLocked = lockCheck.rows[0].statusId === 6;
      const isFrozen = lockCheck.rows[0].frozen;
      if (isLocked) {
        lockNote = ' [LOCKED RECORD — query correction override]';
        logger.warn('Applying correction to LOCKED record via query resolution', {
          queryId, eventCrfId, userId
        });
      } else if (isFrozen) {
        lockNote = ' [FROZEN RECORD — query correction override]';
        logger.warn('Applying correction to FROZEN record via query resolution', {
          queryId, eventCrfId, userId
        });
      }
    }
  }

  const auditNewValue = typeof correctedValue === 'object'
    ? JSON.stringify(correctedValue) : String(correctedValue);
  const fullReason = correctionReason + lockNote;

  if (isCellCorrection) {
    // ── CELL-LEVEL CORRECTION ─────────────────────────────────────────
    if (!eventCrfId) {
      logger.warn('Cell correction requested but no event_crf_id available', {
        queryId, isCellCorrection
      });
      return false;
    }

    let tableKey: string | null = null;
    let cellColumnId: string | null = null;
    let rowSegment: string | null = null;
    let isAllRows = false;
    let tableType: 'table' | 'question_table' = 'table';

    if (cellTarget && typeof cellTarget === 'object') {
      tableKey = cellTarget.tableFieldPath || null;
      cellColumnId = cellTarget.columnId || null;
      tableType = cellTarget.tableType || 'table';
      isAllRows = !!cellTarget.allRows;
      if (tableType === 'table') {
        rowSegment = cellTarget.rowIndex != null ? String(cellTarget.rowIndex) : null;
      } else {
        rowSegment = cellTarget.rowId || null;
      }
    } else {
      const cellPath = columnName;
      const dtMatch = cellPath.match(/^(.+)\[(\d+)\]\.(.+)$/);
      const dtWildcardMatch = !dtMatch ? cellPath.match(/^(.+)\[\*\]\.(.+)$/) : null;
      const qtMatch = !dtMatch && !dtWildcardMatch ? cellPath.match(/^([^.[]+)\.([^.]+)\.([^.]+)$/) : null;

      if (dtWildcardMatch) {
        isAllRows = true;
        tableKey = dtWildcardMatch[1];
        cellColumnId = dtWildcardMatch[2];
      } else if (dtMatch) {
        tableKey = dtMatch[1];
        cellColumnId = dtMatch[3];
        rowSegment = dtMatch[2];
      } else if (qtMatch) {
        tableKey = qtMatch[1];
        cellColumnId = qtMatch[3];
        rowSegment = qtMatch[2];
        tableType = 'question_table';
        isAllRows = qtMatch[2] === '*';
      }
    }

    if (isAllRows) {
      logger.error('Cannot apply cell correction to wildcard (all-rows) target — correction requires a specific row', {
        queryId, cellTarget, columnName
      });
      return false;
    }

    if (!tableKey || !cellColumnId || !rowSegment) {
      logger.warn('Cell target could not be resolved for correction', {
        queryId, cellTarget, columnName
      });
      return false;
    }

    let pathArray = [tableKey, rowSegment, cellColumnId];

    let canonicalCellColumnKey = cellColumnId;
    try {
      const ext = parseExtendedProps(itemDescription);
      const isDataTable = Array.isArray(ext.tableColumns) && ext.tableColumns.length > 0;
      const isQuestionTable = Array.isArray(ext.questionRows) && ext.questionRows.length > 0;
      if (isDataTable) {
        const col = ext.tableColumns.find((c: any) =>
          c && (c.key === cellColumnId || c.id === cellColumnId || c.name === cellColumnId)
        );
        if (col) canonicalCellColumnKey = col.key || col.name || col.id || cellColumnId;
      } else if (isQuestionTable) {
        const ansCols = Array.isArray(ext.answerColumns) ? ext.answerColumns
          : (Array.isArray(ext.questionRows[0]?.answerColumns) ? ext.questionRows[0].answerColumns : []);
        const col = ansCols.find((c: any) =>
          c && (c.id === cellColumnId || c.name === cellColumnId || (c as any).key === cellColumnId)
        );
        if (col) {
          canonicalCellColumnKey = (col as any).key || col.name || col.id || cellColumnId;
        }
      }
    } catch (e: any) {
      logger.warn('Could not resolve canonical column key for correction', {
        columnName, cellTarget, error: e.message
      });
    }
    if (canonicalCellColumnKey !== cellColumnId) {
      logger.info('Translated cell-path column to canonical data key', {
        columnName, original: cellColumnId, canonical: canonicalCellColumnKey
      });
      pathArray = [pathArray[0], pathArray[1], canonicalCellColumnKey];
    }

    const jsonbLiteral = JSON.stringify(correctedValue);

    const itemIdNum: number | undefined =
      (linkedRow.itemId != null && Number.isFinite(Number(linkedRow.itemId)))
        ? Number(linkedRow.itemId) : undefined;
    const candidateKeys: string[] = [];
    const pushUnique = (k: string | null | undefined) => {
      if (k && !candidateKeys.includes(k)) candidateKeys.push(k);
    };
    pushUnique(tableKey);
    if (itemIdNum != null) {
      pushUnique(`${tableKey}_${itemIdNum}`);
      if (technicalFieldName) pushUnique(`${technicalFieldName}_${itemIdNum}`);
      if (fieldName) pushUnique(`${fieldName}_${itemIdNum}`);
    }
    pushUnique(technicalFieldName);
    pushUnique(fieldName);

    let cellUpdated = false;
    let resolvedKey: string | null = null;
    for (const key of candidateKeys) {
      try {
        const adjustedPath = [key, ...pathArray.slice(1)];
        const updateResult = await client.query(`
          UPDATE patient_event_form
          SET form_data = jsonb_set(
                COALESCE(form_data, '{}'::jsonb),
                $1::text[], $2::jsonb, true
              ),
              date_updated = NOW()
          WHERE event_crf_id = $3
            AND form_data ? $4
        `, [adjustedPath, jsonbLiteral, eventCrfId, key]);
        if ((updateResult as any).rowCount > 0) {
          cellUpdated = true;
          resolvedKey = key;
          logger.info('Cell correction applied to form_data', {
            eventCrfId, key, columnName, queryId
          });
          break;
        }
      } catch (e: any) {
        logger.warn('Cell correction attempt failed', {
          error: e.message, eventCrfId, key, columnName
        });
      }
    }

    if (!cellUpdated) {
      logger.error('Cell correction could not be applied — table key not found in form_data', {
        eventCrfId, columnName, candidateKeys, queryId
      });
      return false;
    }

    const tableKeyChanged = resolvedKey && resolvedKey !== tableKey;
    const colKeyChanged = canonicalCellColumnKey !== cellColumnId;
    if (tableKeyChanged || colKeyChanged) {
      try {
        const effectiveTableKey = resolvedKey || tableKey;
        let normalizedPath: string;
        if (tableType === 'table') {
          normalizedPath = `${effectiveTableKey}[${rowSegment}].${canonicalCellColumnKey}`;
        } else {
          normalizedPath = `${effectiveTableKey}.${rowSegment}.${canonicalCellColumnKey}`;
        }
        await client.query(`
          UPDATE dn_item_data_map
             SET column_name = $1,
                 cell_target = COALESCE(cell_target, '{}'::jsonb)
                    || jsonb_build_object('tableFieldPath', $4, 'columnId', $5)
           WHERE discrepancy_note_id = $2
             AND item_data_id = $3
        `, [normalizedPath, queryId, itemDataId, effectiveTableKey, canonicalCellColumnKey]);
      } catch (e: any) {
        logger.warn('Could not normalize dn_item_data_map column_name', { error: e.message });
      }
    }

    const cellDisplayPath = tableType === 'table'
      ? `${tableKey}[${rowSegment}].${canonicalCellColumnKey}`
      : `${tableKey}.${rowSegment}.${canonicalCellColumnKey}`;

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id,
        old_value, new_value, audit_log_event_type_id,
        event_crf_id, reason_for_change
      ) VALUES (NOW(), 'item_data', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type
         WHERE name ILIKE '%updated%' LIMIT 1),
        $5, $6)
    `, [userId, itemDataId, `[cell ${cellDisplayPath}]`, `[cell ${cellDisplayPath}] = ${auditNewValue}`, eventCrfId, fullReason]);

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'discrepancy_note', $1, $2, 'Query Data Correction (Cell)',
        $3, $4, $5,
        COALESCE(
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
          1
        )
      )
    `, [
      userId, queryId,
      `Cell: ${cellDisplayPath}, Old: [in form_data]`,
      `Cell: ${cellDisplayPath}, Corrected: ${auditNewValue}`,
      fullReason
    ]);

    return true;
  }

  // ── REGULAR FIELD CORRECTION ────────────────────────────────────────
  const serialized = serializeCorrectionForStorage(fieldInfo.canonicalType, correctedValue);

  await client.query(`
    UPDATE item_data SET value = $1, date_updated = NOW(), update_id = $2
    WHERE item_data_id = $3
  `, [serialized.itemDataValue, userId, itemDataId]);

  await client.query(`
    INSERT INTO audit_log_event (
      audit_date, audit_table, user_id, entity_id,
      old_value, new_value, audit_log_event_type_id,
      event_crf_id, reason_for_change
    ) VALUES (NOW(), 'item_data', $1, $2, $3, $4,
      (SELECT audit_log_event_type_id FROM audit_log_event_type
       WHERE name ILIKE '%updated%' LIMIT 1),
      $5, $6)
  `, [userId, itemDataId, oldValue, auditNewValue, eventCrfId, fullReason]);

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
    userId, queryId,
    `Field: ${fieldName}, Value: ${oldValue}`,
    `Field: ${fieldName}, Corrected Value: ${auditNewValue}`,
    fullReason
  ]);

  if (eventCrfId) {
    const jsonbLiteral = JSON.stringify(serialized.jsonbValue);
    const keysToTry = [technicalFieldName, fieldName].filter(Boolean) as string[];
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
        `, [[key], jsonbLiteral, eventCrfId, key]);
        if ((updateResult as any).rowCount > 0) {
          logger.info('Synced correction to patient_event_form', { eventCrfId, key, queryId });
          break;
        }
      } catch (snapErr: any) {
        logger.warn('Failed to sync correction to patient_event_form', {
          error: snapErr.message, eventCrfId, key
        });
      }
    }
  }

  logger.info('Data correction applied via query resolution', {
    queryId, itemDataId, fieldName,
    technicalFieldName, canonicalType: fieldInfo.canonicalType,
    oldValue: oldValue, newValue: auditNewValue
  });

  return true;
};
