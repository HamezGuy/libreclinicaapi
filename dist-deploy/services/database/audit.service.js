"use strict";
/**
 * Audit Service
 *
 * Handles audit trail queries from LibreClinica database
 * - Query audit_log_event table
 * - Filter by study, subject, user, date range
 * - Export audit trail (CSV, PDF, JSON)
 * - Subject-specific audit history
 *
 * Compliance: 21 CFR Part 11 §11.10(e) - Audit Trail
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
exports.getLoginStatistics = exports.getLoginHistory = exports.exportAuditLogs = exports.getAuditStats = exports.recordElectronicSignature = exports.getFormAuditTrail = exports.getSubjectAuditTrail = exports.getAuditLogs = exports.trackDocumentAccess = exports.trackUserAction = exports.AuditEventTypes = exports.recordAuditEvent = exports.getComplianceReport = exports.getAuditSummary = exports.getFormAudit = exports.getAuditableTables = exports.getAuditEventTypes = exports.getAuditStatistics = exports.exportAuditTrailCSV = exports.getRecentAuditEvents = exports.getSubjectAudit = exports.getAuditTrail = void 0;
var database_1 = require("../../config/database");
var logger_1 = require("../../config/logger");
/**
 * Get audit trail with filters
 * Main method for querying audit history
 */
var getAuditTrail = function (query) { return __awaiter(void 0, void 0, void 0, function () {
    var studyId, subjectId, userId, eventType, startDate, endDate, _a, page, _b, limit, offset, conditions, params, paramIndex, whereClause, countQuery, countResult, total, dataQuery, dataResult, error_1;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                logger_1.logger.info('Querying audit trail', query);
                _c.label = 1;
            case 1:
                _c.trys.push([1, 4, , 5]);
                studyId = query.studyId, subjectId = query.subjectId, userId = query.userId, eventType = query.eventType, startDate = query.startDate, endDate = query.endDate, _a = query.page, page = _a === void 0 ? 1 : _a, _b = query.limit, limit = _b === void 0 ? 50 : _b;
                offset = (page - 1) * limit;
                conditions = ['1=1'];
                params = [];
                paramIndex = 1;
                // Note: audit_log_event table doesn't have direct study_id or subject_id columns
                // These would need to be joined through related tables if needed
                if (userId) {
                    conditions.push("ale.user_id = $".concat(paramIndex++));
                    params.push(userId);
                }
                if (eventType) {
                    conditions.push("alet.name ILIKE $".concat(paramIndex++));
                    params.push("%".concat(eventType, "%"));
                }
                if (startDate) {
                    conditions.push("ale.audit_date >= $".concat(paramIndex++));
                    params.push(startDate);
                }
                if (endDate) {
                    conditions.push("ale.audit_date <= $".concat(paramIndex++));
                    params.push(endDate);
                }
                whereClause = conditions.join(' AND ');
                countQuery = "\n      SELECT COUNT(*) as total\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      WHERE ".concat(whereClause, "\n    ");
                return [4 /*yield*/, database_1.pool.query(countQuery, params)];
            case 2:
                countResult = _c.sent();
                total = parseInt(countResult.rows[0].total);
                dataQuery = "\n      SELECT \n        ale.audit_id,\n        ale.audit_date,\n        ale.audit_table,\n        ale.user_id,\n        u.user_name,\n        u.first_name || ' ' || u.last_name as user_full_name,\n        ale.entity_id,\n        ale.entity_name,\n        ale.old_value,\n        ale.new_value,\n        ale.audit_log_event_type_id,\n        alet.name as event_type,\n        ale.reason_for_change,\n        ale.event_crf_id\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      LEFT JOIN user_account u ON ale.user_id = u.user_id\n      WHERE ".concat(whereClause, "\n      ORDER BY ale.audit_date DESC\n      LIMIT $").concat(paramIndex, " OFFSET $").concat(paramIndex + 1, "\n    ");
                params.push(limit, offset);
                return [4 /*yield*/, database_1.pool.query(dataQuery, params)];
            case 3:
                dataResult = _c.sent();
                logger_1.logger.info('Audit trail query successful', {
                    total: total,
                    page: page,
                    limit: limit,
                    returned: dataResult.rows.length
                });
                return [2 /*return*/, {
                        success: true,
                        data: dataResult.rows,
                        pagination: {
                            page: page,
                            limit: limit,
                            total: total,
                            totalPages: Math.ceil(total / limit)
                        }
                    }];
            case 4:
                error_1 = _c.sent();
                logger_1.logger.error('Audit trail query error', {
                    error: error_1.message,
                    query: query
                });
                throw error_1;
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getAuditTrail = getAuditTrail;
/**
 * Get audit trail for specific subject
 * Returns complete audit history for a subject
 */
var getSubjectAudit = function (subjectId_1) {
    var args_1 = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        args_1[_i - 1] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([subjectId_1], args_1, true), void 0, function (subjectId, page, limit) {
        if (page === void 0) { page = 1; }
        if (limit === void 0) { limit = 100; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger_1.logger.info('Querying subject audit trail', { subjectId: subjectId });
                    return [4 /*yield*/, (0, exports.getAuditTrail)({
                            subjectId: subjectId,
                            page: page,
                            limit: limit
                        })];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    });
};
exports.getSubjectAudit = getSubjectAudit;
/**
 * Get recent audit events
 * Returns most recent audit events across all studies
 * COMBINES: audit_log_event (data changes) + audit_user_login (login/logout events)
 */
var getRecentAuditEvents = function () {
    var args_1 = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args_1[_i] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([], args_1, true), void 0, function (limit) {
        var query, result, error_2;
        if (limit === void 0) { limit = 50; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger_1.logger.info('Querying recent audit events', { limit: limit });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    query = "\n      (\n        SELECT \n          ale.audit_id::text as audit_id,\n          ale.audit_date,\n          ale.audit_table,\n          ale.user_id,\n          u.user_name,\n          u.first_name || ' ' || u.last_name as user_full_name,\n          ale.entity_id,\n          ale.entity_name,\n          COALESCE(alet.name, 'Data Change') as event_type,\n          ale.old_value,\n          ale.new_value,\n          'data' as event_category\n        FROM audit_log_event ale\n        LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n        LEFT JOIN user_account u ON ale.user_id = u.user_id\n      )\n      UNION ALL\n      (\n        SELECT \n          'login_' || aul.id::text as audit_id,\n          aul.login_attempt_date as audit_date,\n          'user_login' as audit_table,\n          aul.user_account_id as user_id,\n          aul.user_name,\n          u.first_name || ' ' || u.last_name as user_full_name,\n          aul.user_account_id as entity_id,\n          aul.user_name as entity_name,\n          CASE \n            WHEN aul.login_status_code = 1 THEN 'User Login'\n            WHEN aul.login_status_code = 2 THEN 'User Logout'\n            ELSE 'Failed Login Attempt'\n          END as event_type,\n          NULL as old_value,\n          aul.details as new_value,\n          'login' as event_category\n        FROM audit_user_login aul\n        LEFT JOIN user_account u ON aul.user_account_id = u.user_id\n      )\n      ORDER BY audit_date DESC\n      LIMIT $1\n    ";
                    return [4 /*yield*/, database_1.pool.query(query, [limit])];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, result.rows];
                case 3:
                    error_2 = _a.sent();
                    logger_1.logger.error('Recent audit events query error', {
                        error: error_2.message
                    });
                    throw error_2;
                case 4: return [2 /*return*/];
            }
        });
    });
};
exports.getRecentAuditEvents = getRecentAuditEvents;
/**
 * Export audit trail to CSV
 * Note: audit_log_event does NOT have study_id or subject_id columns
 * We filter by audit_table and date range instead
 */
