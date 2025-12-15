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

export interface ValidationRule {
  id: number;
  crfId: number;
  crfVersionId?: number;
  itemId?: number;
  name: string;
  description: string;
  ruleType: 'range' | 'format' | 'required' | 'consistency' | 'business_logic' | 'cross_form';
  fieldPath: string;
  severity: 'error' | 'warning';
  errorMessage: string;
  warningMessage?: string;
  active: boolean;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
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
  operator?: string;
  compareFieldPath?: string;
  customExpression?: string;
}

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
export const getRulesForCrf = async (crfId: number): Promise<ValidationRule[]> => {
  logger.info('Getting validation rules for CRF', { crfId });

  // Ensure table exists before querying
  await initializeValidationRulesTable();

  try {
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
    const itemRulesQuery = `
      SELECT 
        ifm.item_id as id,
        cv.crf_id,
        ifm.crf_version_id,
        i.item_id,
        i.name,
        i.description,
        CASE 
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
        ifm.regexp as pattern,
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
        active: row.enabled || true,
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
 */
export const getRulesForStudy = async (studyId: number): Promise<{ crfId: number; crfName: string; rules: ValidationRule[] }[]> => {
  logger.info('Getting validation rules for study', { studyId });

  try {
    // Get all CRFs for the study
    const crfsQuery = `
      SELECT DISTINCT c.crf_id, c.name
      FROM crf c
      INNER JOIN crf_version cv ON c.crf_id = cv.crf_id
      INNER JOIN event_definition_crf edc ON cv.crf_id = edc.crf_id
      INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id
      WHERE sed.study_id = $1
      ORDER BY c.name
    `;

    const crfsResult = await pool.query(crfsQuery, [studyId]);

    const results = [];
    for (const crf of crfsResult.rows) {
      const rules = await getRulesForCrf(crf.crf_id);
      results.push({
        crfId: crf.crf_id,
        crfName: crf.name,
        rules
      });
    }

    return results;
  } catch (error: any) {
    logger.error('Get study validation rules error', { error: error.message });
    throw error;
  }
};

/**
 * Get a single validation rule by ID
 */
export const getRuleById = async (ruleId: number): Promise<ValidationRule | null> => {
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
        min_value, max_value, pattern, operator, compare_field_path,
        custom_expression, date_created, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, $17)
      RETURNING validation_rule_id
    `;

    const result = await client.query(insertQuery, [
      rule.crfId,
      rule.crfVersionId || null,
      rule.itemId || null,
      rule.name,
      rule.description || '',
      rule.ruleType,
      rule.fieldPath,
      rule.severity || 'error',
      rule.errorMessage,
      rule.warningMessage || null,
      rule.minValue || null,
      rule.maxValue || null,
      rule.pattern || null,
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
        operator = $11,
        compare_field_path = $12,
        custom_expression = $13,
        date_updated = CURRENT_TIMESTAMP,
        update_id = $14
      WHERE validation_rule_id = $15
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
 */
export const validateFormData = async (
  crfId: number,
  formData: Record<string, any>
): Promise<{
  valid: boolean;
  errors: { fieldPath: string; message: string; severity: string }[];
  warnings: { fieldPath: string; message: string }[];
}> => {
  logger.info('Validating form data', { crfId, fieldsCount: Object.keys(formData).length });

  const rules = await getRulesForCrf(crfId);
  const errors: { fieldPath: string; message: string; severity: string }[] = [];
  const warnings: { fieldPath: string; message: string }[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    const value = getNestedValue(formData, rule.fieldPath);
    const validationResult = applyRule(rule, value, formData);

    if (!validationResult.valid) {
      if (rule.severity === 'error') {
        errors.push({
          fieldPath: rule.fieldPath,
          message: rule.errorMessage,
          severity: 'error'
        });
      } else {
        warnings.push({
          fieldPath: rule.fieldPath,
          message: rule.warningMessage || rule.errorMessage
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

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

  switch (rule.ruleType) {
    case 'required':
      return { valid: value !== null && value !== undefined && value !== '' };

    case 'range':
      const numValue = Number(value);
      if (isNaN(numValue)) return { valid: false };
      if (rule.minValue !== undefined && numValue < rule.minValue) return { valid: false };
      if (rule.maxValue !== undefined && numValue > rule.maxValue) return { valid: false };
      return { valid: true };

    case 'format':
      if (!rule.pattern) return { valid: true };
      try {
        const regex = new RegExp(rule.pattern);
        return { valid: regex.test(String(value)) };
      } catch {
        return { valid: true }; // Invalid regex = no validation
      }

    case 'consistency':
      const compareValue = getNestedValue(allData, rule.compareFieldPath || '');
      return { valid: compareValues(value, compareValue, rule.operator || '==') };

    case 'business_logic':
    case 'cross_form':
      // Custom expression evaluation would go here
      if (rule.customExpression) {
        try {
          // Safe evaluation using Function constructor
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
    minValue: row.min_value ? Number(row.min_value) : undefined,
    maxValue: row.max_value ? Number(row.max_value) : undefined,
    pattern: row.pattern,
    operator: row.operator,
    compareFieldPath: row.compare_field_path,
    customExpression: row.custom_expression,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    createdBy: row.created_by || row.owner_id,
    updatedBy: row.updated_by || row.update_id
  };
}

export default {
  initializeValidationRulesTable,
  getRulesForCrf,
  getRulesForStudy,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  validateFormData
};

