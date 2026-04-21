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
import { resolveQueryAssignee } from './workflow-config.provider';
import { parseExtendedProps } from '../../utils/extended-props';
import { updateFormQueryCounts } from './query.service';
import { getStudyParameters } from './studyParameters.service';

/**
 * Helper: get org member user IDs for the caller.
 * Returns [callerUserId] if the caller has no org membership (only see own data).
 */
const getOrgMemberUserIds = async (callerUserId: number): Promise<number[] | null> => {
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [callerUserId]
  );
  const callerOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
  if (callerOrgIds.length === 0) return [callerUserId];

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
  ruleType: 'range' | 'format' | 'required' | 'consistency' | 'business_logic' | 'cross_form' | 'formula' | 'value_match' | 'pattern_match';
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
  compareValue?: string;
  customExpression?: string;
  /** Blood pressure per-component validation limits (stored in bp_systolic_min/max, bp_diastolic_min/max) */
  bpSystolicMin?: number;
  bpSystolicMax?: number;
  bpDiastolicMin?: number;
  bpDiastolicMax?: number;
  dateCreated: Date;
  dateUpdated?: Date;
  createdBy: number;
  updatedBy?: number;

  /** Cell-level targeting for table/question_table fields (stored as JSONB) */
  tableCellTarget?: {
    tableFieldPath: string;
    /** Stable identifier for the target table item (item.item_id). When two
     *  tables share a name, this disambiguates them. Optional for backward
     *  compatibility with rules created before the field was added. */
    tableItemId?: number;
    columnId: string;
    columnType: string;
    rowIndex?: number;
    rowId?: string;
    allRows: boolean;
    displayPath: string;
  } | null;
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
  compareValue?: string;
  customExpression?: string;
  /** Blood pressure per-component range limits (stored in bp_systolic_min/max, bp_diastolic_min/max) */
  bpSystolicMin?: number;
  bpSystolicMax?: number;
  bpDiastolicMin?: number;
  bpDiastolicMax?: number;

  /** Cell-level targeting for table/question_table fields (stored as JSONB) */
  tableCellTarget?: {
    tableFieldPath: string;
    tableItemId?: number;
    columnId: string;
    columnType: string;
    rowIndex?: number;
    rowId?: string;
    allRows: boolean;
    displayPath: string;
  } | null;
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
let initializationInProgress: Promise<boolean> | null = null;

