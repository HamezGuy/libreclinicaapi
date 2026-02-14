/**
 * Validation Rules Service
 * 
 * Manages validation rules for CRFs (forms) in LibreClinica
 * 
 * LibreClinica stores validation at the item level in item_form_metadata:
 * - regexp: Regular expression pattern
 * - regexp_error_msg: Error message when validation fails
 * - required: Whether the field is required
 * 
 * This service extends that with a custom rules table for advanced validations.
 * 
 * 21 CFR Part 11 §11.10(h) - Device checks (validation rules)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { Parser as FormulaParser } from 'hot-formula-parser';

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
  if (callerOrgIds.length === 0) return null;

  const memberCheck = await pool.query(
    `SELECT DISTINCT user_id FROM acc_organization_member WHERE organization_id = ANY($1::int[]) AND status = 'active'`,
    [callerOrgIds]
  );
  return memberCheck.rows.map((r: any) => r.user_id);
};

export interface ValidationRule {
  id: number;
  crfId: number;
  crfVersionId?: number;
  itemId?: number;
  name: string;
  description: string;
  ruleType: 'range' | 'format' | 'required' | 'consistency' | 'business_logic' | 'cross_form' | 'formula';
  fieldPath: string;
  severity: 'error' | 'warning';
  errorMessage: string;
  warningMessage?: string;
  active: boolean;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareFieldPath?: string;
  customExpression?: string;
  dateCreated: Date;
  dateUpdated?: Date;
  createdBy: number;
  updatedBy?: number;
}

export interface CreateValidationRuleRequest {
  crfId: number;
  crfVersionId?: number;
  itemId?: number;
  name: string;
  description?: string;
  ruleType: string;
  fieldPath: string;
  severity: string;
  errorMessage: string;
  warningMessage?: string;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareFieldPath?: string;
  customExpression?: string;
}

/**
 * FORMAT_TYPE_REGISTRY
 * 
 * Single source of truth: loaded from config/format-types.json so both the
 * backend and the Angular frontend use identical patterns.  The frontend
 * FORMAT_TYPE_MAP should be regenerated from the same JSON file.
 * 
 * Maps user-friendly format type keys to their underlying regex patterns.
 * This is the core of the no-code validation builder: non-technical users
 * pick from a dropdown (e.g., "Letters only") and the system stores only the
 * semantic key (e.g., "letters_only"). The regex is resolved at validation time.
 */
import formatTypesJson from '../../config/format-types.json';
export const FORMAT_TYPE_REGISTRY: Record<string, { pattern: string; label: string; example: string }> = formatTypesJson;

// Track if table has been initialized
let tableInitialized = false;

/**
 * Map LibreClinica rule action_type to our rule_type
 * 
 * LibreClinica action types:
 * - DISCREPANCY_NRS: Non-resolvable discrepancy (warning)
 * - DISCREPANCY_RS: Resolvable discrepancy (error)
 * - EMAIL: Send email notification
 * - HIDE: Hide an item
 * - SHOW: Show an item  
 * - INSERT: Insert data
 * - RANDOMIZATION: Trigger randomization
 * - STRATIFICATION_FACTOR: Calculate stratification
 */
const mapActionTypeToRuleType = (actionType: string): string => {
  const typeMap: Record<string, string> = {
    'DISCREPANCY_NRS': 'business_logic',
    'DISCREPANCY_RS': 'business_logic',
    'EMAIL': 'notification',
    'HIDE': 'consistency',
    'SHOW': 'consistency',
    'INSERT': 'calculation',
    'RANDOMIZATION': 'business_logic',
    'STRATIFICATION_FACTOR': 'calculation'
  };
  return typeMap[actionType] || 'business_logic';
};

/**
 * Initialize the validation_rules table if it doesn't exist
 * Uses simple columns without foreign key constraints to avoid dependency issues
 */
export const initializeValidationRulesTable = async (): Promise<boolean> => {
  if (tableInitialized) {
    return true;
  }

  // First check if table exists
  const checkQuery = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'validation_rules'
    );
  `;

  try {
    const checkResult = await pool.query(checkQuery);
    if (checkResult.rows[0].exists) {
      tableInitialized = true;
      return true;
    }
  } catch (e) {
    // Continue to try creating
  }

  // Create table without foreign key constraints for flexibility
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS validation_rules (
      validation_rule_id SERIAL PRIMARY KEY,
      crf_id INTEGER,
      crf_version_id INTEGER,
      item_id INTEGER,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      rule_type VARCHAR(50) NOT NULL,
      field_path VARCHAR(255),
      severity VARCHAR(20) DEFAULT 'error',
      error_message TEXT NOT NULL,
      warning_message TEXT,
      active BOOLEAN DEFAULT true,
      min_value NUMERIC,
      max_value NUMERIC,
      pattern TEXT,
      format_type VARCHAR(50),
      operator VARCHAR(20),
      compare_field_path VARCHAR(255),
      custom_expression TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP,
      owner_id INTEGER,
      update_id INTEGER
    );
  `;

  const createIndexQuery = `
    CREATE INDEX IF NOT EXISTS idx_validation_rules_crf ON validation_rules(crf_id);
    CREATE INDEX IF NOT EXISTS idx_validation_rules_item ON validation_rules(item_id);
    CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(active);
  `;

  try {
    await pool.query(createTableQuery);
    await pool.query(createIndexQuery);
    // Add format_type column if it doesn't exist (migration for existing databases)
    try {
      await pool.query(`ALTER TABLE validation_rules ADD COLUMN IF NOT EXISTS format_type VARCHAR(50)`);
    } catch (e) { /* column may already exist */ }
    tableInitialized = true;
    logger.info('Validation rules table initialized successfully');
    return true;
  } catch (error: any) {
    logger.error('Failed to initialize validation_rules table:', error.message);
    return false;
  }
};

/**
 * Get all validation rules for a CRF
 */
