"use strict";
/**
 * Form Service (Hybrid)
 *
 * Form data management combining SOAP and Database
 * - Use SOAP for saving form data (GxP compliant with validation)
 * - Use Database for reading form data (faster)
 *
 * 21 CFR Part 11 §11.10(e) - Audit Trail for document actions
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.forkForm = exports.createFormVersion = exports.getFormVersions = exports.deleteForm = exports.updateForm = exports.createForm = exports.getFormById = exports.getAllForms = exports.getStudyForms = exports.validateFormData = exports.getFormStatus = exports.getFormMetadata = exports.getFormData = exports.saveFormData = void 0;
var database_1 = require("../../config/database");
var logger_1 = require("../../config/logger");
var environment_1 = require("../../config/environment");
var dataSoap = require("../soap/dataSoap.service");
var audit_service_1 = require("../database/audit.service");
var validationRulesService = require("../database/validation-rules.service");
var encryption_util_1 = require("../../utils/encryption.util");
var workflowService = require("../database/workflow.service");
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
var saveFormData = function (request, userId, username) { return __awaiter(void 0, void 0, void 0, function () {
    var crfId, formData, eventDefId, validationResult, validationError_1, normalizedRequest, soapResult, soapError_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Saving form data', {
                    studyId: request.studyId,
                    subjectId: request.subjectId,
                    eventId: request.studyEventDefinitionId || request.eventId,
                    crfId: request.crfId || request.formId,
                    userId: userId
                });
                crfId = request.crfId || request.formId;
                formData = request.formData || request.data;
                eventDefId = request.studyEventDefinitionId || request.eventId;
                // Validate required fields
                if (!request.studyId || !request.subjectId || !eventDefId || !crfId) {
                    logger_1.logger.warn('Missing required fields for form save', {
                        studyId: request.studyId,
                        subjectId: request.subjectId,
                        eventDefId: eventDefId,
                        crfId: crfId
                    });
                    return [2 /*return*/, {
                            success: false,
                            message: 'Missing required fields: studyId, subjectId, eventId/studyEventDefinitionId, formId/crfId'
                        }];
                }
                if (!(crfId && formData)) return [3 /*break*/, 4];
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, validationRulesService.validateFormData(crfId, formData, {
                        createQueries: true, // Create queries for validation failures
                        studyId: request.studyId,
                        subjectId: request.subjectId,
                        userId: userId
                    })];
            case 2:
                validationResult = _a.sent();
                // If there are hard edit errors, block the save
                if (!validationResult.valid && validationResult.errors.length > 0) {
                    logger_1.logger.warn('Form data validation failed - queries created', {
                        crfId: crfId,
                        errors: validationResult.errors,
                        queriesCreated: validationResult.queriesCreated
                    });
                    return [2 /*return*/, {
                            success: false,
                            message: 'Validation failed',
                            errors: validationResult.errors,
                            warnings: validationResult.warnings,
                            queriesCreated: validationResult.queriesCreated
                        }];
                }
                // Log warnings but continue with save
                if (validationResult.warnings.length > 0) {
                    logger_1.logger.info('Form data validation warnings', {
                        crfId: crfId,
                        warnings: validationResult.warnings
                    });
                }
                return [3 /*break*/, 4];
            case 3:
                validationError_1 = _a.sent();
                // Don't block save if validation service fails
                logger_1.logger.warn('Validation check failed, proceeding with save', {
                    error: validationError_1.message
                });
                return [3 /*break*/, 4];
            case 4:
                normalizedRequest = {
                    studyId: request.studyId,
                    subjectId: request.subjectId,
                    studyEventDefinitionId: eventDefId,
                    crfId: crfId,
                    formData: formData || {}
                };
                _a.label = 5;
            case 5:
                _a.trys.push([5, 7, , 8]);
                return [4 /*yield*/, dataSoap.importData(normalizedRequest, userId, username)];
            case 6:
                soapResult = _a.sent();
                if (soapResult.success) {
                    return [2 /*return*/, soapResult];
                }
                logger_1.logger.warn('SOAP import failed, falling back to database', { error: soapResult.message });
                return [3 /*break*/, 8];
            case 7:
                soapError_1 = _a.sent();
                logger_1.logger.warn('SOAP service unavailable, falling back to database', { error: soapError_1.message });
                return [3 /*break*/, 8];
            case 8: return [4 /*yield*/, saveFormDataDirect(normalizedRequest, userId, username)];
            case 9: 
            // Fallback: Direct database insert for data entry
            // This maintains audit trail compliance by using the existing LibreClinica tables
            return [2 /*return*/, _a.sent()];
        }
    });
}); };
exports.saveFormData = saveFormData;
/**
 * Direct database save fallback for form data
 * Uses LibreClinica's existing tables: event_crf, item_data
 * 21 CFR Part 11 compliant with proper audit logging
 */
var saveFormDataDirect = function (request, userId, username) { return __awaiter(void 0, void 0, void 0, function () {
    var client, studyEventId, studyEventResult, createEventResult, crfVersionResult, crfVersionId, eventCrfId, eventCrfResult, lockCheckResult, createEventCrfResult, itemsResult, itemMap, _i, _a, item, savedCount, formData, _b, _c, _d, fieldName, value, itemId, existingResult, stringValue, oldValue, insertResult, formDetailsResult, formName, subjectId, workflowError_1, error_1;
    var _e;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                logger_1.logger.info('Saving form data directly to database', {
                    studyId: request.studyId,
                    subjectId: request.subjectId,
                    crfId: request.crfId
                });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _f.sent();
                _f.label = 2;
            case 2:
                _f.trys.push([2, 36, 38, 39]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _f.sent();
                studyEventId = null;
                return [4 /*yield*/, client.query("\n      SELECT se.study_event_id \n      FROM study_event se\n      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id\n      WHERE ss.study_subject_id = $1 \n        AND se.study_event_definition_id = $2\n      ORDER BY se.sample_ordinal DESC\n      LIMIT 1\n    ", [request.subjectId, request.studyEventDefinitionId])];
            case 4:
                studyEventResult = _f.sent();
                if (!(studyEventResult.rows.length > 0)) return [3 /*break*/, 5];
                studyEventId = studyEventResult.rows[0].study_event_id;
                return [3 /*break*/, 7];
            case 5: return [4 /*yield*/, client.query("\n        INSERT INTO study_event (\n          study_event_definition_id, study_subject_id, sample_ordinal,\n          date_start, owner_id, status_id, subject_event_status_id, date_created\n        ) VALUES ($1, $2, 1, CURRENT_DATE, $3, 1, 3, NOW())\n        RETURNING study_event_id\n      ", [request.studyEventDefinitionId, request.subjectId, userId])];
            case 6:
                createEventResult = _f.sent();
                studyEventId = createEventResult.rows[0].study_event_id;
                logger_1.logger.info('Created study event', { studyEventId: studyEventId });
                _f.label = 7;
            case 7: return [4 /*yield*/, client.query("\n      SELECT crf_version_id FROM crf_version\n      WHERE crf_id = $1 AND status_id = 1\n      ORDER BY crf_version_id DESC\n      LIMIT 1\n    ", [request.crfId])];
            case 8:
                crfVersionResult = _f.sent();
                if (crfVersionResult.rows.length === 0) {
                    throw new Error("No active version found for CRF ".concat(request.crfId));
                }
                crfVersionId = crfVersionResult.rows[0].crf_version_id;
                eventCrfId = null;
                return [4 /*yield*/, client.query("\n      SELECT event_crf_id FROM event_crf\n      WHERE study_event_id = $1 AND crf_version_id = $2\n      LIMIT 1\n    ", [studyEventId, crfVersionId])];
            case 9:
                eventCrfResult = _f.sent();
                if (!(eventCrfResult.rows.length > 0)) return [3 /*break*/, 13];
                eventCrfId = eventCrfResult.rows[0].event_crf_id;
                return [4 /*yield*/, client.query("\n        SELECT status_id FROM event_crf WHERE event_crf_id = $1\n      ", [eventCrfId])];
            case 10:
                lockCheckResult = _f.sent();
                if (!(lockCheckResult.rows.length > 0 && lockCheckResult.rows[0].status_id === 6)) return [3 /*break*/, 12];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 11:
                _f.sent();
                logger_1.logger.warn('Attempted to edit locked record', { eventCrfId: eventCrfId, userId: userId });
                return [2 /*return*/, {
                        success: false,
                        message: 'Cannot edit data - this record is locked. Request an unlock through the Data Lock Management system.',
                        errors: ['RECORD_LOCKED']
                    }];
            case 12: return [3 /*break*/, 15];
            case 13: return [4 /*yield*/, client.query("\n        INSERT INTO event_crf (\n          study_event_id, crf_version_id, study_subject_id,\n          date_interviewed, interviewer_name,\n          completion_status_id, status_id, owner_id, date_created\n        ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 1, 1, $5, NOW())\n        RETURNING event_crf_id\n      ", [studyEventId, crfVersionId, request.subjectId, username, userId])];
            case 14:
                createEventCrfResult = _f.sent();
                eventCrfId = createEventCrfResult.rows[0].event_crf_id;
                logger_1.logger.info('Created event_crf', { eventCrfId: eventCrfId });
                _f.label = 15;
            case 15: return [4 /*yield*/, client.query("\n      SELECT i.item_id, i.name, i.oc_oid\n      FROM item i\n      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id\n      WHERE igm.crf_version_id = $1\n    ", [crfVersionId])];
            case 16:
                itemsResult = _f.sent();
                itemMap = new Map();
                for (_i = 0, _a = itemsResult.rows; _i < _a.length; _i++) {
                    item = _a[_i];
                    itemMap.set(item.name.toLowerCase(), item.item_id);
                    if (item.oc_oid) {
                        itemMap.set(item.oc_oid.toLowerCase(), item.item_id);
                    }
                }
                savedCount = 0;
                formData = request.formData || {};
                _b = 0, _c = Object.entries(formData);
                _f.label = 17;
            case 17:
                if (!(_b < _c.length)) return [3 /*break*/, 27];
                _d = _c[_b], fieldName = _d[0], value = _d[1];
                if (value === null || value === undefined || value === '')
                    return [3 /*break*/, 26];
                itemId = itemMap.get(fieldName.toLowerCase());
                if (!itemId) {
                    logger_1.logger.debug('Field not found in CRF, skipping', { fieldName: fieldName });
                    return [3 /*break*/, 26];
                }
                return [4 /*yield*/, client.query("\n        SELECT item_data_id, value FROM item_data\n        WHERE event_crf_id = $1 AND item_id = $2\n        LIMIT 1\n      ", [eventCrfId, itemId])];
            case 18:
                existingResult = _f.sent();
                stringValue = String(value);
                // 21 CFR Part 11 §11.10(a) - Encrypt sensitive form data at rest
                // Only encrypt if field-level encryption is enabled
                if ((_e = environment_1.config.encryption) === null || _e === void 0 ? void 0 : _e.enableFieldEncryption) {
                    stringValue = (0, encryption_util_1.encryptField)(stringValue);
                }
                if (!(existingResult.rows.length > 0)) return [3 /*break*/, 22];
                oldValue = existingResult.rows[0].value;
                if (!(oldValue !== stringValue)) return [3 /*break*/, 21];
                return [4 /*yield*/, client.query("\n            UPDATE item_data\n            SET value = $1, date_updated = NOW(), update_id = $2\n            WHERE item_data_id = $3\n          ", [stringValue, userId, existingResult.rows[0].item_data_id])];
            case 19:
                _f.sent();
                // Log change to audit trail
                return [4 /*yield*/, client.query("\n            INSERT INTO audit_log_event (\n              audit_date, audit_table, user_id, entity_id,\n              old_value, new_value, audit_log_event_type_id,\n              event_crf_id\n            ) VALUES (NOW(), 'item_data', $1, $2, $3, $4, 1, $5)\n          ", [userId, existingResult.rows[0].item_data_id, oldValue, stringValue, eventCrfId])];
            case 20:
                // Log change to audit trail
                _f.sent();
                _f.label = 21;
            case 21: return [3 /*break*/, 25];
            case 22: return [4 /*yield*/, client.query("\n          INSERT INTO item_data (\n            item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal\n          ) VALUES ($1, $2, $3, 1, $4, NOW(), 1)\n          RETURNING item_data_id\n        ", [itemId, eventCrfId, stringValue, userId])];
            case 23:
                insertResult = _f.sent();
                // Log creation to audit trail
                return [4 /*yield*/, client.query("\n          INSERT INTO audit_log_event (\n            audit_date, audit_table, user_id, entity_id,\n            new_value, audit_log_event_type_id, event_crf_id\n          ) VALUES (NOW(), 'item_data', $1, $2, $3, 4, $4)\n        ", [userId, insertResult.rows[0].item_data_id, stringValue, eventCrfId])];
            case 24:
                // Log creation to audit trail
                _f.sent();
                _f.label = 25;
            case 25:
                savedCount++;
                _f.label = 26;
            case 26:
                _b++;
                return [3 /*break*/, 17];
            case 27: 
            // 6. Update event_crf completion status
            return [4 /*yield*/, client.query("\n      UPDATE event_crf\n      SET completion_status_id = 2, date_updated = NOW(), update_id = $1\n      WHERE event_crf_id = $2\n    ", [userId, eventCrfId])];
            case 28:
                // 6. Update event_crf completion status
                _f.sent();
                return [4 /*yield*/, client.query('COMMIT')];
            case 29:
                _f.sent();
                logger_1.logger.info('Form data saved directly to database', {
                    eventCrfId: eventCrfId,
                    savedCount: savedCount,
                    totalFields: Object.keys(formData).length
                });
                _f.label = 30;
            case 30:
                _f.trys.push([30, 34, , 35]);
                return [4 /*yield*/, database_1.pool.query("\n        SELECT \n          c.name as form_name,\n          ss.study_subject_id as subject_id\n        FROM event_crf ec\n        JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id\n        JOIN crf c ON cv.crf_id = c.crf_id\n        JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id\n        WHERE ec.event_crf_id = $1\n      ", [eventCrfId])];
            case 31:
                formDetailsResult = _f.sent();
                if (!(formDetailsResult.rows.length > 0)) return [3 /*break*/, 33];
                formName = formDetailsResult.rows[0].form_name;
                subjectId = formDetailsResult.rows[0].subject_id;
                // Trigger SDV workflow automatically
                return [4 /*yield*/, workflowService.triggerFormSubmittedWorkflow(eventCrfId, request.studyId, subjectId, formName, userId)];
            case 32:
                // Trigger SDV workflow automatically
                _f.sent();
                logger_1.logger.info('Auto-triggered SDV workflow for form submission', { eventCrfId: eventCrfId, formName: formName });
                _f.label = 33;
            case 33: return [3 /*break*/, 35];
            case 34:
                workflowError_1 = _f.sent();
                // Don't fail the form save if workflow creation fails
                logger_1.logger.warn('Failed to auto-create workflow for form submission', { error: workflowError_1.message });
                return [3 /*break*/, 35];
            case 35: return [2 /*return*/, {
                    success: true,
                    data: { eventCrfId: eventCrfId, savedCount: savedCount },
                    message: "Form data saved successfully (".concat(savedCount, " fields)")
                }];
            case 36:
                error_1 = _f.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 37:
                _f.sent();
                logger_1.logger.error('Direct database save failed', { error: error_1.message });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to save form data: ".concat(error_1.message)
                    }];
            case 38:
                client.release();
                return [7 /*endfinally*/];
            case 39: return [2 /*return*/];
        }
    });
}); };
/**
 * Get form data from database
 * Returns data along with lock status for UI to respect
 */