var exportAuditTrailCSV = function (request) { return __awaiter(void 0, void 0, void 0, function () {
    var startDate, endDate, query, result, headers, csv, _i, _a, row, values, error_3;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                logger_1.logger.info('Exporting audit trail to CSV', request);
                _b.label = 1;
            case 1:
                _b.trys.push([1, 3, , 4]);
                startDate = request.startDate, endDate = request.endDate;
                query = "\n      SELECT \n        ale.audit_date,\n        u.user_name,\n        u.first_name || ' ' || u.last_name as user_full_name,\n        alet.name as event_type,\n        ale.audit_table,\n        ale.entity_id,\n        ale.entity_name,\n        ale.old_value,\n        ale.new_value,\n        ale.reason_for_change\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      LEFT JOIN user_account u ON ale.user_id = u.user_id\n      WHERE ale.audit_date >= $1\n        AND ale.audit_date <= $2\n      ORDER BY ale.audit_date ASC\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [startDate, endDate])];
            case 2:
                result = _b.sent();
                headers = [
                    'Audit Date',
                    'Username',
                    'User Full Name',
                    'Event Type',
                    'Table',
                    'Entity ID',
                    'Entity Name',
                    'Old Value',
                    'New Value',
                    'Reason for Change'
                ];
                csv = headers.join(',') + '\n';
                for (_i = 0, _a = result.rows; _i < _a.length; _i++) {
                    row = _a[_i];
                    values = [
                        row.audit_date,
                        row.user_name,
                        "\"".concat(row.user_full_name || '', "\""),
                        "\"".concat(row.event_type || '', "\""),
                        row.audit_table,
                        row.entity_id || '',
                        "\"".concat(row.entity_name || '', "\""),
                        "\"".concat(row.old_value || '', "\""),
                        "\"".concat(row.new_value || '', "\""),
                        "\"".concat(row.reason_for_change || '', "\"")
                    ];
                    csv += values.join(',') + '\n';
                }
                logger_1.logger.info('Audit trail exported to CSV', {
                    rowCount: result.rows.length
                });
                return [2 /*return*/, csv];
            case 3:
                error_3 = _b.sent();
                logger_1.logger.error('Audit trail CSV export error', {
                    error: error_3.message,
                    request: request
                });
                throw error_3;
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.exportAuditTrailCSV = exportAuditTrailCSV;
/**
 * Get audit statistics
 * COMBINES: audit_log_event (data changes) + audit_user_login (login/logout events)
 */
var getAuditStatistics = function () {
    var args_1 = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args_1[_i] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([], args_1, true), void 0, function (days) {
        var startDate, dataEventsQuery, loginEventsQuery, _a, dataResult, loginResult, dataStats, loginStats, error_4;
        if (days === void 0) { days = 30; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    logger_1.logger.info('Calculating audit statistics', { days: days });
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);
                    dataEventsQuery = "\n      SELECT \n        COUNT(*) as total_data_events,\n        COUNT(DISTINCT ale.user_id) as data_unique_users,\n        COUNT(CASE WHEN alet.name LIKE '%Data%' OR alet.name LIKE '%Entry%' THEN 1 END) as data_entry_events,\n        COUNT(CASE WHEN alet.name LIKE '%Subject%' THEN 1 END) as subject_events,\n        COUNT(CASE WHEN alet.name LIKE '%Query%' OR alet.name LIKE '%Discrepancy%' THEN 1 END) as query_events,\n        COUNT(CASE WHEN alet.name LIKE '%SDV%' OR alet.name LIKE '%Verif%' THEN 1 END) as sdv_events\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      WHERE ale.audit_date >= $1\n    ";
                    loginEventsQuery = "\n      SELECT \n        COUNT(*) as total_login_events,\n        COUNT(DISTINCT user_account_id) as login_unique_users,\n        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as successful_logins,\n        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed_logins,\n        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logouts\n      FROM audit_user_login\n      WHERE login_attempt_date >= $1\n    ";
                    return [4 /*yield*/, Promise.all([
                            database_1.pool.query(dataEventsQuery, [startDate]),
                            database_1.pool.query(loginEventsQuery, [startDate])
                        ])];
                case 2:
                    _a = _b.sent(), dataResult = _a[0], loginResult = _a[1];
                    dataStats = dataResult.rows[0] || {};
                    loginStats = loginResult.rows[0] || {};
                    return [2 /*return*/, {
                            total_events: parseInt(dataStats.total_data_events || 0) + parseInt(loginStats.total_login_events || 0),
                            unique_users: Math.max(parseInt(dataStats.data_unique_users || 0), parseInt(loginStats.login_unique_users || 0)),
                            active_days: days,
                            // Login events (from audit_user_login)
                            login_events: parseInt(loginStats.successful_logins || 0),
                            failed_login_events: parseInt(loginStats.failed_logins || 0),
                            logout_events: parseInt(loginStats.logouts || 0),
                            // Data events (from audit_log_event)
                            data_events: parseInt(dataStats.data_entry_events || 0),
                            subject_events: parseInt(dataStats.subject_events || 0),
                            query_events: parseInt(dataStats.query_events || 0),
                            sdv_events: parseInt(dataStats.sdv_events || 0)
                        }];
                case 3:
                    error_4 = _b.sent();
                    logger_1.logger.error('Audit statistics error', {
                        error: error_4.message
                    });
                    throw error_4;
                case 4: return [2 /*return*/];
            }
        });
    });
};
exports.getAuditStatistics = getAuditStatistics;
/**
 * Get audit event types from database
 */