export const getRulesForCrf = async (crfId: number, callerUserId?: number): Promise<ValidationRule[]> => {
  logger.info('Getting validation rules for CRF', { crfId, callerUserId });

  // Ensure table exists before querying
  await initializeValidationRulesTable();

  try {
    // Org-scoping: verify the CRF belongs to the caller's org before returning ANY rules
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        const crfOwnerCheck = await pool.query(
          `SELECT cv.owner_id FROM crf_version cv WHERE cv.crf_id = $1 LIMIT 1`,
          [crfId]
        );
        if (crfOwnerCheck.rows.length > 0 && !orgUserIds.includes(crfOwnerCheck.rows[0].owner_id)) {
          logger.info('CRF not owned by caller org, returning empty rules', { crfId, callerUserId });
          return [];
        }
      }
    }

    // First get rules from the custom validation_rules table
    const customRulesQuery = `
      SELECT 
        vr.validation_rule_id as id,
        vr.crf_id,
        vr.crf_version_id,
        vr.item_id,
        vr.name,
        vr.description,
        vr.rule_type,
        vr.field_path,
        vr.severity,
        vr.error_message,
        vr.warning_message,
        vr.active,
        vr.min_value,
        vr.max_value,
        vr.pattern,
        vr.operator,
        vr.compare_field_path,
        vr.custom_expression,
        vr.date_created,
        vr.date_updated,
        vr.owner_id as created_by,
        vr.update_id as updated_by
      FROM validation_rules vr
      WHERE vr.crf_id = $1
      ORDER BY vr.name
    `;

    let customRules: ValidationRule[] = [];
    try {
      const customResult = await pool.query(customRulesQuery, [crfId]);
      customRules = customResult.rows.map(mapDbRowToRule);
    } catch (e: any) {
      // Table might not exist yet
      logger.debug('Custom validation_rules table not available:', e.message);
    }

    // Also extract rules from item_form_metadata
    // Detect =FORMULA: prefix to distinguish Excel formulas from regex patterns
    const itemRulesQuery = `
      SELECT 
        ifm.item_id as id,
        cv.crf_id,
        ifm.crf_version_id,
        i.item_id,
        i.name,
        i.description,
        CASE 
          WHEN ifm.regexp IS NOT NULL AND ifm.regexp LIKE '=FORMULA:%' THEN 'formula'
          WHEN ifm.regexp IS NOT NULL THEN 'format'
          WHEN ifm.required = true THEN 'required'
          ELSE NULL
        END as rule_type,
        i.name as field_path,
        'error' as severity,
        COALESCE(ifm.regexp_error_msg, 'Invalid format') as error_message,
        NULL as warning_message,
        true as active,
        NULL as min_value,
        NULL as max_value,
        CASE 
          WHEN ifm.regexp LIKE '=FORMULA:%' THEN SUBSTRING(ifm.regexp FROM 10)
          ELSE ifm.regexp
        END as pattern,
        NULL as operator,
        NULL as compare_field_path,
        NULL as custom_expression,
        cv.date_created,
        NULL as date_updated,
        cv.owner_id as created_by,
        NULL as updated_by
      FROM item_form_metadata ifm
      INNER JOIN crf_version cv ON ifm.crf_version_id = cv.crf_version_id
      INNER JOIN item i ON ifm.item_id = i.item_id
      WHERE cv.crf_id = $1
        AND (ifm.regexp IS NOT NULL OR ifm.required = true)
      ORDER BY i.name
    `;

    const itemResult = await pool.query(itemRulesQuery, [crfId]);
    const itemRules = itemResult.rows
      .filter(row => row.rule_type !== null)
      .map(mapDbRowToRule);
    
    // Also get rules from LibreClinica's native rule/rule_expression/rule_action tables
    // These are the advanced rules created in LibreClinica's Rules Module
    let nativeRules: ValidationRule[] = [];
    try {
      const nativeRulesQuery = `
        SELECT 
          r.id,
          r.name,
          r.description,
          r.oc_oid,
          r.enabled,
          r.study_id,
          re.value as expression,
          re.context as expression_context,
          rs.target as target_oid,
          rs.study_event_definition_id,
          rs.crf_id,
          rs.crf_version_id,
          rs.item_id,
          rs.item_group_id,
          ra.action_type,
          ra.message as action_message,
          ra.expression_evaluates_to
        FROM rule r
        INNER JOIN rule_expression re ON r.rule_expression_id = re.id
        INNER JOIN rule_set rs ON rs.study_id = r.study_id
        INNER JOIN rule_set_rule rsr ON rsr.rule_set_id = rs.id AND rsr.rule_id = r.id
        LEFT JOIN rule_action ra ON ra.rule_set_rule_id = rsr.id
        WHERE rs.crf_id = $1 AND r.enabled = true
        ORDER BY r.name
      `;
      
      const nativeResult = await pool.query(nativeRulesQuery, [crfId]);
      
      nativeRules = nativeResult.rows.map(row => ({
        id: row.id + 100000, // Offset to avoid ID conflicts with custom rules
        crfId: row.crf_id,
        crfVersionId: row.crf_version_id,
        itemId: row.item_id,
        name: row.name || 'LibreClinica Rule',
        description: row.description || '',
        ruleType: mapActionTypeToRuleType(row.action_type) as ValidationRule['ruleType'],
        fieldPath: row.target_oid || '',
        severity: row.action_type === 'DISCREPANCY_NRS' ? 'warning' : 'error' as ValidationRule['severity'],
        errorMessage: row.action_message || 'Validation failed',
        warningMessage: row.action_type === 'DISCREPANCY_NRS' ? row.action_message : undefined,
        active: row.enabled !== false,
        customExpression: row.expression,
        dateCreated: new Date(),
        createdBy: row.owner_id || 1, // Required field
        // Store reference to native rule for advanced use
        nativeRuleId: row.id,
        nativeOcOid: row.oc_oid,
        expressionContext: row.expression_context
      }));
      
    } catch (e: any) {
      // Native rules tables might not be available or might have no data
      logger.debug('LibreClinica native rules not available:', e.message);
    }

    // Combine and deduplicate (custom rules take precedence)
    const allRules = [...customRules];
    for (const itemRule of itemRules) {
      const exists = customRules.some(r => r.fieldPath === itemRule.fieldPath && r.ruleType === itemRule.ruleType);
      if (!exists) {
        allRules.push(itemRule);
      }
    }
    
    // Add native LibreClinica rules
    for (const nativeRule of nativeRules) {
      const exists = allRules.some(r => r.customExpression === nativeRule.customExpression);
      if (!exists) {
        allRules.push(nativeRule);
      }
    }

    return allRules;
  } catch (error: any) {
    logger.error('Get validation rules error', { error: error.message });
    throw error;
  }
};

/**
 * Get all validation rules for a study (all CRFs)
 * 
 * Returns unique CRFs associated with the study through:
 * 1. Event definitions (edc -> sed -> study)
 * 2. Source study ID
 * 3. Fallback to all available CRFs if none found
 * 
 * Uses UNION to combine sources and GROUP BY to deduplicate
 */
export const getRulesForStudy = async (studyId: number, callerUserId?: number): Promise<{ crfId: number; crfName: string; rules: ValidationRule[] }[]> => {
  logger.info('Getting validation rules for study', { studyId, callerUserId });

  try {
    // Combined query using UNION to get unique CRFs from multiple sources
    // This ensures no duplicates while checking all possible associations
    const combinedCrfsQuery = `
      WITH study_crfs AS (
        -- CRFs assigned to study event definitions
        SELECT DISTINCT c.crf_id, c.name, 1 as priority
        FROM crf c
        INNER JOIN crf_version cv ON c.crf_id = cv.crf_id
        INNER JOIN event_definition_crf edc ON cv.crf_id = edc.crf_id
        INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id
        WHERE sed.study_id = $1
          AND c.status_id = 1
        
        UNION
        
        -- CRFs created for this study (source_study_id)
        SELECT DISTINCT c.crf_id, c.name, 2 as priority
        FROM crf c
        WHERE c.source_study_id = $1
          AND c.status_id = 1
      )
      SELECT DISTINCT ON (crf_id) crf_id, name
      FROM study_crfs
      ORDER BY crf_id, priority
    `;

    let crfsResult = await pool.query(combinedCrfsQuery, [studyId]);
    logger.info('Study CRFs (combined query)', { studyId, count: crfsResult.rows.length });

    // Fallback: Get available CRFs if none found for this study (org-scoped)
    if (crfsResult.rows.length === 0) {
      let orgCrfFilter = '';
      const fallbackParams: any[] = [];

      if (callerUserId) {
        const orgUserIds = await getOrgMemberUserIds(callerUserId);
        if (orgUserIds) {
          orgCrfFilter = ` AND c.crf_id IN (SELECT cv2.crf_id FROM crf_version cv2 WHERE cv2.owner_id = ANY($1::int[]))`;
          fallbackParams.push(orgUserIds);
        }
      }

      const allCrfsQuery = `
        SELECT DISTINCT c.crf_id, c.name
        FROM crf c
        WHERE c.status_id = 1${orgCrfFilter}
        ORDER BY c.name
        LIMIT 50
      `;
      crfsResult = await pool.query(allCrfsQuery, fallbackParams);
      logger.info('Available CRFs (fallback, org-scoped)', { count: crfsResult.rows.length });
    }

    // Use Map to ensure uniqueness by crf_id
    const crfMap = new Map<number, { crfId: number; crfName: string }>();
    for (const crf of crfsResult.rows) {
      if (!crfMap.has(crf.crf_id)) {
        crfMap.set(crf.crf_id, {
          crfId: crf.crf_id,
          crfName: crf.name
        });
      }
    }

    // Convert to array and fetch rules for each unique CRF
    const results = [];
    for (const crf of crfMap.values()) {
      const rules = await getRulesForCrf(crf.crfId, callerUserId);
      results.push({
        crfId: crf.crfId,
        crfName: crf.crfName,
        rules
      });
    }

    // Sort by name for consistent ordering
    results.sort((a, b) => a.crfName.localeCompare(b.crfName));

    logger.info('Returning unique CRFs for study', { studyId, uniqueCount: results.length });
    return results;
  } catch (error: any) {
    logger.error('Get study validation rules error', { error: error.message });
    throw error;
  }
};

/**
 * Get a single validation rule by ID
 */
export const getRuleById = async (ruleId: number, callerUserId?: number): Promise<ValidationRule | null> => {
  // Ensure table exists
  await initializeValidationRulesTable();
  
  try {
    const query = `
      SELECT 
        validation_rule_id as id,
        crf_id,
        crf_version_id,
        item_id,
        name,
        description,
        rule_type,
        field_path,
        severity,
        error_message,
        warning_message,
        active,
        min_value,
        max_value,
        pattern,
        operator,
        compare_field_path,
        custom_expression,
        date_created,
        date_updated,
        owner_id as created_by,
        update_id as updated_by
      FROM validation_rules 
      WHERE validation_rule_id = $1
    `;
    const result = await pool.query(query, [ruleId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    // Org-scoping: verify caller can see this rule
    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds && !orgUserIds.includes(result.rows[0].created_by)) {
        return null;
      }
    }
    
    return mapDbRowToRule(result.rows[0]);
  } catch (error: any) {
    logger.error('Get rule by ID error', { error: error.message });
    return null;
  }
};

