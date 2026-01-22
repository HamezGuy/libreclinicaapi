"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFormData = exports.deleteRule = exports.toggleRule = exports.updateRule = exports.createRule = exports.getRuleById = exports.getRulesForStudy = exports.getRulesForCrf = exports.initializeValidationRulesTable = void 0;
var database_1 = require("../../config/database");
var logger_1 = require("../../config/logger");
// Track if table has been initialized
var tableInitialized = false;
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
var mapActionTypeToRuleType = function (actionType) {
    var typeMap = {
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
var initializeValidationRulesTable = function () { return __awaiter(void 0, void 0, void 0, function () {
    var checkQuery, checkResult, e_1, createTableQuery, createIndexQuery, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (tableInitialized) {
                    return [2 /*return*/, true];
                }
                checkQuery = "\n    SELECT EXISTS (\n      SELECT FROM information_schema.tables \n      WHERE table_name = 'validation_rules'\n    );\n  ";
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, database_1.pool.query(checkQuery)];
            case 2:
                checkResult = _a.sent();
                if (checkResult.rows[0].exists) {
                    tableInitialized = true;
                    return [2 /*return*/, true];
                }
                return [3 /*break*/, 4];
            case 3:
                e_1 = _a.sent();
                return [3 /*break*/, 4];
            case 4:
                createTableQuery = "\n    CREATE TABLE IF NOT EXISTS validation_rules (\n      validation_rule_id SERIAL PRIMARY KEY,\n      crf_id INTEGER,\n      crf_version_id INTEGER,\n      item_id INTEGER,\n      name VARCHAR(255) NOT NULL,\n      description TEXT,\n      rule_type VARCHAR(50) NOT NULL,\n      field_path VARCHAR(255),\n      severity VARCHAR(20) DEFAULT 'error',\n      error_message TEXT NOT NULL,\n      warning_message TEXT,\n      active BOOLEAN DEFAULT true,\n      min_value NUMERIC,\n      max_value NUMERIC,\n      pattern TEXT,\n      operator VARCHAR(20),\n      compare_field_path VARCHAR(255),\n      custom_expression TEXT,\n      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n      date_updated TIMESTAMP,\n      owner_id INTEGER,\n      update_id INTEGER\n    );\n  ";
                createIndexQuery = "\n    CREATE INDEX IF NOT EXISTS idx_validation_rules_crf ON validation_rules(crf_id);\n    CREATE INDEX IF NOT EXISTS idx_validation_rules_item ON validation_rules(item_id);\n    CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(active);\n  ";
                _a.label = 5;
            case 5:
                _a.trys.push([5, 8, , 9]);
                return [4 /*yield*/, database_1.pool.query(createTableQuery)];
            case 6:
                _a.sent();
                return [4 /*yield*/, database_1.pool.query(createIndexQuery)];
            case 7:
                _a.sent();
                tableInitialized = true;
                logger_1.logger.info('Validation rules table initialized successfully');
                return [2 /*return*/, true];
            case 8:
                error_1 = _a.sent();
                logger_1.logger.error('Failed to initialize validation_rules table:', error_1.message);
                return [2 /*return*/, false];
            case 9: return [2 /*return*/];
        }
    });
}); };
exports.initializeValidationRulesTable = initializeValidationRulesTable;
/**
 * Get all validation rules for a CRF
 */
