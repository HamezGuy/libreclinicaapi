"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var winston_1 = require("winston");
var environment_1 = require("./environment");
var path_1 = require("path");
var fs_1 = require("fs");
// Ensure logs directory exists
if (!fs_1.default.existsSync(environment_1.config.logging.filePath)) {
    fs_1.default.mkdirSync(environment_1.config.logging.filePath, { recursive: true });
}
var logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json());
var consoleFormat = winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.printf(function (_a) {
    var timestamp = _a.timestamp, level = _a.level, message = _a.message, metadata = __rest(_a, ["timestamp", "level", "message"]);
    var msg = "".concat(timestamp, " [").concat(level, "]: ").concat(message);
    if (Object.keys(metadata).length > 0 && metadata.timestamp === undefined) {
        msg += " ".concat(JSON.stringify(metadata));
    }
    return msg;
}));
exports.logger = winston_1.default.createLogger({
    level: environment_1.config.logging.level,
    format: logFormat,
    transports: [
        // Console for development
        new winston_1.default.transports.Console({
            format: consoleFormat
        }),
        // Error log file
        new winston_1.default.transports.File({
            filename: path_1.default.join(environment_1.config.logging.filePath, 'error.log'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 100,
            tailable: true
        }),
        // Combined log file
        new winston_1.default.transports.File({
            filename: path_1.default.join(environment_1.config.logging.filePath, 'combined.log'),
            maxsize: 10485760,
            maxFiles: 100,
            tailable: true
        }),
        // Audit log file (21 CFR Part 11 requirement - retain for 7 years)
        new winston_1.default.transports.File({
            filename: path_1.default.join(environment_1.config.logging.filePath, 'audit.log'),
            level: 'info',
            maxsize: 10485760,
            maxFiles: 1000, // Keep many files for 7-year retention
            tailable: true
        })
    ],
    // Handle uncaught exceptions
    exceptionHandlers: [
        new winston_1.default.transports.File({
            filename: path_1.default.join(environment_1.config.logging.filePath, 'exceptions.log')
        })
    ],
    // Handle unhandled promise rejections
    rejectionHandlers: [
        new winston_1.default.transports.File({
            filename: path_1.default.join(environment_1.config.logging.filePath, 'rejections.log')
        })
    ]
});
// Log startup
exports.logger.info('Logger initialized', {
    level: environment_1.config.logging.level,
    environment: environment_1.config.server.env
});
