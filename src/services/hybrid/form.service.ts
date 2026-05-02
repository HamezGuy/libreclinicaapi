/**
 * Form Service (Hybrid)
 * 
 * Form data management combining SOAP and Database
 * - Use SOAP for saving form data (GxP compliant with validation)
 * - Use Database for reading form data (faster)
 * 
 * 21 CFR Part 11 §11.10(e) - Audit Trail for document actions
 */

import * as crypto from 'crypto';
import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import * as dataSoap from '../soap/dataSoap.service';
import {
  FormDataRequest, ApiResponse,
  FormFieldOption, FieldValidationConstraint, ShowWhenCondition, FormLinkDefinition,
  TableColumnDefinition, TableRowDefinition, TableSettings,
  InlineFieldDefinition, InlineGroupSettings,
  CriteriaItem, CriteriaListSettings,
  QuestionRow, QuestionTableSettings
} from '../../types';
import { trackUserAction, trackDocumentAccess } from '../database/audit.service';
import * as validationRulesService from '../database/validation-rules.service';
import { encryptField, decryptField, isEncrypted } from '../../utils/encryption.util';
import * as workflowService from '../database/workflow.service';
import { stripExtendedProps, parseExtendedProps } from '../../utils/extended-props';
import { resolveFieldType, isStructuredDataType, isTableType } from '../../utils/field-type.utils';

/** Attempt to parse a JSON string; return fallback on failure. */
function tryParseJson(str: string, fallback: any): any {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Normalize a showWhen/hideWhen/requiredWhen value to always be an array.
 * Extended props may store a single condition object; the frontend expects arrays.
 * Filters out malformed conditions (missing fieldId or operator) so the frontend
 * skip-logic evaluator never encounters empty operators.
 *
 * An explicit empty array [] means "conditions were intentionally cleared" and
 * must NOT fall back to SCD — it returns [] directly.
 */
function normalizeToArray(value: any, fallback: any[] = []): any[] {
  if (value === null || value === undefined) return fallback;

  let arr: any[];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    arr = value;
  } else if (typeof value === 'object' && value.fieldId) {
    arr = [value];
  } else {
    console.warn('[normalizeToArray] Unrecognized condition format — returning fallback:', value);
    return fallback;
  }

  return arr.filter((c: any) => c && c.fieldId && c.operator);
}

/** Remove keys whose value is undefined so they don't overwrite existing data during merge. */
function stripUndefined(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Strip Angular deduplication suffixes from a field name to get the canonical name.
 * The frontend appends _<itemId>, _<fieldId>, or _dup<N> to resolve name collisions.
 * Only strip when the base name actually matches an item in the map.
 */
function stripDedupSuffix(fieldName: string, itemMap: Map<string, number>): string {
  const patterns = [/_dup\d+$/, /_\d+$/, /_[a-z0-9]{6,9}$/];
  for (const pat of patterns) {
    const stripped = fieldName.replace(pat, '');
    if (stripped !== fieldName) {
      // Only accept the stripped name if:
      // 1. The stripped name exists in itemMap (it's a real item name)
      // 2. The original unstripped name does NOT exist (confirming it was a dedup suffix)
      const strippedExists = itemMap.has(stripped.toLowerCase()) || itemMap.has(stripped);
      const originalExists = itemMap.has(fieldName.toLowerCase()) || itemMap.has(fieldName);
      if (strippedExists && !originalExists) {
        return stripped;
      }
    }
  }
  return fieldName;
}

/**
 * Ensure every option in a field's options array has a unique stored value.
 * If duplicates are found, reassign the conflicting values to the next
 * available integer so radio/select/checkbox bindings never collide.
 */
function deduplicateOptionValues(options: FormFieldOption[]): FormFieldOption[] {
  if (!options || options.length === 0) return options;
  const seen = new Set<string>();
  let maxNumeric = 0;
  for (const opt of options) {
    const n = parseInt(opt.value, 10);
    if (!isNaN(n) && n > maxNumeric) maxNumeric = n;
  }
  return options.map(opt => {
    if (!seen.has(opt.value)) {
      seen.add(opt.value);
      return opt;
    }
    maxNumeric++;
    const newVal = String(maxNumeric);
    seen.add(newVal);
    logger.warn('Deduplicated option value collision', { label: opt.label, oldValue: opt.value, newValue: newVal });
    return { ...opt, value: newVal };
  });
}

/**
 * Ensure a PostgreSQL auto-increment sequence is at least as high as the current max ID.
 * Prevents "duplicate key violates unique constraint" when the sequence drifts behind
 * the actual data (e.g. after seed scripts insert explicit IDs).
 */
async function repairSequence(
  client: any,
  sequenceName: string,
  tableName: string,
  pkColumn: string
): Promise<void> {
  try {
    await client.query(`
      SELECT setval($1::regclass,
        GREATEST(
          (SELECT COALESCE(MAX(${pkColumn}), 0) FROM ${tableName}),
          (SELECT last_value FROM ${sequenceName})
        )
      )
    `, [sequenceName]);
  } catch (err: any) {
    logger.warn(`Failed to repair sequence ${sequenceName}`, { error: err.message });
  }
}

/**
 * Save form data via SOAP (GxP compliant)
 * 
 * This function now applies validation rules before saving:
 * - Hard edits (severity: 'error') will BLOCK the save
 * - Soft edits (severity: 'warning') will be returned but allow save
 * 
 * Supports both frontend and backend naming conventions:
 * - Frontend: studyId, subjectId, eventId, formId, data
 * - Backend: studyId, subjectId, studyEventDefinitionId, crfId, formData
 * 
 * 21 CFR Part 11 §11.10(h) - Device checks to determine validity
 */
export const saveFormData = async (
  request: FormDataRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data', { 
    studyId: request.studyId,
    subjectId: request.subjectId,
    studyEventDefinitionId: request.studyEventDefinitionId,
    crfId: request.crfId,
    userId 
  });

  // Validate required fields — studyEventDefinitionId is not needed when
  // the visit can be resolved from studyEventId or eventCrfId.
  if (!request.studyId || !request.subjectId || !request.crfId) {
    logger.warn('Missing required fields for form save', {
      studyId: request.studyId,
      subjectId: request.subjectId,
      crfId: request.crfId
    });
    return {
      success: false,
      message: 'Missing required fields: studyId, subjectId, crfId'
    };
  }
  if (!request.studyEventDefinitionId && !(request as any).studyEventId && !(request as any).eventCrfId) {
    logger.warn('No visit context for form save — need studyEventDefinitionId, studyEventId, or eventCrfId');
    return {
      success: false,
      message: 'Missing visit context: provide studyEventDefinitionId, studyEventId, or eventCrfId'
    };
  }

  // ===== PRE-SAVE VALIDATION (dry run first, then query creation) =====
  // Pass hiddenFieldIds so validation skips fields hidden by branching —
  // hidden fields carry empty values for data clearing but must never
  // trigger validation errors that would block the save.
  const reqHiddenFieldIds: number[] = (request as any).hiddenFieldIds || [];
  let validationWarnings: any[] = [];
  if (request.crfId && request.formData) {
    try {
      const validationResult = await validationRulesService.validateFormData(
        request.crfId,
        request.formData,
        {
          createQueries: false,
          studyId: request.studyId,
          subjectId: request.subjectId,
          userId: userId,
          eventCrfId: (request as any).eventCrfId || undefined,
          hiddenFieldIds: reqHiddenFieldIds.length > 0 ? reqHiddenFieldIds : undefined,
          hiddenFieldNames: (request as any).hiddenFields || undefined
        }
      );

      if (!validationResult.valid && validationResult.errors.length > 0) {
        // Create queries for error-severity rule failures even though the
        // save is blocked. In EDC systems, hard-edit check failures must
        // still generate discrepancy notes so they appear in the query
        // workflow and are tracked to resolution.
        let errorQueriesCreated = 0;
        if (request.studyId && userId) {
          try {
            const queryResult = await validationRulesService.validateFormData(
              request.crfId,
              request.formData,
              {
                createQueries: true,
                severityFilter: 'error',
                studyId: request.studyId,
                subjectId: request.subjectId,
                userId: userId,
                eventCrfId: (request as any).eventCrfId || undefined,
                hiddenFieldIds: reqHiddenFieldIds.length > 0 ? reqHiddenFieldIds : undefined,
                hiddenFieldNames: (request as any).hiddenFields || undefined
              }
            );
            errorQueriesCreated = queryResult.queriesCreated || 0;
            if (errorQueriesCreated > 0) {
              logger.info('Created queries for hard-edit failures', {
                crfId: request.crfId, errorQueriesCreated
              });
            }
          } catch (queryErr: any) {
            logger.warn('Failed to create error queries (non-blocking)', { error: queryErr.message });
          }
        }

        logger.warn('Form data validation failed - save blocked', { 
          crfId: request.crfId, 
          errorCount: validationResult.errors.length,
          errorQueriesCreated
        });
        return {
          success: false,
          message: 'Validation failed',
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          queriesCreated: errorQueriesCreated
        } as any;
      }

      validationWarnings = validationResult.warnings || [];
      if (validationWarnings.length > 0) {
        logger.info('Validation warnings — queries will be created after save', { 
          crfId: request.crfId, 
          warningCount: validationWarnings.length 
        });
      }
    } catch (validationError: any) {
      const failSafe = process.env.VALIDATION_FAIL_SAFE === 'true';
      if (failSafe) {
        logger.error('Pre-save validation crashed — blocking save (VALIDATION_FAIL_SAFE=true)', {
          error: validationError.message
        });
        return {
          success: false,
          message: 'Validation service is temporarily unavailable. Please try again shortly.'
        };
      }
      logger.warn('Pre-save validation failed, proceeding with save', { error: validationError.message });
    }
  }

  // Build the full request for saveFormDataDirect, including optional precision IDs
  const fullRequest: FormDataRequest & {
    studyEventId?: number;
    eventCrfId?: number;
    reasonForChange?: string;
    interviewerName?: string;
    interviewDate?: string;
  } = {
    studyId: request.studyId,
    subjectId: request.subjectId,
    studyEventDefinitionId: request.studyEventDefinitionId,
    crfId: request.crfId,
    formData: request.formData || {},
    studyEventId: (request as any).studyEventId || undefined,
    eventCrfId: (request as any).eventCrfId || undefined,
    reasonForChange: (request as any).reasonForChange || undefined,
    interviewerName: (request as any).interviewerName || undefined,
    interviewDate: (request as any).interviewDate || undefined
  };

  // Try SOAP service first for GxP-compliant data entry
  let saveResult: ApiResponse<any> | null = null;

  try {
    const soapResult = await dataSoap.importData(fullRequest, userId, username);
    if (soapResult.success) {
      saveResult = soapResult;
    } else {
      logger.warn('SOAP import failed, falling back to database', { error: soapResult.message });
    }
  } catch (soapError: any) {
    logger.warn('SOAP service unavailable, falling back to database', { error: (soapError as Error).message });
  }

  // Fallback: Direct database insert for data entry
  if (!saveResult) {
    saveResult = await saveFormDataDirect(fullRequest, userId, username);
  }

  // Post-save validation: create queries for ALL rule violations.
  // Runs after BOTH SOAP and direct-DB paths. The direct-DB path handles its
  // own post-save internally, but the SOAP path previously skipped it entirely.
  // Only run for SOAP-path results to avoid duplicate queries from the direct path.
  if (saveResult?.success && saveResult !== null) {
    const eventCrfId = (saveResult as any).eventCrfId || (saveResult as any).data?.eventCrfId;
    if (eventCrfId && !((saveResult as any)._postSaveValidationRan)) {
      try {
        const postSaveResult = await validationRulesService.validateFormData(
          fullRequest.crfId,
          fullRequest.formData,
          {
            createQueries: true,
            studyId: fullRequest.studyId,
            subjectId: fullRequest.subjectId,
            userId,
            eventCrfId,
            hiddenFieldIds: reqHiddenFieldIds.length > 0 ? reqHiddenFieldIds : undefined
          }
        );
        const allPostSaveIssues = [
          ...(postSaveResult.warnings || []),
          ...(postSaveResult.errors || []).map((e: { fieldPath: string; message: string; queryId?: number }) => ({
            fieldPath: e.fieldPath, message: e.message, queryId: e.queryId
          }))
        ];
        if (allPostSaveIssues.length > 0 || (postSaveResult as any).queriesCreated) {
          (saveResult as any).validationWarnings = allPostSaveIssues;
          (saveResult as any).queriesCreated = (postSaveResult as any).queriesCreated || 0;
        }
      } catch (postErr: any) {
        logger.warn('Post-save validation failed (non-blocking)', { error: postErr.message });
      }
    }
  }

  return saveResult;
};

/**
 * Direct database save fallback for form data
 * Uses LibreClinica's existing tables: event_crf, item_data
 * 21 CFR Part 11 compliant with proper audit logging
 *
 * Resolution strategy for finding the correct records:
 *   1. eventCrfId  — if the frontend already knows the event_crf record, use it directly
 *   2. studyEventId — if the frontend knows the patient's visit instance, use it
 *   3. studyEventDefinitionId + subjectId — fallback: look up the visit by definition
 */
