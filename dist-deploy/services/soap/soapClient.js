"use strict";
/**
 * SOAP Client
 *
 * Custom SOAP client for LibreClinica Web Services
 * - Uses raw HTTP with WS-Security headers (LibreClinica specific)
 * - Handles authentication with MD5-hashed passwords
 * - Provides retry logic and error handling
 *
 * LibreClinica SOAP Web Services (at /libreclinica-ws/ws):
 * - Study Service: Uses v1:listAllRequest, v1:getMetadataRequest
 * - StudySubject Service: Uses v1:createRequest, v1:listAllByStudyRequest
 * - Data Service: Uses v1:importRequest
 * - Event Service: Uses v1:scheduleRequest
 *
 * IMPORTANT: LibreClinica requires WS-Security UsernameToken with MD5-hashed password!
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
exports.resetSoapClient = exports.getSoapClient = exports.SoapClient = void 0;
var axios_1 = require("axios");
var environment_1 = require("../../config/environment");
var logger_1 = require("../../config/logger");
var xml2js_1 = require("xml2js");
/**
 * Namespace mappings for LibreClinica SOAP services
 */
var SOAP_NAMESPACES = {
    study: 'http://openclinica.org/ws/study/v1',
    studySubject: 'http://openclinica.org/ws/studySubject/v1',
    data: 'http://openclinica.org/ws/data/v1',
    event: 'http://openclinica.org/ws/event/v1'
};
/**
 * SOAP Client Class
 * Custom implementation for LibreClinica's WS-Security requirements
 */