export const initializeValidationRulesTable = async (): Promise<boolean> => {
  if (tableInitialized) {
    return true;
  }

  // Prevent concurrent initialization attempts from multiple requests
  if (initializationInProgress) {
    return initializationInProgress;
  }

  initializationInProgress = (async () => {
    try {
      const checkResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables WHERE table_name = 'validation_rules'
        )
      `);
      if (!checkResult.rows[0].exists) {
        logger.warn('validation_rules table does not exist yet — run startup migrations');
        return false;
      }

      // Ensure columns added in later migrations are present.
      // Use a single query to check which columns are missing, then only ALTER for those.
      const existingCols = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'validation_rules'
      `);
      const existingSet = new Set(existingCols.rows.map((r: any) => r.column_name));

      const columnsToEnsure = [
        { name: 'format_type', type: 'VARCHAR(50)' },
        { name: 'operator', type: 'VARCHAR(20)' },
        { name: 'compare_field_path', type: 'VARCHAR(255)' },
        { name: 'custom_expression', type: 'TEXT' },
        { name: 'compare_value', type: 'TEXT' },
        { name: 'table_cell_target', type: 'JSONB' },
      ];

      const missing = columnsToEnsure.filter(c => !existingSet.has(c.name));
      for (const col of missing) {
        try {
          await pool.query(`ALTER TABLE validation_rules ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        } catch { /* column already exists */ }
      }

      tableInitialized = true;
      return true;
    } catch (error: any) {
      logger.error('Failed to check validation_rules table:', error.message);
      return false;
    } finally {
      initializationInProgress = null;
    }
  })();

  return initializationInProgress;
};

/**
 * Get all validation rules for a CRF
 */
// 10-second LRU cache for getRulesForCrf to avoid repeated identical DB work.
// Keyed by crfId. Invalidated by createRule/updateRule/deleteRule/toggleRule.
const _rulesCache = new Map<number, { rules: ValidationRule[]; expiresAt: number }>();
const RULES_CACHE_TTL_MS = 10_000;

function invalidateRulesCache(crfId?: number): void {
  if (crfId != null) { _rulesCache.delete(crfId); } else { _rulesCache.clear(); }
}

export const getRulesForCrf = async (crfId: number, callerUserId?: number): Promise<ValidationRule[]> => {
  logger.info('Getting validation rules for CRF', { crfId, callerUserId });

  // Check cache first (only when no org-scoping needed, or we'll cache per-user combos separately)
  const cacheKey = crfId;
  const cached = _rulesCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug('getRulesForCrf cache HIT', { crfId });
    return cached.rules;
  }

  await initializeValidationRulesTable();

  try {
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

    const customRulesQuery = `
      SELECT 
        vr.validation_rule_id as id, vr.crf_id, vr.crf_version_id, vr.item_id,
        vr.name, vr.description, vr.rule_type, vr.field_path, vr.severity,
        vr.error_message, vr.warning_message, vr.active,
        vr.min_value, vr.max_value, vr.pattern, vr.format_type, vr.operator,
        vr.compare_field_path, vr.compare_value, vr.custom_expression,
        vr.bp_systolic_min, vr.bp_systolic_max, vr.bp_diastolic_min, vr.bp_diastolic_max,
        vr.date_created, vr.date_updated, vr.owner_id as created_by, vr.update_id as updated_by,
        vr.table_cell_target
      FROM validation_rules vr
      WHERE vr.crf_id = $1
      ORDER BY vr.name
    `;

    const itemRulesQuery = `
      SELECT 
        ifm.item_id as id, cv.crf_id, ifm.crf_version_id, i.item_id, i.name, i.description,
        CASE 
          WHEN ifm.regexp IS NOT NULL AND ifm.regexp LIKE '=FORMULA:%' THEN 'formula'
          WHEN ifm.regexp IS NOT NULL THEN 'format'
          ELSE NULL
        END as rule_type,
        i.name as field_path, 'error' as severity,
        CASE WHEN ifm.regexp IS NOT NULL THEN COALESCE(ifm.regexp_error_msg, 'Invalid format') ELSE 'Validation failed' END as error_message,
        NULL as warning_message, true as active, NULL as min_value, NULL as max_value,
        CASE WHEN ifm.regexp LIKE '=FORMULA:%' THEN SUBSTRING(ifm.regexp FROM 10) ELSE ifm.regexp END as pattern,
        NULL as operator, NULL as compare_field_path, NULL as compare_value, NULL as custom_expression,
        cv.date_created, NULL as date_updated, cv.owner_id as created_by, NULL as updated_by
      FROM item_form_metadata ifm
      INNER JOIN crf_version cv ON ifm.crf_version_id = cv.crf_version_id
      INNER JOIN item i ON ifm.item_id = i.item_id
      WHERE cv.crf_id = $1 AND ifm.regexp IS NOT NULL
      ORDER BY i.name
    `;

    const nativeRulesQuery = `
      SELECT 
        r.id, r.name, r.description, r.oc_oid, r.enabled, r.study_id,
        re.value as expression, re.context as expression_context,
        rs.study_event_definition_id, rs.crf_id, rs.crf_version_id,
        rs.item_id, rs.item_group_id,
        ra.action_type, ra.message as action_message, ra.expression_evaluates_to
      FROM rule r
      INNER JOIN rule_expression re ON r.rule_expression_id = re.id
      INNER JOIN rule_set rs ON rs.study_id = r.study_id
      INNER JOIN rule_set_rule rsr ON rsr.rule_set_id = rs.id AND rsr.rule_id = r.id
      LEFT JOIN rule_action ra ON ra.rule_set_rule_id = rsr.id
      WHERE rs.crf_id = $1 AND r.enabled = true
      ORDER BY r.name
    `;

    // Run all 3 queries in parallel instead of sequentially
    const [customResult, itemResult, nativeResult] = await Promise.all([
      pool.query(customRulesQuery, [crfId]).catch((e: any) => {
        logger.debug('Custom validation_rules table not available:', e.message);
        return { rows: [] };
      }),
      pool.query(itemRulesQuery, [crfId]),
      pool.query(nativeRulesQuery, [crfId]).catch((e: any) => {
        logger.debug('LibreClinica native rules not available:', e.message);
        return { rows: [] };
      }),
    ]);

    const customRules = customResult.rows.map(mapDbRowToRule);
    const itemRules = itemResult.rows.filter((row: any) => row.rule_type !== null).map(mapDbRowToRule);
    const nativeRules: ValidationRule[] = nativeResult.rows.map((row: any) => ({
      id: row.id + 100000,
      crfId: row.crf_id,
      crfVersionId: row.crf_version_id,
      itemId: row.item_id,
      name: row.name || 'LibreClinica Rule',
      description: row.description || '',
      ruleType: mapActionTypeToRuleType(row.action_type) as ValidationRule['ruleType'],
      fieldPath: row.oc_oid || '',
      severity: row.action_type === 'DISCREPANCY_NRS' ? 'warning' : 'error' as ValidationRule['severity'],
      errorMessage: row.action_message || 'Validation failed',
      warningMessage: row.action_type === 'DISCREPANCY_NRS' ? row.action_message : undefined,
      active: row.enabled !== false,
      customExpression: row.expression,
      dateCreated: new Date(),
      createdBy: row.owner_id || 1,
      nativeRuleId: row.id,
      nativeOcOid: row.oc_oid,
      expressionContext: row.expression_context
    }));

    // Deduplicate with O(1) Set lookups instead of O(N) .some() scans
    const allRules = [...customRules];
    const seenFieldType = new Set(customRules.map(r => `${r.fieldPath}\0${r.ruleType}`));
    for (const itemRule of itemRules) {
      const key = `${itemRule.fieldPath}\0${itemRule.ruleType}`;
      if (!seenFieldType.has(key)) {
        allRules.push(itemRule);
        seenFieldType.add(key);
      }
    }
    const seenExpr = new Set(allRules.filter(r => r.customExpression).map(r => r.customExpression));
    for (const nativeRule of nativeRules) {
      if (!nativeRule.customExpression || !seenExpr.has(nativeRule.customExpression)) {
        allRules.push(nativeRule);
      }
    }

    // Store in cache
    _rulesCache.set(cacheKey, { rules: allRules, expiresAt: Date.now() + RULES_CACHE_TTL_MS });

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

    // Fetch rules for each CRF in parallel (bounded to 5 concurrent to avoid overwhelming the connection pool)
    const crfArray = [...crfMap.values()];
    const CONCURRENCY = 5;
    const results: { crfId: number; crfName: string; rules: ValidationRule[] }[] = [];
    for (let i = 0; i < crfArray.length; i += CONCURRENCY) {
      const batch = crfArray.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (crf) => ({
          crfId: crf.crfId,
          crfName: crf.crfName,
          rules: await getRulesForCrf(crf.crfId, callerUserId),
        }))
      );
      results.push(...batchResults);
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
 * Get ALL CRFs with their validation rule counts (no study filter).
 * Used by the validation rules config UI which now allows direct form selection.
 */
export const getAllCrfsWithRuleCounts = async (callerUserId?: number): Promise<{ crfId: number; crfName: string; rules: ValidationRule[] }[]> => {
  logger.info('Getting all CRFs with rule counts', { callerUserId });

  try {
    let orgCrfFilter = '';
    const queryParams: any[] = [];

    if (callerUserId) {
      const orgUserIds = await getOrgMemberUserIds(callerUserId);
      if (orgUserIds) {
        orgCrfFilter = ` AND c.crf_id IN (SELECT cv2.crf_id FROM crf_version cv2 WHERE cv2.owner_id = ANY($1::int[]))`;
        queryParams.push(orgUserIds);
      }
    }

    // PERFORMANCE FIX: Previously this fetched the CRF list then called
    // getRulesForCrf() for EACH CRF sequentially (3 queries per CRF =
    // 200+ queries for 68 CRFs). Now we do a single query that returns
    // CRFs + rule counts. The full rule objects are only fetched lazily
    // when the user actually selects a CRF.
    const allCrfsQuery = `
      SELECT c.crf_id, c.name,
             COALESCE(vr_count.cnt, 0) AS rule_count
      FROM crf c
      LEFT JOIN (
        SELECT crf_id, COUNT(*) AS cnt
        FROM validation_rules
        WHERE active = true
        GROUP BY crf_id
      ) vr_count ON vr_count.crf_id = c.crf_id
      WHERE (
        c.status_id = 1
        OR c.crf_id IN (SELECT DISTINCT vr.crf_id FROM validation_rules vr WHERE vr.active = true)
      )${orgCrfFilter}
      ORDER BY c.name
      LIMIT 200
    `;
    const crfsResult = await pool.query(allCrfsQuery, queryParams);
    logger.info('All CRFs for validation rules config', { count: crfsResult.rows.length });

    // Return lightweight objects with rule counts only (not full rule arrays).
    // The frontend dropdown only needs crfId + name + count.
    // Full rules are fetched on demand when the user selects a CRF.
    const results = crfsResult.rows.map((row: any) => ({
      crfId: row.crf_id,
      crfName: row.name,
      rules: new Array(parseInt(row.rule_count, 10) || 0),
    }));

    return results;
  } catch (error: any) {
    logger.error('Get all CRFs with rule counts error', { error: error.message });
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
        format_type,
        operator,
        compare_field_path,
        compare_value,
        custom_expression,
        bp_systolic_min,
        bp_systolic_max,
        bp_diastolic_min,
        bp_diastolic_max,
        date_created,
        date_updated,
        owner_id as created_by,
        update_id as updated_by,
        table_cell_target
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
  invalidateRulesCache(rule.crfId);
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
        compare_value, custom_expression,
        bp_systolic_min, bp_systolic_max, bp_diastolic_min, bp_diastolic_max,
        table_cell_target,
        date_created, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true,
                $11, $12, $13, $14, $15, $16,
                $17, $18,
                $19, $20, $21, $22,
                $23,
                CURRENT_TIMESTAMP, $24)
      RETURNING validation_rule_id
    `;

    // Support both fieldPath and fieldName for API compatibility
    const fieldPath = rule.fieldPath || (rule as any).fieldName || '';

    // Auto-pin to the latest crf_version_id when caller didn't specify one.
    // This implements the "rules are version-locked" semantic: a rule created
    // today applies to the current template version (and patients pinned to it),
    // not retroactively to older patients who saw earlier versions of the form.
    let resolvedCrfVersionId = rule.crfVersionId || null;
    if (!resolvedCrfVersionId && rule.crfId) {
      try {
        const verRes = await client.query(
          `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
          [rule.crfId]
        );
        if (verRes.rows.length > 0) {
          resolvedCrfVersionId = verRes.rows[0].crf_version_id;
        }
      } catch (e: any) {
        logger.warn('Could not resolve crf_version_id for rule create', { crfId: rule.crfId, error: e.message });
      }
    }

    const result = await client.query(insertQuery, [
      rule.crfId,
      resolvedCrfVersionId,
      rule.itemId || null,
      rule.name,
      rule.description || '',
      rule.ruleType,
      fieldPath,
      rule.severity || 'error',
      rule.errorMessage,
      rule.warningMessage || null,
      rule.minValue ?? null,
      rule.maxValue ?? null,
      rule.pattern || null,
      rule.formatType || null,
      rule.operator || null,
      rule.compareFieldPath || null,
      rule.compareValue || null,
      rule.customExpression || null,
      rule.bpSystolicMin ?? null,
      rule.bpSystolicMax ?? null,
      rule.bpDiastolicMin ?? null,
      rule.bpDiastolicMax ?? null,
      rule.tableCellTarget ? JSON.stringify(rule.tableCellTarget) : null,
      userId
    ]);

    // Also update item_form_metadata if this is a format or required rule
    // Scope to the specific crf_version to avoid affecting other CRFs that share the same item
    if (rule.itemId && (rule.ruleType === 'format' || rule.ruleType === 'required')) {
      let crfVersionId = rule.crfVersionId;
      if (!crfVersionId && rule.crfId) {
        const versionResult = await client.query(
          `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
          [rule.crfId]
        );
        if (versionResult.rows.length > 0) {
          crfVersionId = versionResult.rows[0].crf_version_id;
        }
      }

      if (crfVersionId) {
        if (rule.ruleType === 'format' && rule.pattern) {
          await client.query(`
            UPDATE item_form_metadata 
            SET regexp = $1, regexp_error_msg = $2 
            WHERE item_id = $3 AND crf_version_id = $4
          `, [rule.pattern, rule.errorMessage, rule.itemId, crfVersionId]);
        } else if (rule.ruleType === 'required') {
          await client.query(`
            UPDATE item_form_metadata SET required = true WHERE item_id = $1 AND crf_version_id = $2
          `, [rule.itemId, crfVersionId]);
        }
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
  invalidateRulesCache();
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
        warning_message = $7,
        min_value = $8,
        max_value = $9,
        pattern = $10,
        format_type = $11,
        operator = $12,
        compare_field_path = $13,
        compare_value = $14,
        custom_expression = $15,
        bp_systolic_min = $16,
        bp_systolic_max = $17,
        bp_diastolic_min = $18,
        bp_diastolic_max = $19,
        table_cell_target = $20,
        date_updated = CURRENT_TIMESTAMP,
        update_id = $21
      WHERE validation_rule_id = $22
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
      updates.compareValue ?? null,
      updates.customExpression ?? null,
      updates.bpSystolicMin ?? null,
      updates.bpSystolicMax ?? null,
      updates.bpDiastolicMin ?? null,
      updates.bpDiastolicMax ?? null,
      updates.tableCellTarget ? JSON.stringify(updates.tableCellTarget) : null,
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
  active: boolean | undefined,
  userId: number
): Promise<{ success: boolean }> => {
  invalidateRulesCache();
  try {
    if (active === undefined || active === null) {
      // No explicit state provided — flip the current value
      await pool.query(`
        UPDATE validation_rules 
        SET active = NOT active, date_updated = CURRENT_TIMESTAMP, update_id = $1
        WHERE validation_rule_id = $2
      `, [userId, ruleId]);
    } else {
      await pool.query(`
        UPDATE validation_rules 
        SET active = $1, date_updated = CURRENT_TIMESTAMP, update_id = $2
        WHERE validation_rule_id = $3
      `, [active, userId, ruleId]);
    }

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
  invalidateRulesCache();
  logger.info('Deleting validation rule', { ruleId, userId });

  try {
    const result = await pool.query(`DELETE FROM validation_rules WHERE validation_rule_id = $1`, [ruleId]);
    if (result.rowCount === 0) {
      return { success: false, message: 'Rule not found' };
    }
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
    /** When set, only rules matching this severity are evaluated.
     *  Use 'warning' in post-save mode to avoid duplicate error queries. */
    severityFilter?: 'error' | 'warning';
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

  // Get rules for this CRF (works for both templates and copies). When the
  // caller passes crfVersionId (i.e. they're validating a patient-pinned
  // event_crf), filter to rules version-locked to that version OR with no
  // version pin (legacy/all-versions). This implements the "rules become
  // the patient's at enrollment" semantic: edits to rules on a NEW version
  // of the template don't retroactively fire on patients pinned to an
  // older version.
  const allRules = await getRulesForCrf(crfId);
  const rules = options?.crfVersionId != null
    ? allRules.filter(r => r.crfVersionId == null || r.crfVersionId === options.crfVersionId)
    : allRules;
  const errors: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number }[] = [];
  const warnings: { fieldPath: string; message: string; queryId?: number }[] = [];
  let queriesCreated = 0;

  // Parallelize the two independent setup queries
  const [itemDataMapResult, itemIdToFormKey] = await Promise.all([
    (async () => {
      if (options?.itemDataMap && Object.keys(options.itemDataMap).length > 0) return options.itemDataMap;
      if (!options?.eventCrfId) return {};
      try { return await buildItemDataMap(options.eventCrfId); }
      catch (e: any) { logger.warn('Could not build itemDataMap:', e.message); return {}; }
    })(),
    buildItemIdToFormKeyMap(crfId, formData),
  ]);
  const itemDataMap = itemDataMapResult;

  for (const rule of rules) {
    if (!rule.active) continue;

    // Skip rules that don't match the severity filter (e.g. post-save only wants warnings)
    if (options?.severityFilter && rule.severity !== options.severityFilter) continue;

    // Cell-targeted rules are handled below in the dedicated cell-validation pass.
    // Skipping them here prevents both duplicate evaluation (and thus duplicate
    // queries) and incorrect application of cell rules to the whole table value.
    if (rule.tableCellTarget) continue;

    // Match field value using itemId first (stable), then fall back to name matching
    const value = getFieldValue(formData, rule, itemDataMap, itemIdToFormKey);
    
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
                  error.queryId = queryId.queryId;
                  if (queryId.isNew) queriesCreated++;
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
              error.queryId = queryId.queryId;
              if (queryId.isNew) queriesCreated++;
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
              warning.queryId = queryId.queryId;
              if (queryId.isNew) queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create warning validation query:', e.message);
          }
        }

        warnings.push(warning);
      }
    }
  }

  // ===== CELL-LEVEL VALIDATION for table/question_table fields =====
  // Rules with tableCellTarget are not applied to the whole JSON value above
  // (they are skipped by the isJsonValue guard). Instead, we extract individual
  // cell values from the table data and validate each cell against the rule.
  const cellRules = rules.filter(r => r.active && r.tableCellTarget &&
    (!options?.severityFilter || r.severity === options.severityFilter));

  // Build per-table column metadata so cell value lookups can resolve the
  // canonical data key for columns whose `id` differs from their `key`.
  // (e.g., a column with id="col_1", name="must_enter", key="m" stores
  // values under "m" but a rule may reference "col_1".)
  const tableColumnMeta = cellRules.length > 0
    ? await buildTableColumnMetadataMap(crfId)
    : new Map<number, TableItemMeta>();

  for (const rule of cellRules) {
    if (!rule.tableCellTarget) continue;
    const targetTableFieldPath = rule.tableCellTarget.tableFieldPath;

    // Resolve the actual form_data key for this rule's table. Two tables in the
    // same CRF can share a name (e.g., both named "data_table") and the
    // frontend deduplicates them by appending "_<itemId>". Look up by itemId
    // first (authoritative), then fall back to the rule's stored bare name.
    // Prefer tableCellTarget.tableItemId (precise — added in a recent fix) over
    // rule.itemId (the field-level id — same as table id when the rule targets
    // a cell in the same table).
    const ruleTableItemId =
      rule.tableCellTarget.tableItemId != null ? rule.tableCellTarget.tableItemId
      : rule.itemId;
    let actualTableKey: string = targetTableFieldPath;
    if (ruleTableItemId != null && itemIdToFormKey.has(ruleTableItemId)) {
      actualTableKey = itemIdToFormKey.get(ruleTableItemId)!;
    } else if (formData[targetTableFieldPath] === undefined) {
      // Stored path doesn't exist as-is; the deduped key may be present.
      // Search for any key whose un-deduped prefix matches.
      for (const k of Object.keys(formData)) {
        if (k === targetTableFieldPath) { actualTableKey = k; break; }
        if (k.startsWith(`${targetTableFieldPath}_`)) { actualTableKey = k; break; }
      }
    }

    // Find the table value in formData using the same multi-strategy matching
    let tableValue = getFieldValue(formData, { ...rule, fieldPath: actualTableKey } as ValidationRule, itemDataMap, itemIdToFormKey);
    if (tableValue === undefined) continue;

    // Parse JSON if stored as string
    if (typeof tableValue === 'string') {
      try { tableValue = JSON.parse(tableValue); } catch { continue; }
    }

    const isDataTable = Array.isArray(tableValue);
    const target = rule.tableCellTarget;

    // Resolve the canonical column data key and identifier candidates for
    // this rule's column. Without this, validation silently skips cells
    // whose runtime data key differs from the rule's stored columnId.
    const tableMeta = ruleTableItemId != null ? tableColumnMeta.get(ruleTableItemId) : undefined;
    const colMeta = tableMeta?.columnsByAnyId.get(target.columnId);
    // Ordered list of property names to try when reading the cell value.
    const lookupKeys: string[] = [];
    if (colMeta) {
      for (const c of colMeta.candidates) if (!lookupKeys.includes(c)) lookupKeys.push(c);
    }
    if (!lookupKeys.includes(target.columnId)) lookupKeys.push(target.columnId);
    // The path-friendly column key — what the frontend's cell-error lookup
    // and dn_item_data_map.column_name will compare against.
    const pathColKey = colMeta?.dataKey || target.columnId;

    const readCell = (rowOrObj: any): any => {
      if (rowOrObj == null || typeof rowOrObj !== 'object') return undefined;
      for (const k of lookupKeys) {
        const v = rowOrObj[k];
        if (v !== undefined) return v;
      }
      return undefined;
    };

    // Extract individual cell values based on target configuration. Generated
    // cellPaths use the ACTUAL form_data key (deduped table) and the canonical
    // column data key, so they line up with the cell queries' column_name
    // and the frontend's cell-error lookup keys.
    const cellHits: { cellPath: string; rowIdentifier: number | string; value: any }[] = [];

    if (isDataTable) {
      const rows = tableValue as any[];
      if (target.allRows) {
        rows.forEach((row: any, idx: number) => {
          cellHits.push({
            cellPath: `${actualTableKey}[${idx}].${pathColKey}`,
            rowIdentifier: idx,
            value: readCell(row),
          });
        });
      } else if (target.rowIndex !== undefined && target.rowIndex >= 0) {
        const row = rows[target.rowIndex];
        if (row !== undefined) {
          cellHits.push({
            cellPath: `${actualTableKey}[${target.rowIndex}].${pathColKey}`,
            rowIdentifier: target.rowIndex,
            value: readCell(row),
          });
        }
      }
    } else if (tableValue && typeof tableValue === 'object') {
      // Question table: object keyed by rowId
      if (target.allRows) {
        for (const rowId of Object.keys(tableValue)) {
          cellHits.push({
            cellPath: `${actualTableKey}.${rowId}.${pathColKey}`,
            rowIdentifier: rowId,
            value: readCell(tableValue[rowId]),
          });
        }
      } else if (target.rowId && target.rowId !== '*') {
        cellHits.push({
          cellPath: `${actualTableKey}.${target.rowId}.${pathColKey}`,
          rowIdentifier: target.rowId,
          value: readCell(tableValue[target.rowId]),
        });
      }
    }

    for (const hit of cellHits) {
      // For consistency rules with same-row references, resolve the compare value
      let cellResult: { valid: boolean; message?: string };
      if (rule.ruleType === 'consistency' && rule.compareFieldPath && rule.compareFieldPath.startsWith('SAME_ROW:')) {
        const sameRowColKey = rule.compareFieldPath.substring(9);
        // Resolve compare-column candidates the same way as the target column —
        // a SAME_ROW reference may be authored against the column's id, name,
        // or key, but the row stores its value under one canonical data key.
        const cmpColMeta = tableMeta?.columnsByAnyId.get(sameRowColKey);
        const cmpLookupKeys: string[] = [];
        if (cmpColMeta) {
          for (const c of cmpColMeta.candidates) if (!cmpLookupKeys.includes(c)) cmpLookupKeys.push(c);
        }
        if (!cmpLookupKeys.includes(sameRowColKey)) cmpLookupKeys.push(sameRowColKey);
        const readCmp = (rowOrObj: any): any => {
          if (rowOrObj == null || typeof rowOrObj !== 'object') return undefined;
          for (const k of cmpLookupKeys) {
            const v = rowOrObj[k];
            if (v !== undefined) return v;
          }
          return undefined;
        };
        let compareVal: any;
        if (isDataTable) {
          compareVal = readCmp((tableValue as any[])[hit.rowIdentifier as number]);
        } else {
          compareVal = readCmp(tableValue[hit.rowIdentifier as string]);
        }
        const isValid = compareValues(hit.value, compareVal, rule.operator || '==');
        cellResult = { valid: isValid };
      } else {
        cellResult = applyRule(rule, hit.value, formData);
      }

      if (!cellResult.valid) {
        // Resolve item_data_id for the TABLE field (cells share the same row in
        // item_data; cell uniqueness comes from column_name = cellPath).
        let itemDataId = getItemDataId(actualTableKey, itemDataMap);
        if (!itemDataId) itemDataId = getItemDataId(targetTableFieldPath, itemDataMap);
        if (!itemDataId && rule.itemId) {
          itemDataId = itemDataMap[`item_${rule.itemId}`];
        }

        if (rule.severity === 'error') {
          const error: { fieldPath: string; message: string; severity: string; queryId?: number; itemDataId?: number } = {
            fieldPath: hit.cellPath,
            message: cellResult.message || rule.errorMessage,
            severity: 'error',
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
                fieldPath: hit.cellPath,
                ruleName: rule.name,
                errorMessage: cellResult.message || rule.errorMessage,
                value: hit.value,
                userId: options.userId,
                severity: 'error'
              });
              if (queryId) {
                error.queryId = queryId.queryId;
                if (queryId.isNew) queriesCreated++;
              }
            } catch (e: any) {
              logger.error('Failed to create cell validation query:', e.message);
            }
          }
          errors.push(error);
        } else {
          const warning: { fieldPath: string; message: string; queryId?: number } = {
            fieldPath: hit.cellPath,
            message: cellResult.message || rule.warningMessage || rule.errorMessage
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
                fieldPath: hit.cellPath,
                ruleName: rule.name,
                errorMessage: cellResult.message || rule.warningMessage || rule.errorMessage,
                value: hit.value,
                userId: options.userId,
                severity: 'warning'
              });
              if (queryId) {
                warning.queryId = queryId.queryId;
                if (queryId.isNew) queriesCreated++;
              }
            } catch (e: any) {
              logger.error('Failed to create cell warning query:', e.message);
            }
          }
          warnings.push(warning);
        }
      }
    }
  }

  // ISSUE-410 fix: dedup errors/warnings on (fieldPath, message). Two
  // independent rules with identical authored messages targeting the same
  // cell would otherwise display as two identical warning chips to the user.
  return {
    valid: errors.length === 0,
    errors: dedupValidationItems(errors) as typeof errors,
    warnings: dedupValidationItems(warnings) as typeof warnings,
    queriesCreated
  };
};