var getRulesForCrf = function (crfId) { return __awaiter(void 0, void 0, void 0, function () {
    var customRulesQuery, customRules, customResult, e_2, itemRulesQuery, itemResult, itemRules, nativeRules, nativeRulesQuery, nativeResult, e_3, allRules, _loop_1, _i, itemRules_1, itemRule, _loop_2, _a, nativeRules_1, nativeRule, error_2;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                logger_1.logger.info('Getting validation rules for CRF', { crfId: crfId });
                // Ensure table exists before querying
                return [4 /*yield*/, (0, exports.initializeValidationRulesTable)()];
            case 1:
                // Ensure table exists before querying
                _b.sent();
                _b.label = 2;
            case 2:
                _b.trys.push([2, 12, , 13]);
                customRulesQuery = "\n      SELECT \n        vr.validation_rule_id as id,\n        vr.crf_id,\n        vr.crf_version_id,\n        vr.item_id,\n        vr.name,\n        vr.description,\n        vr.rule_type,\n        vr.field_path,\n        vr.severity,\n        vr.error_message,\n        vr.warning_message,\n        vr.active,\n        vr.min_value,\n        vr.max_value,\n        vr.pattern,\n        vr.operator,\n        vr.compare_field_path,\n        vr.custom_expression,\n        vr.date_created,\n        vr.date_updated,\n        vr.owner_id as created_by,\n        vr.update_id as updated_by\n      FROM validation_rules vr\n      WHERE vr.crf_id = $1\n      ORDER BY vr.name\n    ";
                customRules = [];
                _b.label = 3;
            case 3:
                _b.trys.push([3, 5, , 6]);
                return [4 /*yield*/, database_1.pool.query(customRulesQuery, [crfId])];
            case 4:
                customResult = _b.sent();
                customRules = customResult.rows.map(mapDbRowToRule);
                return [3 /*break*/, 6];
            case 5:
                e_2 = _b.sent();
                // Table might not exist yet
                logger_1.logger.debug('Custom validation_rules table not available:', e_2.message);
                return [3 /*break*/, 6];
            case 6:
                itemRulesQuery = "\n      SELECT \n        ifm.item_id as id,\n        cv.crf_id,\n        ifm.crf_version_id,\n        i.item_id,\n        i.name,\n        i.description,\n        CASE \n          WHEN ifm.regexp IS NOT NULL THEN 'format'\n          WHEN ifm.required = true THEN 'required'\n          ELSE NULL\n        END as rule_type,\n        i.name as field_path,\n        'error' as severity,\n        COALESCE(ifm.regexp_error_msg, 'Invalid format') as error_message,\n        NULL as warning_message,\n        true as active,\n        NULL as min_value,\n        NULL as max_value,\n        ifm.regexp as pattern,\n        NULL as operator,\n        NULL as compare_field_path,\n        NULL as custom_expression,\n        cv.date_created,\n        NULL as date_updated,\n        cv.owner_id as created_by,\n        NULL as updated_by\n      FROM item_form_metadata ifm\n      INNER JOIN crf_version cv ON ifm.crf_version_id = cv.crf_version_id\n      INNER JOIN item i ON ifm.item_id = i.item_id\n      WHERE cv.crf_id = $1\n        AND (ifm.regexp IS NOT NULL OR ifm.required = true)\n      ORDER BY i.name\n    ";
                return [4 /*yield*/, database_1.pool.query(itemRulesQuery, [crfId])];
            case 7:
                itemResult = _b.sent();
                itemRules = itemResult.rows
                    .filter(function (row) { return row.rule_type !== null; })
                    .map(mapDbRowToRule);
                nativeRules = [];
                _b.label = 8;
            case 8:
                _b.trys.push([8, 10, , 11]);
                nativeRulesQuery = "\n        SELECT \n          r.id,\n          r.name,\n          r.description,\n          r.oc_oid,\n          r.enabled,\n          r.study_id,\n          re.value as expression,\n          re.context as expression_context,\n          rs.target as target_oid,\n          rs.study_event_definition_id,\n          rs.crf_id,\n          rs.crf_version_id,\n          rs.item_id,\n          rs.item_group_id,\n          ra.action_type,\n          ra.message as action_message,\n          ra.expression_evaluates_to\n        FROM rule r\n        INNER JOIN rule_expression re ON r.rule_expression_id = re.id\n        INNER JOIN rule_set rs ON rs.study_id = r.study_id\n        INNER JOIN rule_set_rule rsr ON rsr.rule_set_id = rs.id AND rsr.rule_id = r.id\n        LEFT JOIN rule_action ra ON ra.rule_set_rule_id = rsr.id\n        WHERE rs.crf_id = $1 AND r.enabled = true\n        ORDER BY r.name\n      ";
                return [4 /*yield*/, database_1.pool.query(nativeRulesQuery, [crfId])];
            case 9:
                nativeResult = _b.sent();
                nativeRules = nativeResult.rows.map(function (row) { return ({
                    id: row.id + 100000, // Offset to avoid ID conflicts with custom rules
                    crfId: row.crf_id,
                    crfVersionId: row.crf_version_id,
                    itemId: row.item_id,
                    name: row.name || 'LibreClinica Rule',
                    description: row.description || '',
                    ruleType: mapActionTypeToRuleType(row.action_type),
                    fieldPath: row.target_oid || '',
                    severity: row.action_type === 'DISCREPANCY_NRS' ? 'warning' : 'error',
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
                }); });
                return [3 /*break*/, 11];
            case 10:
                e_3 = _b.sent();
                // Native rules tables might not be available or might have no data
                logger_1.logger.debug('LibreClinica native rules not available:', e_3.message);
                return [3 /*break*/, 11];
            case 11:
                allRules = __spreadArray([], customRules, true);
                _loop_1 = function (itemRule) {
                    var exists = customRules.some(function (r) { return r.fieldPath === itemRule.fieldPath && r.ruleType === itemRule.ruleType; });
                    if (!exists) {
                        allRules.push(itemRule);
                    }
                };
                for (_i = 0, itemRules_1 = itemRules; _i < itemRules_1.length; _i++) {
                    itemRule = itemRules_1[_i];
                    _loop_1(itemRule);
                }
                _loop_2 = function (nativeRule) {
                    var exists = allRules.some(function (r) { return r.customExpression === nativeRule.customExpression; });
                    if (!exists) {
                        allRules.push(nativeRule);
                    }
                };
                // Add native LibreClinica rules
                for (_a = 0, nativeRules_1 = nativeRules; _a < nativeRules_1.length; _a++) {
                    nativeRule = nativeRules_1[_a];
                    _loop_2(nativeRule);
                }
                return [2 /*return*/, allRules];
            case 12:
                error_2 = _b.sent();
                logger_1.logger.error('Get validation rules error', { error: error_2.message });
                throw error_2;
            case 13: return [2 /*return*/];
        }
    });
}); };
exports.getRulesForCrf = getRulesForCrf;
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
var getRulesForStudy = function (studyId) { return __awaiter(void 0, void 0, void 0, function () {
    var combinedCrfsQuery, crfsResult, allCrfsQuery, crfMap, _i, _a, crf, results, _b, _c, crf, rules, error_3;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                logger_1.logger.info('Getting validation rules for study', { studyId: studyId });
                _d.label = 1;
            case 1:
                _d.trys.push([1, 9, , 10]);
                combinedCrfsQuery = "\n      WITH study_crfs AS (\n        -- CRFs assigned to study event definitions\n        SELECT DISTINCT c.crf_id, c.name, 1 as priority\n        FROM crf c\n        INNER JOIN crf_version cv ON c.crf_id = cv.crf_id\n        INNER JOIN event_definition_crf edc ON cv.crf_id = edc.crf_id\n        INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id\n        WHERE sed.study_id = $1\n          AND c.status_id = 1\n        \n        UNION\n        \n        -- CRFs created for this study (source_study_id)\n        SELECT DISTINCT c.crf_id, c.name, 2 as priority\n        FROM crf c\n        WHERE c.source_study_id = $1\n          AND c.status_id = 1\n      )\n      SELECT DISTINCT ON (crf_id) crf_id, name\n      FROM study_crfs\n      ORDER BY crf_id, priority\n    ";
                return [4 /*yield*/, database_1.pool.query(combinedCrfsQuery, [studyId])];
            case 2:
                crfsResult = _d.sent();
                logger_1.logger.info('Study CRFs (combined query)', { studyId: studyId, count: crfsResult.rows.length });
                if (!(crfsResult.rows.length === 0)) return [3 /*break*/, 4];
                allCrfsQuery = "\n        SELECT DISTINCT crf_id, name\n        FROM crf\n        WHERE status_id = 1\n        ORDER BY name\n        LIMIT 50\n      ";
                return [4 /*yield*/, database_1.pool.query(allCrfsQuery)];
            case 3:
                crfsResult = _d.sent();
                logger_1.logger.info('All available CRFs (fallback)', { count: crfsResult.rows.length });
                _d.label = 4;
            case 4:
                crfMap = new Map();
                for (_i = 0, _a = crfsResult.rows; _i < _a.length; _i++) {
                    crf = _a[_i];
                    if (!crfMap.has(crf.crf_id)) {
                        crfMap.set(crf.crf_id, {
                            crfId: crf.crf_id,
                            crfName: crf.name
                        });
                    }
                }
                results = [];
                _b = 0, _c = crfMap.values();
                _d.label = 5;
            case 5:
                if (!(_b < _c.length)) return [3 /*break*/, 8];
                crf = _c[_b];
                return [4 /*yield*/, (0, exports.getRulesForCrf)(crf.crfId)];
            case 6:
                rules = _d.sent();
                results.push({
                    crfId: crf.crfId,
                    crfName: crf.crfName,
                    rules: rules
                });
                _d.label = 7;
            case 7:
                _b++;
                return [3 /*break*/, 5];
            case 8:
                // Sort by name for consistent ordering
                results.sort(function (a, b) { return a.crfName.localeCompare(b.crfName); });
                logger_1.logger.info('Returning unique CRFs for study', { studyId: studyId, uniqueCount: results.length });
                return [2 /*return*/, results];
            case 9:
                error_3 = _d.sent();
                logger_1.logger.error('Get study validation rules error', { error: error_3.message });
                throw error_3;
            case 10: return [2 /*return*/];
        }
    });
}); };
exports.getRulesForStudy = getRulesForStudy;
/**
 * Get a single validation rule by ID
 */