/**
 * Create a new validation rule
 */
export const createRule = async (
  rule: CreateValidationRuleRequest,
  userId: number
): Promise<{ success: boolean; ruleId?: number; message?: string }> => {
  logger.info('Creating validation rule', { rule, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ensure the table exists
    await initializeValidationRulesTable();

    const insertQuery = `
      INSERT INTO validation_rules (
        crf_id, crf_version_id, item_id, name, description, rule_type,
        field_path, severity, error_message, warning_message, active,
        min_value, max_value, pattern, format_type, operator, compare_field_path,
        custom_expression, date_created, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, $18)
      RETURNING validation_rule_id
    `;

    // Support both fieldPath and fieldName for API compatibility
    const fieldPath = rule.fieldPath || (rule as any).fieldName || '';
    
    const result = await client.query(insertQuery, [
      rule.crfId,
      rule.crfVersionId || null,
      rule.itemId || null,
      rule.name,
      rule.description || '',
      rule.ruleType,
      fieldPath,
      rule.severity || 'error',
      rule.errorMessage,
      rule.warningMessage || null,
      rule.minValue || null,
      rule.maxValue || null,
      rule.pattern || null,
      rule.formatType || null,
      rule.operator || null,
      rule.compareFieldPath || null,
      rule.customExpression || null,
      userId
    ]);

    // Also update item_form_metadata if this is a format or required rule
    if (rule.itemId && (rule.ruleType === 'format' || rule.ruleType === 'required')) {
      if (rule.ruleType === 'format' && rule.pattern) {
        await client.query(`
          UPDATE item_form_metadata 
          SET regexp = $1, regexp_error_msg = $2 
          WHERE item_id = $3
        `, [rule.pattern, rule.errorMessage, rule.itemId]);
      } else if (rule.ruleType === 'required') {
        await client.query(`
          UPDATE item_form_metadata SET required = true WHERE item_id = $1
        `, [rule.itemId]);
      }
    }

    await client.query('COMMIT');

    return { success: true, ruleId: result.rows[0].validation_rule_id };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create validation rule error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Update a validation rule
 */
export const updateRule = async (
  ruleId: number,
  updates: Partial<CreateValidationRuleRequest>,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating validation rule', { ruleId, updates, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE validation_rules SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        rule_type = COALESCE($3, rule_type),
        field_path = COALESCE($4, field_path),
        severity = COALESCE($5, severity),
        error_message = COALESCE($6, error_message),
        warning_message = COALESCE($7, warning_message),
        min_value = $8,
        max_value = $9,
        pattern = $10,
        format_type = $11,
        operator = $12,
        compare_field_path = $13,
        custom_expression = $14,
        date_updated = CURRENT_TIMESTAMP,
        update_id = $15
      WHERE validation_rule_id = $16
    `;

    await client.query(updateQuery, [
      updates.name,
      updates.description,
      updates.ruleType,
      updates.fieldPath,
      updates.severity,
      updates.errorMessage,
      updates.warningMessage,
      updates.minValue ?? null,
      updates.maxValue ?? null,
      updates.pattern ?? null,
      updates.formatType ?? null,
      updates.operator ?? null,
      updates.compareFieldPath ?? null,
      updates.customExpression ?? null,
      userId,
      ruleId
    ]);

    await client.query('COMMIT');

    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update validation rule error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Toggle validation rule active state
 */
export const toggleRule = async (
  ruleId: number,
  active: boolean,
  userId: number
): Promise<{ success: boolean }> => {
  try {
    await pool.query(`
      UPDATE validation_rules 
      SET active = $1, date_updated = CURRENT_TIMESTAMP, update_id = $2
      WHERE validation_rule_id = $3
    `, [active, userId, ruleId]);

    return { success: true };
  } catch (error: any) {
    logger.error('Toggle rule error', { error: error.message });
    return { success: false };
  }
};

/**
 * Delete a validation rule
 */
export const deleteRule = async (
  ruleId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting validation rule', { ruleId, userId });

  try {
    await pool.query(`DELETE FROM validation_rules WHERE validation_rule_id = $1`, [ruleId]);
    return { success: true };
  } catch (error: any) {
    logger.error('Delete validation rule error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Validate form data against rules
 * 
 * This function supports validation for:
 * - Form templates (by crfId)
 * - Form instances/copies on patients (by eventCrfId)
 * 
 * @param crfId - The CRF ID to validate against
 * @param formData - The form data to validate
 * @param options - Optional parameters for query creation and context
 * @param options.createQueries - If true, creates queries for validation failures
 * @param options.studyId - Study ID for query creation
 * @param options.subjectId - Subject ID (study_subject_id) for query creation
 * @param options.eventCrfId - Event CRF ID for query creation (form instance)
 * @param options.userId - User ID who triggered validation
 * @param options.crfVersionId - Specific CRF version ID (for form copies)
 * @param options.itemDataMap - Map of fieldPath to item_data_id for precise query linking
 */
export const validateFormData = async (
  crfId: number,
  formData: Record<string, any>,
  options?: {
    createQueries?: boolean;
    studyId?: number;
    subjectId?: number;
    eventCrfId?: number;
    userId?: number;
    crfVersionId?: number;
    itemDataMap?: Record<string, number>;
  }
): Promise<{
  valid: boolean;
  errors: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number }[];
  warnings: { fieldPath: string; message: string; queryId?: number }[];
  queriesCreated?: number;
}> => {
  logger.info('Validating form data', { 
    crfId, 
    eventCrfId: options?.eventCrfId,
    fieldsCount: Object.keys(formData).length 
  });

  // Get rules for this CRF (works for both templates and copies)
  const rules = await getRulesForCrf(crfId);
  const errors: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number }[] = [];
  const warnings: { fieldPath: string; message: string; queryId?: number }[] = [];
  let queriesCreated = 0;

  // If eventCrfId is provided, build itemDataMap from database for accurate query linking
  let itemDataMap = options?.itemDataMap || {};
  if (options?.eventCrfId && Object.keys(itemDataMap).length === 0) {
    try {
      itemDataMap = await buildItemDataMap(options.eventCrfId);
    } catch (e: any) {
      logger.warn('Could not build itemDataMap:', e.message);
    }
  }

  for (const rule of rules) {
    if (!rule.active) continue;

    // Match field value using multiple strategies
    const value = getFieldValue(formData, rule, itemDataMap);
    
    // If the field is not found in form data (value === undefined), determine
    // whether this is a genuine naming mismatch (skip) or a required field
    // that the user actually left empty (fail).
    if (value === undefined) {
      // For 'required' rules with an itemId, check whether the field SHOULD
      // be in this form by looking it up in the itemDataMap.  If the item
      // exists in the map the field is part of this CRF version — treat the
      // missing value as empty so the required rule fires correctly.
      if (rule.ruleType === 'required' && rule.itemId) {
        const mappedItemDataId = itemDataMap[`item_${rule.itemId}`];
        if (mappedItemDataId) {
          // Field belongs to this CRF but wasn't submitted — treat as empty
          const requiredResult = applyRule(rule, '', formData);
          if (!requiredResult.valid) {
            const itemDataId = mappedItemDataId;
            const error: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number } = {
              fieldPath: rule.fieldPath,
              message: rule.errorMessage,
              severity: rule.severity || 'error',
              itemDataId
            };

            if (options?.createQueries && options.studyId && options.userId) {
              try {
                const queryId = await createValidationQuery({
                  studyId: options.studyId,
                  subjectId: options.subjectId,
                  eventCrfId: options.eventCrfId,
                  crfId: crfId,
                  itemDataId: itemDataId,
                  itemId: rule.itemId,
                  fieldPath: rule.fieldPath,
                  ruleName: rule.name,
                  errorMessage: rule.errorMessage,
                  value: '',
                  userId: options.userId,
                  severity: rule.severity || 'error'
                });
                if (queryId) {
                  error.queryId = queryId;
                  queriesCreated++;
                }
              } catch (e: any) {
                logger.error('Failed to create validation query for missing required field:', e.message);
              }
            }
            errors.push(error);
          }
          continue;
        }
      }

      // Field is not part of this form submission — skip validation
      logger.debug('Field not found in form data, skipping validation', {
        ruleFieldPath: rule.fieldPath,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        formDataKeys: Object.keys(formData).slice(0, 10)
      });
      continue;
    }
    
    const validationResult = applyRule(rule, value, formData);

    if (!validationResult.valid) {
      // Get the item_data_id for this field if available
      const itemDataId = getItemDataId(rule.fieldPath, itemDataMap);

      if (rule.severity === 'error') {
        const error: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number } = {
          fieldPath: rule.fieldPath,
          message: rule.errorMessage,
          severity: 'error',
          itemDataId
        };

        // Create query for hard-edit validation failure if requested
        if (options?.createQueries && options.studyId && options.userId) {
          try {
            const queryId = await createValidationQuery({
              studyId: options.studyId,
              subjectId: options.subjectId,
              eventCrfId: options.eventCrfId,
              crfId: crfId,
              itemDataId: itemDataId,
              itemId: rule.itemId,
              fieldPath: rule.fieldPath,
              ruleName: rule.name,
              errorMessage: rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'error'
            });
            if (queryId) {
              error.queryId = queryId;
              queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create validation query:', e.message);
          }
        }

        errors.push(error);
      } else {
        // Warning (soft edit) - still create a query for workflow tracking
        const warning: { fieldPath: string; message: string; queryId?: number } = {
          fieldPath: rule.fieldPath,
          message: rule.warningMessage || rule.errorMessage
        };

        if (options?.createQueries && options.studyId && options.userId) {
          try {
            const queryId = await createValidationQuery({
              studyId: options.studyId,
              subjectId: options.subjectId,
              eventCrfId: options.eventCrfId,
              crfId: crfId,
              itemDataId: itemDataId,
              itemId: rule.itemId,
              fieldPath: rule.fieldPath,
              ruleName: rule.name,
              errorMessage: rule.warningMessage || rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'warning'
            });
            if (queryId) {
              warning.queryId = queryId;
              queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create warning validation query:', e.message);
          }
        }

        warnings.push(warning);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    queriesCreated
  };
};

/**
 * Build a map of field names to item_data_id for a specific event_crf
 * This enables precise query linking to specific data points
 */
async function buildItemDataMap(eventCrfId: number): Promise<Record<string, number>> {
  const query = `
    SELECT 
      id.item_data_id,
      i.name as field_name,
      i.oc_oid as field_oid,
      i.item_id
    FROM item_data id
    INNER JOIN item i ON id.item_id = i.item_id
    WHERE id.event_crf_id = $1
      AND id.deleted = false
  `;
  
  const result = await pool.query(query, [eventCrfId]);
  const map: Record<string, number> = {};
  
  for (const row of result.rows) {
    // Map by multiple identifiers for flexible matching
    map[row.field_name] = row.item_data_id;
    map[row.field_name.toLowerCase()] = row.item_data_id;
    if (row.field_oid) {
      map[row.field_oid] = row.item_data_id;
    }
    // Also map by item_id for rule matching
    map[`item_${row.item_id}`] = row.item_data_id;
  }
  
  return map;
}

/**
 * Get the field value from form data using multiple matching strategies
 * 
 * This handles various naming conventions:
 * - Direct path match (e.g., "demographics.age")
 * - Flat field names (e.g., "age")
 * - OID-based names (e.g., "I_DEMO_AGE")
 * - Case-insensitive matching
 * - Nested object access
 */
function getFieldValue(
  formData: Record<string, any>, 
  rule: ValidationRule,
  itemDataMap: Record<string, number>
): any {
  // Guard against null/undefined fieldPath
  if (!rule.fieldPath) return undefined;
  
  // 1. Direct fieldPath match (exact)
  let value = getNestedValue(formData, rule.fieldPath);
  if (value !== undefined) return value;
  
  // 2. Case-insensitive match on full path
  const lowerFieldPath = rule.fieldPath.toLowerCase();
  for (const key of Object.keys(formData)) {
    if (key.toLowerCase() === lowerFieldPath) {
      return formData[key];
    }
  }
  
  // 3. Match by item name without path prefix (e.g., "demographics.age" -> "age")
  const fieldName = rule.fieldPath.split('.').pop();
  if (fieldName) {
    value = formData[fieldName];
    if (value !== undefined) return value;
    
    // Case-insensitive field name
    for (const key of Object.keys(formData)) {
      if (key.toLowerCase() === fieldName.toLowerCase()) {
        return formData[key];
      }
    }
  }
  
  // 4. Match by underscore-separated name (e.g., "demographics.ageYears" -> "age_years")
  if (fieldName) {
    const underscoreName = camelToUnderscore(fieldName);
    for (const key of Object.keys(formData)) {
      if (key.toLowerCase() === underscoreName.toLowerCase()) {
        return formData[key];
      }
    }
  }
  
  // 5. Match by item_id if available in the rule
  if (rule.itemId && itemDataMap[`item_${rule.itemId}`]) {
    // Find the field by looking up in itemDataMap
    for (const key of Object.keys(formData)) {
      if (itemDataMap[key] === itemDataMap[`item_${rule.itemId}`]) {
        return formData[key];
      }
    }
  }
  
  // 6. Deep search in nested objects
  value = deepSearchValue(formData, fieldName || rule.fieldPath);
  if (value !== undefined) return value;
  
  return undefined;
}

/**
 * Convert camelCase to underscore_case
 */
function camelToUnderscore(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

/**
 * Deep search for a value in nested objects
 */
function deepSearchValue(obj: Record<string, any>, fieldName: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  
  const lowerFieldName = fieldName.toLowerCase();
  
  for (const key of Object.keys(obj)) {
    // Direct match
    if (key.toLowerCase() === lowerFieldName) {
      return obj[key];
    }
    
    // Recurse into nested objects (but not arrays)
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      const nested = deepSearchValue(obj[key], fieldName);
      if (nested !== undefined) return nested;
    }
  }
  
  return undefined;
}

/**
 * Get item_data_id from the map using multiple matching strategies
 */
function getItemDataId(fieldPath: string, itemDataMap: Record<string, number>): number | undefined {
  // Direct match
  if (itemDataMap[fieldPath]) return itemDataMap[fieldPath];
  
  // Case-insensitive
  if (itemDataMap[fieldPath.toLowerCase()]) return itemDataMap[fieldPath.toLowerCase()];
  
  // Field name only (without path prefix)
  const fieldName = fieldPath.split('.').pop();
  if (fieldName) {
    if (itemDataMap[fieldName]) return itemDataMap[fieldName];
    if (itemDataMap[fieldName.toLowerCase()]) return itemDataMap[fieldName.toLowerCase()];
  }
  
  return undefined;
}

/**
 * Validate a single field change (for real-time validation on CRUD operations)
 * 
 * This function is called when a single field is updated, providing immediate
 * validation feedback and optional query creation.
 * 
 * Supports validation for:
 * - CREATE: When new data is entered
 * - UPDATE: When existing data is modified  
 * - DELETE: When data is cleared (validates as empty)
 * 
 * The function uses multiple matching strategies to ensure rules apply
 * to ALL form copies (event_crf instances).
 */
export const validateFieldChange = async (
  crfId: number,
  fieldPath: string,
  value: any,
  allFormData: Record<string, any>,
  options?: {
    createQueries?: boolean;
    studyId?: number;
    subjectId?: number;
    eventCrfId?: number;
    itemDataId?: number;
    itemId?: number;
    userId?: number;
    operationType?: 'create' | 'update' | 'delete';
  }
): Promise<{
  valid: boolean;
  errors: { fieldPath: string; message: string; severity: string; queryId?: number }[];
  warnings: { fieldPath: string; message: string; queryId?: number }[];
  queryCreated?: boolean;
  queriesCreated?: number;
}> => {
  logger.info('Validating field change', { 
    crfId, 
    fieldPath, 
    eventCrfId: options?.eventCrfId,
    operationType: options?.operationType || 'update'
  });

  const rules = await getRulesForCrf(crfId);
  const errors: { fieldPath: string; message: string; severity: string; queryId?: number }[] = [];
  const warnings: { fieldPath: string; message: string; queryId?: number }[] = [];
  let queriesCreated = 0;

  // Build itemDataMap if we have eventCrfId for better field matching
  let itemDataMap: Record<string, number> = {};
  if (options?.eventCrfId) {
    try {
      itemDataMap = await buildItemDataMap(options.eventCrfId);
    } catch (e: any) {
      logger.warn('Could not build itemDataMap:', e.message);
    }
  }

  // Find rules that apply to this specific field using comprehensive matching
  const fieldRules = rules.filter(rule => {
    if (!rule.active) return false;
    
    return matchesField(rule, fieldPath, options?.itemId, itemDataMap);
  });
  
  logger.debug('Found matching rules', { 
    fieldPath, 
    matchingRulesCount: fieldRules.length,
    totalRulesCount: rules.length
  });

  for (const rule of fieldRules) {
    const validationResult = applyRule(rule, value, allFormData);

    if (!validationResult.valid) {
      // Get itemDataId for this field if not provided
      let itemDataId = options?.itemDataId;
      if (!itemDataId && itemDataMap[fieldPath]) {
        itemDataId = itemDataMap[fieldPath];
      } else if (!itemDataId && itemDataMap[fieldPath.toLowerCase()]) {
        itemDataId = itemDataMap[fieldPath.toLowerCase()];
      }

      if (rule.severity === 'error') {
        const error: { fieldPath: string; message: string; severity: string; queryId?: number } = {
          fieldPath: rule.fieldPath,
          message: rule.errorMessage,
          severity: 'error'
        };

        // Create query for hard-edit validation failure if requested
        if (options?.createQueries && options.studyId && options.userId) {
          try {
            const queryId = await createValidationQuery({
              studyId: options.studyId,
              subjectId: options.subjectId,
              eventCrfId: options.eventCrfId,
              crfId: crfId,
              itemDataId: itemDataId,
              itemId: rule.itemId || options?.itemId,
              fieldPath: rule.fieldPath,
              ruleName: rule.name,
              errorMessage: rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'error'
            });
            if (queryId) {
              error.queryId = queryId;
              queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create validation query:', e.message);
          }
        }

        errors.push(error);
      } else {
        // Warning (soft edit) - create query for workflow tracking
        const warning: { fieldPath: string; message: string; queryId?: number } = {
          fieldPath: rule.fieldPath,
          message: rule.warningMessage || rule.errorMessage
        };

        if (options?.createQueries && options.studyId && options.userId) {
          try {
            const queryId = await createValidationQuery({
              studyId: options.studyId,
              subjectId: options.subjectId,
              eventCrfId: options.eventCrfId,
              crfId: crfId,
              itemDataId: itemDataId,
              itemId: rule.itemId || options?.itemId,
              fieldPath: rule.fieldPath,
              ruleName: rule.name,
              errorMessage: rule.warningMessage || rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'warning'
            });
            if (queryId) {
              warning.queryId = queryId;
              queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create warning validation query:', e.message);
          }
        }

        warnings.push(warning);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    queryCreated: queriesCreated > 0,
    queriesCreated
  };
};

/**
 * Check if a validation rule matches a given field
 * 
 * Uses multiple matching strategies:
 * 1. Exact fieldPath match
 * 2. Case-insensitive match
 * 3. Item ID match (most reliable for LibreClinica)
 * 4. Field name without path prefix
 * 5. Underscore/camelCase conversion
 */
function matchesField(
  rule: ValidationRule,
  fieldPath: string,
  itemId?: number,
  itemDataMap?: Record<string, number>
): boolean {
  // Guard against null/undefined fieldPath on rule
  if (!rule.fieldPath && !rule.itemId) return false;
  
  // 1. Match by itemId (most reliable for LibreClinica fields)
  if (rule.itemId && itemId && rule.itemId === itemId) return true;
  
  // If rule has no fieldPath, can't do path matching
  if (!rule.fieldPath) return false;
  
  // 2. Match by exact fieldPath
  if (rule.fieldPath === fieldPath) return true;
  
  // 3. Case-insensitive match on full path
  if (rule.fieldPath.toLowerCase() === fieldPath.toLowerCase()) return true;
  
  // 4. Match by field name without path prefix (case-insensitive)
  const ruleFieldNameLower = rule.fieldPath.split('.').pop()?.toLowerCase();
  const inputFieldNameLower = fieldPath.split('.').pop()?.toLowerCase();
  if (ruleFieldNameLower && inputFieldNameLower && ruleFieldNameLower === inputFieldNameLower) return true;
  
  // 5. Match with underscore/camelCase conversion
  // IMPORTANT: Get original field names (before toLowerCase) for proper camelCase detection
  const ruleFieldNameOriginal = rule.fieldPath.split('.').pop();
  const inputFieldNameOriginal = fieldPath.split('.').pop();
  if (ruleFieldNameOriginal && inputFieldNameOriginal) {
    // Convert both to underscore format and compare (case-insensitive)
    const ruleUnderscore = camelToUnderscore(ruleFieldNameOriginal);
    const inputUnderscore = camelToUnderscore(inputFieldNameOriginal);
    if (ruleUnderscore === inputUnderscore) return true;
  }
  
  // 6. Match via itemDataMap if available
  if (itemDataMap && rule.fieldPath) {
    const ruleItemDataId = itemDataMap[rule.fieldPath] || itemDataMap[rule.fieldPath.toLowerCase()];
    const fieldItemDataId = itemDataMap[fieldPath] || itemDataMap[fieldPath.toLowerCase()];
    if (ruleItemDataId && fieldItemDataId && ruleItemDataId === fieldItemDataId) return true;
  }
  
  return false;
}

/**
 * Create a query (discrepancy note) for a validation failure
 * 
 * LibreClinica uses mapping tables to link discrepancy notes to entities:
 * - dn_item_data_map: Links to specific data point (most precise for field-level queries)
 * - dn_event_crf_map: Links to form instance
 * - dn_study_subject_map: Links to patient
 * - dn_study_event_map: Links to visit/event
 * 
 * For validation failures, we prioritize item_data linkage for precise tracking.
 * 
 * This function:
 * 1. Checks for existing open queries on the same field to prevent duplicates
 * 2. Assigns the query to an appropriate user (study coordinator or site CRA)
 * 3. Creates proper linkages to all relevant entities
 */
async function createValidationQuery(params: {
  studyId: number;
  subjectId?: number;
  eventCrfId?: number;
  crfId?: number;
  itemDataId?: number;
  itemId?: number;
  fieldPath: string;
  ruleName: string;
  errorMessage: string;
  value: any;
  userId: number;
  assignedUserId?: number;
  severity?: 'error' | 'warning';
}): Promise<number | null> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get the item_data_id if not provided
    let itemDataId = params.itemDataId;
    if (!itemDataId && params.eventCrfId && (params.itemId || params.fieldPath)) {
      itemDataId = await findItemDataId(
        client, 
        params.eventCrfId, 
        params.itemId, 
        params.fieldPath
      ) ?? undefined;
    }
    
    // Check for existing open query on this field to prevent duplicates
    // Check both type 1 (Failed Validation) and type 2 (Annotation/warning)
    if (itemDataId) {
      const existingQuery = await client.query(`
        SELECT dn.discrepancy_note_id 
        FROM discrepancy_note dn
        INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
        INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE dim.item_data_id = $1
          AND dn.discrepancy_note_type_id IN (1, 2)  -- Failed Validation Check OR Annotation
          AND rs.name NOT IN ('Closed', 'Not Applicable')
          AND dn.parent_dn_id IS NULL
        LIMIT 1
      `, [itemDataId]);
      
      if (existingQuery.rows.length > 0) {
        // Return existing query ID instead of creating duplicate
        const existingId = existingQuery.rows[0].discrepancy_note_id;
        logger.info('Existing open validation query found, skipping duplicate creation', { 
          existingQueryId: existingId, 
          fieldPath: params.fieldPath 
        });
        await client.query('COMMIT');
        return existingId;
      }
    }
    
    // ===== WORKFLOW-BASED QUERY ASSIGNMENT =====
    // Priority:
    // 1. Explicitly provided assignedUserId (from caller)
    // 2. Form workflow config (acc_form_workflow_config.query_route_to_user)
    // 3. Default assignee (coordinator/data manager for the study)
    let assignedUserId = params.assignedUserId;
    
    if (!assignedUserId) {
      // Look up form workflow config to find the designated query recipient
      assignedUserId = await findWorkflowAssignee(client, params.crfId, params.eventCrfId, params.studyId);
    }
    
    if (!assignedUserId) {
      // Fallback to default study role-based assignment
      assignedUserId = await findDefaultAssignee(client, params.studyId, params.subjectId);
    }
    
    const isWarning = params.severity === 'warning';
    const description = isWarning 
      ? `Validation Warning: ${params.ruleName}` 
      : `Validation Error: ${params.ruleName}`;
    const detailedNotes = `Field: ${params.fieldPath}\nValue: ${JSON.stringify(params.value)}\n${isWarning ? 'Warning' : 'Error'}: ${params.errorMessage}\nSeverity: ${params.severity || 'error'}`;

    // LibreClinica discrepancy_note_type_id:
    //   1 = "Failed Validation Check" (hard edit / error)
    //   2 = "Annotation" (soft edit / warning query)
    //   3 = "Query" (manual query)
    // Use type 1 for errors (Failed Validation), type 2 for warnings (Annotation/soft edit)
    const noteTypeId = isWarning ? 2 : 1;
    // Resolution status: 1 = "New"
    const result = await client.query(`
      INSERT INTO discrepancy_note (
        description,
        detailed_notes,
        discrepancy_note_type_id,
        resolution_status_id,
        study_id,
        owner_id,
        assigned_user_id,
        date_created,
        entity_type
      ) VALUES ($1, $2, $3, 1, $4, $5, $6, CURRENT_TIMESTAMP, 'itemData')
      RETURNING discrepancy_note_id
    `, [description, detailedNotes, noteTypeId, params.studyId, params.userId, assignedUserId]);

    const queryId = result.rows[0]?.discrepancy_note_id;
    
    if (!queryId) {
      throw new Error('Failed to create discrepancy note');
    }

    // Link to item_data if available (most precise)
    // column_name should be 'value' (the column in item_data being referenced)
    // per LibreClinica schema convention
    if (itemDataId) {
      await client.query(`
        INSERT INTO dn_item_data_map (discrepancy_note_id, item_data_id, column_name)
        VALUES ($1, $2, $3)
      `, [queryId, itemDataId, 'value']);
      
      logger.info('Linked validation query to item_data', { 
        queryId, 
        itemDataId: itemDataId,
        fieldPath: params.fieldPath 
      });
    }

    // Also link to event CRF if provided (for form-level query viewing)
    if (params.eventCrfId) {
      await client.query(`
        INSERT INTO dn_event_crf_map (discrepancy_note_id, event_crf_id, column_name)
        VALUES ($1, $2, $3)
      `, [queryId, params.eventCrfId, params.fieldPath]);
    }

    // Link to study subject if provided (for patient-level query viewing)
    if (params.subjectId) {
      await client.query(`
        INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)
        VALUES ($1, $2, $3)
      `, [queryId, params.subjectId, params.fieldPath]);
    }

    // Log audit event for query creation
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        new_value, reason_for_change, audit_log_event_type_id
      ) VALUES (
        CURRENT_TIMESTAMP, 'discrepancy_note', $1, $2, 'Validation Query Created',
        $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%created%' LIMIT 1)
      )
    `, [params.userId, queryId, description, `Rule: ${params.ruleName}, Field: ${params.fieldPath}`]);

    await client.query('COMMIT');

    logger.info('Created validation query', { 
      queryId, 
      fieldPath: params.fieldPath,
      itemDataId: itemDataId,
      eventCrfId: params.eventCrfId,
      assignedUserId
    });
    
    return queryId;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error creating validation query:', error.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Find the workflow-assigned user for queries on a specific form.
 * 
 * Checks acc_form_workflow_config.query_route_to_user for the CRF.
 * This is configured in the Workflow Management UI and routes ALL queries
 * for a given form to a specific user.
 * 
 * When a form has a query_route_to_user configured, ALL validation queries
 * (both errors and warnings) are assigned to that user. They will see these
 * queries in their "My Assigned Queries" dashboard and task list.
 * 
 * @param client - DB client (within transaction)
 * @param crfId - The CRF/form template ID (may be undefined)
 * @param eventCrfId - The form instance ID (used to look up crfId if not provided)
 * @param studyId - The study ID for study-specific workflow config
 * @returns The user_id to assign queries to, or null if no workflow config exists
 */
async function findWorkflowAssignee(
  client: any,
  crfId?: number,
  eventCrfId?: number,
  studyId?: number
): Promise<number | null> {
  try {
    // If we don't have crfId but have eventCrfId, look it up
    let resolvedCrfId = crfId;
    if (!resolvedCrfId && eventCrfId) {
      const ecResult = await client.query(`
        SELECT cv.crf_id FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.event_crf_id = $1
      `, [eventCrfId]);
      if (ecResult.rows.length > 0) {
        resolvedCrfId = ecResult.rows[0].crf_id;
      }
    }
    
    if (!resolvedCrfId) return null;
    
    // Check if the acc_form_workflow_config table exists before querying
    // This prevents errors when the migration hasn't run yet
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'acc_form_workflow_config'
      ) as exists
    `);
    if (!tableCheck.rows[0].exists) {
      logger.debug('acc_form_workflow_config table does not exist yet, skipping workflow assignment');
      return null;
    }
    
    // Look up workflow config for this CRF
    // Check study-specific config first, then fall back to global (study_id IS NULL)
    const configResult = await client.query(`
      SELECT query_route_to_user
      FROM acc_form_workflow_config
      WHERE crf_id = $1 
        AND (study_id = $2 OR study_id IS NULL)
        AND query_route_to_user IS NOT NULL
        AND query_route_to_user != ''
      ORDER BY study_id DESC NULLS LAST
      LIMIT 1
    `, [resolvedCrfId, studyId || null]);
    
    if (configResult.rows.length === 0) return null;
    
    const routeToUsername = configResult.rows[0].query_route_to_user;
    if (!routeToUsername) return null;
    
    // Resolve username to user_id
    // The workflow config stores username (user_name), not user_id
    const userResult = await client.query(`
      SELECT user_id FROM user_account
      WHERE user_name = $1 AND enabled = true
      LIMIT 1
    `, [routeToUsername]);
    
    if (userResult.rows.length > 0) {
      logger.info('Workflow-assigned query to user', { 
        crfId: resolvedCrfId, 
        username: routeToUsername,
        userId: userResult.rows[0].user_id 
      });
      return userResult.rows[0].user_id;
    }
    
    logger.warn('Workflow query_route_to_user not found as active user', { 
      username: routeToUsername, crfId: resolvedCrfId 
    });
    return null;
  } catch (e: any) {
    logger.warn('Could not find workflow assignee:', e.message);
    return null;
  }
}

/**
 * Find a default user to assign validation queries to
 * 
 * Priority:
 * 1. Study coordinator assigned to the specific site
 * 2. Data manager for the study
 * 3. Any study user with coordinator role
 * 4. The user who triggered the validation (fallback)
 */
async function findDefaultAssignee(
  client: any,
  studyId: number,
  subjectId?: number
): Promise<number | null> {
  try {
    // Try to find a coordinator or data manager for this study
    // Note: study_user_role uses user_name (not user_id) as the link to user_account
    const result = await client.query(`
      SELECT DISTINCT ua.user_id
      FROM user_account ua
      INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
      WHERE sur.study_id = $1
        AND sur.status_id = 1
        AND sur.role_name IN ('Study Coordinator', 'Clinical Research Coordinator', 'Data Manager', 'coordinator')
      ORDER BY 
        CASE 
          WHEN sur.role_name = 'Study Coordinator' THEN 1
          WHEN sur.role_name = 'Clinical Research Coordinator' THEN 2
          WHEN sur.role_name = 'Data Manager' THEN 3
          ELSE 4
        END
      LIMIT 1
    `, [studyId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].user_id;
    }
    
    // Fallback: Get any active user with access to this study
    const fallbackResult = await client.query(`
      SELECT ua.user_id
      FROM user_account ua
      INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
      WHERE sur.study_id = $1 AND sur.status_id = 1 AND ua.enabled = true
      LIMIT 1
    `, [studyId]);
    
    if (fallbackResult.rows.length > 0) {
      return fallbackResult.rows[0].user_id;
    }
    
    return null;
  } catch (e: any) {
    logger.warn('Could not find default assignee:', e.message);
    return null;
  }
}

/**
 * Find item_data_id by event_crf_id and item identifier (itemId or fieldPath)
 */
async function findItemDataId(
  client: any,
  eventCrfId: number,
  itemId?: number,
  fieldPath?: string
): Promise<number | null> {
  // Try by itemId first (most reliable)
  if (itemId) {
    const result = await client.query(`
      SELECT item_data_id FROM item_data
      WHERE event_crf_id = $1 AND item_id = $2 AND deleted = false
      LIMIT 1
    `, [eventCrfId, itemId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].item_data_id;
    }
  }
  
  // Try by field name
  if (fieldPath) {
    const fieldName = fieldPath.split('.').pop() || fieldPath;
    
    const result = await client.query(`
      SELECT id.item_data_id 
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 
        AND (LOWER(i.name) = LOWER($2) OR LOWER(i.oc_oid) = LOWER($2))
        AND id.deleted = false
      LIMIT 1
    `, [eventCrfId, fieldName]);
    
    if (result.rows.length > 0) {
      return result.rows[0].item_data_id;
    }
  }
  
  return null;
}

/**
 * Apply a single validation rule to a value
 */
function applyRule(
  rule: ValidationRule,
  value: any,
  allData: Record<string, any>
): { valid: boolean } {
  // Handle null/undefined values
  if (value === null || value === undefined || value === '') {
    if (rule.ruleType === 'required') {
      return { valid: false };
    }
    // Other rules don't apply to empty values
    return { valid: true };
  }

  // Detect multi-value fields (checkbox/multi-select stored as comma-separated strings)
  // These need special handling: range and format rules designed for single values
  // should not be applied to comma-separated multi-value strings.
  const isMultiValue = typeof value === 'string' && value.includes(',') &&
    !/^\d[\d,.]*$/.test(value) && // Not a decimal number with commas (e.g., "1,234.56")
    !/^\d{4}-\d{2}-\d{2}/.test(value); // Not a date string

  // Handle array values (in case value comes as actual array)
  if (Array.isArray(value)) {
    if (rule.ruleType === 'required') {
      return { valid: value.length > 0 };
    }
    // Range and format rules don't apply to array/multi-select values
    if (rule.ruleType === 'range' || rule.ruleType === 'format') {
      return { valid: true };
    }
  }

  switch (rule.ruleType) {
    case 'required':
      if (Array.isArray(value)) return { valid: value.length > 0 };
      return { valid: value !== null && value !== undefined && value !== '' };

    case 'range':
      // Skip range validation for multi-value (checkbox/multi-select) fields
      // Comma-separated option values like "opt1,opt2" would produce NaN and falsely fail
      if (isMultiValue) return { valid: true };
      
      // Check for date range validation
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const dateValue = new Date(value);
        if (isNaN(dateValue.getTime())) return { valid: false };
        if (rule.minValue !== undefined) {
          const minDate = new Date(rule.minValue);
          if (!isNaN(minDate.getTime()) && dateValue < minDate) return { valid: false };
        }
        if (rule.maxValue !== undefined) {
          const maxDate = new Date(rule.maxValue);
          if (!isNaN(maxDate.getTime()) && dateValue > maxDate) return { valid: false };
        }
        return { valid: true };
      }
      
      const numValue = Number(value);
      if (isNaN(numValue)) return { valid: false };
      if (rule.minValue !== undefined && numValue < rule.minValue) return { valid: false };
      if (rule.maxValue !== undefined && numValue > rule.maxValue) return { valid: false };
      return { valid: true };

    case 'format':
      // Resolve the pattern: formatType registry takes priority over raw pattern.
      // This is the core of the no-code builder: the DB stores a semantic key like
      // "email" and we look up the regex here at validation time.
      let resolvedPattern = rule.pattern;
      if (rule.formatType && rule.formatType !== 'custom_regex' && FORMAT_TYPE_REGISTRY[rule.formatType]) {
        resolvedPattern = FORMAT_TYPE_REGISTRY[rule.formatType].pattern;
      }
      if (!resolvedPattern) return { valid: true };
      // Skip format/regex validation for multi-value (checkbox/multi-select) fields
      if (isMultiValue) return { valid: true };
      // Check if this is actually an Excel formula stored as format type
      if (resolvedPattern.startsWith('=FORMULA:') || resolvedPattern.startsWith('=')) {
        const formula = resolvedPattern.startsWith('=FORMULA:') 
          ? resolvedPattern.substring(9) 
          : resolvedPattern;
        return evaluateExcelFormula(formula, value, allData);
      }
      try {
        const regex = new RegExp(resolvedPattern);
        return { valid: regex.test(String(value)) };
      } catch {
        return { valid: true }; // Invalid regex = no validation
      }

    case 'consistency':
      const compareValue = getNestedValue(allData, rule.compareFieldPath || '');
      return { valid: compareValues(value, compareValue, rule.operator || '==') };

    case 'formula':
      // Excel formula validation using hot-formula-parser
      if (rule.pattern) {
        return evaluateExcelFormula(rule.pattern, value, allData);
      }
      if (rule.customExpression) {
        return evaluateExcelFormula(rule.customExpression, value, allData);
      }
      return { valid: true };

    case 'business_logic':
    case 'cross_form':
      // Custom expression evaluation - try Excel formula first, fall back to JS
      if (rule.customExpression) {
        // Try Excel formula evaluation first
        const formulaResult = evaluateExcelFormula(rule.customExpression, value, allData);
        if (formulaResult.valid !== undefined) {
          return formulaResult;
        }
        try {
          // Fall back to JS evaluation
          const evalFn = new Function('value', 'data', `return ${rule.customExpression}`);
          return { valid: Boolean(evalFn(value, allData)) };
        } catch {
          return { valid: true };
        }
      }
      return { valid: true };

    default:
      return { valid: true };
  }
}

/**
 * Evaluate an Excel-style formula for validation using hot-formula-parser.
 * 
 * Supports all standard Excel functions: IF, AND, OR, NOT, LEN, LEFT, RIGHT, MID,
 * TRIM, UPPER, LOWER, CONCATENATE, EXACT, FIND, SEARCH, SUBSTITUTE, ISNUMBER,
 * ISTEXT, ISBLANK, VALUE, SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ABS, ROUND,
 * MOD, POWER, SQRT, TODAY, NOW, YEAR, MONTH, DAY, DATE, DATEDIF, etc.
 * 
 * Field references use {fieldName} syntax or are passed as Excel variables.
 * The current field value is available as {value} or {VALUE}.
 * 
 * Examples:
 *   =AND({age}>=18, {age}<=120)
 *   =LEN({value})>=5
 *   =OR({gender}="M", {gender}="F", {gender}="O")
 *   =IF({pregnant}="yes", {age}>=18, TRUE)
 *   =AND(ISNUMBER({weight}), {weight}>0, {weight}<500)
 *   =NOT(ISBLANK({value}))
 *   =EXACT(LEFT({value},3),"ABC")
 */
function evaluateExcelFormula(
  formula: string,
  currentValue: any,
  allData: Record<string, any>
): { valid: boolean } {
  try {
    const parser = new FormulaParser();

    // Build a lookup map: lowercase field name -> value
    const fieldValues: Record<string, any> = {};
    for (const [key, val] of Object.entries(allData)) {
      fieldValues[key.toLowerCase()] = val;
      fieldValues[key] = val;
    }
    // Make current field value available
    fieldValues['value'] = currentValue;
    fieldValues['VALUE'] = currentValue;

    // Replace {fieldName} placeholders with cell-safe variable names
    // e.g., {age} -> __age__, {blood_pressure} -> __blood_pressure__
    let processedFormula = formula;
    // Strip leading = if present
    if (processedFormula.startsWith('=')) {
      processedFormula = processedFormula.substring(1);
    }

    // Replace {fieldName} references with parser variable names
    const fieldRefs = processedFormula.match(/\{([^}]+)\}/g) || [];
    const varMap: Record<string, string> = {};
    for (const ref of fieldRefs) {
      const fieldName = ref.slice(1, -1); // Remove { and }
      const varName = fieldName.replace(/[^a-zA-Z0-9]/g, '_');
      varMap[varName] = fieldName;
      processedFormula = processedFormula.split(ref).join(varName);
    }

    // Hook into the parser's variable resolution
    parser.on('callVariable', function(name: string, done: (val: any) => void) {
      // Check the var map first (for {fieldName} references)
      const mappedName = varMap[name];
      if (mappedName !== undefined) {
        const val = fieldValues[mappedName] ?? fieldValues[mappedName.toLowerCase()];
        done(val !== undefined && val !== null && val !== '' ? val : '');
        return;
      }
      // Direct field name lookup
      const val = fieldValues[name] ?? fieldValues[name.toLowerCase()];
      done(val !== undefined && val !== null && val !== '' ? val : '');
    });

    // Parse and evaluate the formula
    const result = parser.parse(processedFormula);

    if (result.error) {
      logger.warn('Excel formula parse error', { formula, error: result.error });
      return { valid: true }; // Don't fail validation on formula errors
    }

    // The formula should return a boolean (TRUE/FALSE)
    // If it returns a number, treat 0 as false and anything else as true
    if (typeof result.result === 'boolean') {
      return { valid: result.result };
    }
    if (typeof result.result === 'number') {
      return { valid: result.result !== 0 };
    }
    if (typeof result.result === 'string') {
      const lower = result.result.toLowerCase();
      if (lower === 'true' || lower === 'yes') return { valid: true };
      if (lower === 'false' || lower === 'no') return { valid: false };
    }

    // Any non-null result is considered valid
    return { valid: result.result != null };
  } catch (error: any) {
    logger.warn('Excel formula evaluation error', { formula, error: error.message });
    return { valid: true }; // Don't fail validation on errors
  }
}

/**
 * Compare two values with an operator
 */
function compareValues(a: any, b: any, operator: string): boolean {
  // Handle date comparison
  if (a instanceof Date || !isNaN(Date.parse(a))) {
    const dateA = new Date(a).getTime();
    const dateB = new Date(b).getTime();
    a = dateA;
    b = dateB;
  }

  switch (operator) {
    case '==': return a == b;
    case '===': return a === b;
    case '!=': return a != b;
    case '!==': return a !== b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return true;
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Map database row to ValidationRule interface
 */
function mapDbRowToRule(row: any): ValidationRule {
  return {
    id: row.id || row.validation_rule_id,
    crfId: row.crf_id,
    crfVersionId: row.crf_version_id,
    itemId: row.item_id,
    name: row.name,
    description: row.description || '',
    ruleType: row.rule_type,
    fieldPath: row.field_path,
    severity: row.severity || 'error',
    errorMessage: row.error_message,
    warningMessage: row.warning_message,
    active: row.active !== false,
    minValue: row.min_value != null ? Number(row.min_value) : undefined,
    maxValue: row.max_value != null ? Number(row.max_value) : undefined,
    pattern: row.pattern,
    formatType: row.format_type || undefined,
    operator: row.operator,
    compareFieldPath: row.compare_field_path,
    customExpression: row.custom_expression,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    createdBy: row.created_by || row.owner_id,
    updatedBy: row.updated_by || row.update_id
  };
}

/**
 * Get validation rules by event_crf_id (for form copies/instances)
 * 
 * When a form template is assigned to a patient visit, it creates an event_crf record.
 * This function retrieves validation rules for that specific form instance by:
 * 1. Looking up the crf_id from the event_crf
 * 2. Getting rules for that CRF
 * 
 * This ensures validation rules apply consistently to ALL form copies.
 */
export const getRulesForEventCrf = async (eventCrfId: number, callerUserId?: number): Promise<ValidationRule[]> => {
  logger.info('Getting validation rules for event_crf', { eventCrfId, callerUserId });

  try {
    // Get the CRF ID from the event_crf
    const eventCrfResult = await pool.query(`
      SELECT ec.event_crf_id, cv.crf_id, cv.crf_version_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (eventCrfResult.rows.length === 0) {
      logger.warn('Event CRF not found', { eventCrfId });
      return [];
    }

    const crfId = eventCrfResult.rows[0].crf_id;
    
    // Get rules for this CRF
    return await getRulesForCrf(crfId, callerUserId);
  } catch (error: any) {
    logger.error('Get rules for event_crf error', { error: error.message, eventCrfId });
    throw error;
  }
};

/**
 * Validate an event_crf (form instance on a patient)
 * 
 * This is the primary validation function for form instances.
 * It handles:
 * - Looking up the form data from the database
 * - Applying all validation rules
 * - Creating queries for validation failures
 */
export const validateEventCrf = async (
  eventCrfId: number,
  options?: {
    createQueries?: boolean;
    userId?: number;
  }
): Promise<{
  valid: boolean;
  errors: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number }[];
  warnings: { fieldPath: string; message: string; queryId?: number }[];
  queriesCreated?: number;
}> => {
  logger.info('Validating event_crf', { eventCrfId });

  try {
    // Get event_crf details
    const eventCrfResult = await pool.query(`
      SELECT 
        ec.event_crf_id, 
        cv.crf_id, 
        cv.crf_version_id,
        ec.study_subject_id,
        ss.study_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (eventCrfResult.rows.length === 0) {
      throw new Error(`Event CRF ${eventCrfId} not found`);
    }

    const eventCrf = eventCrfResult.rows[0];

    // Get all item data for this event_crf
    const itemDataResult = await pool.query(`
      SELECT 
        id.item_data_id,
        id.item_id,
        id.value,
        i.name as field_name,
        i.oc_oid as field_oid
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 AND id.deleted = false
    `, [eventCrfId]);

    // Build form data object and item data map
    const formData: Record<string, any> = {};
    const itemDataMap: Record<string, number> = {};

    for (const row of itemDataResult.rows) {
      formData[row.field_name] = row.value;
      itemDataMap[row.field_name] = row.item_data_id;
      itemDataMap[row.field_name.toLowerCase()] = row.item_data_id;
      if (row.field_oid) {
        formData[row.field_oid] = row.value;
        itemDataMap[row.field_oid] = row.item_data_id;
      }
    }

    // Validate the form data
    return await validateFormData(eventCrf.crf_id, formData, {
      createQueries: options?.createQueries,
      studyId: eventCrf.study_id,
      subjectId: eventCrf.study_subject_id,
      eventCrfId: eventCrfId,
      userId: options?.userId,
      crfVersionId: eventCrf.crf_version_id,
      itemDataMap
    });
  } catch (error: any) {
    logger.error('Validate event_crf error', { error: error.message, eventCrfId });
    throw error;
  }
};

/**
 * Get rule execution history from rule_action_run table
 * Returns history of when validation rules were executed and what actions were taken
 */
export const getRuleExecutionHistory = async (
  studyId: number,
  options?: { limit?: number; offset?: number; ruleId?: number }
): Promise<{ success: boolean; data: any[]; total: number }> => {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // Check if rule_action_run table exists (it's a LibreClinica Core table)
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'rule_action_run'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      return { success: true, data: [], total: 0 };
    }

    let whereClause = 'WHERE rs.study_id = $1';
    const params: any[] = [studyId];
    let paramIdx = 2;

    if (options?.ruleId) {
      whereClause += ` AND r.rule_id = $${paramIdx++}`;
      params.push(options.ruleId);
    }

    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM rule_action_run rar
      INNER JOIN rule_action ra ON rar.rule_action_id = ra.rule_action_id
      INNER JOIN rule_set_rule rsr ON ra.rule_set_rule_id = rsr.rule_set_rule_id
      INNER JOIN rule_set rs ON rsr.rule_set_id = rs.rule_set_id
      INNER JOIN rule r ON rsr.rule_id = r.rule_id
      ${whereClause}
    `, params);

    params.push(limit, offset);
    const result = await pool.query(`
      SELECT 
        rar.id as run_id,
        rar.token,
        rar.run_time,
        rar.status as run_status,
        ra.action_type,
        ra.message,
        r.name as rule_name,
        r.description as rule_description,
        re.value as rule_expression,
        rsr.rule_set_rule_id,
        rs.study_id,
        rs.study_event_definition_id,
        rs.crf_id,
        rs.crf_version_id,
        rs.item_id
      FROM rule_action_run rar
      INNER JOIN rule_action ra ON rar.rule_action_id = ra.rule_action_id
      INNER JOIN rule_set_rule rsr ON ra.rule_set_rule_id = rsr.rule_set_rule_id
      INNER JOIN rule_set rs ON rsr.rule_set_id = rs.rule_set_id
      INNER JOIN rule r ON rsr.rule_id = r.rule_id
      LEFT JOIN rule_expression re ON r.rule_expression_id = re.rule_expression_id
      ${whereClause}
      ORDER BY rar.run_time DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx}
    `, params);

    return {
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].total)
    };
  } catch (error: any) {
    logger.warn('getRuleExecutionHistory error', { error: error.message });
    return { success: true, data: [], total: 0 };
  }
};

/**
 * Public wrapper around applyRule for direct rule testing.
 * Used by the testRule controller endpoint to evaluate any rule type
 * (including formula rules) without needing a CRF in the database.
 */
export const testRuleDirectly = (
  rule: ValidationRule,
  value: any,
  allData: Record<string, any>
): { valid: boolean } => {
  return applyRule(rule, value, allData);
};

export default {
  initializeValidationRulesTable,
  getRulesForCrf,
  getRulesForStudy,
  getRulesForEventCrf,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  validateFormData,
  validateFieldChange,
  validateEventCrf,
  getRuleExecutionHistory,
  testRuleDirectly
};

