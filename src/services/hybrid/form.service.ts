/**
 * Form Service (Hybrid)
 * 
 * Form data management combining SOAP and Database
 * - Use SOAP for saving form data (GxP compliant with validation)
 * - Use Database for reading form data (faster)
 * 
 * 21 CFR Part 11 §11.10(e) - Audit Trail for document actions
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import * as dataSoap from '../soap/dataSoap.service';
import { FormDataRequest, ApiResponse } from '../../types';
import { trackUserAction, trackDocumentAccess } from '../database/audit.service';
import * as validationRulesService from '../database/validation-rules.service';
import { encryptField, decryptField, isEncrypted } from '../../utils/encryption.util';
import * as workflowService from '../database/workflow.service';

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
  request: FormDataRequest & { 
    formId?: number; 
    data?: Record<string, any>;
    eventId?: number;  // Frontend naming
  },
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data', { 
    studyId: request.studyId,
    subjectId: request.subjectId,
    eventId: request.studyEventDefinitionId || (request as any).eventId,
    crfId: request.crfId || (request as any).formId,
    userId 
  });

  // Handle both naming conventions (frontend uses formId/data/eventId, backend uses crfId/formData/studyEventDefinitionId)
  const crfId = request.crfId || (request as any).formId;
  const formData = request.formData || (request as any).data;
  const eventDefId = request.studyEventDefinitionId || (request as any).eventId;

  // Validate required fields
  if (!request.studyId || !request.subjectId || !eventDefId || !crfId) {
    logger.warn('Missing required fields for form save', {
      studyId: request.studyId,
      subjectId: request.subjectId,
      eventDefId,
      crfId
    });
    return {
      success: false,
      message: 'Missing required fields: studyId, subjectId, eventId/studyEventDefinitionId, formId/crfId'
    };
  }

  // Apply validation rules BEFORE saving
  // Create queries (discrepancy notes) for validation failures
  if (crfId && formData) {
    try {
      // First pass: validate without creating queries to check for hard errors
      const validationResult = await validationRulesService.validateFormData(
        crfId,
        formData,
        {
          createQueries: true,  // Create queries for validation failures
          studyId: request.studyId,
          subjectId: request.subjectId,
          userId: userId
        }
      );

      // If there are hard edit errors, block the save
      if (!validationResult.valid && validationResult.errors.length > 0) {
        logger.warn('Form data validation failed - queries created', { 
          crfId, 
          errors: validationResult.errors,
          queriesCreated: validationResult.queriesCreated
        });
        
        return {
          success: false,
          message: 'Validation failed',
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          queriesCreated: validationResult.queriesCreated
        } as any;
      }

      // Log warnings but continue with save
      if (validationResult.warnings.length > 0) {
        logger.info('Form data validation warnings', { 
          crfId, 
          warnings: validationResult.warnings 
        });
      }
    } catch (validationError: any) {
      // Don't block save if validation service fails
      logger.warn('Validation check failed, proceeding with save', { 
        error: validationError.message 
      });
    }
  }

  // Normalize request for SOAP service
  const normalizedRequest: FormDataRequest = {
    studyId: request.studyId,
    subjectId: request.subjectId,
    studyEventDefinitionId: eventDefId,
    crfId: crfId,
    formData: formData || {}
  };

  // Try SOAP service first for GxP-compliant data entry
  try {
    const soapResult = await dataSoap.importData(normalizedRequest, userId, username);
    if (soapResult.success) {
      return soapResult;
    }
    logger.warn('SOAP import failed, falling back to database', { error: soapResult.message });
  } catch (soapError: any) {
    logger.warn('SOAP service unavailable, falling back to database', { error: soapError.message });
  }

  // Fallback: Direct database insert for data entry
  // This maintains audit trail compliance by using the existing LibreClinica tables
  return await saveFormDataDirect(normalizedRequest, userId, username);
};

/**
 * Direct database save fallback for form data
 * Uses LibreClinica's existing tables: event_crf, item_data
 * 21 CFR Part 11 compliant with proper audit logging
 */