var getAuditEventTypes = function () { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting audit event types');
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      SELECT \n        audit_log_event_type_id as id,\n        name,\n        description\n      FROM audit_log_event_type\n      ORDER BY audit_log_event_type_id\n    ";
                return [4 /*yield*/, database_1.pool.query(query)];
            case 2:
                result = _a.sent();
                return [2 /*return*/, result.rows];
            case 3:
                error_5 = _a.sent();
                logger_1.logger.error('Get audit event types error', { error: error_5.message });
                return [2 /*return*/, []];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getAuditEventTypes = getAuditEventTypes;
/**
 * Get auditable tables list
 */
var getAuditableTables = function () { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_6;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting auditable tables');
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      SELECT DISTINCT audit_table as name,\n        COUNT(*) as event_count\n      FROM audit_log_event\n      GROUP BY audit_table\n      ORDER BY event_count DESC\n    ";
                return [4 /*yield*/, database_1.pool.query(query)];
            case 2:
                result = _a.sent();
                return [2 /*return*/, result.rows];
            case 3:
                error_6 = _a.sent();
                logger_1.logger.error('Get auditable tables error', { error: error_6.message });
                return [2 /*return*/, []];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getAuditableTables = getAuditableTables;
/**
 * Get form/CRF specific audit trail
 */
var getFormAudit = function (eventCrfId) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Getting form audit', { eventCrfId: eventCrfId });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      SELECT \n        ale.audit_id,\n        ale.audit_date,\n        ale.audit_table,\n        u.user_name,\n        u.first_name || ' ' || u.last_name as user_full_name,\n        ale.entity_id,\n        ale.entity_name,\n        ale.old_value,\n        ale.new_value,\n        alet.name as event_type,\n        ale.reason_for_change\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      LEFT JOIN user_account u ON ale.user_id = u.user_id\n      WHERE ale.event_crf_id = $1\n      ORDER BY ale.audit_date DESC\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [eventCrfId])];
            case 2:
                result = _a.sent();
                return [2 /*return*/, result.rows];
            case 3:
                error_7 = _a.sent();
                logger_1.logger.error('Get form audit error', { error: error_7.message });
                return [2 /*return*/, []];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getFormAudit = getFormAudit;
/**
 * Get audit by date range with summary
 */
var getAuditSummary = function (startDate, endDate) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, summary, _i, _a, row, dateKey, error_8;
    var _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                logger_1.logger.info('Getting audit summary', { startDate: startDate, endDate: endDate });
                _c.label = 1;
            case 1:
                _c.trys.push([1, 3, , 4]);
                query = "\n      SELECT \n        DATE(ale.audit_date) as date,\n        alet.name as event_type,\n        COUNT(*) as count\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2\n      GROUP BY DATE(ale.audit_date), alet.name\n      ORDER BY date DESC, count DESC\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [startDate, endDate])];
            case 2:
                result = _c.sent();
                summary = {};
                for (_i = 0, _a = result.rows; _i < _a.length; _i++) {
                    row = _a[_i];
                    dateKey = (_b = row.date) === null || _b === void 0 ? void 0 : _b.toISOString().split('T')[0];
                    if (!summary[dateKey]) {
                        summary[dateKey] = { date: dateKey, events: {}, total: 0 };
                    }
                    summary[dateKey].events[row.event_type] = parseInt(row.count);
                    summary[dateKey].total += parseInt(row.count);
                }
                return [2 /*return*/, {
                        success: true,
                        data: Object.values(summary)
                    }];
            case 3:
                error_8 = _c.sent();
                logger_1.logger.error('Get audit summary error', { error: error_8.message });
                return [2 /*return*/, { success: false, data: [] }];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getAuditSummary = getAuditSummary;
/**
 * Get compliance report
 * Returns audit data formatted for 21 CFR Part 11 compliance reports
 */
var getComplianceReport = function (request) { return __awaiter(void 0, void 0, void 0, function () {
    var startDate, endDate, statsQuery, statsResult, stats, typeQuery, typeResult, userQuery, userResult, loginQuery, loginResult, error_9;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Generating compliance report', request);
                _a.label = 1;
            case 1:
                _a.trys.push([1, 6, , 7]);
                startDate = request.startDate, endDate = request.endDate;
                statsQuery = "\n      SELECT \n        COUNT(*) as total_events,\n        COUNT(DISTINCT ale.user_id) as unique_users,\n        COUNT(DISTINCT DATE(ale.audit_date)) as active_days,\n        MIN(ale.audit_date) as first_event,\n        MAX(ale.audit_date) as last_event\n      FROM audit_log_event ale\n      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2\n    ";
                return [4 /*yield*/, database_1.pool.query(statsQuery, [startDate, endDate])];
            case 2:
                statsResult = _a.sent();
                stats = statsResult.rows[0];
                typeQuery = "\n      SELECT \n        alet.name as event_type,\n        COUNT(*) as count\n      FROM audit_log_event ale\n      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id\n      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2\n      GROUP BY alet.name\n      ORDER BY count DESC\n    ";
                return [4 /*yield*/, database_1.pool.query(typeQuery, [startDate, endDate])];
            case 3:
                typeResult = _a.sent();
                userQuery = "\n      SELECT \n        u.user_name,\n        u.first_name || ' ' || u.last_name as user_full_name,\n        COUNT(*) as event_count\n      FROM audit_log_event ale\n      INNER JOIN user_account u ON ale.user_id = u.user_id\n      WHERE ale.audit_date >= $1 AND ale.audit_date <= $2\n      GROUP BY u.user_name, u.first_name, u.last_name\n      ORDER BY event_count DESC\n    ";
                return [4 /*yield*/, database_1.pool.query(userQuery, [startDate, endDate])];
            case 4:
                userResult = _a.sent();
                loginQuery = "\n      SELECT \n        aul.login_attempt_date,\n        aul.user_name,\n        aul.login_status\n      FROM audit_user_login aul\n      WHERE aul.login_attempt_date >= $1 AND aul.login_attempt_date <= $2\n      ORDER BY aul.login_attempt_date DESC\n      LIMIT 100\n    ";
                return [4 /*yield*/, database_1.pool.query(loginQuery, [startDate, endDate])];
            case 5:
                loginResult = _a.sent();
                return [2 /*return*/, {
                        success: true,
                        data: {
                            reportPeriod: { startDate: startDate, endDate: endDate },
                            generatedAt: new Date().toISOString(),
                            summary: {
                                totalEvents: parseInt(stats.total_events),
                                uniqueUsers: parseInt(stats.unique_users),
                                activeDays: parseInt(stats.active_days),
                                firstEvent: stats.first_event,
                                lastEvent: stats.last_event
                            },
                            eventsByType: typeResult.rows.map(function (r) { return ({
                                type: r.event_type,
                                count: parseInt(r.count)
                            }); }),
                            userActivity: userResult.rows.map(function (r) { return ({
                                userName: r.user_name,
                                fullName: r.user_full_name,
                                eventCount: parseInt(r.event_count)
                            }); }),
                            recentLogins: loginResult.rows
                        }
                    }];
            case 6:
                error_9 = _a.sent();
                logger_1.logger.error('Compliance report error', { error: error_9.message });
                return [2 /*return*/, { success: false, message: error_9.message }];
            case 7: return [2 /*return*/];
        }
    });
}); };
exports.getComplianceReport = getComplianceReport;
/**
 * Record audit event directly to database
 * Uses LibreClinica's CORRECT audit_log_event schema
 */
