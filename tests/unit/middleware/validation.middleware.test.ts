/**
 * Unit Tests for Validation Middleware
 * Tests Joi schema validation factory for body, query, and params.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

jest.mock('../../../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { validate } from '../../../src/middleware/validation.middleware';

function mockReqResNext(body = {}, query = {}, params = {}) {
  const jsonSpy = jest.fn();
  const statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
  return {
    req: { body, query, params, path: '/api/test' } as unknown as Request,
    res: { status: statusSpy, json: jsonSpy } as unknown as Response,
    next: jest.fn() as unknown as NextFunction,
    jsonSpy, statusSpy,
  };
}

describe('Validation Middleware', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('body validation', () => {
    const schema = { body: Joi.object({ name: Joi.string().required(), age: Joi.number().min(0) }) };

    it('should call next when body is valid', async () => {
      const { req, res, next, statusSpy } = mockReqResNext({ name: 'Alice', age: 30 });
      await validate(schema)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('should return 400 when required field is missing', async () => {
      const { req, res, next, statusSpy, jsonSpy } = mockReqResNext({ age: 30 });
      await validate(schema)(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Validation failed' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return all validation errors (abortEarly=false)', async () => {
      const { req, res, next, jsonSpy } = mockReqResNext({ age: -5 });
      await validate(schema)(req, res, next);
      const response = jsonSpy.mock.calls[0][0] as Record<string, unknown>;
      expect((response.errors as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it('should reject unknown fields in body (allowUnknown=false)', async () => {
      const { req, res, next, statusSpy } = mockReqResNext({ name: 'Alice', unknown: 'bad' });
      await validate(schema)(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });
  });

  describe('query validation', () => {
    const schema = { query: Joi.object({ page: Joi.number().integer().min(1) }) };

    it('should call next when query params are valid', async () => {
      const { req, res, next } = mockReqResNext({}, { page: 2 });
      await validate(schema)(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 400 for invalid query params', async () => {
      const { req, res, next, statusSpy } = mockReqResNext({}, { page: -1 });
      await validate(schema)(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });
  });

  describe('params validation', () => {
    const schema = { params: Joi.object({ id: Joi.number().integer().required() }) };

    it('should call next when URL params are valid', async () => {
      const { req, res, next } = mockReqResNext({}, {}, { id: '42' });
      await validate(schema)(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 400 for invalid URL params', async () => {
      const { req, res, next, statusSpy } = mockReqResNext({}, {}, { id: 'abc' });
      await validate(schema)(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });
  });

  describe('no schema provided', () => {
    it('should call next when no validation schemas are given', async () => {
      const { req, res, next } = mockReqResNext({ anything: true });
      await validate({})(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