var getRuleById = function (ruleId) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: 
            // Ensure table exists
            return [4 /*yield*/, (0, exports.initializeValidationRulesTable)()];
            case 1:
                // Ensure table exists
                _a.sent();
                _a.label = 2;
            case 2:
                _a.trys.push([2, 4, , 5]);
                query = "\n      SELECT \n        validation_rule_id as id,\n        crf_id,\n        crf_version_id,\n        item_id,\n        name,\n        description,\n        rule_type,\n        field_path,\n        severity,\n        error_message,\n        warning_message,\n        active,\n        min_value,\n        max_value,\n        pattern,\n        operator,\n        compare_field_path,\n        custom_expression,\n        date_created,\n        date_updated,\n        owner_id as created_by,\n        update_id as updated_by\n      FROM validation_rules \n      WHERE validation_rule_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [ruleId])];
            case 3:
                result = _a.sent();
                if (result.rows.length === 0) {
                    return [2 /*return*/, null];
                }
                return [2 /*return*/, mapDbRowToRule(result.rows[0])];
            case 4:
                error_4 = _a.sent();
                logger_1.logger.error('Get rule by ID error', { error: error_4.message });
                return [2 /*return*/, null];
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getRuleById = getRuleById;
/**
 * Create a new validation rule
 */
var createRule = function (rule, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, insertQuery, fieldPath, result, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Creating validation rule', { rule: rule, userId: userId });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _a.sent();
                _a.label = 2;
            case 2:
                _a.trys.push([2, 11, 13, 14]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _a.sent();
                // Ensure the table exists
                return [4 /*yield*/, (0, exports.initializeValidationRulesTable)()];
            case 4:
                // Ensure the table exists
                _a.sent();
                insertQuery = "\n      INSERT INTO validation_rules (\n        crf_id, crf_version_id, item_id, name, description, rule_type,\n        field_path, severity, error_message, warning_message, active,\n        min_value, max_value, pattern, operator, compare_field_path,\n        custom_expression, date_created, owner_id\n      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, $17)\n      RETURNING validation_rule_id\n    ";
                fieldPath = rule.fieldPath || rule.fieldName || '';
                return [4 /*yield*/, client.query(insertQuery, [
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
                        rule.operator || null,
                        rule.compareFieldPath || null,
                        rule.customExpression || null,
                        userId
                    ])];
            case 5:
                result = _a.sent();
                if (!(rule.itemId && (rule.ruleType === 'format' || rule.ruleType === 'required'))) return [3 /*break*/, 9];
                if (!(rule.ruleType === 'format' && rule.pattern)) return [3 /*break*/, 7];
                return [4 /*yield*/, client.query("\n          UPDATE item_form_metadata \n          SET regexp = $1, regexp_error_msg = $2 \n          WHERE item_id = $3\n        ", [rule.pattern, rule.errorMessage, rule.itemId])];
            case 6:
                _a.sent();
                return [3 /*break*/, 9];
            case 7:
                if (!(rule.ruleType === 'required')) return [3 /*break*/, 9];
                return [4 /*yield*/, client.query("\n          UPDATE item_form_metadata SET required = true WHERE item_id = $1\n        ", [rule.itemId])];
            case 8:
                _a.sent();
                _a.label = 9;
            case 9: return [4 /*yield*/, client.query('COMMIT')];
            case 10:
                _a.sent();
                return [2 /*return*/, { success: true, ruleId: result.rows[0].validation_rule_id }];
            case 11:
                error_5 = _a.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 12:
                _a.sent();
                logger_1.logger.error('Create validation rule error', { error: error_5.message });
                return [2 /*return*/, { success: false, message: error_5.message }];
            case 13:
                client.release();
                return [7 /*endfinally*/];
            case 14: return [2 /*return*/];
        }
    });
}); };
exports.createRule = createRule;
/**
 * Update a validation rule
 */