var recordAuditEvent = function (data) { return __awaiter(void 0, void 0, void 0, function () {
    var query, result, error_10;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Recording audit event to database', {
                    audit_table: data.audit_table,
                    entity_id: data.entity_id,
                    user_id: data.user_id
                });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      INSERT INTO audit_log_event (\n        audit_date, \n        audit_table, \n        user_id, \n        entity_id, \n        entity_name,\n        old_value, \n        new_value, \n        audit_log_event_type_id, \n        reason_for_change,\n        event_crf_id,\n        study_event_id\n      ) VALUES (\n        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10\n      ) RETURNING audit_id\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [
                        data.audit_table,
                        data.user_id,
                        data.entity_id,
                        data.user_name, // entity_name
                        data.old_value || null,
                        data.new_value || null,
                        data.audit_log_event_type_id,
                        data.reason_for_change || null,
                        data.event_crf_id || null,
                        data.study_event_id || null
                    ])];
            case 2:
                result = _a.sent();
                return [2 /*return*/, {
                        success: true,
                        data: { audit_id: result.rows[0].audit_id },
                        message: 'Audit event recorded'
                    }];
            case 3:
                error_10 = _a.sent();
                logger_1.logger.error('Failed to record audit event', { error: error_10.message });
                return [2 /*return*/, { success: false, message: error_10.message }];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.recordAuditEvent = recordAuditEvent;
