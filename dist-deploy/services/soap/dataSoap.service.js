"use strict";
/**
 * Data SOAP Service
 *
 * Handles clinical data entry via LibreClinica SOAP API
 * - Import CRF data using ODM XML
 * - Build ODM XML from form data
 * - Validate data entries
 * - Support electronic signatures
 *
 * SOAP Endpoint: http://localhost:8080/LibreClinica/ws/data/v1
 * Uses ODM 1.3 standard for data interchange
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOdmStructure = exports.buildItemDataOdm = exports.parseImportResponse = exports.buildOdmXml = exports.importData = void 0;
var soapClient_1 = require("./soapClient");
var logger_1 = require("../../config/logger");
var xml2js_1 = require("xml2js");
/**
 * Import clinical data via SOAP
 * Main method for saving CRF data
 */
var importData = function (request, userId, username) { return __awaiter(void 0, void 0, void 0, function () {
    var odmXml, soapClient, response, parsedResponse, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                logger_1.logger.info('Importing clinical data via SOAP', {
                    studyId: request.studyId,
                    subjectId: request.subjectId,
                    crfId: request.crfId,
                    userId: userId,
                    username: username
                });
                _a.label = 1;
            case 1:
                _a.trys.push([1, 5, , 6]);
                return [4 /*yield*/, (0, exports.buildOdmXml)(request)];
            case 2:
                odmXml = _a.sent();
                logger_1.logger.debug('ODM XML built for data import', {
                    subjectId: request.subjectId,
                    odmLength: odmXml.length
                });
                soapClient = (0, soapClient_1.getSoapClient)();
                return [4 /*yield*/, soapClient.executeRequest({
                        serviceName: 'data',
                        methodName: 'importODM',
                        parameters: {
                            odm: odmXml
                        },
                        userId: userId,
                        username: username
                    })];
            case 3:
                response = _a.sent();
                if (!response.success) {
                    logger_1.logger.error('Data import failed', {
                        error: response.error,
                        subjectId: request.subjectId
                    });
                    return [2 /*return*/, {
                            success: false,
                            message: response.error || 'Data import failed'
                        }];
                }
                return [4 /*yield*/, (0, exports.parseImportResponse)(response.data)];
            case 4:
                parsedResponse = _a.sent();
                if (parsedResponse.validationErrors && parsedResponse.validationErrors.length > 0) {
                    logger_1.logger.warn('Data import completed with validation errors', {
                        subjectId: request.subjectId,
                        errorCount: parsedResponse.validationErrors.length
                    });
                    return [2 /*return*/, {
                            success: false,
                            message: 'Data import failed validation',
                            data: parsedResponse
                        }];
                }
                logger_1.logger.info('Data imported successfully', {
                    subjectId: request.subjectId,
                    eventCrfId: parsedResponse.eventCrfId
                });
                return [2 /*return*/, {
                        success: true,
                        data: parsedResponse,
                        message: 'Data imported successfully'
                    }];
            case 5:
                error_1 = _a.sent();
                logger_1.logger.error('Data import error', {
                    error: error_1.message,
                    subjectId: request.subjectId
                });
                return [2 /*return*/, {
                        success: false,
                        message: "Data import failed: ".concat(error_1.message)
                    }];
            case 6: return [2 /*return*/];
        }
    });
}); };
exports.importData = importData;
/**
 * Build ODM XML from form data request
 * Converts JSON form data to ODM 1.3 XML format
 */