const saveFormDataDirect = async (
  request: FormDataRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data directly to database', {
    studyId: request.studyId,
    subjectId: request.subjectId,
    crfId: request.crfId
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Find or create the study_event for this subject and event definition
    let studyEventId: number | null = null;
    const studyEventResult = await client.query(`
      SELECT se.study_event_id 
      FROM study_event se
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_subject_id = $1 
        AND se.study_event_definition_id = $2
      ORDER BY se.sample_ordinal DESC
      LIMIT 1
    `, [request.subjectId, request.studyEventDefinitionId]);

    if (studyEventResult.rows.length > 0) {
      studyEventId = studyEventResult.rows[0].study_event_id;
    } else {
      // Create the study event
      const createEventResult = await client.query(`
        INSERT INTO study_event (
          study_event_definition_id, study_subject_id, sample_ordinal,
          date_start, owner_id, status_id, subject_event_status_id, date_created
        ) VALUES ($1, $2, 1, CURRENT_DATE, $3, 1, 3, NOW())
        RETURNING study_event_id
      `, [request.studyEventDefinitionId, request.subjectId, userId]);
      studyEventId = createEventResult.rows[0].study_event_id;
      logger.info('Created study event', { studyEventId });
    }

    // 2. Get the CRF version
    const crfVersionResult = await client.query(`
      SELECT crf_version_id FROM crf_version
      WHERE crf_id = $1 AND status_id = 1
      ORDER BY crf_version_id DESC
      LIMIT 1
    `, [request.crfId]);

    if (crfVersionResult.rows.length === 0) {
      throw new Error(`No active version found for CRF ${request.crfId}`);
    }
    const crfVersionId = crfVersionResult.rows[0].crf_version_id;

    // 3. Find or create the event_crf
    let eventCrfId: number | null = null;
    const eventCrfResult = await client.query(`
      SELECT event_crf_id FROM event_crf
      WHERE study_event_id = $1 AND crf_version_id = $2
      LIMIT 1
    `, [studyEventId, crfVersionId]);

    if (eventCrfResult.rows.length > 0) {
      eventCrfId = eventCrfResult.rows[0].event_crf_id;
      
      // CHECK IF RECORD IS LOCKED - status_id = 6 means locked
      // This is critical for 21 CFR Part 11 compliance (§11.10(d))
      const lockCheckResult = await client.query(`
        SELECT status_id FROM event_crf WHERE event_crf_id = $1
      `, [eventCrfId]);
      
      if (lockCheckResult.rows.length > 0 && lockCheckResult.rows[0].status_id === 6) {
        await client.query('ROLLBACK');
        logger.warn('Attempted to edit locked record', { eventCrfId, userId });
        return {
          success: false,
          message: 'Cannot edit data - this record is locked. Request an unlock through the Data Lock Management system.',
          errors: ['RECORD_LOCKED']
        };
      }
    } else {
      // Create the event_crf
      const createEventCrfResult = await client.query(`
        INSERT INTO event_crf (
          study_event_id, crf_version_id, study_subject_id,
          date_interviewed, interviewer_name,
          completion_status_id, status_id, owner_id, date_created
        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 1, 1, $5, NOW())
        RETURNING event_crf_id
      `, [studyEventId, crfVersionId, request.subjectId, username, userId]);
      eventCrfId = createEventCrfResult.rows[0].event_crf_id;
      logger.info('Created event_crf', { eventCrfId });
    }

    // 4. Get item mappings for this CRF version
    const itemsResult = await client.query(`
      SELECT i.item_id, i.name, i.oc_oid
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      WHERE igm.crf_version_id = $1
    `, [crfVersionId]);

    const itemMap = new Map<string, number>();
    for (const item of itemsResult.rows) {
      itemMap.set(item.name.toLowerCase(), item.item_id);
      if (item.oc_oid) {
        itemMap.set(item.oc_oid.toLowerCase(), item.item_id);
      }
    }

    // 5. Save each form field value to item_data
    let savedCount = 0;
    const formData = request.formData || {};

    for (const [fieldName, value] of Object.entries(formData)) {
      if (value === null || value === undefined || value === '') continue;

      // Find the item_id for this field
      const itemId = itemMap.get(fieldName.toLowerCase());
      if (!itemId) {
        logger.debug('Field not found in CRF, skipping', { fieldName });
        continue;
      }

      // Check if item_data already exists
      const existingResult = await client.query(`
        SELECT item_data_id, value FROM item_data
        WHERE event_crf_id = $1 AND item_id = $2
        LIMIT 1
      `, [eventCrfId, itemId]);

      let stringValue = String(value);
      
      // 21 CFR Part 11 §11.10(a) - Encrypt sensitive form data at rest
      // Only encrypt if field-level encryption is enabled
      if (config.encryption?.enableFieldEncryption) {
        stringValue = encryptField(stringValue);
      }

      if (existingResult.rows.length > 0) {
        // Update existing
        const oldValue = existingResult.rows[0].value;
        if (oldValue !== stringValue) {
          await client.query(`
            UPDATE item_data
            SET value = $1, date_updated = NOW(), update_id = $2
            WHERE item_data_id = $3
          `, [stringValue, userId, existingResult.rows[0].item_data_id]);

          // Log change to audit trail
          await client.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_id,
              old_value, new_value, audit_log_event_type_id,
              event_crf_id
            ) VALUES (NOW(), 'item_data', $1, $2, $3, $4, 1, $5)
          `, [userId, existingResult.rows[0].item_data_id, oldValue, stringValue, eventCrfId]);
        }
      } else {
        // Insert new
        const insertResult = await client.query(`
          INSERT INTO item_data (
            item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal
          ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)
          RETURNING item_data_id
        `, [itemId, eventCrfId, stringValue, userId]);

        // Log creation to audit trail
        await client.query(`
          INSERT INTO audit_log_event (
            audit_date, audit_table, user_id, entity_id,
            new_value, audit_log_event_type_id, event_crf_id
          ) VALUES (NOW(), 'item_data', $1, $2, $3, 4, $4)
        `, [userId, insertResult.rows[0].item_data_id, stringValue, eventCrfId]);
      }

      savedCount++;
    }

    // 6. Update event_crf completion status
    await client.query(`
      UPDATE event_crf
      SET completion_status_id = 2, date_updated = NOW(), update_id = $1
      WHERE event_crf_id = $2
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    logger.info('Form data saved directly to database', {
      eventCrfId,
      savedCount,
      totalFields: Object.keys(formData).length
    });

    // 7. AUTO-TRIGGER WORKFLOW: Create SDV task for completed form (Real EDC workflow)
    // This automatically creates a workflow task when form data is saved
    try {
      // Get form details for workflow creation
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
        const formName = formDetailsResult.rows[0].form_name;
        const subjectId = formDetailsResult.rows[0].subject_id;
        
        // Trigger SDV workflow automatically
        await workflowService.triggerFormSubmittedWorkflow(
          eventCrfId!,
          request.studyId,
          subjectId,
          formName,
          userId
        );
        
        logger.info('Auto-triggered SDV workflow for form submission', { eventCrfId, formName });
      }
    } catch (workflowError: any) {
      // Don't fail the form save if workflow creation fails
      logger.warn('Failed to auto-create workflow for form submission', { error: workflowError.message });
    }

    return {
      success: true,
      data: { eventCrfId, savedCount },
      message: `Form data saved successfully (${savedCount} fields)`
    };
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
    const isLocked = lockResult.rows.length > 0 && lockResult.rows[0].status_id === 6;
    const lockInfo = isLocked ? {
      locked: true,
      lockedAt: lockResult.rows[0].lock_date,
      lockedBy: lockResult.rows[0].locked_by
    } : { locked: false };

    const query = `
      SELECT 
        id.item_data_id,
        i.name as item_name,
        i.oc_oid as item_oid,
        id.value,
        id.status_id,
        id.date_created,
        id.date_updated,
        u.user_name as entered_by
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      LEFT JOIN user_account u ON id.owner_id = u.user_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
      ORDER BY i.name
    `;

    const result = await pool.query(query, [eventCrfId]);

    // 21 CFR Part 11 §11.10(a) - Decrypt encrypted form data
    // Transparently decrypt any encrypted values before returning
    const decryptedRows = result.rows.map(row => {
      if (row.value && isEncrypted(row.value)) {
        try {
          return { ...row, value: decryptField(row.value) };
        } catch (decryptError: any) {
          logger.error('Failed to decrypt form field', { 
            itemDataId: row.item_data_id, 
            error: decryptError.message 
          });
          // Return encrypted value with marker for troubleshooting
          return { ...row, value: '[DECRYPTION_ERROR]', encryptedValue: row.value };
        }
      }
      return row;
    });

    // Return data with lock status for UI to respect
    return {
      data: decryptedRows,
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
export const getFormMetadata = async (crfId: number): Promise<any> => {
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
    const versionId = versionResult.rows[0]?.crf_version_id;

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
        igm.ordinal,
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
      const conditions = scdByItemId.get(scd.target_item_id) || [];
      
      // Parse operator from message field (stored as JSON by our API)
      let operator = 'equals';
      let message = scd.message || '';
      try {
        const parsed = JSON.parse(scd.message);
        if (parsed && parsed.operator) {
          operator = parsed.operator;
          message = parsed.message || '';
        }
      } catch {
        // Not JSON - legacy plain text message, default to equals
      }
      
      conditions.push({
        fieldId: scd.control_field_name || scd.control_item_name,
        operator,
        value: scd.option_value,
        message
      });
      scdByItemId.set(scd.target_item_id, conditions);
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
      if (nullValueResult.rows.length > 0 && nullValueResult.rows[0].null_values) {
        // Get the full null_value_type definitions for the allowed codes
        const codes = nullValueResult.rows[0].null_values.split(',').map((c: string) => c.trim());
        const nvtQuery = `SELECT null_value_type_id, code, name, definition FROM null_value_type WHERE code = ANY($1) ORDER BY null_value_type_id`;
        const nvtResult = await pool.query(nvtQuery, [codes]);
        allowedNullValues = nvtResult.rows.map((nv: any) => ({
          id: nv.null_value_type_id,
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
        id: nv.null_value_type_id,
        code: nv.code,
        name: nv.name,
        definition: nv.definition
      }));
    } catch (e: any) {
      // Not critical
    }

    // Parse items with all properties including extended props
    const items = itemsResult.rows.map(item => {
      // Parse options
      let options = null;
      if (item.options_text && item.options_values) {
        const labels = item.options_text.split(',');
        const values = item.options_values.split(',');
        options = labels.map((label: string, idx: number) => ({
          label: label.trim(),
          value: values[idx]?.trim() || label.trim()
        }));
      }
      
      // Parse description for help text and extended properties
      let helpText = item.description || '';
      let extendedProps: any = {};
      
      if (helpText.includes('---EXTENDED_PROPS---')) {
        const parts = helpText.split('---EXTENDED_PROPS---');
        helpText = parts[0].trim();
        try {
          extendedProps = JSON.parse(parts[1].trim());
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      // Parse min/max from width_decimal if present
      let min = extendedProps.min;
      let max = extendedProps.max;
      if (item.width_decimal && item.width_decimal.includes(',')) {
        const [minVal, maxVal] = item.width_decimal.split(',');
        if (minVal && !isNaN(Number(minVal))) min = Number(minVal);
        if (maxVal && !isNaN(Number(maxVal))) max = Number(maxVal);
      }
      
      // Build validation rules array
      const validationRules: any[] = [];
      if (item.required) {
        validationRules.push({ type: 'required', message: 'This field is required' });
      }
      if (item.validation_pattern) {
        // Detect Excel formula rules stored with =FORMULA: prefix
        const isFormula = item.validation_pattern.startsWith('=FORMULA:');
        const patternValue = isFormula 
          ? item.validation_pattern.substring(9) // Strip =FORMULA: prefix
          : item.validation_pattern;
        validationRules.push({ 
          type: isFormula ? 'formula' : 'pattern', 
          value: patternValue,
          message: item.validation_message || 'Invalid format'
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
      const fieldType = extendedProps.type 
        || mapResponseTypeToFieldType(item.response_type) 
        || item.data_type_code?.toLowerCase() 
        || 'text';
      
      return {
        // Core identifiers
        id: item.item_id?.toString(),
        item_id: item.item_id,
        name: item.name,
        oc_oid: item.oc_oid,
        
        // Type info
        type: fieldType,
        data_type: item.data_type,
        data_type_code: item.data_type_code,
        response_type: item.response_type,
        
        // Display
        label: item.name,
        description: helpText,
        helpText: helpText,
        placeholder: item.placeholder || '',
        
        // State
        required: item.required || false,
        readonly: extendedProps.readonly || false,
        hidden: item.show_item === false,
        
        // Value
        defaultValue: item.default_value,
        
        // Validation
        validationRules,
        validationPattern: item.validation_pattern,
        validationMessage: item.validation_message,
        
        // Options
        options,
        
        // Layout
        ordinal: item.ordinal,
        order: item.ordinal,
        section: item.section_name,
        group_name: item.group_name,
        width: extendedProps.width || 'full',
        columnPosition: item.column_number || extendedProps.columnPosition || 1,
        columnNumber: item.column_number || 1,
        groupId: extendedProps.groupId,
        
        // Clinical
        unit: item.units || extendedProps.unit,
        units: item.units,
        min,
        max,
        format: extendedProps.format,
        
        // PHI and Compliance
        isPhiField: item.phi_status || extendedProps.isPhiField || false,
        phi_status: item.phi_status,
        phiClassification: extendedProps.phiClassification,
        auditRequired: extendedProps.auditRequired || false,
        criticalDataPoint: extendedProps.criticalDataPoint || false,
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
        showWhen: (extendedProps.showWhen && extendedProps.showWhen.length > 0) 
          ? extendedProps.showWhen 
          : (scdByItemId.get(item.item_id) || []),
        hideWhen: extendedProps.hideWhen || [],
        requiredWhen: extendedProps.requiredWhen,
        conditionalLogic: extendedProps.conditionalLogic,
        visibilityConditions: extendedProps.visibilityConditions,
        // Flag to indicate if using LibreClinica native SCD
        hasNativeScd: scdByItemId.has(item.item_id),
        
        // Form Linking / Branch to Another Form
        linkedFormId: extendedProps.linkedFormId,
        linkedFormName: extendedProps.linkedFormName,
        linkedFormTriggerValue: extendedProps.linkedFormTriggerValue,
        linkedFormRequired: extendedProps.linkedFormRequired,
        formLinks: extendedProps.formLinks,
        
        // Custom
        customAttributes: extendedProps.customAttributes,
        
        // Table field properties
        tableColumns: extendedProps.tableColumns,
        tableSettings: extendedProps.tableSettings
      };
    });

    // Get decision conditions (forking/branching) from LibreClinica
    // decision_condition table handles form/section branching based on values
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
          dcp.comparison_operator,
          dcp.value as comparison_value,
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
          dcsu.replacement_value
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
        if (!dcMap.has(row.decision_condition_id)) {
          dcMap.set(row.decision_condition_id, {
            id: row.decision_condition_id,
            label: row.label,
            comments: row.comments,
            quantity: row.quantity,
            type: row.type,
            conditions: [],
            actions: []
          });
        }
        
        const dc = dcMap.get(row.decision_condition_id)!;
        
        // Add condition primitive
        if (row.dc_primitive_id && !dc.conditions.some((c: any) => c.primitiveId === row.dc_primitive_id)) {
          dc.conditions.push({
            primitiveId: row.dc_primitive_id,
            itemId: row.item_id,
            itemName: row.item_name,
            itemOid: row.item_oid,
            operator: row.comparison_operator,
            value: row.comparison_value,
            dynamicValueItemId: row.dynamic_value_item_id
          });
        }
        
        // Add action - section show/hide
        if (row.section_id && !dc.actions.some((a: any) => a.sectionId === row.section_id)) {
          dc.actions.push({
            type: 'section',
            sectionId: row.section_id,
            sectionLabel: row.section_label
          });
        }
        
        // Add action - computed/calculation
        if (row.dc_summary_event_id && !dc.actions.some((a: any) => a.summaryEventId === row.dc_summary_event_id)) {
          dc.actions.push({
            type: 'calculation',
            summaryEventId: row.dc_summary_event_id,
            targetItemId: row.item_target_id
          });
        }
        
        // Add action - substitution
        if (row.substitution_item_id && !dc.actions.some((a: any) => a.substitutionItemId === row.substitution_item_id)) {
          dc.actions.push({
            type: 'substitution',
            substitutionItemId: row.substitution_item_id,
            replacementValue: row.replacement_value
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
      id: nv.null_value_type_id,
      code: nv.code,
      name: nv.name,
      definition: nv.definition || nv.name
    }));
  } catch (error: any) {
    logger.warn('Could not load null value types', { error: error.message });
    return [];
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
    logger.warn('Could not load measurement units', { error: error.message });
    return [];
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
        ec.completion_status_id,
        cs.name as completion_status,
        ec.date_created,
        ec.date_updated,
        u1.user_name as created_by,
        u2.user_name as updated_by,
        ec.validator_id,
        u3.user_name as validated_by,
        ec.date_validate,
        ec.sdv_status
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

    return result.rows[0];
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

    // Filter out archived forms (status_id 5=removed, 6=archived) for 21 CFR Part 11 compliance
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
        AND c.status_id NOT IN (5, 6)
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
 */
export const getAllForms = async (userId?: number): Promise<any[]> => {
  logger.info('Getting all forms', { userId });

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
      const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

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
        (SELECT MAX(revision_notes) FROM crf_version WHERE crf_id = c.crf_id) as latest_version
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.status_id IN (1, 2)
      ${orgFilter}
      ORDER BY c.date_created DESC, c.name
    `;

    const result = await pool.query(query, params);
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
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.crf_id = $1
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
      const callerOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

      if (callerOrgIds.length > 0) {
        const form = result.rows[0];
        const ownerIds = [form.owner_id];
        // Also check study owner if the form is linked to a study
        if (form.source_study_id) {
          const studyOwner = await pool.query(`SELECT owner_id FROM study WHERE study_id = $1`, [form.source_study_id]);
          if (studyOwner.rows.length > 0) ownerIds.push(studyOwner.rows[0].owner_id);
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
const mapFieldTypeToDataType = (fieldType: string): number => {
  const typeMap: Record<string, number> = {
    'text': 5,      // ST - Character String
    'textarea': 5,  // ST - Character String
    'email': 5,     // ST - Character String
    'phone': 5,     // ST - Character String
    'number': 6,    // INT - Integer
    'integer': 6,   // INT - Integer
    'decimal': 7,   // REAL - Floating
    'float': 7,     // REAL - Floating
    'date': 9,      // DATE
    'pdate': 10,    // PDATE - Partial date
    'checkbox': 1,  // BL - Boolean
    'radio': 5,     // ST - stored as string
    'select': 5,    // ST - stored as string
    'file': 11,     // FILE
    'table': 5      // ST - Table data stored as JSON string
  };
  return typeMap[fieldType?.toLowerCase()] || 5; // Default to ST (string)
};

/**
 * Validation rule interface
 */
interface ValidationRule {
  type: string;
  value?: any;
  message?: string;
}

/**
 * Conditional rule interface
 */
interface ConditionalRule {
  fieldId: string;
  operator: string;
  value: any;
}

/**
 * Form field option interface
 */
interface FormFieldOption {
  label: string;
  value: string;
  order?: number;
}

/**
 * Form field interface - COMPLETE match to frontend FormField model
 */
interface FormField {
  // Core identifiers
  id?: string;
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
  validationRules?: ValidationRule[];
  
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
  section?: string;
  groupId?: string;
  
  // Calculated Fields
  calculationFormula?: string;
  dependsOn?: string[];
  
  // Conditional Logic / Branching
  showWhen?: ConditionalRule[];
  hideWhen?: ConditionalRule[];
  requiredWhen?: ConditionalRule[];
  conditionalLogic?: any[];
  visibilityConditions?: any[];
  
  // Form Linking / Branch to Another Form
  linkedFormId?: number | string;
  linkedFormName?: string;
  linkedFormTriggerValue?: any;
  linkedFormRequired?: boolean;
  formLinks?: any[];
  
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
  
  // Table field properties
  tableColumns?: any[];
  tableSettings?: Record<string, any>;
}

/**
 * Serialize extended field properties to JSON for storage
 */
const serializeExtendedProperties = (field: FormField): string => {
  const extended = {
    // Field type (preserves types like 'yesno', 'textarea', 'radio' that map to LibreClinica types)
    type: field.type,
    
    // PHI and Compliance
    isPhiField: field.isPhiField,
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
    unit: field.unit,
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
    
    // Table field properties
    tableColumns: field.tableColumns,
    tableSettings: field.tableSettings
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
const mapFieldTypeToResponseType = (fieldType: string): number => {
  const typeMap: Record<string, number> = {
    // Basic types (1-7)
    'text': 1,
    'textarea': 2,
    'checkbox': 3,
    'file': 4,
    'image': 4,        // images also use file response type
    'radio': 5,
    'select': 6,
    'dropdown': 6,
    'multiselect': 7,
    'multi-select': 7,
    
    // Calculated types (8-9)
    'calculation': 8,
    'calculated': 8,
    'bmi': 8,          // BMI is a calculated field
    'bsa': 8,          // Body Surface Area
    'egfr': 8,         // eGFR calculation
    'age': 8,          // Age calculation
    'group_calculation': 9,
    'group-calculation': 9,
    'sum': 9,          // Sum across repeating group
    'average': 9,      // Average across group
    
    // Instant/Barcode (10)
    'instant': 10,
    'barcode': 10,
    'qrcode': 10,
    
    // Clinical field aliases map to appropriate types
    'integer': 1,
    'decimal': 1,
    'number': 1,
    'date': 1,
    'datetime': 1,
    'time': 1,
    'email': 1,
    'phone': 1,
    'height': 1,
    'weight': 1,
    'temperature': 1,
    'heart_rate': 1,
    'blood_pressure': 1,
    'oxygen_saturation': 1,
    'respiration_rate': 1,
    'yesno': 5,        // Yes/No uses radio type
    
    // Table type - uses a special response type for repeating/grid data
    'table': 11        // Table field (repeating group with structure)
  };
  return typeMap[fieldType?.toLowerCase()] || 1;
};

/**
 * Map LibreClinica response_type name back to field type
 * Used when loading form metadata to determine the frontend field type
 */
const mapResponseTypeToFieldType = (responseType: string | null | undefined): string | null => {
  if (!responseType) return null;
  
  const normalizedType = responseType.toLowerCase();
  
  const typeMap: Record<string, string> = {
    'text': 'text',
    'textarea': 'textarea',
    'checkbox': 'checkbox',
    'file': 'file',
    'radio': 'radio',
    'single-select': 'select',
    'select': 'select',
    'dropdown': 'select',
    'multi-select': 'multiselect',
    'multiselect': 'multiselect',
    'calculation': 'calculation',
    'group-calculation': 'calculation',
    'instant-calculation': 'barcode',
    'barcode': 'barcode',
    'table': 'table',
    'repeating': 'table',
    'grid': 'table'
  };
  
  return typeMap[normalizedType] || null;
};

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

    const crfId = crfResult.rows[0].crf_id;

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

    const crfVersionId = versionResult.rows[0].crf_version_id;

    // Create fields if provided
    if (data.fields && data.fields.length > 0) {
      // Create a default section for the form
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
      const sectionId = sectionResult.rows[0].section_id;

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

      const itemGroupId = itemGroupResult.rows[0].item_group_id;

      // Create each field as an item with full metadata
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
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
          field.unit || '', // Clinical units
          field.isPhiField || false, // PHI status
          dataTypeId,
          userId,
          itemOid
        ]);

        const itemId = itemResult.rows[0].item_id;

        // Link item to item_group via item_group_metadata
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
          field.order || (i + 1)
        ]);

        // Create response_set for fields with options (select, radio, checkbox)
        let responseSetId = 1; // Default to text response type
        if (field.options && field.options.length > 0) {
          const optionsText = field.options.map(o => o.label).join(',');
          const optionsValues = field.options.map(o => o.value).join(',');
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
          responseSetId = responseSetResult.rows[0].response_set_id;
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
          responseSetId = responseSetResult.rows[0].response_set_id;
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
          sectionId,
          responseSetId,
          field.order || (i + 1),
          field.placeholder || '',
          field.required || field.isRequired || false,
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
          // Get the target item_form_metadata_id for this field
          const targetIfmResult = await client.query(`
            SELECT ifm.item_form_metadata_id
            FROM item_form_metadata ifm
            INNER JOIN item i ON ifm.item_id = i.item_id
            WHERE ifm.crf_version_id = $1 AND i.name = $2
            LIMIT 1
          `, [crfVersionId, field.label || field.name]);
          
          if (targetIfmResult.rows.length > 0) {
            const targetIfmId = targetIfmResult.rows[0].item_form_metadata_id;
            
            for (const condition of field.showWhen) {
              // Find the control item's item_form_metadata_id by field name
              const controlIfmResult = await client.query(`
                SELECT ifm.item_form_metadata_id, i.name
                FROM item_form_metadata ifm
                INNER JOIN item i ON ifm.item_id = i.item_id
                WHERE ifm.crf_version_id = $1 AND i.name = $2
                LIMIT 1
              `, [crfVersionId, condition.fieldId]);
              
              const controlIfmId = controlIfmResult.rows[0]?.item_form_metadata_id || null;
              const controlItemName = condition.fieldId || '';
              
              // Store operator metadata in message field as JSON so non-equals operators survive round-trip
              // SCD natively only supports equality, so we encode the operator in the message
              const scdMessage = JSON.stringify({
                operator: condition.operator || 'equals',
                message: (condition as any).message || ''
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

    logger.info('Form template created successfully', { 
      crfId, 
      name: data.name,
      fieldCount: data.fields?.length || 0
    });

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

      const crfVersionId = versionResult.rows[0].crf_version_id;

      // Get existing section or create one
      let sectionResult = await client.query(`
        SELECT section_id FROM section
        WHERE crf_version_id = $1
        ORDER BY ordinal
        LIMIT 1
      `, [crfVersionId]);

      let sectionId: number;
      if (sectionResult.rows.length === 0) {
        // Create section
        const newSectionResult = await client.query(`
          INSERT INTO section (
            crf_version_id, status_id, label, title, ordinal, owner_id, date_created
          ) VALUES (
            $1, 1, $2, $3, 1, $4, NOW()
          )
          RETURNING section_id
        `, [crfVersionId, data.category || 'Form Fields', data.name || 'Form', userId]);
        sectionId = newSectionResult.rows[0].section_id;
      } else {
        sectionId = sectionResult.rows[0].section_id;
      }

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
        const crfOid = crfOidResult.rows[0]?.oc_oid || `CRF_${crfId}`;
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
        itemGroupId = newGroupResult.rows[0].item_group_id;
      } else {
        itemGroupId = itemGroupResult.rows[0].item_group_id;
      }

      // Get existing items for this form
      const existingItemsResult = await client.query(`
        SELECT i.item_id, i.name, i.oc_oid
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        WHERE igm.crf_version_id = $1
      `, [crfVersionId]);

      const existingItems = new Map(existingItemsResult.rows.map(row => [row.name, row]));

      // Get CRF OID for generating item OIDs
      const crfOidResult = await client.query(`SELECT oc_oid FROM crf WHERE crf_id = $1`, [crfId]);
      const ocOid = crfOidResult.rows[0]?.oc_oid || `CRF_${crfId}`;

      // Process each field
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        const fieldName = field.label || field.name || `Field ${i + 1}`;
        const existingItem = existingItems.get(fieldName);
        
        // Serialize extended properties
        const extendedProps = serializeExtendedProperties(field);
        let description = field.helpText || field.description || '';
        if (extendedProps) {
          description = description ? `${description}\n---EXTENDED_PROPS---\n${extendedProps}` : `---EXTENDED_PROPS---\n${extendedProps}`;
        }

        const dataTypeId = mapFieldTypeToDataType(field.type);

        let itemId: number;

        if (existingItem) {
          // Update existing item
          await client.query(`
            UPDATE item
            SET description = $1, units = $2, phi_status = $3, item_data_type_id = $4, date_updated = NOW()
            WHERE item_id = $5
          `, [description, field.unit || '', field.isPhiField || false, dataTypeId, existingItem.item_id]);
          itemId = existingItem.item_id;
          existingItems.delete(fieldName); // Mark as processed
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
          `, [fieldName, description, field.unit || '', field.isPhiField || false, dataTypeId, userId, itemOid]);
          itemId = newItemResult.rows[0].item_id;

          // Link to item group
          await client.query(`
            INSERT INTO item_group_metadata (
              item_group_id, crf_version_id, item_id, ordinal, show_group, repeating_group
            ) VALUES (
              $1, $2, $3, $4, true, false
            )
          `, [itemGroupId, crfVersionId, itemId, field.order || (i + 1)]);
        }

        // Handle response set - ALWAYS create one for every field
        let responseSetId: number;
        const responseTypeId = mapFieldTypeToResponseType(field.type);
        
        // Check for existing response set from item_form_metadata
        const existingRsResult = await client.query(`
          SELECT response_set_id FROM item_form_metadata
          WHERE item_id = $1 AND crf_version_id = $2
        `, [itemId, crfVersionId]);

        if (existingRsResult.rows.length > 0 && existingRsResult.rows[0].response_set_id) {
          // Update existing response set
          if (field.options && field.options.length > 0) {
            const optionsText = field.options.map((o: any) => o.label).join(',');
            const optionsValues = field.options.map((o: any) => o.value).join(',');
            await client.query(`
              UPDATE response_set
              SET options_text = $1, options_values = $2, response_type_id = $3
              WHERE response_set_id = $4
            `, [optionsText, optionsValues, responseTypeId, existingRsResult.rows[0].response_set_id]);
          }
          responseSetId = existingRsResult.rows[0].response_set_id;
        } else {
          // Create new response set (required for all fields, not just option fields)
          if (field.options && field.options.length > 0) {
            const optionsText = field.options.map((o: any) => o.label).join(',');
            const optionsValues = field.options.map((o: any) => o.value).join(',');
            const rsResult = await client.query(`
              INSERT INTO response_set (response_type_id, label, options_text, options_values, version_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING response_set_id
            `, [responseTypeId, field.label, optionsText, optionsValues, crfVersionId]);
            responseSetId = rsResult.rows[0].response_set_id;
          } else {
            // Create basic response set for non-option fields
            const rsResult = await client.query(`
              INSERT INTO response_set (response_type_id, label, version_id)
              VALUES ($1, $2, $3)
              RETURNING response_set_id
            `, [responseTypeId, field.label || 'Field', crfVersionId]);
            responseSetId = rsResult.rows[0].response_set_id;
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

        // Update or create item_form_metadata
        const existingMetaResult = await client.query(`
          SELECT 1 FROM item_form_metadata WHERE item_id = $1 AND crf_version_id = $2
        `, [itemId, crfVersionId]);

        if (existingMetaResult.rows.length > 0) {
          await client.query(`
            UPDATE item_form_metadata
            SET response_set_id = $1, ordinal = $2, left_item_text = $3, required = $4,
                default_value = $5, regexp = $6, regexp_error_msg = $7, show_item = $8, width_decimal = $9
            WHERE item_id = $10 AND crf_version_id = $11
          `, [
            responseSetId, field.order || (i + 1), field.placeholder || '',
            field.required || field.isRequired || false,
            field.defaultValue !== undefined ? String(field.defaultValue) : null,
            regexpPattern, regexpErrorMsg,
            field.hidden !== true && field.isHidden !== true,
            widthDecimal,
            itemId, crfVersionId
          ]);
        } else {
          await client.query(`
            INSERT INTO item_form_metadata (
              item_id, crf_version_id, section_id, response_set_id, ordinal,
              left_item_text, required, default_value, regexp, regexp_error_msg, show_item, width_decimal
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
            itemId, crfVersionId, sectionId, responseSetId, field.order || (i + 1),
            field.placeholder || '', field.required || field.isRequired || false,
            field.defaultValue !== undefined ? String(field.defaultValue) : null,
            regexpPattern, regexpErrorMsg,
            field.hidden !== true && field.isHidden !== true,
            widthDecimal
          ]);
        }
      }

      // Optionally remove items that were deleted (items still in existingItems map)
      // For safety, we'll just mark them as hidden instead of deleting
      for (const [name, item] of existingItems) {
        logger.info('Hiding removed field', { itemId: item.item_id, name });
        await client.query(`
          UPDATE item_form_metadata SET show_item = false
          WHERE item_id = $1 AND crf_version_id = $2
        `, [item.item_id, crfVersionId]);
      }

      // ========================================
      // SCD (Skip Logic) - Delete old and recreate
      // ========================================
      // Delete all existing SCD records for this CRF version
      await client.query(`
        DELETE FROM scd_item_metadata 
        WHERE scd_item_form_metadata_id IN (
          SELECT item_form_metadata_id FROM item_form_metadata WHERE crf_version_id = $1
        )
      `, [crfVersionId]);
      
      // Recreate SCD records from updated showWhen conditions
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        
        if (field.showWhen && Array.isArray(field.showWhen) && field.showWhen.length > 0) {
          // Get the target item_form_metadata_id for this field
          const targetIfmResult = await client.query(`
            SELECT ifm.item_form_metadata_id
            FROM item_form_metadata ifm
            INNER JOIN item i ON ifm.item_id = i.item_id
            WHERE ifm.crf_version_id = $1 AND i.name = $2
            LIMIT 1
          `, [crfVersionId, field.label || field.name]);
          
          if (targetIfmResult.rows.length > 0) {
            const targetIfmId = targetIfmResult.rows[0].item_form_metadata_id;
            
            for (const condition of field.showWhen) {
              const controlIfmResult = await client.query(`
                SELECT ifm.item_form_metadata_id, i.name
                FROM item_form_metadata ifm
                INNER JOIN item i ON ifm.item_id = i.item_id
                WHERE ifm.crf_version_id = $1 AND i.name = $2
                LIMIT 1
              `, [crfVersionId, condition.fieldId]);
              
              const controlIfmId = controlIfmResult.rows[0]?.item_form_metadata_id || null;
              const controlItemName = condition.fieldId || '';
              
              // Store operator in message as JSON for non-equals operators
              const scdMessage = JSON.stringify({
                operator: condition.operator || 'equals',
                message: (condition as any).message || ''
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
    const oldStatus = form.status_id;

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
    `, [userId, crfId, form.name, form.status_name, reason || 'Form archived for 21 CFR Part 11 compliance']);

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
    if (form.status_id !== 6 && form.status_id !== 5) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is not archived' };
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
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'crf', $1, $2, $3,
        'archived', 'available', $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Restore%' OR name LIKE '%Update%' LIMIT 1)
      )
    `, [userId, crfId, form.name, reason || 'Form restored from archive']);

    await client.query('COMMIT');

    logger.info('Form template restored successfully', { crfId });

    return {
      success: true,
      message: `Form "${form.name}" restored successfully`
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
      const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

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
        crfVersionId: row.crf_version_id,
        versionName: row.version_name,
        description: row.description,
        revisionNotes: row.revision_notes,
        oid: row.oc_oid,
        statusId: row.status_id,
        statusName: row.status_name,
        createdBy: row.created_by,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated,
        usageCount: parseInt(row.usage_count) || 0,
        isInUse: parseInt(row.usage_count) > 0
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
      sourceVersionId = latestResult.rows[0].crf_version_id;
    }

    // 2. Get CRF info for OID generation
    const crfResult = await client.query(`
      SELECT name, oc_oid FROM crf WHERE crf_id = $1
    `, [crfId]);
    
    if (crfResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'CRF not found' };
    }

    const crfOid = crfResult.rows[0].oc_oid;
    const versionCount = await client.query(`
      SELECT COUNT(*) as count FROM crf_version WHERE crf_id = $1
    `, [crfId]);
    const nextVersionNum = parseInt(versionCount.rows[0].count) + 1;
    const newVersionOid = `${crfOid}_V${nextVersionNum}`;

    // 3. Create new version record
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

    const newVersionId = newVersionResult.rows[0].crf_version_id;
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
        section.page_number_label,
        section.ordinal,
        null, // parent_id will be mapped after
        section.borders,
        userId
      ]);
      sectionMapping[section.section_id] = newSectionResult.rows[0].section_id;
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
      const newGroupOid = group.oc_oid ? 
        `${group.oc_oid}_V${nextVersionNum}` : 
        `IG_${newVersionId}_${group.item_group_id}`;

      const newGroupResult = await client.query(`
        INSERT INTO item_group (
          name, oc_oid, status_id, owner_id, date_created
        ) VALUES (
          $1, $2, 1, $3, NOW()
        )
        RETURNING item_group_id
      `, [group.name, newGroupOid, userId]);

      const newGroupId = newGroupResult.rows[0].item_group_id;
      itemGroupMapping[group.item_group_id] = newGroupId;

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
        group.repeat_number,
        group.repeat_max,
        group.show_group,
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
      const newItemOid = item.oc_oid ? 
        `${item.oc_oid}_V${nextVersionNum}` : 
        `I_${newVersionId}_${item.item_id}`;

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
        item.phi_status,
        item.item_data_type_id,
        item.item_reference_type_id,
        userId,
        newItemOid
      ]);

      const newItemId = newItemResult.rows[0].item_id;
      itemMapping[item.item_id] = newItemId;

      // Create item_form_metadata for new version
      const newSectionId = sectionMapping[item.section_id] || null;
      
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
        item.left_item_text,
        item.right_item_text,
        null, // parent_id mapping if needed
        item.column_number,
        newSectionId,
        item.ordinal,
        item.response_set_id, // Response sets are shared
        item.required,
        item.regexp,
        item.regexp_error_msg,
        item.show_item,
        item.question_number_label,
        item.default_value,
        item.width_decimal,
        item.response_layout
      ]);

      // Copy item_group_map if exists
      const groupMapResult = await client.query(`
        SELECT item_group_id FROM item_group_map
        WHERE item_id = $1 AND crf_version_id = $2
      `, [item.item_id, sourceVersionId]);

      if (groupMapResult.rows.length > 0) {
        const oldGroupId = groupMapResult.rows[0].item_group_id;
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
 * Fork (copy) an entire CRF to create a new independent form
 * - Creates new CRF record
 * - Copies specified version (or latest)
 * - Copies all items/sections/item_groups
 * - Updates OIDs to be unique
 * 
 * This implements "forking" at the CRF level - completely new CRF
 */
export const forkForm = async (
  sourceCrfId: number,
  data: {
    newName: string;
    description?: string;
    targetStudyId?: number;
  },
  userId: number
): Promise<{ success: boolean; newCrfId?: number; message?: string }> => {
  logger.info('Forking form template', { sourceCrfId, newName: data.newName, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get source CRF info
    const sourceCrfResult = await client.query(`
      SELECT crf_id, name, description, oc_oid, source_study_id
      FROM crf WHERE crf_id = $1
    `, [sourceCrfId]);

    if (sourceCrfResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Source CRF not found' };
    }

    const sourceCrf = sourceCrfResult.rows[0];

    // 2. Generate new OID for the forked CRF
    const timestamp = Date.now().toString().slice(-6);
    const newOid = `F_${data.newName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24)}_${timestamp}`;

    // Check if OID exists
    const existsCheck = await client.query(`SELECT crf_id FROM crf WHERE oc_oid = $1`, [newOid]);
    if (existsCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'A form with this name already exists' };
    }

    // 3. Create new CRF
    const newCrfResult = await client.query(`
      INSERT INTO crf (
        name, description, status_id, owner_id, date_created, oc_oid, source_study_id
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4, $5
      )
      RETURNING crf_id
    `, [
      data.newName,
      data.description || `Forked from ${sourceCrf.name}`,
      userId,
      newOid,
      data.targetStudyId || sourceCrf.source_study_id
    ]);

    const newCrfId = newCrfResult.rows[0].crf_id;
    logger.info('Created forked CRF record', { newCrfId, sourceCrfId });

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
      return { success: false, message: 'No version found in source CRF' };
    }

    const sourceVersion = sourceVersionResult.rows[0];
    const sourceVersionId = sourceVersion.crf_version_id;

    // 5. Create initial version for new CRF
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
      `Initial version (forked from ${sourceCrf.name})`,
      `Forked from CRF ID ${sourceCrfId}, version ${sourceVersion.name}`,
      userId,
      newVersionOid
    ]);

    const newVersionId = newVersionResult.rows[0].crf_version_id;

    // 6. Copy sections
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
        section.page_number_label,
        section.ordinal,
        null,
        section.borders,
        userId
      ]);
      sectionMapping[section.section_id] = newSectionResult.rows[0].section_id;
    }

    // 7. Copy item groups
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
      const newGroupOid = `IG_${newCrfId}_${Date.now().toString().slice(-4)}_${group.item_group_id}`;

      const newGroupResult = await client.query(`
        INSERT INTO item_group (name, oc_oid, status_id, owner_id, date_created)
        VALUES ($1, $2, 1, $3, NOW())
        RETURNING item_group_id
      `, [group.name, newGroupOid, userId]);

      const newGroupId = newGroupResult.rows[0].item_group_id;
      itemGroupMapping[group.item_group_id] = newGroupId;

      await client.query(`
        INSERT INTO item_group_metadata (
          item_group_id, crf_version_id, header, subheader, layout,
          repeat_number, repeat_max, show_group, ordinal, borders
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        newGroupId, newVersionId, group.header, group.subheader, group.layout,
        group.repeat_number, group.repeat_max, group.show_group, group.ordinal, group.borders
      ]);
    }

    // 8. Copy items
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
      const newItemOid = `I_${newCrfId}_${Date.now().toString().slice(-4)}_${item.item_id}`;

      const newItemResult = await client.query(`
        INSERT INTO item (
          name, description, units, phi_status, item_data_type_id,
          item_reference_type_id, status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), $8)
        RETURNING item_id
      `, [
        item.name, item.description, item.units, item.phi_status,
        item.item_data_type_id, item.item_reference_type_id, userId, newItemOid
      ]);

      const newItemId = newItemResult.rows[0].item_id;
      const newSectionId = sectionMapping[item.section_id] || null;

      await client.query(`
        INSERT INTO item_form_metadata (
          item_id, crf_version_id, header, subheader, left_item_text, right_item_text,
          parent_id, column_number, section_id, ordinal, response_set_id,
          required, regexp, regexp_error_msg, show_item, question_number_label,
          default_value, width_decimal, response_layout
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        newItemId, newVersionId, item.header, item.subheader, item.left_item_text,
        item.right_item_text, null, item.column_number, newSectionId, item.ordinal,
        item.response_set_id, item.required, item.regexp, item.regexp_error_msg,
        item.show_item, item.question_number_label, item.default_value,
        item.width_decimal, item.response_layout
      ]);

      // Copy item_group_map
      const groupMapResult = await client.query(`
        SELECT item_group_id FROM item_group_map WHERE item_id = $1 AND crf_version_id = $2
      `, [item.item_id, sourceVersionId]);

      if (groupMapResult.rows.length > 0) {
        const oldGroupId = groupMapResult.rows[0].item_group_id;
        const newGroupId = itemGroupMapping[oldGroupId];
        if (newGroupId) {
          await client.query(`
            INSERT INTO item_group_map (item_group_id, item_id, crf_version_id)
            VALUES ($1, $2, $3)
          `, [newGroupId, newItemId, newVersionId]);
        }
      }
    }

    await client.query('COMMIT');

    logger.info('Form forked successfully', {
      sourceCrfId,
      newCrfId,
      newVersionId,
      sectionsCopied: Object.keys(sectionMapping).length,
      itemsCopied: itemsResult.rows.length
    });

    // Audit log
    try {
      await trackUserAction({
        userId,
        username: '',
        action: 'FORM_FORKED',
        entityType: 'crf',
        entityId: newCrfId,
        details: `Forked from CRF "${sourceCrf.name}" (ID: ${sourceCrfId}) as "${data.newName}"`
      });
    } catch (auditError: any) {
      logger.warn('Failed to record fork audit', { error: auditError.message });
    }

    return {
      success: true,
      newCrfId,
      message: `Form "${data.newName}" forked successfully`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Fork form error', { error: error.message, sourceCrfId });
    return {
      success: false,
      message: `Failed to fork form: ${error.message}`
    };
  } finally {
    client.release();
  }
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
    if (eventCrf.status_id === 6) {
      return {
        success: false,
        message: 'Cannot edit data - this record is locked.',
        errors: ['RECORD_LOCKED']
      } as any;
    }

    // Find the item_id for this field
    const itemResult = await client.query(`
      SELECT i.item_id, i.name
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      WHERE igm.crf_version_id = $1
        AND (LOWER(i.name) = LOWER($2) OR LOWER(i.oc_oid) = LOWER($2))
      LIMIT 1
    `, [eventCrf.crf_version_id, fieldName]);

    if (itemResult.rows.length === 0) {
      return { success: false, message: `Field "${fieldName}" not found in form` };
    }

    const itemId = itemResult.rows[0].item_id;

    // Get current item_data (if exists)
    const existingResult = await client.query(`
      SELECT item_data_id, value FROM item_data
      WHERE event_crf_id = $1 AND item_id = $2 AND deleted = false
      LIMIT 1
    `, [eventCrfId, itemId]);

    const itemDataId = existingResult.rows[0]?.item_data_id;
    const oldValue = existingResult.rows[0]?.value;

    // Get all form data for cross-field validation
    const allDataResult = await client.query(`
      SELECT i.name, id.value
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 AND id.deleted = false
    `, [eventCrfId]);

    const allFormData: Record<string, any> = {};
    for (const row of allDataResult.rows) {
      allFormData[row.name] = row.value;
    }
    // Include the new value being validated
    allFormData[fieldName] = value;

    // Validate the field change
    const validationResult = await validationRulesService.validateFieldChange(
      eventCrf.crf_id,
      fieldName,
      value,
      allFormData,
      {
        createQueries: options?.createQueries ?? false,
        studyId: eventCrf.study_id,
        subjectId: eventCrf.study_subject_id,
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

    let stringValue = value === null || value === undefined ? '' : String(value);

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
      // Insert new
      const insertResult = await client.query(`
        INSERT INTO item_data (
          item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal
        ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)
        RETURNING item_data_id
      `, [itemId, eventCrfId, stringValue, userId]);

      savedItemDataId = insertResult.rows[0].item_data_id;

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

    return {
      success: true,
      data: {
        itemDataId: savedItemDataId,
        valid: validationResult.valid,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        queryCreated: validationResult.queryCreated
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
  // Field-level operations
  updateFieldData,
  // Reference data
  getNullValueTypes,
  getMeasurementUnits
};