const saveFormDataDirect = async (
  request: FormDataRequest & {
    studyEventId?: number;
    eventCrfId?: number;
    reasonForChange?: string;
    interviewerName?: string;
    interviewDate?: string;
  },
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data directly to database', {
    studyId: request.studyId,
    subjectId: request.subjectId,
    crfId: request.crfId,
    studyEventId: request.studyEventId,
    eventCrfId: request.eventCrfId
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Resolve the study_event for this subject
    // Priority: use provided studyEventId (instance) > look up by definition ID > create new
    let studyEventId: number | null = null;

    // Strategy A: Use the provided studyEventId directly (most reliable — already resolved by frontend)
    if (request.studyEventId) {
      // Verify the event belongs to this subject
      const verifyResult = await client.query(`
        SELECT se.study_event_id
        FROM study_event se
        WHERE se.study_event_id = $1 AND se.study_subject_id = $2
        LIMIT 1
      `, [request.studyEventId, request.subjectId]);
      if (verifyResult.rows.length > 0) {
        studyEventId = verifyResult.rows[0].studyEventId;
        logger.debug('Using provided studyEventId', { studyEventId });
      } else {
        logger.warn('Provided studyEventId does not belong to subject, falling back', {
          studyEventId: request.studyEventId,
          subjectId: request.subjectId
        });
      }
    }

    // Strategy A2: Resolve from eventCrfId (if we know the existing form, we can get the event)
    if (!studyEventId && request.eventCrfId) {
      const ecResult = await client.query(`
        SELECT ec.study_event_id FROM event_crf ec
        WHERE ec.event_crf_id = $1 AND ec.study_subject_id = $2
        LIMIT 1
      `, [request.eventCrfId, request.subjectId]);
      if (ecResult.rows.length > 0) {
        studyEventId = ecResult.rows[0].studyEventId;
        logger.debug('Resolved studyEventId from eventCrfId', { studyEventId, eventCrfId: request.eventCrfId });
      } else {
        logger.warn('eventCrfId does not belong to this subject — ignoring for safety', {
          eventCrfId: request.eventCrfId, subjectId: request.subjectId
        });
      }
    }

    // Strategy B: Look up by event definition ID
    if (!studyEventId && request.studyEventDefinitionId) {
      const studyEventResult = await client.query(`
        SELECT se.study_event_id 
        FROM study_event se
        WHERE se.study_subject_id = $1 
          AND se.study_event_definition_id = $2
        ORDER BY se.sample_ordinal DESC
        LIMIT 1
      `, [request.subjectId, request.studyEventDefinitionId]);

      if (studyEventResult.rows.length > 0) {
        studyEventId = studyEventResult.rows[0].studyEventId;
      }
    }

    // Strategy C: Create a new study_event (last resort)
    if (!studyEventId) {
      if (!request.studyEventDefinitionId) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: 'Cannot save: no study event found and no event definition ID to create one. Please schedule a visit first.'
        };
      }
      const createEventResult = await client.query(`
        INSERT INTO study_event (
          study_event_definition_id, study_subject_id, sample_ordinal,
          date_start, owner_id, status_id, subject_event_status_id, date_created
        ) VALUES ($1, $2, 1, CURRENT_DATE, $3, 1, 3, NOW())
        RETURNING study_event_id
      `, [request.studyEventDefinitionId, request.subjectId, userId]);
      studyEventId = createEventResult.rows[0].studyEventId;
      logger.info('Created study event', { studyEventId });
    }

    // 2. Get the CRF version — prefer active (status_id=1), fall back to
    //    the newest available version of any status so draft forms can still be saved.
    const crfVersionResult = await client.query(`
      SELECT crf_version_id FROM crf_version
      WHERE crf_id = $1
      ORDER BY
        CASE WHEN status_id = 1 THEN 0 ELSE 1 END,
        crf_version_id DESC
      LIMIT 1
    `, [request.crfId]);

    if (crfVersionResult.rows.length === 0) {
      throw new Error(`No active version found for CRF ${request.crfId}`);
    }
    const crfVersionId = crfVersionResult.rows[0].crfVersionId;

    // 3. Find or create the event_crf
    // Priority: use provided eventCrfId > look up by study_event + crf_version > look up by study_event + crf_id > create
    let eventCrfId: number | null = null;

    // Strategy A: Use provided eventCrfId directly (editing existing form)
    if (request.eventCrfId) {
      const verifyResult = await client.query(`
        SELECT event_crf_id, status_id, COALESCE(frozen, false) as frozen
        FROM event_crf
        WHERE event_crf_id = $1
        LIMIT 1
      `, [request.eventCrfId]);
      if (verifyResult.rows.length > 0) {
        eventCrfId = verifyResult.rows[0].eventCrfId;
        // Check lock/freeze status
        const ecRow = verifyResult.rows[0];
        if (ecRow.statusId === 6) {
          await client.query('ROLLBACK');
          logger.warn('Attempted to edit locked record', { eventCrfId, userId });
          return {
            success: false,
            message: 'Cannot edit data - this record is locked. Request an unlock through the Data Lock Management system.',
            errors: ['RECORD_LOCKED']
          };
        }
        if (ecRow.frozen) {
          await client.query('ROLLBACK');
          logger.warn('Attempted to edit frozen record', { eventCrfId, userId });
          return {
            success: false,
            message: 'Cannot edit data - this record is frozen. Request an unfreeze from a Data Manager before editing.',
            errors: ['RECORD_FROZEN']
          };
        }
        logger.debug('Using provided eventCrfId', { eventCrfId });
      }
    }

    // Strategy B: Look up by study_event_id + crf_version_id
    if (!eventCrfId) {
      const eventCrfResult = await client.query(`
        SELECT event_crf_id FROM event_crf
        WHERE study_event_id = $1 AND crf_version_id = $2
        LIMIT 1
      `, [studyEventId, crfVersionId]);

      if (eventCrfResult.rows.length > 0) {
        eventCrfId = eventCrfResult.rows[0].eventCrfId;

        // CHECK IF RECORD IS LOCKED OR FROZEN
        const lockCheckResult = await client.query(`
          SELECT status_id, COALESCE(frozen, false) as frozen FROM event_crf WHERE event_crf_id = $1
        `, [eventCrfId]);
        if (lockCheckResult.rows.length > 0) {
          const ecRow = lockCheckResult.rows[0];
          if (ecRow.statusId === 6) {
            await client.query('ROLLBACK');
            logger.warn('Attempted to edit locked record', { eventCrfId, userId });
            return {
              success: false,
              message: 'Cannot edit data - this record is locked. Request an unlock through the Data Lock Management system.',
              errors: ['RECORD_LOCKED']
            };
          }
          if (ecRow.frozen) {
            await client.query('ROLLBACK');
            logger.warn('Attempted to edit frozen record', { eventCrfId, userId });
            return {
              success: false,
              message: 'Cannot edit data - this record is frozen. Request an unfreeze from a Data Manager before editing.',
              errors: ['RECORD_FROZEN']
            };
          }
        }
      }
    }

    // Strategy C: Look up by study_event_id + any version of this CRF (handles version mismatch)
    if (!eventCrfId) {
      const eventCrfByAnyVersion = await client.query(`
        SELECT ec.event_crf_id, ec.status_id
        FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.study_event_id = $1 AND cv.crf_id = $2 AND ec.study_subject_id = $3
        LIMIT 1
      `, [studyEventId, request.crfId, request.subjectId]);
      if (eventCrfByAnyVersion.rows.length > 0) {
        const row = eventCrfByAnyVersion.rows[0];
        eventCrfId = row.eventCrfId;
        logger.info('Found event_crf with different version (using existing)', { eventCrfId });

        if (row.statusId === 6) {
          await client.query('ROLLBACK');
          return {
            success: false,
            message: 'Cannot edit data - this form is locked.',
            errors: ['RECORD_LOCKED']
          };
        }

        // Check frozen status (table may not exist in all deployments)
        try {
          const frozenCheck = await client.query(
            `SELECT 1 FROM acc_frozen_event_crfs WHERE event_crf_id = $1 LIMIT 1`,
            [eventCrfId]
          );
          if (frozenCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return {
              success: false,
              message: 'Cannot edit data - this record is frozen. Request an unfreeze from a Data Manager before editing.',
              errors: ['RECORD_FROZEN']
            };
          }
        } catch {
          // Table doesn't exist yet — skip frozen check
        }
      }
    }

    // Strategy D: Create new event_crf
    if (!eventCrfId) {
      const interviewerName = request.interviewerName || username;
      const createEventCrfResult = await client.query(`
        INSERT INTO event_crf (
          study_event_id, crf_version_id, study_subject_id,
          date_interviewed, interviewer_name,
          completion_status_id, status_id, owner_id, date_created
        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 1, 1, $5, NOW())
        RETURNING event_crf_id
      `, [studyEventId, crfVersionId, request.subjectId, interviewerName, userId]);
      eventCrfId = createEventCrfResult.rows[0].eventCrfId;
      logger.info('Created event_crf', { eventCrfId });
    }

    // 4. Resolve the actual crf_version_id to query items against.
    // ALWAYS use the version attached to the resolved event_crf, not the latest active version.
    // An existing event_crf may have been created with an older CRF version; using the wrong
    // version means we query the wrong items and fail to match all field names.
    let resolvedVersionId = crfVersionId; // default: latest active version (used for new event_crfs)
    if (eventCrfId) {
      const ecVersionResult = await client.query(
        `SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1`, [eventCrfId]
      );
      if (ecVersionResult.rows.length > 0 && ecVersionResult.rows[0].crfVersionId) {
        resolvedVersionId = ecVersionResult.rows[0].crfVersionId;
        logger.debug('Resolved crf_version_id from event_crf', { eventCrfId, resolvedVersionId });
      }
    }

    // Get item mappings for the resolved CRF version
    // Include description to extract technical fieldName from extended_properties
    // Include ALL items (even show_item=false) because branching logic can
    // reveal hidden fields at runtime — their data must still be saveable.
    const itemsResult = await client.query(`
      SELECT i.item_id, i.name, i.oc_oid, i.description
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
      WHERE igm.crf_version_id = $1
    `, [resolvedVersionId]);

    const itemMap = new Map<string, number>();
    const itemTypeMap = new Map<number, string>();
    for (const item of itemsResult.rows) {
      // Primary: map by item_id (numeric as string) so frontend can send the id directly
      itemMap.set(String(item.itemId), item.itemId);
      // Map by display label (item.name in DB)
      if (!itemMap.has(item.name.toLowerCase())) {
        itemMap.set(item.name.toLowerCase(), item.itemId);
      }
      // Map by OID
      if (item.ocOid) {
        itemMap.set(item.ocOid.toLowerCase(), item.itemId);
      }
      // Map by technical fieldName from extended_properties
      const extProps = parseExtendedProps(item.description);
      if (extProps.fieldName && !itemMap.has(extProps.fieldName.toLowerCase())) {
        itemMap.set(extProps.fieldName.toLowerCase(), item.itemId);
      }
      // Store the canonical field type so the save loop can distinguish
      // structured types (table, question_table, ...) from scalar types.
      if (extProps.type) {
        itemTypeMap.set(item.itemId, resolveFieldType(extProps.type));
      }
    }

    // Collect structured field data (table, question_table, criteria_list,
    // inline_group) to write into patient_event_form.form_data JSONB.
    // These values are stored as native arrays/objects — never JSON strings.
    const structuredFieldData: Record<string, any> = {};

    // 5. Save each form field value to item_data
    let savedCount = 0;
    let skippedCount = 0;
    const formData = request.formData || {};

    // Repair item_data sequence before inserts to prevent PK collisions
    await repairSequence(client, 'item_data_item_data_id_seq', 'item_data', 'item_data_id');

    // Pre-fetch all existing item_data rows for this event_crf in a single query
    // to avoid one SELECT per field inside the loop (N+1 problem).
    // Include ALL rows (even deleted ones) so the ON CONFLICT upsert can update
    // soft-deleted rows that still hold the unique constraint slot.
    const existingItemDataResult = await client.query(`
      SELECT item_id, item_data_id, value, date_updated, ordinal FROM item_data
      WHERE event_crf_id = $1
    `, [eventCrfId]);
    const existingByItemId = new Map<number, { itemDataId: number; value: string; dateUpdated: string | null }>();
    for (const row of existingItemDataResult.rows) {
      if (row.ordinal === 1 || !existingByItemId.has(row.itemId)) {
        existingByItemId.set(row.itemId, { itemDataId: row.itemDataId, value: row.value, dateUpdated: row.dateUpdated ?? null });
      }
    }

    // Track itemIds already processed in this save loop to prevent duplicate
    // inserts when the frontend sends deduplicated keys (e.g. "question_table"
    // and "question_table_2597") that resolve to the same item_id.
    const processedItemIds = new Set<number>();

    // Optimistic concurrency: track fields that were modified by another user
    const concurrentModifications: { fieldPath: string; message: string }[] = [];
    const fieldTimestamps: Record<string, string> = (request as unknown as Record<string, unknown>).fieldTimestamps as Record<string, string> || {};

    for (const [fieldName, value] of Object.entries(formData)) {
      // Find the item_id for this field - try multiple matching strategies:
      // 1. Exact key as sent by frontend
      // 2. Lowercase variant
      // 3. Strip Angular deduplication suffix (e.g. "pain_level_abc123" → "pain_level")
      let itemId = itemMap.get(fieldName.toLowerCase()) ?? itemMap.get(fieldName);

      if (!itemId) {
        // Strip Angular deduplication suffix. The frontend now uses deterministic
        // suffixes: _<itemId>, _<fieldId>, or _dup<N>.
        // Try multiple stripping patterns in priority order:
        //   1. _dup<digits> suffix (e.g., "pain_level_dup3")
        //   2. _<numeric itemId> suffix (e.g., "pain_level_2142")
        //   3. _<alphanumeric id> suffix only if the base matches an item
        // This is safer than the old approach of blindly stripping any 6-char suffix.
        const patterns = [
          /_dup\d+$/,             // _dup0, _dup1, etc.
          /_\d+$/,                // _2142 (itemId suffix)
          /_[a-z0-9]{6,9}$/,     // legacy random suffix (6-9 chars)
        ];
        for (const pat of patterns) {
          const stripped = fieldName.replace(pat, '');
          if (stripped !== fieldName) {
            const matchedId = itemMap.get(stripped.toLowerCase()) ?? itemMap.get(stripped);
            if (matchedId) {
              itemId = matchedId;
              break;
            }
          }
        }
      }

      if (!itemId) {
        skippedCount++;
        logger.warn('Field not found in CRF item map, skipping', { fieldName });
        continue;
      }

      // Determine if this field is a structured type (table, question_table, etc.)
      // whose data belongs in form_data JSONB, not in item_data.value.
      const fieldType = itemTypeMap.get(itemId) || '';
      let isStructured = isStructuredDataType(fieldType);

      // Fallback: if the type metadata is missing from extended_properties but
      // the value itself is a non-trivial array or object, treat it as structured.
      // This catches cases where the item.description lacks a `type` field but
      // the frontend correctly sent a native array (table) or nested object
      // (question_table, criteria_list, inline_group).
      if (!isStructured && value !== null && typeof value === 'object') {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          isStructured = true;
        } else if (!Array.isArray(value) && Object.keys(value).length > 0) {
          const firstVal = Object.values(value)[0];
          if (firstVal !== null && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
            isStructured = true;
          }
        }
      }

      if (isStructured) {
        // ── STRUCTURED FIELDS: source of truth is form_data JSONB ──
        // Collect the native value (array or object) for the JSONB upsert below.
        // Also store a lightweight marker in item_data so the audit trail and
        // completion checks know this field has data.
        const canonical = stripDedupSuffix(fieldName, itemMap);
        const nativeValue = (typeof value === 'string') ? tryParseJson(value, value) : value;
        structuredFieldData[canonical] = nativeValue;

        // Only insert the item_data marker once per itemId — multiple deduplicated
        // form keys (e.g. "question_table" and "question_table_2597") can resolve
        // to the same itemId when they're different tables with the same base name.
        if (!processedItemIds.has(itemId)) {
          processedItemIds.add(itemId);
          const marker = '__STRUCTURED_DATA__';
          const existingRow = existingByItemId.get(itemId);
          if (existingRow) {
            if (existingRow.value !== marker) {
              await client.query(`
                UPDATE item_data
                SET value = $1, date_updated = NOW(), update_id = $2
                WHERE item_data_id = $3
              `, [marker, userId, existingRow.itemDataId]);
            }
          } else {
            await client.query(`
              INSERT INTO item_data (
                item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal
              ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)
              ON CONFLICT ON CONSTRAINT pk_item_data_new
              DO UPDATE SET value = EXCLUDED.value, date_updated = NOW(), update_id = EXCLUDED.owner_id
            `, [itemId, eventCrfId, marker, userId]);
          }
        }

        savedCount++;
        continue;
      }

      // ── SCALAR FIELDS: item_data.value is the source of truth ──

      // Skip if this itemId was already written to in this save loop
      // (prevents duplicate INSERT when multiple formData keys resolve to the same item_id)
      if (processedItemIds.has(itemId)) {
        savedCount++;
        continue;
      }
      processedItemIds.add(itemId);

      // Use the pre-fetched map instead of a per-field query
      const existingRow = existingByItemId.get(itemId);
      const existingResult = { rows: existingRow ? [existingRow] : [] };

      // Handle field clearing: when value is null/undefined/empty, 
      // clear existing data instead of skipping
      const isEmpty = value === null || value === undefined || value === ''
        || value === '[]' || value === '{}'
        || (Array.isArray(value) && value.length === 0)
        || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
      
      if (isEmpty) {
        // Only need to clear if there's existing data
        if (existingResult.rows.length > 0) {
          const oldValue = existingResult.rows[0].value;
          if (oldValue !== '' && oldValue !== null) {
            // Clear the value (set to empty string, per LibreClinica convention)
            await client.query(`
              UPDATE item_data
              SET value = '', date_updated = NOW(), update_id = $1
              WHERE item_data_id = $2
            `, [userId, existingResult.rows[0].itemDataId]);

            // Log value clearing to audit trail
            await client.query(`
              INSERT INTO audit_log_event (
                audit_date, audit_table, user_id, entity_id,
                old_value, new_value, audit_log_event_type_id,
                event_crf_id, reason_for_change
              ) VALUES (NOW(), 'item_data', $1, $2, $3, '',
                (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
                $4, 'Value cleared')
            `, [userId, existingResult.rows[0].itemDataId, oldValue, eventCrfId]);
            
            savedCount++;
          }
        }
        continue; // Skip to next field
      }

      let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

      // Guard against double-encoded JSON strings for table/complex fields.
      // If the value is a string that looks like a JSON array/object, verify it isn't
      // about to be double-stringified (frontend may send pre-serialized JSON).
      if (typeof value === 'string' && value.length > 1) {
        const trimmed = value.trim();
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
          try {
            JSON.parse(trimmed);
            stringValue = trimmed;
          } catch { /* not valid JSON, keep as-is */ }
        }
      }
      
      // 21 CFR Part 11 §11.10(a) - Encrypt sensitive form data at rest
      // Only encrypt if field-level encryption is enabled
      if (config.encryption?.enableFieldEncryption) {
        stringValue = encryptField(stringValue);
      }

      if (existingResult.rows.length > 0) {
        // Update existing
        const oldValue = existingResult.rows[0].value;
        if (oldValue !== stringValue) {
          // Optimistic concurrency: if the frontend supplied a timestamp for this
          // field, verify it matches the DB date_updated before overwriting.
          const clientTimestamp = fieldTimestamps[fieldName]
            || fieldTimestamps[fieldName.toLowerCase()]
            || null;
          const existing = existingByItemId.get(itemId);

          if (clientTimestamp && existing?.dateUpdated) {
            const updateResult = await client.query(`
              UPDATE item_data
              SET value = $1, date_updated = NOW(), update_id = $2
              WHERE item_data_id = $3 AND (date_updated = $4 OR date_updated IS NULL)
            `, [stringValue, userId, existingResult.rows[0].itemDataId, clientTimestamp]);

            if ((updateResult.rowCount ?? 0) === 0) {
              concurrentModifications.push({
                fieldPath: fieldName,
                message: 'Value was modified by another user since you loaded the form'
              });
              continue;
            }
          } else {
            await client.query(`
              UPDATE item_data
              SET value = $1, date_updated = NOW(), update_id = $2
              WHERE item_data_id = $3
            `, [stringValue, userId, existingResult.rows[0].itemDataId]);
          }

          // Log change to audit trail (21 CFR Part 11 §11.10(e) — include reason_for_change)
          await client.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_id,
              old_value, new_value, audit_log_event_type_id,
              event_crf_id, reason_for_change
            ) VALUES (NOW(), 'item_data', $1, $2, $3, $4,
              (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
              $5, $6)
          `, [userId, existingResult.rows[0].itemDataId, oldValue, stringValue, eventCrfId, request.reasonForChange || 'Reason not given']);
        }
      } else {
        // Insert new (upsert to handle race conditions / double-submits)
        const insertResult = await client.query(`
          INSERT INTO item_data (
            item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal
          ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)
          ON CONFLICT ON CONSTRAINT pk_item_data_new
          DO UPDATE SET value = EXCLUDED.value, date_updated = NOW(), update_id = EXCLUDED.owner_id
          RETURNING item_data_id
        `, [itemId, eventCrfId, stringValue, userId]);

        // Log creation to audit trail
        await client.query(`
          INSERT INTO audit_log_event (
            audit_date, audit_table, user_id, entity_id,
            new_value, audit_log_event_type_id, event_crf_id
          ) VALUES (NOW(), 'item_data', $1, $2, $3,
            (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%creat%' LIMIT 1),
            $4)
        `, [userId, insertResult.rows[0].itemDataId, stringValue, eventCrfId]);
      }

      savedCount++;
    }

    // 6. Update event_crf completion status based on VISIBLE required fields only.
    //    Fields hidden by branching/skip logic are excluded so they don't block completion.
    //    2 = initial_data_entry, 4 = complete

    // ── HIDDEN FIELD RESOLUTION ──
    // Primary: hiddenFieldIds — numeric item.item_id values sent by the
    // frontend. Authoritative, no casing/naming ambiguity. Each number maps
    // directly to item.item_id in the database.
    //
    // Secondary: hiddenFields — string field names for any field that lacks
    // an itemId on the frontend (edge case). Resolved to item IDs via itemMap.
    const hiddenItemIds: Set<number> = new Set();

    if ((request as any).hiddenFieldIds && Array.isArray((request as any).hiddenFieldIds)) {
      for (const id of (request as any).hiddenFieldIds) {
        const parsed = typeof id === 'number' ? id : parseInt(id, 10);
        if (!isNaN(parsed) && parsed > 0) {
          hiddenItemIds.add(parsed);
        }
      }
    }

    // Also resolve any string-based hiddenFields to item IDs
    if (request.hiddenFields && Array.isArray(request.hiddenFields)) {
      for (const hf of request.hiddenFields) {
        if (!hf) continue;
        // Try exact match, then lowercase, then stripped dedup suffix
        const itemId = itemMap.get(hf) || itemMap.get(hf.toLowerCase());
        if (itemId) {
          hiddenItemIds.add(itemId);
        } else {
          const stripped = stripDedupSuffix(hf, itemMap);
          const strippedId = itemMap.get(stripped) || itemMap.get(stripped.toLowerCase());
          if (strippedId) hiddenItemIds.add(strippedId);
        }
      }
    }

    // Clear item_data for fields that are now hidden by branching logic.
    if (hiddenItemIds.size > 0) {
      for (const hiddenId of hiddenItemIds) {
        const existingRow = existingByItemId.get(hiddenId);
        if (existingRow && existingRow.value && existingRow.value !== '' && existingRow.value !== '__STRUCTURED_DATA__') {
          await client.query(`
            UPDATE item_data
            SET value = '', date_updated = NOW(), update_id = $1
            WHERE item_data_id = $2
          `, [userId, existingRow.itemDataId]);
          await client.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_id,
              old_value, new_value, audit_log_event_type_id,
              event_crf_id, reason_for_change
            ) VALUES (NOW(), 'item_data', $1, $2, $3, '',
              (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
              $4, 'Value cleared — field hidden by branching logic')
          `, [userId, existingRow.itemDataId, existingRow.value, eventCrfId]);
        }
      }
    }

    let requiredTotal = 0;
    let requiredFilled = 0;
    let totalFilled = 0;

    if (hiddenItemIds.size > 0) {
      // Branching is active: use item IDs directly in SQL to exclude hidden
      // fields from the required-fields completion check. This is an exact
      // numeric match against item.item_id — no string comparison, no casing.
      const hiddenIdArray = Array.from(hiddenItemIds);

      const allRequiredResult = await client.query(`
        SELECT i.item_id, i.description
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
        WHERE igm.crf_version_id = $1
          AND ifm.required = true
          AND i.item_id != ALL($2::int[])
      `, [resolvedVersionId, hiddenIdArray]);

      for (const row of allRequiredResult.rows) {
        const extProps = parseExtendedProps(row.description);
        const fieldType = extProps.type ? resolveFieldType(extProps.type) : '';
        if (fieldType === 'section_header' || fieldType === 'static_text') {
          continue;
        }
        requiredTotal++;
      }

      // Count filled required fields (excluding hidden ones)
      const filledResult = await client.query(`
        SELECT COUNT(DISTINCT id2.item_id) AS cnt
        FROM item_data id2
        INNER JOIN item i2 ON id2.item_id = i2.item_id
        INNER JOIN item_group_metadata igm2 ON i2.item_id = igm2.item_id AND igm2.crf_version_id = $1
        INNER JOIN item_form_metadata ifm2 ON i2.item_id = ifm2.item_id AND ifm2.crf_version_id = $1
        WHERE id2.event_crf_id = $2
          AND id2.deleted = false AND id2.value IS NOT NULL
          AND id2.value != '' AND id2.value != '[]' AND id2.value != '{}' AND id2.value != '__STRUCTURED_DATA__'
          AND ifm2.required = true
          AND id2.item_id != ALL($3::int[])
      `, [resolvedVersionId, eventCrfId, hiddenIdArray]);
      requiredFilled = parseInt(filledResult.rows[0]?.cnt) || 0;

      const totalFilledResult = await client.query(`
        SELECT COUNT(*) AS cnt FROM item_data
        WHERE event_crf_id = $1 AND deleted = false AND value IS NOT NULL AND value != '' AND value != '[]' AND value != '{}'
      `, [eventCrfId]);
      totalFilled = parseInt(totalFilledResult.rows[0]?.cnt) || 0;
    } else {
      const completionCountResult = await client.query(`
        SELECT
          (SELECT COUNT(DISTINCT i.item_id)
           FROM item i
           INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
           INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
           WHERE igm.crf_version_id = $1
             AND ifm.required = true
             AND i.description NOT LIKE '%"type":"section_header"%'
             AND i.description NOT LIKE '%"type":"static_text"%') AS required_total,
          (SELECT COUNT(DISTINCT id2.item_id)
           FROM item_data id2
           INNER JOIN item i2 ON id2.item_id = i2.item_id
           INNER JOIN item_group_metadata igm2 ON i2.item_id = igm2.item_id AND igm2.crf_version_id = $1
           INNER JOIN item_form_metadata ifm2 ON i2.item_id = ifm2.item_id AND ifm2.crf_version_id = $1
           WHERE id2.event_crf_id = $2
             AND id2.deleted = false AND id2.value IS NOT NULL
             AND id2.value != '' AND id2.value != '[]' AND id2.value != '{}' AND id2.value != '__STRUCTURED_DATA__'
             AND ifm2.required = true
             AND i2.description NOT LIKE '%"type":"section_header"%'
             AND i2.description NOT LIKE '%"type":"static_text"%') AS required_filled,
          (SELECT COUNT(*)
           FROM item_data
           WHERE event_crf_id = $2 AND deleted = false AND value IS NOT NULL AND value != '' AND value != '[]' AND value != '{}') AS total_filled
      `, [resolvedVersionId, eventCrfId]);

      requiredTotal = parseInt(completionCountResult.rows[0]?.requiredTotal) || 0;
      requiredFilled = parseInt(completionCountResult.rows[0]?.requiredFilled) || 0;
      totalFilled = parseInt(completionCountResult.rows[0]?.totalFilled) || 0;
    }

    // Any successful save = form is complete. No partial-save limbo.
    const isComplete = savedCount > 0;
    const completionStatusId = isComplete ? 4 : 2;

    await client.query(`
      UPDATE event_crf
      SET completion_status_id = $1,
          date_updated = NOW(),
          update_id = $2,
          date_completed = CASE WHEN $1 = 4 THEN NOW() ELSE date_completed END
      WHERE event_crf_id = $3
    `, [completionStatusId, userId, eventCrfId]);

    // Advance study_event status based on form completion:
    //   - At minimum, mark as 'data_entry_started' (3) when any form has data
    //   - Auto-advance to 'completed' (4) when ALL active forms are complete
    if (isComplete) {
      await client.query(`
        UPDATE study_event
        SET subject_event_status_id = 4, date_updated = NOW()
        WHERE study_event_id = $1
          AND subject_event_status_id < 4
          AND NOT EXISTS (
            SELECT 1 FROM event_crf ec
            WHERE ec.study_event_id = $1
              AND ec.completion_status_id < 4
              AND ec.status_id NOT IN (5, 7)
          )
      `, [studyEventId]);
    }
    await client.query(`
      UPDATE study_event
      SET subject_event_status_id = GREATEST(subject_event_status_id, 3),
          date_updated = NOW()
      WHERE study_event_id = $1 AND subject_event_status_id < 3
    `, [studyEventId]);

    // 6b. Persist ALL form data to patient_event_form.form_data (JSONB).
    // Moved inside the transaction so structured field data is atomic with
    // scalar item_data writes. Previously used pool.query() outside the txn.

    // Associate orphaned file_uploads with this event_crf_id.
    // Files uploaded before the form's first save have event_crf_id = NULL.
    // Match by file_id values stored in item_data for file/image fields.
    try {
      const fileFieldValues = await pool.query(`
        SELECT id.value FROM item_data id
        INNER JOIN item i ON id.item_id = i.item_id
        WHERE id.event_crf_id = $1 AND id.deleted = false
          AND id.value IS NOT NULL AND id.value != ''
          AND id.value != '__STRUCTURED_DATA__'
          AND i.description LIKE '%"type"%'
          AND (i.description LIKE '%"file"%' OR i.description LIKE '%"image"%')
      `, [eventCrfId]);

      const fileIds: string[] = [];
      for (const row of fileFieldValues.rows) {
        if (typeof row.value === 'string' && row.value.length > 0) {
          for (const id of row.value.split(',')) {
            const trimmed = id.trim();
            if (trimmed) fileIds.push(trimmed);
          }
        }
      }

      if (fileIds.length > 0) {
        await pool.query(`
          UPDATE file_uploads
          SET event_crf_id = $1, study_subject_id = $2
          WHERE file_id = ANY($3::text[])
            AND (event_crf_id IS NULL OR event_crf_id != $1)
        `, [eventCrfId, request.subjectId, fileIds]);
      }
    } catch (fileAssocErr: any) {
      logger.warn('Could not associate file_uploads with event_crf_id', { error: fileAssocErr.message });
    }

    logger.info('Form data saved directly to database', {
      eventCrfId,
      savedCount,
      skippedCount,
      totalFields: Object.keys(formData).length,
      allFieldsMatched: skippedCount === 0
    });

    // 6b. Persist ALL form data to patient_event_form.form_data (JSONB).
    //
    // This is the SOURCE OF TRUTH for structured field types (table,
    // question_table, criteria_list, inline_group).  Scalar fields are
    // also stored here for completeness / fallback.
    //
    // Uses INSERT ... ON CONFLICT so new event_crf rows (Strategy D)
    // also get a patient_event_form row.
    try {
      // Start with the structured field data collected in step 5 —
      // these are already native arrays/objects, never strings.
      const canonicalFormData: Record<string, any> = { ...structuredFieldData };

      // Add scalar fields, de-duplicating the key suffix and parsing
      // any remaining JSON-string edge cases from legacy clients.
      for (const [fieldName, value] of Object.entries(formData)) {
        const canonical = stripDedupSuffix(fieldName, itemMap);
        // Skip if already populated by structuredFieldData
        if (canonical in canonicalFormData) continue;

        if (typeof value === 'string' && value.length > 1) {
          const trimmed = value.trim();
          if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
              (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
              canonicalFormData[canonical] = JSON.parse(trimmed);
              continue;
            } catch { /* not valid JSON, store as string */ }
          }
        }
        canonicalFormData[canonical] = value;
      }

      // Build a form_structure for new rows — fetch full metadata so the
      // patient_event_form snapshot has real field definitions, not an empty shell.
      let formStructureJson = '{"snapshotDate":"' + new Date().toISOString() + '"}';
      const existingSnapshot = await pool.query(
        `SELECT 1 FROM patient_event_form WHERE event_crf_id = $1 LIMIT 1`,
        [eventCrfId]
      );
      if (existingSnapshot.rows.length === 0) {
        try {
          const crfIdForSnapshot = request.crfId;
          if (crfIdForSnapshot) {
            const metadata = await getFormMetadata(crfIdForSnapshot, { includeHidden: true });
            if (metadata?.items?.length) {
              formStructureJson = JSON.stringify({
                crfId: crfIdForSnapshot,
                crfVersionId: resolvedVersionId,
                name: metadata.name || '',
                snapshotDate: new Date().toISOString(),
                fieldCount: metadata.items.length,
                fields: metadata.items
              });
            }
          }
        } catch (metaErr: any) {
          logger.warn('Could not fetch metadata for form_structure on upsert', { error: metaErr.message });
        }
      }

      await client.query(`
        INSERT INTO patient_event_form (
          study_event_id, event_crf_id, crf_id, crf_version_id,
          study_subject_id, form_name, form_structure, form_data,
          completion_status, ordinal, created_by, date_created, date_updated, updated_by
        )
        SELECT
          $1, $2, cv.crf_id, $3,
          ec.study_subject_id,
          c.name, $8::jsonb, $4::jsonb,
          CASE WHEN $5 = 0 THEN 'not_started' WHEN $6 THEN 'complete' ELSE 'in_progress' END,
          1, $7, NOW(), NOW(), $7
        FROM event_crf ec
        JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        JOIN crf c ON cv.crf_id = c.crf_id
        WHERE ec.event_crf_id = $2
        ON CONFLICT (event_crf_id) WHERE event_crf_id IS NOT NULL DO UPDATE
          SET form_data     = EXCLUDED.form_data,
              completion_status = EXCLUDED.completion_status,
              date_updated  = NOW(),
              updated_by    = $7
      `, [studyEventId, eventCrfId, resolvedVersionId,
          JSON.stringify(canonicalFormData),
          savedCount, isComplete, userId, formStructureJson]);
      logger.debug('Upserted patient_event_form.form_data (JSONB source of truth)', {
        eventCrfId,
        totalFields: Object.keys(canonicalFormData).length,
        structuredFields: Object.keys(structuredFieldData).length
      });
    } catch (snapUpdateError: any) {
      // For structured fields this is CRITICAL — log at error level
      if (Object.keys(structuredFieldData).length > 0) {
        logger.error('CRITICAL: Failed to save structured field data to form_data JSONB', {
          error: snapUpdateError.message,
          structuredFieldCount: Object.keys(structuredFieldData).length
        });
      } else {
        logger.error('Failed to upsert patient_event_form.form_data', { error: snapUpdateError.message });
      }
    }

    await client.query('COMMIT');

    const saveWarnings: { fieldPath: string; message: string; queryId?: number }[] = [];

    // 7. AUTO-TRIGGER WORKFLOW — deduplicated
    // Only create a 'form_submitted' event ONCE per eventCrfId.
    // Subsequent saves log 'form_edited' instead (one per save session).
    try {
      const formDetailsResult = await pool.query(`
        SELECT 
          c.name as form_name,
          ss.study_subject_id as subject_id
        FROM event_crf ec
        JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        JOIN crf c ON cv.crf_id = c.crf_id
        JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
        WHERE ec.event_crf_id = $1
      `, [eventCrfId]);
      
      if (formDetailsResult.rows.length > 0) {
        const formName = formDetailsResult.rows[0].formName;
        const subjectId = formDetailsResult.rows[0].subjectId;
        
        // Check if a 'form_submitted' event already exists for this CRF instance
        const existingEvent = await pool.query(`
          SELECT audit_id FROM audit_log_event
          WHERE audit_table = 'form_workflow'
            AND entity_id = $1
            AND entity_name = 'form_submitted'
          LIMIT 1
        `, [eventCrfId]);
        
        if (existingEvent.rows.length === 0) {
          // First save — log form_submitted
          await workflowService.triggerFormSubmittedWorkflow(
            eventCrfId!,
            request.studyId,
            subjectId,
            formName,
            userId
          );
          logger.info('Auto-triggered form_submitted workflow', { eventCrfId, formName });
        } else {
          // Subsequent save — log form_edited (lighter weight, no duplicate)
          await pool.query(`
            INSERT INTO audit_log_event (
              audit_log_event_type_id, audit_date, audit_table,
              entity_id, entity_name, user_id, new_value
            ) VALUES (
              (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%updated%' LIMIT 1),
              NOW(), 'form_workflow', $1, 'form_edited', $2, $3
            )
          `, [eventCrfId, userId, JSON.stringify({ eventCrfId, studyId: request.studyId, subjectId, formName })]);
          logger.info('Logged form_edited event (duplicate form_submitted suppressed)', { eventCrfId });
        }
      }
    } catch (workflowError: any) {
      logger.error('Failed to auto-create workflow for form submission', { error: workflowError.message });
      saveWarnings.push({ fieldPath: '_workflow', message: `Workflow trigger failed: ${workflowError.message}` });
    }

    // ===== POST-SAVE VALIDATION: Create queries for ALL violated rules =====
    // The pre-save dry-run blocked saves for error-severity violations, but
    // if data passed pre-save (errors were fixed or only warnings remain),
    // run all rules with query creation enabled so both warning AND error
    // severity rule violations produce discrepancy notes.
    let queriesCreated = 0;
    let postSaveWarnings: { fieldPath: string; message: string; queryId?: number }[] = [];
    if (request.crfId && request.formData && eventCrfId) {
      try {
        // Look up crf_version_id for precise item matching
        let crfVersionId: number | undefined;
        try {
          const cvResult = await pool.query(
            `SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1`,
            [eventCrfId]
          );
          if (cvResult.rows.length > 0) crfVersionId = cvResult.rows[0].crfVersionId;
        } catch { /* use undefined — service will resolve from crfId */ }

        const postSaveValidation = await validationRulesService.validateFormData(
          request.crfId,
          request.formData,
          {
            createQueries: true,
            studyId: request.studyId,
            subjectId: request.subjectId,
            eventCrfId: eventCrfId,
            userId: userId,
            crfVersionId,
            hiddenFieldIds: (request as any).hiddenFieldIds || undefined
          }
        );
        queriesCreated = postSaveValidation.queriesCreated || 0;
        postSaveWarnings = [
          ...(postSaveValidation.warnings || []),
          ...(postSaveValidation.errors || []).map(e => ({ fieldPath: e.fieldPath, message: e.message, queryId: e.queryId }))
        ];
        if (queriesCreated > 0) {
          logger.info('Post-save validation created queries', { 
            eventCrfId, crfId: request.crfId, queriesCreated,
            fields: postSaveWarnings.map(w => w.fieldPath)
          });
        }
      } catch (postValidationError: any) {
        logger.error('Post-save validation query creation failed', { 
          error: postValidationError.message 
        });
        saveWarnings.push({ fieldPath: '_validation', message: `Post-save validation failed: ${postValidationError.message}` });
      }
    }

    // Auto-advance visit status after save
    if (studyEventId) {
      try {
        const { checkAndUpdateVisitStatus } = await import('./event.service');
        await checkAndUpdateVisitStatus(studyEventId);
      } catch (visitErr: any) {
        logger.error('Failed to auto-update visit status after save', { studyEventId, error: visitErr.message });
        saveWarnings.push({ fieldPath: '_visit', message: `Visit status update failed: ${visitErr.message}` });
      }
    }

    return {
      success: true,
      eventCrfId,       // Top-level for frontend SaveFormDataResponse compatibility
      studyEventId,     // The patient-visit instance that was used
      data: { eventCrfId, studyEventId, savedCount },
      message: `Form data saved successfully (${savedCount} fields)`,
      queriesCreated,
      warnings: [...postSaveWarnings, ...saveWarnings],
      concurrentModifications: concurrentModifications.length > 0 ? concurrentModifications : undefined,
      _postSaveValidationRan: true
    } as any;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Direct database save failed', { error: error.message });
    return {
      success: false,
      message: `Failed to save form data: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get form data from database
 * Returns data along with lock status for UI to respect
 */
export const getFormData = async (eventCrfId: number): Promise<any> => {
  logger.info('Getting form data', { eventCrfId });

  try {
    // First check the lock status of the event_crf
    const lockQuery = `
      SELECT ec.status_id, ec.date_updated as lock_date, u.user_name as locked_by
      FROM event_crf ec
      LEFT JOIN user_account u ON ec.update_id = u.user_id
      WHERE ec.event_crf_id = $1
    `;
    const lockResult = await pool.query(lockQuery, [eventCrfId]);
    const isLocked = lockResult.rows.length > 0 && lockResult.rows[0].statusId === 6;
    const lockInfo = isLocked ? {
      locked: true,
      lockedAt: lockResult.rows[0].lockDate,
      lockedBy: lockResult.rows[0].lockedBy
    } : { locked: false };

    // ── Load item_data (scalar fields + markers for structured fields) ──
    const query = `
      SELECT 
        id.item_data_id,
        i.item_id,
        i.name as item_name,
        i.description as item_description,
        i.oc_oid as item_oid,
        id.value,
        id.status_id,
        id.date_created,
        id.date_updated,
        u.user_name as entered_by
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      LEFT JOIN user_account u ON id.owner_id = u.user_id
      LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
        AND ifm.crf_version_id = (SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1)
      WHERE id.event_crf_id = $1
        AND id.deleted = false
      ORDER BY COALESCE(ifm.ordinal, id.ordinal, i.item_id)
    `;

    const result = await pool.query(query, [eventCrfId]);

    // ── Load JSONB data from patient_event_form (source of truth for structured fields) ──
    let jsonbData: Record<string, any> = {};
    try {
      const jsonbQuery = `
        SELECT pef.form_data
        FROM patient_event_form pef
        WHERE pef.event_crf_id = $1
          AND pef.form_data IS NOT NULL
          AND pef.form_data::text != '{}'
        LIMIT 1
      `;
      const jsonbResult = await pool.query(jsonbQuery, [eventCrfId]);
      if (jsonbResult.rows.length > 0 && jsonbResult.rows[0].formData) {
        jsonbData = jsonbResult.rows[0].formData;
      }
    } catch (jsonbErr: any) {
      logger.warn('Could not load form_data JSONB', { error: jsonbErr.message });
    }

    // Enrich each item with the technical fieldName and resolve structured values
    const STRUCTURED_MARKER = '__STRUCTURED_DATA__';

    for (const row of result.rows) {
      const extProps = parseExtendedProps(row.itemDescription);
      if (extProps.fieldName) {
        row.fieldName = extProps.fieldName;
      }
      const fieldType = extProps.type ? resolveFieldType(extProps.type) : '';

      // For structured fields, replace the marker with the real native value
      // from the JSONB column.  The value is sent as-is (array or object) so
      // the frontend never needs to parse JSON strings.
      if (row.value === STRUCTURED_MARKER || isStructuredDataType(fieldType)) {
        const lookupKey = extProps.fieldName || row.itemName;
        const nativeValue = jsonbData[lookupKey]
          ?? jsonbData[lookupKey?.toLowerCase()]
          ?? jsonbData[row.itemName]
          ?? jsonbData[row.itemName?.toLowerCase()];

        if (nativeValue !== undefined) {
          row.value = nativeValue; // native array or object — NOT a string
        } else if (row.value === STRUCTURED_MARKER) {
          // Marker present but no JSONB data found — field was cleared or not saved
          row.value = isStructuredDataType(fieldType)
            ? (['table'].includes(fieldType) ? [] : {})
            : '';
        }
        // If value is a legacy JSON string (pre-migration), parse it once
        if (typeof row.value === 'string' && row.value !== STRUCTURED_MARKER && row.value !== '') {
          try {
            const parsed = JSON.parse(row.value);
            if (typeof parsed === 'object') row.value = parsed;
          } catch { /* keep as string */ }
        }
      }

      // Clean up — don't send the raw description to the frontend
      delete row.itemDescription;
    }

    // 21 CFR Part 11 §11.10(a) - Decrypt encrypted form data
    // Transparently decrypt any encrypted values before returning
    const decryptedRows = result.rows.map(row => {
      if (typeof row.value === 'string' && row.value && isEncrypted(row.value)) {
        try {
          return { ...row, value: decryptField(row.value) };
        } catch (decryptError: any) {
          logger.error('Failed to decrypt form field', { 
            itemDataId: row.itemDataId, 
            error: decryptError.message 
          });
          return { ...row, value: '[DECRYPTION_ERROR]', encryptedValue: row.value };
        }
      }
      return row;
    });

    // If item_data is empty, build rows entirely from the JSONB snapshot.
    if (decryptedRows.length === 0 && Object.keys(jsonbData).length > 0) {
      logger.info('No item_data found, using patient_event_form.form_data as sole source', { eventCrfId });
      const syntheticRows = Object.entries(jsonbData).map(([fieldName, value]) => ({
        item_data_id: null,
        item_id: null,
        item_name: fieldName,
        item_oid: null,
        field_name: fieldName,
        value: value, // native value — arrays/objects stay native
        status_id: 1,
        date_created: null,
        date_updated: null,
        entered_by: null
      }));
      return {
        data: syntheticRows,
        formData: jsonbData,
        lockStatus: lockInfo,
        source: 'patient_event_form'
      };
    }

    // Return data with lock status for UI to respect
    // Also build a convenience `formData` map keyed by field_name for easy lookup
    const formData: Record<string, any> = {};
    for (const row of decryptedRows) {
      const key = row.fieldName || row.itemName;
      if (key) formData[key] = row.value;
    }

    return {
      data: decryptedRows,
      formData,
      lockStatus: lockInfo
    };
  } catch (error: any) {
    logger.error('Get form data error', { error: error.message });
    throw error;
  }
};

/**
 * Get form metadata with all field properties
 */
export const getFormMetadata = async (crfId: number, options?: { includeHidden?: boolean }): Promise<any> => {
  logger.info('Getting form metadata', { crfId });

  try {
    // Get CRF info
    const crfQuery = `
      SELECT * FROM crf WHERE crf_id = $1
    `;
    const crfResult = await pool.query(crfQuery, [crfId]);

    if (crfResult.rows.length === 0) {
      return null;
    }

    const crf = crfResult.rows[0];

    // Get latest version
    const versionQuery = `
      SELECT * FROM crf_version
      WHERE crf_id = $1
      ORDER BY crf_version_id DESC
      LIMIT 1
    `;
    const versionResult = await pool.query(versionQuery, [crfId]);
    const versionId = versionResult.rows[0]?.crfVersionId;
    if (!versionId) {
      throw new Error(`No CRF version found for crf_id=${crfId}. Cannot load form metadata.`);
    }

    // Get sections
    const sectionsQuery = `
      SELECT 
        section_id,
        label,
        title,
        subtitle,
        instructions,
        ordinal
      FROM section
      WHERE crf_version_id = $1
      ORDER BY ordinal
    `;
    const sectionsResult = await pool.query(sectionsQuery, [versionId]);

    // Get item groups
    const itemGroupsQuery = `
      SELECT DISTINCT
        ig.item_group_id,
        ig.name,
        ig.oc_oid
      FROM item_group ig
      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
      WHERE igm.crf_version_id = $1
      ORDER BY ig.name
    `;
    const itemGroupsResult = await pool.query(itemGroupsQuery, [versionId]);

    // Get items with their full metadata including required, default, validation, options
    const itemsQuery = `
      SELECT 
        i.item_id,
        i.name,
        i.description,
        i.units,
        i.oc_oid,
        i.phi_status,
        idt.name as data_type,
        idt.code as data_type_code,
        COALESCE(ifm.ordinal, igm.ordinal) as ordinal,
        ig.name as group_name,
        -- Additional metadata from item_form_metadata
        ifm.required,
        ifm.default_value,
        ifm.left_item_text as placeholder,
        ifm.regexp as validation_pattern,
        ifm.regexp_error_msg as validation_message,
        ifm.show_item,
        ifm.column_number,
        ifm.width_decimal,
        -- Options from response_set
        rs.options_text,
        rs.options_values,
        rt.name as response_type,
        -- Section info
        s.section_id as section_id,
        s.label as section_name
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
      LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
      LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
      LEFT JOIN section s ON ifm.section_id = s.section_id
      WHERE igm.crf_version_id = $1
        ${options?.includeHidden ? '' : 'AND (ifm.show_item IS DISTINCT FROM false)'}
      ORDER BY COALESCE(ifm.ordinal, igm.ordinal)
    `;
    const itemsResult = await pool.query(itemsQuery, [versionId]);

    // Get Simple Conditional Display (SCD) metadata - LibreClinica's skip logic
    // scd_item_metadata stores show/hide conditions based on other field values
    const scdQuery = `
      SELECT 
        scd.id as scd_id,
        scd.scd_item_form_metadata_id,    -- The item to show/hide
        scd.control_item_form_metadata_id, -- The controlling item
        scd.control_item_name,             -- Name of the controlling item
        scd.option_value,                  -- Value that triggers showing
        scd.message,
        ifm_target.item_id as target_item_id,
        ifm_control.item_id as control_item_id,
        i_control.name as control_field_name
      FROM scd_item_metadata scd
      INNER JOIN item_form_metadata ifm_target ON scd.scd_item_form_metadata_id = ifm_target.item_form_metadata_id
      LEFT JOIN item_form_metadata ifm_control ON scd.control_item_form_metadata_id = ifm_control.item_form_metadata_id
      LEFT JOIN item i_control ON ifm_control.item_id = i_control.item_id
      WHERE ifm_target.crf_version_id = $1
    `;
    const scdResult = await pool.query(scdQuery, [versionId]);
    
    // Build a map of item_id -> SCD conditions for quick lookup
    const scdByItemId = new Map<number, any[]>();
    for (const scd of scdResult.rows) {
      const conditions = scdByItemId.get(scd.targetItemId) || [];
      
      // Parse operator from message field (stored as JSON by our API)
      let operator = 'equals';
      let message = scd.message || '';
      let logicalOperator = 'OR';
      let tableCellTarget = undefined;
      try {
        const parsed = JSON.parse(scd.message);
        if (parsed && parsed.operator) {
          operator = parsed.operator;
          message = parsed.message || '';
          logicalOperator = parsed.logicalOperator || 'OR';
          tableCellTarget = parsed.tableCellTarget || undefined;
        }
      } catch {
        // Not JSON - legacy plain text message, default to equals
      }
      
      const controlFieldId = scd.controlFieldName || scd.controlItemName;
      if (!controlFieldId) {
        console.warn(`[SCD] scd_item_metadata row ${scd.scdItemMetadataId ?? '?'} has no control field name — skipping.`);
        continue;
      }

      conditions.push({
        fieldId: controlFieldId,
        operator,
        value: scd.optionValue,
        message,
        logicalOperator,
        tableCellTarget
      });
      scdByItemId.set(scd.targetItemId, conditions);
    }

    // Get allowed null value types for this CRF version
    // LibreClinica stores allowed null values in event_definition_crf.null_values as comma-separated codes
    let allowedNullValues: any[] = [];
    try {
      const nullValueQuery = `
        SELECT DISTINCT edc.null_values
        FROM event_definition_crf edc
        WHERE edc.crf_id = $1 AND edc.null_values IS NOT NULL AND edc.null_values != ''
        LIMIT 1
      `;
      const nullValueResult = await pool.query(nullValueQuery, [crfId]);
      if (nullValueResult.rows.length > 0 && nullValueResult.rows[0].nullValues) {
        // Get the full null_value_type definitions for the allowed codes
        const codes = nullValueResult.rows[0].nullValues.split(',').map((c: string) => c.trim());
        const nvtQuery = `SELECT null_value_type_id, code, name, definition FROM null_value_type WHERE code = ANY($1) ORDER BY null_value_type_id`;
        const nvtResult = await pool.query(nvtQuery, [codes]);
        allowedNullValues = nvtResult.rows.map((nv: any) => ({
          id: nv.nullValueTypeId,
          code: nv.code,
          name: nv.name,
          definition: nv.definition
        }));
      }
    } catch (nvError: any) {
      logger.warn('Could not load null value types', { error: nvError.message });
    }

    // Also load the full null_value_type reference data for UI dropdowns
    let nullValueTypes: any[] = [];
    try {
      const allNvtResult = await pool.query(`SELECT null_value_type_id, code, name, definition FROM null_value_type ORDER BY null_value_type_id`);
      nullValueTypes = allNvtResult.rows.map((nv: any) => ({
        id: nv.nullValueTypeId,
        code: nv.code,
        name: nv.name,
        definition: nv.definition
      }));
    } catch (e: any) {
      logger.warn('Failed to load null_value_type reference data', { error: e.message });
    }

    // Parse items with all properties including extended props
    const items = itemsResult.rows.map(item => {
      // Parse options — supports newline-delimited (new), pipe-delimited (LibreClinica native), and comma-delimited (legacy)
      let options = null;
      if (item.optionsText && item.optionsValues) {
        const delimiter = item.optionsText.includes('\n') ? '\n'
          : item.optionsText.includes('|') ? '|'
          : ',';
        const labels = item.optionsText.split(delimiter);
        const valDelimiter = item.optionsValues.includes('\n') ? '\n'
          : item.optionsValues.includes('|') ? '|'
          : ',';
        const values = item.optionsValues.split(valDelimiter);
        options = labels
          .map((label: string, idx: number) => ({
            label: label.trim(),
            value: values[idx]?.trim() || label.trim()
          }))
          .filter(opt => opt.label !== '');
      }
      
      // Parse description for help text and extended properties
      let helpText = item.description || '';
      let extendedProps: any = {};
      
      extendedProps = parseExtendedProps(helpText);
      helpText = stripExtendedProps(helpText);
      
      // Parse min/max from width_decimal if present
      let min = extendedProps.min;
      let max = extendedProps.max;
      if (item.widthDecimal && item.widthDecimal.includes(',')) {
        const [minVal, maxVal] = item.widthDecimal.split(',');
        if (minVal && !isNaN(Number(minVal))) min = Number(minVal);
        if (maxVal && !isNaN(Number(maxVal))) max = Number(maxVal);
      }
      
      // Build validation rules array
      const validationRules: any[] = [];
      if (item.required) {
        validationRules.push({ type: 'required', message: 'This field is required' });
      }
      if (item.validationPattern) {
        // Detect Excel formula rules stored with =FORMULA: prefix
        const isFormula = item.validationPattern.startsWith('=FORMULA:');
        const patternValue = isFormula 
          ? item.validationPattern.substring(9) // Strip =FORMULA: prefix
          : item.validationPattern;
        validationRules.push({ 
          type: isFormula ? 'formula' : 'pattern', 
          value: patternValue,
          message: item.validationMessage || 'Invalid format'
        });
      }
      if (min !== undefined) {
        validationRules.push({ type: 'min', value: min, message: `Minimum value is ${min}` });
      }
      if (max !== undefined) {
        validationRules.push({ type: 'max', value: max, message: `Maximum value is ${max}` });
      }
      
      // Determine field type from:
      // 1. Extended props (preserves frontend types like 'yesno', 'textarea')
      // 2. Response type (LibreClinica's UI type)
      // 3. Data type code (fallback)
      // All paths run through resolveFieldType() — the single source of truth.
      // Priority: extendedProps.type > response_type > data_type_code > 'text'
      const fieldType = resolveFieldType(
        extendedProps.type || item.responseType || item.dataTypeCode
      );
      
      return {
        // Core identifiers
        id: item.itemId?.toString(),
        item_id: item.itemId,
        // Use the preserved technical field name from extended props, fall back to DB name
        name: extendedProps.fieldName || item.name,
        oc_oid: item.ocOid,
        
        // Type info
        type: fieldType,
        data_type: item.dataType,
        data_type_code: item.dataTypeCode,
        response_type: item.responseType,
        
        // Display — item.name in DB stores the display label
        label: item.name,
        description: helpText,
        helpText: helpText,
        placeholder: item.placeholder || '',
        
        // State — use explicit boolean coercion so NULL DB values and
        // extended-prop fallbacks always produce a reliable true/false.
        required: item.required === true || extendedProps.required === true,
        readonly: extendedProps.readonly === true,
        hidden: item.showItem === false,
        
        // Value
        defaultValue: item.defaultValue,
        
        // Validation
        validationRules,
        validationPattern: item.validationPattern,
        validationMessage: item.validationMessage,
        
        // Options
        options,
        
        // Layout — ordinal is 1-based in DB. The frontend uses the array index
        // as the canonical order; do NOT send a separate 'order' field.
        ordinal: item.ordinal,
        section: item.sectionName,
        section_id: item.sectionId,
        group_name: item.groupName,
        width: extendedProps.width || 'full',
        columnPosition: item.columnNumber || extendedProps.columnPosition || 1,
        columnNumber: item.columnNumber || 1,
        groupId: extendedProps.groupId,
        
        // Clinical
        unit: item.units || extendedProps.unit,
        units: item.units,
        min,
        max,
        format: extendedProps.format,
        
        // PHI and Compliance — explicit boolean coercion prevents NULL
        // DB columns (original LibreClinica schema has no DEFAULT) from
        // silently dropping the flag via falsy || chaining.
        isPhiField: item.phiStatus === true || extendedProps.isPhiField === true,
        phi_status: item.phiStatus === true,
        phiClassification: extendedProps.phiClassification,
        auditRequired: extendedProps.auditRequired === true,
        criticalDataPoint: extendedProps.criticalDataPoint === true,
        auditTrail: extendedProps.auditTrail,
        
        // Linked/Nested
        linkedFormIds: extendedProps.linkedFormIds,
        patientDataMapping: extendedProps.patientDataMapping,
        nestedFormId: extendedProps.nestedFormId,
        allowMultiple: extendedProps.allowMultiple,
        
        // File upload
        allowedFileTypes: extendedProps.allowedFileTypes,
        maxFileSize: extendedProps.maxFileSize,
        maxFiles: extendedProps.maxFiles,
        
        // Calculated
        calculationFormula: extendedProps.calculationFormula,
        dependsOn: extendedProps.dependsOn,
        
        // Conditional Logic / Branching
        // Use extendedProps as primary source (preserves all operators), fall back to SCD (equals-only)
        // Always normalize to array — extendedProps may store a single object when
        // the form was created with one condition; the frontend expects an array.
        showWhen: normalizeToArray(extendedProps.showWhen, scdByItemId.get(item.itemId) || []),
        hideWhen: normalizeToArray(extendedProps.hideWhen),
        requiredWhen: normalizeToArray(extendedProps.requiredWhen),
        conditionalLogic: extendedProps.conditionalLogic,
        visibilityConditions: extendedProps.visibilityConditions,
        // Flag to indicate if using LibreClinica native SCD
        hasNativeScd: scdByItemId.has(item.itemId),
        
        // Form Linking / Branch to Another Form
        linkedFormId: extendedProps.linkedFormId,
        linkedFormName: extendedProps.linkedFormName,
        linkedFormTriggerValue: extendedProps.linkedFormTriggerValue,
        linkedFormRequired: extendedProps.linkedFormRequired,
        formLinks: extendedProps.formLinks,
        
        // Custom
        customAttributes: extendedProps.customAttributes,
        
        // Table field properties — normalize column keys so every column
        // has a stable `key` even if old data was serialized without one.
        // Also ensure every table row has a stable `id`.
        tableColumns: Array.isArray(extendedProps.tableColumns)
          ? extendedProps.tableColumns.map((col: any, idx: number) => ({
              ...col,
              key: col.key || col.name || (col.id ? String(col.id).substring(0, 32) : `col_${idx}`)
            }))
          : extendedProps.tableColumns,
        tableRows: Array.isArray(extendedProps.tableRows)
          ? extendedProps.tableRows.map((row: any, idx: number) => ({
              ...row,
              id: row.id || `row_${idx}`
            }))
          : extendedProps.tableRows,
        tableSettings: extendedProps.tableSettings,
        
        // Inline group field properties
        inlineFields: extendedProps.inlineFields,
        inlineGroupSettings: extendedProps.inlineGroupSettings,
        
        // Criteria list field properties
        criteriaItems: extendedProps.criteriaItems,
        criteriaListSettings: extendedProps.criteriaListSettings,
        
        // Question table field properties — STRUCTURAL FIX:
        // New forms store column definitions once at the table level (`answerColumns`).
        // Legacy forms store per-row `answerColumns` with potentially different IDs per row.
        // We detect which model is in use and handle accordingly:
        // - New model (top-level answerColumns exists): rows are lightweight {id, question}
        // - Legacy model (no top-level, per-row columns): KEEP per-row columns intact
        //   because patient data is keyed by those per-row column IDs
        ...(() => {
          const rawRows = extendedProps.questionRows;
          if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return { answerColumns: extendedProps.answerColumns || [], questionRows: rawRows };
          }

          // If top-level answerColumns already exists (new model), use it
          if (Array.isArray(extendedProps.answerColumns) && extendedProps.answerColumns.length > 0) {
            const usedColIds = new Set<string>();
            const canonicalCols = extendedProps.answerColumns.map((col: any, cIdx: number) => {
              let colId = col.id || (col.header ? col.header.replace(/\s+/g, '_').toLowerCase() : `ans_${cIdx}`);
              if (usedColIds.has(colId)) colId = `${colId}_${cIdx}`;
              usedColIds.add(colId);
              return { ...col, id: colId };
            });
            // Strip per-row answerColumns — new model rows are lightweight
            const normalizedRows = rawRows.map((row: any, rIdx: number) => ({
              id: row.id || `qrow_${rIdx}`,
              question: row.question || '',
            }));
            return { answerColumns: canonicalCols, questionRows: normalizedRows };
          }

          // Legacy model: per-row answerColumns with potentially different IDs.
          // Check if all rows share the same column IDs (safe to promote)
          // or have divergent IDs (must keep per-row to preserve data references).
          const rowsWithCols = rawRows.filter((r: any) => Array.isArray(r.answerColumns) && r.answerColumns.length > 0);
          if (rowsWithCols.length === 0) {
            return { answerColumns: [], questionRows: rawRows };
          }

          const firstRowColIds = (rowsWithCols[0].answerColumns || []).map((c: any) => c.id).join(',');
          const allSame = rowsWithCols.every((r: any) =>
            (r.answerColumns || []).map((c: any) => c.id).join(',') === firstRowColIds
          );

          if (allSame) {
            // All rows share identical column IDs — safe to promote
            const canonicalCols = rowsWithCols[0].answerColumns.map((col: any, cIdx: number) => {
              const usedColIds = new Set<string>();
              let colId = col.id || `ans_${cIdx}`;
              if (usedColIds.has(colId)) colId = `${colId}_${cIdx}`;
              usedColIds.add(colId);
              return { ...col, id: colId };
            });
            const normalizedRows = rawRows.map((row: any, rIdx: number) => ({
              id: row.id || `qrow_${rIdx}`,
              question: row.question || '',
            }));
            return { answerColumns: canonicalCols, questionRows: normalizedRows };
          }

          // Divergent column IDs across rows — KEEP per-row columns intact.
          // Normalize row IDs but preserve answerColumns on each row.
          const normalizedRows = rawRows.map((row: any, rIdx: number) => {
            const usedColIds = new Set<string>();
            return {
              ...row,
              id: row.id || `qrow_${rIdx}`,
              answerColumns: Array.isArray(row.answerColumns)
                ? row.answerColumns.map((col: any, cIdx: number) => {
                    let colId = col.id || (col.header ? col.header.replace(/\s+/g, '_').toLowerCase() : `ans_${cIdx}`);
                    if (usedColIds.has(colId)) colId = `${colId}_${cIdx}`;
                    usedColIds.add(colId);
                    return { ...col, id: colId };
                  })
                : row.answerColumns,
            };
          });
          return { answerColumns: undefined, questionRows: normalizedRows };
        })(),
        questionTableSettings: extendedProps.questionTableSettings,
        
        // Static content / Section header
        staticContent: extendedProps.staticContent,
        headerLevel: extendedProps.headerLevel,
        
        // Barcode / QR Code
        barcodeFormat: extendedProps.barcodeFormat,
        barcodePattern: extendedProps.barcodePattern,
        
        // Calculation type
        calculationType: extendedProps.calculationType
      };
    });

    // Get decision conditions (forking/branching) from LibreClinica
    // decision_condition table handles form/section branching based on values
    //
    // ISSUE-414 fix: the previous query referenced columns that don't exist
    // in LibreClinica's actual schema:
    //   dcp.comparison_operator -> actual: dcp.comparison
    //   dcp.value               -> actual: dcp.constant_value
    //   dcsu.replacement_value  -> actual: dcsu.value
    // Every metadata fetch logged a "column does not exist" error and
    // returned decisionConditions: []. The frontend doesn't currently
    // consume this field, but we fix it now so any future branching UI
    // gets real data instead of an empty array.
    let decisionConditions: any[] = [];
    try {
      const dcQuery = `
        SELECT 
          dc.decision_condition_id,
          dc.crf_version_id,
          dc.label,
          dc.comments,
          dc.quantity,
          dc.type,
          -- Get dc_primitive conditions
          dcp.dc_primitive_id,
          dcp.item_id,
          dcp.comparison AS comparison_operator,
          dcp.constant_value AS comparison_value,
          dcp.dynamic_value_item_id,
          i.name as item_name,
          i.oc_oid as item_oid,
          -- Get dc_event actions
          dce.dc_event_id,
          -- Section events
          dcse.section_id,
          s.label as section_label,
          -- Computed events (calculations)
          dcce.dc_summary_event_id,
          dcce.item_target_id,
          -- Substitution events
          dcsu.item_id as substitution_item_id,
          dcsu.value AS replacement_value
        FROM decision_condition dc
        LEFT JOIN dc_primitive dcp ON dc.decision_condition_id = dcp.decision_condition_id
        LEFT JOIN item i ON dcp.item_id = i.item_id
        LEFT JOIN dc_event dce ON dc.decision_condition_id = dce.decision_condition_id
        LEFT JOIN dc_section_event dcse ON dce.dc_event_id = dcse.dc_event_id
        LEFT JOIN section s ON dcse.section_id = s.section_id
        LEFT JOIN dc_computed_event dcce ON dce.dc_event_id = dcce.dc_event_id
        LEFT JOIN dc_substitution_event dcsu ON dce.dc_event_id = dcsu.dc_event_id
        WHERE dc.crf_version_id = $1 AND dc.status_id = 1
        ORDER BY dc.decision_condition_id
      `;
      
      const dcResult = await pool.query(dcQuery, [versionId]);
      
      // Group by decision_condition_id
      const dcMap = new Map<number, any>();
      for (const row of dcResult.rows) {
        if (!dcMap.has(row.decisionConditionId)) {
          dcMap.set(row.decisionConditionId, {
            id: row.decisionConditionId,
            label: row.label,
            comments: row.comments,
            quantity: row.quantity,
            type: row.type,
            conditions: [],
            actions: []
          });
        }
        
        const dc = dcMap.get(row.decisionConditionId)!;
        
        // Add condition primitive
        if (row.dcPrimitiveId && !dc.conditions.some((c: any) => c.primitiveId === row.dcPrimitiveId)) {
          dc.conditions.push({
            primitiveId: row.dcPrimitiveId,
            itemId: row.itemId,
            itemName: row.itemName,
            itemOid: row.itemOid,
            operator: row.comparisonOperator,
            value: row.comparisonValue,
            dynamicValueItemId: row.dynamicValueItemId
          });
        }
        
        // Add action - section show/hide
        if (row.sectionId && !dc.actions.some((a: any) => a.sectionId === row.sectionId)) {
          dc.actions.push({
            type: 'section',
            sectionId: row.sectionId,
            sectionLabel: row.sectionLabel
          });
        }
        
        // Add action - computed/calculation
        if (row.dcSummaryEventId && !dc.actions.some((a: any) => a.summaryEventId === row.dcSummaryEventId)) {
          dc.actions.push({
            type: 'calculation',
            summaryEventId: row.dcSummaryEventId,
            targetItemId: row.itemTargetId
          });
        }
        
        // Add action - substitution
        if (row.substitutionItemId && !dc.actions.some((a: any) => a.substitutionItemId === row.substitutionItemId)) {
          dc.actions.push({
            type: 'substitution',
            substitutionItemId: row.substitutionItemId,
            replacementValue: row.replacementValue
          });
        }
      }
      
      decisionConditions = Array.from(dcMap.values());
    } catch (dcError: any) {
      // Decision condition tables might not exist in all installations
      logger.debug('Decision conditions query failed (optional):', dcError.message);
    }

    return {
      crf,
      version: versionResult.rows[0],
      sections: sectionsResult.rows,
      itemGroups: itemGroupsResult.rows,
      items,
      // LibreClinica decision conditions for forking/branching
      decisionConditions,
      // Null value types - allowed missing data reasons (21 CFR Part 11 compliant)
      // allowedNullValues: codes configured for this specific CRF
      // nullValueTypes: full reference table for UI display
      allowedNullValues,
      nullValueTypes
    };
  } catch (error: any) {
    logger.error('Get form metadata error', { error: error.message });
    throw error;
  }
};

/**
 * Get null value types (missing data reasons)
 * Returns the LibreClinica null_value_type reference table
 * Used for Part 11 compliant missing data documentation
 */
export const getNullValueTypes = async (): Promise<any[]> => {
  try {
    const result = await pool.query(`SELECT null_value_type_id, code, name, definition FROM null_value_type ORDER BY null_value_type_id`);
    return result.rows.map((nv: any) => ({
      id: nv.nullValueTypeId,
      code: nv.code,
      name: nv.name,
      definition: nv.definition || nv.name
    }));
  } catch (error: any) {
    logger.error('Could not load null value types', { error: error.message });
    throw error;
  }
};

/**
 * Get measurement units reference data
 * Returns the LibreClinica measurement_unit table
 */
export const getMeasurementUnits = async (): Promise<any[]> => {
  try {
    const result = await pool.query(`SELECT id, oc_oid, name, description FROM measurement_unit ORDER BY name`);
    return result.rows;
  } catch (error: any) {
    logger.error('Could not load measurement units', { error: error.message });
    throw error;
  }
};

/**
 * Get form status
 */
export const getFormStatus = async (eventCrfId: number): Promise<any> => {
  logger.info('Getting form status', { eventCrfId });

  try {
    const query = `
      SELECT 
        ec.event_crf_id,
        ec.status_id,
        ec.completion_status_id,
        cs.name as completion_status,
        ec.date_created,
        ec.date_updated,
        u1.user_name as created_by,
        u2.user_name as updated_by,
        ec.validator_id,
        u3.user_name as validated_by,
        ec.date_validate,
        ec.sdv_status,
        COALESCE(ec.frozen, false) as frozen,
        COALESCE(ec.electronic_signature_status, false) as signed
      FROM event_crf ec
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON ec.update_id = u2.user_id
      LEFT JOIN user_account u3 ON ec.validator_id = u3.user_id
      WHERE ec.event_crf_id = $1
    `;

    const result = await pool.query(query, [eventCrfId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      ...row,
      locked: row.statusId === 6
    };
  } catch (error: any) {
    logger.error('Get form status error', { error: error.message });
    throw error;
  }
};

/**
 * Validate form data (business rules)
 */
export const validateFormData = (formData: Record<string, any>): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Basic validation (extend as needed)
  if (!formData || Object.keys(formData).length === 0) {
    errors.push('Form data is empty');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get all CRFs (Form Templates) for a study
 */
export const getStudyForms = async (studyId: number): Promise<any[]> => {
  logger.info('Getting study forms', { studyId });

  try {
    // Check if category column exists in crf table
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'crf' AND column_name = 'category'
    `);
    const hasCategoryColumn = columnCheck.rows.length > 0;

    // Filter out deleted/archived forms for 21 CFR Part 11 compliance
    // status_id: 5=removed, 6=archived, 7=auto-removed
    // Archived forms are only visible to admins via the /archived endpoint
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        ${hasCategoryColumn ? 'c.category,' : "'other' as category,"}
        c.oc_oid,
        c.status_id,
        s.name as status_name,
        c.date_created,
        c.date_updated,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,
        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      WHERE c.source_study_id = $1
        AND c.status_id NOT IN (5, 6, 7)
      ORDER BY c.name
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get study forms error', { error: error.message });
    throw error;
  }
};

