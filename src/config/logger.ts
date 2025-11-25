import winston from 'winston';
import { config } from './environment';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
if (!fs.existsSync(config.logging.filePath)) {
  fs.mkdirSync(config.logging.filePath, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0 && metadata.timestamp === undefined) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // Console for development
    new winston.transports.Console({
      format: consoleFormat
    }),
    
    // Error log file
    new winston.transports.File({
      filename: path.join(config.logging.filePath, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 100,
      tailable: true
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: path.join(config.logging.filePath, 'combined.log'),
      maxsize: 10485760,
      maxFiles: 100,
      tailable: true
    }),
    
    // Audit log file (21 CFR Part 11 requirement - retain for 7 years)
    new winston.transports.File({
      filename: path.join(config.logging.filePath, 'audit.log'),
      level: 'info',
      maxsize: 10485760,
      maxFiles: 1000, // Keep many files for 7-year retention
      tailable: true
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(config.logging.filePath, 'exceptions.log') 
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(config.logging.filePath, 'rejections.log') 
    })
  ]
});

// Log startup
logger.info('Logger initialized', {
  level: config.logging.level,
  environment: config.server.env
});