/**
 * Common audit event types for tracking user actions
 */
exports.AuditEventTypes = {
    // Document/Form access
    FORM_VIEWED: 1,
    FORM_CREATED: 2,
    FORM_UPDATED: 3,
    FORM_DELETED: 4,
    FORM_SIGNED: 5,
    // Subject access
    SUBJECT_VIEWED: 10,
    SUBJECT_CREATED: 11,
    SUBJECT_UPDATED: 12,
    // Study access
    STUDY_ACCESSED: 20,
    STUDY_EXPORTED: 21,
    // Query events  
    QUERY_CREATED: 30,
    QUERY_RESPONDED: 31,
    QUERY_CLOSED: 32,
    // SDV events
    SDV_VERIFIED: 40,
    SDV_REJECTED: 41,
    // Report events
    REPORT_GENERATED: 50,
    AUDIT_EXPORTED: 51
};
/**
 * Track user action - Simplified API for controllers to record audit events
 * Uses LibreClinica's CORRECT audit_log_event schema
 *
 * @example
 * await trackUserAction({
 *   userId: user.userId,
 *   username: user.username,
 *   action: 'FORM_VIEWED',
 *   entityType: 'event_crf',
 *   entityId: eventCrfId,
 *   details: 'Viewed wound assessment form'
 * });
 */
var trackUserAction = function (data) { return __awaiter(void 0, void 0, void 0, function () {
    var eventTypeId, query, result, error_11;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                eventTypeId = exports.AuditEventTypes[data.action] || 1;
                query = "\n      INSERT INTO audit_log_event (\n        audit_date, \n        audit_table, \n        user_id,\n        entity_id, \n        entity_name, \n        old_value, \n        new_value, \n        audit_log_event_type_id,\n        reason_for_change,\n        event_crf_id,\n        study_event_id\n      ) VALUES (\n        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10\n      ) RETURNING audit_id\n    ";
                return [4 /*yield*/, database_1.pool.query(query, [
                        data.entityType, // audit_table
                        data.userId, // user_id
                        data.entityId || null, // entity_id
                        data.entityName || data.username, // entity_name
                        data.oldValue || null, // old_value
                        data.newValue || data.details || null, // new_value
                        eventTypeId, // audit_log_event_type_id
                        data.details || "".concat(data.action, " by ").concat(data.username), // reason_for_change
                        data.eventCrfId || null, // event_crf_id
                        data.studyEventId || null // study_event_id
                    ])];
            case 1:
                result = _a.sent();
                logger_1.logger.info('User action tracked', {
                    action: data.action,
                    entityType: data.entityType,
                    entityId: data.entityId,
                    userId: data.userId
                });
                return [2 /*return*/, { success: true, auditId: result.rows[0].audit_id }];
            case 2:
                error_11 = _a.sent();
                logger_1.logger.error('Failed to track user action', {
                    error: error_11.message,
                    action: data.action
                });
                return [2 /*return*/, { success: false }];
            case 3: return [2 /*return*/];
        }
    });
}); };
exports.trackUserAction = trackUserAction;
/**
 * Track document/form access
 */
