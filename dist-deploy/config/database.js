"use strict";
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
exports.pool = exports.db = void 0;
var pg_1 = require("pg");
var environment_1 = require("./environment");
var logger_1 = require("./logger");
var DatabaseConnection = /** @class */ (function () {
    function DatabaseConnection() {
        // Use test database in test environment
        if (process.env.NODE_ENV === 'test') {
            // Import test database pool
            try {
                var testDb = require('../../tests/utils/test-db').testDb;
                this.pool = testDb.pool;
                logger_1.logger.info('Using in-memory test database');
                return;
            }
            catch (error) {
                logger_1.logger.warn('Could not load test database, using regular pool');
            }
        }
        // Log the database configuration for debugging
        logger_1.logger.info('Database configuration', {
            host: environment_1.config.libreclinica.database.host,
            port: environment_1.config.libreclinica.database.port,
            database: environment_1.config.libreclinica.database.database,
            user: environment_1.config.libreclinica.database.user,
            connectionTimeoutMillis: environment_1.config.libreclinica.database.connectionTimeoutMillis
        });
        this.pool = new pg_1.Pool(environment_1.config.libreclinica.database);
        // Test connection on startup
        this.pool.on('connect', function () {
            logger_1.logger.info('Database connection established');
        });
        this.pool.on('error', function (err) {
            logger_1.logger.error('Unexpected database error', { error: err.message });
        });
        // Test the connection immediately
        this.testConnection();
    }
    DatabaseConnection.prototype.testConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            var client, result, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.pool.connect()];
                    case 1:
                        client = _a.sent();
                        return [4 /*yield*/, client.query('SELECT NOW()')];
                    case 2:
                        result = _a.sent();
                        logger_1.logger.info('Database connection test successful', {
                            serverTime: result.rows[0].now
                        });
                        client.release();
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        logger_1.logger.error('Database connection test failed', {
                            error: error_1.message
                        });
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseConnection.prototype.query = function (text, params) {
        return __awaiter(this, void 0, void 0, function () {
            var start, result, duration, error_2, duration;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        start = Date.now();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.pool.query(text, params)];
                    case 2:
                        result = _a.sent();
                        duration = Date.now() - start;
                        logger_1.logger.debug('Database query executed', {
                            duration: duration,
                            rows: result.rowCount,
                            query: text.substring(0, 100) // Log first 100 chars
                        });
                        return [2 /*return*/, result];
                    case 3:
                        error_2 = _a.sent();
                        duration = Date.now() - start;
                        logger_1.logger.error('Database query error', {
                            error: error_2.message,
                            duration: duration,
                            query: text.substring(0, 100)
                        });
                        throw error_2;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseConnection.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.pool.connect()];
            });
        });
    };
    DatabaseConnection.prototype.end = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.pool.end()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    DatabaseConnection.prototype.getClient = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.pool.connect()];
            });
        });
    };
    DatabaseConnection.prototype.transaction = function (callback) {
        return __awaiter(this, void 0, void 0, function () {
            var client, result, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.pool.connect()];
                    case 1:
                        client = _a.sent();
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 6, 8, 9]);
                        return [4 /*yield*/, client.query('BEGIN')];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, callback(client)];
                    case 4:
                        result = _a.sent();
                        return [4 /*yield*/, client.query('COMMIT')];
                    case 5:
                        _a.sent();
                        return [2 /*return*/, result];
                    case 6:
                        error_3 = _a.sent();
                        return [4 /*yield*/, client.query('ROLLBACK')];
                    case 7:
                        _a.sent();
                        throw error_3;
                    case 8:
                        client.release();
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseConnection.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.pool.end()];
                    case 1:
                        _a.sent();
                        logger_1.logger.info('Database connection pool closed');
                        return [2 /*return*/];
                }
            });
        });
    };
    return DatabaseConnection;
}());
exports.db = new DatabaseConnection();
exports.pool = exports.db; // Alias db as pool since it has query/connect methods now