// Helper: deduplicate validation result items by (fieldPath, message). Keeps
// the first occurrence (which carries the queryId if any).
function dedupValidationItems<T extends { fieldPath: string; message: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = `${it.fieldPath}\u0001${it.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

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

  // Always-stable: item_id-based key. Field-name keys may collide when two
  // items share a name; the first iteration wins for those — but the
  // item_<id> form is always unique and is what callers should prefer.
  const claimedByName = new Set<string>();
  for (const row of result.rows) {
    const lowerName = row.field_name?.toLowerCase();
    // Only set the bare-name keys for the FIRST item that has that name —
    // subsequent items would overwrite and collapse different cells onto
    // the same item_data_id.
    if (lowerName && !claimedByName.has(lowerName)) {
      map[row.field_name] = row.item_data_id;
      map[lowerName] = row.item_data_id;
      claimedByName.add(lowerName);
    }
    if (row.field_oid && !claimedByName.has(row.field_oid)) {
      map[row.field_oid] = row.item_data_id;
      claimedByName.add(row.field_oid);
    }
    // item_<id> is always unique per row
    map[`item_${row.item_id}`] = row.item_data_id;
  }

  return map;
}

/**
 * Per-table-item column metadata used by cell-level validation to resolve
 * which property key a cell value is actually stored under in form data.
 *
 * A column can have any combination of `id`, `name`, and `key` set, and
 * they may differ. The frontend's form-table-manager stores cell values
 * under `key || name || id` (the canonical "data key"), but a validation
 * rule may have been authored against the column's `id`. Without this
 * mapping, the backend would look up `row[columnId]` and find `undefined`,
 * silently skipping validation for cells whose `id` differs from their
 * runtime data key.
 */
interface TableColumnMeta {
  /** The canonical key used in form_data row objects (key || name || id). */
  dataKey: string;
  /** All identifiers a rule might reference this column by. */
  candidates: string[];
}

interface TableItemMeta {
  /** Map of any column identifier (id / name / key) → resolved column meta. */
  columnsByAnyId: Map<string, TableColumnMeta>;
  /** True for question_table items (different cell-data shape). */
  isQuestionTable: boolean;
}

/**
 * Build per-item table-column metadata for every table/question_table item
 * in this CRF version. Used by the cell-validation pass so cell value
 * lookups tolerate id-vs-key column-naming differences.
 */
async function buildTableColumnMetadataMap(crfId: number): Promise<Map<number, TableItemMeta>> {
  const map = new Map<number, TableItemMeta>();
  try {
    const latestVersion = await pool.query(
      `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
      [crfId]
    );
    if (latestVersion.rows.length === 0) return map;
    const versionId = latestVersion.rows[0].crf_version_id;

    const result = await pool.query(`
      SELECT i.item_id, i.description
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      WHERE igm.crf_version_id = $1
        AND i.description IS NOT NULL
    `, [versionId]);

    for (const row of result.rows) {
      const ext = parseExtendedProps(row.description);
      const isDataTable = Array.isArray(ext.tableColumns) && ext.tableColumns.length > 0;
      const isQuestionTable = Array.isArray(ext.questionRows) && ext.questionRows.length > 0;
      if (!isDataTable && !isQuestionTable) continue;

      const columnsByAnyId = new Map<string, TableColumnMeta>();

      if (isDataTable) {
        ext.tableColumns.forEach((col: any, idx: number) => {
          // Same resolution as FormTableManager.getColumns():
          //   key || name || id || `col_${idx}`
          const dataKey = col.key || col.name || col.id || `col_${idx}`;
          const candidates: string[] = [];
          for (const v of [col.key, col.id, col.name, dataKey]) {
            if (v && !candidates.includes(String(v))) candidates.push(String(v));
          }
          const meta: TableColumnMeta = { dataKey, candidates };
          for (const id of candidates) columnsByAnyId.set(id, meta);
        });
      } else {
        // question_table: take answerColumns from the first question row
        const firstRow = ext.questionRows[0] || {};
        const ansCols = Array.isArray(firstRow.answerColumns) ? firstRow.answerColumns : [];
        ansCols.forEach((col: any, idx: number) => {
          const dataKey = col.id || col.name || col.key || `ans_${idx}`;
          const candidates: string[] = [];
          for (const v of [col.id, col.name, col.key, dataKey]) {
            if (v && !candidates.includes(String(v))) candidates.push(String(v));
          }
          const meta: TableColumnMeta = { dataKey, candidates };
          for (const id of candidates) columnsByAnyId.set(id, meta);
        });
      }

      map.set(row.item_id, { columnsByAnyId, isQuestionTable });
    }
  } catch (e: any) {
    logger.warn('Could not build table column metadata map', { crfId, error: e.message });
  }
  return map;
}

/**
 * Build a reverse map: itemId → formData key.
 *
 * For each item in the CRF, determine which key in `formData` corresponds
 * to it. Uses the exact same matching logic as the save flow in
 * form.service.ts (technical fieldName from extended_props, item.name,
 * item.oc_oid) so validation and save are always in agreement.
 */