var updateRule = function (ruleId, updates, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, updateQuery, error_6;
    var _a, _b, _c, _d, _e, _f;
    return __generator(this, function (_g) {
        switch (_g.label) {
            case 0:
                logger_1.logger.info('Updating validation rule', { ruleId: ruleId, updates: updates, userId: userId });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _g.sent();
                _g.label = 2;
            case 2:
                _g.trys.push([2, 6, 8, 9]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _g.sent();
                updateQuery = "\n      UPDATE validation_rules SET\n        name = COALESCE($1, name),\n        description = COALESCE($2, description),\n        rule_type = COALESCE($3, rule_type),\n        field_path = COALESCE($4, field_path),\n        severity = COALESCE($5, severity),\n        error_message = COALESCE($6, error_message),\n        warning_message = COALESCE($7, warning_message),\n        min_value = $8,\n        max_value = $9,\n        pattern = $10,\n        operator = $11,\n        compare_field_path = $12,\n        custom_expression = $13,\n        date_updated = CURRENT_TIMESTAMP,\n        update_id = $14\n      WHERE validation_rule_id = $15\n    ";
                return [4 /*yield*/, client.query(updateQuery, [
                        updates.name,
                        updates.description,
                        updates.ruleType,
                        updates.fieldPath,
                        updates.severity,
                        updates.errorMessage,
                        updates.warningMessage,
                        (_a = updates.minValue) !== null && _a !== void 0 ? _a : null,
                        (_b = updates.maxValue) !== null && _b !== void 0 ? _b : null,
                        (_c = updates.pattern) !== null && _c !== void 0 ? _c : null,
                        (_d = updates.operator) !== null && _d !== void 0 ? _d : null,
                        (_e = updates.compareFieldPath) !== null && _e !== void 0 ? _e : null,
                        (_f = updates.customExpression) !== null && _f !== void 0 ? _f : null,
                        userId,
                        ruleId
                    ])];
            case 4:
                _g.sent();
                return [4 /*yield*/, client.query('COMMIT')];
            case 5:
                _g.sent();
                return [2 /*return*/, { success: true }];
            case 6:
                error_6 = _g.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 7:
                _g.sent();
                logger_1.logger.error('Update validation rule error', { error: error_6.message });
                return [2 /*return*/, { success: false, message: error_6.message }];
            case 8:
                client.release();
                return [7 /*endfinally*/];
            case 9: return [2 /*return*/];
        }
    });
}); };
exports.updateRule = updateRule;
/**
 * Toggle validation rule active state
 */