var getFormData = function (eventCrfId) { return __awaiter(void 0, void 0, void 0, function () {
    var lockQuery, lockResult, isLocked, lockInfo, query, result, decryptedRows, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting form data', { eventCrfId: eventCrfId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 5]);
                lockQuery = "\n      SELECT ec.status_id, ec.date_updated as lock_date, u.user_name as locked_by\n      FROM event_crf ec\n      LEFT JOIN user_account u ON ec.update_id = u.user_id\n      WHERE ec.event_crf_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(lockQuery, [eventCrfId])];
            case 2:
                lockResult = _a.sent();
                isLocked = lockResult.rows.length > 0 && lockResult.rows[0].status_id === 6;
                lockInfo = isLocked ? {
                    locked: true,
                    lockedAt: lockResult.rows[0].lock_date,
                    lockedBy: lockResult.rows[0].locked_by
                } : { locked: false };
                query = "\n      SELECT \n        id.item_data_id,\n        i.name as item_name,\n        i.oc_oid as item_oid,\n        id.value,\n        id.status_id,\n        id.date_created,\n        id.date_updated,\n        u.user_name as entered_by\n      FROM item_data id\n      INNER JOIN item i ON id.item_id = i.item_id\n      LEFT JOIN user_account u ON id.owner_id = u.user_id\n      WHERE id.event_crf_id = $1\n        AND id.deleted = false\n      ORDER BY i.name\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [eventCrfId])];
            case 3:
                result = _a.sent();
                decryptedRows = result.rows.map(function (row) {
                    if (row.value && (0, encryption_util_1.isEncrypted)(row.value)) {
                        try {
                            return __assign(__assign({}, row), { value: (0, encryption_util_1.decryptField)(row.value) });
                        }
                        catch (decryptError) {
                            logger_1.logger.error('Failed to decrypt form field', {
                                itemDataId: row.item_data_id,
                                error: decryptError.message
                            });
                            // Return encrypted value with marker for troubleshooting
                            return __assign(__assign({}, row), { value: '[DECRYPTION_ERROR]', encryptedValue: row.value });
                        }
                    }
                    return row;
                });
                // Return data with lock status for UI to respect
                return [2 /*return*/, {
                        data: decryptedRows,
                        lockStatus: lockInfo
                    }];
            case 4:
                error_2 = _a.sent();
                logger_1.logger.error('Get form data error', { error: error_2.message });
                throw error_2;
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getFormData = getFormData;
/**
 * Get form metadata with all field properties
 */
var getFormMetadata = function (crfId) { return __awaiter(void 0, void 0, void 0, function () {
    var crfQuery, crfResult, crf, versionQuery, versionResult, versionId, sectionsQuery, sectionsResult, itemGroupsQuery, itemGroupsResult, itemsQuery, itemsResult, scdQuery, scdResult, scdByItemId_1, _i, _a, scd, conditions, items, decisionConditions, dcQuery, dcResult, dcMap, _loop_1, _b, _c, row, dcError_1, error_3;
    var _d;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                logger_1.logger.info('Getting form metadata', { crfId: crfId });
                _e.label = 1;
            case 1:
                _e.trys.push([1, 12, , 13]);
                crfQuery = "\n      SELECT * FROM crf WHERE crf_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(crfQuery, [crfId])];
            case 2:
                crfResult = _e.sent();
                if (crfResult.rows.length === 0) {
                    return [2 /*return*/, null];
                }
                crf = crfResult.rows[0];
                versionQuery = "\n      SELECT * FROM crf_version\n      WHERE crf_id = $1\n      ORDER BY crf_version_id DESC\n      LIMIT 1\n    ";
                return [4 /*yield*/, database_1.pool.query(versionQuery, [crfId])];
            case 3:
                versionResult = _e.sent();
                versionId = (_d = versionResult.rows[0]) === null || _d === void 0 ? void 0 : _d.crf_version_id;
                sectionsQuery = "\n      SELECT \n        section_id,\n        label,\n        title,\n        subtitle,\n        instructions,\n        ordinal\n      FROM section\n      WHERE crf_version_id = $1\n      ORDER BY ordinal\n    ";
                return [4 /*yield*/, database_1.pool.query(sectionsQuery, [versionId])];
            case 4:
                sectionsResult = _e.sent();
                itemGroupsQuery = "\n      SELECT DISTINCT\n        ig.item_group_id,\n        ig.name,\n        ig.oc_oid\n      FROM item_group ig\n      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id\n      WHERE igm.crf_version_id = $1\n      ORDER BY ig.name\n    ";
                return [4 /*yield*/, database_1.pool.query(itemGroupsQuery, [versionId])];
            case 5:
                itemGroupsResult = _e.sent();
                itemsQuery = "\n      SELECT \n        i.item_id,\n        i.name,\n        i.description,\n        i.units,\n        i.oc_oid,\n        i.phi_status,\n        idt.name as data_type,\n        idt.code as data_type_code,\n        igm.ordinal,\n        ig.name as group_name,\n        -- Additional metadata from item_form_metadata\n        ifm.required,\n        ifm.default_value,\n        ifm.left_item_text as placeholder,\n        ifm.regexp as validation_pattern,\n        ifm.regexp_error_msg as validation_message,\n        ifm.show_item,\n        ifm.column_number,\n        ifm.width_decimal,\n        -- Options from response_set\n        rs.options_text,\n        rs.options_values,\n        rt.name as response_type,\n        -- Section info\n        s.label as section_name\n      FROM item i\n      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id\n      INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id\n      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id\n      LEFT JOIN item_form_metadata ifm ON i.item_id = ifm.item_id AND ifm.crf_version_id = $1\n      LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id\n      LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id\n      LEFT JOIN section s ON ifm.section_id = s.section_id\n      WHERE igm.crf_version_id = $1\n      ORDER BY COALESCE(ifm.ordinal, igm.ordinal)\n    ";
                return [4 /*yield*/, database_1.pool.query(itemsQuery, [versionId])];
            case 6:
                itemsResult = _e.sent();
                scdQuery = "\n      SELECT \n        scd.id as scd_id,\n        scd.scd_item_form_metadata_id,    -- The item to show/hide\n        scd.control_item_form_metadata_id, -- The controlling item\n        scd.control_item_name,             -- Name of the controlling item\n        scd.option_value,                  -- Value that triggers showing\n        scd.message,\n        ifm_target.item_id as target_item_id,\n        ifm_control.item_id as control_item_id,\n        i_control.name as control_field_name\n      FROM scd_item_metadata scd\n      INNER JOIN item_form_metadata ifm_target ON scd.scd_item_form_metadata_id = ifm_target.item_form_metadata_id\n      LEFT JOIN item_form_metadata ifm_control ON scd.control_item_form_metadata_id = ifm_control.item_form_metadata_id\n      LEFT JOIN item i_control ON ifm_control.item_id = i_control.item_id\n      WHERE ifm_target.crf_version_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(scdQuery, [versionId])];
            case 7:
                scdResult = _e.sent();
                scdByItemId_1 = new Map();
                for (_i = 0, _a = scdResult.rows; _i < _a.length; _i++) {
                    scd = _a[_i];
                    conditions = scdByItemId_1.get(scd.target_item_id) || [];
                    conditions.push({
                        fieldId: scd.control_field_name || scd.control_item_name,
                        operator: 'equals', // SCD uses simple equality check
                        value: scd.option_value,
                        message: scd.message
                    });
                    scdByItemId_1.set(scd.target_item_id, conditions);
                }
                items = itemsResult.rows.map(function (item) {
                    var _a, _b;
                    // Parse options
                    var options = null;
                    if (item.options_text && item.options_values) {
                        var labels = item.options_text.split(',');
                        var values_1 = item.options_values.split(',');
                        options = labels.map(function (label, idx) {
                            var _a;
                            return ({
                                label: label.trim(),
                                value: ((_a = values_1[idx]) === null || _a === void 0 ? void 0 : _a.trim()) || label.trim()
                            });
                        });
                    }
                    // Parse description for help text and extended properties
                    var helpText = item.description || '';
                    var extendedProps = {};
                    if (helpText.includes('---EXTENDED_PROPS---')) {
                        var parts = helpText.split('---EXTENDED_PROPS---');
                        helpText = parts[0].trim();
                        try {
                            extendedProps = JSON.parse(parts[1].trim());
                        }
                        catch (e) {
                            // Ignore parse errors
                        }
                    }
                    // Parse min/max from width_decimal if present
                    var min = extendedProps.min;
                    var max = extendedProps.max;
                    if (item.width_decimal && item.width_decimal.includes(',')) {
                        var _c = item.width_decimal.split(','), minVal = _c[0], maxVal = _c[1];
                        if (minVal && !isNaN(Number(minVal)))
                            min = Number(minVal);
                        if (maxVal && !isNaN(Number(maxVal)))
                            max = Number(maxVal);
                    }
                    // Build validation rules array
                    var validationRules = [];
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
                        validationRules.push({ type: 'min', value: min, message: "Minimum value is ".concat(min) });
                    }
                    if (max !== undefined) {
                        validationRules.push({ type: 'max', value: max, message: "Maximum value is ".concat(max) });
                    }
                    // Determine field type from:
                    // 1. Extended props (preserves frontend types like 'yesno', 'textarea')
                    // 2. Response type (LibreClinica's UI type)
                    // 3. Data type code (fallback)
                    var fieldType = extendedProps.type
                        || mapResponseTypeToFieldType(item.response_type)
                        || ((_a = item.data_type_code) === null || _a === void 0 ? void 0 : _a.toLowerCase())
                        || 'text';
                    return {
                        // Core identifiers
                        id: (_b = item.item_id) === null || _b === void 0 ? void 0 : _b.toString(),
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
                        validationRules: validationRules,
                        validationPattern: item.validation_pattern,
                        validationMessage: item.validation_message,
                        // Options
                        options: options,
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
                        min: min,
                        max: max,
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
                        // Conditional Logic - merge from scd_item_metadata (LibreClinica skip logic) and extended props
                        showWhen: scdByItemId_1.get(item.item_id) || extendedProps.showWhen || [],
                        requiredWhen: extendedProps.requiredWhen,
                        conditionalLogic: extendedProps.conditionalLogic,
                        visibilityConditions: extendedProps.visibilityConditions,
                        // Flag to indicate if using LibreClinica native SCD
                        hasNativeScd: scdByItemId_1.has(item.item_id),
                        // Custom
                        customAttributes: extendedProps.customAttributes,
                        // Table field properties
                        tableColumns: extendedProps.tableColumns,
                        tableSettings: extendedProps.tableSettings
                    };
                });
                decisionConditions = [];
                _e.label = 8;
            case 8:
                _e.trys.push([8, 10, , 11]);
                dcQuery = "\n        SELECT \n          dc.decision_condition_id,\n          dc.crf_version_id,\n          dc.label,\n          dc.comments,\n          dc.quantity,\n          dc.type,\n          -- Get dc_primitive conditions\n          dcp.dc_primitive_id,\n          dcp.item_id,\n          dcp.comparison_operator,\n          dcp.value as comparison_value,\n          dcp.dynamic_value_item_id,\n          i.name as item_name,\n          i.oc_oid as item_oid,\n          -- Get dc_event actions\n          dce.dc_event_id,\n          -- Section events\n          dcse.section_id,\n          s.label as section_label,\n          -- Computed events (calculations)\n          dcce.dc_summary_event_id,\n          dcce.item_target_id,\n          -- Substitution events\n          dcsu.item_id as substitution_item_id,\n          dcsu.replacement_value\n        FROM decision_condition dc\n        LEFT JOIN dc_primitive dcp ON dc.decision_condition_id = dcp.decision_condition_id\n        LEFT JOIN item i ON dcp.item_id = i.item_id\n        LEFT JOIN dc_event dce ON dc.decision_condition_id = dce.decision_condition_id\n        LEFT JOIN dc_section_event dcse ON dce.dc_event_id = dcse.dc_event_id\n        LEFT JOIN section s ON dcse.section_id = s.section_id\n        LEFT JOIN dc_computed_event dcce ON dce.dc_event_id = dcce.dc_event_id\n        LEFT JOIN dc_substitution_event dcsu ON dce.dc_event_id = dcsu.dc_event_id\n        WHERE dc.crf_version_id = $1 AND dc.status_id = 1\n        ORDER BY dc.decision_condition_id\n      ";
                return [4 /*yield*/, database_1.pool.query(dcQuery, [versionId])];
            case 9:
                dcResult = _e.sent();
                dcMap = new Map();
                _loop_1 = function (row) {
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
                    var dc = dcMap.get(row.decision_condition_id);
                    // Add condition primitive
                    if (row.dc_primitive_id && !dc.conditions.some(function (c) { return c.primitiveId === row.dc_primitive_id; })) {
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
                    if (row.section_id && !dc.actions.some(function (a) { return a.sectionId === row.section_id; })) {
                        dc.actions.push({
                            type: 'section',
                            sectionId: row.section_id,
                            sectionLabel: row.section_label
                        });
                    }
                    // Add action - computed/calculation
                    if (row.dc_summary_event_id && !dc.actions.some(function (a) { return a.summaryEventId === row.dc_summary_event_id; })) {
                        dc.actions.push({
                            type: 'calculation',
                            summaryEventId: row.dc_summary_event_id,
                            targetItemId: row.item_target_id
                        });
                    }
                    // Add action - substitution
                    if (row.substitution_item_id && !dc.actions.some(function (a) { return a.substitutionItemId === row.substitution_item_id; })) {
                        dc.actions.push({
                            type: 'substitution',
                            substitutionItemId: row.substitution_item_id,
                            replacementValue: row.replacement_value
                        });
                    }
                };
                for (_b = 0, _c = dcResult.rows; _b < _c.length; _b++) {
                    row = _c[_b];
                    _loop_1(row);
                }
                decisionConditions = Array.from(dcMap.values());
                return [3 /*break*/, 11];
            case 10:
                dcError_1 = _e.sent();
                // Decision condition tables might not exist in all installations
                logger_1.logger.debug('Decision conditions query failed (optional):', dcError_1.message);
                return [3 /*break*/, 11];
            case 11: return [2 /*return*/, {
                    crf: crf,
                    version: versionResult.rows[0],
                    sections: sectionsResult.rows,
                    itemGroups: itemGroupsResult.rows,
                    items: items,
                    // LibreClinica decision conditions for forking/branching
                    decisionConditions: decisionConditions
                }];
            case 12:
                error_3 = _e.sent();
                logger_1.logger.error('Get form metadata error', { error: error_3.message });
                throw error_3;
            case 13: return [2 /*return*/];
        }
    });
}); };
exports.getFormMetadata = getFormMetadata;
/**
 * Get form status
 */
