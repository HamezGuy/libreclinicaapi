/**
 * Skip Logic Service
 * 
 * Manages skip logic rules, form linking, and conditional field visibility.
 * 
 * Features:
 * - CRUD operations for skip logic rules
 * - Form linking based on field values (e.g., open SAE form if AE = Yes)
 * - Evaluation of conditions at runtime
 * - Integration with LibreClinica's scd_item_metadata (Simple Conditional Display)
 * 
 * 21 CFR Part 11 §11.10(h) - Device checks for data validity
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import {
  SkipLogicRule,
  SkipLogicCondition,
  SkipLogicAction,
  FormLink,
  FormLinkPrefill,
  SkipLogicOperator,
  FieldVisibilityState,
  EvaluateSkipLogicResponse,
  CreateSkipLogicRuleRequest,
  CreateFormLinkRequest,
  FormBranchingResult
} from '../../types/skip-logic.types';

// Track if tables have been initialized
let tablesInitialized = false;

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

/**
 * Initialize skip logic tables if they don't exist
 */
export const initializeSkipLogicTables = async (): Promise<boolean> => {
  if (tablesInitialized) {
    return true;
  }

  const client = await pool.connect();

  try {
    // Check if tables exist
    const checkResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'skip_logic_rules'
      );
    `);

    if (checkResult.rows[0].exists) {
      tablesInitialized = true;
      return true;
    }

    // Create skip_logic_rules table
    await client.query(`
      CREATE TABLE IF NOT EXISTS skip_logic_rules (
        rule_id SERIAL PRIMARY KEY,
        crf_id INTEGER NOT NULL,
        crf_version_id INTEGER,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        conditions_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        else_actions_json TEXT,
        enabled BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 100,
        date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_updated TIMESTAMP,
        owner_id INTEGER,
        update_id INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_skip_rules_crf ON skip_logic_rules(crf_id);
      CREATE INDEX IF NOT EXISTS idx_skip_rules_enabled ON skip_logic_rules(enabled);
    `);

    // Create form_links table
    await client.query(`
      CREATE TABLE IF NOT EXISTS form_links (
        link_id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        source_crf_id INTEGER NOT NULL,
        source_field_id VARCHAR(255) NOT NULL,
        trigger_conditions_json TEXT NOT NULL,
        target_crf_id INTEGER NOT NULL,
        target_crf_version_id INTEGER,
        link_type VARCHAR(50) DEFAULT 'modal',
        required BOOLEAN DEFAULT false,
        auto_open BOOLEAN DEFAULT true,
        prefill_fields_json TEXT,
        enabled BOOLEAN DEFAULT true,
        date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_updated TIMESTAMP,
        owner_id INTEGER,
        update_id INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_form_links_source ON form_links(source_crf_id);
      CREATE INDEX IF NOT EXISTS idx_form_links_target ON form_links(target_crf_id);
      CREATE INDEX IF NOT EXISTS idx_form_links_field ON form_links(source_field_id);
    `);

    // Create form_branching table for event-level branching
    await client.query(`
      CREATE TABLE IF NOT EXISTS form_branching (
        branch_id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        study_event_definition_id INTEGER,
        source_crf_id INTEGER NOT NULL,
        conditions_json TEXT NOT NULL,
        target_forms_json TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 100,
        date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_updated TIMESTAMP,
        owner_id INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_form_branching_source ON form_branching(source_crf_id);
      CREATE INDEX IF NOT EXISTS idx_form_branching_event ON form_branching(study_event_definition_id);
    `);

    tablesInitialized = true;
    logger.info('Skip logic tables initialized successfully');
    return true;
  } catch (error: any) {
    logger.error('Failed to initialize skip logic tables:', error.message);
    return false;
  } finally {
    client.release();
  }
};

// ============================================================================
// SKIP LOGIC RULES CRUD
// ============================================================================

/**
 * Get all skip logic rules for a CRF
 */
export const getSkipLogicRulesForCrf = async (crfId: number): Promise<SkipLogicRule[]> => {
  await initializeSkipLogicTables();

  try {
    // Get custom skip logic rules
    const customRulesResult = await pool.query(`
      SELECT * FROM skip_logic_rules
      WHERE crf_id = $1 AND enabled = true
      ORDER BY priority, name
    `, [crfId]);

    const customRules: SkipLogicRule[] = customRulesResult.rows.map(row => ({
      id: row.rule_id.toString(),
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      priority: row.priority || 100,
      conditions: safeJsonParse(row.conditions_json, []),
      actions: safeJsonParse(row.actions_json, []),
      elseActions: safeJsonParse(row.else_actions_json, []),
      crfId: row.crf_id,
      crfVersionId: row.crf_version_id,
      createdAt: row.date_created,
      createdBy: row.owner_id,
      updatedAt: row.date_updated,
      updatedBy: row.update_id
    }));

    // Also get LibreClinica's native SCD (Simple Conditional Display) rules
    const scdRules = await getLibreClinicaScdRules(crfId);

    return [...customRules, ...scdRules];
  } catch (error: any) {
    logger.error('Error getting skip logic rules:', error.message);
    throw error;
  }
};

/**
 * Get LibreClinica's native SCD rules and convert to our format
 */
const getLibreClinicaScdRules = async (crfId: number): Promise<SkipLogicRule[]> => {
  try {
    const result = await pool.query(`
      SELECT 
        scd.id as scd_id,
        scd.scd_item_form_metadata_id,
        scd.control_item_form_metadata_id,
        scd.control_item_name,
        scd.option_value,
        scd.message,
        i_target.name as target_field_name,
        i_target.item_id as target_item_id,
        i_control.name as control_field_name,
        i_control.item_id as control_item_id
      FROM scd_item_metadata scd
      INNER JOIN item_form_metadata ifm_target ON scd.scd_item_form_metadata_id = ifm_target.item_form_metadata_id
      INNER JOIN item i_target ON ifm_target.item_id = i_target.item_id
      INNER JOIN crf_version cv ON ifm_target.crf_version_id = cv.crf_version_id
      LEFT JOIN item_form_metadata ifm_control ON scd.control_item_form_metadata_id = ifm_control.item_form_metadata_id
      LEFT JOIN item i_control ON ifm_control.item_id = i_control.item_id
      WHERE cv.crf_id = $1
    `, [crfId]);

    return result.rows.map(row => ({
      id: `scd_${row.scd_id}`,
      name: `SCD: Show ${row.target_field_name} when ${row.control_item_name || row.control_field_name} = ${row.option_value}`,
      description: row.message || 'LibreClinica Simple Conditional Display',
      enabled: true,
      priority: 50,  // SCD rules have higher priority
      conditions: [{
        fieldId: row.control_field_name || row.control_item_name,
        operator: 'equals' as SkipLogicOperator,
        value: row.option_value
      }],
      actions: [{
        type: 'show' as const,
        targetFieldId: row.target_field_name,
        message: row.message
      }],
      elseActions: [{
        type: 'hide' as const,
        targetFieldId: row.target_field_name
      }],
      crfId
    }));
  } catch (error: any) {
    logger.debug('SCD query failed (optional):', error.message);
    return [];
  }
};

/**
 * Create a new skip logic rule
 */
export const createSkipLogicRule = async (
  request: CreateSkipLogicRuleRequest,
  userId: number
): Promise<{ success: boolean; ruleId?: number; message?: string }> => {
  await initializeSkipLogicTables();

  try {
    const result = await pool.query(`
      INSERT INTO skip_logic_rules (
        crf_id, crf_version_id, name, description,
        conditions_json, actions_json, else_actions_json,
        enabled, priority, date_created, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
      RETURNING rule_id
    `, [
      request.crfId,
      request.crfVersionId || null,
      request.name,
      request.description || '',
      JSON.stringify(request.conditions),
      JSON.stringify(request.actions),
      request.elseActions ? JSON.stringify(request.elseActions) : null,
      request.enabled !== false,
      request.priority || 100,
      userId
    ]);

    logger.info('Created skip logic rule', { ruleId: result.rows[0].rule_id, name: request.name });

    return { success: true, ruleId: result.rows[0].rule_id };
  } catch (error: any) {
    logger.error('Error creating skip logic rule:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Update a skip logic rule
 */
export const updateSkipLogicRule = async (
  ruleId: number,
  updates: Partial<CreateSkipLogicRuleRequest>,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.conditions !== undefined) {
      setClauses.push(`conditions_json = $${paramIndex++}`);
      values.push(JSON.stringify(updates.conditions));
    }
    if (updates.actions !== undefined) {
      setClauses.push(`actions_json = $${paramIndex++}`);
      values.push(JSON.stringify(updates.actions));
    }
    if (updates.elseActions !== undefined) {
      setClauses.push(`else_actions_json = $${paramIndex++}`);
      values.push(JSON.stringify(updates.elseActions));
    }
    if (updates.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      values.push(updates.enabled);
    }
    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }

    setClauses.push(`date_updated = CURRENT_TIMESTAMP`);
    setClauses.push(`update_id = $${paramIndex++}`);
    values.push(userId);

    values.push(ruleId);

    await pool.query(`
      UPDATE skip_logic_rules
      SET ${setClauses.join(', ')}
      WHERE rule_id = $${paramIndex}
    `, values);

    return { success: true };
  } catch (error: any) {
    logger.error('Error updating skip logic rule:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Delete a skip logic rule
 */
export const deleteSkipLogicRule = async (
  ruleId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`DELETE FROM skip_logic_rules WHERE rule_id = $1`, [ruleId]);
    logger.info('Deleted skip logic rule', { ruleId, userId });
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting skip logic rule:', error.message);
    return { success: false, message: error.message };
  }
};

// ============================================================================
// FORM LINKING CRUD
// ============================================================================

/**
 * Get all form links for a source CRF
 */
export const getFormLinksForCrf = async (crfId: number): Promise<FormLink[]> => {
  await initializeSkipLogicTables();

  try {
    const result = await pool.query(`
      SELECT 
        fl.*,
        c.name as target_crf_name
      FROM form_links fl
      LEFT JOIN crf c ON fl.target_crf_id = c.crf_id
      WHERE fl.source_crf_id = $1 AND fl.enabled = true
      ORDER BY fl.name
    `, [crfId]);

    return result.rows.map(row => ({
      id: row.link_id.toString(),
      name: row.name,
      description: row.description,
      sourceCrfId: row.source_crf_id,
      sourceFieldId: row.source_field_id,
      triggerConditions: safeJsonParse(row.trigger_conditions_json, []),
      targetCrfId: row.target_crf_id,
      targetCrfName: row.target_crf_name,
      targetCrfVersionId: row.target_crf_version_id,
      linkType: row.link_type || 'modal',
      required: row.required || false,
      autoOpen: row.auto_open !== false,
      prefillFields: safeJsonParse(row.prefill_fields_json, []),
      enabled: row.enabled,
      createdAt: row.date_created,
      createdBy: row.owner_id
    }));
  } catch (error: any) {
    logger.error('Error getting form links:', error.message);
    return [];
  }
};

/**
 * Get form links for a specific field
 */
export const getFormLinksForField = async (
  crfId: number, 
  fieldId: string
): Promise<FormLink[]> => {
  await initializeSkipLogicTables();

  try {
    const result = await pool.query(`
      SELECT 
        fl.*,
        c.name as target_crf_name
      FROM form_links fl
      LEFT JOIN crf c ON fl.target_crf_id = c.crf_id
      WHERE fl.source_crf_id = $1 AND fl.source_field_id = $2 AND fl.enabled = true
      ORDER BY fl.name
    `, [crfId, fieldId]);

    return result.rows.map(row => ({
      id: row.link_id.toString(),
      name: row.name,
      description: row.description,
      sourceCrfId: row.source_crf_id,
      sourceFieldId: row.source_field_id,
      triggerConditions: safeJsonParse(row.trigger_conditions_json, []),
      targetCrfId: row.target_crf_id,
      targetCrfName: row.target_crf_name,
      targetCrfVersionId: row.target_crf_version_id,
      linkType: row.link_type || 'modal',
      required: row.required || false,
      autoOpen: row.auto_open !== false,
      prefillFields: safeJsonParse(row.prefill_fields_json, []),
      enabled: row.enabled,
      createdAt: row.date_created,
      createdBy: row.owner_id
    }));
  } catch (error: any) {
    logger.error('Error getting form links for field:', error.message);
    return [];
  }
};

/**
 * Create a form link
 */
export const createFormLink = async (
  request: CreateFormLinkRequest,
  userId: number
): Promise<{ success: boolean; linkId?: number; message?: string }> => {
  await initializeSkipLogicTables();

  try {
    const result = await pool.query(`
      INSERT INTO form_links (
        name, description, source_crf_id, source_field_id,
        trigger_conditions_json, target_crf_id, target_crf_version_id,
        link_type, required, auto_open, prefill_fields_json,
        enabled, date_created, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, CURRENT_TIMESTAMP, $12)
      RETURNING link_id
    `, [
      request.name,
      request.description || '',
      request.sourceCrfId,
      request.sourceFieldId,
      JSON.stringify(request.triggerConditions),
      request.targetCrfId,
      request.targetCrfVersionId || null,
      request.linkType || 'modal',
      request.required || false,
      request.autoOpen !== false,
      request.prefillFields ? JSON.stringify(request.prefillFields) : null,
      userId
    ]);

    logger.info('Created form link', { 
      linkId: result.rows[0].link_id, 
      source: request.sourceCrfId,
      target: request.targetCrfId 
    });

    return { success: true, linkId: result.rows[0].link_id };
  } catch (error: any) {
    logger.error('Error creating form link:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Delete a form link
 */
export const deleteFormLink = async (
  linkId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`DELETE FROM form_links WHERE link_id = $1`, [linkId]);
    logger.info('Deleted form link', { linkId, userId });
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting form link:', error.message);
    return { success: false, message: error.message };
  }
};

// ============================================================================
// SKIP LOGIC EVALUATION
// ============================================================================

/**
 * Evaluate all skip logic for a form and return field states
 */
export const evaluateSkipLogic = async (
  crfId: number,
  formData: Record<string, any>,
  options?: {
    subjectId?: number;
    eventId?: number;
    includeFormLinks?: boolean;
  }
): Promise<EvaluateSkipLogicResponse> => {
  const fieldStates: Record<string, FieldVisibilityState> = {};
  const linkedForms: EvaluateSkipLogicResponse['linkedForms'] = [];
  const messages: EvaluateSkipLogicResponse['messages'] = [];

  try {
    // Get all skip logic rules for the CRF
    const rules = await getSkipLogicRulesForCrf(crfId);

    // Evaluate each rule
    for (const rule of rules) {
      if (!rule.enabled) continue;

      const conditionsMet = evaluateConditions(rule.conditions, formData);
      const actionsToApply = conditionsMet ? rule.actions : (rule.elseActions || []);

      for (const action of actionsToApply) {
        applyAction(action, fieldStates, messages);
      }
    }

    // Evaluate form links if requested
    if (options?.includeFormLinks !== false) {
      const formLinks = await getFormLinksForCrf(crfId);

      for (const link of formLinks) {
        if (!link.enabled) continue;

        const fieldValue = formData[link.sourceFieldId];
        const shouldTrigger = evaluateConditions(link.triggerConditions, formData);

        if (shouldTrigger) {
          linkedForms.push({
            fieldId: link.sourceFieldId,
            targetFormId: link.targetCrfId,
            targetFormName: link.targetCrfName || `Form ${link.targetCrfId}`,
            shouldOpen: link.autoOpen
          });

          // Update field state with linked form info
          if (!fieldStates[link.sourceFieldId]) {
            fieldStates[link.sourceFieldId] = {
              fieldId: link.sourceFieldId,
              visible: true,
              required: false,
              disabled: false,
              linkedForms: [],
              evaluatedAt: new Date()
            };
          }
          
          if (!fieldStates[link.sourceFieldId].linkedForms) {
            fieldStates[link.sourceFieldId].linkedForms = [];
          }
          
          fieldStates[link.sourceFieldId].linkedForms!.push({
            formId: link.targetCrfId,
            formName: link.targetCrfName || `Form ${link.targetCrfId}`,
            autoOpen: link.autoOpen
          });
        }
      }
    }

    return {
      success: true,
      fieldStates,
      linkedForms,
      messages
    };
  } catch (error: any) {
    logger.error('Error evaluating skip logic:', error.message);
    return {
      success: false,
      fieldStates: {},
      linkedForms: [],
      messages: [{ message: 'Failed to evaluate skip logic', type: 'error' }]
    };
  }
};

/**
 * Evaluate conditions against form data
 */
export const evaluateConditions = (
  conditions: SkipLogicCondition[],
  formData: Record<string, any>
): boolean => {
  if (!conditions || conditions.length === 0) {
    return true;
  }

  let result = true;
  let currentOperator: 'AND' | 'OR' = 'AND';

  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i];
    const conditionResult = evaluateSingleCondition(condition, formData);

    if (i === 0) {
      result = conditionResult;
    } else {
      if (currentOperator === 'AND') {
        result = result && conditionResult;
      } else {
        result = result || conditionResult;
      }
    }

    currentOperator = condition.logicalOperator || 'AND';
  }

  return result;
};

/**
 * Evaluate a single condition
 */
const evaluateSingleCondition = (
  condition: SkipLogicCondition,
  formData: Record<string, any>
): boolean => {
  const fieldValue = getNestedValue(formData, condition.fieldId);
  const compareValue = condition.value;
  const compareValue2 = condition.value2;

  switch (condition.operator) {
    case 'equals':
      return areValuesEqual(fieldValue, compareValue);

    case 'not_equals':
      return !areValuesEqual(fieldValue, compareValue);

    case 'greater_than':
      return toNumber(fieldValue) > toNumber(compareValue);

    case 'less_than':
      return toNumber(fieldValue) < toNumber(compareValue);

    case 'greater_than_or_equal':
      return toNumber(fieldValue) >= toNumber(compareValue);

    case 'less_than_or_equal':
      return toNumber(fieldValue) <= toNumber(compareValue);

    case 'between':
      const num = toNumber(fieldValue);
      return num >= toNumber(compareValue) && num <= toNumber(compareValue2);

    case 'not_between':
      const numVal = toNumber(fieldValue);
      return numVal < toNumber(compareValue) || numVal > toNumber(compareValue2);

    case 'contains':
      return toString(fieldValue).toLowerCase().includes(toString(compareValue).toLowerCase());

    case 'not_contains':
      return !toString(fieldValue).toLowerCase().includes(toString(compareValue).toLowerCase());

    case 'starts_with':
      return toString(fieldValue).toLowerCase().startsWith(toString(compareValue).toLowerCase());

    case 'ends_with':
      return toString(fieldValue).toLowerCase().endsWith(toString(compareValue).toLowerCase());

    case 'is_empty':
      return isEmpty(fieldValue);

    case 'is_not_empty':
      return !isEmpty(fieldValue);

    case 'is_true':
      return toBoolean(fieldValue) === true;

    case 'is_false':
      return toBoolean(fieldValue) === false;

    case 'in_list':
      return isInList(fieldValue, compareValue);

    case 'not_in_list':
      return !isInList(fieldValue, compareValue);

    case 'matches_regex':
      try {
        return new RegExp(toString(compareValue)).test(toString(fieldValue));
      } catch {
        return false;
      }

    case 'date_before':
      return new Date(fieldValue) < new Date(compareValue);

    case 'date_after':
      return new Date(fieldValue) > new Date(compareValue);

    case 'date_between':
      const dateVal = new Date(fieldValue);
      return dateVal >= new Date(compareValue) && dateVal <= new Date(compareValue2);

    case 'age_greater_than':
      const age = calculateAge(fieldValue);
      return age !== null && age > toNumber(compareValue);

    case 'age_less_than':
      const ageVal = calculateAge(fieldValue);
      return ageVal !== null && ageVal < toNumber(compareValue);

    default:
      logger.warn(`Unknown skip logic operator: ${condition.operator}`);
      return true;
  }
};

/**
 * Apply an action to field states
 */
const applyAction = (
  action: SkipLogicAction,
  fieldStates: Record<string, FieldVisibilityState>,
  messages: EvaluateSkipLogicResponse['messages']
): void => {
  const fieldId = action.targetFieldId;
  
  if (fieldId && !fieldStates[fieldId]) {
    fieldStates[fieldId] = {
      fieldId,
      visible: true,
      required: false,
      disabled: false,
      evaluatedAt: new Date()
    };
  }

  switch (action.type) {
    case 'show':
      if (fieldId) fieldStates[fieldId].visible = true;
      break;

    case 'hide':
      if (fieldId) fieldStates[fieldId].visible = false;
      break;

    case 'require':
      if (fieldId) fieldStates[fieldId].required = true;
      break;

    case 'optional':
      if (fieldId) fieldStates[fieldId].required = false;
      break;

    case 'disable':
      if (fieldId) fieldStates[fieldId].disabled = true;
      break;

    case 'enable':
      if (fieldId) fieldStates[fieldId].disabled = false;
      break;

    case 'set_value':
      if (fieldId) fieldStates[fieldId].value = action.value;
      break;

    case 'clear_value':
      if (fieldId) fieldStates[fieldId].value = null;
      break;

    case 'show_message':
      if (action.message) {
        messages.push({
          fieldId,
          message: action.message,
          type: 'info'
        });
      }
      break;

    case 'open_form':
      if (fieldId && action.targetFormId) {
        if (!fieldStates[fieldId].linkedForms) {
          fieldStates[fieldId].linkedForms = [];
        }
        fieldStates[fieldId].linkedForms!.push({
          formId: action.targetFormId,
          formName: action.targetFormName || `Form ${action.targetFormId}`,
          autoOpen: true
        });
      }
      break;
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const safeJsonParse = <T>(json: string | null | undefined, defaultValue: T): T => {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json);
  } catch {
    return defaultValue;
  }
};

const getNestedValue = (obj: Record<string, any>, path: string): any => {
  if (!path || !obj) return undefined;
  if (obj[path] !== undefined) return obj[path];
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

const areValuesEqual = (a: any, b: any): boolean => {
  if (a === null || a === undefined) return b === null || b === undefined || b === '';
  if (b === null || b === undefined) return a === null || a === undefined || a === '';
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBoolean(a) === toBoolean(b);
  if (!isNaN(Number(a)) && !isNaN(Number(b))) return Number(a) === Number(b);
  return String(a).toLowerCase() === String(b).toLowerCase();
};

const toNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

const toString = (value: any): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const toBoolean = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === 'yes' || lower === '1';
  }
  return Boolean(value);
};

const isEmpty = (value: any): boolean => {
  if (value === null || value === undefined) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
};

const isInList = (value: any, list: any): boolean => {
  if (!list) return false;
  const listArray = Array.isArray(list) ? list : String(list).split(',').map(s => s.trim());
  const valueStr = String(value).toLowerCase();
  return listArray.some((item: any) => String(item).toLowerCase() === valueStr);
};

const calculateAge = (birthDate: any): number | null => {
  if (!birthDate) return null;
  try {
    const dob = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  } catch {
    return null;
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeSkipLogicTables,
  getSkipLogicRulesForCrf,
  createSkipLogicRule,
  updateSkipLogicRule,
  deleteSkipLogicRule,
  getFormLinksForCrf,
  getFormLinksForField,
  createFormLink,
  deleteFormLink,
  evaluateSkipLogic,
  evaluateConditions
};