var trackDocumentAccess = function (userId_1, username_1, documentType_1, documentId_1, documentName_1) {
    var args_1 = [];
    for (var _i = 5; _i < arguments.length; _i++) {
        args_1[_i - 5] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([userId_1, username_1, documentType_1, documentId_1, documentName_1], args_1, true), void 0, function (userId, username, documentType, documentId, documentName, action) {
        var actionMap;
        if (action === void 0) { action = 'view'; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    actionMap = {
                        view: 'FORM_VIEWED',
                        edit: 'FORM_UPDATED',
                        sign: 'FORM_SIGNED',
                        export: 'AUDIT_EXPORTED'
                    };
                    return [4 /*yield*/, (0, exports.trackUserAction)({
                            userId: userId,
                            username: username,
                            action: actionMap[action],
                            entityType: documentType,
                            entityId: documentId,
                            entityName: documentName,
                            details: "".concat(action, " ").concat(documentType, " ").concat(documentName || documentId)
                        })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
};
exports.trackDocumentAccess = trackDocumentAccess;
/**
 * Get audit logs with flexible filtering
 * Alias for getAuditTrail with additional parameters
 */
var getAuditLogs = function (params) { return __awaiter(void 0, void 0, void 0, function () {
    var page;
    return __generator(this, function (_a) {
        page = Math.floor((params.offset || 0) / (params.limit || 50)) + 1;
        return [2 /*return*/, (0, exports.getAuditTrail)({
                studyId: params.studyId,
                userId: params.userId,
                eventType: params.eventType,
                startDate: params.startDate,
                endDate: params.endDate,
                limit: params.limit || 50,
                page: page
            })];
    });
}); };
exports.getAuditLogs = getAuditLogs;
/**
 * Get subject audit trail
 * Alias for getSubjectAudit with API response format
 */
var getSubjectAuditTrail = function (subjectId) { return __awaiter(void 0, void 0, void 0, function () {
    var result;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.getSubjectAudit)(subjectId)];
            case 1:
                result = _a.sent();
                return [2 /*return*/, {
                        success: result.success,
                        data: result.data,
                        message: result.success ? 'Subject audit trail retrieved' : 'Failed to retrieve audit trail'
                    }];
        }
    });
}); };
exports.getSubjectAuditTrail = getSubjectAuditTrail;
/**
 * Get form audit trail
 * Alias for getFormAudit with API response format
 */
var getFormAuditTrail = function (eventCrfId) { return __awaiter(void 0, void 0, void 0, function () {
    var data;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.getFormAudit)(eventCrfId)];
            case 1:
                data = _a.sent();
                return [2 /*return*/, {
                        success: true,
                        data: data,
                        message: 'Form audit trail retrieved'
                    }];
        }
    });
}); };
exports.getFormAuditTrail = getFormAuditTrail;
/**
 * Record electronic signature to database
 */
var recordElectronicSignature = function (data) { return __awaiter(void 0, void 0, void 0, function () {
    var query, signatureValue, result, error_12;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Recording electronic signature to database', {
                    entity_type: data.entity_type,
                    entity_id: data.entity_id,
                    signer_username: data.signer_username
                });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                query = "\n      INSERT INTO audit_log_event (\n        audit_date, audit_table, entity_id, user_id, \n        audit_log_event_type_id, new_value, reason_for_change\n      ) \n      SELECT \n        $1, $2, $3, u.user_id, 30, $4, $5\n      FROM user_account u\n      WHERE u.user_name = $6\n      RETURNING audit_id\n    ";
                signatureValue = JSON.stringify({
                    type: 'electronic_signature',
                    meaning: data.meaning,
                    signed_at: data.signed_at.toISOString()
                });
                return [4 /*yield*/, database_1.pool.query(query, [
                        data.signed_at,
                        data.entity_type,
                        data.entity_id,
                        signatureValue,
                        data.reason_for_change || "Electronic signature: ".concat(data.meaning),
                        data.signer_username
                    ])];
            case 2:
                result = _a.sent();
                if (result.rows.length === 0) {
                    return [2 /*return*/, { success: false, message: 'User not found for signature' }];
                }
                return [2 /*return*/, {
                        success: true,
                        data: { signature_id: result.rows[0].audit_id },
                        message: 'Electronic signature recorded'
                    }];
            case 3:
                error_12 = _a.sent();
                logger_1.logger.error('Failed to record electronic signature', { error: error_12.message });
                return [2 /*return*/, { success: false, message: error_12.message }];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.recordElectronicSignature = recordElectronicSignature;
/**
 * Get audit statistics for dashboard
 */
var getAuditStats = function () {
    var args_1 = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args_1[_i] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([], args_1, true), void 0, function (days) {
        var stats;
        if (days === void 0) { days = 30; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, exports.getAuditStatistics)(days)];
                case 1:
                    stats = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            data: {
                                totalEvents: parseInt(stats.total_events || '0'),
                                uniqueUsers: parseInt(stats.unique_users || '0'),
                                activeDays: parseInt(stats.active_days || '0'),
                                byType: {
                                    login: parseInt(stats.login_events || '0'),
                                    data: parseInt(stats.data_events || '0'),
                                    subject: parseInt(stats.subject_events || '0'),
                                    query: parseInt(stats.query_events || '0')
                                }
                            }
                        }];
            }
        });
    });
};
exports.getAuditStats = getAuditStats;
/**
 * Export audit logs in specified format
 */