async function buildItemIdToFormKeyMap(
  crfId: number,
  formData: Record<string, any>
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const latestVersion = await pool.query(
      `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
      [crfId]
    );
    if (latestVersion.rows.length === 0) return map;
    const versionId = latestVersion.rows[0].crf_version_id;

    // Order by item_form_metadata.ordinal so we iterate items in the same order
    // the frontend renders them. This matters for same-named fields: the FIRST
    // occurrence claims the bare form key, subsequent ones get "_<itemId>" dedup.
    const result = await pool.query(`
      SELECT i.item_id, i.name, i.oc_oid, i.description
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      LEFT JOIN item_form_metadata ifm ON ifm.item_id = i.item_id AND ifm.crf_version_id = $1
      WHERE igm.crf_version_id = $1
      ORDER BY COALESCE(ifm.ordinal, 0), i.item_id
    `, [versionId]);

    const formKeys = Object.keys(formData);
    const lowerFormKeys = new Map<string, string>();
    for (const k of formKeys) lowerFormKeys.set(k.toLowerCase(), k);

    // Track which form keys have been claimed so two items sharing a name
    // don't both end up pointing to the first key. The frontend's buildForm()
    // dedupes same-named items by appending "_<itemId>" to subsequent ones.
    const claimedFormKeys = new Set<string>();

    /**
     * Try each candidate name, preferring (a) the bare form key if not yet
     * claimed, then (b) the deduplicated form key "<name>_<itemId>". If
     * multiple items share a name, the first-iterated item claims the bare
     * key and subsequent items get the dedup-suffixed variant.
     */
    const claim = (itemId: number, candidateName: string): boolean => {
      const lower = candidateName.toLowerCase();
      const bare = lowerFormKeys.get(lower);
      if (bare && !claimedFormKeys.has(bare)) {
        claimedFormKeys.add(bare);
        map.set(itemId, bare);
        return true;
      }
      // Try dedup variant "<name>_<itemId>" (matches frontend buildForm dedup)
      const dedup = lowerFormKeys.get(`${lower}_${itemId}`);
      if (dedup && !claimedFormKeys.has(dedup)) {
        claimedFormKeys.add(dedup);
        map.set(itemId, dedup);
        return true;
      }
      return false;
    };

    for (const row of result.rows) {
      const itemId: number = row.item_id;

      // Priority 1: technical fieldName from extended_properties (what the frontend sends)
      const extProps = parseExtendedProps(row.description);
      if (extProps.fieldName && claim(itemId, extProps.fieldName)) continue;

      // Priority 2: OID (e.g., "I_GENER_ASSES")
      if (row.oc_oid && claim(itemId, row.oc_oid)) continue;

      // Priority 3: Display label (item.name, e.g., "Assessment Date")
      if (row.name) {
        if (claim(itemId, row.name)) continue;
        // Also try spaces→underscores (e.g., "Assessment Date" → "assessment_date")
        const normalized = row.name.replace(/[\s\-]+/g, '_');
        if (claim(itemId, normalized)) continue;
      }
    }
  } catch (e: any) {
    logger.warn('Could not build itemIdToFormKeyMap', { crfId, error: e.message });
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
  itemDataMap: Record<string, number>,
  itemIdToFormKey?: Map<number, string>
): any {
  // 0. Match by itemId via reverse map (most reliable — uses the same DB-to-key
  // mapping as the save flow, so the key is guaranteed to match the form data)
  if (rule.itemId && itemIdToFormKey) {
    const mappedKey = itemIdToFormKey.get(rule.itemId);
    if (mappedKey && formData[mappedKey] !== undefined) {
      return formData[mappedKey];
    }
  }

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

  // 5. Normalize spaces/hyphens to underscores (e.g., "Assessment Date" -> "assessment_date")
  if (fieldName) {
    const normalized = fieldName.replace(/[\s\-]+/g, '_').toLowerCase();
    for (const key of Object.keys(formData)) {
      if (key.toLowerCase() === normalized) {
        return formData[key];
      }
    }
  }
  
  // 6. Match by item_id if available in the rule
  if (rule.itemId && itemDataMap[`item_${rule.itemId}`]) {
    // Find the field by looking up in itemDataMap
    for (const key of Object.keys(formData)) {
      if (itemDataMap[key] === itemDataMap[`item_${rule.itemId}`]) {
        return formData[key];
      }
    }
  }
  
  // 7. Deep search in nested objects
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
    // Spaces/hyphens to underscores (e.g., "Assessment Date" -> "assessment_date")
    const normalized = fieldName.replace(/[\s\-]+/g, '_').toLowerCase();
    if (itemDataMap[normalized]) return itemDataMap[normalized];
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

  const allRules = await getRulesForCrf(crfId);
  const errors: { fieldPath: string; message: string; severity: string; queryId?: number }[] = [];
  const warnings: { fieldPath: string; message: string; queryId?: number }[] = [];
  let queriesCreated = 0;

  // Build itemDataMap if we have eventCrfId for better field matching
  let itemDataMap: Record<string, number> = {};
  let pinnedVersionId: number | null = null;
  if (options?.eventCrfId) {
    try {
      itemDataMap = await buildItemDataMap(options.eventCrfId);
    } catch (e: any) {
      logger.warn('Could not build itemDataMap:', e.message);
    }
    // Resolve the patient's pinned crf_version_id so we filter rules to the
    // version that was active at enrollment (see ISSUE-501).
    try {
      const ecv = await pool.query(
        `SELECT crf_version_id FROM event_crf WHERE event_crf_id = $1`,
        [options.eventCrfId]
      );
      if (ecv.rows.length > 0 && ecv.rows[0].crf_version_id) {
        pinnedVersionId = ecv.rows[0].crf_version_id;
      }
    } catch (e: any) {
      logger.warn('Could not resolve pinned crf_version_id for event_crf', { eventCrfId: options.eventCrfId, error: e.message });
    }
  }

  // Apply version-pin filter when we know the patient's version.
  const rules = pinnedVersionId != null
    ? allRules.filter(r => r.crfVersionId == null || r.crfVersionId === pinnedVersionId)
    : allRules;

  // Lazy load table column metadata only when at least one cell rule exists.
  let tableColumnMetaForField: Map<number, TableItemMeta> | null = null;
  const ensureTableColumnMeta = async (): Promise<Map<number, TableItemMeta>> => {
    if (tableColumnMetaForField === null) {
      tableColumnMetaForField = await buildTableColumnMetadataMap(crfId);
    }
    return tableColumnMetaForField;
  };

  // Pre-compute column metadata if there is any chance of a cell-targeted rule
  // matching this fieldPath (only when path looks like a cell path).
  const isIncomingCellPath = fieldPath.includes('[') ||
    (fieldPath.split('.').length === 3 && !fieldPath.includes('['));
  if (isIncomingCellPath && rules.some(r => r.tableCellTarget)) {
    await ensureTableColumnMeta();
  }
  const colMetaMap = tableColumnMetaForField || new Map<number, TableItemMeta>();

  // Find rules that apply to this specific field using comprehensive matching
  const fieldRules = rules.filter(rule => {
    if (!rule.active) return false;

    // Cell-targeted rules: only match when the incoming fieldPath is a cell path
    // (e.g. "vitals_table[2].heart_rate" or "symptoms_qt.headache.severity")
    // matching this rule's tableCellTarget. Non-cell field changes never trigger
    // cell rules — those are evaluated en-masse by validateFormData on save.
    //
    // Table-key matching: the incoming cell path uses the actual deduplicated
    // form-control key (e.g. "data_table_2502"), but the rule may have stored
    // the un-deduped name (e.g. "data_table"). Match by EITHER the literal
    // tableFieldPath OR the rule's itemId (preferred — unambiguous).
    //
    // Column-key matching: a column may have differing id/name/key — rules
    // may be authored against any one of them. Use the column metadata map
    // (built from item.description.tableColumns / questionRows) to resolve
    // the candidate identifiers and accept any of them as a column match.
    if (rule.tableCellTarget) {
      const target = rule.tableCellTarget;
      // Prefer tableCellTarget.tableItemId (precise) → rule.itemId
      const ruleTableItemId =
        target.tableItemId != null ? target.tableItemId : rule.itemId;
      const itemMatchesTable = ruleTableItemId != null && options?.itemId != null && ruleTableItemId === options.itemId;
      const tableKeyMatches = (incomingTableKey: string) =>
        incomingTableKey === target.tableFieldPath ||
        (ruleTableItemId != null && incomingTableKey === `${target.tableFieldPath}_${ruleTableItemId}`) ||
        itemMatchesTable;

      // Resolve column-id aliases. Includes the rule's stored columnId plus
      // every other identifier that points at the same column metadata.
      const tableMeta = ruleTableItemId != null ? colMetaMap.get(ruleTableItemId) : undefined;
      const colMeta = tableMeta?.columnsByAnyId.get(target.columnId);
      const colAliases = new Set<string>([target.columnId]);
      if (colMeta) for (const c of colMeta.candidates) colAliases.add(c);
      const columnMatches = (incomingColKey: string) => colAliases.has(incomingColKey);

      const dtMatch = fieldPath.match(/^(.+)\[(\d+|\*)\]\.(.+)$/);
      if (dtMatch) {
        if (!tableKeyMatches(dtMatch[1])) return false;
        if (!columnMatches(dtMatch[3])) return false;
        if (!target.allRows && target.rowIndex !== undefined && target.rowIndex >= 0) {
          if (String(dtMatch[2]) !== String(target.rowIndex) && dtMatch[2] !== '*') return false;
        }
        return true;
      }

      const qtMatch = fieldPath.match(/^([^.[]+)\.([^.]+)\.([^.]+)$/);
      if (qtMatch) {
        if (!tableKeyMatches(qtMatch[1])) return false;
        if (!columnMatches(qtMatch[3])) return false;
        if (!target.allRows && target.rowId && target.rowId !== '*') {
          if (qtMatch[2] !== target.rowId && qtMatch[2] !== '*') return false;
        }
        return true;
      }

      return false;
    }

    // Non-cell rules never match incoming data-table cell paths (which always
    // contain `[idx]` brackets). The 3-dotted question-table form is left to
    // matchesField since regular field paths can also have 3 dot-segments.
    if (fieldPath.includes('[')) return false;

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

      // ISSUE-402: when a cell-targeted rule fires for an incoming cell-path
      // (e.g. "dt_test_table[0].col_text"), use the cell-path as the response
      // fieldPath -- not the rule's bare table name. Otherwise the patient
      // form's cellErrors[cellPath] map can't locate the warning.
      const isIncomingCellPathHere = fieldPath.includes('[') ||
        (fieldPath.split('.').length === 3 && !fieldPath.includes('['));
      const responseFieldPath = (rule.tableCellTarget && isIncomingCellPathHere)
        ? fieldPath
        : rule.fieldPath;

      if (rule.severity === 'error') {
        const error: { fieldPath: string; message: string; severity: string; queryId?: number } = {
          fieldPath: responseFieldPath,
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
              fieldPath: responseFieldPath,
              ruleName: rule.name,
              errorMessage: rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'error'
            });
            if (queryId) {
              error.queryId = queryId.queryId;
              if (queryId.isNew) queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create validation query:', e.message);
          }
        }

        errors.push(error);
      } else {
        // Warning (soft edit) - create query for workflow tracking
        const warning: { fieldPath: string; message: string; queryId?: number } = {
          fieldPath: responseFieldPath,
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
              fieldPath: responseFieldPath,
              ruleName: rule.name,
              errorMessage: rule.warningMessage || rule.errorMessage,
              value: value,
              userId: options.userId,
              severity: 'warning'
            });
            if (queryId) {
              warning.queryId = queryId.queryId;
              if (queryId.isNew) queriesCreated++;
            }
          } catch (e: any) {
            logger.error('Failed to create warning validation query:', e.message);
          }
        }

        warnings.push(warning);
      }
    }
  }

  // ISSUE-410 fix: dedup output items
  const dedupedErrors = dedupValidationItems(errors) as typeof errors;
  const dedupedWarnings = dedupValidationItems(warnings) as typeof warnings;
  return {
    valid: dedupedErrors.length === 0,
    errors: dedupedErrors,
    warnings: dedupedWarnings,
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
}): Promise<{ queryId: number; isNew: boolean } | null> {
  const client = await pool.connect();

  // Build the description string we'll write on insert; we use the SAME
  // string for the dedup check below so identical-rule re-validations don't
  // create duplicate queries, but DIFFERENT rules on the same field do.
  const isWarning = params.severity === 'warning';
  const expectedDescription = isWarning
    ? `Validation Warning: ${params.ruleName}`
    : `Validation Error: ${params.ruleName}`;

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

    // Check for existing open query for THIS rule (matched by description)
    // on this field to prevent duplicates. Tightening this beyond the
    // pre-fix "any open query on this item_data_id" prevents the bug where
    // rule A's call returned rule B's queryId just because rule B happened
    // to have an open query on the same field. (See ISSUE-401.)
    const isCellPath = params.fieldPath && (params.fieldPath.includes('[') || params.fieldPath.split('.').length === 3);
    if (itemDataId) {
      let existingQuery;
      if (isCellPath) {
        existingQuery = await client.query(`
          SELECT dn.discrepancy_note_id
          FROM discrepancy_note dn
          INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
          INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
          WHERE dim.item_data_id = $1
            AND dim.column_name = $2
            AND dn.description = $3
            AND dn.discrepancy_note_type_id IN (1, 2)
            AND rs.name NOT IN ('Closed', 'Not Applicable')
            AND dn.parent_dn_id IS NULL
          LIMIT 1
        `, [itemDataId, params.fieldPath, expectedDescription]);
      } else {
        existingQuery = await client.query(`
          SELECT dn.discrepancy_note_id
          FROM discrepancy_note dn
          INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
          INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
          WHERE dim.item_data_id = $1
            AND dn.description = $2
            AND dn.discrepancy_note_type_id IN (1, 2)
            AND rs.name NOT IN ('Closed', 'Not Applicable')
            AND dn.parent_dn_id IS NULL
          LIMIT 1
        `, [itemDataId, expectedDescription]);
      }

      if (existingQuery.rows.length > 0) {
        const existingId = existingQuery.rows[0].discrepancy_note_id;
        logger.info('Existing open validation query for THIS rule found, skipping duplicate creation', {
          existingQueryId: existingId,
          fieldPath: params.fieldPath,
          description: expectedDescription,
        });
        await client.query('COMMIT');
        return { queryId: existingId, isNew: false };
      }
    }

    // Broader dedup: check by event_crf + rule name + field path.
    // For cell queries, the field path includes the row/column (e.g., "vitals[2].hr"),
    // so each cell gets its own query even when the same rule fires on multiple cells.
    // Match column_name on the event_crf mapping directly (more reliable than LIKE
    // on detailed_notes since LIKE wildcards _ and % can mismatch real field names).
    if (params.eventCrfId) {
      const existingByDesc = await client.query(`
        SELECT dn.discrepancy_note_id
        FROM discrepancy_note dn
        INNER JOIN dn_event_crf_map decm ON dn.discrepancy_note_id = decm.discrepancy_note_id
        INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE decm.event_crf_id = $1
          AND dn.description = $2
          AND decm.column_name = $3
          AND rs.name NOT IN ('Closed', 'Not Applicable')
          AND dn.parent_dn_id IS NULL
        LIMIT 1
      `, [params.eventCrfId, expectedDescription, params.fieldPath]);

      if (existingByDesc.rows.length > 0) {
        const existingId = existingByDesc.rows[0].discrepancy_note_id;
        logger.info('Existing validation query for THIS rule found in event_crf map, skipping duplicate', {
          existingQueryId: existingId,
          fieldPath: params.fieldPath,
          description: expectedDescription,
        });
        await client.query('COMMIT');
        return { queryId: existingId, isNew: false };
      }
    }
    
    // ===== WORKFLOW-BASED QUERY ASSIGNMENT =====
    // Uses the shared workflow-config.provider for consistent routing.
    // Priority: explicit caller ID → workflow config → default study role
    let assignedUserId = params.assignedUserId;
    
    if (!assignedUserId) {
      assignedUserId = await resolveQueryAssignee(
        params.crfId, params.studyId, params.eventCrfId, params.subjectId
      );
    }
    
    // (isWarning + expectedDescription were already computed above for dedup;
    // reuse expectedDescription here so insert + dedup match exactly.)
    const description = expectedDescription;
    const detailedNotes = `Field: ${params.fieldPath}\nValue: ${JSON.stringify(params.value)}\n${isWarning ? 'Warning' : 'Error'}: ${params.errorMessage}\nSeverity: ${params.severity || 'error'}`;

    // LibreClinica discrepancy_note_type_id:
    //   1 = "Failed Validation Check" (hard edit / error)
    //   2 = "Annotation" (soft edit / warning query)
    //   3 = "Query" (manual query)
    // Use type 1 for errors (Failed Validation), type 2 for warnings (Annotation/soft edit)
    const noteTypeId = isWarning ? 2 : 1;

    // Resolve due date from study's queryDueDays parameter
    let dueDateStr: string | null = null;
    try {
      const studyParams = await getStudyParameters(params.studyId);
      const dueDays = studyParams.queryDueDays;
      if (dueDays > 0) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + dueDays);
        dueDateStr = dueDate.toISOString().split('T')[0];
      }
    } catch (e: any) {
      logger.warn('Could not resolve queryDueDays for study, due_date will be NULL', { studyId: params.studyId, error: e.message });
    }

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
        entity_type,
        generation_type,
        severity,
        due_date
      ) VALUES ($1, $2, $3, 1, $4, $5, $6, CURRENT_TIMESTAMP, 'itemData', 'automatic', $7, $8)
      RETURNING discrepancy_note_id
    `, [description, detailedNotes, noteTypeId, params.studyId, params.userId, assignedUserId, params.severity || 'minor', dueDateStr]);

    const queryId = result.rows[0]?.discrepancy_note_id;
    
    if (!queryId) {
      throw new Error('Failed to create discrepancy note');
    }

    // Link to item_data if available (most precise)
    // For cell-level queries, store the cellPath as column_name for precise cell identification.
    // For regular field queries, use 'value' per LibreClinica schema convention.
    if (itemDataId) {
      const isCellPath = params.fieldPath && (params.fieldPath.includes('[') || params.fieldPath.split('.').length === 3);
      const columnName = isCellPath ? params.fieldPath : 'value';
      await client.query(`
        INSERT INTO dn_item_data_map (discrepancy_note_id, item_data_id, column_name)
        VALUES ($1, $2, $3)
      `, [queryId, itemDataId, columnName]);
      
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

    // Log audit event for query creation (best-effort, don't fail the whole query)
    try {
      const auditDetail = [
        `Rule: ${params.ruleName}`,
        `Field: ${params.fieldPath}`,
        `Value: ${JSON.stringify(params.value)}`,
        `Severity: ${params.severity || 'error'}`,
        `Type: ${isWarning ? 'Automatic Warning Query' : 'Automatic Validation Query'}`,
        params.eventCrfId ? `EventCRF: ${params.eventCrfId}` : null,
        params.subjectId ? `Subject: ${params.subjectId}` : null,
        itemDataId ? `ItemData: ${itemDataId}` : null
      ].filter(Boolean).join(', ');

      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name,
          new_value, reason_for_change, audit_log_event_type_id
        ) VALUES (
          CURRENT_TIMESTAMP, 'discrepancy_note', $1, $2, 'Validation Query Created',
          $3, $4,
          COALESCE(
            (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%creat%' LIMIT 1),
            1
          )
        )
      `, [params.userId, queryId, description, auditDetail]);
    } catch (auditError: any) {
      logger.warn('Audit log for validation query failed (non-blocking)', { 
        queryId, error: auditError.message 
      });
    }

    // Create a workflow task for tracking this automatic query
    if (assignedUserId) {
      try {
        const taskTableCheck = await client.query(`
          SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists
        `);
        if (taskTableCheck.rows[0].exists) {
          await client.query(`
            INSERT INTO acc_workflow_tasks (
              task_type, title, description, status, priority,
              entity_type, entity_id, event_crf_id, study_id,
              assigned_to_user_ids, created_by, metadata
            ) VALUES ('query', $1, $2, 'pending', $3, 'discrepancy_note', $4, $5, $6, $7, $8, $9)
          `, [
            description,
            `Auto-query on field "${params.fieldPath}": ${params.errorMessage}`,
            isWarning ? 'low' : 'medium',
            queryId,
            params.eventCrfId || null,
            params.studyId,
            [assignedUserId],
            params.userId,
            JSON.stringify({
              generationType: 'automatic',
              ruleName: params.ruleName,
              fieldPath: params.fieldPath,
              severity: params.severity || 'error',
              itemDataId: itemDataId || null
            })
          ]);
          logger.info('Created workflow task for automatic validation query', { queryId, assignedUserId });
        }
      } catch (taskError: any) {
        logger.warn('Workflow task creation for validation query failed (non-blocking)', {
          queryId, error: taskError.message
        });
      }
    }

    // Update denormalized query counts on patient_event_form
    if (params.eventCrfId) {
      await updateFormQueryCounts(client, params.eventCrfId);
    }

    await client.query('COMMIT');

    logger.info('Created validation query', { 
      queryId, 
      fieldPath: params.fieldPath,
      severity: params.severity,
      itemDataId: itemDataId,
      eventCrfId: params.eventCrfId,
      assignedUserId
    });

    return { queryId, isNew: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error creating validation query', { 
      error: error.message, 
      stack: error.stack?.substring(0, 300),
      fieldPath: params.fieldPath,
      studyId: params.studyId,
      eventCrfId: params.eventCrfId
    });
    return null;
  } finally {
    client.release();
  }
}

// findWorkflowAssignee() and findDefaultAssignee() have been moved to
// workflow-config.provider.ts as resolveQueryAssignee() and resolveDefaultAssignee().
// All callers now import from the shared provider module.

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
  
  // Try by field name / OID / normalized name
  if (fieldPath) {
    // For cell paths like "vitals_table[2].heart_rate" or "symptoms_qt.headache.severity",
    // extract the table field name (first segment) rather than the column name (last segment)
    let fieldName: string;
    const dtMatch = fieldPath.match(/^(.+)\[\d+\*?\]\./);
    const qtMatch = fieldPath.match(/^([^.[]+)\.[^.]+\.[^.]+$/);
    if (dtMatch) {
      fieldName = dtMatch[1];
    } else if (qtMatch) {
      fieldName = qtMatch[1];
    } else {
      fieldName = fieldPath.split('.').pop() || fieldPath;
    }
    
    const result = await client.query(`
      SELECT id.item_data_id 
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 
        AND (
          LOWER(i.name) = LOWER($2) 
          OR LOWER(i.oc_oid) = LOWER($2)
          OR LOWER(REPLACE(i.name, ' ', '_')) = LOWER($2)
          OR i.description ILIKE '%"fieldName":"' || LOWER($2) || '"%'
        )
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
): { valid: boolean; message?: string } {
  // Handle null/undefined values
  if (value === null || value === undefined || value === '') {
    if (rule.ruleType === 'required') {
      // ISSUE-406 fix: a whitespace-only string also counts as empty for
      // required. (We can't trim before this branch because we want '' to
      // hit the same path; non-string values like numbers/booleans never
      // get here because they're !== ''.)
      return { valid: false };
    }
    // ISSUE-404 fix: formula / business_logic / cross_form rules SHOULD
    // be allowed to evaluate empty values, because the rule may use
    // ISBLANK() (or NOT(ISBLANK())) to enforce non-empty conditions
    // beyond a simple `required` rule. Short-circuiting here makes
    // those rules unenforceable.
    if (rule.ruleType === 'formula' || rule.ruleType === 'business_logic' || rule.ruleType === 'cross_form') {
      // Fall through to switch
    } else {
      // Other rules don't apply to empty values
      return { valid: true };
    }
  }

  // Detect multi-value fields (checkbox/multi-select stored as comma-separated strings)
  // These need special handling: range and format rules designed for single values
  // should not be applied to comma-separated multi-value strings.
  const isMultiValue = typeof value === 'string' && value.includes(',') &&
    !/^\d[\d,.]*$/.test(value) && // Not a decimal number with commas (e.g., "1,234.56")
    !/^\d{4}-\d{2}-\d{2}/.test(value); // Not a date string

  // Detect blood pressure composite values (e.g., "120/80")
  const isBloodPressure = typeof value === 'string' && /^\d{2,3}\/\d{2,3}$/.test(value);

  // Detect yes/no boolean string values
  const isYesNo = typeof value === 'string' &&
    ['yes', 'no', 'true', 'false'].includes(value.toLowerCase());

  // Detect JSON-encoded values (table fields, repeating groups)
  const isJsonValue = typeof value === 'string' &&
    (value.startsWith('[') || value.startsWith('{'));

  // Detect file upload IDs (UUID format with hyphens like "550e8400-e29b-41d4-a716-446655440000")
  const isFileIds = typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(,[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})*$/i.test(value);

  // Handle array values (in case value comes as actual array — table data,
  // multi-select, checkbox cells). Most rule types don't make sense at the
  // whole-array level (e.g., range on a list of strings), but `value_match`
  // and `pattern_match` are intentionally selection-aware: the user authored
  // the rule to match WHEN one of the selected items meets a criterion.
  if (Array.isArray(value)) {
    if (rule.ruleType === 'required') {
      return { valid: value.length > 0 };
    }
    // value_match: rule fires when any element matches one of the rule's
    // expected values (split on ||). Falls through to switch case below.
    if (rule.ruleType === 'value_match') {
      // Don't return — fall through; the value_match case handles arrays
      // by stringifying with comma separators.
    } else if (rule.ruleType === 'pattern_match') {
      // pattern_match: rule fires when any element matches the regex pattern.
      // Without this branch, checkbox cells (stored as arrays) can NEVER
      // trigger a pattern match — the early-return swallows it silently.
      if (!rule.pattern) return { valid: true };
      try {
        const regex = new RegExp(rule.pattern, 'i');
        const matched = value.some((v: any) => regex.test(String(v ?? '').trim()));
        return { valid: !matched };
      } catch (e: any) {
        // ISSUE-408 fix: fail-closed on invalid regex (consistent with format)
        logger.error('Invalid regex in pattern_match rule (array branch)', { pattern: rule.pattern, error: e.message });
        return { valid: false, message: `Invalid regex pattern: ${e.message}` };
      }
    } else if (rule.ruleType === 'range' || rule.ruleType === 'format' ||
               rule.ruleType === 'consistency' || rule.ruleType === 'formula' ||
               rule.ruleType === 'business_logic' || rule.ruleType === 'cross_form') {
      return { valid: true };
    }
  }

  // Handle native object values (question_table data: { rowId: { colId: value } },
  // criteria_list, inline_group). At the field level, only 'required' meaningfully
  // applies — the object is "filled" if it has any keys with non-empty values.
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    if (rule.ruleType === 'required') {
      const hasAnyValue = Object.values(value).some(v => {
        if (v === null || v === undefined || v === '') return false;
        if (typeof v === 'object') return Object.values(v).some(x => x !== null && x !== undefined && x !== '');
        return true;
      });
      return { valid: hasAnyValue };
    }
    return { valid: true };
  }

  // JSON-encoded values (tables, repeating groups) — only 'required' and 'value_match' apply
  if (isJsonValue && rule.ruleType !== 'required' && rule.ruleType !== 'value_match') {
    return { valid: true };
  }

  // File upload IDs — only 'required' applies
  if (isFileIds && rule.ruleType !== 'required') {
    return { valid: true };
  }

  switch (rule.ruleType) {
    case 'required':
      if (Array.isArray(value)) return { valid: value.length > 0 };
      // ISSUE-406 fix: whitespace-only strings count as empty for required.
      // Without this, a user can satisfy a required field by typing a single
      // space, which contradicts the regulatory expectation of "data was entered".
      if (typeof value === 'string') return { valid: value.trim() !== '' };
      return { valid: value !== null && value !== undefined };

    case 'range':
      // Skip range validation for multi-value (checkbox/multi-select) fields
      // Comma-separated option values like "opt1,opt2" would produce NaN and falsely fail
      if (isMultiValue) return { valid: true };
      
      // Yes/No values are not numeric — range validation doesn't apply
      if (isYesNo) return { valid: true };
      
      // Blood pressure composites: validate systolic and diastolic parts independently.
      // The rule can carry per-component limits via bpSystolicMin/Max and bpDiastolicMin/Max.
      // If those are not set, fall back to clinical defaults (systolic: 60-250, diastolic: 30-150).
      // ISSUE-403 fix: APPEND the diagnostic to the rule's authored message rather than
      // replacing it. The author chose the user-facing wording deliberately; the
      // diagnostic adds precision without losing the author's intent. When no
      // authored message exists, fall back to the diagnostic alone.
      if (isBloodPressure) {
        const [sys, dia] = (value as string).split('/').map(Number);
        const sysMin = rule.bpSystolicMin ?? rule.minValue ?? 60;
        const sysMax = rule.bpSystolicMax ?? rule.maxValue ?? 250;
        const diaMin = rule.bpDiastolicMin ?? 30;
        const diaMax = rule.bpDiastolicMax ?? 150;
        const buildMsg = (diag: string): string => {
          const authored = (rule.errorMessage || '').trim();
          if (!authored) return diag;
          if (authored.includes(diag)) return authored;
          return `${authored} (${diag})`;
        };
        if (sys < sysMin || sys > sysMax) {
          return { valid: false, message: buildMsg(`Systolic ${sys} not between ${sysMin}-${sysMax} mmHg`) };
        }
        if (dia < diaMin || dia > diaMax) {
          return { valid: false, message: buildMsg(`Diastolic ${dia} not between ${diaMin}-${diaMax} mmHg`) };
        }
        return { valid: true };
      }
      
      // Check for date range validation (handles both YYYY-MM-DD and full ISO datetime)
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

      // ISSUE-TIME-RANGE fix: time-shaped values (HH:MM or H:MM, with
      // optional :SS) used to fall through to `Number(value)` which
      // returns NaN, making the rule silently pass. The UI offers a
      // range rule on time cells (it lives under the same generic
      // 'range' option) so authors expect 'between 08:00 and 17:00' to
      // actually fire. Convert both sides to minute-of-day integers and
      // compare numerically. Mirrors the parseTimeToMinutes helper
      // below; we don't anchor to wall-clock units because authors only
      // care about ordering.
      const isTimeValue = typeof value === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
      if (isTimeValue) {
        const valMinutes = parseTimeToMinutes(value);
        if (valMinutes === null) return { valid: true };
        if (rule.minValue !== undefined && rule.minValue !== null) {
          const minMinutes = parseTimeToMinutes(rule.minValue as any);
          if (minMinutes !== null && valMinutes < minMinutes) return { valid: false };
        }
        if (rule.maxValue !== undefined && rule.maxValue !== null) {
          const maxMinutes = parseTimeToMinutes(rule.maxValue as any);
          if (maxMinutes !== null && valMinutes > maxMinutes) return { valid: false };
        }
        return { valid: true };
      }

      const numValue = Number(value);
      if (isNaN(numValue)) return { valid: true };
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
      // Yes/No values: only skip for numeric/date format checks, not all patterns
      if (isYesNo) {
        const numericDateFormats = ['positive_number', 'integer_only', 'decimal_2dp', 'numbers_only',
          'date_mmddyyyy', 'date_ddmmyyyy', 'date_iso', 'time_24h', 'time_12h'];
        const ft = rule.formatType || '';
        if (!ft || numericDateFormats.includes(ft)) return { valid: true };
      }
      // Blood pressure composites: the combined "120/80" string won't match numeric
      // patterns designed for single values. Validate each component independently
      // against the original pattern, or pass if the pattern is purely numeric.
      if (isBloodPressure) {
        const bpPattern = FORMAT_TYPE_REGISTRY['blood_pressure']?.pattern;
        if (bpPattern) {
          try { return { valid: new RegExp(bpPattern).test(String(value)) }; } catch { /* fall through */ }
        }
        // If the stored pattern is a simple numeric check, validate each part
        const numericPatterns = ['^\\d+$', '^\\d*\\.?\\d+$', '^-?\\d+$', '^-?\\d+\\.\\d{2}$'];
        if (numericPatterns.includes(resolvedPattern)) {
          const parts = (value as string).split('/');
          const partRegex = new RegExp(resolvedPattern);
          return { valid: parts.every(p => partRegex.test(p.trim())) };
        }
      }
      // Check if this is actually an Excel formula stored as format type
      if (resolvedPattern.startsWith('=FORMULA:') || resolvedPattern.startsWith('=')) {
        const formula = resolvedPattern.startsWith('=FORMULA:') 
          ? resolvedPattern.substring(9) 
          : resolvedPattern;
        return evaluateExcelFormula(formula, value, allData);
      }
      try {
        const regex = new RegExp(resolvedPattern);
        // ISSUE-407 fix: trim whitespace before testing format patterns. A
        // user pasting "  42  " into a numbers-only field shouldn't be
        // penalized for invisible padding around an otherwise-correct value.
        // Patterns that intentionally include whitespace (e.g., "letters_only"
        // includes \s in its character class) still work because trim only
        // removes outer whitespace.
        const testTarget = typeof value === 'string' ? value.trim() : String(value);
        const regexMatched = regex.test(testTarget);
        if (!regexMatched) return { valid: false };
        // ISSUE-DATE-CALENDAR fix: pure regex cannot reject calendar-impossible
        // dates like 2024-02-30 or 2024-04-31 (non-leap Feb 29 only the JS Date
        // engine knows). For all date-typed registry formats, run a calendar
        // verification AFTER the regex passes. This stops invalid dates from
        // poisoning downstream date arithmetic (DATEDIF, age calc, etc.).
        const ftKey = rule.formatType || '';
        if (ftKey === 'date_iso' || ftKey === 'date_mmddyyyy' || ftKey === 'date_ddmmyyyy' || ftKey === 'datetime_iso') {
          if (!isCalendarDate(testTarget, ftKey)) {
            return { valid: false, message: `Invalid calendar date: ${testTarget}` };
          }
        }
        return { valid: true };
      } catch (regexErr: any) {
        logger.error('Invalid regex pattern in validation rule', {
          pattern: resolvedPattern,
          ruleName: rule.name,
          ruleId: rule.id,
          error: regexErr.message
        });
        return { valid: false, message: `Invalid regex pattern: ${regexErr.message}` };
      }

    case 'consistency': {
      let compareTarget: any;
      if (rule.compareValue !== undefined && rule.compareValue !== null && rule.compareValue !== '') {
        compareTarget = rule.compareValue;
        if (!isNaN(Number(value)) && !isNaN(Number(compareTarget))) {
          compareTarget = Number(compareTarget);
          value = Number(value);
        }
      } else {
        // ISSUE-CONSISTENCY-MISSING-FIELD fix: if no compareValue AND no
        // compareFieldPath was authored, the rule is structurally
        // incomplete — there's nothing to compare against. Previously
        // we passed undefined into compareValues, which then evaluated
        // `value == undefined` and fired the rule on every non-empty
        // value (false predicate -> rule fires). That punished authors
        // for a missing operand, which is misleading. Now we silently
        // skip (matches modal behaviour at line 8316). Authors who
        // authored the rule but didn't pick a target field will see
        // it as inert until they fix the rule definition.
        if (!rule.compareFieldPath || !rule.operator) return { valid: true };
        compareTarget = getNestedValue(allData, rule.compareFieldPath);
        // If the referenced field is undefined (e.g. it was deleted
        // from the template after the rule was authored), treat as
        // skip rather than fire-on-every-value. The frontend already
        // does this (compareValues result is the same when both sides
        // are undefined -> true), but being explicit prevents future
        // divergence.
        if (compareTarget === undefined) return { valid: true };
      }
      return { valid: compareValues(value, compareTarget, rule.operator || '==') };
    }

    case 'value_match': {
      if (!rule.compareValue) return { valid: true };
      // Yes/No synonym table. When BOTH the rule's compareValue AND the
      // patient's entered value normalize to a yes/no token, fold them
      // to the canonical 'yes'/'no' before comparing. This mirrors the
      // ISSUE-109 fix in `consistency ==` (compareValues function below)
      // so a value_match rule with compareValue:"Yes" fires for users
      // who entered "true" or "1" via a different UI control.
      // Without this, value_match was the only rule type where yes/no
      // normalization didn't happen, leading to silently-missed matches
      // (caught by verify-gemini-user-data.ts on 2026-04-19).
      const yesNoTokens: Record<string, string> = {
        yes: 'yes', y: 'yes', true: 'yes', '1': 'yes', t: 'yes',
        no: 'no', n: 'no', false: 'no', '0': 'no', f: 'no'
      };
      const normalizeToken = (s: string): string => {
        const lower = s.trim().toLowerCase().replace(/\s+/g, '');
        return yesNoTokens[lower] ?? lower;
      };
      const targetValues = rule.compareValue.split('||').map(normalizeToken);
      // Normalize the input value into an array of selected option values.
      // Handles both checkbox cells (already an array) and comma-separated
      // strings (legacy storage).
      let selectedValues: string[];
      if (Array.isArray(value)) {
        selectedValues = value.map((v: any) => normalizeToken(String(v ?? '')));
      } else {
        const rawFieldVal = String(value).trim().toLowerCase().replace(/\s+/g, '');
        selectedValues = rawFieldVal.includes(',')
          ? rawFieldVal.split(',').map((v: string) => normalizeToken(v))
          : [normalizeToken(rawFieldVal)];
      }
      const vmMatched = selectedValues.some((sv: string) => targetValues.includes(sv));
      return { valid: !vmMatched };
    }

    case 'pattern_match':
      if (!rule.pattern) return { valid: true };
      try {
        const pmRegex = new RegExp(rule.pattern, 'i');
        // Build the list of strings to test. Arrays are handled by the early
        // branch above; this handles single-string values which may also be
        // comma-separated multi-select storage.
        let pmValuesToCheck: string[];
        if (Array.isArray(value)) {
          pmValuesToCheck = value.map((v: any) => String(v ?? '').trim());
        } else {
          const pmStrVal = String(value).trim();
          pmValuesToCheck = pmStrVal.includes(',')
            ? pmStrVal.split(',').map((v: string) => v.trim())
            : [pmStrVal];
        }
        const pmMatched = pmValuesToCheck.some((v: string) => pmRegex.test(v));
        return { valid: !pmMatched };
      } catch (regexErr: any) {
        // ISSUE-408 fix: fail-closed on invalid regex (matching `format`).
        // Previously this caught silently and returned valid:true, so an
        // author with a typo'd regex got a permanently no-op rule.
        logger.error('Invalid regex pattern in pattern_match rule', {
          pattern: rule.pattern,
          ruleName: rule.name,
          ruleId: rule.id,
          error: regexErr.message
        });
        return { valid: false, message: `Invalid regex pattern: ${regexErr.message}` };
      }

    case 'formula':
      // ISSUE-411 fix: prefer customExpression for formula rules. The
      // legacy code accepted the formula in `pattern` too (because the
      // frontend used to mirror it there), but that overloads the column
      // and confuses developers reading the validation_rules table. New
      // rules should populate customExpression only; pattern is kept as a
      // fallback for backward compatibility with already-saved rows.
      if (rule.customExpression) {
        return evaluateExcelFormula(rule.customExpression, value, allData);
      }
      if (rule.pattern) {
        return evaluateExcelFormula(rule.pattern, value, allData);
      }
      return { valid: true };

    case 'business_logic':
    case 'cross_form':
      // ISSUE-001 fix: business_logic and cross_form rules are evaluated via
      // hot-formula-parser ONLY. The previous `new Function(value, data, ...)`
      // fallback was an unbounded JS-execution surface (anyone with rule-author
      // permissions could effectively run arbitrary Node.js code on the API
      // server). Excel formulas are sandboxed and cover the use cases.
      if (rule.customExpression) {
        return evaluateExcelFormula(rule.customExpression, value, allData);
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
    const parser: any = new FormulaParser();

    // ISSUE-405 fix: hot-formula-parser's built-in TODAY()/NOW()/DATE() return
    // values that don't compare correctly with strings (probably Date objects
    // or formatted strings -- testing shows TODAY()>100000 returns true for
    // ALL N, suggesting the comparison is degenerate). Override with our own
    // implementations that use a consistent Excel-1900 serial-number scheme,
    // matching the date-string-to-serial conversion in callVariable.
    const dateToSerial = (d: Date): number =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
               d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 86400000 + 25569;
    const serialToDate = (s: number): Date => new Date(((Number(s) || 0) - 25569) * 86400000);
    const isoToSerial = (s: any): number | null => {
      if (s == null || s === '') return null;
      if (typeof s === 'number') return s;
      if (s instanceof Date) return dateToSerial(s);
      if (typeof s === 'string') {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (m) {
          const ms = Date.UTC(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
          if (!isNaN(ms)) return ms / 86400000 + 25569;
        }
        const n = Number(s);
        if (!isNaN(n)) return n;
      }
      return null;
    };

    // ISSUE-404 follow-up: hot-formula-parser eagerly evaluates BOTH IF branches.
    // If we pass `null` for empty {value} (so ISBLANK works), then `LEN(null)`
    // in the unused FALSE branch errors out and poisons the whole IF result.
    // Solution: override ISBLANK and LEN ourselves so they handle our sentinel
    // empty-string consistently. We pass empty values as `""` from
    // callVariable; ISBLANK("") returns true via our override, LEN("")=0.
    parser.setFunction('ISBLANK', (params: any[]) => {
      const v = params?.[0];
      return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '');
    });
    parser.setFunction('LEN', (params: any[]) => {
      const v = params?.[0];
      if (v === null || v === undefined) return 0;
      return String(v).length;
    });
    parser.setFunction('ISNUMBER', (params: any[]) => {
      const v = params?.[0];
      if (v === null || v === undefined || v === '') return false;
      return typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '');
    });
    parser.setFunction('ISTEXT', (params: any[]) => {
      const v = params?.[0];
      return typeof v === 'string' && v !== '';
    });
    // Override EXACT for reliable case-sensitive string comparison.
    // hot-formula-parser's built-in = operator fails for variable-resolved
    // strings inside IF conditions. We rewrite var="literal" to EXACT()
    // below and need this override to handle nulls/empty gracefully.
    parser.setFunction('EXACT', (params: any[]) => {
      const a = params?.[0];
      const b = params?.[1];
      if (a === '' && b === '') return true;
      if (a == null || b == null) return false;
      return String(a) === String(b);
    });
    // Case-insensitive string comparison for clinical data where casing varies
    // (e.g., "male" vs "Male" vs "MALE"). Authors can use STRCMPI({sex},"male").
    parser.setFunction('STRCMPI', (params: any[]) => {
      const a = params?.[0];
      const b = params?.[1];
      if (a == null || b == null) return false;
      return String(a).toLowerCase() === String(b).toLowerCase();
    });

    parser.setFunction('TODAY', () => {
      const d = new Date();
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
    });
    parser.setFunction('NOW', () => Date.now() / 86400000 + 25569);
    parser.setFunction('DATE', (params: any[]) => {
      const [y, m, d] = (params || []).map((x: any) => Number(x));
      if ([y, m, d].some(isNaN)) return 0;
      return Date.UTC(y, m - 1, d) / 86400000 + 25569;
    });
    parser.setFunction('YEAR', (params: any[]) => {
      const s = isoToSerial(params?.[0]);
      if (s === null) return 0;
      return serialToDate(s).getUTCFullYear();
    });
    parser.setFunction('MONTH', (params: any[]) => {
      const s = isoToSerial(params?.[0]);
      if (s === null) return 0;
      return serialToDate(s).getUTCMonth() + 1;
    });
    parser.setFunction('DAY', (params: any[]) => {
      const s = isoToSerial(params?.[0]);
      if (s === null) return 0;
      return serialToDate(s).getUTCDate();
    });
    parser.setFunction('DATEDIF', (params: any[]) => {
      const a = isoToSerial(params?.[0]);
      const b = isoToSerial(params?.[1]);
      const unit = String(params?.[2] || 'D').toUpperCase();
      if (a === null || b === null) return 0;
      const ds = serialToDate(a);
      const de = serialToDate(b);
      switch (unit) {
        case 'Y': {
          let years = de.getUTCFullYear() - ds.getUTCFullYear();
          if (de.getUTCMonth() < ds.getUTCMonth() ||
              (de.getUTCMonth() === ds.getUTCMonth() && de.getUTCDate() < ds.getUTCDate())) {
            years--;
          }
          return years;
        }
        case 'M':
          return (de.getUTCFullYear() - ds.getUTCFullYear()) * 12 + (de.getUTCMonth() - ds.getUTCMonth());
        case 'D':
        default:
          return Math.floor((de.getTime() - ds.getTime()) / 86400000);
      }
    });

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

    // Fix string comparison: hot-formula-parser's = operator fails for
    // variable-resolved strings inside IF conditions. The parser evaluates
    // e.g. IF(subject_sex="Male",...) but the = comparison between a
    // callVariable-resolved string and a literal silently returns false.
    // Rewrite bare-variable-to-string-literal equalities to EXACT() calls
    // which work reliably. Must run AFTER {field} replacement and BEFORE
    // the parser sees the formula.
    // Guards: only match single = (not ==, <=, >=, <>, !=) via negative
    // lookbehind/lookahead, and only when one side is a quoted string.
    processedFormula = processedFormula.replace(
      /(\b\w+\b)\s*(?<![<>!=])=(?!=)\s*"([^"]*)"/g,
      'EXACT($1,"$2")'
    );
    processedFormula = processedFormula.replace(
      /"([^"]*)"\s*(?<![<>!=])=(?!=)\s*(\b\w+\b)/g,
      'EXACT("$1",$2)'
    );

    // ISSUE-405 fix: convert ISO date strings to Excel serial numbers so that
    // arithmetic against TODAY() / DATE() / NOW() works. hot-formula-parser
    // stores dates internally as serial numbers (days since 1900-01-01 epoch
    // with the well-known Lotus-1-2-3 leap-year quirk: Jan 1 1900 = serial 1,
    // Feb 29 1900 is treated as a real day, so today is +1 vs. astronomical).
    // Without this conversion, `={value}<=TODAY()` always fires because
    // `"2026-04-18" <= 46127` is a string-vs-number compare in JS that returns
    // false. Date-only strings (YYYY-MM-DD) and full ISO datetimes both work.
    const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
    function dateStringToExcelSerial(s: string): number | null {
      const m = s.match(ISO_DATE_RE);
      if (!m) return null;
      const [, y, mo, d, hh, mm, ss] = m;
      const utcMs = Date.UTC(+y, +mo - 1, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
      if (isNaN(utcMs)) return null;
      // Days since 1899-12-30 UTC, which aligns with Excel's serial dates
      // (accounting for the spurious 1900-02-29). 25569 = 1970-01-01 in serial.
      return utcMs / 86400000 + 25569;
    }

    // Hook into the parser's variable resolution
    parser.on('callVariable', function(name: string, done: (val: any) => void) {
      // Handle TRUE/FALSE as boolean constants (parser treats them as variable names)
      if (name === 'TRUE' || name === 'true') { done(true); return; }
      if (name === 'FALSE' || name === 'false') { done(false); return; }

      let raw: any;
      // Check the var map first (for {fieldName} references)
      const mappedName = varMap[name];
      if (mappedName !== undefined) {
        raw = fieldValues[mappedName] ?? fieldValues[mappedName.toLowerCase()];
      } else {
        raw = fieldValues[name] ?? fieldValues[name.toLowerCase()];
      }
      // ISSUE-404 follow-up: pass empty values as the empty STRING (not
      // null) so hot-formula-parser doesn't error inside the unused branch
      // of an IF (the parser eagerly evaluates both branches). Our
      // overridden ISBLANK / LEN / ISNUMBER above all handle '' correctly,
      // so `=ISBLANK({value})` returns true for empty form fields.
      if (raw === undefined || raw === null || raw === '') {
        done('');
        return;
      }
      // Auto-cast ISO date strings to Excel serial numbers (ISSUE-405)
      if (typeof raw === 'string') {
        const serial = dateStringToExcelSerial(raw);
        if (serial !== null) { done(serial); return; }
      }
      // Auto-cast numeric strings so ISNUMBER() and arithmetic work correctly
      if (typeof raw === 'string' && raw !== '' && !isNaN(Number(raw)) && raw.trim() !== '') {
        done(Number(raw));
        return;
      }
      done(raw);
    });

    // Parse and evaluate the formula
    const result = parser.parse(processedFormula);

    if (result.error) {
      logger.error('Excel formula parse error', { formula, processedFormula, error: result.error });
      return { valid: false };
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
    logger.error('Excel formula evaluation error', { formula, error: error.message });
    return { valid: false };
  }
}