/**
 * Get all CRFs (templates) - includes drafts and published
 * Status IDs: 1=available, 2=unavailable/locked, 5=removed
 * 
 * WARNING: This method returns forms across ALL studies for the user's organization.
 * Prefer getStudyForms(studyId) when a study context is available, or
 * getAvailableCrfsForEvent(studyId, eventId) for event CRF assignment.
 */
export const getAllForms = async (userId?: number): Promise<any[]> => {
  logger.info('Getting all forms', { userId });
  console.log(`[getAllForms] Called with userId=${userId}`);

  try {
    // Check if category column exists in crf table
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'crf' AND column_name = 'category'
    `);
    const hasCategoryColumn = columnCheck.rows.length > 0;

    // Build org-scoping filter
    let orgFilter = '';
    const params: any[] = [];

    if (userId) {
      // Check organization membership
      const orgCheck = await pool.query(
        `SELECT organization_id, role FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      const userOrgIds = orgCheck.rows.map((r: any) => r.organizationId);

      if (userOrgIds.length > 0) {
        // User belongs to an org — only show forms owned by org members
        // or forms linked to studies owned by org members
        params.push(userOrgIds);
        orgFilter = `AND (
          c.owner_id IN (
            SELECT m.user_id FROM acc_organization_member m
            WHERE m.organization_id = ANY($1::int[])
              AND m.status = 'active'
          )
          OR c.source_study_id IN (
            SELECT s2.study_id FROM study s2
            WHERE s2.owner_id IN (
              SELECT m2.user_id FROM acc_organization_member m2
              WHERE m2.organization_id = ANY($1::int[])
                AND m2.status = 'active'
            )
          )
        )`;
      }
      // else: no org membership — if admin, see all forms (no filter added)
    }

    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        ${hasCategoryColumn ? 'c.category,' : "'other' as category,"}
        c.oc_oid,
        c.status_id,
        s.name as status_name,
        st.name as study_name,
        st.study_id,
        c.date_created,
        c.date_updated,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,
        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.status_id IN (1, 2)
      ${orgFilter}
      ORDER BY c.date_created DESC, c.name
    `;

    const result = await pool.query(query, params);
    console.log(`[getAllForms] Query returned ${result.rows.length} forms for userId=${userId}`, 
      result.rows.map((r: any) => ({ crf_id: r.crfId, name: r.name, status_id: r.statusId }))
    );
    logger.info('Forms retrieved', { count: result.rows.length, userId });
    return result.rows;
  } catch (error: any) {
    logger.error('Get all forms error', { error: error.message });
    throw error;
  }
};

/**
 * Get CRF by ID
 * Org-scoped: if caller belongs to an org, form owner or study owner must be in the same org
 */
export const getFormById = async (crfId: number, callerUserId?: number): Promise<any> => {
  logger.info('Getting form by ID', { crfId, callerUserId });

  try {
    const query = `
      SELECT 
        c.*,
        s.name as status_name,
        st.name as study_name,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,
        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.crf_id = $1
        AND c.status_id NOT IN (5, 6, 7)
    `;

    const result = await pool.query(query, [crfId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    // Org-scoping check
    if (callerUserId) {
      const orgCheck = await pool.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [callerUserId]
      );
      const callerOrgIds = orgCheck.rows.map((r: any) => r.organizationId);

      if (callerOrgIds.length > 0) {
        const form = result.rows[0];
        const ownerIds = [form.ownerId];
        // Also check study owner if the form is linked to a study
        if (form.sourceStudyId) {
          const studyOwner = await pool.query(`SELECT owner_id FROM study WHERE study_id = $1`, [form.sourceStudyId]);
          if (studyOwner.rows.length > 0) ownerIds.push(studyOwner.rows[0].ownerId);
        }
        const ownerInOrg = await pool.query(
          `SELECT 1 FROM acc_organization_member WHERE user_id = ANY($1::int[]) AND organization_id = ANY($2::int[]) AND status = 'active' LIMIT 1`,
          [ownerIds, callerOrgIds]
        );
        if (ownerInOrg.rows.length === 0) {
          logger.warn('getFormById org-scoping denied', { crfId, callerUserId, callerOrgIds });
          return null;
        }
      }
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get form by ID error', { error: error.message });
    throw error;
  }
};

/**
 * Map frontend field type to LibreClinica item_data_type_id
 */
/**
 * Map canonical field type → LibreClinica item_data_type_id.
 * Input MUST already be a canonical type from resolveFieldType().
 */
const mapFieldTypeToDataType = (fieldType: string): number => {
  const typeMap: Record<string, number> = {
    'text': 5,      // ST - Character String
    'textarea': 5,  // ST
    'email': 5,     // ST
    'phone': 5,     // ST
    'address': 5,   // ST
    'patient_name': 5, // ST
    'patient_id': 5,   // ST
    'ssn': 5,          // ST
    'medical_record_number': 5, // ST
    'medication': 5,   // ST
    'diagnosis': 5,    // ST
    'procedure': 5,    // ST
    'lab_result': 5,   // ST
    'static_text': 5,  // ST
    'number': 6,    // INT - Integer
    'decimal': 7,   // REAL - Floating
    'date': 9,      // DATE
    'datetime': 9,  // DATE (stored as ISO string)
    'time': 5,      // ST - stored as string
    'date_of_birth': 9, // DATE
    'checkbox': 1,  // BL - Boolean
    'radio': 5,     // ST - stored as string
    'yesno': 5,     // ST - stored as string
    'select': 5,    // ST - stored as string
    'combobox': 5,  // ST
    'file': 11,     // FILE
    'image': 11,    // FILE
    'signature': 11, // FILE
    'table': 5,     // ST - Table data stored as JSON string
    'calculation': 7, // REAL - calculations may be numeric
    'age': 7, 'bsa': 7, 'egfr': 7, 'sum': 7, 'average': 7,
    'barcode': 5,   // ST
    'qrcode': 5,    // ST
    'height': 7,    // REAL
    'weight': 7,    // REAL
    'blood_pressure': 5, // ST - stored as "120/80"
    'temperature': 7, // REAL
    'heart_rate': 6,  // INT
    'respiration_rate': 6, // INT
    'oxygen_saturation': 7, // REAL
    'bmi': 7,        // REAL - calculated
    'section_header': 5, // ST
    'inline_group': 5,  // ST
    'criteria_list': 5, // ST
    'question_table': 5 // ST
  };
  return typeMap[fieldType?.toLowerCase()] || 5;
};

/**
 * Form field interface - uses shared DTOs from ../../types as source of truth.
 * ValidationRule, FormFieldOption, ShowWhenCondition, etc. are imported from there.
 */
interface FormField {
  // Core identifiers
  id?: string;
  itemId?: number;
  name?: string;
  type: string;
  label: string;
  
  // Text content
  description?: string;
  helpText?: string;
  placeholder?: string;
  
  // State flags
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  isRequired?: boolean;
  isReadonly?: boolean;
  isHidden?: boolean;
  
  // Validation
  validationRules?: FieldValidationConstraint[];
  
  // Options (for select, radio, checkbox)
  options?: FormFieldOption[];
  defaultValue?: any;
  
  // PHI and Compliance
  isPhiField?: boolean;
  phiClassification?: {
    isPhiField: boolean;
    phiType?: string;
    encryptionRequired: boolean;
    accessLevel: string;
    auditRequired: boolean;
    dataMinimization: boolean;
    retentionPeriodDays?: number;
  };
  auditRequired?: boolean;
  linkedFormIds?: string[];
  patientDataMapping?: string;
  
  // Nested Form Support
  nestedFormId?: string;
  allowMultiple?: boolean;
  
  // File Upload Configuration
  allowedFileTypes?: string[];
  maxFileSize?: number;
  maxFiles?: number;
  
  // Layout and Display
  width?: 'full' | 'half' | 'third' | 'quarter';
  columnPosition?: 'left' | 'right' | 'center';
  order?: number;
  groupId?: string;
  
  // Calculated Fields
  calculationFormula?: string;
  dependsOn?: string[];
  
  // Conditional Logic / Branching (uses shared ShowWhenCondition DTO)
  showWhen?: ShowWhenCondition[];
  hideWhen?: ShowWhenCondition[];
  requiredWhen?: ShowWhenCondition[];
  conditionalLogic?: ShowWhenCondition[];
  visibilityConditions?: ShowWhenCondition[];
  
  // Form Linking / Branch to Another Form (uses shared FormLinkDefinition DTO)
  linkedFormId?: number | string;
  linkedFormName?: string;
  linkedFormTriggerValue?: any;
  linkedFormRequired?: boolean;
  formLinks?: FormLinkDefinition[];
  
  // Custom attributes
  customAttributes?: Record<string, any>;
  
  // Clinical field properties
  unit?: string;
  min?: number;
  max?: number;
  
  // Date/Time field properties
  format?: string;
  
  // Audit and Compliance
  criticalDataPoint?: boolean;
  auditTrail?: {
    trackChanges: boolean;
    reasonRequired: boolean;
  };
  
  // Table field properties (types from shared DTO in ../../types)
  tableColumns?: TableColumnDefinition[];
  tableRows?: TableRowDefinition[];
  tableSettings?: TableSettings;
  
  // Inline group field properties (uses shared DTOs)
  inlineFields?: InlineFieldDefinition[];
  inlineGroupSettings?: InlineGroupSettings;
  
  // Criteria list field properties (uses shared DTOs)
  criteriaItems?: CriteriaItem[];
  criteriaListSettings?: CriteriaListSettings;
  
  // Question table field properties (uses shared DTOs)
  answerColumns?: any[];
  questionRows?: QuestionRow[];
  questionTableSettings?: QuestionTableSettings;
  
  // Static content / Section header
  staticContent?: string;
  headerLevel?: number;
  
  // Barcode / QR Code
  barcodeFormat?: string;
  barcodePattern?: string;
  
  // Calculation type
  calculationType?: string;
  
  // Column number (layout)
  columnNumber?: number;

  // Section assignment — can be a client UUID (from form builder) or a section display name.
  // formLinks is already declared above alongside linkedFormId/linkedFormName.
  section?: string;
}

/**
 * Default clinical units for vital-sign field types.
 * Used when a field is created/imported without an explicit unit.
 */
function getDefaultClinicalUnit(fieldType: string): string {
  const defaults: Record<string, string> = {
    height: 'cm',
    weight: 'kg',
    temperature: '°C',
    heart_rate: 'bpm',
    blood_pressure: 'mmHg',
    oxygen_saturation: '%',
    respiration_rate: 'breaths/min',
    bmi: 'kg/m²',
  };
  return defaults[fieldType?.toLowerCase()] || '';
}

/**
 * Serialize extended field properties to JSON for storage.
 * IMPORTANT: field.type is normalized via resolveFieldType() so the DB
 * always stores canonical types ('radio', not 'radiobutton').
 */
const serializeExtendedProperties = (field: FormField): string => {
  // Layout-only types (section_header, static_text) are display elements,
  // not data inputs — never required regardless of what the client sends.
  // This is a safety net against legacy imports or buggy callers.
  const canonicalType = resolveFieldType(field.type);
  const isLayoutOnly = canonicalType === 'section_header' || canonicalType === 'static_text';

  const extended = {
    // Always store the CANONICAL type so reads never encounter aliases
    type: canonicalType,
    
    // Technical field name (lowercase_underscored identifier, distinct from the display label)
    // The DB item.name stores the display label; this preserves the technical ID for formulas, etc.
    fieldName: field.name,
    
    // Required flag — also stored in item_form_metadata.required DB column,
    // but duplicated here as a safety net so round-trips never lose it.
    // Use === true to ensure we store a clean boolean, never a truthy string.
    required: isLayoutOnly ? false : (field.required === true || field.isRequired === true),
    
    // PHI and Compliance — explicit boolean so the safety net is reliable
    isPhiField: field.isPhiField === true,
    phiClassification: field.phiClassification,
    auditRequired: field.auditRequired,
    linkedFormIds: field.linkedFormIds,
    patientDataMapping: field.patientDataMapping,
    
    // Nested Form
    nestedFormId: field.nestedFormId,
    allowMultiple: field.allowMultiple,
    
    // File Upload
    allowedFileTypes: field.allowedFileTypes,
    maxFileSize: field.maxFileSize,
    maxFiles: field.maxFiles,
    
    // Layout
    width: field.width,
    columnPosition: field.columnPosition,
    groupId: field.groupId,
    // Client-side section identifier — preserved for round-trip so the UI can
    // rebuild section panels when the form is reloaded.
    section: field.section,
    
    // Calculated
    calculationFormula: field.calculationFormula,
    dependsOn: field.dependsOn,
    
    // Conditional Logic / Branching
    showWhen: field.showWhen,
    hideWhen: field.hideWhen,
    requiredWhen: field.requiredWhen,
    conditionalLogic: field.conditionalLogic,
    visibilityConditions: field.visibilityConditions,
    
    // Form Linking / Branch to Another Form
    linkedFormId: field.linkedFormId,
    linkedFormName: field.linkedFormName,
    linkedFormTriggerValue: field.linkedFormTriggerValue,
    linkedFormRequired: field.linkedFormRequired,
    formLinks: field.formLinks,
    
    // Clinical
    unit: field.unit || getDefaultClinicalUnit(resolveFieldType(field.type)),
    min: field.min,
    max: field.max,
    format: field.format,
    
    // Audit
    criticalDataPoint: field.criticalDataPoint,
    auditTrail: field.auditTrail,
    
    // Custom
    customAttributes: field.customAttributes,
    
    // Readonly
    readonly: field.readonly || field.isReadonly,
    
    // Table field properties — ensure every column has a stable key before serializing
    tableColumns: field.tableColumns?.map((col: any) => ({
      ...col,
      // key is the stable storage identifier (set at column creation time).
      // If missing (legacy columns), derive it from name or a truncated id.
      key: col.key || col.name || (col.id ? String(col.id).substring(0, 32) : `col_${Math.random().toString(36).substr(2, 8)}`)
    })),
    tableRows: field.tableRows,
    tableSettings: field.tableSettings,
    
    // Inline group field properties
    inlineFields: field.inlineFields,
    inlineGroupSettings: field.inlineGroupSettings,
    
    // Criteria list field properties
    criteriaItems: field.criteriaItems,
    criteriaListSettings: field.criteriaListSettings,
    
    // Question table field properties — answerColumns at table level (canonical),
    // questionRows as lightweight {id, question} objects only
    answerColumns: field.answerColumns,
    questionRows: Array.isArray(field.questionRows)
      ? field.questionRows.map((row: any) => ({
          id: row.id,
          question: row.question || '',
        }))
      : field.questionRows,
    questionTableSettings: field.questionTableSettings,
    
    // Static content / Section header
    staticContent: field.staticContent,
    headerLevel: field.headerLevel,
    
    // Barcode / QR Code
    barcodeFormat: field.barcodeFormat,
    barcodePattern: field.barcodePattern,
    
    // Calculation type
    calculationType: field.calculationType
  };
  
  // Remove undefined values
  Object.keys(extended).forEach(key => {
    if ((extended as any)[key] === undefined) {
      delete (extended as any)[key];
    }
  });
  
  return Object.keys(extended).length > 0 ? JSON.stringify(extended) : '';
};

/**
 * Map field type to LibreClinica response_type_id
 * 
 * LibreClinica Response Types:
 * 1 = text
 * 2 = textarea
 * 3 = checkbox
 * 4 = file upload
 * 5 = radio
 * 6 = single-select (dropdown)
 * 7 = multi-select
 * 8 = calculation (auto-calculated field)
 * 9 = group-calculation (calculation across repeating groups)
 * 10 = instant-calculation / barcode
 */
/**
 * Map canonical field type → LibreClinica response_type_id.
 * Input MUST already be a canonical type from resolveFieldType().
 *
 * LibreClinica Response Types:
 * 1=text, 2=textarea, 3=checkbox, 4=file, 5=radio,
 * 6=single-select, 7=multi-select, 8=calculation,
 * 9=group-calculation, 10=instant-calculation/barcode
 */
const mapFieldTypeToResponseType = (fieldType: string): number => {
  const typeMap: Record<string, number> = {
    'text': 1, 'email': 1, 'phone': 1, 'address': 1,
    'patient_name': 1, 'patient_id': 1, 'ssn': 1,
    'medical_record_number': 1, 'medication': 1, 'diagnosis': 1,
    'procedure': 1, 'lab_result': 1, 'static_text': 1,
    'number': 1, 'decimal': 1, 'date': 1, 'datetime': 1, 'time': 1,
    'date_of_birth': 1, 'height': 1, 'weight': 1, 'temperature': 1,
    'heart_rate': 1, 'blood_pressure': 1, 'oxygen_saturation': 1,
    'respiration_rate': 1, 'table': 1, 'inline_group': 1,
    'criteria_list': 1, 'question_table': 1, 'section_header': 1,
    'combobox': 6,
    'textarea': 2,
    'checkbox': 3,
    'file': 4, 'image': 4, 'signature': 4,
    'radio': 5, 'yesno': 5,
    'select': 6,
    'calculation': 8, 'bmi': 8, 'bsa': 8, 'egfr': 8, 'age': 8,
    'sum': 9, 'average': 9,
    'barcode': 10, 'qrcode': 10,
  };
  return typeMap[fieldType?.toLowerCase()] || 1;
};

// Type mapping functions removed — all callers now use resolveFieldType() from
// '../../utils/field-type.utils' (single source of truth shared with frontend).

/**
 * Create a new form template (CRF) with fields
 */
export const createForm = async (
  data: {
    name: string;
    description?: string;
    studyId?: number;
    fields?: FormField[];
    category?: string;
    version?: string;
    status?: 'draft' | 'published' | 'archived';
  },
  userId: number
): Promise<{ success: boolean; crfId?: number; message?: string }> => {
  logger.info('Creating form template', { name: data.name, userId, fieldCount: data.fields?.length || 0, status: data.status });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for existing CRF with the same name among ACTIVE forms only.
    // Archived (6), removed (5), and auto-removed (7) forms are excluded so their names can be reused.
    const nameCheck = await client.query(
      `SELECT crf_id, status_id FROM crf WHERE name = $1 AND status_id NOT IN (5, 6, 7) AND owner_id = $2 LIMIT 1`,
      [data.name, userId]
    );
    if (nameCheck.rows.length > 0) {
      const existingId = nameCheck.rows[0].crfId;
      await client.query('ROLLBACK');
      
      logger.info('Form with same name already exists among active forms', { name: data.name, existingCrfId: existingId });
      return {
        success: true,
        crfId: existingId,
        message: 'Form already exists'
      };
    }

    // Generate OC OID for CRF
    const timestamp = Date.now().toString().slice(-6);
    const ocOid = `F_${data.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24)}_${timestamp}`;

    // Check if OC OID exists
    const existsCheck = await client.query(
      `SELECT crf_id FROM crf WHERE oc_oid = $1`,
      [ocOid]
    );

    if (existsCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'A form with this name already exists'
      };
    }

    // Map frontend status to LibreClinica status_id
    // LibreClinica statuses: 1=available (published), 2=unavailable (draft), 5=removed (archived)
    const statusMap: Record<string, number> = {
      'published': 1,
      'draft': 2,
      'archived': 5
    };
    const statusId = data.status ? (statusMap[data.status] || 2) : 2; // Default to draft (2)

    // Check if category column exists in crf table
    const columnCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'crf' AND column_name = 'category'
    `);
    const hasCategoryColumn = columnCheck.rows.length > 0;

    // Insert CRF (conditionally include category column if it exists)
    // Repair sequences to prevent duplicate key constraint violations
    // from seed scripts that insert explicit IDs and hardcode setval()
    await repairSequence(client, 'crf_crf_id_seq', 'crf', 'crf_id');
    await repairSequence(client, 'crf_version_crf_version_id_seq', 'crf_version', 'crf_version_id');
    await repairSequence(client, 'item_group_item_group_id_seq', 'item_group', 'item_group_id');
    await repairSequence(client, 'item_item_id_seq', 'item', 'item_id');

    let crfResult;
    if (hasCategoryColumn) {
      crfResult = await client.query(`
        INSERT INTO crf (
          name, description, category, status_id, owner_id, date_created, oc_oid, source_study_id
        ) VALUES (
          $1, $2, $3, $4, $5, NOW(), $6, $7
        )
        RETURNING crf_id
      `, [
        data.name,
        data.description || '',
        data.category || 'other',
        statusId,
        userId,
        ocOid,
        data.studyId || null
      ]);
    } else {
      crfResult = await client.query(`
        INSERT INTO crf (
          name, description, status_id, owner_id, date_created, oc_oid, source_study_id
        ) VALUES (
          $1, $2, $3, $4, NOW(), $5, $6
        )
        RETURNING crf_id
      `, [
        data.name,
        data.description || '',
        statusId,
        userId,
        ocOid,
        data.studyId || null
      ]);
    }

    const crfId = crfResult.rows[0].crfId;

    // Create initial version with same status as CRF
    const versionOid = `${ocOid}_V1`;
    const versionResult = await client.query(`
      INSERT INTO crf_version (
        crf_id, name, description, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), $6
      )
      RETURNING crf_version_id
    `, [
      crfId,
      data.version || 'v1.0',
      data.description || 'Initial version',
      statusId,
      userId,
      versionOid
    ]);

    const crfVersionId = versionResult.rows[0].crfVersionId;

    // Create fields if provided
    if (data.fields && data.fields.length > 0) {
      // ──────────────────────────────────────────────────────────────────────
      // SECTION CREATION
      // If the frontend sent a sections[] array, create one DB section per
      // entry and build a Map<clientSectionId, dbSectionId> for field assignment.
      // If no sections array, fall back to one default section for all fields.
      // ──────────────────────────────────────────────────────────────────────
      const sectionIdMap = new Map<string, number>(); // clientId OR label → DB section_id
      const incomingSections: Array<{ id: string; name: string }> = (data as any).sections || [];

      if (incomingSections.length > 0) {
        for (let si = 0; si < incomingSections.length; si++) {
          const sec = incomingSections[si];
          const secResult = await client.query(`
            INSERT INTO section (
              crf_version_id, status_id, label, title, ordinal, owner_id, date_created
            ) VALUES (
              $1, 1, $2, $3, $4, $5, NOW()
            )
            RETURNING section_id
          `, [crfVersionId, sec.name || `Section ${si + 1}`, sec.name || data.name, si + 1, userId]);
          const dbId = secResult.rows[0].sectionId;
          // Register by both client UUID and by display name so either format resolves
          if (sec.id) sectionIdMap.set(sec.id, dbId);
          if (sec.name) sectionIdMap.set(sec.name, dbId);
          if (sec.name) sectionIdMap.set(sec.name.toLowerCase(), dbId);
        }
      }

      // Always ensure at least a default section exists (for fields with no section assignment)
      let defaultSectionId: number;
      if (sectionIdMap.size === 0) {
        const sectionResult = await client.query(`
          INSERT INTO section (
            crf_version_id, status_id, label, title, ordinal, owner_id, date_created
          ) VALUES (
            $1, 1, $2, $3, 1, $4, NOW()
          )
          RETURNING section_id
        `, [
          crfVersionId,
          data.category || 'Form Fields',
          data.name,
          userId
        ]);
        defaultSectionId = sectionResult.rows[0].sectionId;
      } else {
        defaultSectionId = sectionIdMap.values().next().value!;
      }

      const resolveSectionId = (fieldSectionRef?: string): number => {
        if (!fieldSectionRef) return defaultSectionId;
        // Try exact match (UUID or name), then lowercase name
        return sectionIdMap.get(fieldSectionRef)
          ?? sectionIdMap.get(fieldSectionRef.toLowerCase())
          ?? defaultSectionId;
      };

      // Create a default item group for the form with unique OID
      const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      const groupOid = `IG_${ocOid.substring(2, 16)}_${randomSuffix}`;
      const itemGroupResult = await client.query(`
        INSERT INTO item_group (
          name, crf_id, status_id, owner_id, date_created, oc_oid
        ) VALUES (
          $1, $2, 1, $3, NOW(), $4
        )
        RETURNING item_group_id
      `, [
        data.category || 'Form Fields',
        crfId,
        userId,
        groupOid
      ]);

      const itemGroupId = itemGroupResult.rows[0].itemGroupId;

      // Create each field as an item with full metadata
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        // Deduplicate option values to prevent radio/select binding collisions
        if (field.options && field.options.length > 0) {
          field.options = deduplicateOptionValues(field.options);
        }
        // Normalize field type ONCE via the single source of truth so every
        // downstream function (mapFieldTypeToDataType, serializeExtendedProperties,
        // mapFieldTypeToResponseType) always receives a canonical type.
        field.type = resolveFieldType(field.type);

        // Validate table fields have at least one column defined.
        // Only block save for brand-new table fields (no id yet).
        // Existing saved table fields may not carry columns in all API payloads.
        const isNewField = !field.id && !field.itemId;
        if (isTableType(field.type) && isNewField) {
          if (!Array.isArray(field.tableColumns) || field.tableColumns.length === 0) {
            throw new Error(
              `Table field "${field.label || field.name || `field #${i + 1}`}" must have at least one column defined. ` +
              `Please add columns in the form builder before saving.`
            );
          }
        } else if (isTableType(field.type) && (!Array.isArray(field.tableColumns) || field.tableColumns.length === 0)) {
          logger.warn('Saving existing table field without tableColumns — columns will be preserved from stored extended props', {
            fieldName: field.label || field.name
          });
        }

        // Validate inline_group / blood_pressure fields have inlineFields.
        // Only block for brand-new fields.
        if ((field.type === 'inline_group' || field.type === 'blood_pressure') && isNewField &&
            (!Array.isArray(field.inlineFields) || field.inlineFields.length === 0)) {
          throw new Error(
            `Inline group field "${field.label || field.name || `field #${i + 1}`}" must have at least one sub-field defined.`
          );
        }

        // Validate question_table fields have at least one question row with at least one answer column.
        if (field.type === 'question_table' && isNewField) {
          if (!Array.isArray(field.questionRows) || field.questionRows.length === 0) {
            throw new Error(
              `Question table field "${field.label || field.name || `field #${i + 1}`}" must have at least one question row defined.`
            );
          }
          const ansCols = field.answerColumns || field.questionRows[0]?.answerColumns;
          if (!Array.isArray(ansCols) || ansCols.length === 0) {
            throw new Error(
              `Question table field "${field.label || field.name || `field #${i + 1}`}" must have at least one answer column defined.`
            );
          }
        }
        // Generate unique item OID with random suffix to avoid collisions
        const itemRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
        const itemOid = `I_${ocOid.substring(2, 12)}_${i}_${itemRandom}`;
        const dataTypeId = mapFieldTypeToDataType(field.type);

        // Serialize extended properties to JSON
        const extendedProps = serializeExtendedProperties(field);
        
        // Build description with help text and extended properties
        let description = field.helpText || field.description || '';
        if (extendedProps) {
          // Store extended props as JSON at end of description, marked with special delimiter
          description = description ? `${description}\n---EXTENDED_PROPS---\n${extendedProps}` : `---EXTENDED_PROPS---\n${extendedProps}`;
        }

        // Insert item with PHI status and units
        const itemResult = await client.query(`
          INSERT INTO item (
            name, description, units, phi_status, item_data_type_id, 
            status_id, owner_id, date_created, oc_oid
          ) VALUES (
            $1, $2, $3, $4, $5, 1, $6, NOW(), $7
          )
          RETURNING item_id
        `, [
          field.label || field.name || `Field ${i + 1}`,
          description,
          field.unit || getDefaultClinicalUnit(field.type) || '',
          field.isPhiField === true, // PHI status — explicit boolean, never NULL
          dataTypeId,
          userId,
          itemOid
        ]);

        const itemId = itemResult.rows[0].itemId;

        // Ordinal is purely positional — the array order IS the visual order.
        const fieldOrdinal = i + 1;
        await client.query(`
          INSERT INTO item_group_metadata (
            item_group_id, crf_version_id, item_id, ordinal, 
            show_group, repeating_group
          ) VALUES (
            $1, $2, $3, $4, true, false
          )
        `, [
          itemGroupId,
          crfVersionId,
          itemId,
          fieldOrdinal
        ]);

        // Create response_set for fields with options (select, radio, checkbox)
        let responseSetId = 1; // Default to text response type
        if (field.options && field.options.length > 0) {
          // Use newline delimiter to avoid breaking labels that contain commas
          const optionsText = field.options.map(o => o.label).join('\n');
          const optionsValues = field.options.map(o => o.value).join('\n');
          const responseTypeId = mapFieldTypeToResponseType(field.type);

          const responseSetResult = await client.query(`
            INSERT INTO response_set (
              response_type_id, label, options_text, options_values, version_id
            ) VALUES (
              $1, $2, $3, $4, $5
            )
            RETURNING response_set_id
          `, [
            responseTypeId,
            field.label,
            optionsText,
            optionsValues,
            crfVersionId
          ]);
          responseSetId = responseSetResult.rows[0].responseSetId;
        } else {
          // Create a basic response set for non-option fields
          const responseSetResult = await client.query(`
            INSERT INTO response_set (
              response_type_id, label, version_id
            ) VALUES (
              $1, $2, $3
            )
            RETURNING response_set_id
          `, [
            mapFieldTypeToResponseType(field.type),
            field.label,
            crfVersionId
          ]);
          responseSetId = responseSetResult.rows[0].responseSetId;
        }

        // Extract validation pattern and message from validation rules
        let regexpPattern = null;
        let regexpErrorMsg = null;
        let widthDecimal = null;
        
        if (field.validationRules && field.validationRules.length > 0) {
          // Excel formula validation (new primary method)
          const formulaRule = field.validationRules.find(r => r.type === 'formula');
          if (formulaRule) {
            // Store formula with =FORMULA: prefix so backend distinguishes from regex
            regexpPattern = `=FORMULA:${formulaRule.value}`;
            regexpErrorMsg = formulaRule.message || 'Validation failed';
          }
          
          // Legacy regex pattern validation (fallback)
          if (!regexpPattern) {
            const patternRule = field.validationRules.find(r => r.type === 'pattern');
            if (patternRule) {
              regexpPattern = patternRule.value;
              regexpErrorMsg = patternRule.message || 'Invalid format';
            }
          }
          
          // Min/Max validation - build pattern if needed
          const minRule = field.validationRules.find(r => r.type === 'min');
          const maxRule = field.validationRules.find(r => r.type === 'max');
          if ((minRule || maxRule) && !regexpPattern) {
            const min = minRule?.value ?? '';
            const max = maxRule?.value ?? '';
            if (field.type === 'number' || field.type === 'integer') {
              // Store as width_decimal format: "min,max" or similar
              widthDecimal = `${min},${max}`;
            }
          }
          
          // Length validation
          const minLengthRule = field.validationRules.find(r => r.type === 'minLength');
          const maxLengthRule = field.validationRules.find(r => r.type === 'maxLength');
          if (maxLengthRule && !widthDecimal) {
            widthDecimal = maxLengthRule.value?.toString();
          }
        }
        
        // Also use field.min/max if defined directly
        if (!widthDecimal && (field.min !== undefined || field.max !== undefined)) {
          widthDecimal = `${field.min ?? ''},${field.max ?? ''}`;
        }

        // Create item_form_metadata with all field properties
        await client.query(`
          INSERT INTO item_form_metadata (
            item_id, crf_version_id, section_id, response_set_id, ordinal,
            left_item_text, required, default_value, regexp, regexp_error_msg, 
            show_item, width_decimal, column_number
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
        `, [
          itemId,
          crfVersionId,
          resolveSectionId(field.section),
          responseSetId,
          fieldOrdinal,
          field.placeholder || '',
          (resolveFieldType(field.type) !== 'section_header' && resolveFieldType(field.type) !== 'static_text') && (field.required === true || field.isRequired === true),
          field.defaultValue !== undefined ? String(field.defaultValue) : null,
          regexpPattern,
          regexpErrorMsg,
          (field.hidden !== true && field.isHidden !== true), // show_item is opposite of hidden
          widthDecimal,
          (field as any).columnPosition || (field as any).columnNumber || 1 // column_number for multi-column layout
        ]);

        logger.debug('Created form field with metadata', { 
          itemId, 
          label: field.label, 
          type: field.type,
          required: field.required,
          columnNumber: (field as any).columnPosition || (field as any).columnNumber || 1,
          hasOptions: field.options?.length || 0,
          hasValidation: field.validationRules?.length || 0
        });
      }

      // Second pass: Create scd_item_metadata (skip logic) for fields with showWhen conditions
      // This must happen after all fields are created so we can reference them
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        
        // Check if field has showWhen conditions
        if (field.showWhen && Array.isArray(field.showWhen) && field.showWhen.length > 0) {
          // Get the target item_form_metadata_id — try itemId first (stable), then name fallback.
          const targetItemId = field.itemId || (field.id ? parseInt(String(field.id), 10) : NaN);
          let targetIfmResult;
          if (!isNaN(targetItemId)) {
            targetIfmResult = await client.query(`
              SELECT ifm.item_form_metadata_id
              FROM item_form_metadata ifm
              WHERE ifm.crf_version_id = $1 AND ifm.item_id = $2
              LIMIT 1
            `, [crfVersionId, targetItemId]);
          }
          if (!targetIfmResult?.rows?.length) {
            targetIfmResult = await client.query(`
              SELECT ifm.item_form_metadata_id
              FROM item_form_metadata ifm
              INNER JOIN item i ON ifm.item_id = i.item_id
              WHERE ifm.crf_version_id = $1 AND (i.name = $2 OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2))
              LIMIT 1
            `, [crfVersionId, field.label || field.name]);
          }
          
          if (targetIfmResult.rows.length > 0) {
            const targetIfmId = targetIfmResult.rows[0].itemFormMetadataId;
            
            for (const condition of field.showWhen) {
              // Find the control item — resolve from the template fields to get itemId.
              const controlField = data.fields?.find((f: any) =>
                f.name === condition.fieldId ||
                f.label === condition.fieldId ||
                f.id === condition.fieldId ||
                (f.label && f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') === condition.fieldId)
              );
              const controlItemId = controlField?.itemId || (controlField?.id ? parseInt(String(controlField.id), 10) : NaN);

              let controlIfmResult;
              if (!isNaN(controlItemId)) {
                controlIfmResult = await client.query(`
                  SELECT ifm.item_form_metadata_id, i.name
                  FROM item_form_metadata ifm
                  INNER JOIN item i ON ifm.item_id = i.item_id
                  WHERE ifm.crf_version_id = $1 AND ifm.item_id = $2
                  LIMIT 1
                `, [crfVersionId, controlItemId]);
              }
              if (!controlIfmResult?.rows?.length) {
                controlIfmResult = await client.query(`
                  SELECT ifm.item_form_metadata_id, i.name
                  FROM item_form_metadata ifm
                  INNER JOIN item i ON ifm.item_id = i.item_id
                  WHERE ifm.crf_version_id = $1
                    AND (i.name = $2 OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2))
                  LIMIT 1
                `, [crfVersionId, condition.fieldId]);
              }
              
              const controlIfmId = controlIfmResult?.rows[0]?.itemFormMetadataId || null;
              const controlItemName = controlIfmResult?.rows[0]?.name || condition.fieldId || '';
              
              // Store operator metadata in message field as JSON so non-equals operators survive round-trip
              // SCD natively only supports equality, so we encode the operator in the message
              const scdMessage = JSON.stringify({
                operator: condition.operator || 'equals',
                message: (condition as any).message || '',
                logicalOperator: condition.logicalOperator || 'OR',
                tableCellTarget: condition.tableCellTarget || undefined
              });
              
              // Insert into scd_item_metadata (LibreClinica skip logic table)
              await client.query(`
                INSERT INTO scd_item_metadata (
                  scd_item_form_metadata_id, 
                  control_item_form_metadata_id, 
                  control_item_name, 
                  option_value, 
                  message, 
                  version
                ) VALUES ($1, $2, $3, $4, $5, 1)
              `, [
                targetIfmId,
                controlIfmId,
                controlItemName,
                condition.value || '',
                scdMessage
              ]);
              
              logger.debug('Created SCD skip logic', {
                targetField: field.label,
                controlField: condition.fieldId,
                controlItemName,
                controlIfmId,
                triggerValue: condition.value
              });
            }
          }
        }
      }

      logger.info('Created form fields with full metadata', { 
        crfId, 
        fieldCount: data.fields.length 
      });
    }

    await client.query('COMMIT');
    console.log(`[createForm] COMMIT completed for crfId=${crfId}, name="${data.name}"`);

    logger.info('Form template created successfully', { 
      crfId, 
      name: data.name,
      fieldCount: data.fields?.length || 0
    });

    // Post-COMMIT verification: confirm the form is queryable via a fresh connection
    // before returning to the caller. This closes the race window where the frontend
    // fires GET /api/forms before the committed row is visible on a new connection.
    let verified = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const verifyResult = await pool.query(
        `SELECT crf_id, status_id, name FROM crf WHERE crf_id = $1`,
        [crfId]
      );
      if (verifyResult.rows.length > 0) {
        console.log(`[createForm] Post-COMMIT verification PASSED on attempt ${attempt} — crfId=${crfId} is visible`);
        verified = true;
        break;
      }
      console.warn(`[createForm] Post-COMMIT verification attempt ${attempt} FAILED — crfId=${crfId} not yet visible, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 150 * attempt));
    }
    if (!verified) {
      console.error(`[createForm] Post-COMMIT verification FAILED after 3 attempts — crfId=${crfId} may not appear in listings immediately`);
    }

    // Track document creation in audit trail (21 CFR Part 11)
    try {
      await trackUserAction({
        userId,
        username: '', // Will be populated from user context
        action: 'FORM_CREATED',
        entityType: 'crf',
        entityId: crfId,
        entityName: data.name,
        details: `Created form template "${data.name}" with ${data.fields?.length || 0} fields`
      });
    } catch (auditError: any) {
      logger.warn('Failed to record form creation audit', { error: auditError.message });
    }

    return {
      success: true,
      crfId,
      message: `Form template created successfully with ${data.fields?.length || 0} fields`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create form error', { error: error.message });

    return {
      success: false,
      message: `Failed to create form: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update a form template with fields
 */
export const updateForm = async (
  crfId: number,
  data: {
    name?: string;
    description?: string;
    status?: 'draft' | 'published' | 'archived';
    fields?: FormField[];
    category?: string;
    version?: string;
    partialFieldUpdate?: boolean;
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating form template', { crfId, data: { ...data, fields: data.fields?.length || 0 }, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update basic CRF info
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(data.description);
    }

    // Handle status changes - map frontend status to LibreClinica status_id
    if (data.status) {
      const statusMap: Record<string, number> = {
        'published': 1,  // available
        'draft': 2,      // unavailable
        'archived': 5    // removed
      };
      const statusId = statusMap[data.status];
      if (statusId) {
        updates.push(`status_id = $${paramIndex++}`);
        params.push(statusId);
        logger.info('Updating form status', { crfId, status: data.status, statusId });
      }
    }

    // Update category if provided AND if column exists
    if (data.category !== undefined) {
      // Check if category column exists
      const columnCheck = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'crf' AND column_name = 'category'
      `);
      if (columnCheck.rows.length > 0) {
        updates.push(`category = $${paramIndex++}`);
        params.push(data.category || 'other');
        logger.info('Updating form category', { crfId, category: data.category });
      } else {
        logger.info('Skipping category update - column does not exist', { crfId });
      }
    }

    // Update version name in crf_version if provided
    if (data.version) {
      try {
        await client.query(`
          UPDATE crf_version SET name = $1, date_updated = NOW()
          WHERE crf_version_id = (
            SELECT crf_version_id FROM crf_version
            WHERE crf_id = $2 ORDER BY crf_version_id DESC LIMIT 1
          )
        `, [data.version, crfId]);
        logger.info('Updated crf_version name', { crfId, version: data.version });
      } catch (versionErr: any) {
        logger.warn('Could not update crf_version name', { error: versionErr.message });
      }
    }

    updates.push(`date_updated = NOW()`);
    updates.push(`update_id = $${paramIndex++}`);
    params.push(userId);

    params.push(crfId);

    if (updates.length > 2) { // More than just date_updated and update_id
      const query = `
        UPDATE crf
        SET ${updates.join(', ')}
        WHERE crf_id = $${paramIndex}
      `;
      await client.query(query, params);
    }

    // Update fields if provided
    if (data.fields && data.fields.length > 0) {
      logger.info('Updating form fields', { crfId, fieldCount: data.fields.length });

      // Repair sequences that might be out of sync from seed data
      await repairSequence(client, 'item_group_item_group_id_seq', 'item_group', 'item_group_id');
      await repairSequence(client, 'item_item_id_seq', 'item', 'item_id');

      // Get the latest version
      const versionResult = await client.query(`
        SELECT crf_version_id FROM crf_version
        WHERE crf_id = $1
        ORDER BY crf_version_id DESC
        LIMIT 1
      `, [crfId]);

      if (versionResult.rows.length === 0) {
        throw new Error('No version found for this form');
      }

      const crfVersionId = versionResult.rows[0].crfVersionId;

      // ──────────────────────────────────────────────────────────────────────
      // SECTION SYNC for updateForm
      // Sync incoming sections[] to DB sections for this crf_version.
      // Build a clientSectionId → dbSectionId map for field assignment.
      // ──────────────────────────────────────────────────────────────────────
      const sectionIdMap = new Map<string, number>(); // clientId OR label → DB section_id
      const incomingSections: Array<{ id: string; name: string }> = (data as any).sections || [];

      // Load existing DB sections for this version
      const existingSecResult = await client.query(`
        SELECT section_id, label, ordinal FROM section WHERE crf_version_id = $1 ORDER BY ordinal
      `, [crfVersionId]);

      if (incomingSections.length > 0) {
        // Build dual-key lookup: by label (for existing data) and by section_id (future-proof)
        const existingSecByLabel = new Map(existingSecResult.rows.map((r: any) => [r.label, r.sectionId]));
        const existingSecByLabelLower = new Map(existingSecResult.rows.map((r: any) => [r.label?.toLowerCase(), r.sectionId]));
        const existingSecIds = existingSecResult.rows.map((r: any) => r.sectionId);
        const usedDbSectionIds = new Set<number>();

        for (let si = 0; si < incomingSections.length; si++) {
          const sec = incomingSections[si];
          // Match by label (exact) or by label (case-insensitive) — renames create new sections
          const existingDbId = existingSecByLabel.get(sec.name)
            ?? existingSecByLabelLower.get(sec.name?.toLowerCase());
          if (existingDbId) {
            // Register by both client id and name for resolveSectionId()
            if (sec.id) sectionIdMap.set(sec.id, existingDbId);
            if (sec.name) sectionIdMap.set(sec.name, existingDbId);
            if (sec.name) sectionIdMap.set(sec.name.toLowerCase(), existingDbId);
            usedDbSectionIds.add(existingDbId);
            // Update ordinal if it changed
            await client.query(
              `UPDATE section SET ordinal = $1 WHERE section_id = $2`,
              [si + 1, existingDbId]
            );
          } else {
            const newSecResult = await client.query(`
              INSERT INTO section (
                crf_version_id, status_id, label, title, ordinal, owner_id, date_created
              ) VALUES ($1, 1, $2, $3, $4, $5, NOW())
              RETURNING section_id
            `, [crfVersionId, sec.name || `Section ${si + 1}`, sec.name || 'Form', si + 1, userId]);
            const newDbId = newSecResult.rows[0].sectionId;
            if (sec.id) sectionIdMap.set(sec.id, newDbId);
            if (sec.name) sectionIdMap.set(sec.name, newDbId);
            if (sec.name) sectionIdMap.set(sec.name.toLowerCase(), newDbId);
            usedDbSectionIds.add(newDbId);
          }
        }
        // Reassign items from removed sections to the first remaining section before deleting
        const fallbackSectionId: number | undefined = usedDbSectionIds.values().next().value;
        if (fallbackSectionId === undefined) {
          throw new Error('Cannot reassign orphaned items: no used sections remain after sync');
        }
        for (const oldSecId of existingSecIds) {
          if (!usedDbSectionIds.has(oldSecId)) {
            await client.query(
              `UPDATE item_form_metadata SET section_id = $1 WHERE section_id = $2 AND crf_version_id = $3`,
              [fallbackSectionId, oldSecId, crfVersionId]
            );
            await client.query(`DELETE FROM section WHERE section_id = $1`, [oldSecId]);
          }
        }
      }

      // Ensure at least one section exists
      let defaultSectionId: number;
      if (sectionIdMap.size === 0) {
        if (existingSecResult.rows.length > 0) {
          defaultSectionId = existingSecResult.rows[0].sectionId;
        } else {
          const newSectionResult = await client.query(`
            INSERT INTO section (
              crf_version_id, status_id, label, title, ordinal, owner_id, date_created
            ) VALUES (
              $1, 1, $2, $3, 1, $4, NOW()
            )
            RETURNING section_id
          `, [crfVersionId, data.category || 'Form Fields', data.name || 'Form', userId]);
          defaultSectionId = newSectionResult.rows[0].sectionId;
        }
      } else {
        defaultSectionId = sectionIdMap.values().next().value!;
      }

      const resolveSectionId = (fieldSectionRef?: string): number => {
        if (!fieldSectionRef) return defaultSectionId;
        return sectionIdMap.get(fieldSectionRef)
          ?? sectionIdMap.get(fieldSectionRef.toLowerCase())
          ?? defaultSectionId;
      };

      // Get existing item group or create one
      let itemGroupResult = await client.query(`
        SELECT ig.item_group_id FROM item_group ig
        INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
        WHERE igm.crf_version_id = $1
        LIMIT 1
      `, [crfVersionId]);

      let itemGroupId: number;
      if (itemGroupResult.rows.length === 0) {
        // Get CRF OID for generating item group OID
        const crfOidResult = await client.query(`SELECT oc_oid FROM crf WHERE crf_id = $1`, [crfId]);
        const crfOid = crfOidResult.rows[0]?.ocOid || `CRF_${crfId}`;
        const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
        const groupOid = `IG_${crfOid.substring(2, 16)}_${randomSuffix}`;
        
        const newGroupResult = await client.query(`
          INSERT INTO item_group (
            name, crf_id, status_id, owner_id, date_created, oc_oid
          ) VALUES (
            $1, $2, 1, $3, NOW(), $4
          )
          RETURNING item_group_id
        `, [data.category || 'Form Fields', crfId, userId, groupOid]);
        itemGroupId = newGroupResult.rows[0].itemGroupId;
      } else {
        itemGroupId = itemGroupResult.rows[0].itemGroupId;
      }

      // Get existing items for this form — keyed by item_id for stable matching
      // (name-based matching breaks when users rename field labels)
      // Include ALL items (even soft-deleted ones) so re-adding a field doesn't create
      // a duplicate item row — if a field was deleted and re-added we can un-hide it.
      const existingItemsResult = await client.query(`
        SELECT i.item_id, i.name, i.oc_oid, i.description, i.phi_status, i.units,
               ifm.show_item, ifm.required
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1
        WHERE igm.crf_version_id = $1
      `, [crfVersionId]);

      // Primary lookup by item_id (stable). No name-based fallback — fields with
      // the same label must not collide. If a field has no valid item_id it is new.
      const existingItemsById = new Map(existingItemsResult.rows.map(row => [row.itemId, row]));

      // ──────────────────────────────────────────────────────────────────────
      // COLUMN ID / ROW SNAPSHOT — capture current structure for table fields
      // BEFORE saving so we can detect column/row deletions and cascade to
      // validation rules (auto-delete rules targeting removed columns/rows).
      // ──────────────────────────────────────────────────────────────────────
      const preUpdateStructure = new Map<number, { answerColumns?: any[]; questionRows?: any[]; tableColumns?: any[] }>();
      for (const [itemId, item] of existingItemsById) {
        if (!item.description) continue;
        const ext = parseExtendedProps(item.description);
        if (ext.answerColumns || ext.questionRows || ext.tableColumns) {
          // For legacy data without top-level answerColumns, extract from row 0
          const answerCols = ext.answerColumns
            || (ext.questionRows?.[0]?.answerColumns)
            || undefined;
          preUpdateStructure.set(itemId, {
            answerColumns: answerCols,
            questionRows: ext.questionRows,
            tableColumns: ext.tableColumns,
          });
        }
      }

      // Get CRF OID for generating item OIDs
      const crfOidResult = await client.query(`SELECT oc_oid FROM crf WHERE crf_id = $1`, [crfId]);
      const ocOid = crfOidResult.rows[0]?.ocOid || `CRF_${crfId}`;

      // Track which existing item_ids were matched so we can soft-delete the rest
      const matchedItemIds = new Set<number>();

      // Process each field
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        // Deduplicate option values to prevent radio/select binding collisions
        if (field.options && field.options.length > 0) {
          field.options = deduplicateOptionValues(field.options);
        }
        // Normalize field type via the single source of truth before any save
        field.type = resolveFieldType(field.type);
        const fieldName = field.label || field.name || `Field ${i + 1}`;

        // Validate table/inline_group fields — only block for genuinely new fields.
        // Existing fields loaded from the DB may not carry tableColumns/inlineFields
        // in all API payloads; their columns are preserved from stored extended props.
        const fieldItemId = field.id ? parseInt(String(field.id), 10) : NaN;
        const isNewField = isNaN(fieldItemId) && !field.itemId;

        // Ordinal is purely positional — the array order the frontend sent IS the visual order.
        // Never trust field.order; always use the loop index.
        const fieldOrdinal = i + 1;

        if (isTableType(field.type) && isNewField) {
          if (!Array.isArray(field.tableColumns) || field.tableColumns.length === 0) {
            throw new Error(
              `Table field "${fieldName}" must have at least one column defined. ` +
              `Please add columns in the form builder before saving.`
            );
          }
        } else if (isTableType(field.type) && (!Array.isArray(field.tableColumns) || field.tableColumns.length === 0)) {
          logger.warn('Updating existing table field without tableColumns — preserved from stored props', { fieldName });
        }

        if ((field.type === 'inline_group' || field.type === 'blood_pressure') && isNewField &&
            (!Array.isArray(field.inlineFields) || field.inlineFields.length === 0)) {
          throw new Error(
            `Inline group field "${fieldName}" must have at least one sub-field defined.`
          );
        }

        // Match by item_id only — name-based matching causes corruption when
        // two fields share the same label. No valid item_id = genuinely new field.
        let existingItem = !isNaN(fieldItemId) ? existingItemsById.get(fieldItemId) : undefined;
        
        // When a partial update (e.g. branching-config) omits `required`, preserve
        // the existing DB value instead of defaulting to false.
        // Detect partial updates: if the payload is missing most extended properties
        // (e.g. only has id/name/label/type/required/showWhen), treat it as partial
        // so we merge with existing DB data instead of overwriting.
        const hasExtendedProps = field.helpText !== undefined || field.isPhiField !== undefined 
          || field.calculationFormula !== undefined || field.tableColumns !== undefined 
          || field.width !== undefined || field.staticContent !== undefined
          || field.allowedFileTypes !== undefined || field.customAttributes !== undefined;
        const isPartialUpdate = !hasExtendedProps && existingItem?.description;
        let resolvedRequired: boolean;
        if (isPartialUpdate && existingItem && field.required === undefined && field.isRequired === undefined) {
          resolvedRequired = existingItem.required === true;
        } else {
          resolvedRequired = field.required === true || field.isRequired === true;
        }
        // Layout-only types are never required regardless of what was sent or stored
        const ct = resolveFieldType(field.type);
        if (ct === 'section_header' || ct === 'static_text') {
          resolvedRequired = false;
        }
        // Stamp the resolved value back onto the field object so
        // serializeExtendedProperties also picks it up.
        field.required = resolvedRequired;

        // For partial updates, preserve the existing description/helpText when not provided.
        // This prevents branching-config saves (which only send id/name/label/type/showWhen)
        // from wiping out extended props like table columns, validation, etc.
        // However, if the field TYPE has changed, do a full overwrite (no merge)
        // to avoid carrying stale type-specific properties (e.g. old dropdown options
        // persisting after switching to text).
        let mergedField: any = field;
        let preservedHelpText = '';
        if (isPartialUpdate && existingItem?.description) {
          const existingExtended = parseExtendedProps(existingItem.description);
          const storedType = existingExtended?.type;
          const typeChanged = storedType && storedType !== field.type;

          if (typeChanged) {
            // Type changed — full overwrite, don't merge old type-specific props
            preservedHelpText = stripExtendedProps(existingItem.description);
            mergedField = field;
          } else {
            preservedHelpText = stripExtendedProps(existingItem.description);
            if (existingExtended && Object.keys(existingExtended).length > 0) {
              mergedField = { ...existingExtended, ...stripUndefined(field) };
            }
          }
        } else if (!isPartialUpdate && existingItem?.description) {
          // Full update (all fields provided) — still merge to preserve any props
          // not included in the payload, but let incoming values take precedence.
          const existingExtended = parseExtendedProps(existingItem.description);
          const storedType = existingExtended?.type;
          if (storedType && storedType !== field.type) {
            // Type changed — full overwrite
            preservedHelpText = stripExtendedProps(existingItem.description);
            mergedField = field;
          } else if (existingExtended && Object.keys(existingExtended).length > 0) {
            // Same type — merge existing props under incoming values
            preservedHelpText = stripExtendedProps(existingItem.description);
            mergedField = { ...existingExtended, ...stripUndefined(field) };
          }
        }

        // Serialize extended properties
        const extendedProps = serializeExtendedProperties(mergedField);
        // For full updates (user explicitly provided helpText/description), respect
        // empty strings — don't fall back to old preservedHelpText.
        // Only use preservedHelpText as fallback for partial updates where the
        // user didn't send helpText at all (undefined).
        let description: string;
        if (isPartialUpdate) {
          description = mergedField.helpText ?? mergedField.description ?? preservedHelpText ?? '';
        } else {
          // Full update: use exactly what the user sent (empty string = cleared)
          const incoming = field.helpText ?? field.description ?? '';
          description = incoming;
        }
        if (extendedProps) {
          description = description ? `${description}\n---EXTENDED_PROPS---\n${extendedProps}` : `---EXTENDED_PROPS---\n${extendedProps}`;
        }

        const dataTypeId = mapFieldTypeToDataType(field.type);

        let itemId: number;

        if (existingItem) {
          // Update existing item — also update the name in case the label changed
          // Preserve phi_status if not explicitly provided (partial update)
          const resolvedPhi = field.isPhiField !== undefined ? (field.isPhiField === true) : existingItem.phiStatus;
          await client.query(`
            UPDATE item
            SET name = $1, description = $2, units = $3, phi_status = $4, item_data_type_id = $5, date_updated = NOW()
            WHERE item_id = $6
          `, [fieldName, description, field.unit !== undefined ? (field.unit || '') : (existingItem.units || ''), resolvedPhi, dataTypeId, existingItem.itemId]);
          itemId = existingItem.itemId;
          matchedItemIds.add(itemId); // Mark as still present
        } else {
          // Create new item
          const itemRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
          const itemOid = `I_${ocOid.substring(2, 12)}_${i}_${itemRandom}`;

          const newItemResult = await client.query(`
            INSERT INTO item (
              name, description, units, phi_status, item_data_type_id,
              status_id, owner_id, date_created, oc_oid
            ) VALUES (
              $1, $2, $3, $4, $5, 1, $6, NOW(), $7
            )
            RETURNING item_id
          `, [fieldName, description, field.unit || '', field.isPhiField === true, dataTypeId, userId, itemOid]);
          itemId = newItemResult.rows[0].itemId;
          matchedItemIds.add(itemId);

          // Link to item group
          await client.query(`
            INSERT INTO item_group_metadata (
              item_group_id, crf_version_id, item_id, ordinal, show_group, repeating_group
            ) VALUES (
              $1, $2, $3, $4, true, false
            )
          `, [itemGroupId, crfVersionId, itemId, fieldOrdinal]);
        }

        // Handle response set - ALWAYS create one for every field
        let responseSetId: number;
        const responseTypeId = mapFieldTypeToResponseType(field.type);
        
        // Check for existing response set from item_form_metadata
        const existingRsResult = await client.query(`
          SELECT response_set_id FROM item_form_metadata
          WHERE item_id = $1 AND crf_version_id = $2
        `, [itemId, crfVersionId]);

        if (existingRsResult.rows.length > 0 && existingRsResult.rows[0].responseSetId) {
          // Decide whether to write, clear, or preserve options.
          //
          // Key distinction in JSON payloads:
          //   field.options = undefined  → key was omitted → PRESERVE existing options
          //   field.options = []         → explicitly emptied → CLEAR options
          //   field.options = [{...}]    → new values → WRITE them
          //
          // Additionally, when the type changes FROM an option type TO a non-option type,
          // always clear stale options regardless of what was sent.
          const optionTypes = ['select', 'radio', 'checkbox', 'combobox', 'yesno'];
          const fieldNeedsOptions = optionTypes.includes(field.type);
          let storedType: string | undefined;
          if (existingItem?.description) {
            const ep = parseExtendedProps(existingItem.description);
            storedType = ep?.type;
          }
          const typeChangedAwayFromOptions = storedType
            && optionTypes.includes(storedType)
            && !fieldNeedsOptions;
          const optionsWereExplicitlySent = Array.isArray(field.options);

          if (field.options && field.options.length > 0) {
            // Case 1: New options provided — write them
            const optionsText = field.options.map((o: any) => o.label).join('\n');
            const optionsValues = field.options.map((o: any) => o.value).join('\n');
            await client.query(`
              UPDATE response_set
              SET options_text = $1, options_values = $2, response_type_id = $3
              WHERE response_set_id = $4
            `, [optionsText, optionsValues, responseTypeId, existingRsResult.rows[0].responseSetId]);
          } else if (typeChangedAwayFromOptions) {
            // Case 2: Type changed from option-type to non-option-type — clear stale options
            await client.query(`
              UPDATE response_set
              SET options_text = NULL, options_values = NULL, response_type_id = $1
              WHERE response_set_id = $2
            `, [responseTypeId, existingRsResult.rows[0].responseSetId]);
          } else if (optionsWereExplicitlySent && field.options.length === 0) {
            // Case 3: Caller explicitly sent options:[] — clear options
            // This covers: user deleted all options from a dropdown, or non-option type cleanup
            await client.query(`
              UPDATE response_set
              SET options_text = NULL, options_values = NULL, response_type_id = $1
              WHERE response_set_id = $2
            `, [responseTypeId, existingRsResult.rows[0].responseSetId]);
          } else {
            // Case 4: Options key was omitted (undefined) — preserve existing options,
            // only update the response_type_id
            await client.query(`
              UPDATE response_set
              SET response_type_id = $1
              WHERE response_set_id = $2
            `, [responseTypeId, existingRsResult.rows[0].responseSetId]);
          }
          responseSetId = existingRsResult.rows[0].responseSetId;
        } else {
          // Create new response set (required for all fields, not just option fields)
          if (field.options && field.options.length > 0) {
            // Use newline delimiter to avoid breaking labels that contain commas
            const optionsText = field.options.map((o: any) => o.label).join('\n');
            const optionsValues = field.options.map((o: any) => o.value).join('\n');
            const rsResult = await client.query(`
              INSERT INTO response_set (response_type_id, label, options_text, options_values, version_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING response_set_id
            `, [responseTypeId, field.label, optionsText, optionsValues, crfVersionId]);
            responseSetId = rsResult.rows[0].responseSetId;
          } else {
            // Create basic response set for non-option fields
            const rsResult = await client.query(`
              INSERT INTO response_set (response_type_id, label, version_id)
              VALUES ($1, $2, $3)
              RETURNING response_set_id
            `, [responseTypeId, field.label || 'Field', crfVersionId]);
            responseSetId = rsResult.rows[0].responseSetId;
          }
        }

        // Extract validation pattern
        let regexpPattern = null;
        let regexpErrorMsg = null;
        let widthDecimal = null;
        
        if (field.validationRules && field.validationRules.length > 0) {
          // Excel formula validation (new primary method)
          const formulaRule = field.validationRules.find(r => r.type === 'formula');
          if (formulaRule) {
            regexpPattern = `=FORMULA:${formulaRule.value}`;
            regexpErrorMsg = formulaRule.message || 'Validation failed';
          }
          
          // Legacy regex pattern validation (fallback)
          if (!regexpPattern) {
            const patternRule = field.validationRules.find(r => r.type === 'pattern');
            if (patternRule) {
              regexpPattern = patternRule.value;
              regexpErrorMsg = patternRule.message || 'Invalid format';
            }
          }
          
          const minRule = field.validationRules.find(r => r.type === 'min');
          const maxRule = field.validationRules.find(r => r.type === 'max');
          if (minRule || maxRule) {
            widthDecimal = `${minRule?.value ?? ''},${maxRule?.value ?? ''}`;
          }
        }
        
        if (!widthDecimal && (field.min !== undefined || field.max !== undefined)) {
          widthDecimal = `${field.min ?? ''},${field.max ?? ''}`;
        }


        // Keep item_group_metadata.ordinal in sync so COALESCE(ifm.ordinal, igm.ordinal) is consistent
        await client.query(`
          UPDATE item_group_metadata SET ordinal = $1
          WHERE item_id = $2 AND crf_version_id = $3
        `, [fieldOrdinal, itemId, crfVersionId]);

        // Update or create item_form_metadata
        const existingMetaResult = await client.query(`
          SELECT 1 FROM item_form_metadata WHERE item_id = $1 AND crf_version_id = $2
        `, [itemId, crfVersionId]);

        // Resolve column_number from field data (mirrors createForm logic)
        const columnNumber = (field as any).columnPosition || (field as any).columnNumber || 1;

        if (existingMetaResult.rows.length > 0) {
          await client.query(`
            UPDATE item_form_metadata
            SET response_set_id = $1, ordinal = $2, left_item_text = $3, required = $4,
                default_value = $5, regexp = $6, regexp_error_msg = $7, show_item = $8, width_decimal = $9,
                column_number = $10, section_id = $11
            WHERE item_id = $12 AND crf_version_id = $13
          `, [
            responseSetId, fieldOrdinal, field.placeholder || '',
            resolvedRequired,
            field.defaultValue !== undefined ? String(field.defaultValue) : null,
            regexpPattern, regexpErrorMsg,
            field.hidden !== true && field.isHidden !== true,
            widthDecimal,
            columnNumber,
            resolveSectionId(field.section),
            itemId, crfVersionId
          ]);
        } else {
          await client.query(`
            INSERT INTO item_form_metadata (
              item_id, crf_version_id, section_id, response_set_id, ordinal,
              left_item_text, required, default_value, regexp, regexp_error_msg, show_item, width_decimal,
              column_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `, [
            itemId, crfVersionId, resolveSectionId(field.section), responseSetId, fieldOrdinal,
            field.placeholder || '', resolvedRequired,
            field.defaultValue !== undefined ? String(field.defaultValue) : null,
            regexpPattern, regexpErrorMsg,
            field.hidden !== true && field.isHidden !== true,
            widthDecimal,
            columnNumber
          ]);
        }
      }

      // Soft-delete items that were NOT in the incoming field list.
      // Any existing item whose item_id is not in matchedItemIds was removed by the user.
      // SKIP for partial updates (e.g. branching-config) that only send a subset of fields.
      if (!data.partialFieldUpdate) {
        for (const [itemIdKey, item] of existingItemsById) {
          if (!matchedItemIds.has(itemIdKey)) {
            logger.info('Hiding removed field', { itemId: item.itemId, name: item.name });
            await client.query(`
              UPDATE item_form_metadata SET show_item = false
              WHERE item_id = $1 AND crf_version_id = $2
            `, [item.itemId, crfVersionId]);
          }
        }
      }

      // ========================================
      // SCD (Skip Logic) - Delete old and recreate
      // ========================================

      // Pre-fill showWhen from existing SCD records for fields that don't have it,
      // so partial updates (e.g. saving just field values) don't wipe branching rules.
      const existingScdResult = await client.query(`
        SELECT 
          scd.scd_item_form_metadata_id AS target_ifm_id,
          scd.control_item_form_metadata_id AS control_ifm_id,
          scd.control_item_name,
          scd.option_value,
          scd.message,
          target_item.item_id AS target_item_id,
          target_item.name AS target_item_name,
          control_item.item_id AS control_item_id
        FROM scd_item_metadata scd
        INNER JOIN item_form_metadata target_ifm ON scd.scd_item_form_metadata_id = target_ifm.item_form_metadata_id
        INNER JOIN item target_item ON target_ifm.item_id = target_item.item_id
        LEFT JOIN item_form_metadata control_ifm ON scd.control_item_form_metadata_id = control_ifm.item_form_metadata_id
        LEFT JOIN item control_item ON control_ifm.item_id = control_item.item_id
        WHERE target_ifm.crf_version_id = $1
      `, [crfVersionId]);

      // Build a map: target_item_id -> showWhen conditions from existing DB
      const existingScdMap = new Map<number, any[]>();
      for (const row of existingScdResult.rows) {
        const conditions = existingScdMap.get(row.targetItemId) || [];
        let operator = 'equals';
        let message = '';
        let logicalOperator = 'OR';
        let tableCellTarget = undefined;
        try {
          const parsed = JSON.parse(row.message || '{}');
          operator = parsed.operator || 'equals';
          message = parsed.message || '';
          logicalOperator = parsed.logicalOperator || 'OR';
          tableCellTarget = parsed.tableCellTarget || undefined;
        } catch { /* not JSON, ignore */ }
        conditions.push({
          fieldId: row.controlItemName,
          value: row.optionValue || '',
          operator,
          message,
          logicalOperator,
          tableCellTarget
        });
        existingScdMap.set(row.targetItemId, conditions);
      }

      // For each incoming field missing showWhen, restore from existing DB
      for (const field of data.fields) {
        if (!field.showWhen || !Array.isArray(field.showWhen) || field.showWhen.length === 0) {
          const fieldItemId = field.itemId || (field.id ? parseInt(String(field.id), 10) : NaN);
          if (!isNaN(fieldItemId) && existingScdMap.has(fieldItemId)) {
            field.showWhen = existingScdMap.get(fieldItemId);
          } else {
            // Try matching by name/label
            const fieldName = field.label || field.name || '';
            for (const [targetId, conditions] of existingScdMap) {
              const matchingExisting = Array.from(existingItemsById.values()).find(
                (ei: any) => ei.item_id === targetId && (ei.name === fieldName || ei.name === fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
              );
              if (matchingExisting) {
                field.showWhen = conditions;
                break;
              }
            }
          }
        }
      }

      // Collect the item_form_metadata_ids of fields that ARE in the incoming payload
      // so we only delete/recreate SCD records for those fields — preserving rules
      // for fields NOT in the payload (critical for partial updates like branching-config).
      const incomingIfmIds: number[] = [];
      for (const field of data.fields) {
        const fieldItemId = field.itemId || (field.id ? parseInt(String(field.id), 10) : NaN);
        let ifmResult;
        if (!isNaN(fieldItemId)) {
          ifmResult = await client.query(`
            SELECT ifm.item_form_metadata_id
            FROM item_form_metadata ifm
            WHERE ifm.crf_version_id = $1 AND ifm.item_id = $2
            LIMIT 1
          `, [crfVersionId, fieldItemId]);
        }
        if (!ifmResult?.rows?.length) {
          ifmResult = await client.query(`
            SELECT ifm.item_form_metadata_id
            FROM item_form_metadata ifm
            INNER JOIN item i ON ifm.item_id = i.item_id
            WHERE ifm.crf_version_id = $1 AND (i.name = $2 OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2))
            LIMIT 1
          `, [crfVersionId, field.label || field.name]);
        }
        if (ifmResult?.rows?.length) {
          incomingIfmIds.push(ifmResult.rows[0].itemFormMetadataId);
        }
      }

      // Delete SCD records ONLY for fields in the incoming payload.
      // Fields not in the payload keep their existing rules intact.
      if (incomingIfmIds.length > 0) {
        await client.query(`
          DELETE FROM scd_item_metadata 
          WHERE scd_item_form_metadata_id = ANY($1::int[])
        `, [incomingIfmIds]);
      }
      
      // Recreate SCD records from updated showWhen conditions
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        
        if (field.showWhen && Array.isArray(field.showWhen) && field.showWhen.length > 0) {
          // Get the target item_form_metadata_id for this field.
          // Try itemId first (stable), then fall back to name matching.
          const targetItemId = field.itemId || (field.id ? parseInt(String(field.id), 10) : NaN);
          let targetIfmResult;
          if (!isNaN(targetItemId)) {
            targetIfmResult = await client.query(`
              SELECT ifm.item_form_metadata_id
              FROM item_form_metadata ifm
              WHERE ifm.crf_version_id = $1 AND ifm.item_id = $2
              LIMIT 1
            `, [crfVersionId, targetItemId]);
          }
          if (!targetIfmResult?.rows?.length) {
            targetIfmResult = await client.query(`
              SELECT ifm.item_form_metadata_id
              FROM item_form_metadata ifm
              INNER JOIN item i ON ifm.item_id = i.item_id
              WHERE ifm.crf_version_id = $1 AND (i.name = $2 OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2))
              LIMIT 1
            `, [crfVersionId, field.label || field.name]);
          }
          
          if (targetIfmResult.rows.length > 0) {
            const targetIfmId = targetIfmResult.rows[0].itemFormMetadataId;
            
            for (const condition of field.showWhen) {
              // Find the control item's item_form_metadata_id.
              // condition.fieldId may be an itemId (numeric), a label, or a snake_case name.
              // Try by itemId of the matching template field first, then search DB directly.
              const controlField = data.fields?.find((f: any) =>
                f.name === condition.fieldId ||
                f.label === condition.fieldId ||
                f.id === condition.fieldId ||
                (f.label && f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') === condition.fieldId)
              );
              const controlItemId = controlField?.itemId || (controlField?.id ? parseInt(String(controlField.id), 10) : NaN);

              let controlIfmResult;
              if (!isNaN(controlItemId)) {
                controlIfmResult = await client.query(`
                  SELECT ifm.item_form_metadata_id, i.name
                  FROM item_form_metadata ifm
                  INNER JOIN item i ON ifm.item_id = i.item_id
                  WHERE ifm.crf_version_id = $1 AND ifm.item_id = $2
                  LIMIT 1
                `, [crfVersionId, controlItemId]);
              }
              if (!controlIfmResult?.rows?.length) {
                controlIfmResult = await client.query(`
                  SELECT ifm.item_form_metadata_id, i.name
                  FROM item_form_metadata ifm
                  INNER JOIN item i ON ifm.item_id = i.item_id
                  WHERE ifm.crf_version_id = $1
                    AND (i.name = $2 OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2))
                  LIMIT 1
                `, [crfVersionId, condition.fieldId]);
              }
              
              const controlIfmId = controlIfmResult?.rows[0]?.itemFormMetadataId || null;
              const controlItemName = controlIfmResult?.rows[0]?.name || condition.fieldId || '';
              
              // Store full condition metadata in message as JSON so SCD fallback
              // preserves logicalOperator, tableCellTarget, and other fields.
              const scdMessage = JSON.stringify({
                operator: condition.operator || 'equals',
                message: (condition as any).message || '',
                logicalOperator: condition.logicalOperator || 'OR',
                tableCellTarget: condition.tableCellTarget || undefined
              });
              
              await client.query(`
                INSERT INTO scd_item_metadata (
                  scd_item_form_metadata_id, 
                  control_item_form_metadata_id, 
                  control_item_name, 
                  option_value, 
                  message, 
                  version
                ) VALUES ($1, $2, $3, $4, $5, 1)
              `, [
                targetIfmId,
                controlIfmId,
                controlItemName,
                condition.value || '',
                scdMessage
              ]);
            }
          }
        }
      }

      logger.info('Form fields updated', { crfId, fieldCount: data.fields.length });

      // ──────────────────────────────────────────────────────────────────────
      // CASCADE: DELETE RULES FOR REMOVED COLUMNS/ROWS, REMAP CHANGED IDS
      // ──────────────────────────────────────────────────────────────────────
      if (preUpdateStructure.size > 0) {
        try {
          await client.query('SAVEPOINT cascade_column_ids');

          for (const [itemId, oldData] of preUpdateStructure) {
            const updatedItemResult = await client.query(
              `SELECT description FROM item WHERE item_id = $1`, [itemId]
            );
            if (updatedItemResult.rows.length === 0) continue;
            const newExt = parseExtendedProps(updatedItemResult.rows[0].description);

            // Build sets of current column IDs and row IDs
            const newColIds = new Set<string>();
            const newRowIds = new Set<string>();

            // Question table: answerColumns at top level (new structure)
            const newAnsCols = newExt.answerColumns || [];
            if (Array.isArray(newAnsCols)) {
              for (const col of newAnsCols) if (col.id) newColIds.add(col.id);
            }
            if (Array.isArray(newExt.questionRows)) {
              for (const row of newExt.questionRows) if (row.id) newRowIds.add(row.id);
            }

            // Data table: tableColumns
            if (Array.isArray(newExt.tableColumns)) {
              for (const col of newExt.tableColumns) {
                const key = col.key || col.name || col.id;
                if (key) newColIds.add(key);
              }
            }

            // Build sets of old column IDs and row IDs
            const oldColIds = new Set<string>();
            const oldRowIds = new Set<string>();
            if (Array.isArray(oldData.answerColumns)) {
              for (const col of oldData.answerColumns) if (col.id) oldColIds.add(col.id);
            }
            if (Array.isArray(oldData.questionRows)) {
              for (const row of oldData.questionRows) if (row.id) oldRowIds.add(row.id);
            }
            if (Array.isArray(oldData.tableColumns)) {
              for (const col of oldData.tableColumns) {
                const key = col.key || col.name || col.id;
                if (key) oldColIds.add(key);
              }
            }

            // Find removed columns and rows
            const removedColIds = [...oldColIds].filter(id => !newColIds.has(id));
            const removedRowIds = [...oldRowIds].filter(id => !newRowIds.has(id));

            if (removedColIds.length === 0 && removedRowIds.length === 0) continue;

            // Fetch all validation rules targeting this item
            const rulesResult = await client.query(`
              SELECT validation_rule_id, table_cell_target
              FROM validation_rules
              WHERE table_cell_target IS NOT NULL
                AND (
                  table_cell_target->>'tableItemId' = $1::text
                  OR (item_id = $2 AND table_cell_target->>'tableItemId' IS NULL)
                )
            `, [String(itemId), itemId]);

            const rulesToDelete: number[] = [];
            for (const rule of rulesResult.rows) {
              const target = rule.tableCellTarget || rule.table_cell_target;
              if (!target) continue;
              const ruleId = rule.validationRuleId || rule.validation_rule_id;

              // Delete rules targeting removed columns
              if (target.columnId && removedColIds.includes(target.columnId)) {
                rulesToDelete.push(ruleId);
                continue;
              }

              // Delete rules targeting specific removed rows (not allRows rules)
              if (target.rowId && target.rowId !== '*' && !target.allRows && removedRowIds.includes(target.rowId)) {
                rulesToDelete.push(ruleId);
              }
            }

            if (rulesToDelete.length > 0) {
              await client.query(
                `DELETE FROM validation_rules WHERE validation_rule_id = ANY($1::int[])`,
                [rulesToDelete]
              );
              logger.info('Deleted validation rules for removed table columns/rows', {
                itemId, removedColumns: removedColIds, removedRows: removedRowIds,
                rulesDeleted: rulesToDelete.length,
              });
            }
          }

          await client.query('RELEASE SAVEPOINT cascade_column_ids');
        } catch (cascadeErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT cascade_column_ids').catch(() => {});
          logger.warn('Failed to cascade column/row deletions to validation rules (non-fatal)', {
            error: cascadeErr.message,
          });
        }
      }
    }

    await client.query('COMMIT');

    logger.info('Form template updated successfully', { crfId });

    // Track document update in audit trail (21 CFR Part 11)
    try {
      await trackUserAction({
        userId,
        username: '',
        action: 'FORM_UPDATED',
        entityType: 'crf',
        entityId: crfId,
        details: `Updated form template: ${Object.keys(data).join(', ')}${data.fields ? ` with ${data.fields.length} fields` : ''}`
      });
    } catch (auditError: any) {
      logger.warn('Failed to record form update audit', { error: auditError.message });
    }

    return {
      success: true,
      message: `Form template updated successfully${data.fields ? ` with ${data.fields.length} fields` : ''}`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update form error', { error: error.message });

    return {
      success: false,
      message: `Failed to update form: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Archive a form template (21 CFR Part 11 compliant - no permanent deletion)
 * 
 * For 21 CFR Part 11 compliance, forms are NEVER deleted - they are archived.
 * Archived forms:
 * - Are hidden from regular users
 * - Can only be viewed by admins in the Archived Forms tab
 * - Can be restored by admins
 * - Maintain full audit trail
 * 
 * Status IDs:
 * - 1 = available
 * - 2 = unavailable/locked
 * - 5 = removed (legacy - should not be used)
 * - 6 = archived (21 CFR Part 11 compliant)
 */
export const archiveForm = async (
  crfId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Archiving form template (21 CFR Part 11)', { crfId, userId, reason });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current form info for audit
    const formQuery = await client.query(`
      SELECT c.name, c.status_id, s.name as status_name
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      WHERE c.crf_id = $1
    `, [crfId]);

    if (formQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form not found' };
    }

    const form = formQuery.rows[0];
    const oldStatus = form.statusId;

    // Check if already archived
    if (oldStatus === 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is already archived' };
    }

    // Set status to archived (status_id = 6)
    // Note: We first need to ensure status_id 6 exists - if not, we'll use 5 but mark as archived
    const statusCheck = await client.query(`
      SELECT status_id FROM status WHERE status_id = 6
    `);

    let archiveStatusId = 6;
    if (statusCheck.rows.length === 0) {
      // Status 6 doesn't exist, create it
      await client.query(`
        INSERT INTO status (status_id, name, description)
        VALUES (6, 'archived', '21 CFR Part 11 compliant archived status')
        ON CONFLICT (status_id) DO NOTHING
      `);
    }

    // Archive the form
    await client.query(`
      UPDATE crf
      SET status_id = $1, date_updated = NOW(), update_id = $2
      WHERE crf_id = $3
    `, [archiveStatusId, userId, crfId]);

    // Also archive all versions of this form
    await client.query(`
      UPDATE crf_version
      SET status_id = $1, date_updated = NOW(), update_id = $2
      WHERE crf_id = $3 AND status_id != $1
    `, [archiveStatusId, userId, crfId]);

    // Log audit event (21 CFR Part 11 §11.10(e))
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'crf', $1, $2, $3,
        $4, 'archived', $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Archive%' OR name LIKE '%Update%' LIMIT 1)
      )
    `, [userId, crfId, form.name, form.statusName, reason || 'Form archived for 21 CFR Part 11 compliance']);

    await client.query('COMMIT');

    logger.info('Form template archived successfully (21 CFR Part 11)', { crfId });

    return {
      success: true,
      message: `Form "${form.name}" archived successfully. It can be restored by an administrator.`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Archive form error', { error: error.message });

    return {
      success: false,
      message: `Failed to archive form: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Restore an archived form (admin only)
 * 21 CFR Part 11 compliant - maintains full audit trail
 */
export const restoreForm = async (
  crfId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Restoring archived form', { crfId, userId, reason });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current form info
    const formQuery = await client.query(`
      SELECT c.name, c.status_id, s.name as status_name
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      WHERE c.crf_id = $1
    `, [crfId]);

    if (formQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form not found' };
    }

    const form = formQuery.rows[0];

    // Check if form is archived
    if (form.statusId !== 6 && form.statusId !== 5) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is not archived' };
    }

    // Check if the name is already taken by an active form
    const nameConflict = await client.query(
      `SELECT crf_id FROM crf WHERE name = $1 AND status_id NOT IN (5, 6, 7) AND crf_id != $2 LIMIT 1`,
      [form.name, crfId]
    );

    let finalName = form.name;
    if (nameConflict.rows.length > 0) {
      // Name is taken — find a unique "Restored from Archive" suffix
      let counter = 1;
      let candidateName = `${form.name} - Restored from Archive ${counter}`;
      while (true) {
        const check = await client.query(
          `SELECT crf_id FROM crf WHERE name = $1 AND status_id NOT IN (5, 7) LIMIT 1`,
          [candidateName]
        );
        if (check.rows.length === 0) break;
        counter++;
        candidateName = `${form.name} - Restored from Archive ${counter}`;
      }
      finalName = candidateName;

      // Rename the form
      await client.query(
        `UPDATE crf SET name = $1 WHERE crf_id = $2`,
        [finalName, crfId]
      );
      logger.info('Renamed restored form to avoid name conflict', { crfId, oldName: form.name, newName: finalName });
    }

    // Restore to available status (status_id = 1)
    await client.query(`
      UPDATE crf
      SET status_id = 1, date_updated = NOW(), update_id = $1
      WHERE crf_id = $2
    `, [userId, crfId]);

    // Also restore all versions of this form
    await client.query(`
      UPDATE crf_version
      SET status_id = 1, date_updated = NOW(), update_id = $1
      WHERE crf_id = $2 AND status_id IN (5, 6)
    `, [userId, crfId]);

    // Log audit event
    const auditNewValue = finalName !== form.name
      ? `available (renamed from "${form.name}" to "${finalName}")`
      : 'available';
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'crf', $1, $2, $3,
        'archived', $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Restore%' OR name LIKE '%Update%' LIMIT 1)
      )
    `, [userId, crfId, finalName, auditNewValue, reason || 'Form restored from archive']);

    await client.query('COMMIT');

    logger.info('Form template restored successfully', { crfId, finalName });

    const nameNote = finalName !== form.name
      ? ` It was renamed to "${finalName}" because the original name was already in use.`
      : '';
    return {
      success: true,
      message: `Form "${finalName}" restored successfully.${nameNote}`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Restore form error', { error: error.message });

    return {
      success: false,
      message: `Failed to restore form: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get all archived forms (admin only)
 * 21 CFR Part 11 compliant - provides visibility to archived records
 */
export const getArchivedForms = async (studyId?: number, userId?: number): Promise<any[]> => {
  logger.info('Getting archived forms', { studyId, userId });

  try {
    // Check if category column exists in crf table
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'crf' AND column_name = 'category'
    `);
    const hasCategoryColumn = columnCheck.rows.length > 0;

    // Build org-scoping filter
    let orgFilter = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (userId) {
      const orgCheck = await pool.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      const userOrgIds = orgCheck.rows.map((r: any) => r.organizationId);

      if (userOrgIds.length > 0) {
        params.push(userOrgIds);
        orgFilter = `AND (
          c.owner_id IN (
            SELECT m.user_id FROM acc_organization_member m
            WHERE m.organization_id = ANY($${paramIndex++}::int[]) AND m.status = 'active'
          )
        )`;
      }
    }

    if (studyId) {
      params.push(studyId);
      orgFilter += ` AND c.source_study_id = $${paramIndex++}`;
    }

    let query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        ${hasCategoryColumn ? 'c.category,' : "'other' as category,"}
        c.oc_oid,
        c.status_id,
        s.name as status_name,
        st.name as study_name,
        st.study_id,
        c.date_created,
        c.date_updated,
        u.first_name || ' ' || u.last_name as archived_by,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,
        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version,
        (SELECT COUNT(*) FROM event_crf ec 
         JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id 
         WHERE cv.crf_id = c.crf_id) as usage_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      LEFT JOIN user_account u ON c.update_id = u.user_id
      WHERE c.status_id IN (5, 6)
      ${orgFilter}
      ORDER BY c.date_updated DESC, c.name
    `;

    const result = await pool.query(query, params);
    logger.info('Archived forms retrieved', { count: result.rows.length, userId });
    return result.rows;
  } catch (error: any) {
    logger.error('Get archived forms error', { error: error.message });
    throw error;
  }
};

/**
 * Delete a form template - DEPRECATED for 21 CFR Part 11
 * This function now calls archiveForm instead of permanently deleting.
 * Permanent deletion is NOT allowed per 21 CFR Part 11 requirements.
 */
export const deleteForm = async (
  crfId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.warn('deleteForm called - redirecting to archiveForm for 21 CFR Part 11 compliance', { crfId, userId });
  
  // For 21 CFR Part 11 compliance, we archive instead of delete
  return archiveForm(crfId, userId, 'Form archived via delete operation - 21 CFR Part 11 compliance');
};

// =============================================================================
// TEMPLATE FORKING / VERSIONING FUNCTIONS
// =============================================================================

/**
 * Get all versions of a CRF
 * Returns version history for display
 */
export const getFormVersions = async (
  crfId: number
): Promise<{ success: boolean; versions?: any[]; message?: string }> => {
  logger.info('Getting form versions', { crfId });

  try {
    const result = await pool.query(`
      SELECT 
        cv.crf_version_id,
        cv.name as version_name,
        cv.description,
        cv.revision_notes,
        cv.oc_oid,
        cv.status_id,
        s.name as status_name,
        cv.owner_id,
        cv.date_created,
        cv.date_updated,
        u.first_name || ' ' || u.last_name as created_by,
        (SELECT COUNT(*) FROM event_crf WHERE crf_version_id = cv.crf_version_id) as usage_count
      FROM crf_version cv
      INNER JOIN status s ON cv.status_id = s.status_id
      LEFT JOIN user_account u ON cv.owner_id = u.user_id
      WHERE cv.crf_id = $1
      ORDER BY cv.crf_version_id DESC
    `, [crfId]);

    logger.info('Form versions retrieved', { crfId, count: result.rows.length });

    return {
      success: true,
      versions: result.rows.map(row => ({
        crfVersionId: row.crfVersionId,
        versionName: row.versionName,
        description: row.description,
        revisionNotes: row.revisionNotes,
        oid: row.ocOid,
        statusId: row.statusId,
        statusName: row.statusName,
        createdBy: row.createdBy,
        dateCreated: row.dateCreated,
        dateUpdated: row.dateUpdated,
        usageCount: parseInt(row.usageCount) || 0,
        isInUse: parseInt(row.usageCount) > 0
      }))
    };
  } catch (error: any) {
    logger.error('Get form versions error', { error: error.message, crfId });
    return {
      success: false,
      message: `Failed to get form versions: ${error.message}`
    };
  }
};

/**
 * Create a new version of an existing CRF
 * - Copies all fields/items from source version
 * - Creates new crf_version record
 * - Maintains link to parent CRF
 * 
 * This implements "forking" at the version level - same CRF, new version
 */
export const createFormVersion = async (
  crfId: number,
  data: {
    versionName: string;
    revisionNotes?: string;
    copyFromVersionId?: number; // If not specified, copy from latest
  },
  userId: number
): Promise<{ success: boolean; crfVersionId?: number; message?: string }> => {
  logger.info('Creating new form version', { crfId, versionName: data.versionName, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get the source version (specified or latest)
    let sourceVersionId: number;
    if (data.copyFromVersionId) {
      // Verify the version belongs to this CRF
      const verifyResult = await client.query(`
        SELECT crf_version_id FROM crf_version 
        WHERE crf_version_id = $1 AND crf_id = $2
      `, [data.copyFromVersionId, crfId]);
      
      if (verifyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Source version not found or does not belong to this CRF' };
      }
      sourceVersionId = data.copyFromVersionId;
    } else {
      // Get latest version
      const latestResult = await client.query(`
        SELECT crf_version_id FROM crf_version 
        WHERE crf_id = $1 
        ORDER BY crf_version_id DESC 
        LIMIT 1
      `, [crfId]);
      
      if (latestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'No existing version found to copy from' };
      }
      sourceVersionId = latestResult.rows[0].crfVersionId;
    }

    // 2. Get CRF info for OID generation
    const crfResult = await client.query(`
      SELECT name, oc_oid FROM crf WHERE crf_id = $1
    `, [crfId]);
    
    if (crfResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'CRF not found' };
    }

    const crfOid = crfResult.rows[0].ocOid;
    const versionCount = await client.query(`
      SELECT COUNT(*) as count FROM crf_version WHERE crf_id = $1
    `, [crfId]);
    const nextVersionNum = parseInt(versionCount.rows[0].count) + 1;
    const newVersionOid = `${crfOid}_V${nextVersionNum}`;

    // 3. Create new version record
    await repairSequence(client, 'crf_version_crf_version_id_seq', 'crf_version', 'crf_version_id');
    const newVersionResult = await client.query(`
      INSERT INTO crf_version (
        crf_id, name, description, revision_notes, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, $3, $4, 1, $5, NOW(), $6
      )
      RETURNING crf_version_id
    `, [
      crfId,
      data.versionName,
      `Version ${data.versionName}`,
      data.revisionNotes || `Created from version ${sourceVersionId}`,
      userId,
      newVersionOid
    ]);

    const newVersionId = newVersionResult.rows[0].crfVersionId;
    logger.info('Created new version record', { newVersionId, sourceVersionId });

    // 4. Copy sections from source version
    const sectionMapping: Record<number, number> = {};
    const sectionsResult = await client.query(`
      SELECT section_id, label, title, instructions, subtitle, page_number_label,
             ordinal, parent_id, borders
      FROM section WHERE crf_version_id = $1
    `, [sourceVersionId]);

    for (const section of sectionsResult.rows) {
      const newSectionResult = await client.query(`
        INSERT INTO section (
          crf_version_id, status_id, label, title, instructions, subtitle,
          page_number_label, ordinal, parent_id, borders, owner_id, date_created
        ) VALUES (
          $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
        )
        RETURNING section_id
      `, [
        newVersionId,
        section.label,
        section.title,
        section.instructions,
        section.subtitle,
        section.pageNumberLabel,
        section.ordinal,
        null, // parent_id will be mapped after
        section.borders,
        userId
      ]);
      sectionMapping[section.sectionId] = newSectionResult.rows[0].sectionId;
    }

    // 5. Copy item groups
    const itemGroupMapping: Record<number, number> = {};
    const itemGroupsResult = await client.query(`
      SELECT ig.item_group_id, ig.name, ig.oc_oid, 
             igm.header, igm.subheader, igm.layout, igm.repeat_number, 
             igm.repeat_max, igm.show_group, igm.ordinal, igm.borders
      FROM item_group ig
      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
      WHERE igm.crf_version_id = $1
    `, [sourceVersionId]);

    for (const group of itemGroupsResult.rows) {
      // Create new OID for item group
      const newGroupOid = group.ocOid ? 
        `${group.ocOid}_V${nextVersionNum}` : 
        `IG_${newVersionId}_${group.itemGroupId}`;

      const newGroupResult = await client.query(`
        INSERT INTO item_group (
          name, crf_id, oc_oid, status_id, owner_id, date_created
        ) VALUES (
          $1, $2, $3, 1, $4, NOW()
        )
        RETURNING item_group_id
      `, [group.name, crfId, newGroupOid, userId]);

      const newGroupId = newGroupResult.rows[0].itemGroupId;
      itemGroupMapping[group.itemGroupId] = newGroupId;

      // Create item_group_metadata for new version
      await client.query(`
        INSERT INTO item_group_metadata (
          item_group_id, crf_version_id, header, subheader, layout,
          repeat_number, repeat_max, show_group, ordinal, borders
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `, [
        newGroupId,
        newVersionId,
        group.header,
        group.subheader,
        group.layout,
        group.repeatNumber,
        group.repeatMax,
        group.showGroup,
        group.ordinal,
        group.borders
      ]);
    }

    // 6. Copy items and item_form_metadata
    const itemMapping: Record<number, number> = {};
    const itemsResult = await client.query(`
      SELECT i.item_id, i.name, i.description, i.units, i.phi_status, 
             i.item_data_type_id, i.item_reference_type_id, i.oc_oid,
             ifm.header, ifm.subheader, ifm.left_item_text, ifm.right_item_text,
             ifm.parent_id, ifm.column_number, ifm.section_id, ifm.ordinal,
             ifm.response_set_id, ifm.required, ifm.regexp, ifm.regexp_error_msg,
             ifm.show_item, ifm.question_number_label, ifm.default_value,
             ifm.width_decimal, ifm.response_layout
      FROM item i
      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      WHERE ifm.crf_version_id = $1
    `, [sourceVersionId]);

    for (const item of itemsResult.rows) {
      // Create new OID for item
      const newItemOid = item.ocOid ? 
        `${item.ocOid}_V${nextVersionNum}` : 
        `I_${newVersionId}_${item.itemId}`;

      const newItemResult = await client.query(`
        INSERT INTO item (
          name, description, units, phi_status, item_data_type_id,
          item_reference_type_id, status_id, owner_id, date_created, oc_oid
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 1, $7, NOW(), $8
        )
        RETURNING item_id
      `, [
        item.name,
        item.description,
        item.units,
        item.phiStatus,
        item.itemDataTypeId,
        item.itemReferenceTypeId,
        userId,
        newItemOid
      ]);

      const newItemId = newItemResult.rows[0].itemId;
      itemMapping[item.itemId] = newItemId;

      // Create item_form_metadata for new version
      const newSectionId = sectionMapping[item.sectionId] || null;
      
      await client.query(`
        INSERT INTO item_form_metadata (
          item_id, crf_version_id, header, subheader, left_item_text, right_item_text,
          parent_id, column_number, section_id, ordinal, response_set_id,
          required, regexp, regexp_error_msg, show_item, question_number_label,
          default_value, width_decimal, response_layout
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
      `, [
        newItemId,
        newVersionId,
        item.header,
        item.subheader,
        item.leftItemText,
        item.rightItemText,
        null, // parent_id mapping if needed
        item.columnNumber,
        newSectionId,
        item.ordinal,
        item.responseSetId, // Response sets are shared
        item.required,
        item.regexp,
        item.regexpErrorMsg,
        item.showItem,
        item.questionNumberLabel,
        item.defaultValue,
        item.widthDecimal,
        item.responseLayout
      ]);

      // Copy item_group_map if exists
      const groupMapResult = await client.query(`
        SELECT item_group_id FROM item_group_map
        WHERE item_id = $1 AND crf_version_id = $2
      `, [item.itemId, sourceVersionId]);

      if (groupMapResult.rows.length > 0) {
        const oldGroupId = groupMapResult.rows[0].itemGroupId;
        const newGroupId = itemGroupMapping[oldGroupId];
        if (newGroupId) {
          await client.query(`
            INSERT INTO item_group_map (item_group_id, item_id, crf_version_id)
            VALUES ($1, $2, $3)
          `, [newGroupId, newItemId, newVersionId]);
        }
      }
    }

    // 7. Copy SCD item metadata (conditional display rules)
    const scdResult = await client.query(`
      SELECT scd.scd_item_metadata_id, scd.scd_item_form_metadata_id, scd.control_item_form_metadata_id,
             scd.option_value, scd.message
      FROM scd_item_metadata scd
      INNER JOIN item_form_metadata ifm ON scd.scd_item_form_metadata_id = ifm.item_form_metadata_id
      WHERE ifm.crf_version_id = $1
    `, [sourceVersionId]);

    // Note: SCD copying requires mapping item_form_metadata IDs which is complex
    // For now, log that SCD rules need manual review
    if (scdResult.rows.length > 0) {
      logger.info('SCD rules found in source version', { 
        count: scdResult.rows.length, 
        note: 'SCD rules may need manual configuration in new version'
      });
    }

    await client.query('COMMIT');

    logger.info('Form version created successfully', { 
      crfId, 
      newVersionId, 
      sourceVersionId,
      sectionsCopied: Object.keys(sectionMapping).length,
      itemsCopied: Object.keys(itemMapping).length
    });

    // Audit log
    try {
      await trackUserAction({
        userId,
        username: '',
        action: 'FORM_VERSION_CREATED',
        entityType: 'crf_version',
        entityId: newVersionId,
        details: `Created version "${data.versionName}" from version ${sourceVersionId}`
      });
    } catch (auditError: any) {
      logger.warn('Failed to record version creation audit', { error: auditError.message });
    }

    return {
      success: true,
      crfVersionId: newVersionId,
      message: `Version "${data.versionName}" created successfully`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create form version error', { error: error.message, crfId });
    return {
      success: false,
      message: `Failed to create form version: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Fork (copy) an entire CRF to create a new independent form.
 *
 * 21 CFR Part 11 §11.10(e) — every fork is recorded with structured
 * provenance columns on the destination CRF (see crf_fork_provenance
 * migration) AND an audit row on BOTH the destination ('Form Copied')
 * and the source ('Form Copied To Another Organization') so the lineage
 * is visible from either side of the copy.
 *
 * Org-isolation: callers must supply their resolved org IDs. The function
 * verifies that:
 *   - the source CRF's owner (or owning study's owner) is in one of those orgs
 *   - if `targetStudyId` is supplied, the target study's owner is in one of
 *     those orgs (we permit copying *into* an org you belong to)
 *
 * Returns a typed `code` field so the controller can map to the right
 * HTTP status (409 for name collision, 403 for org denial, etc).
 */
export const forkForm = async (
  sourceCrfId: number,
  data: {
    newName: string;
    description?: string;
    targetStudyId?: number;
  },
  userId: number,
  callerOrgIds: number[] = []
): Promise<{
  success: boolean;
  newCrfId?: number;
  message?: string;
  code?: 'OK' | 'NOT_FOUND' | 'NAME_CONFLICT' | 'FORBIDDEN_SOURCE' | 'FORBIDDEN_TARGET' | 'NO_VERSION' | 'ERROR';
  copied?: { sections: number; itemGroups: number; items: number; scd: number; validationRules: number; responseSets: number };
  linkedFormActions?: Array<{
    fieldName: string;
    fieldLabel?: string;
    originalFormId: number;
    originalFormName?: string;
    status: 'auto_relinked' | 'self_relinked' | 'broken' | 'not_found';
    resolvedFormId?: number;
    resolvedFormName?: string;
    recommendation: string;
  }>;
}> => {
  logger.info('Forking form template', { sourceCrfId, newName: data.newName, userId, callerOrgIds });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get source CRF info (incl. fields needed for provenance)
    const sourceCrfResult = await client.query(`
      SELECT crf_id, name, description, oc_oid, source_study_id, owner_id
      FROM crf WHERE crf_id = $1
    `, [sourceCrfId]);

    if (sourceCrfResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Source CRF not found', code: 'NOT_FOUND' };
    }

    const sourceCrf = sourceCrfResult.rows[0];

    // 1a. Resolve source organization (via crf owner). We snapshot this for
    // the provenance row even when org-isolation is disabled (callerOrgIds
    // empty) so historical lineage is always recorded. Wrapped in a savepoint
    // so missing org tables on legacy installs don't kill the fork — we just
    // record a NULL source org and proceed.
    let sourceOrgId: number | null = null;
    let sourceOrgName: string | null = null;
    if (sourceCrf.ownerId) {
      try {
        await client.query('SAVEPOINT lookup_src_org');
        const sourceOrgRow = await client.query(`
          SELECT m.organization_id, o.name AS organization_name
            FROM acc_organization_member m
            JOIN acc_organization o ON o.organization_id = m.organization_id
           WHERE m.user_id = $1 AND m.status = 'active'
           LIMIT 1
        `, [sourceCrf.ownerId]);
        sourceOrgId = sourceOrgRow.rows[0]?.organizationId ?? null;
        sourceOrgName = sourceOrgRow.rows[0]?.organizationName ?? null;
        await client.query('RELEASE SAVEPOINT lookup_src_org');
      } catch (orgErr: any) {
        await client.query('ROLLBACK TO SAVEPOINT lookup_src_org');
        logger.warn('forkForm: source org lookup failed (legacy schema?)', { error: orgErr.message });
      }
    }

    // 1b. Org-isolation: caller must belong to the source's org. We treat an
    // empty callerOrgIds as "isolation disabled" (used by integration tests
    // and internal jobs); production callers always pass it.
    //
    // The membership lookup is wrapped in a savepoint so that on legacy
    // schemas where acc_organization_member doesn't exist we fail OPEN
    // (proceed with the fork) rather than 500. Same posture as the rest of
    // the codebase — see getFormById's org-scoping block.
    if (callerOrgIds.length > 0) {
      const ownerIds: number[] = [];
      if (sourceCrf.ownerId) ownerIds.push(sourceCrf.ownerId);
      if (sourceCrf.sourceStudyId) {
        const studyOwner = await client.query(
          `SELECT owner_id FROM study WHERE study_id = $1`,
          [sourceCrf.sourceStudyId]
        );
        if (studyOwner.rows.length > 0 && studyOwner.rows[0].ownerId) {
          ownerIds.push(studyOwner.rows[0].ownerId);
        }
      }

      if (ownerIds.length > 0) {
        try {
          await client.query('SAVEPOINT check_src_iso');
          const ownerInOrg = await client.query(
            `SELECT 1 FROM acc_organization_member
              WHERE user_id = ANY($1::int[])
                AND organization_id = ANY($2::int[])
                AND status = 'active' LIMIT 1`,
            [ownerIds, callerOrgIds]
          );
          await client.query('RELEASE SAVEPOINT check_src_iso');
          if (ownerInOrg.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('forkForm: caller denied access to source CRF', { sourceCrfId, userId, callerOrgIds });
            return { success: false, message: 'You do not have access to the source form', code: 'FORBIDDEN_SOURCE' };
          }
        } catch (isoErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT check_src_iso');
          logger.warn('forkForm: source org-isolation check skipped (legacy schema?)', { error: isoErr.message });
        }
      }
    }

    // 1c. If a target study was specified, validate it exists and the caller
    // can write into its organization. We also resolve the destination org
    // for the audit record.
    let targetOrgId: number | null = null;
    let targetOrgName: string | null = null;
    let targetStudyName: string | null = null;
    let resolvedTargetStudyId: number | null = data.targetStudyId ?? sourceCrf.sourceStudyId ?? null;

    if (resolvedTargetStudyId) {
      const studyRow = await client.query(
        `SELECT study_id, name, owner_id FROM study WHERE study_id = $1`,
        [resolvedTargetStudyId]
      );
      if (studyRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Target study not found', code: 'NOT_FOUND' };
      }
      targetStudyName = studyRow.rows[0].name;

      if (studyRow.rows[0].ownerId) {
        try {
          await client.query('SAVEPOINT lookup_tgt_org');
          const targetOrgRow = await client.query(`
            SELECT m.organization_id, o.name AS organization_name
              FROM acc_organization_member m
              JOIN acc_organization o ON o.organization_id = m.organization_id
             WHERE m.user_id = $1 AND m.status = 'active'
             LIMIT 1
          `, [studyRow.rows[0].ownerId]);
          targetOrgId = targetOrgRow.rows[0]?.organizationId ?? null;
          targetOrgName = targetOrgRow.rows[0]?.organizationName ?? null;
          await client.query('RELEASE SAVEPOINT lookup_tgt_org');
        } catch (orgErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT lookup_tgt_org');
          logger.warn('forkForm: target org lookup failed (legacy schema?)', { error: orgErr.message });
        }
      }

      if (callerOrgIds.length > 0 && targetOrgId !== null && !callerOrgIds.includes(targetOrgId)) {
        await client.query('ROLLBACK');
        logger.warn('forkForm: caller denied access to target study', {
          sourceCrfId, targetStudyId: resolvedTargetStudyId, userId, callerOrgIds, targetOrgId
        });
        return {
          success: false,
          message: 'You do not have access to the target study/organization',
          code: 'FORBIDDEN_TARGET'
        };
      }
    }

    // 2. Generate a collision-resistant OID. Hex from 6 random bytes gives
    // ~2.8e14 entropy per name — practically eliminates the 6-digit
    // millisecond collision risk on rapid sequential forks.
    const oidSuffix = crypto.randomBytes(6).toString('hex').toUpperCase();
    const newOid = `F_${data.newName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24)}_${oidSuffix}`;

    // Name uniqueness — scoped to the TARGET study so two organizations can
    // legitimately have a form called "Adverse Events". Previously this was
    // a global check that returned someone else's CRF on collision (data leak
    // + audit pollution). Now we reject with a structured NAME_CONFLICT code.
    //
    // FOR UPDATE locks any matching row so a concurrent fork with the same
    // name blocks until this transaction commits, preventing a TOCTOU race
    // where two parallel forks both pass the check and both insert.
    const nameCheckParams: any[] = [data.newName];
    let nameCheckSql = `SELECT crf_id FROM crf WHERE name = $1 AND status_id NOT IN (5, 7)`;
    if (resolvedTargetStudyId) {
      nameCheckSql += ` AND source_study_id = $2`;
      nameCheckParams.push(resolvedTargetStudyId);
    }
    nameCheckSql += ` LIMIT 1 FOR UPDATE`;
    const nameCheck = await client.query(nameCheckSql, nameCheckParams);
    if (nameCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `A form named "${data.newName}" already exists in the target study`,
        code: 'NAME_CONFLICT',
      };
    }

    // OID collision is now astronomically unlikely but still belt-and-braces.
    const existsCheck = await client.query(`SELECT crf_id FROM crf WHERE oc_oid = $1`, [newOid]);
    if (existsCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Generated OID collision — try again', code: 'ERROR' };
    }

    // 3. Create new CRF (with structured provenance columns)
    await repairSequence(client, 'crf_crf_id_seq', 'crf', 'crf_id');
    const newCrfResult = await client.query(`
      INSERT INTO crf (
        name, description, status_id, owner_id, date_created, oc_oid, source_study_id,
        forked_from_crf_id, forked_from_version_id, forked_from_study_id, forked_from_org_id,
        forked_by_user_id, forked_at
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4, $5,
        $6, $7, $8, $9,
        $10, NOW()
      )
      RETURNING crf_id
    `, [
      data.newName,
      data.description || `Copied from "${sourceCrf.name}"${sourceOrgName ? ` (org: ${sourceOrgName})` : ''}`,
      userId,
      newOid,
      resolvedTargetStudyId,
      sourceCrfId,
      null, // forked_from_version_id — set after we resolve the source version (step 4)
      sourceCrf.sourceStudyId ?? null,
      sourceOrgId,
      userId,
    ]);

    const newCrfId = newCrfResult.rows[0].crfId;
    logger.info('Created forked CRF record', {
      newCrfId, sourceCrfId, sourceOrgId, targetOrgId, targetStudyId: resolvedTargetStudyId
    });

    // 4. Get latest version from source to copy
    const sourceVersionResult = await client.query(`
      SELECT crf_version_id, name, description
      FROM crf_version 
      WHERE crf_id = $1 
      ORDER BY crf_version_id DESC 
      LIMIT 1
    `, [sourceCrfId]);

    if (sourceVersionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'No version found in source CRF', code: 'NO_VERSION' };
    }

    const sourceVersion = sourceVersionResult.rows[0];
    const sourceVersionId = sourceVersion.crfVersionId;

    // Backfill forked_from_version_id now that we know the source version.
    // We deferred this from the INSERT above because the version is resolved
    // after the CRF row is created.
    try {
      await client.query(
        `UPDATE crf SET forked_from_version_id = $1 WHERE crf_id = $2`,
        [sourceVersionId, newCrfId]
      );
    } catch { /* column may not exist on very old installs — non-fatal */ }

    // 5. Create initial version for new CRF
    await repairSequence(client, 'crf_version_crf_version_id_seq', 'crf_version', 'crf_version_id');
    const newVersionOid = `${newOid}_V1`;
    const newVersionResult = await client.query(`
      INSERT INTO crf_version (
        crf_id, name, description, revision_notes, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, 'v1.0', $2, $3, 1, $4, NOW(), $5
      )
      RETURNING crf_version_id
    `, [
      newCrfId,
      `Initial version (copied from ${sourceCrf.name})`,
      `Copied from CRF ID ${sourceCrfId}, version ${sourceVersion.name}` +
        (sourceOrgName ? `, source org ${sourceOrgName}` : '') +
        (targetOrgName ? `, target org ${targetOrgName}` : ''),
      userId,
      newVersionOid
    ]);

    const newVersionId = newVersionResult.rows[0].crfVersionId;

    // Repair sequences for all child tables BEFORE bulk-inserting into them.
    // Without this, a stale sequence (common after seed scripts that insert
    // explicit IDs) produces "duplicate key violates unique constraint" on the
    // very first INSERT. The crf and crf_version sequences were already
    // repaired above; these cover the remaining tables the fork writes to.
    await repairSequence(client, 'section_section_id_seq', 'section', 'section_id');
    await repairSequence(client, 'item_group_item_group_id_seq', 'item_group', 'item_group_id');
    await repairSequence(client, 'item_item_id_seq', 'item', 'item_id');
    try {
      await repairSequence(client, 'response_set_response_set_id_seq', 'response_set', 'response_set_id');
    } catch { /* response_set sequence name may differ on some installs */ }

    // 6. Copy sections — TWO-PASS so we can correctly remap parent_id.
    // Previously parent_id was hard-coded to NULL which flattened nested
    // section hierarchies (any sub-section lost its parent). Pass 1 inserts
    // every section with parent_id NULL to obtain new IDs; pass 2 walks the
    // mapping and patches parent_id to point at the freshly-inserted parent.
    const sectionMapping: Record<number, number> = {};
    const sectionsResult = await client.query(`
      SELECT section_id, label, title, instructions, subtitle, page_number_label,
             ordinal, parent_id, borders
      FROM section WHERE crf_version_id = $1
    `, [sourceVersionId]);

    for (const section of sectionsResult.rows) {
      const newSectionResult = await client.query(`
        INSERT INTO section (
          crf_version_id, status_id, label, title, instructions, subtitle,
          page_number_label, ordinal, parent_id, borders, owner_id, date_created
        ) VALUES (
          $1, 1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, NOW()
        )
        RETURNING section_id
      `, [
        newVersionId,
        section.label,
        section.title,
        section.instructions,
        section.subtitle,
        section.pageNumberLabel,
        section.ordinal,
        section.borders,
        userId
      ]);
      sectionMapping[section.sectionId] = newSectionResult.rows[0].sectionId;
    }

    // Pass 2: rewire parent_id using the now-known mapping.
    for (const section of sectionsResult.rows) {
      if (!section.parentId) continue;
      const newParentId = sectionMapping[section.parentId];
      const newSelfId = sectionMapping[section.sectionId];
      if (!newParentId || !newSelfId) continue; // orphan parent in source data
      await client.query(
        `UPDATE section SET parent_id = $1 WHERE section_id = $2`,
        [newParentId, newSelfId]
      );
    }

    // 7. Copy item groups (create group records only — metadata is copied after items)
    const itemGroupMapping: Record<number, number> = {};
    const itemGroupsResult = await client.query(`
      SELECT DISTINCT ig.item_group_id, ig.name, ig.oc_oid
      FROM item_group ig
      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
      WHERE igm.crf_version_id = $1
    `, [sourceVersionId]);

    for (const group of itemGroupsResult.rows) {
      // 8 random hex chars = 4.3 billion namespace per (newCrfId, source group) tuple.
      const newGroupOid =
        `IG_${newCrfId}_${crypto.randomBytes(4).toString('hex').toUpperCase()}_${group.itemGroupId}`;

      const newGroupResult = await client.query(`
        INSERT INTO item_group (name, crf_id, oc_oid, status_id, owner_id, date_created)
        VALUES ($1, $2, $3, 1, $4, NOW())
        RETURNING item_group_id
      `, [group.name, newCrfId, newGroupOid, userId]);

      itemGroupMapping[group.itemGroupId] = newGroupResult.rows[0].itemGroupId;
    }

    // 8. Copy items — preceded by deep-copying response_set rows.
    //
    // Previously, forked items shared the SAME response_set_id as the source.
    // If org A edits a dropdown's option list, org B's forked form silently
    // mutates too. Deep-copying isolates them. We build a mapping once across
    // all items so duplicate refs to the same response_set share ONE new row.
    const responseSetMapping: Record<number, number> = {};

    async function cloneResponseSet(oldRsId: number): Promise<number> {
      if (responseSetMapping[oldRsId] !== undefined) return responseSetMapping[oldRsId];
      try {
        const rs = await client.query(
          `SELECT response_type_id, label, options_text, options_values, version_id
             FROM response_set WHERE response_set_id = $1`,
          [oldRsId]
        );
        if (rs.rows.length === 0) {
          responseSetMapping[oldRsId] = oldRsId; // missing — fall back to shared
          return oldRsId;
        }
        const r = rs.rows[0];
        const newRs = await client.query(`
          INSERT INTO response_set (response_type_id, label, options_text, options_values, version_id)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING response_set_id
        `, [r.responseTypeId, r.label, r.optionsText, r.optionsValues, newVersionId]);
        const newId = newRs.rows[0].responseSetId;
        responseSetMapping[oldRsId] = newId;
        return newId;
      } catch (rsErr: any) {
        logger.warn('Failed to clone response_set — sharing with source', { oldRsId, error: rsErr.message });
        responseSetMapping[oldRsId] = oldRsId;
        return oldRsId;
      }
    }

    // Track form-link references and resolve them. Fields may reference other
    // CRF IDs via `linkedFormId` or `formLinks[].targetFormId` inside the
    // item.description extended_props JSON. During fork we:
    //   1. Self-references (linkedFormId === sourceCrfId): auto-remap to newCrfId
    //   2. External references: look up whether a form with the SAME NAME exists
    //      in the target study. If yes → auto-relink. If no → mark as broken
    //      and return actionable guidance to the user.
    //
    // After the fork, the response includes a `linkedFormActions` array so the
    // UI can show the user exactly what happened to each cross-form link and
    // what they need to do.
    const linkedFormActions: Array<{
      fieldName: string;
      fieldLabel?: string;
      originalFormId: number;
      originalFormName?: string;
      status: 'auto_relinked' | 'self_relinked' | 'broken' | 'not_found';
      resolvedFormId?: number;
      resolvedFormName?: string;
      recommendation: string;
    }> = [];

    // Pre-build a lookup of form names in the target study so we can auto-relink.
    // Only query once, not per-field.
    const targetStudyForms: Map<string, { crfId: number; name: string }> = new Map();
    if (resolvedTargetStudyId) {
      try {
        const formsInTarget = await client.query(
          `SELECT crf_id, name FROM crf WHERE source_study_id = $1 AND status_id NOT IN (5, 7)`,
          [resolvedTargetStudyId]
        );
        for (const f of formsInTarget.rows) {
          targetStudyForms.set(f.name.toLowerCase().trim(), { crfId: f.crfId, name: f.name });
        }
      } catch { /* target study forms lookup failed — non-fatal */ }
    }

    const ifmMapping: Record<number, number> = {}; // old item_form_metadata_id -> new
    const itemIdMapping: Record<number, number> = {}; // old item_id -> new item_id
    const itemsResult = await client.query(`
      SELECT i.item_id, i.name, i.description, i.units, i.phi_status,
             i.item_data_type_id, i.item_reference_type_id, i.oc_oid,
             ifm.item_form_metadata_id,
             ifm.header, ifm.subheader, ifm.left_item_text, ifm.right_item_text,
             ifm.parent_id, ifm.column_number, ifm.section_id, ifm.ordinal,
             ifm.response_set_id, ifm.required, ifm.regexp, ifm.regexp_error_msg,
             ifm.show_item, ifm.question_number_label, ifm.default_value,
             ifm.width_decimal, ifm.response_layout
      FROM item i
      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      WHERE ifm.crf_version_id = $1
    `, [sourceVersionId]);

    for (const item of itemsResult.rows) {
      // Crypto-random suffix — see group OID note above. Item OIDs MUST be
      // globally unique for ODM export to work, and the previous 4-digit
      // millisecond slice was demonstrably collision-prone in tight loops.
      const newItemOid =
        `I_${newCrfId}_${crypto.randomBytes(4).toString('hex').toUpperCase()}_${item.itemId}`;

      const newItemResult = await client.query(`
        INSERT INTO item (
          name, description, units, phi_status, item_data_type_id,
          item_reference_type_id, status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), $8)
        RETURNING item_id
      `, [
        item.name,
        remapDescriptionFormLinks(item.description, item.name, sourceCrfId, newCrfId, targetStudyForms, linkedFormActions),
        item.units, item.phiStatus,
        item.itemDataTypeId, item.itemReferenceTypeId, userId, newItemOid
      ]);

      const newItemId = newItemResult.rows[0].itemId;
      const newSectionId = sectionMapping[item.sectionId] || null;

      // Deep-copy response_set so edits in one org don't leak to the other.
      const newResponseSetId = item.responseSetId
        ? await cloneResponseSet(item.responseSetId)
        : null;

      const newIfmResult = await client.query(`
        INSERT INTO item_form_metadata (
          item_id, crf_version_id, header, subheader, left_item_text, right_item_text,
          parent_id, column_number, section_id, ordinal, response_set_id,
          required, regexp, regexp_error_msg, show_item, question_number_label,
          default_value, width_decimal, response_layout
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING item_form_metadata_id
      `, [
        newItemId, newVersionId, item.header, item.subheader, item.leftItemText,
        item.rightItemText, null, item.columnNumber, newSectionId, item.ordinal,
        newResponseSetId, item.required, item.regexp, item.regexpErrorMsg,
        item.showItem, item.questionNumberLabel, item.defaultValue,
        item.widthDecimal, item.responseLayout
      ]);

      ifmMapping[item.itemFormMetadataId] = newIfmResult.rows[0].itemFormMetadataId;
      itemIdMapping[item.itemId] = newItemId;

      // Copy item_group_map (table may not exist on all installations)
      try {
        await client.query('SAVEPOINT copy_igm');
        const groupMapResult = await client.query(`
          SELECT item_group_id FROM item_group_map WHERE item_id = $1 AND crf_version_id = $2
        `, [item.itemId, sourceVersionId]);

        if (groupMapResult.rows.length > 0) {
          const oldGroupId = groupMapResult.rows[0].itemGroupId;
          const newGroupId = itemGroupMapping[oldGroupId];
          if (newGroupId) {
            await client.query(`
              INSERT INTO item_group_map (item_group_id, item_id, crf_version_id)
              VALUES ($1, $2, $3)
            `, [newGroupId, newItemId, newVersionId]);
          }
        }
        await client.query('RELEASE SAVEPOINT copy_igm');
      } catch (igmError: any) {
        await client.query('ROLLBACK TO SAVEPOINT copy_igm');
        logger.error('Failed to copy item_group_map entry', { itemId: item.itemId, error: igmError.message });
      }
    }

    // 8a-extra: Remap item_form_metadata.parent_id (sub-item references).
    // Same two-pass strategy as sections: items were inserted with parent_id=NULL
    // so we now walk the source rows, look up the old parent_id in ifmMapping,
    // and UPDATE the new row to point at its remapped parent.
    for (const item of itemsResult.rows) {
      if (!item.parentId) continue;
      const newParentIfmId = ifmMapping[item.parentId];
      const newSelfIfmId = ifmMapping[item.itemFormMetadataId];
      if (!newParentIfmId || !newSelfIfmId) continue;
      await client.query(
        `UPDATE item_form_metadata SET parent_id = $1 WHERE item_form_metadata_id = $2`,
        [newParentIfmId, newSelfIfmId]
      );
    }

    // 8b. Copy item_group_metadata (now that we have item ID mappings)
    const igmResult = await client.query(`
      SELECT igm.item_group_id, igm.item_id, igm.header, igm.subheader, igm.layout,
             igm.repeat_number, igm.repeat_max, igm.show_group, igm.ordinal,
             igm.borders, igm.repeating_group
      FROM item_group_metadata igm
      WHERE igm.crf_version_id = $1
    `, [sourceVersionId]);

    for (const igm of igmResult.rows) {
      const newGroupId = itemGroupMapping[igm.itemGroupId];
      const newItemId = igm.itemId ? itemIdMapping[igm.itemId] : null;
      if (!newGroupId) continue;

      await client.query(`
        INSERT INTO item_group_metadata (
          item_group_id, crf_version_id, item_id, header, subheader, layout,
          repeat_number, repeat_max, show_group, ordinal, borders, repeating_group
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        newGroupId, newVersionId, newItemId,
        igm.header, igm.subheader, igm.layout,
        igm.repeatNumber, igm.repeatMax, igm.showGroup,
        igm.ordinal, igm.borders, igm.repeatingGroup ?? false,
      ]);
    }

    // 9. Copy SCD item metadata (skip logic / conditional display)
    const scdResult = await client.query(`
      SELECT scd.scd_item_form_metadata_id, scd.control_item_form_metadata_id,
             scd.control_item_name, scd.option_value, scd.message, scd.version
      FROM scd_item_metadata scd
      INNER JOIN item_form_metadata ifm ON scd.scd_item_form_metadata_id = ifm.item_form_metadata_id
      WHERE ifm.crf_version_id = $1
    `, [sourceVersionId]);

    let scdCopied = 0;
    for (const scd of scdResult.rows) {
      const newTargetIfmId = ifmMapping[scd.scdItemFormMetadataId];
      const newControlIfmId = scd.controlItemFormMetadataId
        ? ifmMapping[scd.controlItemFormMetadataId]
        : null;

      if (newTargetIfmId) {
        await client.query(`
          INSERT INTO scd_item_metadata (
            scd_item_form_metadata_id, control_item_form_metadata_id,
            control_item_name, option_value, message, version
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          newTargetIfmId, newControlIfmId || null,
          scd.controlItemName, scd.optionValue, scd.message, scd.version || 1
        ]);
        scdCopied++;
      }
    }

    // 10. Copy validation_rules tied to the source CRF / version. Without
    // this, the forked CRF silently loses every required-field, range, BP,
    // and custom-expression rule — a regulator would see two "identical"
    // CRFs with materially different data-quality behavior. Wrapped in a
    // savepoint because the validation_rules table is created lazily by a
    // startup migration and may be missing on very old installations.
    let rulesCopied = 0;
    try {
      await client.query('SAVEPOINT copy_rules');
      const rulesResult = await client.query(`
        SELECT name, description, rule_type, field_path, severity,
               error_message, warning_message, active,
               min_value, max_value, pattern, format_type,
               operator, compare_field_path, compare_value, custom_expression,
               bp_systolic_min, bp_systolic_max, bp_diastolic_min, bp_diastolic_max,
               item_id, table_cell_target
          FROM validation_rules
         WHERE crf_id = $1
           AND (crf_version_id IS NULL OR crf_version_id = $2)
      `, [sourceCrfId, sourceVersionId]);

      for (const rule of rulesResult.rows) {
        const newRuleItemId = rule.itemId ? itemIdMapping[rule.itemId] ?? null : null;

        // Deep-remap table_cell_target: the JSONB stores `tableItemId` which is
        // the old item.item_id. If we don't remap it, the forked rule points at
        // the source CRF's item — cell-level validation silently breaks.
        let tableCellTarget = rule.tableCellTarget;
        if (tableCellTarget && typeof tableCellTarget === 'object' && tableCellTarget.tableItemId) {
          const newTableItemId = itemIdMapping[tableCellTarget.tableItemId];
          if (newTableItemId) {
            tableCellTarget = { ...tableCellTarget, tableItemId: newTableItemId };
          }
        }

        await client.query(`
          INSERT INTO validation_rules (
            crf_id, crf_version_id, item_id, name, description, rule_type,
            field_path, severity, error_message, warning_message, active,
            min_value, max_value, pattern, format_type,
            operator, compare_field_path, compare_value, custom_expression,
            bp_systolic_min, bp_systolic_max, bp_diastolic_min, bp_diastolic_max,
            table_cell_target,
            date_created, owner_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19,
            $20, $21, $22, $23,
            $24,
            CURRENT_TIMESTAMP, $25
          )
        `, [
          newCrfId, newVersionId, newRuleItemId, rule.name, rule.description, rule.ruleType,
          rule.fieldPath, rule.severity, rule.errorMessage, rule.warningMessage, rule.active,
          rule.minValue, rule.maxValue, rule.pattern, rule.formatType,
          rule.operator, rule.compareFieldPath, rule.compareValue, rule.customExpression,
          rule.bpSystolicMin, rule.bpSystolicMax, rule.bpDiastolicMin, rule.bpDiastolicMax,
          tableCellTarget ? JSON.stringify(tableCellTarget) : null,
          userId,
        ]);
        rulesCopied++;
      }
      await client.query('RELEASE SAVEPOINT copy_rules');
    } catch (ruleErr: any) {
      await client.query('ROLLBACK TO SAVEPOINT copy_rules');
      logger.warn('Failed to copy validation_rules during fork (table may not exist)', {
        error: ruleErr.message, sourceCrfId,
      });
    }

    // 11. Audit log — INSIDE the transaction, on the same client. Two rows:
    //   (a) FORM_FORKED on the destination so the new CRF carries its lineage
    //   (b) FORM_COPIED_OUT on the source so a regulator inspecting the
    //       source CRF can see "this was copied to org X / study Y on date Z"
    // Both are written with the same client so they roll back atomically with
    // the structural copy if anything below fails — no orphan audit rows and
    // no fork-without-audit gaps.
    const isCrossOrg =
      sourceOrgId !== null && targetOrgId !== null && sourceOrgId !== targetOrgId;
    const detailParts = [
      `Copied CRF "${sourceCrf.name}" (ID: ${sourceCrfId}) as "${data.newName}" (ID: ${newCrfId})`,
    ];
    if (sourceOrgName) detailParts.push(`source org: ${sourceOrgName}`);
    if (targetOrgName) detailParts.push(`target org: ${targetOrgName}`);
    if (targetStudyName) detailParts.push(`target study: ${targetStudyName} (ID: ${resolvedTargetStudyId})`);
    if (isCrossOrg) detailParts.push('CROSS-ORGANIZATION COPY');
    const auditDetails = detailParts.join('; ');

    try {
      const forkedTypeId = await resolveAuditEventTypeId(client, 'Form Copied');
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name,
          old_value, new_value, audit_log_event_type_id, reason_for_change
        ) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'crf', userId, newCrfId, data.newName,
        `crf_id=${sourceCrfId}`, `crf_id=${newCrfId}`,
        forkedTypeId, auditDetails,
      ]);

      const copiedOutTypeId = await resolveAuditEventTypeId(client, 'Form Copied To Another Organization');
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name,
          old_value, new_value, audit_log_event_type_id, reason_for_change
        ) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'crf', userId, sourceCrfId, sourceCrf.name,
        `crf_id=${sourceCrfId}`, `crf_id=${newCrfId}`,
        copiedOutTypeId, auditDetails,
      ]);
    } catch (auditError: any) {
      // Audit failure is fatal for a Part 11 system — abort the fork so we
      // never end up with structural data we can't trace.
      await client.query('ROLLBACK');
      logger.error('Failed to record fork audit — fork rolled back', {
        error: auditError.message, sourceCrfId, newCrfId,
      });
      return {
        success: false,
        message: 'Failed to record audit trail for the copy operation; nothing was changed.',
        code: 'ERROR',
      };
    }

    await client.query('COMMIT');

    logger.info('Form forked successfully', {
      sourceCrfId,
      newCrfId,
      newVersionId,
      sourceOrgId,
      targetOrgId,
      crossOrg: isCrossOrg,
      sectionsCopied: Object.keys(sectionMapping).length,
      itemsCopied: itemsResult.rows.length,
      rulesCopied,
      scdCopied,
    });

    const brokenLinks = linkedFormActions.filter(a => a.status === 'broken' || a.status === 'not_found');
    const autoRelinked = linkedFormActions.filter(a => a.status === 'auto_relinked');

    let resultMessage = `Form "${data.newName}" copied successfully.`;
    if (autoRelinked.length > 0) {
      resultMessage += ` ${autoRelinked.length} form link(s) were automatically re-linked to matching forms in the target study.`;
    }
    if (brokenLinks.length > 0) {
      resultMessage += ` ${brokenLinks.length} form link(s) could not be resolved — please review the linkedFormActions for recommended next steps.`;
    }

    return {
      success: true,
      newCrfId,
      message: resultMessage,
      code: 'OK',
      copied: {
        sections: Object.keys(sectionMapping).length,
        itemGroups: Object.keys(itemGroupMapping).length,
        items: itemsResult.rows.length,
        scd: scdCopied,
        validationRules: rulesCopied,
        responseSets: Object.keys(responseSetMapping).length,
      },
      linkedFormActions: linkedFormActions.length > 0 ? linkedFormActions : undefined,
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Fork form error', { error: error.message, sourceCrfId });
    return {
      success: false,
      message: `Failed to fork form: ${error.message}`,
      code: 'ERROR',
    };
  } finally {
    client.release();
  }
};

/**
 * Parse extended_props from an item's description, detect form-link references
 * (linkedFormId, formLinks[].targetFormId), and resolve them:
 *
 *  1. Self-references (linkedFormId === sourceCrfId):
 *     Remap to newCrfId. The form links to itself (e.g. repeating sub-form).
 *
 *  2. External references where a form with the same name exists in the
 *     target study: auto-relink to the matching CRF ID in the target study.
 *
 *  3. External references with no match: mark as broken, clear the ID to
 *     prevent the UI from trying to open a non-existent form, and add
 *     actionable guidance to the `actions` array.
 *
 * Question-table and table column structures are NOT mutated here because
 * they use stable text IDs (not database PKs), so copying them verbatim is
 * correct.
 */
function remapDescriptionFormLinks(
  description: string | null,
  fieldName: string,
  sourceCrfId: number,
  newCrfId: number,
  targetStudyForms: Map<string, { crfId: number; name: string }>,
  actions: Array<{
    fieldName: string;
    fieldLabel?: string;
    originalFormId: number;
    originalFormName?: string;
    status: 'auto_relinked' | 'self_relinked' | 'broken' | 'not_found';
    resolvedFormId?: number;
    resolvedFormName?: string;
    recommendation: string;
  }>
): string | null {
  if (!description) return description;
  const DELIM = '---EXTENDED_PROPS---';
  const delimIdx = description.indexOf(DELIM);
  if (delimIdx < 0) return description;

  const prefix = description.substring(0, delimIdx);
  const jsonStr = description.substring(delimIdx + DELIM.length).trim();
  if (!jsonStr) return description;

  let props: any;
  try {
    props = JSON.parse(jsonStr);
  } catch {
    return description;
  }

  let changed = false;

  function resolveFormRef(
    oldId: number,
    oldName: string | undefined
  ): { newId: number | null; status: 'self_relinked' | 'auto_relinked' | 'broken' | 'not_found' } {
    if (oldId === sourceCrfId) {
      return { newId: newCrfId, status: 'self_relinked' };
    }
    // Try to find a form with the same name in the target study
    if (oldName && targetStudyForms.has(oldName.toLowerCase().trim())) {
      const match = targetStudyForms.get(oldName.toLowerCase().trim())!;
      return { newId: match.crfId, status: 'auto_relinked' };
    }
    return { newId: null, status: oldName ? 'not_found' : 'broken' };
  }

  // Remap linkedFormId (single form link)
  if (props.linkedFormId != null) {
    const oldId = Number(props.linkedFormId);
    if (oldId > 0) {
      const resolved = resolveFormRef(oldId, props.linkedFormName);
      if (resolved.newId) {
        props.linkedFormId = resolved.newId;
        if (resolved.status === 'auto_relinked') {
          const match = targetStudyForms.get((props.linkedFormName || '').toLowerCase().trim());
          props.linkedFormName = match?.name || props.linkedFormName;
        }
        changed = true;
      } else {
        props.linkedFormId = null;
        props._brokenFormLink = {
          originalFormId: oldId,
          originalFormName: props.linkedFormName,
          status: resolved.status,
        };
        changed = true;
      }
      actions.push({
        fieldName,
        fieldLabel: props.fieldName || fieldName,
        originalFormId: oldId,
        originalFormName: props.linkedFormName || undefined,
        status: resolved.status,
        resolvedFormId: resolved.newId ?? undefined,
        resolvedFormName: resolved.newId
          ? (resolved.status === 'auto_relinked'
            ? targetStudyForms.get((props.linkedFormName || '').toLowerCase().trim())?.name
            : undefined)
          : undefined,
        recommendation: resolved.status === 'self_relinked'
          ? 'This form links to itself. The link was automatically updated to point at the new copy.'
          : resolved.status === 'auto_relinked'
          ? `A form named "${props.linkedFormName}" was found in the target study and has been automatically linked.`
          : `The linked form "${props.linkedFormName || `#${oldId}`}" was not found in the target study. ` +
            `Copy that form to the same study, then use the "Relink Forms" feature (PATCH /api/forms/{id}/relink) ` +
            `to reconnect this field. The branching rule is preserved but the link is temporarily disabled.`,
      });
    }
  }

  // Remap formLinks[].targetFormId (array of structured form links)
  if (Array.isArray(props.formLinks)) {
    for (const link of props.formLinks) {
      if (link.targetFormId != null) {
        const oldId = Number(link.targetFormId);
        if (oldId > 0) {
          const resolved = resolveFormRef(oldId, link.targetFormName);
          if (resolved.newId) {
            link.targetFormId = resolved.newId;
            if (resolved.status === 'auto_relinked') {
              const match = targetStudyForms.get((link.targetFormName || '').toLowerCase().trim());
              if (match) link.targetFormName = match.name;
            }
            changed = true;
          } else {
            link._broken = true;
            link._originalTargetFormId = oldId;
            link.targetFormId = null;
            changed = true;
          }
          actions.push({
            fieldName,
            fieldLabel: props.fieldName || fieldName,
            originalFormId: oldId,
            originalFormName: link.targetFormName || link.name || undefined,
            status: resolved.status,
            resolvedFormId: resolved.newId ?? undefined,
            recommendation: resolved.status === 'self_relinked'
              ? `Form link "${link.name || link.id}" (self-reference) was automatically updated.`
              : resolved.status === 'auto_relinked'
              ? `Form link "${link.name || link.id}" was automatically relinked to the matching form in the target study.`
              : `Form link "${link.name || link.id}" references "${link.targetFormName || `form #${oldId}`}" which is not in the target study. ` +
                `Copy that form first, then relink this field using PATCH /api/forms/{id}/relink.`,
          });
        }
      }
    }
  }

  // Remap linkedFormIds[] (array of form ID strings)
  if (Array.isArray(props.linkedFormIds)) {
    props.linkedFormIds = props.linkedFormIds.map((idStr: string) => {
      const oldId = Number(idStr);
      if (oldId === sourceCrfId) { changed = true; return String(newCrfId); }
      return idStr;
    });
  }

  if (!changed) return description;
  return prefix + DELIM + '\n' + JSON.stringify(props);
}

/**
 * Resolve an audit_log_event_type ID by name on the given client (so the
 * lookup participates in the active transaction). Falls back to 1 if the
 * row is missing — the seed-on-startup path normally guarantees presence,
 * but we don't want a missing row to abort an otherwise-good fork.
 */
async function resolveAuditEventTypeId(client: any, name: string): Promise<number> {
  try {
    const r = await client.query(
      `SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = $1 LIMIT 1`,
      [name]
    );
    if (r.rows.length > 0) return r.rows[0].auditLogEventTypeId;
  } catch { /* fall through */ }
  return 1;
}

/**
 * Relink form-link references in a CRF's fields.
 *
 * After a fork, some fields may have broken `linkedFormId` or
 * `formLinks[].targetFormId` references because the linked form wasn't in
 * the target study at fork time. Once the user copies the linked form, they
 * call this endpoint to reconnect the references.
 *
 * Each entry in `relinks` maps an old CRF ID → new CRF ID. The function
 * scans every item in the CRF, parses extended_props, rewrites matching
 * form-link IDs, and clears the `_brokenFormLink` / `_broken` markers.
 *
 * 21 CFR Part 11: an audit row is written for every field that changes.
 */
export const relinkFormLinks = async (
  crfId: number,
  relinks: Array<{ oldFormId: number; newFormId: number; newFormName?: string }>,
  userId: number
): Promise<{
  success: boolean;
  message?: string;
  updatedFields: string[];
}> => {
  logger.info('Relinking form links', { crfId, relinks, userId });

  if (!relinks || relinks.length === 0) {
    return { success: false, message: 'No relink mappings provided', updatedFields: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get latest version
    const verResult = await client.query(
      `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
      [crfId]
    );
    if (verResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'No version found for this CRF', updatedFields: [] };
    }
    const versionId = verResult.rows[0].crfVersionId;

    // Build a fast lookup: oldFormId → { newFormId, newFormName }
    const relinkMap = new Map<number, { newFormId: number; newFormName?: string }>();
    for (const r of relinks) relinkMap.set(r.oldFormId, { newFormId: r.newFormId, newFormName: r.newFormName });

    // Scan all items in this version
    const itemsResult = await client.query(
      `SELECT i.item_id, i.name, i.description
         FROM item i
         INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
        WHERE ifm.crf_version_id = $1`,
      [versionId]
    );

    const DELIM = '---EXTENDED_PROPS---';
    const updatedFields: string[] = [];

    for (const item of itemsResult.rows) {
      if (!item.description || !item.description.includes(DELIM)) continue;

      const delimIdx = item.description.indexOf(DELIM);
      const prefix = item.description.substring(0, delimIdx);
      const jsonStr = item.description.substring(delimIdx + DELIM.length).trim();
      if (!jsonStr) continue;

      let props: any;
      try { props = JSON.parse(jsonStr); } catch { continue; }

      let changed = false;

      // Relink linkedFormId
      if (props.linkedFormId === null && props._brokenFormLink) {
        const oldId = props._brokenFormLink.originalFormId;
        const mapping = relinkMap.get(oldId);
        if (mapping) {
          props.linkedFormId = mapping.newFormId;
          if (mapping.newFormName) props.linkedFormName = mapping.newFormName;
          delete props._brokenFormLink;
          changed = true;
        }
      } else if (props.linkedFormId != null) {
        const mapping = relinkMap.get(Number(props.linkedFormId));
        if (mapping) {
          props.linkedFormId = mapping.newFormId;
          if (mapping.newFormName) props.linkedFormName = mapping.newFormName;
          changed = true;
        }
      }

      // Relink formLinks[]
      if (Array.isArray(props.formLinks)) {
        for (const link of props.formLinks) {
          if (link._broken && link._originalTargetFormId) {
            const mapping = relinkMap.get(link._originalTargetFormId);
            if (mapping) {
              link.targetFormId = mapping.newFormId;
              if (mapping.newFormName) link.targetFormName = mapping.newFormName;
              delete link._broken;
              delete link._originalTargetFormId;
              changed = true;
            }
          } else if (link.targetFormId != null) {
            const mapping = relinkMap.get(Number(link.targetFormId));
            if (mapping) {
              link.targetFormId = mapping.newFormId;
              if (mapping.newFormName) link.targetFormName = mapping.newFormName;
              changed = true;
            }
          }
        }
      }

      if (changed) {
        const newDescription = prefix + DELIM + '\n' + JSON.stringify(props);
        await client.query(
          `UPDATE item SET description = $1 WHERE item_id = $2`,
          [newDescription, item.itemId]
        );
        updatedFields.push(item.name);
      }
    }

    // Audit trail
    if (updatedFields.length > 0) {
      await trackUserAction({
        userId,
        username: '',
        action: 'FORM_UPDATED',
        entityType: 'crf',
        entityId: crfId,
        details: `Relinked form references in ${updatedFields.length} field(s): ${updatedFields.join(', ')}. Mappings: ${relinks.map(r => `#${r.oldFormId}→#${r.newFormId}`).join(', ')}`,
      });
    }

    await client.query('COMMIT');

    return {
      success: true,
      message: updatedFields.length > 0
        ? `Successfully relinked ${updatedFields.length} field(s): ${updatedFields.join(', ')}`
        : 'No fields matched the provided relink mappings',
      updatedFields,
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('relinkFormLinks error', { crfId, error: error.message });
    return { success: false, message: error.message, updatedFields: [] };
  } finally {
    client.release();
  }
};

/**
 * Batch-fork multiple forms into a target study in one operation, then
 * automatically relink all cross-form references between the copied forms.
 *
 * This solves the "Form A links to Form B" problem: if you fork them
 * one-at-a-time, Form A's copy still points at the ORIGINAL Form B. With
 * batch fork, both are copied first, then every `linkedFormId` and
 * `formLinks[].targetFormId` that references another form IN THE BATCH is
 * automatically remapped to its new CRF ID.
 *
 * External references (to forms NOT in the batch) are still reported as
 * `linkedFormActions` with status 'broken' or 'not_found'.
 *
 * The user gets back a summary per form plus a consolidated list of form-link
 * actions across the entire batch.
 */
export const batchForkForms = async (
  sourceCrfIds: number[],
  targetStudyId: number,
  nameMap: Record<number, string>,
  userId: number,
  callerOrgIds: number[] = []
): Promise<{
  success: boolean;
  message: string;
  results: Array<{
    sourceCrfId: number;
    sourceName: string;
    newCrfId?: number;
    newName: string;
    success: boolean;
    error?: string;
    copied?: any;
  }>;
  crossFormRelinks: Array<{ fieldName: string; oldFormId: number; newFormId: number }>;
  linkedFormActions: any[];
}> => {
  logger.info('Batch forking forms', { sourceCrfIds, targetStudyId, userId });

  // Phase 1: Fork each form individually. Collect the old→new CRF ID mapping.
  const crfIdMap = new Map<number, number>(); // oldCrfId → newCrfId
  const results: Array<{
    sourceCrfId: number; sourceName: string; newCrfId?: number;
    newName: string; success: boolean; error?: string; copied?: any;
  }> = [];
  const allLinkedFormActions: any[] = [];

  for (const sourceCrfId of sourceCrfIds) {
    const newName = nameMap[sourceCrfId] || `Copy of ${sourceCrfId}`;
    try {
      const forkResult = await forkForm(
        sourceCrfId,
        { newName, targetStudyId },
        userId,
        callerOrgIds
      );

      // Resolve the source name from the result message or a lookup
      let sourceName = '';
      try {
        const src = await pool.query(`SELECT name FROM crf WHERE crf_id = $1`, [sourceCrfId]);
        sourceName = src.rows[0]?.name || `CRF #${sourceCrfId}`;
      } catch { sourceName = `CRF #${sourceCrfId}`; }

      if (forkResult.success && forkResult.newCrfId) {
        crfIdMap.set(sourceCrfId, forkResult.newCrfId);
      }

      results.push({
        sourceCrfId,
        sourceName,
        newCrfId: forkResult.newCrfId,
        newName,
        success: forkResult.success,
        error: forkResult.success ? undefined : forkResult.message,
        copied: forkResult.copied,
      });

      if (forkResult.linkedFormActions) {
        allLinkedFormActions.push(
          ...forkResult.linkedFormActions.map((a: any) => ({
            ...a,
            sourceCrfId,
            newCrfId: forkResult.newCrfId,
          }))
        );
      }
    } catch (err: any) {
      results.push({
        sourceCrfId,
        sourceName: `CRF #${sourceCrfId}`,
        newName,
        success: false,
        error: err.message,
      });
    }
  }

  // Phase 2: Cross-relink. For every broken/not_found form-link action, check
  // if the referenced form was ALSO in the batch (and thus has a new CRF ID).
  const crossFormRelinks: Array<{ fieldName: string; oldFormId: number; newFormId: number }> = [];

  for (const action of allLinkedFormActions) {
    if ((action.status === 'broken' || action.status === 'not_found') && action.originalFormId) {
      const newTargetId = crfIdMap.get(action.originalFormId);
      if (newTargetId && action.newCrfId) {
        // This linked form WAS in the batch — relink automatically
        try {
          const relinkResult = await relinkFormLinks(
            action.newCrfId,
            [{ oldFormId: action.originalFormId, newFormId: newTargetId }],
            userId
          );
          if (relinkResult.success) {
            crossFormRelinks.push({
              fieldName: action.fieldName,
              oldFormId: action.originalFormId,
              newFormId: newTargetId,
            });
            // Upgrade the action status
            action.status = 'auto_relinked';
            action.resolvedFormId = newTargetId;
            action.recommendation = `Automatically relinked to the batch-copied form (new CRF #${newTargetId}).`;
          }
        } catch (relinkErr: any) {
          logger.warn('Cross-form relink failed during batch fork', {
            crfId: action.newCrfId, oldFormId: action.originalFormId, error: relinkErr.message
          });
        }
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  const stillBroken = allLinkedFormActions.filter(
    (a: any) => a.status === 'broken' || a.status === 'not_found'
  );

  let message = `Batch copy complete: ${successCount}/${sourceCrfIds.length} form(s) copied successfully.`;
  if (crossFormRelinks.length > 0) {
    message += ` ${crossFormRelinks.length} cross-form link(s) were automatically reconnected.`;
  }
  if (stillBroken.length > 0) {
    message += ` ${stillBroken.length} form link(s) still need manual attention (linked forms not in this batch).`;
  }

  return {
    success: successCount > 0,
    message,
    results,
    crossFormRelinks,
    linkedFormActions: allLinkedFormActions,
  };
};

/**
 * Update a single field value in an event_crf with validation
 * 
 * This function:
 * 1. Validates the new value against all applicable rules
 * 2. Creates queries for validation failures if enabled
 * 3. Updates the item_data record
 * 4. Logs to audit trail
 * 
 * Used for real-time validation on field change/blur events.
 * 
 * 21 CFR Part 11 §11.10(e) - Audit trail
 * 21 CFR Part 11 §11.10(h) - Device checks (validation)
 */
export const updateFieldData = async (
  eventCrfId: number,
  fieldName: string,
  value: any,
  userId: number,
  options?: {
    validateOnly?: boolean;  // If true, only validate, don't update
    createQueries?: boolean; // Create queries for validation failures
  }
): Promise<ApiResponse<any>> => {
  logger.info('Updating field data', { eventCrfId, fieldName, userId });

  const client = await pool.connect();

  try {
    // Get event_crf details
    const eventCrfResult = await client.query(`
      SELECT 
        ec.event_crf_id,
        ec.study_subject_id,
        ec.status_id,
        cv.crf_id,
        cv.crf_version_id,
        ss.study_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (eventCrfResult.rows.length === 0) {
      return { success: false, message: 'Form not found' };
    }

    const eventCrf = eventCrfResult.rows[0];

    // Check if locked
    if (eventCrf.statusId === 6) {
      return {
        success: false,
        message: 'Cannot edit data - this record is locked.',
        errors: ['RECORD_LOCKED']
      } as any;
    }

    // Find the item_id for this field — try itemId (numeric), then OID, then
    // display name, then technical fieldName from extended props, then
    // spaces→underscores normalization.
    let itemResult = await client.query(`
      SELECT i.item_id, i.name, i.description
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      WHERE igm.crf_version_id = $1
        AND (
          i.item_id::text = $2
          OR LOWER(i.name) = LOWER($2) 
          OR LOWER(i.oc_oid) = LOWER($2)
          OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2)
        )
      LIMIT 1
    `, [eventCrf.crfVersionId, fieldName]);

    // Fallback: match by technical fieldName stored in extended_props
    if (itemResult.rows.length === 0) {
      const allItems = await client.query(`
        SELECT i.item_id, i.name, i.description
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        WHERE igm.crf_version_id = $1
      `, [eventCrf.crfVersionId]);
      for (const row of allItems.rows) {
        const ext = parseExtendedProps(row.description);
        if (ext.fieldName && ext.fieldName.toLowerCase() === fieldName.toLowerCase()) {
          itemResult = { rows: [row] } as any;
          break;
        }
      }
    }

    if (itemResult.rows.length === 0) {
      return { success: false, message: `Field "${fieldName}" not found in form` };
    }

    const itemId = itemResult.rows[0].itemId;

    // Get current item_data (if exists)
    const existingResult = await client.query(`
      SELECT item_data_id, value FROM item_data
      WHERE event_crf_id = $1 AND item_id = $2 AND deleted = false
      LIMIT 1
    `, [eventCrfId, itemId]);

    const itemDataId = existingResult.rows[0]?.itemDataId;
    const oldValue = existingResult.rows[0]?.value;

    // Get all form data for cross-field validation.
    // Key by technical fieldName (from extended props) AND display name so
    // validation rules can match either way.
    const allDataResult = await client.query(`
      SELECT i.item_id, i.name, i.description, id.value
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 AND id.deleted = false
    `, [eventCrfId]);

    const allFormData: Record<string, any> = {};
    for (const row of allDataResult.rows) {
      allFormData[row.name] = row.value;
      allFormData[`item_${row.itemId}`] = row.value;
      const ext = parseExtendedProps(row.description);
      if (ext.fieldName) allFormData[ext.fieldName] = row.value;
    }
    // Include the new value being validated
    allFormData[fieldName] = value;

    // Validate the field change
    const validationResult = await validationRulesService.validateFieldChange(
      eventCrf.crfId,
      fieldName,
      value,
      allFormData,
      {
        createQueries: options?.createQueries ?? false,
        studyId: eventCrf.studyId,
        subjectId: eventCrf.studySubjectId,
        eventCrfId: eventCrfId,
        itemDataId: itemDataId,
        userId: userId
      }
    );

    // If validate only, return the validation result
    if (options?.validateOnly) {
      return {
        success: validationResult.valid,
        data: {
          valid: validationResult.valid,
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          queryCreated: validationResult.queryCreated
        }
      };
    }

    // If there are hard errors and we should not save, return early
    // (This is configurable - some systems allow saving with warnings but block errors)
    if (!validationResult.valid && validationResult.errors.length > 0) {
      return {
        success: false,
        message: 'Validation failed',
        data: {
          valid: false,
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          queryCreated: validationResult.queryCreated
        }
      } as any;
    }

    // Proceed with update
    await client.query('BEGIN');

    let stringValue: string;
    if (value === null || value === undefined) {
      stringValue = '';
    } else if (typeof value === 'object') {
      stringValue = JSON.stringify(value);
    } else {
      stringValue = String(value);
    }

    // Guard against double-encoded JSON strings (frontend may send pre-serialized JSON)
    if (typeof value === 'string' && value.length > 1) {
      const trimmed = value.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          JSON.parse(trimmed);
          stringValue = trimmed;
        } catch { /* not valid JSON, keep as-is */ }
      }
    }

    // Encrypt if needed
    if (config.encryption?.enableFieldEncryption && stringValue) {
      stringValue = encryptField(stringValue);
    }

    let savedItemDataId: number;

    if (itemDataId) {
      // Update existing
      if (oldValue !== stringValue) {
        await client.query(`
          UPDATE item_data
          SET value = $1, date_updated = NOW(), update_id = $2
          WHERE item_data_id = $3
        `, [stringValue, userId, itemDataId]);

        // Audit trail
        await client.query(`
          INSERT INTO audit_log_event (
            audit_date, audit_table, user_id, entity_id,
            old_value, new_value, audit_log_event_type_id,
            event_crf_id
          ) VALUES (NOW(), 'item_data', $1, $2, $3, $4, 1, $5)
        `, [userId, itemDataId, oldValue, stringValue, eventCrfId]);
      }
      savedItemDataId = itemDataId;
    } else {
      // Insert new (upsert to handle race conditions)
      const insertResult = await client.query(`
        INSERT INTO item_data (
          item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal
        ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)
        ON CONFLICT ON CONSTRAINT pk_item_data_new
        DO UPDATE SET value = EXCLUDED.value, date_updated = NOW(), update_id = EXCLUDED.owner_id
        RETURNING item_data_id
      `, [itemId, eventCrfId, stringValue, userId]);

      savedItemDataId = insertResult.rows[0].itemDataId;

      // Audit trail for creation
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id,
          new_value, audit_log_event_type_id, event_crf_id
        ) VALUES (NOW(), 'item_data', $1, $2, $3, 4, $4)
      `, [userId, savedItemDataId, stringValue, eventCrfId]);
    }

    // Update event_crf timestamp
    await client.query(`
      UPDATE event_crf SET date_updated = NOW(), update_id = $1
      WHERE event_crf_id = $2
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    logger.info('Field data updated', { 
      eventCrfId, 
      fieldName, 
      itemDataId: savedItemDataId,
      hasValidationErrors: !validationResult.valid
    });

    // Post-save: create queries for warning-severity validation failures.
    // The pre-save validateFieldChange above blocked errors but let warnings through.
    // Now that the data is saved, create queries for any warning rules that failed.
    let postSaveQueriesCreated = validationResult.queriesCreated || 0;
    let postSaveWarnings = validationResult.warnings || [];
    if (validationResult.warnings.length > 0 && !validationResult.warnings[0]?.queryId) {
      try {
        const warningValidation = await validationRulesService.validateFieldChange(
          eventCrf.crfId,
          fieldName,
          value,
          allFormData,
          {
            createQueries: true,
            studyId: eventCrf.studyId,
            subjectId: eventCrf.studySubjectId,
            eventCrfId: eventCrfId,
            itemDataId: savedItemDataId,
            itemId: itemId,
            userId: userId
          }
        );
        postSaveQueriesCreated = warningValidation.queriesCreated || 0;
        postSaveWarnings = warningValidation.warnings || [];
      } catch (warnErr: any) {
        logger.warn('Post-save warning query creation failed for field', { 
          fieldName, error: warnErr.message 
        });
      }
    }

    return {
      success: true,
      data: {
        itemDataId: savedItemDataId,
        valid: validationResult.valid,
        errors: validationResult.errors,
        warnings: postSaveWarnings,
        queryCreated: postSaveQueriesCreated > 0,
        queriesCreated: postSaveQueriesCreated
      },
      message: validationResult.valid 
        ? 'Field updated successfully' 
        : 'Field updated with validation warnings'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update field data error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Mark an eCRF instance as data-entry complete.
 *
 * Sets completion_status_id = 4 (complete) and status_id = 2 (data complete).
 * This is a prerequisite for freezing and locking the form.
 *
 * Rules:
 *   - Form must exist and not already be locked (status_id = 6)
 *   - Form must not be frozen (frozen = true); frozen implies it is already
 *     in the lock pipeline and marking complete is redundant
 *   - All required items must have at least one item_data row
 *
 * 21 CFR Part 11 §11.10(e) — the completion action is written to the audit trail.
 */
export const markFormComplete = async (
  eventCrfId: number,
  userId: number,
  hiddenFieldIds?: number[],
  hiddenFields?: string[]
): Promise<{ success: boolean; message: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load current state
    const ecResult = await client.query(`
      SELECT ec.event_crf_id, ec.status_id, ec.completion_status_id,
             COALESCE(ec.frozen, false) AS frozen,
             cv.crf_id, cv.crf_version_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Form instance not found (event_crf_id=${eventCrfId})`);
    }

    const ec = ecResult.rows[0];

    if (ec.statusId === 6) {
      await client.query('ROLLBACK');
      throw new Error('Form is already locked and cannot be modified');
    }
    if (ec.frozen) {
      await client.query('ROLLBACK');
      throw new Error('Form is frozen — it is already in the lock pipeline');
    }
    if (ec.completionStatusId >= 4 && ec.statusId === 2) {
      await client.query('ROLLBACK');
      throw new Error('Form is already marked as complete');
    }

    // 2. Check required fields have data.
    // Fields hidden by branching/skip logic are excluded so they don't block
    // completion. Uses item IDs (primary) with string name fallback.
    const hiddenItemIds: Set<number> = new Set();
    if (hiddenFieldIds && Array.isArray(hiddenFieldIds)) {
      for (const id of hiddenFieldIds) {
        const parsed = typeof id === 'number' ? id : parseInt(String(id), 10);
        if (!isNaN(parsed) && parsed > 0) hiddenItemIds.add(parsed);
      }
    }
    if (hiddenFields && Array.isArray(hiddenFields)) {
      // Resolve string names to item IDs via DB lookup
      for (const hf of hiddenFields) {
        if (!hf) continue;
        const itemLookup = await client.query(
          `SELECT i.item_id FROM item i
           INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
           WHERE ifm.crf_version_id = $1 AND (LOWER(i.name) = LOWER($2))
           LIMIT 1`,
          [ec.crfVersionId, hf]
        );
        if (itemLookup.rows.length > 0) {
          hiddenItemIds.add(itemLookup.rows[0].itemId);
        }
      }
    }

    let missingCount = 0;
    const hiddenIdArray = hiddenItemIds.size > 0 ? Array.from(hiddenItemIds) : [];

    if (hiddenIdArray.length > 0) {
      const result = await client.query(`
        SELECT COUNT(*) AS missing_count
        FROM item_form_metadata ifm
        INNER JOIN item i ON ifm.item_id = i.item_id
        WHERE ifm.crf_version_id = $1
          AND ifm.required = true
          AND i.description NOT LIKE '%"type":"section_header"%'
          AND i.description NOT LIKE '%"type":"static_text"%'
          AND NOT (ifm.item_id = ANY($3::int[]))
          AND NOT EXISTS (
            SELECT 1 FROM item_data id
            WHERE id.item_id = ifm.item_id
              AND id.event_crf_id = $2
              AND id.value IS NOT NULL
              AND TRIM(id.value) <> ''
          )
      `, [ec.crfVersionId, eventCrfId, hiddenIdArray]);
      missingCount = parseInt(result.rows[0]?.missingCount || '0');
    } else {
      const result = await client.query(`
        SELECT COUNT(*) AS missing_count
        FROM item_form_metadata ifm
        INNER JOIN item i ON ifm.item_id = i.item_id
        WHERE ifm.crf_version_id = $1
          AND ifm.required = true
          AND i.description NOT LIKE '%"type":"section_header"%'
          AND i.description NOT LIKE '%"type":"static_text"%'
          AND NOT EXISTS (
            SELECT 1 FROM item_data id
            WHERE id.item_id = ifm.item_id
              AND id.event_crf_id = $2
              AND id.value IS NOT NULL
              AND TRIM(id.value) <> ''
          )
      `, [ec.crfVersionId, eventCrfId]);
      missingCount = parseInt(result.rows[0]?.missingCount || '0');
    }

    if (missingCount > 0) {
      await client.query('ROLLBACK');
      throw new Error(
        `${missingCount} required field${missingCount > 1 ? 's are' : ' is'} missing data. All required fields must be filled before marking complete.`
      );
    }

    // 3. Mark complete
    await client.query(`
      UPDATE event_crf
      SET completion_status_id = 4,
          status_id = 2,
          date_updated = NOW(),
          update_id = $1
      WHERE event_crf_id = $2
    `, [userId, eventCrfId]);

    // 4. Audit trail
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        new_value, audit_log_event_type_id
      ) VALUES (
        NOW(), 'event_crf', $1, $2, 'Form Marked Complete',
        'completion_status_id=4, status_id=2',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, eventCrfId]);

    await client.query('COMMIT');
    logger.info('Form marked complete', { eventCrfId, userId });

    // Auto-advance visit status if all forms in this visit are now complete
    try {
      const seResult = await pool.query(
        `SELECT study_event_id FROM event_crf WHERE event_crf_id = $1`, [eventCrfId]
      );
      if (seResult.rows.length > 0) {
        const { checkAndUpdateVisitStatus } = await import('./event.service');
        await checkAndUpdateVisitStatus(seResult.rows[0].studyEventId);
      }
    } catch (visitErr: any) {
      logger.warn('Failed to auto-update visit status after form completion', { eventCrfId, error: visitErr.message });
    }

    return { success: true, message: 'Form marked as complete and is now eligible for data lock' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('markFormComplete error', { eventCrfId, error: error.message });
    throw new Error(`Failed to mark form complete: ${error.message}`);
  } finally {
    client.release();
  }
};

/**
 * Look up the active organization IDs for a given user.
 * Returns an empty array if the user has no memberships or if the
 * acc_organization_member table doesn't exist (legacy installs).
 */
export const getActiveOrganizationIds = async (userId: number): Promise<number[]> => {
  try {
    const result = await pool.query(
      `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    return result.rows.map((r: any) => r.organizationId);
  } catch {
    return [];
  }
};

export default {
  saveFormData,
  getFormData,
  getFormMetadata,
  getFormStatus,
  validateFormData,
  getStudyForms,
  getAllForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  // 21 CFR Part 11 Archive Functions
  archiveForm,
  restoreForm,
  getArchivedForms,
  // Template Forking Functions
  getFormVersions,
  createFormVersion,
  forkForm,
  batchForkForms,
  relinkFormLinks,
  // Field-level operations
  updateFieldData,
  markFormComplete,
  // Reference data
  getNullValueTypes,
  getMeasurementUnits,
  // Organization membership lookup
  getActiveOrganizationIds
};