var toggleRule = function (ruleId, active, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, database_1.pool.query("\n      UPDATE validation_rules \n      SET active = $1, date_updated = CURRENT_TIMESTAMP, update_id = $2\n      WHERE validation_rule_id = $3\n    ", [active, userId, ruleId])];
            case 1:
                _a.sent();
                return [2 /*return*/, { success: true }];
            case 2:
                error_7 = _a.sent();
                logger_1.logger.error('Toggle rule error', { error: error_7.message });
                return [2 /*return*/, { success: false }];
            case 3: return [2 /*return*/];
        }
    });
}); };
exports.toggleRule = toggleRule;
/**
 * Delete a validation rule
 */
var deleteRule = function (ruleId, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var error_8;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Deleting validation rule', { ruleId: ruleId, userId: userId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, database_1.pool.query("DELETE FROM validation_rules WHERE validation_rule_id = $1", [ruleId])];
            case 2:
                _a.sent();
                return [2 /*return*/, { success: true }];
            case 3:
                error_8 = _a.sent();
                logger_1.logger.error('Delete validation rule error', { error: error_8.message });
                return [2 /*return*/, { success: false, message: error_8.message }];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.deleteRule = deleteRule;
/**
 * Validate form data against rules
 *
 * @param crfId - The CRF ID to validate against
 * @param formData - The form data to validate
 * @param options - Optional parameters for query creation
 * @param options.createQueries - If true, creates queries for validation failures
 * @param options.studyId - Study ID for query creation
 * @param options.subjectId - Subject ID for query creation
 * @param options.eventCrfId - Event CRF ID for query creation
 * @param options.userId - User ID who triggered validation
 */
var validateFormData = function (crfId, formData, options) { return __awaiter(void 0, void 0, void 0, function () {
    var rules, errors, warnings, queriesCreated, _i, rules_1, rule, value, validationResult, error, queryId, e_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Validating form data', { crfId: crfId, fieldsCount: Object.keys(formData).length });
                return [4 /*yield*/, (0, exports.getRulesForCrf)(crfId)];
            case 1:
                rules = _a.sent();
                errors = [];
                warnings = [];
                queriesCreated = 0;
                _i = 0, rules_1 = rules;
                _a.label = 2;
            case 2:
                if (!(_i < rules_1.length)) return [3 /*break*/, 9];
                rule = rules_1[_i];
                if (!rule.active)
                    return [3 /*break*/, 8];
                value = getNestedValue(formData, rule.fieldPath);
                validationResult = applyRule(rule, value, formData);
                if (!!validationResult.valid) return [3 /*break*/, 8];
                if (!(rule.severity === 'error')) return [3 /*break*/, 7];
                error = {
                    fieldPath: rule.fieldPath,
                    message: rule.errorMessage,
                    severity: 'error'
                };
                if (!((options === null || options === void 0 ? void 0 : options.createQueries) && options.studyId && options.userId)) return [3 /*break*/, 6];
                _a.label = 3;
            case 3:
                _a.trys.push([3, 5, , 6]);
                return [4 /*yield*/, createValidationQuery({
                        studyId: options.studyId,
                        subjectId: options.subjectId,
                        eventCrfId: options.eventCrfId,
                        fieldPath: rule.fieldPath,
                        ruleName: rule.name,
                        errorMessage: rule.errorMessage,
                        value: value,
                        userId: options.userId
                    })];
            case 4:
                queryId = _a.sent();
                if (queryId) {
                    error.queryId = queryId;
                    queriesCreated++;
                }
                return [3 /*break*/, 6];
            case 5:
                e_4 = _a.sent();
                logger_1.logger.error('Failed to create validation query:', e_4.message);
                return [3 /*break*/, 6];
            case 6:
                errors.push(error);
                return [3 /*break*/, 8];
            case 7:
                warnings.push({
                    fieldPath: rule.fieldPath,
                    message: rule.warningMessage || rule.errorMessage
                });
                _a.label = 8;
            case 8:
                _i++;
                return [3 /*break*/, 2];
            case 9: return [2 /*return*/, {
                    valid: errors.length === 0,
                    errors: errors,
                    warnings: warnings,
                    queriesCreated: queriesCreated
                }];
        }
    });
}); };
exports.validateFormData = validateFormData;
/**
 * Create a query (discrepancy note) for a validation failure
 */