var SoapClient = /** @class */ (function () {
    function SoapClient() {
        // Configuration with MD5-hashed password for WS-Security
        // LibreClinica 1.4: WS-Security improved, reduced timeout/retries needed
        this.config = {
            baseUrl: environment_1.config.libreclinica.soapUrl || 'http://localhost:8090/libreclinica-ws/ws',
            username: environment_1.config.libreclinica.soapUsername || 'root',
            password: environment_1.config.libreclinica.soapPassword || '25d55ad283aa400af464c76d713c07ad',
            timeout: 15000, // Reduced - LC 1.4 is more responsive with fixed WS-Security
            maxRetries: 2 // Reduced - LC 1.4 WS-Security works reliably now
        };
        // Create HTTP client
        this.httpClient = axios_1.default.create({
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'Accept': 'text/xml, application/xml'
            }
        });
    }
    /**
     * Build WS-Security SOAP envelope
     */
    SoapClient.prototype.buildSoapEnvelope = function (serviceName, methodName, parameters) {
        var namespace = SOAP_NAMESPACES[serviceName];
        // Convert parameters to XML elements
        var parametersXml = this.buildParametersXml(parameters);
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" \n                  xmlns:v1=\"".concat(namespace, "\"\n                  xmlns:wsse=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\">\n   <soapenv:Header>\n      <wsse:Security soapenv:mustUnderstand=\"1\">\n         <wsse:UsernameToken>\n            <wsse:Username>").concat(this.config.username, "</wsse:Username>\n            <wsse:Password Type=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText\">").concat(this.config.password, "</wsse:Password>\n         </wsse:UsernameToken>\n      </wsse:Security>\n   </soapenv:Header>\n   <soapenv:Body>\n      <v1:").concat(methodName, "Request>\n         ").concat(parametersXml, "\n      </v1:").concat(methodName, "Request>\n   </soapenv:Body>\n</soapenv:Envelope>");
    };
    /**
     * Convert parameters object to XML elements
     */
    SoapClient.prototype.buildParametersXml = function (params, prefix) {
        if (prefix === void 0) { prefix = 'v1'; }
        if (!params || Object.keys(params).length === 0) {
            return '';
        }
        var xml = '';
        for (var _i = 0, _a = Object.entries(params); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            if (value === null || value === undefined)
                continue;
            if (typeof value === 'object' && !Array.isArray(value)) {
                // Nested object
                xml += "<".concat(prefix, ":").concat(key, ">").concat(this.buildParametersXml(value, prefix), "</").concat(prefix, ":").concat(key, ">");
            }
            else if (Array.isArray(value)) {
                // Array - repeat the element
                for (var _c = 0, value_1 = value; _c < value_1.length; _c++) {
                    var item = value_1[_c];
                    if (typeof item === 'object') {
                        xml += "<".concat(prefix, ":").concat(key, ">").concat(this.buildParametersXml(item, prefix), "</").concat(prefix, ":").concat(key, ">");
                    }
                    else {
                        xml += "<".concat(prefix, ":").concat(key, ">").concat(this.escapeXml(String(item)), "</").concat(prefix, ":").concat(key, ">");
                    }
                }
            }
            else {
                xml += "<".concat(prefix, ":").concat(key, ">").concat(this.escapeXml(String(value)), "</").concat(prefix, ":").concat(key, ">");
            }
        }
        return xml;
    };
    /**
     * Escape special XML characters
     */
    SoapClient.prototype.escapeXml = function (str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };
    /**
     * Parse SOAP response
     */
    SoapClient.prototype.parseSoapResponse = function (xmlResponse) {
        return __awaiter(this, void 0, void 0, function () {
            var result, envelope, body, fault, bodyKeys, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, xml2js_1.parseStringPromise)(xmlResponse, {
                                explicitArray: false,
                                ignoreAttrs: false,
                                tagNameProcessors: [function (name) { return name.replace(/^.*:/, ''); }]
                            })];
                    case 1:
                        result = _a.sent();
                        envelope = result.Envelope || result['SOAP-ENV:Envelope'] || result;
                        body = envelope.Body || envelope['SOAP-ENV:Body'];
                        if (!body) {
                            throw new Error('No SOAP Body found in response');
                        }
                        fault = body.Fault || body['SOAP-ENV:Fault'];
                        if (fault) {
                            throw new Error(fault.faultstring || fault.faultcode || 'SOAP Fault');
                        }
                        bodyKeys = Object.keys(body).filter(function (k) { return k !== '$'; });
                        if (bodyKeys.length > 0) {
                            return [2 /*return*/, body[bodyKeys[0]]];
                        }
                        return [2 /*return*/, body];
                    case 2:
                        error_1 = _a.sent();
                        logger_1.logger.error('Failed to parse SOAP response', { error: error_1.message });
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Execute SOAP request with retry logic
     */
    SoapClient.prototype.executeRequest = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var serviceName, methodName, parameters, userId, username, lastError, attempt, soapEnvelope, serviceUrl, startTime, response, duration, parsedResponse, error_2, statusCode, responseData, fault, _a;
            var _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        serviceName = options.serviceName, methodName = options.methodName, parameters = options.parameters, userId = options.userId, username = options.username;
                        logger_1.logger.info('Executing SOAP request', {
                            serviceName: serviceName,
                            methodName: methodName,
                            userId: userId,
                            username: username || 'system'
                        });
                        attempt = 1;
                        _e.label = 1;
                    case 1:
                        if (!(attempt <= this.config.maxRetries)) return [3 /*break*/, 13];
                        _e.label = 2;
                    case 2:
                        _e.trys.push([2, 5, , 12]);
                        soapEnvelope = this.buildSoapEnvelope(serviceName, methodName, parameters);
                        serviceUrl = "".concat(this.config.baseUrl, "/").concat(serviceName, "/v1");
                        logger_1.logger.debug('SOAP Request', {
                            url: serviceUrl,
                            serviceName: serviceName,
                            methodName: methodName
                        });
                        startTime = Date.now();
                        return [4 /*yield*/, this.httpClient.post(serviceUrl, soapEnvelope)];
                    case 3:
                        response = _e.sent();
                        duration = Date.now() - startTime;
                        logger_1.logger.info('SOAP request successful', {
                            serviceName: serviceName,
                            methodName: methodName,
                            duration: duration,
                            attempt: attempt,
                            status: response.status
                        });
                        return [4 /*yield*/, this.parseSoapResponse(response.data)];
                    case 4:
                        parsedResponse = _e.sent();
                        return [2 /*return*/, {
                                success: true,
                                data: parsedResponse
                            }];
                    case 5:
                        error_2 = _e.sent();
                        lastError = error_2;
                        statusCode = (_b = error_2.response) === null || _b === void 0 ? void 0 : _b.status;
                        responseData = (_c = error_2.response) === null || _c === void 0 ? void 0 : _c.data;
                        logger_1.logger.warn("SOAP request failed (attempt ".concat(attempt, "/").concat(this.config.maxRetries, ")"), {
                            serviceName: serviceName,
                            methodName: methodName,
                            error: error_2.message,
                            statusCode: statusCode,
                            attempt: attempt
                        });
                        // Don't retry on authentication errors
                        if (statusCode === 401 || statusCode === 403) {
                            return [3 /*break*/, 13];
                        }
                        if (!responseData) return [3 /*break*/, 9];
                        _e.label = 6;
                    case 6:
                        _e.trys.push([6, 8, , 9]);
                        return [4 /*yield*/, this.parseSoapResponse(responseData)];
                    case 7:
                        fault = _e.sent();
                        logger_1.logger.debug('SOAP Fault details', { fault: fault });
                        return [3 /*break*/, 9];
                    case 8:
                        _a = _e.sent();
                        return [3 /*break*/, 9];
                    case 9:
                        if (!(attempt < this.config.maxRetries)) return [3 /*break*/, 11];
                        return [4 /*yield*/, this.delay(attempt * 1000)];
                    case 10:
                        _e.sent();
                        _e.label = 11;
                    case 11: return [3 /*break*/, 12];
                    case 12:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 13:
                        logger_1.logger.error('SOAP request failed after all retries', {
                            serviceName: serviceName,
                            methodName: methodName,
                            error: lastError.message
                        });
                        return [2 /*return*/, {
                                success: false,
                                error: lastError.message,
                                soapFault: (_d = lastError.response) === null || _d === void 0 ? void 0 : _d.data
                            }];
                }
            });
        });
    };
    /**
     * Test SOAP connection
     * Uses appropriate method for each service type
     */
    SoapClient.prototype.testConnection = function () {
        return __awaiter(this, arguments, void 0, function (serviceName) {
            var testService, result, error_3;
            if (serviceName === void 0) { serviceName = 'study'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        logger_1.logger.debug('Testing SOAP connection', { serviceName: serviceName });
                        testService = 'study';
                        return [4 /*yield*/, this.executeRequest({
                                serviceName: testService,
                                methodName: 'listAll',
                                parameters: {}
                            })];
                    case 1:
                        result = _a.sent();
                        logger_1.logger.info("SOAP connection test: ".concat(result.success ? 'SUCCESS' : 'FAILED'), {
                            serviceName: testService,
                            success: result.success
                        });
                        return [2 /*return*/, result.success];
                    case 2:
                        error_3 = _a.sent();
                        logger_1.logger.error("SOAP connection test failed", {
                            error: error_3.message
                        });
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Clear any cached state (for reconnection)
     */
    SoapClient.prototype.clearClients = function () {
        logger_1.logger.info('SOAP client state cleared');
        // Nothing to clear with our stateless HTTP approach
    };
    /**
     * Delay helper for retry logic
     */
    SoapClient.prototype.delay = function (ms) {
        return new Promise(function (resolve) { return setTimeout(resolve, ms); });
    };
    /**
     * Parse SOAP error
     */
    SoapClient.prototype.parseSoapError = function (error) {
        var _a;
        if ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) {
            var data = error.response.data;
            if (typeof data === 'string' && data.includes('faultstring')) {
                var match = data.match(/<faultstring>([^<]+)<\/faultstring>/);
                if (match) {
                    return match[1];
                }
            }
        }
        return error.message || 'Unknown SOAP error';
    };
    /**
     * Get configuration (for diagnostics)
     */
    SoapClient.prototype.getConfig = function () {
        return {
            baseUrl: this.config.baseUrl,
            username: this.config.username,
            passwordSet: !!this.config.password
        };
    };
    return SoapClient;
}());
exports.SoapClient = SoapClient;
/**
 * Singleton instance
 */
var soapClientInstance = null;
/**
 * Get SOAP client singleton
 */
var getSoapClient = function () {
    if (!soapClientInstance) {
        soapClientInstance = new SoapClient();
    }
    return soapClientInstance;
};
exports.getSoapClient = getSoapClient;
/**
 * Reset SOAP client singleton (useful for testing/reconnection)
 */
var resetSoapClient = function () {
    soapClientInstance = null;
};
exports.resetSoapClient = resetSoapClient;
exports.default = exports.getSoapClient;
