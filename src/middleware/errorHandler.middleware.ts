/**
 * Error Handler Middleware
 * 
 * Global error handling for the API
 * - Catches and formats all errors
 * - Prevents sensitive data exposure
 * - Provides user-friendly error messages
 * - Logs errors for debugging
 * 
 * Compliance: 21 CFR Part 11 §11.10(c) - Protection of Records
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Custom error class with additional properties
 */
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: any;

  constructor(
    statusCode: number,
    message: string,
    isOperational = true,
    details?: any,
    stack = ''
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Common API errors
 */
export class BadRequestError extends ApiError {
  constructor(message = 'Bad Request', details?: any) {
    super(400, message, true, details);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message, true);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, message, true);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(404, message, true);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict', details?: any) {
    super(409, message, true, details);
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation Error', details?: any) {
    super(422, message, true, details);
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal Server Error') {
    super(500, message, false);
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service Unavailable') {
    super(503, message, false);
  }
}

/**
 * Convert error to API error format
 */
const convertToApiError = (err: any): ApiError => {
  // Already an API error
  if (err instanceof ApiError) {
    return err;
  }

  // Database errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        return new ConflictError('Duplicate entry found', { field: err.constraint });
      case '23503': // Foreign key violation
        return new BadRequestError('Referenced resource not found', { field: err.constraint });
      case '23502': // Not null violation
        return new BadRequestError('Required field missing', { field: err.column });
      case '22P02': // Invalid text representation
        return new BadRequestError('Invalid data format');
      case 'ECONNREFUSED':
        return new ServiceUnavailableError('Database connection refused');
      default:
        logger.error('Unhandled database error', { code: err.code, message: err.message, detail: err.detail });
        return new InternalServerError('Database error');
    }
  }

  // SOAP/Network errors
  if (err.code === 'ECONNREFUSED') {
    return new ServiceUnavailableError('LibreClinica service unavailable');
  }

  if (err.code === 'ETIMEDOUT') {
    return new ServiceUnavailableError('Request timeout');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return new UnauthorizedError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return new UnauthorizedError('Token expired');
  }

  // Default to internal server error
  return new InternalServerError(err.message || 'An unexpected error occurred');
};

/**
 * Global error handler middleware
 * Must be the last middleware in the chain
 */
export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const apiError = convertToApiError(err);

  // Log error details
  const errorLog = {
    message: apiError.message,
    statusCode: apiError.statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: (req as any).user?.userId,
    username: (req as any).user?.username,
    stack: apiError.stack,
    details: apiError.details
  };

  if (apiError.statusCode >= 500) {
    logger.error('Server error', errorLog);
  } else if (apiError.statusCode >= 400) {
    logger.warn('Client error', errorLog);
  }

  // Prepare response
  const response: any = {
    success: false,
    message: apiError.message,
    statusCode: apiError.statusCode
  };

  // Include details for client errors (4xx) in development
  if (apiError.statusCode < 500 && apiError.details) {
    response.details = apiError.details;
  }

  // Include stack trace in development mode only
  if (process.env.NODE_ENV === 'development' && apiError.stack) {
    response.stack = apiError.stack;
  }

  // Send response
  res.status(apiError.statusCode).json(response);
};

/**
 * 404 handler for undefined routes
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  next(error);
};

/**
 * Async handler wrapper
 * Catches errors in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default errorHandler;