/**
 * Verify a date string represents a real calendar date (not just regex-valid).
 *
 * The format-types.json regexes catch obvious garbage (mm 01-12, dd 01-31)
 * but cannot reject impossible-but-syntactically-valid dates such as
 * `2024-02-30` (Feb has 28/29), `2024-04-31` (Apr has 30), or
 * `2023-02-29` (2023 isn't a leap year). Without this check those values
 * silently pass `format=date_iso`, then explode downstream when the date
 * is used in `DATEDIF`, age computation, or visit-window logic.
 *
 * Returns true iff the parsed Y/M/D round-trips through `Date.UTC` with
 * the same components — the standard JS trick for calendar verification.
 *
 * Supported formatType keys: `date_iso`, `date_mmddyyyy`, `date_ddmmyyyy`,
 * `datetime_iso`. Unrecognized keys return true (treat as not-a-date).
 */
function isCalendarDate(value: string, formatType: string): boolean {
  if (!value || typeof value !== 'string') return false;
  let y = 0, m = 0, d = 0;
  if (formatType === 'date_iso') {
    const m1 = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m1) return false;
    y = +m1[1]; m = +m1[2]; d = +m1[3];
  } else if (formatType === 'datetime_iso') {
    const m1 = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m1) return false;
    y = +m1[1]; m = +m1[2]; d = +m1[3];
  } else if (formatType === 'date_mmddyyyy') {
    const m1 = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m1) return false;
    m = +m1[1]; d = +m1[2]; y = +m1[3];
  } else if (formatType === 'date_ddmmyyyy') {
    const m1 = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m1) return false;
    d = +m1[1]; m = +m1[2]; y = +m1[3];
  } else {
    return true;
  }
  // Reject year 0 explicitly — clinically meaningless and the JS Date
  // engine accepts it (treats it as a valid year), so the round-trip
  // check below would incorrectly pass.
  if (y < 1) return false;
  // Round-trip check: build a Date from the parts and confirm the parts
  // come back unchanged. JS auto-rolls overflow (Feb 30 → Mar 2), so
  // a non-roundtrip means the date didn't really exist.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parse a wall-clock time string into minute-of-day (0..1440-ish; allows
 * 24h+ for sloppy data but caller normally won't see those). Accepts:
 *   "HH:MM"          (zero-padded or not)
 *   "HH:MM:SS"
 *   integer (already minutes)
 *   string of digits ("510" -> 510 minutes = 8:30 AM)
 *
 * Returns null for unparseable values.
 *
 * Why minute-of-day: it makes "is 9:30 between 08:00 and 17:00" trivial
 * arithmetic (570 between 480 and 1020), avoids the lexicographic trap
 * where "9:30" > "10:30" (which is what plain string compare would say).
 */