var getFormStatus = function (eventCrfId) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting form status', { eventCrfId: eventCrfId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      SELECT \n        ec.event_crf_id,\n        ec.completion_status_id,\n        cs.name as completion_status,\n        ec.date_created,\n        ec.date_updated,\n        u1.user_name as created_by,\n        u2.user_name as updated_by,\n        ec.validator_id,\n        u3.user_name as validated_by,\n        ec.date_validate,\n        ec.sdv_status\n      FROM event_crf ec\n      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id\n      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id\n      LEFT JOIN user_account u2 ON ec.update_id = u2.user_id\n      LEFT JOIN user_account u3 ON ec.validator_id = u3.user_id\n      WHERE ec.event_crf_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [eventCrfId])];
            case 2:
                result = _a.sent();
                if (result.rows.length === 0) {
                    return [2 /*return*/, null];
                }
                return [2 /*return*/, result.rows[0]];
            case 3:
                error_4 = _a.sent();
                logger_1.logger.error('Get form status error', { error: error_4.message });
                throw error_4;
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getFormStatus = getFormStatus;
/**
 * Validate form data (business rules)
 */
var validateFormData = function (formData) {
    var errors = [];
    // Basic validation (extend as needed)
    if (!formData || Object.keys(formData).length === 0) {
        errors.push('Form data is empty');
    }
    return {
        isValid: errors.length === 0,
        errors: errors
    };
};
exports.validateFormData = validateFormData;
/**
 * Get all CRFs (Form Templates) for a study
 */