var buildOdmXml = function (request) { return __awaiter(void 0, void 0, void 0, function () {
    var studyId, subjectId, studyEventDefinitionId, crfId, formData, electronicSignature, studyOid, subjectOid, eventOid, formOid, timestamp, odmXml, _i, _a, _b, itemGroupOid, items, _c, _d, _e, itemOid, value, escapedValue;
    return __generator(this, function (_f) {
        studyId = request.studyId, subjectId = request.subjectId, studyEventDefinitionId = request.studyEventDefinitionId, crfId = request.crfId, formData = request.formData, electronicSignature = request.electronicSignature;
        studyOid = "S_".concat(studyId);
        subjectOid = "SS_".concat(subjectId);
        eventOid = "SE_".concat(studyEventDefinitionId);
        formOid = "F_".concat(crfId);
        timestamp = new Date().toISOString();
        odmXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ODM xmlns=\"http://www.cdisc.org/ns/odm/v1.3\"\n     xmlns:OpenClinica=\"http://www.openclinica.org/ns/odm_ext_v130/v3.1\"\n     ODMVersion=\"1.3\"\n     FileType=\"Transactional\"\n     FileOID=\"ODM-".concat(Date.now(), "\"\n     CreationDateTime=\"").concat(timestamp, "\">\n  <ClinicalData StudyOID=\"").concat(studyOid, "\" MetaDataVersionOID=\"v1.0.0\">\n    <SubjectData SubjectKey=\"").concat(subjectOid, "\">\n      <StudyEventData StudyEventOID=\"").concat(eventOid, "\" StudyEventRepeatKey=\"1\">\n        <FormData FormOID=\"").concat(formOid, "\">");
        // Build item groups and items from form data
        for (_i = 0, _a = Object.entries(formData); _i < _a.length; _i++) {
            _b = _a[_i], itemGroupOid = _b[0], items = _b[1];
            if (typeof items === 'object' && items !== null) {
                odmXml += "\n          <ItemGroupData ItemGroupOID=\"".concat(itemGroupOid, "\" ItemGroupRepeatKey=\"1\">");
                for (_c = 0, _d = Object.entries(items); _c < _d.length; _c++) {
                    _e = _d[_c], itemOid = _e[0], value = _e[1];
                    escapedValue = escapeXml(String(value));
                    odmXml += "\n            <ItemData ItemOID=\"".concat(itemOid, "\" Value=\"").concat(escapedValue, "\"/>");
                }
                odmXml += "\n          </ItemGroupData>";
            }
        }
        odmXml += "\n        </FormData>";
        // Add electronic signature if provided
        if (electronicSignature) {
            odmXml += buildElectronicSignatureXml(electronicSignature, timestamp);
        }
        odmXml += "\n      </StudyEventData>\n    </SubjectData>\n  </ClinicalData>\n</ODM>";
        return [2 /*return*/, odmXml];
    });
}); };
exports.buildOdmXml = buildOdmXml;
/**
 * Build electronic signature XML section
 */
function buildElectronicSignatureXml(signature, timestamp) {
    var username = signature.username, meaning = signature.meaning;
    return "\n        <AuditRecord>\n          <UserRef UserOID=\"".concat(username, "\"/>\n          <LocationRef LocationOID=\"API\"/>\n          <DateTimeStamp>").concat(timestamp, "</DateTimeStamp>\n          <ReasonForChange>Electronic Signature: ").concat(meaning, "</ReasonForChange>\n          <SourceID>").concat(username, "</SourceID>\n        </AuditRecord>");
}
/**
 * Parse data import response from SOAP
 */