function parseTimeToMinutes(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const h = +m[1];
      const mm = +m[2];
      const ss = m[3] !== undefined ? +m[3] : 0;
      if (h >= 0 && mm >= 0 && mm < 60 && ss >= 0 && ss < 60) {
        return h * 60 + mm + ss / 60;
      }
      return null;
    }
    // Bare-number string ("510" minutes)
    const n = Number(value);
    if (!isNaN(n)) return n;
  }
  return null;
}

/**
 * Compare two values with an operator
 */
/**
 * Parse a value into a date-only timestamp (midnight UTC) for reliable
 * day-level comparison, ignoring time-of-day. Returns null if not a date.
 *
 * Mirrors the frontend `parseToDateOnly` helper so backend and frontend
 * date_* operator semantics agree.
 */
function parseToDateOnly(value: any): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string') {
    // Accept "YYYY-MM-DD" or full ISO datetime — extract the date portion only
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return Date.UTC(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
    }
    // Fallback: try Date.parse for other formats
    const ms = Date.parse(value);
    if (!isNaN(ms)) {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
  }
  return null;
}

function compareValues(a: any, b: any, operator: string): boolean {
  // Date-specific operators: parse both sides as date-only and compare day-level.
  // Without this branch, "date_after" / "date_before" / "date_equals" /
  // "date_on_or_after" / "date_on_or_before" fell through to the default case
  // which returned `true` (= valid), so date consistency rules silently never
  // failed. This is now aligned with the frontend's compareValues behavior.
  if (operator && operator.startsWith('date_')) {
    const dateA = parseToDateOnly(a);
    const dateB = parseToDateOnly(b);
    if (dateA === null || dateB === null) {
      // If either side isn't parseable as a date, the rule cannot be evaluated —
      // treat as valid (skip) rather than fail. This matches how non-numeric
      // values are handled elsewhere.
      return true;
    }
    switch (operator) {
      case 'date_before':       return dateA < dateB;
      case 'date_after':        return dateA > dateB;
      case 'date_on_or_before': return dateA <= dateB;
      case 'date_on_or_after':  return dateA >= dateB;
      case 'date_equals':       return dateA === dateB;
      default:
        logger.warn(`[Validation] Unknown date operator: "${operator}"`);
        return true;
    }
  }

  // Auto-cast numeric strings to numbers for correct comparison
  if (typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '') {
    if (!isNaN(Number(a)) && !isNaN(Number(b))) {
      a = Number(a);
      b = Number(b);
    }
  }

  // ISSUE-109 fix: yes/no values flow through `consistency ==` rules with
  // values like 'yes'/'no'/'Yes'/'No'/'true'/'false'/'1'/'0'. Without
  // normalization a rule authored as `compareValue: 'Yes'` against a stored
  // 'yes' would silently never match. Normalize both sides to a single token
  // when both look like yes/no synonyms.
  const yesNoTokens: Record<string, string> = {
    yes: 'yes', y: 'yes', true: 'yes', '1': 'yes', t: 'yes',
    no: 'no', n: 'no', false: 'no', '0': 'no', f: 'no'
  };
  if (typeof a === 'string' && typeof b === 'string') {
    const aToken = yesNoTokens[a.trim().toLowerCase()];
    const bToken = yesNoTokens[b.trim().toLowerCase()];
    if (aToken && bToken) {
      a = aToken;
      b = bToken;
    }
  }

  // ISSUE-TIME-COMPARE fix: time-shaped strings ("HH:MM", optionally
  // unpadded as "9:30") are not dates but they DO have ordering. Plain
  // string compare gives the wrong answer for unpadded values
  // ("9:30" > "10:30" lexicographically because '9' > '1'). Convert both
  // sides to minute-of-day before any comparison so HH:MM compares
  // correctly regardless of zero-padding. This applies to BOTH ARITHMETIC
  // operators (>, <, >=, <=) AND equality (==, !=) so "9:30" == "09:30"
  // returns true (which matches what an author would expect).
  const aIsTime = typeof a === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(a);
  const bIsTime = typeof b === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(b);
  if (aIsTime && bIsTime) {
    const aMin = parseTimeToMinutes(a);
    const bMin = parseTimeToMinutes(b);
    if (aMin !== null && bMin !== null) {
      a = aMin; b = bMin;
    }
  }

  const aIsDate = a instanceof Date || (typeof a === 'string' && a.length > 4 && !isNaN(Date.parse(a)) && isNaN(Number(a)));
  const bIsDate = b instanceof Date || (typeof b === 'string' && b.length > 4 && !isNaN(Date.parse(b)) && isNaN(Number(b)));
  // ISSUE-108 fix: when only ONE side is a recognized date string, use the
  // date_* operator path so we get day-level comparison, not lexicographic
  // string comparison. This makes `cmp_lt_value, compareValue:'2020-01-01'`
  // on a date field work reliably across MM/DD/YYYY, ISO, and full datetime
  // inputs (rather than working "by accident" for ISO only).
  if (aIsDate && bIsDate) {
    const dateA = parseToDateOnly(a);
    const dateB = parseToDateOnly(b);
    if (dateA !== null && dateB !== null) {
      a = dateA; b = dateB;
    } else {
      a = new Date(a).getTime();
      b = new Date(b).getTime();
    }
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
    compareValue: row.compare_value || undefined,
    customExpression: row.custom_expression,
    // Blood pressure per-component limits
    bpSystolicMin: row.bp_systolic_min != null ? Number(row.bp_systolic_min) : undefined,
    bpSystolicMax: row.bp_systolic_max != null ? Number(row.bp_systolic_max) : undefined,
    bpDiastolicMin: row.bp_diastolic_min != null ? Number(row.bp_diastolic_min) : undefined,
    bpDiastolicMax: row.bp_diastolic_max != null ? Number(row.bp_diastolic_max) : undefined,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    createdBy: row.created_by || row.owner_id,
    updatedBy: row.updated_by || row.update_id,
    tableCellTarget: row.table_cell_target || null
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
    // Get the CRF + crf_version the patient's eCRF is pinned to. The version
    // is sticky: when a CRF template is forked or a new version is created,
    // existing event_crfs continue pointing at the OLD crf_version_id, so the
    // patient sees the rule set frozen at the version they were enrolled on.
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
    const pinnedVersionId = eventCrfResult.rows[0].crf_version_id;

    // Get all rules for this CRF, then filter to ones that are version-locked
    // to the patient's pinned version OR have no version pin (legacy / "applies
    // to all versions"). This makes patient-form rules effectively a snapshot
    // of the template state at enrollment time.
    const allRules = await getRulesForCrf(crfId, callerUserId);
    return allRules.filter(rule =>
      rule.crfVersionId == null || rule.crfVersionId === pinnedVersionId
    );
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

    // Get all item data for this event_crf, including description for
    // extended_props parsing so we can key formData by technical fieldName.
    const itemDataResult = await pool.query(`
      SELECT 
        id.item_data_id,
        id.item_id,
        id.value,
        i.name as field_name,
        i.oc_oid as field_oid,
        i.description
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      WHERE id.event_crf_id = $1 AND id.deleted = false
    `, [eventCrfId]);

    // Build form data keyed by ALL identifiers so validation matching works
    // regardless of whether rules reference display names, OIDs, or technical names.
    const formData: Record<string, any> = {};
    const itemDataMap: Record<string, number> = {};

    for (const row of itemDataResult.rows) {
      // Display name
      formData[row.field_name] = row.value;
      itemDataMap[row.field_name] = row.item_data_id;
      itemDataMap[row.field_name.toLowerCase()] = row.item_data_id;
      // OID
      if (row.field_oid) {
        formData[row.field_oid] = row.value;
        itemDataMap[row.field_oid] = row.item_data_id;
      }
      // item_id key
      itemDataMap[`item_${row.item_id}`] = row.item_data_id;
      // Technical fieldName from extended_props
      if (row.description?.includes('---EXTENDED_PROPS---')) {
        try {
          const json = row.description.split('---EXTENDED_PROPS---')[1]?.trim();
          if (json) {
            const ext = JSON.parse(json);
            if (ext.fieldName) {
              formData[ext.fieldName] = row.value;
              itemDataMap[ext.fieldName] = row.item_data_id;
              itemDataMap[ext.fieldName.toLowerCase()] = row.item_data_id;
            }
          }
        } catch { /* ignore */ }
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

/**
 * Toggle a field's required status directly on item_form_metadata.
 * Bypasses the validation_rules table — "required" is a field property, not a rule.
 */
export const toggleFieldRequired = async (
  itemId: number,
  crfId: number,
  required: boolean,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Toggling field required status', { itemId, crfId, required, userId });

  try {
    const versionResult = await pool.query(
      `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 AND status_id = 1 ORDER BY crf_version_id DESC LIMIT 1`,
      [crfId]
    );
    if (versionResult.rows.length === 0) {
      return { success: false, message: 'CRF version not found' };
    }
    const crfVersionId = versionResult.rows[0].crf_version_id;

    const updateResult = await pool.query(
      `UPDATE item_form_metadata SET required = $1 WHERE item_id = $2 AND crf_version_id = $3`,
      [required, itemId, crfVersionId]
    );

    if (updateResult.rowCount === 0) {
      return { success: false, message: 'Field metadata not found' };
    }

    await pool.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id
      ) VALUES (
        NOW(), 'item_form_metadata', $1, $2, 'Field Required Toggle',
        $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, itemId, required ? 'false' : 'true', required ? 'true' : 'false']);

    return { success: true, message: `Field ${required ? 'marked as required' : 'marked as optional'}` };
  } catch (error: any) {
    logger.error('Toggle field required error', { error: error.message, itemId, crfId });
    return { success: false, message: error.message };
  }
};

export default {
  initializeValidationRulesTable,
  getRulesForCrf,
  getRulesForStudy,
  getAllCrfsWithRuleCounts,
  getRulesForEventCrf,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  validateFormData,
  validateFieldChange,
  validateEventCrf,
  testRuleDirectly,
  toggleFieldRequired
};