var getStudyForms = function (studyId) { return __awaiter(void 0, void 0, void 0, function () {
    var columnCheck, hasCategoryColumn, query, result, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting study forms', { studyId: studyId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 5]);
                return [4 /*yield*/, database_1.pool.query("\n      SELECT column_name FROM information_schema.columns \n      WHERE table_name = 'crf' AND column_name = 'category'\n    ")];
            case 2:
                columnCheck = _a.sent();
                hasCategoryColumn = columnCheck.rows.length > 0;
                query = "\n      SELECT \n        c.crf_id,\n        c.name,\n        c.description,\n        ".concat(hasCategoryColumn ? 'c.category,' : "'other' as category,", "\n        c.oc_oid,\n        c.status_id,\n        s.name as status_name,\n        c.date_created,\n        c.date_updated,\n        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,\n        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version\n      FROM crf c\n      INNER JOIN status s ON c.status_id = s.status_id\n      WHERE c.source_study_id = $1\n      ORDER BY c.name\n    ");
                return [4 /*yield*/, database_1.pool.query(query, [studyId])];
            case 3:
                result = _a.sent();
                return [2 /*return*/, result.rows];
            case 4:
                error_5 = _a.sent();
                logger_1.logger.error('Get study forms error', { error: error_5.message });
                throw error_5;
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getStudyForms = getStudyForms;
/**
 * Get all CRFs (templates) - includes drafts and published
 * Status IDs: 1=available, 2=unavailable/locked, 5=removed
 */
var getAllForms = function () { return __awaiter(void 0, void 0, void 0, function () {
    var columnCheck, hasCategoryColumn, query, result, error_6;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting all forms');
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 5]);
                return [4 /*yield*/, database_1.pool.query("\n      SELECT column_name FROM information_schema.columns \n      WHERE table_name = 'crf' AND column_name = 'category'\n    ")];
            case 2:
                columnCheck = _a.sent();
                hasCategoryColumn = columnCheck.rows.length > 0;
                query = "\n      SELECT \n        c.crf_id,\n        c.name,\n        c.description,\n        ".concat(hasCategoryColumn ? 'c.category,' : "'other' as category,", "\n        c.oc_oid,\n        c.status_id,\n        s.name as status_name,\n        st.name as study_name,\n        st.study_id,\n        c.date_created,\n        c.date_updated,\n        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,\n        (SELECT MAX(revision_notes) FROM crf_version WHERE crf_id = c.crf_id) as latest_version\n      FROM crf c\n      INNER JOIN status s ON c.status_id = s.status_id\n      LEFT JOIN study st ON c.source_study_id = st.study_id\n      WHERE c.status_id IN (1, 2)\n      ORDER BY c.date_created DESC, c.name\n    ");
                return [4 /*yield*/, database_1.pool.query(query)];
            case 3:
                result = _a.sent();
                logger_1.logger.info('Forms retrieved', { count: result.rows.length });
                return [2 /*return*/, result.rows];
            case 4:
                error_6 = _a.sent();
                logger_1.logger.error('Get all forms error', { error: error_6.message });
                throw error_6;
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getAllForms = getAllForms;
/**
 * Get CRF by ID
 */
var getFormById = function (crfId) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting form by ID', { crfId: crfId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      SELECT \n        c.*,\n        s.name as status_name,\n        st.name as study_name,\n        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count\n      FROM crf c\n      INNER JOIN status s ON c.status_id = s.status_id\n      LEFT JOIN study st ON c.source_study_id = st.study_id\n      WHERE c.crf_id = $1\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [crfId])];
            case 2:
                result = _a.sent();
                if (result.rows.length === 0) {
                    return [2 /*return*/, null];
                }
                return [2 /*return*/, result.rows[0]];
            case 3:
                error_7 = _a.sent();
                logger_1.logger.error('Get form by ID error', { error: error_7.message });
                throw error_7;
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getFormById = getFormById;
/**
 * Map frontend field type to LibreClinica item_data_type_id
 */
var mapFieldTypeToDataType = function (fieldType) {
    var typeMap = {
        'text': 5, // ST - Character String
        'textarea': 5, // ST - Character String
        'email': 5, // ST - Character String
        'phone': 5, // ST - Character String
        'number': 6, // INT - Integer
        'integer': 6, // INT - Integer
        'decimal': 7, // REAL - Floating
        'float': 7, // REAL - Floating
        'date': 9, // DATE
        'pdate': 10, // PDATE - Partial date
        'checkbox': 1, // BL - Boolean
        'radio': 5, // ST - stored as string
        'select': 5, // ST - stored as string
        'file': 11, // FILE
        'table': 5 // ST - Table data stored as JSON string
    };
    return typeMap[fieldType === null || fieldType === void 0 ? void 0 : fieldType.toLowerCase()] || 5; // Default to ST (string)
};
/**
 * Serialize extended field properties to JSON for storage
 */
var serializeExtendedProperties = function (field) {
    var extended = {
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
        readonly: field.readonly || field.isReadonly,
        // Table field properties
        tableColumns: field.tableColumns,
        tableSettings: field.tableSettings
    };
    // Remove undefined values
    Object.keys(extended).forEach(function (key) {
        if (extended[key] === undefined) {
            delete extended[key];
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
var mapFieldTypeToResponseType = function (fieldType) {
    var typeMap = {
        // Basic types (1-7)
        'text': 1,
        'textarea': 2,
        'checkbox': 3,
        'file': 4,
        'image': 4, // images also use file response type
        'radio': 5,
        'select': 6,
        'dropdown': 6,
        'multiselect': 7,
        'multi-select': 7,
        // Calculated types (8-9)
        'calculation': 8,
        'calculated': 8,
        'bmi': 8, // BMI is a calculated field
        'bsa': 8, // Body Surface Area
        'egfr': 8, // eGFR calculation
        'age': 8, // Age calculation
        'group_calculation': 9,
        'group-calculation': 9,
        'sum': 9, // Sum across repeating group
        'average': 9, // Average across group
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
        'yesno': 5, // Yes/No uses radio type
        // Table type - uses a special response type for repeating/grid data
        'table': 11 // Table field (repeating group with structure)
    };
    return typeMap[fieldType === null || fieldType === void 0 ? void 0 : fieldType.toLowerCase()] || 1;
};
/**
 * Map LibreClinica response_type name back to field type
 * Used when loading form metadata to determine the frontend field type
 */
var mapResponseTypeToFieldType = function (responseType) {
    if (!responseType)
        return null;
    var normalizedType = responseType.toLowerCase();
    var typeMap = {
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
var createForm = function (data, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, timestamp, ocOid, existsCheck, statusMap, statusId, columnCheck, hasCategoryColumn, crfResult, crfId, versionOid, versionResult, crfVersionId, sectionResult, sectionId, randomSuffix, groupOid, itemGroupResult, itemGroupId, i, field, itemRandom, itemOid, dataTypeId, extendedProps, description, itemResult, itemId, responseSetId, optionsText, optionsValues, responseTypeId, responseSetResult, responseSetResult, regexpPattern, regexpErrorMsg, widthDecimal, patternRule, minRule, maxRule, min, max, minLengthRule, maxLengthRule, i, field, targetIfmResult, targetIfmId, _i, _a, condition, controlIfmResult, controlIfmId, controlItemName, auditError_1, error_8;
    var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    return __generator(this, function (_p) {
        switch (_p.label) {
            case 0:
                logger_1.logger.info('Creating form template', { name: data.name, userId: userId, fieldCount: ((_b = data.fields) === null || _b === void 0 ? void 0 : _b.length) || 0, status: data.status });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _p.sent();
                _p.label = 2;
            case 2:
                _p.trys.push([2, 39, 41, 42]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _p.sent();
                timestamp = Date.now().toString().slice(-6);
                ocOid = "F_".concat(data.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24), "_").concat(timestamp);
                return [4 /*yield*/, client.query("SELECT crf_id FROM crf WHERE oc_oid = $1", [ocOid])];
            case 4:
                existsCheck = _p.sent();
                if (!(existsCheck.rows.length > 0)) return [3 /*break*/, 6];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 5:
                _p.sent();
                return [2 /*return*/, {
                        success: false,
                        message: 'A form with this name already exists'
                    }];
            case 6:
                statusMap = {
                    'published': 1,
                    'draft': 2,
                    'archived': 5
                };
                statusId = data.status ? (statusMap[data.status] || 2) : 2;
                return [4 /*yield*/, client.query("\n      SELECT column_name FROM information_schema.columns \n      WHERE table_name = 'crf' AND column_name = 'category'\n    ")];
            case 7:
                columnCheck = _p.sent();
                hasCategoryColumn = columnCheck.rows.length > 0;
                crfResult = void 0;
                if (!hasCategoryColumn) return [3 /*break*/, 9];
                return [4 /*yield*/, client.query("\n        INSERT INTO crf (\n          name, description, category, status_id, owner_id, date_created, oc_oid, source_study_id\n        ) VALUES (\n          $1, $2, $3, $4, $5, NOW(), $6, $7\n        )\n        RETURNING crf_id\n      ", [
                        data.name,
                        data.description || '',
                        data.category || 'other',
                        statusId,
                        userId,
                        ocOid,
                        data.studyId || null
                    ])];
            case 8:
                crfResult = _p.sent();
                return [3 /*break*/, 11];
            case 9: return [4 /*yield*/, client.query("\n        INSERT INTO crf (\n          name, description, status_id, owner_id, date_created, oc_oid, source_study_id\n        ) VALUES (\n          $1, $2, $3, $4, NOW(), $5, $6\n        )\n        RETURNING crf_id\n      ", [
                    data.name,
                    data.description || '',
                    statusId,
                    userId,
                    ocOid,
                    data.studyId || null
                ])];
            case 10:
                crfResult = _p.sent();
                _p.label = 11;
            case 11:
                crfId = crfResult.rows[0].crf_id;
                versionOid = "".concat(ocOid, "_V1");
                return [4 /*yield*/, client.query("\n      INSERT INTO crf_version (\n        crf_id, name, description, status_id, owner_id, date_created, oc_oid\n      ) VALUES (\n        $1, $2, $3, $4, $5, NOW(), $6\n      )\n      RETURNING crf_version_id\n    ", [
                        crfId,
                        data.version || 'v1.0',
                        data.description || 'Initial version',
                        statusId,
                        userId,
                        versionOid
                    ])];
            case 12:
                versionResult = _p.sent();
                crfVersionId = versionResult.rows[0].crf_version_id;
                if (!(data.fields && data.fields.length > 0)) return [3 /*break*/, 33];
                return [4 /*yield*/, client.query("\n        INSERT INTO section (\n          crf_version_id, status_id, label, title, ordinal, owner_id, date_created\n        ) VALUES (\n          $1, 1, $2, $3, 1, $4, NOW()\n        )\n        RETURNING section_id\n      ", [
                        crfVersionId,
                        data.category || 'Form Fields',
                        data.name,
                        userId
                    ])];
            case 13:
                sectionResult = _p.sent();
                sectionId = sectionResult.rows[0].section_id;
                randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
                groupOid = "IG_".concat(ocOid.substring(2, 16), "_").concat(randomSuffix);
                return [4 /*yield*/, client.query("\n        INSERT INTO item_group (\n          name, crf_id, status_id, owner_id, date_created, oc_oid\n        ) VALUES (\n          $1, $2, 1, $3, NOW(), $4\n        )\n        RETURNING item_group_id\n      ", [
                        data.category || 'Form Fields',
                        crfId,
                        userId,
                        groupOid
                    ])];
            case 14:
                itemGroupResult = _p.sent();
                itemGroupId = itemGroupResult.rows[0].item_group_id;
                i = 0;
                _p.label = 15;
            case 15:
                if (!(i < data.fields.length)) return [3 /*break*/, 24];
                field = data.fields[i];
                itemRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
                itemOid = "I_".concat(ocOid.substring(2, 12), "_").concat(i, "_").concat(itemRandom);
                dataTypeId = mapFieldTypeToDataType(field.type);
                extendedProps = serializeExtendedProperties(field);
                description = field.helpText || field.description || '';
                if (extendedProps) {
                    // Store extended props as JSON at end of description, marked with special delimiter
                    description = description ? "".concat(description, "\n---EXTENDED_PROPS---\n").concat(extendedProps) : "---EXTENDED_PROPS---\n".concat(extendedProps);
                }
                return [4 /*yield*/, client.query("\n          INSERT INTO item (\n            name, description, units, phi_status, item_data_type_id, \n            status_id, owner_id, date_created, oc_oid\n          ) VALUES (\n            $1, $2, $3, $4, $5, 1, $6, NOW(), $7\n          )\n          RETURNING item_id\n        ", [
                        field.label || field.name || "Field ".concat(i + 1),
                        description,
                        field.unit || '', // Clinical units
                        field.isPhiField || false, // PHI status
                        dataTypeId,
                        userId,
                        itemOid
                    ])];
            case 16:
                itemResult = _p.sent();
                itemId = itemResult.rows[0].item_id;
                // Link item to item_group via item_group_metadata
                return [4 /*yield*/, client.query("\n          INSERT INTO item_group_metadata (\n            item_group_id, crf_version_id, item_id, ordinal, \n            show_group, repeating_group\n          ) VALUES (\n            $1, $2, $3, $4, true, false\n          )\n        ", [
                        itemGroupId,
                        crfVersionId,
                        itemId,
                        field.order || (i + 1)
                    ])];
            case 17:
                // Link item to item_group via item_group_metadata
                _p.sent();
                responseSetId = 1;
                if (!(field.options && field.options.length > 0)) return [3 /*break*/, 19];
                optionsText = field.options.map(function (o) { return o.label; }).join(',');
                optionsValues = field.options.map(function (o) { return o.value; }).join(',');
                responseTypeId = mapFieldTypeToResponseType(field.type);
                return [4 /*yield*/, client.query("\n            INSERT INTO response_set (\n              response_type_id, label, options_text, options_values, version_id\n            ) VALUES (\n              $1, $2, $3, $4, $5\n            )\n            RETURNING response_set_id\n          ", [
                        responseTypeId,
                        field.label,
                        optionsText,
                        optionsValues,
                        crfVersionId
                    ])];
            case 18:
                responseSetResult = _p.sent();
                responseSetId = responseSetResult.rows[0].response_set_id;
                return [3 /*break*/, 21];
            case 19: return [4 /*yield*/, client.query("\n            INSERT INTO response_set (\n              response_type_id, label, version_id\n            ) VALUES (\n              $1, $2, $3\n            )\n            RETURNING response_set_id\n          ", [
                    mapFieldTypeToResponseType(field.type),
                    field.label,
                    crfVersionId
                ])];
            case 20:
                responseSetResult = _p.sent();
                responseSetId = responseSetResult.rows[0].response_set_id;
                _p.label = 21;
            case 21:
                regexpPattern = null;
                regexpErrorMsg = null;
                widthDecimal = null;
                if (field.validationRules && field.validationRules.length > 0) {
                    patternRule = field.validationRules.find(function (r) { return r.type === 'pattern'; });
                    if (patternRule) {
                        regexpPattern = patternRule.value;
                        regexpErrorMsg = patternRule.message || 'Invalid format';
                    }
                    minRule = field.validationRules.find(function (r) { return r.type === 'min'; });
                    maxRule = field.validationRules.find(function (r) { return r.type === 'max'; });
                    if ((minRule || maxRule) && !regexpPattern) {
                        min = (_c = minRule === null || minRule === void 0 ? void 0 : minRule.value) !== null && _c !== void 0 ? _c : '';
                        max = (_d = maxRule === null || maxRule === void 0 ? void 0 : maxRule.value) !== null && _d !== void 0 ? _d : '';
                        if (field.type === 'number' || field.type === 'integer') {
                            // Store as width_decimal format: "min,max" or similar
                            widthDecimal = "".concat(min, ",").concat(max);
                        }
                    }
                    minLengthRule = field.validationRules.find(function (r) { return r.type === 'minLength'; });
                    maxLengthRule = field.validationRules.find(function (r) { return r.type === 'maxLength'; });
                    if (maxLengthRule && !widthDecimal) {
                        widthDecimal = (_e = maxLengthRule.value) === null || _e === void 0 ? void 0 : _e.toString();
                    }
                }
                // Also use field.min/max if defined directly
                if (!widthDecimal && (field.min !== undefined || field.max !== undefined)) {
                    widthDecimal = "".concat((_f = field.min) !== null && _f !== void 0 ? _f : '', ",").concat((_g = field.max) !== null && _g !== void 0 ? _g : '');
                }
                // Create item_form_metadata with all field properties
                return [4 /*yield*/, client.query("\n          INSERT INTO item_form_metadata (\n            item_id, crf_version_id, section_id, response_set_id, ordinal,\n            left_item_text, required, default_value, regexp, regexp_error_msg, \n            show_item, width_decimal, column_number\n          ) VALUES (\n            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13\n          )\n        ", [
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
                        field.columnPosition || field.columnNumber || 1 // column_number for multi-column layout
                    ])];
            case 22:
                // Create item_form_metadata with all field properties
                _p.sent();
                logger_1.logger.debug('Created form field with metadata', {
                    itemId: itemId,
                    label: field.label,
                    type: field.type,
                    required: field.required,
                    columnNumber: field.columnPosition || field.columnNumber || 1,
                    hasOptions: ((_h = field.options) === null || _h === void 0 ? void 0 : _h.length) || 0,
                    hasValidation: ((_j = field.validationRules) === null || _j === void 0 ? void 0 : _j.length) || 0
                });
                _p.label = 23;
            case 23:
                i++;
                return [3 /*break*/, 15];
            case 24:
                i = 0;
                _p.label = 25;
            case 25:
                if (!(i < data.fields.length)) return [3 /*break*/, 32];
                field = data.fields[i];
                if (!(field.showWhen && Array.isArray(field.showWhen) && field.showWhen.length > 0)) return [3 /*break*/, 31];
                return [4 /*yield*/, client.query("\n            SELECT ifm.item_form_metadata_id\n            FROM item_form_metadata ifm\n            INNER JOIN item i ON ifm.item_id = i.item_id\n            WHERE ifm.crf_version_id = $1 AND i.name = $2\n            LIMIT 1\n          ", [crfVersionId, field.label || field.name])];
            case 26:
                targetIfmResult = _p.sent();
                if (!(targetIfmResult.rows.length > 0)) return [3 /*break*/, 31];
                targetIfmId = targetIfmResult.rows[0].item_form_metadata_id;
                _i = 0, _a = field.showWhen;
                _p.label = 27;
            case 27:
                if (!(_i < _a.length)) return [3 /*break*/, 31];
                condition = _a[_i];
                return [4 /*yield*/, client.query("\n                SELECT ifm.item_form_metadata_id, i.name\n                FROM item_form_metadata ifm\n                INNER JOIN item i ON ifm.item_id = i.item_id\n                WHERE ifm.crf_version_id = $1 AND i.name = $2\n                LIMIT 1\n              ", [crfVersionId, condition.fieldId])];
            case 28:
                controlIfmResult = _p.sent();
                controlIfmId = ((_k = controlIfmResult.rows[0]) === null || _k === void 0 ? void 0 : _k.item_form_metadata_id) || null;
                controlItemName = condition.fieldId || '';
                // Insert into scd_item_metadata (LibreClinica skip logic table)
                return [4 /*yield*/, client.query("\n                INSERT INTO scd_item_metadata (\n                  scd_item_form_metadata_id, \n                  control_item_form_metadata_id, \n                  control_item_name, \n                  option_value, \n                  message, \n                  version\n                ) VALUES ($1, $2, $3, $4, $5, 1)\n              ", [
                        targetIfmId,
                        controlIfmId,
                        controlItemName,
                        condition.value || '',
                        condition.message || ''
                    ])];
            case 29:
                // Insert into scd_item_metadata (LibreClinica skip logic table)
                _p.sent();
                logger_1.logger.debug('Created SCD skip logic', {
                    targetField: field.label,
                    controlField: condition.fieldId,
                    triggerValue: condition.value
                });
                _p.label = 30;
            case 30:
                _i++;
                return [3 /*break*/, 27];
            case 31:
                i++;
                return [3 /*break*/, 25];
            case 32:
                logger_1.logger.info('Created form fields with full metadata', {
                    crfId: crfId,
                    fieldCount: data.fields.length
                });
                _p.label = 33;
            case 33: return [4 /*yield*/, client.query('COMMIT')];
            case 34:
                _p.sent();
                logger_1.logger.info('Form template created successfully', {
                    crfId: crfId,
                    name: data.name,
                    fieldCount: ((_l = data.fields) === null || _l === void 0 ? void 0 : _l.length) || 0
                });
                _p.label = 35;
            case 35:
                _p.trys.push([35, 37, , 38]);
                return [4 /*yield*/, (0, audit_service_1.trackUserAction)({
                        userId: userId,
                        username: '', // Will be populated from user context
                        action: 'FORM_CREATED',
                        entityType: 'crf',
                        entityId: crfId,
                        entityName: data.name,
                        details: "Created form template \"".concat(data.name, "\" with ").concat(((_m = data.fields) === null || _m === void 0 ? void 0 : _m.length) || 0, " fields")
                    })];
            case 36:
                _p.sent();
                return [3 /*break*/, 38];
            case 37:
                auditError_1 = _p.sent();
                logger_1.logger.warn('Failed to record form creation audit', { error: auditError_1.message });
                return [3 /*break*/, 38];
            case 38: return [2 /*return*/, {
                    success: true,
                    crfId: crfId,
                    message: "Form template created successfully with ".concat(((_o = data.fields) === null || _o === void 0 ? void 0 : _o.length) || 0, " fields")
                }];
            case 39:
                error_8 = _p.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 40:
                _p.sent();
                logger_1.logger.error('Create form error', { error: error_8.message });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to create form: ".concat(error_8.message)
                    }];
            case 41:
                client.release();
                return [7 /*endfinally*/];
            case 42: return [2 /*return*/];
        }
    });
}); };
exports.createForm = createForm;
/**
 * Update a form template with fields
 */
var updateForm = function (crfId, data, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, updates, params, paramIndex, statusMap, statusId, columnCheck, query, versionResult, crfVersionId, sectionResult, sectionId, newSectionResult, itemGroupResult, itemGroupId, crfOidResult_1, crfOid, randomSuffix, groupOid, newGroupResult, existingItemsResult, existingItems, crfOidResult, ocOid, i, field, fieldName, existingItem, extendedProps, description, dataTypeId, itemId, itemRandom, itemOid, newItemResult, responseSetId, responseTypeId, existingRsResult, optionsText, optionsValues, optionsText, optionsValues, rsResult, rsResult, regexpPattern, regexpErrorMsg, widthDecimal, patternRule, minRule, maxRule, existingMetaResult, _i, existingItems_1, _a, name_1, item, auditError_2, error_9;
    var _b, _c, _d, _e, _f, _g, _h;
    return __generator(this, function (_j) {
        switch (_j.label) {
            case 0:
                logger_1.logger.info('Updating form template', { crfId: crfId, data: __assign(__assign({}, data), { fields: ((_b = data.fields) === null || _b === void 0 ? void 0 : _b.length) || 0 }), userId: userId });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _j.sent();
                _j.label = 2;
            case 2:
                _j.trys.push([2, 50, 52, 53]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _j.sent();
                updates = [];
                params = [];
                paramIndex = 1;
                if (data.name) {
                    updates.push("name = $".concat(paramIndex++));
                    params.push(data.name);
                }
                if (data.description !== undefined) {
                    updates.push("description = $".concat(paramIndex++));
                    params.push(data.description);
                }
                // Handle status changes - map frontend status to LibreClinica status_id
                if (data.status) {
                    statusMap = {
                        'published': 1, // available
                        'draft': 2, // unavailable
                        'archived': 5 // removed
                    };
                    statusId = statusMap[data.status];
                    if (statusId) {
                        updates.push("status_id = $".concat(paramIndex++));
                        params.push(statusId);
                        logger_1.logger.info('Updating form status', { crfId: crfId, status: data.status, statusId: statusId });
                    }
                }
                if (!(data.category !== undefined)) return [3 /*break*/, 5];
                return [4 /*yield*/, client.query("\n        SELECT column_name FROM information_schema.columns \n        WHERE table_name = 'crf' AND column_name = 'category'\n      ")];
            case 4:
                columnCheck = _j.sent();
                if (columnCheck.rows.length > 0) {
                    updates.push("category = $".concat(paramIndex++));
                    params.push(data.category || 'other');
                    logger_1.logger.info('Updating form category', { crfId: crfId, category: data.category });
                }
                else {
                    logger_1.logger.info('Skipping category update - column does not exist', { crfId: crfId });
                }
                _j.label = 5;
            case 5:
                updates.push("date_updated = NOW()");
                updates.push("update_id = $".concat(paramIndex++));
                params.push(userId);
                params.push(crfId);
                if (!(updates.length > 2)) return [3 /*break*/, 7];
                query = "\n        UPDATE crf\n        SET ".concat(updates.join(', '), "\n        WHERE crf_id = $").concat(paramIndex, "\n      ");
                return [4 /*yield*/, client.query(query, params)];
            case 6:
                _j.sent();
                _j.label = 7;
            case 7:
                if (!(data.fields && data.fields.length > 0)) return [3 /*break*/, 44];
                logger_1.logger.info('Updating form fields', { crfId: crfId, fieldCount: data.fields.length });
                return [4 /*yield*/, client.query("\n        SELECT crf_version_id FROM crf_version\n        WHERE crf_id = $1\n        ORDER BY crf_version_id DESC\n        LIMIT 1\n      ", [crfId])];
            case 8:
                versionResult = _j.sent();
                if (versionResult.rows.length === 0) {
                    throw new Error('No version found for this form');
                }
                crfVersionId = versionResult.rows[0].crf_version_id;
                return [4 /*yield*/, client.query("\n        SELECT section_id FROM section\n        WHERE crf_version_id = $1\n        ORDER BY ordinal\n        LIMIT 1\n      ", [crfVersionId])];
            case 9:
                sectionResult = _j.sent();
                sectionId = void 0;
                if (!(sectionResult.rows.length === 0)) return [3 /*break*/, 11];
                return [4 /*yield*/, client.query("\n          INSERT INTO section (\n            crf_version_id, status_id, label, title, ordinal, owner_id, date_created\n          ) VALUES (\n            $1, 1, $2, $3, 1, $4, NOW()\n          )\n          RETURNING section_id\n        ", [crfVersionId, data.category || 'Form Fields', data.name || 'Form', userId])];
            case 10:
                newSectionResult = _j.sent();
                sectionId = newSectionResult.rows[0].section_id;
                return [3 /*break*/, 12];
            case 11:
                sectionId = sectionResult.rows[0].section_id;
                _j.label = 12;
            case 12: return [4 /*yield*/, client.query("\n        SELECT ig.item_group_id FROM item_group ig\n        INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id\n        WHERE igm.crf_version_id = $1\n        LIMIT 1\n      ", [crfVersionId])];
            case 13:
                itemGroupResult = _j.sent();
                itemGroupId = void 0;
                if (!(itemGroupResult.rows.length === 0)) return [3 /*break*/, 16];
                return [4 /*yield*/, client.query("SELECT oc_oid FROM crf WHERE crf_id = $1", [crfId])];
            case 14:
                crfOidResult_1 = _j.sent();
                crfOid = ((_c = crfOidResult_1.rows[0]) === null || _c === void 0 ? void 0 : _c.oc_oid) || "CRF_".concat(crfId);
                randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
                groupOid = "IG_".concat(crfOid.substring(2, 16), "_").concat(randomSuffix);
                return [4 /*yield*/, client.query("\n          INSERT INTO item_group (\n            name, crf_id, status_id, owner_id, date_created, oc_oid\n          ) VALUES (\n            $1, $2, 1, $3, NOW(), $4\n          )\n          RETURNING item_group_id\n        ", [data.category || 'Form Fields', crfId, userId, groupOid])];
            case 15:
                newGroupResult = _j.sent();
                itemGroupId = newGroupResult.rows[0].item_group_id;
                return [3 /*break*/, 17];
            case 16:
                itemGroupId = itemGroupResult.rows[0].item_group_id;
                _j.label = 17;
            case 17: return [4 /*yield*/, client.query("\n        SELECT i.item_id, i.name, i.oc_oid\n        FROM item i\n        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id\n        WHERE igm.crf_version_id = $1\n      ", [crfVersionId])];
            case 18:
                existingItemsResult = _j.sent();
                existingItems = new Map(existingItemsResult.rows.map(function (row) { return [row.name, row]; }));
                return [4 /*yield*/, client.query("SELECT oc_oid FROM crf WHERE crf_id = $1", [crfId])];
            case 19:
                crfOidResult = _j.sent();
                ocOid = ((_d = crfOidResult.rows[0]) === null || _d === void 0 ? void 0 : _d.oc_oid) || "CRF_".concat(crfId);
                i = 0;
                _j.label = 20;
            case 20:
                if (!(i < data.fields.length)) return [3 /*break*/, 39];
                field = data.fields[i];
                fieldName = field.label || field.name || "Field ".concat(i + 1);
                existingItem = existingItems.get(fieldName);
                extendedProps = serializeExtendedProperties(field);
                description = field.helpText || field.description || '';
                if (extendedProps) {
                    description = description ? "".concat(description, "\n---EXTENDED_PROPS---\n").concat(extendedProps) : "---EXTENDED_PROPS---\n".concat(extendedProps);
                }
                dataTypeId = mapFieldTypeToDataType(field.type);
                itemId = void 0;
                if (!existingItem) return [3 /*break*/, 22];
                // Update existing item
                return [4 /*yield*/, client.query("\n            UPDATE item\n            SET description = $1, units = $2, phi_status = $3, item_data_type_id = $4, date_updated = NOW()\n            WHERE item_id = $5\n          ", [description, field.unit || '', field.isPhiField || false, dataTypeId, existingItem.item_id])];
            case 21:
                // Update existing item
                _j.sent();
                itemId = existingItem.item_id;
                existingItems.delete(fieldName); // Mark as processed
                return [3 /*break*/, 25];
            case 22:
                itemRandom = Math.random().toString(36).substring(2, 6).toUpperCase();
                itemOid = "I_".concat(ocOid.substring(2, 12), "_").concat(i, "_").concat(itemRandom);
                return [4 /*yield*/, client.query("\n            INSERT INTO item (\n              name, description, units, phi_status, item_data_type_id,\n              status_id, owner_id, date_created, oc_oid\n            ) VALUES (\n              $1, $2, $3, $4, $5, 1, $6, NOW(), $7\n            )\n            RETURNING item_id\n          ", [fieldName, description, field.unit || '', field.isPhiField || false, dataTypeId, userId, itemOid])];
            case 23:
                newItemResult = _j.sent();
                itemId = newItemResult.rows[0].item_id;
                // Link to item group
                return [4 /*yield*/, client.query("\n            INSERT INTO item_group_metadata (\n              item_group_id, crf_version_id, item_id, ordinal, show_group, repeating_group\n            ) VALUES (\n              $1, $2, $3, $4, true, false\n            )\n          ", [itemGroupId, crfVersionId, itemId, field.order || (i + 1)])];
            case 24:
                // Link to item group
                _j.sent();
                _j.label = 25;
            case 25:
                responseSetId = void 0;
                responseTypeId = mapFieldTypeToResponseType(field.type);
                return [4 /*yield*/, client.query("\n          SELECT response_set_id FROM item_form_metadata\n          WHERE item_id = $1 AND crf_version_id = $2\n        ", [itemId, crfVersionId])];
            case 26:
                existingRsResult = _j.sent();
                if (!(existingRsResult.rows.length > 0 && existingRsResult.rows[0].response_set_id)) return [3 /*break*/, 29];
                if (!(field.options && field.options.length > 0)) return [3 /*break*/, 28];
                optionsText = field.options.map(function (o) { return o.label; }).join(',');
                optionsValues = field.options.map(function (o) { return o.value; }).join(',');
                return [4 /*yield*/, client.query("\n              UPDATE response_set\n              SET options_text = $1, options_values = $2, response_type_id = $3\n              WHERE response_set_id = $4\n            ", [optionsText, optionsValues, responseTypeId, existingRsResult.rows[0].response_set_id])];
            case 27:
                _j.sent();
                _j.label = 28;
            case 28:
                responseSetId = existingRsResult.rows[0].response_set_id;
                return [3 /*break*/, 33];
            case 29:
                if (!(field.options && field.options.length > 0)) return [3 /*break*/, 31];
                optionsText = field.options.map(function (o) { return o.label; }).join(',');
                optionsValues = field.options.map(function (o) { return o.value; }).join(',');
                return [4 /*yield*/, client.query("\n              INSERT INTO response_set (response_type_id, label, options_text, options_values, version_id)\n              VALUES ($1, $2, $3, $4, $5)\n              RETURNING response_set_id\n            ", [responseTypeId, field.label, optionsText, optionsValues, crfVersionId])];
            case 30:
                rsResult = _j.sent();
                responseSetId = rsResult.rows[0].response_set_id;
                return [3 /*break*/, 33];
            case 31: return [4 /*yield*/, client.query("\n              INSERT INTO response_set (response_type_id, label, version_id)\n              VALUES ($1, $2, $3)\n              RETURNING response_set_id\n            ", [responseTypeId, field.label || 'Field', crfVersionId])];
            case 32:
                rsResult = _j.sent();
                responseSetId = rsResult.rows[0].response_set_id;
                _j.label = 33;
            case 33:
                regexpPattern = null;
                regexpErrorMsg = null;
                widthDecimal = null;
                if (field.validationRules && field.validationRules.length > 0) {
                    patternRule = field.validationRules.find(function (r) { return r.type === 'pattern'; });
                    if (patternRule) {
                        regexpPattern = patternRule.value;
                        regexpErrorMsg = patternRule.message || 'Invalid format';
                    }
                    minRule = field.validationRules.find(function (r) { return r.type === 'min'; });
                    maxRule = field.validationRules.find(function (r) { return r.type === 'max'; });
                    if (minRule || maxRule) {
                        widthDecimal = "".concat((_e = minRule === null || minRule === void 0 ? void 0 : minRule.value) !== null && _e !== void 0 ? _e : '', ",").concat((_f = maxRule === null || maxRule === void 0 ? void 0 : maxRule.value) !== null && _f !== void 0 ? _f : '');
                    }
                }
                if (!widthDecimal && (field.min !== undefined || field.max !== undefined)) {
                    widthDecimal = "".concat((_g = field.min) !== null && _g !== void 0 ? _g : '', ",").concat((_h = field.max) !== null && _h !== void 0 ? _h : '');
                }
                return [4 /*yield*/, client.query("\n          SELECT 1 FROM item_form_metadata WHERE item_id = $1 AND crf_version_id = $2\n        ", [itemId, crfVersionId])];
            case 34:
                existingMetaResult = _j.sent();
                if (!(existingMetaResult.rows.length > 0)) return [3 /*break*/, 36];
                return [4 /*yield*/, client.query("\n            UPDATE item_form_metadata\n            SET response_set_id = $1, ordinal = $2, left_item_text = $3, required = $4,\n                default_value = $5, regexp = $6, regexp_error_msg = $7, show_item = $8, width_decimal = $9\n            WHERE item_id = $10 AND crf_version_id = $11\n          ", [
                        responseSetId, field.order || (i + 1), field.placeholder || '',
                        field.required || field.isRequired || false,
                        field.defaultValue !== undefined ? String(field.defaultValue) : null,
                        regexpPattern, regexpErrorMsg,
                        field.hidden !== true && field.isHidden !== true,
                        widthDecimal,
                        itemId, crfVersionId
                    ])];
            case 35:
                _j.sent();
                return [3 /*break*/, 38];
            case 36: return [4 /*yield*/, client.query("\n            INSERT INTO item_form_metadata (\n              item_id, crf_version_id, section_id, response_set_id, ordinal,\n              left_item_text, required, default_value, regexp, regexp_error_msg, show_item, width_decimal\n            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)\n          ", [
                    itemId, crfVersionId, sectionId, responseSetId, field.order || (i + 1),
                    field.placeholder || '', field.required || field.isRequired || false,
                    field.defaultValue !== undefined ? String(field.defaultValue) : null,
                    regexpPattern, regexpErrorMsg,
                    field.hidden !== true && field.isHidden !== true,
                    widthDecimal
                ])];
            case 37:
                _j.sent();
                _j.label = 38;
            case 38:
                i++;
                return [3 /*break*/, 20];
            case 39:
                _i = 0, existingItems_1 = existingItems;
                _j.label = 40;
            case 40:
                if (!(_i < existingItems_1.length)) return [3 /*break*/, 43];
                _a = existingItems_1[_i], name_1 = _a[0], item = _a[1];
                logger_1.logger.info('Hiding removed field', { itemId: item.item_id, name: name_1 });
                return [4 /*yield*/, client.query("\n          UPDATE item_form_metadata SET show_item = false\n          WHERE item_id = $1 AND crf_version_id = $2\n        ", [item.item_id, crfVersionId])];
            case 41:
                _j.sent();
                _j.label = 42;
            case 42:
                _i++;
                return [3 /*break*/, 40];
            case 43:
                logger_1.logger.info('Form fields updated', { crfId: crfId, fieldCount: data.fields.length });
                _j.label = 44;
            case 44: return [4 /*yield*/, client.query('COMMIT')];
            case 45:
                _j.sent();
                logger_1.logger.info('Form template updated successfully', { crfId: crfId });
                _j.label = 46;
            case 46:
                _j.trys.push([46, 48, , 49]);
                return [4 /*yield*/, (0, audit_service_1.trackUserAction)({
                        userId: userId,
                        username: '',
                        action: 'FORM_UPDATED',
                        entityType: 'crf',
                        entityId: crfId,
                        details: "Updated form template: ".concat(Object.keys(data).join(', ')).concat(data.fields ? " with ".concat(data.fields.length, " fields") : '')
                    })];
            case 47:
                _j.sent();
                return [3 /*break*/, 49];
            case 48:
                auditError_2 = _j.sent();
                logger_1.logger.warn('Failed to record form update audit', { error: auditError_2.message });
                return [3 /*break*/, 49];
            case 49: return [2 /*return*/, {
                    success: true,
                    message: "Form template updated successfully".concat(data.fields ? " with ".concat(data.fields.length, " fields") : '')
                }];
            case 50:
                error_9 = _j.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 51:
                _j.sent();
                logger_1.logger.error('Update form error', { error: error_9.message });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to update form: ".concat(error_9.message)
                    }];
            case 52:
                client.release();
                return [7 /*endfinally*/];
            case 53: return [2 /*return*/];
        }
    });
}); };
exports.updateForm = updateForm;
/**
 * Delete a form template (soft delete by changing status)
 */
var deleteForm = function (crfId, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var usageCheck, error_10;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Deleting form template', { crfId: crfId, userId: userId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 5]);
                return [4 /*yield*/, database_1.pool.query("\n      SELECT COUNT(*) as count FROM event_crf ec\n      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id\n      WHERE cv.crf_id = $1\n    ", [crfId])];
            case 2:
                usageCheck = _a.sent();
                if (parseInt(usageCheck.rows[0].count) > 0) {
                    return [2 /*return*/, {
                            success: false,
                            message: 'Cannot delete form - it is being used by subjects'
                        }];
                }
                // Set status to removed (status_id = 5 typically)
                return [4 /*yield*/, database_1.pool.query("\n      UPDATE crf\n      SET status_id = 5, date_updated = NOW(), update_id = $1\n      WHERE crf_id = $2\n    ", [userId, crfId])];
            case 3:
                // Set status to removed (status_id = 5 typically)
                _a.sent();
                logger_1.logger.info('Form template deleted successfully', { crfId: crfId });
                return [2 /*return*/, {
                        success: true,
                        message: 'Form template deleted successfully'
                    }];
            case 4:
                error_10 = _a.sent();
                logger_1.logger.error('Delete form error', { error: error_10.message });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to delete form: ".concat(error_10.message)
                    }];
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.deleteForm = deleteForm;
// =============================================================================
// TEMPLATE FORKING / VERSIONING FUNCTIONS
// =============================================================================
/**
 * Get all versions of a CRF
 * Returns version history for display
 */
var getFormVersions = function (crfId) { return __awaiter(void 0, void 0, void 0, function () {
    var result, error_11;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting form versions', { crfId: crfId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, database_1.pool.query("\n      SELECT \n        cv.crf_version_id,\n        cv.name as version_name,\n        cv.description,\n        cv.revision_notes,\n        cv.oc_oid,\n        cv.status_id,\n        s.name as status_name,\n        cv.owner_id,\n        cv.date_created,\n        cv.date_updated,\n        u.first_name || ' ' || u.last_name as created_by,\n        (SELECT COUNT(*) FROM event_crf WHERE crf_version_id = cv.crf_version_id) as usage_count\n      FROM crf_version cv\n      INNER JOIN status s ON cv.status_id = s.status_id\n      LEFT JOIN user_account u ON cv.owner_id = u.user_id\n      WHERE cv.crf_id = $1\n      ORDER BY cv.crf_version_id DESC\n    ", [crfId])];
            case 2:
                result = _a.sent();
                logger_1.logger.info('Form versions retrieved', { crfId: crfId, count: result.rows.length });
                return [2 /*return*/, {
                        success: true,
                        versions: result.rows.map(function (row) { return ({
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
                        }); })
                    }];
            case 3:
                error_11 = _a.sent();
                logger_1.logger.error('Get form versions error', { error: error_11.message, crfId: crfId });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to get form versions: ".concat(error_11.message)
                    }];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getFormVersions = getFormVersions;
/**
 * Create a new version of an existing CRF
 * - Copies all fields/items from source version
 * - Creates new crf_version record
 * - Maintains link to parent CRF
 *
 * This implements "forking" at the version level - same CRF, new version
 */
var createFormVersion = function (crfId, data, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, sourceVersionId, verifyResult, latestResult, crfResult, crfOid, versionCount, nextVersionNum, newVersionOid, newVersionResult, newVersionId, sectionMapping, sectionsResult, _i, _a, section, newSectionResult, itemGroupMapping, itemGroupsResult, _b, _c, group, newGroupOid, newGroupResult, newGroupId, itemMapping, itemsResult, _d, _e, item, newItemOid, newItemResult, newItemId, newSectionId, groupMapResult, oldGroupId, newGroupId, scdResult, auditError_3, error_12;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                logger_1.logger.info('Creating new form version', { crfId: crfId, versionName: data.versionName, userId: userId });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _f.sent();
                _f.label = 2;
            case 2:
                _f.trys.push([2, 42, 44, 45]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _f.sent();
                sourceVersionId = void 0;
                if (!data.copyFromVersionId) return [3 /*break*/, 7];
                return [4 /*yield*/, client.query("\n        SELECT crf_version_id FROM crf_version \n        WHERE crf_version_id = $1 AND crf_id = $2\n      ", [data.copyFromVersionId, crfId])];
            case 4:
                verifyResult = _f.sent();
                if (!(verifyResult.rows.length === 0)) return [3 /*break*/, 6];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 5:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'Source version not found or does not belong to this CRF' }];
            case 6:
                sourceVersionId = data.copyFromVersionId;
                return [3 /*break*/, 11];
            case 7: return [4 /*yield*/, client.query("\n        SELECT crf_version_id FROM crf_version \n        WHERE crf_id = $1 \n        ORDER BY crf_version_id DESC \n        LIMIT 1\n      ", [crfId])];
            case 8:
                latestResult = _f.sent();
                if (!(latestResult.rows.length === 0)) return [3 /*break*/, 10];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 9:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'No existing version found to copy from' }];
            case 10:
                sourceVersionId = latestResult.rows[0].crf_version_id;
                _f.label = 11;
            case 11: return [4 /*yield*/, client.query("\n      SELECT name, oc_oid FROM crf WHERE crf_id = $1\n    ", [crfId])];
            case 12:
                crfResult = _f.sent();
                if (!(crfResult.rows.length === 0)) return [3 /*break*/, 14];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 13:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'CRF not found' }];
            case 14:
                crfOid = crfResult.rows[0].oc_oid;
                return [4 /*yield*/, client.query("\n      SELECT COUNT(*) as count FROM crf_version WHERE crf_id = $1\n    ", [crfId])];
            case 15:
                versionCount = _f.sent();
                nextVersionNum = parseInt(versionCount.rows[0].count) + 1;
                newVersionOid = "".concat(crfOid, "_V").concat(nextVersionNum);
                return [4 /*yield*/, client.query("\n      INSERT INTO crf_version (\n        crf_id, name, description, revision_notes, status_id, owner_id, date_created, oc_oid\n      ) VALUES (\n        $1, $2, $3, $4, 1, $5, NOW(), $6\n      )\n      RETURNING crf_version_id\n    ", [
                        crfId,
                        data.versionName,
                        "Version ".concat(data.versionName),
                        data.revisionNotes || "Created from version ".concat(sourceVersionId),
                        userId,
                        newVersionOid
                    ])];
            case 16:
                newVersionResult = _f.sent();
                newVersionId = newVersionResult.rows[0].crf_version_id;
                logger_1.logger.info('Created new version record', { newVersionId: newVersionId, sourceVersionId: sourceVersionId });
                sectionMapping = {};
                return [4 /*yield*/, client.query("\n      SELECT section_id, label, title, instructions, subtitle, page_number_label,\n             ordinal, parent_id, borders\n      FROM section WHERE crf_version_id = $1\n    ", [sourceVersionId])];
            case 17:
                sectionsResult = _f.sent();
                _i = 0, _a = sectionsResult.rows;
                _f.label = 18;
            case 18:
                if (!(_i < _a.length)) return [3 /*break*/, 21];
                section = _a[_i];
                return [4 /*yield*/, client.query("\n        INSERT INTO section (\n          crf_version_id, status_id, label, title, instructions, subtitle,\n          page_number_label, ordinal, parent_id, borders, owner_id, date_created\n        ) VALUES (\n          $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()\n        )\n        RETURNING section_id\n      ", [
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
                    ])];
            case 19:
                newSectionResult = _f.sent();
                sectionMapping[section.section_id] = newSectionResult.rows[0].section_id;
                _f.label = 20;
            case 20:
                _i++;
                return [3 /*break*/, 18];
            case 21:
                itemGroupMapping = {};
                return [4 /*yield*/, client.query("\n      SELECT ig.item_group_id, ig.name, ig.oc_oid, \n             igm.header, igm.subheader, igm.layout, igm.repeat_number, \n             igm.repeat_max, igm.show_group, igm.ordinal, igm.borders\n      FROM item_group ig\n      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id\n      WHERE igm.crf_version_id = $1\n    ", [sourceVersionId])];
            case 22:
                itemGroupsResult = _f.sent();
                _b = 0, _c = itemGroupsResult.rows;
                _f.label = 23;
            case 23:
                if (!(_b < _c.length)) return [3 /*break*/, 27];
                group = _c[_b];
                newGroupOid = group.oc_oid ?
                    "".concat(group.oc_oid, "_V").concat(nextVersionNum) :
                    "IG_".concat(newVersionId, "_").concat(group.item_group_id);
                return [4 /*yield*/, client.query("\n        INSERT INTO item_group (\n          name, oc_oid, status_id, owner_id, date_created\n        ) VALUES (\n          $1, $2, 1, $3, NOW()\n        )\n        RETURNING item_group_id\n      ", [group.name, newGroupOid, userId])];
            case 24:
                newGroupResult = _f.sent();
                newGroupId = newGroupResult.rows[0].item_group_id;
                itemGroupMapping[group.item_group_id] = newGroupId;
                // Create item_group_metadata for new version
                return [4 /*yield*/, client.query("\n        INSERT INTO item_group_metadata (\n          item_group_id, crf_version_id, header, subheader, layout,\n          repeat_number, repeat_max, show_group, ordinal, borders\n        ) VALUES (\n          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10\n        )\n      ", [
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
                    ])];
            case 25:
                // Create item_group_metadata for new version
                _f.sent();
                _f.label = 26;
            case 26:
                _b++;
                return [3 /*break*/, 23];
            case 27:
                itemMapping = {};
                return [4 /*yield*/, client.query("\n      SELECT i.item_id, i.name, i.description, i.units, i.phi_status, \n             i.item_data_type_id, i.item_reference_type_id, i.oc_oid,\n             ifm.header, ifm.subheader, ifm.left_item_text, ifm.right_item_text,\n             ifm.parent_id, ifm.column_number, ifm.section_id, ifm.ordinal,\n             ifm.response_set_id, ifm.required, ifm.regexp, ifm.regexp_error_msg,\n             ifm.show_item, ifm.question_number_label, ifm.default_value,\n             ifm.width_decimal, ifm.response_layout\n      FROM item i\n      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id\n      WHERE ifm.crf_version_id = $1\n    ", [sourceVersionId])];
            case 28:
                itemsResult = _f.sent();
                _d = 0, _e = itemsResult.rows;
                _f.label = 29;
            case 29:
                if (!(_d < _e.length)) return [3 /*break*/, 35];
                item = _e[_d];
                newItemOid = item.oc_oid ?
                    "".concat(item.oc_oid, "_V").concat(nextVersionNum) :
                    "I_".concat(newVersionId, "_").concat(item.item_id);
                return [4 /*yield*/, client.query("\n        INSERT INTO item (\n          name, description, units, phi_status, item_data_type_id,\n          item_reference_type_id, status_id, owner_id, date_created, oc_oid\n        ) VALUES (\n          $1, $2, $3, $4, $5, $6, 1, $7, NOW(), $8\n        )\n        RETURNING item_id\n      ", [
                        item.name,
                        item.description,
                        item.units,
                        item.phi_status,
                        item.item_data_type_id,
                        item.item_reference_type_id,
                        userId,
                        newItemOid
                    ])];
            case 30:
                newItemResult = _f.sent();
                newItemId = newItemResult.rows[0].item_id;
                itemMapping[item.item_id] = newItemId;
                newSectionId = sectionMapping[item.section_id] || null;
                return [4 /*yield*/, client.query("\n        INSERT INTO item_form_metadata (\n          item_id, crf_version_id, header, subheader, left_item_text, right_item_text,\n          parent_id, column_number, section_id, ordinal, response_set_id,\n          required, regexp, regexp_error_msg, show_item, question_number_label,\n          default_value, width_decimal, response_layout\n        ) VALUES (\n          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19\n        )\n      ", [
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
                    ])];
            case 31:
                _f.sent();
                return [4 /*yield*/, client.query("\n        SELECT item_group_id FROM item_group_map\n        WHERE item_id = $1 AND crf_version_id = $2\n      ", [item.item_id, sourceVersionId])];
            case 32:
                groupMapResult = _f.sent();
                if (!(groupMapResult.rows.length > 0)) return [3 /*break*/, 34];
                oldGroupId = groupMapResult.rows[0].item_group_id;
                newGroupId = itemGroupMapping[oldGroupId];
                if (!newGroupId) return [3 /*break*/, 34];
                return [4 /*yield*/, client.query("\n            INSERT INTO item_group_map (item_group_id, item_id, crf_version_id)\n            VALUES ($1, $2, $3)\n          ", [newGroupId, newItemId, newVersionId])];
            case 33:
                _f.sent();
                _f.label = 34;
            case 34:
                _d++;
                return [3 /*break*/, 29];
            case 35: return [4 /*yield*/, client.query("\n      SELECT scd.scd_item_metadata_id, scd.scd_item_form_metadata_id, scd.control_item_form_metadata_id,\n             scd.option_value, scd.message\n      FROM scd_item_metadata scd\n      INNER JOIN item_form_metadata ifm ON scd.scd_item_form_metadata_id = ifm.item_form_metadata_id\n      WHERE ifm.crf_version_id = $1\n    ", [sourceVersionId])];
            case 36:
                scdResult = _f.sent();
                // Note: SCD copying requires mapping item_form_metadata IDs which is complex
                // For now, log that SCD rules need manual review
                if (scdResult.rows.length > 0) {
                    logger_1.logger.info('SCD rules found in source version', {
                        count: scdResult.rows.length,
                        note: 'SCD rules may need manual configuration in new version'
                    });
                }
                return [4 /*yield*/, client.query('COMMIT')];
            case 37:
                _f.sent();
                logger_1.logger.info('Form version created successfully', {
                    crfId: crfId,
                    newVersionId: newVersionId,
                    sourceVersionId: sourceVersionId,
                    sectionsCopied: Object.keys(sectionMapping).length,
                    itemsCopied: Object.keys(itemMapping).length
                });
                _f.label = 38;
            case 38:
                _f.trys.push([38, 40, , 41]);
                return [4 /*yield*/, (0, audit_service_1.trackUserAction)({
                        userId: userId,
                        username: '',
                        action: 'FORM_VERSION_CREATED',
                        entityType: 'crf_version',
                        entityId: newVersionId,
                        details: "Created version \"".concat(data.versionName, "\" from version ").concat(sourceVersionId)
                    })];
            case 39:
                _f.sent();
                return [3 /*break*/, 41];
            case 40:
                auditError_3 = _f.sent();
                logger_1.logger.warn('Failed to record version creation audit', { error: auditError_3.message });
                return [3 /*break*/, 41];
            case 41: return [2 /*return*/, {
                    success: true,
                    crfVersionId: newVersionId,
                    message: "Version \"".concat(data.versionName, "\" created successfully")
                }];
            case 42:
                error_12 = _f.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 43:
                _f.sent();
                logger_1.logger.error('Create form version error', { error: error_12.message, crfId: crfId });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to create form version: ".concat(error_12.message)
                    }];
            case 44:
                client.release();
                return [7 /*endfinally*/];
            case 45: return [2 /*return*/];
        }
    });
}); };
exports.createFormVersion = createFormVersion;
/**
 * Fork (copy) an entire CRF to create a new independent form
 * - Creates new CRF record
 * - Copies specified version (or latest)
 * - Copies all items/sections/item_groups
 * - Updates OIDs to be unique
 *
 * This implements "forking" at the CRF level - completely new CRF
 */