var parseImportResponse = function (responseData) { return __awaiter(void 0, void 0, void 0, function () {
    var result, parser, parsed, clinicalData, error_2;
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return __generator(this, function (_j) {
        switch (_j.label) {
            case 0:
                _j.trys.push([0, 4, , 5]);
                result = {
                    success: true,
                    validationErrors: [],
                    warnings: []
                };
                if (!(typeof responseData === 'string')) return [3 /*break*/, 2];
                result.odmResponse = responseData;
                parser = new xml2js_1.default.Parser();
                return [4 /*yield*/, parser.parseStringPromise(responseData)];
            case 1:
                parsed = _j.sent();
                // Check for validation errors in response
                if ((_a = parsed.ODM) === null || _a === void 0 ? void 0 : _a.ClinicalData) {
                    clinicalData = parsed.ODM.ClinicalData[0];
                    // Extract event CRF ID if available
                    if ((_h = (_g = (_f = (_e = (_d = (_c = (_b = clinicalData.SubjectData) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.StudyEventData) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.FormData) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.$) === null || _h === void 0 ? void 0 : _h.EventCRFOID) {
                        result.eventCrfId = parseInt(clinicalData.SubjectData[0].StudyEventData[0].FormData[0].$.EventCRFOID.replace('EC_', ''));
                    }
                    // Check for errors
                    if (clinicalData.Errors) {
                        result.validationErrors = parseValidationErrors(clinicalData.Errors);
                    }
                    // Check for warnings
                    if (clinicalData.Warnings) {
                        result.warnings = parseWarnings(clinicalData.Warnings);
                    }
                }
                return [3 /*break*/, 3];
            case 2:
                if (responseData.result) {
                    result.success = responseData.result === 'Success';
                    result.eventCrfId = responseData.eventCrfId;
                }
                _j.label = 3;
            case 3: return [2 /*return*/, result];
            case 4:
                error_2 = _j.sent();
                logger_1.logger.error('Failed to parse import response', { error: error_2.message });
                return [2 /*return*/, {
                        success: false,
                        validationErrors: [{
                                itemOid: 'unknown',
                                message: 'Failed to parse response',
                                severity: 'error'
                            }]
                    }];
            case 5: return [2 /*return*/];
        }
    });
}); };
exports.parseImportResponse = parseImportResponse;
/**
 * Parse validation errors from ODM response
 */
function parseValidationErrors(errors) {
    var validationErrors = [];
    try {
        if (Array.isArray(errors)) {
            for (var _i = 0, errors_1 = errors; _i < errors_1.length; _i++) {
                var error = errors_1[_i];
                validationErrors.push({
                    itemOid: error.ItemOID || 'unknown',
                    message: error.Message || error.message || 'Validation error',
                    severity: 'error'
                });
            }
        }
        else if (errors.Error) {
            var errorList = Array.isArray(errors.Error) ? errors.Error : [errors.Error];
            for (var _a = 0, errorList_1 = errorList; _a < errorList_1.length; _a++) {
                var error = errorList_1[_a];
                validationErrors.push({
                    itemOid: error.$.ItemOID || 'unknown',
                    message: error._ || error.Message || 'Validation error',
                    severity: 'error'
                });
            }
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to parse validation errors', { error: error.message });
    }
    return validationErrors;
}
/**
 * Parse warnings from ODM response
 */
function parseWarnings(warnings) {
    var warningList = [];
    try {
        if (Array.isArray(warnings)) {
            warningList.push.apply(warningList, warnings.map(function (w) { return w.Message || w.toString(); }));
        }
        else if (warnings.Warning) {
            var warnArray = Array.isArray(warnings.Warning) ? warnings.Warning : [warnings.Warning];
            warningList.push.apply(warningList, warnArray.map(function (w) { return w._ || w.Message || w.toString(); }));
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to parse warnings', { error: error.message });
    }
    return warningList;
}
/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
/**
 * Build ODM XML for a single item data entry
 */
var buildItemDataOdm = function (studyOid, subjectOid, eventOid, formOid, itemGroupOid, itemOid, value) {
    var timestamp = new Date().toISOString();
    var escapedValue = escapeXml(value);
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ODM xmlns=\"http://www.cdisc.org/ns/odm/v1.3\"\n     ODMVersion=\"1.3\"\n     FileType=\"Transactional\"\n     FileOID=\"ODM-".concat(Date.now(), "\"\n     CreationDateTime=\"").concat(timestamp, "\">\n  <ClinicalData StudyOID=\"").concat(studyOid, "\" MetaDataVersionOID=\"v1.0.0\">\n    <SubjectData SubjectKey=\"").concat(subjectOid, "\">\n      <StudyEventData StudyEventOID=\"").concat(eventOid, "\" StudyEventRepeatKey=\"1\">\n        <FormData FormOID=\"").concat(formOid, "\">\n          <ItemGroupData ItemGroupOID=\"").concat(itemGroupOid, "\" ItemGroupRepeatKey=\"1\">\n            <ItemData ItemOID=\"").concat(itemOid, "\" Value=\"").concat(escapedValue, "\"/>\n          </ItemGroupData>\n        </FormData>\n      </StudyEventData>\n    </SubjectData>\n  </ClinicalData>\n</ODM>");
};
exports.buildItemDataOdm = buildItemDataOdm;
/**
 * Validate ODM XML structure
 */
var validateOdmStructure = function (odmXml) {
    var errors = [];
    // Check for required elements
    if (!odmXml.includes('<ODM')) {
        errors.push('Missing ODM root element');
    }
    if (!odmXml.includes('<ClinicalData')) {
        errors.push('Missing ClinicalData element');
    }
    if (!odmXml.includes('<SubjectData')) {
        errors.push('Missing SubjectData element');
    }
    // Check for well-formed XML
    try {
        var parser = new xml2js_1.default.Parser();
        parser.parseString(odmXml, function (err) {
            if (err) {
                errors.push("XML parsing error: ".concat(err.message));
            }
        });
    }
    catch (error) {
        errors.push("Invalid XML structure: ".concat(error.message));
    }
    return {
        isValid: errors.length === 0,
        errors: errors
    };
};
exports.validateOdmStructure = validateOdmStructure;
exports.default = {
    importData: exports.importData,
    buildOdmXml: exports.buildOdmXml,
    parseImportResponse: exports.parseImportResponse,
    buildItemDataOdm: exports.buildItemDataOdm,
    validateOdmStructure: exports.validateOdmStructure
};