function createValidationQuery(params) {
    return __awaiter(this, void 0, void 0, function () {
        var description, detailedNotes, result, queryId, error_9;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 6, , 7]);
                    description = "Validation Error: ".concat(params.ruleName);
                    detailedNotes = "Field: ".concat(params.fieldPath, "\nValue: ").concat(JSON.stringify(params.value), "\nError: ").concat(params.errorMessage);
                    return [4 /*yield*/, database_1.pool.query("\n      INSERT INTO discrepancy_note (\n        description,\n        detailed_notes,\n        discrepancy_note_type_id,\n        resolution_status_id,\n        study_id,\n        owner_id,\n        date_created,\n        entity_type\n      ) VALUES ($1, $2, 1, 1, $3, $4, CURRENT_TIMESTAMP, 'itemData')\n      RETURNING discrepancy_note_id\n    ", [description, detailedNotes, params.studyId, params.userId])];
                case 1:
                    result = _b.sent();
                    queryId = (_a = result.rows[0]) === null || _a === void 0 ? void 0 : _a.discrepancy_note_id;
                    if (!(queryId && params.subjectId)) return [3 /*break*/, 3];
                    return [4 /*yield*/, database_1.pool.query("\n        INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)\n        VALUES ($1, $2, $3)\n      ", [queryId, params.subjectId, params.fieldPath])];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    if (!(queryId && params.eventCrfId)) return [3 /*break*/, 5];
                    return [4 /*yield*/, database_1.pool.query("\n        INSERT INTO dn_event_crf_map (discrepancy_note_id, event_crf_id, column_name)\n        VALUES ($1, $2, $3)\n      ", [queryId, params.eventCrfId, params.fieldPath])];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5:
                    logger_1.logger.info('Created validation query', { queryId: queryId, fieldPath: params.fieldPath });
                    return [2 /*return*/, queryId];
                case 6:
                    error_9 = _b.sent();
                    logger_1.logger.error('Error creating validation query:', error_9.message);
                    return [2 /*return*/, null];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/**
 * Apply a single validation rule to a value
 */
function applyRule(rule, value, allData) {
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
            var numValue = Number(value);
            if (isNaN(numValue))
                return { valid: false };
            if (rule.minValue !== undefined && numValue < rule.minValue)
                return { valid: false };
            if (rule.maxValue !== undefined && numValue > rule.maxValue)
                return { valid: false };
            return { valid: true };
        case 'format':
            if (!rule.pattern)
                return { valid: true };
            try {
                var regex = new RegExp(rule.pattern);
                return { valid: regex.test(String(value)) };
            }
            catch (_a) {
                return { valid: true }; // Invalid regex = no validation
            }
        case 'consistency':
            var compareValue = getNestedValue(allData, rule.compareFieldPath || '');
            return { valid: compareValues(value, compareValue, rule.operator || '==') };
        case 'business_logic':
        case 'cross_form':
            // Custom expression evaluation would go here
            if (rule.customExpression) {
                try {
                    // Safe evaluation using Function constructor
                    var evalFn = new Function('value', 'data', "return ".concat(rule.customExpression));
                    return { valid: Boolean(evalFn(value, allData)) };
                }
                catch (_b) {
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
function compareValues(a, b, operator) {
    // Handle date comparison
    if (a instanceof Date || !isNaN(Date.parse(a))) {
        var dateA = new Date(a).getTime();
        var dateB = new Date(b).getTime();
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
function getNestedValue(obj, path) {
    if (!path)
        return undefined;
    return path.split('.').reduce(function (current, key) { return current === null || current === void 0 ? void 0 : current[key]; }, obj);
}
/**
 * Map database row to ValidationRule interface
 */
function mapDbRowToRule(row) {
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
exports.default = {
    initializeValidationRulesTable: exports.initializeValidationRulesTable,
    getRulesForCrf: exports.getRulesForCrf,
    getRulesForStudy: exports.getRulesForStudy,
    getRuleById: exports.getRuleById,
    createRule: exports.createRule,
    updateRule: exports.updateRule,
    toggleRule: exports.toggleRule,
    deleteRule: exports.deleteRule,
    validateFormData: exports.validateFormData
};