var forkForm = function (sourceCrfId, data, userId) { return __awaiter(void 0, void 0, void 0, function () {
    var client, sourceCrfResult, sourceCrf, timestamp, newOid, existsCheck, newCrfResult, newCrfId, sourceVersionResult, sourceVersion, sourceVersionId, newVersionOid, newVersionResult, newVersionId, sectionMapping, sectionsResult, _i, _a, section, newSectionResult, itemGroupMapping, itemGroupsResult, _b, _c, group, newGroupOid, newGroupResult, newGroupId, itemsResult, _d, _e, item, newItemOid, newItemResult, newItemId, newSectionId, groupMapResult, oldGroupId, newGroupId, auditError_4, error_13;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                logger_1.logger.info('Forking form template', { sourceCrfId: sourceCrfId, newName: data.newName, userId: userId });
                return [4 /*yield*/, database_1.pool.connect()];
            case 1:
                client = _f.sent();
                _f.label = 2;
            case 2:
                _f.trys.push([2, 39, 41, 42]);
                return [4 /*yield*/, client.query('BEGIN')];
            case 3:
                _f.sent();
                return [4 /*yield*/, client.query("\n      SELECT crf_id, name, description, oc_oid, source_study_id\n      FROM crf WHERE crf_id = $1\n    ", [sourceCrfId])];
            case 4:
                sourceCrfResult = _f.sent();
                if (!(sourceCrfResult.rows.length === 0)) return [3 /*break*/, 6];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 5:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'Source CRF not found' }];
            case 6:
                sourceCrf = sourceCrfResult.rows[0];
                timestamp = Date.now().toString().slice(-6);
                newOid = "F_".concat(data.newName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 24), "_").concat(timestamp);
                return [4 /*yield*/, client.query("SELECT crf_id FROM crf WHERE oc_oid = $1", [newOid])];
            case 7:
                existsCheck = _f.sent();
                if (!(existsCheck.rows.length > 0)) return [3 /*break*/, 9];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 8:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'A form with this name already exists' }];
            case 9: return [4 /*yield*/, client.query("\n      INSERT INTO crf (\n        name, description, status_id, owner_id, date_created, oc_oid, source_study_id\n      ) VALUES (\n        $1, $2, 1, $3, NOW(), $4, $5\n      )\n      RETURNING crf_id\n    ", [
                    data.newName,
                    data.description || "Forked from ".concat(sourceCrf.name),
                    userId,
                    newOid,
                    data.targetStudyId || sourceCrf.source_study_id
                ])];
            case 10:
                newCrfResult = _f.sent();
                newCrfId = newCrfResult.rows[0].crf_id;
                logger_1.logger.info('Created forked CRF record', { newCrfId: newCrfId, sourceCrfId: sourceCrfId });
                return [4 /*yield*/, client.query("\n      SELECT crf_version_id, name, description\n      FROM crf_version \n      WHERE crf_id = $1 \n      ORDER BY crf_version_id DESC \n      LIMIT 1\n    ", [sourceCrfId])];
            case 11:
                sourceVersionResult = _f.sent();
                if (!(sourceVersionResult.rows.length === 0)) return [3 /*break*/, 13];
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 12:
                _f.sent();
                return [2 /*return*/, { success: false, message: 'No version found in source CRF' }];
            case 13:
                sourceVersion = sourceVersionResult.rows[0];
                sourceVersionId = sourceVersion.crf_version_id;
                newVersionOid = "".concat(newOid, "_V1");
                return [4 /*yield*/, client.query("\n      INSERT INTO crf_version (\n        crf_id, name, description, revision_notes, status_id, owner_id, date_created, oc_oid\n      ) VALUES (\n        $1, 'v1.0', $2, $3, 1, $4, NOW(), $5\n      )\n      RETURNING crf_version_id\n    ", [
                        newCrfId,
                        "Initial version (forked from ".concat(sourceCrf.name, ")"),
                        "Forked from CRF ID ".concat(sourceCrfId, ", version ").concat(sourceVersion.name),
                        userId,
                        newVersionOid
                    ])];
            case 14:
                newVersionResult = _f.sent();
                newVersionId = newVersionResult.rows[0].crf_version_id;
                sectionMapping = {};
                return [4 /*yield*/, client.query("\n      SELECT section_id, label, title, instructions, subtitle, page_number_label,\n             ordinal, parent_id, borders\n      FROM section WHERE crf_version_id = $1\n    ", [sourceVersionId])];
            case 15:
                sectionsResult = _f.sent();
                _i = 0, _a = sectionsResult.rows;
                _f.label = 16;
            case 16:
                if (!(_i < _a.length)) return [3 /*break*/, 19];
                section = _a[_i];
                return [4 /*yield*/, client.query("\n        INSERT INTO section (\n          crf_version_id, status_id, label, title, instructions, subtitle,\n          page_number_label, ordinal, parent_id, borders, owner_id, date_created\n        ) VALUES (\n          $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()\n        )\n        RETURNING section_id\n      ", [
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
                    ])];
            case 17:
                newSectionResult = _f.sent();
                sectionMapping[section.section_id] = newSectionResult.rows[0].section_id;
                _f.label = 18;
            case 18:
                _i++;
                return [3 /*break*/, 16];
            case 19:
                itemGroupMapping = {};
                return [4 /*yield*/, client.query("\n      SELECT ig.item_group_id, ig.name, ig.oc_oid,\n             igm.header, igm.subheader, igm.layout, igm.repeat_number,\n             igm.repeat_max, igm.show_group, igm.ordinal, igm.borders\n      FROM item_group ig\n      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id\n      WHERE igm.crf_version_id = $1\n    ", [sourceVersionId])];
            case 20:
                itemGroupsResult = _f.sent();
                _b = 0, _c = itemGroupsResult.rows;
                _f.label = 21;
            case 21:
                if (!(_b < _c.length)) return [3 /*break*/, 25];
                group = _c[_b];
                newGroupOid = "IG_".concat(newCrfId, "_").concat(Date.now().toString().slice(-4), "_").concat(group.item_group_id);
                return [4 /*yield*/, client.query("\n        INSERT INTO item_group (name, oc_oid, status_id, owner_id, date_created)\n        VALUES ($1, $2, 1, $3, NOW())\n        RETURNING item_group_id\n      ", [group.name, newGroupOid, userId])];
            case 22:
                newGroupResult = _f.sent();
                newGroupId = newGroupResult.rows[0].item_group_id;
                itemGroupMapping[group.item_group_id] = newGroupId;
                return [4 /*yield*/, client.query("\n        INSERT INTO item_group_metadata (\n          item_group_id, crf_version_id, header, subheader, layout,\n          repeat_number, repeat_max, show_group, ordinal, borders\n        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)\n      ", [
                        newGroupId, newVersionId, group.header, group.subheader, group.layout,
                        group.repeat_number, group.repeat_max, group.show_group, group.ordinal, group.borders
                    ])];
            case 23:
                _f.sent();
                _f.label = 24;
            case 24:
                _b++;
                return [3 /*break*/, 21];
            case 25: return [4 /*yield*/, client.query("\n      SELECT i.item_id, i.name, i.description, i.units, i.phi_status,\n             i.item_data_type_id, i.item_reference_type_id, i.oc_oid,\n             ifm.header, ifm.subheader, ifm.left_item_text, ifm.right_item_text,\n             ifm.parent_id, ifm.column_number, ifm.section_id, ifm.ordinal,\n             ifm.response_set_id, ifm.required, ifm.regexp, ifm.regexp_error_msg,\n             ifm.show_item, ifm.question_number_label, ifm.default_value,\n             ifm.width_decimal, ifm.response_layout\n      FROM item i\n      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id\n      WHERE ifm.crf_version_id = $1\n    ", [sourceVersionId])];
            case 26:
                itemsResult = _f.sent();
                _d = 0, _e = itemsResult.rows;
                _f.label = 27;
            case 27:
                if (!(_d < _e.length)) return [3 /*break*/, 33];
                item = _e[_d];
                newItemOid = "I_".concat(newCrfId, "_").concat(Date.now().toString().slice(-4), "_").concat(item.item_id);
                return [4 /*yield*/, client.query("\n        INSERT INTO item (\n          name, description, units, phi_status, item_data_type_id,\n          item_reference_type_id, status_id, owner_id, date_created, oc_oid\n        ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), $8)\n        RETURNING item_id\n      ", [
                        item.name, item.description, item.units, item.phi_status,
                        item.item_data_type_id, item.item_reference_type_id, userId, newItemOid
                    ])];
            case 28:
                newItemResult = _f.sent();
                newItemId = newItemResult.rows[0].item_id;
                newSectionId = sectionMapping[item.section_id] || null;
                return [4 /*yield*/, client.query("\n        INSERT INTO item_form_metadata (\n          item_id, crf_version_id, header, subheader, left_item_text, right_item_text,\n          parent_id, column_number, section_id, ordinal, response_set_id,\n          required, regexp, regexp_error_msg, show_item, question_number_label,\n          default_value, width_decimal, response_layout\n        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)\n      ", [
                        newItemId, newVersionId, item.header, item.subheader, item.left_item_text,
                        item.right_item_text, null, item.column_number, newSectionId, item.ordinal,
                        item.response_set_id, item.required, item.regexp, item.regexp_error_msg,
                        item.show_item, item.question_number_label, item.default_value,
                        item.width_decimal, item.response_layout
                    ])];
            case 29:
                _f.sent();
                return [4 /*yield*/, client.query("\n        SELECT item_group_id FROM item_group_map WHERE item_id = $1 AND crf_version_id = $2\n      ", [item.item_id, sourceVersionId])];
            case 30:
                groupMapResult = _f.sent();
                if (!(groupMapResult.rows.length > 0)) return [3 /*break*/, 32];
                oldGroupId = groupMapResult.rows[0].item_group_id;
                newGroupId = itemGroupMapping[oldGroupId];
                if (!newGroupId) return [3 /*break*/, 32];
                return [4 /*yield*/, client.query("\n            INSERT INTO item_group_map (item_group_id, item_id, crf_version_id)\n            VALUES ($1, $2, $3)\n          ", [newGroupId, newItemId, newVersionId])];
            case 31:
                _f.sent();
                _f.label = 32;
            case 32:
                _d++;
                return [3 /*break*/, 27];
            case 33: return [4 /*yield*/, client.query('COMMIT')];
            case 34:
                _f.sent();
                logger_1.logger.info('Form forked successfully', {
                    sourceCrfId: sourceCrfId,
                    newCrfId: newCrfId,
                    newVersionId: newVersionId,
                    sectionsCopied: Object.keys(sectionMapping).length,
                    itemsCopied: itemsResult.rows.length
                });
                _f.label = 35;
            case 35:
                _f.trys.push([35, 37, , 38]);
                return [4 /*yield*/, (0, audit_service_1.trackUserAction)({
                        userId: userId,
                        username: '',
                        action: 'FORM_FORKED',
                        entityType: 'crf',
                        entityId: newCrfId,
                        details: "Forked from CRF \"".concat(sourceCrf.name, "\" (ID: ").concat(sourceCrfId, ") as \"").concat(data.newName, "\"")
                    })];
            case 36:
                _f.sent();
                return [3 /*break*/, 38];
            case 37:
                auditError_4 = _f.sent();
                logger_1.logger.warn('Failed to record fork audit', { error: auditError_4.message });
                return [3 /*break*/, 38];
            case 38: return [2 /*return*/, {
                    success: true,
                    newCrfId: newCrfId,
                    message: "Form \"".concat(data.newName, "\" forked successfully")
                }];
            case 39:
                error_13 = _f.sent();
                return [4 /*yield*/, client.query('ROLLBACK')];
            case 40:
                _f.sent();
                logger_1.logger.error('Fork form error', { error: error_13.message, sourceCrfId: sourceCrfId });
                return [2 /*return*/, {
                        success: false,
                        message: "Failed to fork form: ".concat(error_13.message)
                    }];
            case 41:
                client.release();
                return [7 /*endfinally*/];
            case 42: return [2 /*return*/];
        }
    });
}); };
exports.forkForm = forkForm;
exports.default = {
    saveFormData: exports.saveFormData,
    getFormData: exports.getFormData,
    getFormMetadata: exports.getFormMetadata,
    getFormStatus: exports.getFormStatus,
    validateFormData: exports.validateFormData,
    getStudyForms: exports.getStudyForms,
    getAllForms: exports.getAllForms,
    getFormById: exports.getFormById,
    createForm: exports.createForm,
    updateForm: exports.updateForm,
    deleteForm: exports.deleteForm,
    // Template Forking Functions
    getFormVersions: exports.getFormVersions,
    createFormVersion: exports.createFormVersion,
    forkForm: exports.forkForm
};
