/**
 * Unit Tests for Error Handler Middleware
 * Tests ApiError classes, errorHandler, notFoundHandler, asyncHandler.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

jest.mock('../../../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
  ServiceUnavailableError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
} from '../../../src/middleware/errorHandler.middleware';

function mockReqRes() {
  const jsonSpy = jest.fn();
  const statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
  return {
    req: { path: '/api/test', method: 'GET', ip: '127.0.0.1' } as Partial<Request>,
    res: { status: statusSpy, json: jsonSpy } as Partial<Response>,
    next: jest.fn() as unknown as NextFunction,
    jsonSpy,
    statusSpy,
  };
}

describe('Error Handler Middleware', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('ApiError classes', () => {
    it('should create ApiError with correct properties', () => {
      const err = new ApiError(418, 'I am a teapot', true, { tea: true });
      expect(err.statusCode).toBe(418);
      expect(err.message).toBe('I am a teapot');
      expect(err.isOperational).toBe(true);
      expect(err.details).toEqual({ tea: true });
      expect(err.stack).toBeDefined();
    });

    it('should create BadRequestError with status 400', () => {
      const err = new BadRequestError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Bad Request');
    });

    it('should create BadRequestError with custom message and details', () => {
      const err = new BadRequestError('Invalid input', { field: 'name' });
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Invalid input');
      expect(err.details).toEqual({ field: 'name' });
    });

    it('should create UnauthorizedError with status 401', () => {
      expect(new UnauthorizedError().statusCode).toBe(401);
    });

    it('should create ForbiddenError with status 403', () => {
      expect(new ForbiddenError().statusCode).toBe(403);
    });

    it('should create NotFoundError with status 404', () => {
      expect(new NotFoundError().statusCode).toBe(404);
    });

    it('should create ConflictError with status 409', () => {
      expect(new ConflictError().statusCode).toBe(409);
    });

    it('should create ValidationError with status 422', () => {
      expect(new ValidationError().statusCode).toBe(422);
    });

    it('should create InternalServerError with status 500 and isOperational=false', () => {
      const err = new InternalServerError();
      expect(err.statusCode).toBe(500);
      expect(err.isOperational).toBe(false);
    });

    it('should create ServiceUnavailableError with status 503', () => {
      expect(new ServiceUnavailableError().statusCode).toBe(503);
    });
  });

  describe('errorHandler', () => {
    it('should handle ApiError and return correct status', () => {
      const { req, res, next, statusSpy, jsonSpy } = mockReqRes();
      const err = new BadRequestError('Bad input', { field: 'age' });
      errorHandler(err, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Bad input',
        statusCode: 400,
        details: { field: 'age' },
      }));
    });

    it('should not include details for 5xx errors', () => {
      const { req, res, next, jsonSpy } = mockReqRes();
      errorHandler(new InternalServerError(), req as Request, res as Response, next);
      expect(jsonSpy).toHaveBeenCalledWith(expect.not.objectContaining({ details: expect.anything() }));
    });

    it('should convert database unique violation (23505) to ConflictError', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      const dbErr = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_email' });
      errorHandler(dbErr, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(409);
    });

    it('should convert database foreign key violation (23503) to BadRequestError', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      const dbErr = Object.assign(new Error('fk violation'), { code: '23503', constraint: 'fk_study' });
      errorHandler(dbErr, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });

    it('should convert database not-null violation (23502) to BadRequestError', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      const dbErr = Object.assign(new Error('not null'), { code: '23502', column: 'name' });
      errorHandler(dbErr, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });

    it('should convert JsonWebTokenError to UnauthorizedError', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      const jwtErr = new Error('invalid signature');
      jwtErr.name = 'JsonWebTokenError';
      errorHandler(jwtErr, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
    });

    it('should convert TokenExpiredError to UnauthorizedError', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      const jwtErr = new Error('jwt expired');
      jwtErr.name = 'TokenExpiredError';
      errorHandler(jwtErr, req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
    });

    it('should convert unknown errors to 500', () => {
      const { req, res, next, statusSpy } = mockReqRes();
      errorHandler(new Error('something broke'), req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(500);
    });
  });

  describe('notFoundHandler', () => {
    it('should call next with a NotFoundError containing path info', () => {
      const { req, res, next } = mockReqRes();
      notFoundHandler(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as NotFoundError;
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.message).toContain('GET');
      expect(err.message).toContain('/api/test');
    });
  });

  describe('asyncHandler', () => {
    it('should call the wrapped function and pass through on success', async () => {
      const handler = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const wrapped = asyncHandler(handler);
      const { req, res, next } = mockReqRes();
      await wrapped(req as Request, res as Response, next);
      expect(handler).toHaveBeenCalledWith(req, res, next);
    });

    it('should catch errors and pass them to next', async () => {
      const err = new Error('async failure');
      const handler = jest.fn<() => Promise<void>>().mockRejectedValue(err);
      const wrapped = asyncHandler(handler);
      const { req, res, next } = mockReqRes();
      await wrapped(req as Request, res as Response, next);
      // next is called with the error via .catch(next)
      await new Promise(r => setTimeout(r, 10));
      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