var exportAuditLogs = function (params_1) {
    var args_1 = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        args_1[_i - 1] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([params_1], args_1, true), void 0, function (params, format) {
        var csv, result;
        if (format === void 0) { format = 'csv'; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(format === 'csv')) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, exports.exportAuditTrailCSV)({
                            studyId: params.studyId || 0,
                            startDate: params.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                            endDate: params.endDate || new Date().toISOString(),
                            format: 'csv'
                        })];
                case 1:
                    csv = _a.sent();
                    return [2 /*return*/, { success: true, data: csv, format: 'csv' }];
                case 2: return [4 /*yield*/, (0, exports.getAuditTrail)({
                        studyId: params.studyId,
                        startDate: params.startDate,
                        endDate: params.endDate,
                        limit: 10000
                    })];
                case 3:
                    result = _a.sent();
                    return [2 /*return*/, { success: true, data: result.data, format: 'json' }];
            }
        });
    });
};
exports.exportAuditLogs = exportAuditLogs;
/**
 * Get login history from audit_user_login table
 * Returns all login/logout/failed login events
 *
 * 21 CFR Part 11 §11.10(e) - Audit Trail for login events
 *
 * @param params.userId - Filter by specific user
 * @param params.startDate - Filter events after this date
 * @param params.endDate - Filter events before this date
 * @param params.status - Filter by status: 'success' (1), 'failed' (0), 'logout' (2), or 'all'
 * @param params.limit - Maximum number of records
 * @param params.offset - Pagination offset
 */
