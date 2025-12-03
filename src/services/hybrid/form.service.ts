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
import * as dataSoap from '../soap/dataSoap.service';
import { FormDataRequest, ApiResponse } from '../../types';
import { trackUserAction, trackDocumentAccess } from '../database/audit.service';
import * as validationRulesService from '../database/validation-rules.service';

/**
 * Save form data via SOAP (GxP compliant)
 * 
 * This function now applies validation rules before saving:
 * - Hard edits (severity: 'error') will BLOCK the save
 * - Soft edits (severity: 'warning') will be returned but allow save
 * 
 * 21 CFR Part 11 §11.10(h) - Device checks to determine validity
 */
export const saveFormData = async (
  request: FormDataRequest & { formId?: number; data?: Record<string, any> },
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data', { request, userId });

  // Handle both naming conventions (frontend uses formId/data, backend uses crfId/formData)
  const crfId = request.crfId || request.formId;
  const formData = request.formData || request.data;

  // Apply validation rules BEFORE saving
  if (crfId && formData) {
    try {
      const validationResult = await validationRulesService.validateFormData(
        crfId,
        formData
      );

      // If there are hard edit errors, block the save
      if (!validationResult.valid && validationResult.errors.length > 0) {
        logger.warn('Form data validation failed', { 
          crfId: request.crfId, 
          errors: validationResult.errors 
        });
        
        return {
          success: false,
          message: 'Validation failed',
          errors: validationResult.errors,
          warnings: validationResult.warnings
        };
      }

      // Log warnings but continue with save
      if (validationResult.warnings.length > 0) {
        logger.info('Form data validation warnings', { 
          crfId: request.crfId, 
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

  // Use SOAP service for GxP-compliant data entry
  return await dataSoap.importData(request, userId, username);
};

/**
 * Get form data from database
 */
export const getFormData = async (eventCrfId: number): Promise<any> => {
  logger.info('Getting form data', { eventCrfId });

  try {
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

    return result.rows;
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
        validationRules.push({ 
          type: 'pattern', 
          value: item.validation_pattern,
          message: item.validation_message || 'Invalid format'
        });
      }
      if (min !== undefined) {
        validationRules.push({ type: 'min', value: min, message: `Minimum value is ${min}` });
      }
      if (max !== undefined) {
        validationRules.push({ type: 'max', value: max, message: `Maximum value is ${max}` });
      }
      
      return {
        // Core identifiers
        id: item.item_id?.toString(),
        item_id: item.item_id,
        name: item.name,
        oc_oid: item.oc_oid,
        
        // Type info
        type: item.data_type_code?.toLowerCase() || 'text',
        data_type: item.data_type,
        data_type_code: item.data_type_code,
        
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
        width: extendedProps.width,
        columnPosition: extendedProps.columnPosition,
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
        
        // Conditional Logic
        showWhen: extendedProps.showWhen,
        requiredWhen: extendedProps.requiredWhen,
        conditionalLogic: extendedProps.conditionalLogic,
        visibilityConditions: extendedProps.visibilityConditions,
        
        // Custom
        customAttributes: extendedProps.customAttributes
      };
    });

    return {
      crf,
      version: versionResult.rows[0],
      sections: sectionsResult.rows,
      itemGroups: itemGroupsResult.rows,
      items
    };
  } catch (error: any) {
    logger.error('Get form metadata error', { error: error.message });
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
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
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
export const getAllForms = async (): Promise<any[]> => {
  logger.info('Getting all forms');

  try {
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
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
      ORDER BY c.date_created DESC, c.name
    `;

    const result = await pool.query(query);
    logger.info('Forms retrieved', { count: result.rows.length });
    return result.rows;
  } catch (error: any) {
    logger.error('Get all forms error', { error: error.message });
    throw error;
  }
};

/**
 * Get CRF by ID
 */
export const getFormById = async (crfId: number): Promise<any> => {
  logger.info('Getting form by ID', { crfId });

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
    'file': 11      // FILE
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
  
  // Conditional Logic
  showWhen?: ConditionalRule[];
  requiredWhen?: ConditionalRule[];
  conditionalLogic?: any[];
  visibilityConditions?: any[];
  
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
}

/**
 * Serialize extended field properties to JSON for storage
 */
const serializeExtendedProperties = (field: FormField): string => {
  const extended = {
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
    
    // Conditional Logic
    showWhen: field.showWhen,
    requiredWhen: field.requiredWhen,
    conditionalLogic: field.conditionalLogic,
    visibilityConditions: field.visibilityConditions,
    
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
    readonly: field.readonly || field.isReadonly
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
 * Map field type to response_type_id
 */
const mapFieldTypeToResponseType = (fieldType: string): number => {
  const typeMap: Record<string, number> = {
    'text': 1,       // text
    'textarea': 2,   // textarea
    'checkbox': 3,   // checkbox
    'file': 4,       // file
    'radio': 5,      // radio
    'select': 6,     // single-select
    'multiselect': 7 // multi-select
  };
  return typeMap[fieldType?.toLowerCase()] || 1;
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
  },
  userId: number
): Promise<{ success: boolean; crfId?: number; message?: string }> => {
  logger.info('Creating form template', { name: data.name, userId, fieldCount: data.fields?.length || 0 });

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

    // Insert CRF
    const crfResult = await client.query(`
      INSERT INTO crf (
        name, description, status_id, owner_id, date_created, oc_oid, source_study_id
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4, $5
      )
      RETURNING crf_id
    `, [
      data.name,
      data.description || '',
      userId,
      ocOid,
      data.studyId || null
    ]);

    const crfId = crfResult.rows[0].crf_id;

    // Create initial version
    const versionOid = `${ocOid}_V1`;
    const versionResult = await client.query(`
      INSERT INTO crf_version (
        crf_id, name, description, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, $3, 1, $4, NOW(), $5
      )
      RETURNING crf_version_id
    `, [
      crfId,
      data.version || 'v1.0',
      data.description || 'Initial version',
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
          // Pattern validation
          const patternRule = field.validationRules.find(r => r.type === 'pattern');
          if (patternRule) {
            regexpPattern = patternRule.value;
            regexpErrorMsg = patternRule.message || 'Invalid format';
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
            show_item, width_decimal
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
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
          widthDecimal
        ]);

        logger.debug('Created form field with metadata', { 
          itemId, 
          label: field.label, 
          type: field.type,
          required: field.required,
          hasOptions: field.options?.length || 0,
          hasValidation: field.validationRules?.length || 0
        });
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
 * Update a form template
 */
export const updateForm = async (
  crfId: number,
  data: {
    name?: string;
    description?: string;
    status?: 'draft' | 'published' | 'archived';
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating form template', { crfId, data, userId });

  try {
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

    updates.push(`date_updated = NOW()`);
    updates.push(`update_id = $${paramIndex++}`);
    params.push(userId);

    params.push(crfId);

    const query = `
      UPDATE crf
      SET ${updates.join(', ')}
      WHERE crf_id = $${paramIndex}
    `;

    await pool.query(query, params);

    logger.info('Form template updated successfully', { crfId });

    // Track document update in audit trail (21 CFR Part 11)
    try {
      await trackUserAction({
        userId,
        username: '',
        action: 'FORM_UPDATED',
        entityType: 'crf',
        entityId: crfId,
        details: `Updated form template: ${Object.keys(data).join(', ')}`
      });
    } catch (auditError: any) {
      logger.warn('Failed to record form update audit', { error: auditError.message });
    }

    return {
      success: true,
      message: 'Form template updated successfully'
    };
  } catch (error: any) {
    logger.error('Update form error', { error: error.message });

    return {
      success: false,
      message: `Failed to update form: ${error.message}`
    };
  }
};

/**
 * Delete a form template (soft delete by changing status)
 */
export const deleteForm = async (
  crfId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting form template', { crfId, userId });

  try {
    // Check if form is in use
    const usageCheck = await pool.query(`
      SELECT COUNT(*) as count FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE cv.crf_id = $1
    `, [crfId]);

    if (parseInt(usageCheck.rows[0].count) > 0) {
      return {
        success: false,
        message: 'Cannot delete form - it is being used by subjects'
      };
    }

    // Set status to removed (status_id = 5 typically)
    await pool.query(`
      UPDATE crf
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE crf_id = $2
    `, [userId, crfId]);

    logger.info('Form template deleted successfully', { crfId });

    return {
      success: true,
      message: 'Form template deleted successfully'
    };
  } catch (error: any) {
    logger.error('Delete form error', { error: error.message });

    return {
      success: false,
      message: `Failed to delete form: ${error.message}`
    };
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
  deleteForm
};