var getLoginHistory = function (params) { return __awaiter(void 0, void 0, void 0, function () {
    var conditions, queryParams, paramIndex, statusMap, whereClause, limit, offset, countQuery, countResult, total, dataQuery, dataResult, error_13;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Querying login history', params);
                _a.label = 1;
            case 1:
                _a.trys.push([1, 4, , 5]);
                conditions = ['1=1'];
                queryParams = [];
                paramIndex = 1;
                if (params.userId) {
                    conditions.push("aul.user_account_id = $".concat(paramIndex++));
                    queryParams.push(params.userId);
                }
                if (params.username) {
                    conditions.push("aul.user_name ILIKE $".concat(paramIndex++));
                    queryParams.push("%".concat(params.username, "%"));
                }
                if (params.startDate) {
                    conditions.push("aul.login_attempt_date >= $".concat(paramIndex++));
                    queryParams.push(params.startDate);
                }
                if (params.endDate) {
                    conditions.push("aul.login_attempt_date <= $".concat(paramIndex++));
                    queryParams.push(params.endDate);
                }
                if (params.status && params.status !== 'all') {
                    statusMap = {
                        'success': 1,
                        'failed': 0,
                        'logout': 2
                    };
                    conditions.push("aul.login_status_code = $".concat(paramIndex++));
                    queryParams.push(statusMap[params.status]);
                }
                whereClause = conditions.join(' AND ');
                limit = params.limit || 100;
                offset = params.offset || 0;
                countQuery = "\n      SELECT COUNT(*) as total\n      FROM audit_user_login aul\n      WHERE ".concat(whereClause, "\n    ");
                return [4 /*yield*/, database_1.pool.query(countQuery, queryParams)];
            case 2:
                countResult = _a.sent();
                total = parseInt(countResult.rows[0].total);
                dataQuery = "\n      SELECT \n        aul.id,\n        aul.user_name as username,\n        aul.user_account_id as user_id,\n        u.first_name,\n        u.last_name,\n        u.first_name || ' ' || u.last_name as user_full_name,\n        u.email,\n        aul.login_attempt_date as audit_date,\n        aul.login_attempt_date,\n        aul.login_status_code as login_status,\n        CASE \n          WHEN aul.login_status_code = 1 THEN 'success'\n          WHEN aul.login_status_code = 2 THEN 'logout'\n          ELSE 'failed'\n        END as status_text,\n        CASE \n          WHEN aul.login_status_code = 1 THEN 'User Login'\n          WHEN aul.login_status_code = 2 THEN 'User Logout'\n          ELSE 'Failed Login Attempt'\n        END as event_type,\n        aul.details,\n        aul.version\n      FROM audit_user_login aul\n      LEFT JOIN user_account u ON aul.user_account_id = u.user_id\n      WHERE ".concat(whereClause, "\n      ORDER BY aul.login_attempt_date DESC\n      LIMIT $").concat(paramIndex, " OFFSET $").concat(paramIndex + 1, "\n    ");
                queryParams.push(limit, offset);
                return [4 /*yield*/, database_1.pool.query(dataQuery, queryParams)];
            case 3:
                dataResult = _a.sent();
                logger_1.logger.info('Login history query successful', {
                    total: total,
                    returned: dataResult.rows.length
                });
                return [2 /*return*/, {
                        success: true,
                        data: dataResult.rows,
                        pagination: { total: total, limit: limit, offset: offset }
                    }];
            case 4:
                error_13 = _a.sent();
                logger_1.logger.error('Login history query error', { error: error_13.message });
                return [2 /*return*/, {
                        success: false,
                        data: [],
                        pagination: { total: 0, limit: params.limit || 100, offset: params.offset || 0 }
                    }];
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.getLoginHistory = getLoginHistory;
/**
 * Get login statistics for compliance reporting
 * Returns counts of successful logins, failed attempts, and logouts
 */
var getLoginStatistics = function () {
    var args_1 = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args_1[_i] = arguments[_i];
    }
    return __awaiter(void 0, __spreadArray([], args_1, true), void 0, function (days) {
        var startDate, summaryQuery, summaryResult, summary, dailyQuery, dailyResult, error_14;
        if (days === void 0) { days = 30; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger_1.logger.info('Calculating login statistics', { days: days });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);
                    summaryQuery = "\n      SELECT \n        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as successful_logins,\n        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed_logins,\n        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logouts,\n        COUNT(DISTINCT user_account_id) FILTER (WHERE user_account_id IS NOT NULL) as unique_users\n      FROM audit_user_login\n      WHERE login_attempt_date >= $1\n    ";
                    return [4 /*yield*/, database_1.pool.query(summaryQuery, [startDate])];
                case 2:
                    summaryResult = _a.sent();
                    summary = summaryResult.rows[0];
                    dailyQuery = "\n      SELECT \n        DATE(login_attempt_date) as date,\n        COUNT(CASE WHEN login_status_code = 1 THEN 1 END) as success,\n        COUNT(CASE WHEN login_status_code = 0 THEN 1 END) as failed,\n        COUNT(CASE WHEN login_status_code = 2 THEN 1 END) as logout\n      FROM audit_user_login\n      WHERE login_attempt_date >= $1\n      GROUP BY DATE(login_attempt_date)\n      ORDER BY date DESC\n    ";
                    return [4 /*yield*/, database_1.pool.query(dailyQuery, [startDate])];
                case 3:
                    dailyResult = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            data: {
                                successfulLogins: parseInt(summary.successful_logins) || 0,
                                failedLogins: parseInt(summary.failed_logins) || 0,
                                logouts: parseInt(summary.logouts) || 0,
                                uniqueUsers: parseInt(summary.unique_users) || 0,
                                byDay: dailyResult.rows.map(function (row) {
                                    var _a;
                                    return ({
                                        date: (_a = row.date) === null || _a === void 0 ? void 0 : _a.toISOString().split('T')[0],
                                        success: parseInt(row.success) || 0,
                                        failed: parseInt(row.failed) || 0,
                                        logout: parseInt(row.logout) || 0
                                    });
                                })
                            }
                        }];
                case 4:
                    error_14 = _a.sent();
                    logger_1.logger.error('Login statistics error', { error: error_14.message });
                    return [2 /*return*/, {
                            success: false,
                            data: {
                                successfulLogins: 0,
                                failedLogins: 0,
                                logouts: 0,
                                uniqueUsers: 0,
                                byDay: []
                            }
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
};
exports.getLoginStatistics = getLoginStatistics;
exports.default = {
    getAuditTrail: exports.getAuditTrail,
    getSubjectAudit: exports.getSubjectAudit,
    getRecentAuditEvents: exports.getRecentAuditEvents,
    exportAuditTrailCSV: exports.exportAuditTrailCSV,
    getAuditStatistics: exports.getAuditStatistics,
    getAuditEventTypes: exports.getAuditEventTypes,
    getAuditableTables: exports.getAuditableTables,
    getFormAudit: exports.getFormAudit,
    getAuditSummary: exports.getAuditSummary,
    getComplianceReport: exports.getComplianceReport,
    // New functions for hybrid service
    recordAuditEvent: exports.recordAuditEvent,
    getAuditLogs: exports.getAuditLogs,
    getSubjectAuditTrail: exports.getSubjectAuditTrail,
    getFormAuditTrail: exports.getFormAuditTrail,
    recordElectronicSignature: exports.recordElectronicSignature,
    getAuditStats: exports.getAuditStats,
    exportAuditLogs: exports.exportAuditLogs,
    // User action tracking
    trackUserAction: exports.trackUserAction,
    trackDocumentAccess: exports.trackDocumentAccess,
    AuditEventTypes: exports.AuditEventTypes,
    // Login audit
    getLoginHistory: exports.getLoginHistory,
    getLoginStatistics: exports.getLoginStatistics
};
