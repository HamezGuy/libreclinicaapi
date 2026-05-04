/**
 * Unit Tests for Auth Middleware
 * Tests JWT verification, missing/invalid headers, and user attachment.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// Mock jwt
const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: (...args: unknown[]) => mockVerify(...args) },
  verify: (...args: unknown[]) => mockVerify(...args),
}));

// Mock config
jest.mock('../../../src/config/environment', () => ({
  config: { jwt: { secret: 'test-secret-key', expiresIn: '8h' } },
}));

// Mock logger
jest.mock('../../../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../../../src/middleware/auth.middleware';

function mockReqResNext(headers: Record<string, string> = {}): {
  req: Partial<Request>;
  res: Partial<Response>;
  next: NextFunction;
  jsonSpy: jest.Mock;
  statusSpy: jest.Mock;
} {
  const jsonSpy = jest.fn();
  const statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
  return {
    req: { headers, path: '/api/test', ip: '127.0.0.1' } as Partial<Request>,
    res: { status: statusSpy, json: jsonSpy } as Partial<Response>,
    next: jest.fn() as unknown as NextFunction,
    jsonSpy,
    statusSpy,
  };
}

describe('Auth Middleware', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('authMiddleware', () => {
    it('should return 401 when Authorization header is missing', () => {
      const { req, res, next, statusSpy, jsonSpy } = mockReqResNext({});
      authMiddleware(req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', () => {
      const { req, res, next, statusSpy } = mockReqResNext({ authorization: 'Basic abc123' });
      authMiddleware(req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token is invalid', () => {
      mockVerify.mockImplementation(() => { throw new Error('invalid signature'); });
      const { req, res, next, statusSpy } = mockReqResNext({ authorization: 'Bearer bad-token' });
      authMiddleware(req as Request, res as Response, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next and attach user when token is valid', () => {
      const payload = {
        userId: 42, userName: 'testuser', email: 'test@example.com',
        userType: 'admin', role: 'admin', studyIds: [1], organizationIds: [10],
      };
      mockVerify.mockReturnValue(payload);
      const { req, res, next, statusSpy } = mockReqResNext({ authorization: 'Bearer valid-token' });
      authMiddleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
      const authReq = req as AuthRequest;
      expect(authReq.user?.userId).toBe(42);
      expect(authReq.user?.userName).toBe('testuser');
      expect(authReq.user?.role).toBe('admin');
    });

    it('should fallback role to userType when role is missing from token', () => {
      mockVerify.mockReturnValue({ userId: 1, userName: 'u', email: 'e@e.com', userType: 'investigator' });
      const { req, res, next } = mockReqResNext({ authorization: 'Bearer valid' });
      authMiddleware(req as Request, res as Response, next);
      expect((req as AuthRequest).user?.role).toBe('investigator');
    });

    it('should default organizationIds to empty array when missing', () => {
      mockVerify.mockReturnValue({ userId: 1, userName: 'u', email: 'e@e.com', userType: 'admin', role: 'admin' });
      const { req, res, next } = mockReqResNext({ authorization: 'Bearer valid' });
      authMiddleware(req as Request, res as Response, next);
      expect((req as AuthRequest).user?.organizationIds).toEqual([]);
    });
  });

  describe('optionalAuthMiddleware', () => {
    it('should call next without user when no Authorization header', () => {
      const { req, res, next } = mockReqResNext({});
      optionalAuthMiddleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req as AuthRequest).user).toBeUndefined();
    });

    it('should attach user when valid token is present', () => {
      mockVerify.mockReturnValue({ userId: 5, userName: 'opt', email: 'o@o.com', userType: 'viewer', role: 'viewer' });
      const { req, res, next } = mockReqResNext({ authorization: 'Bearer valid' });
      optionalAuthMiddleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req as AuthRequest).user?.userId).toBe(5);
    });

    it('should call next without user when token is invalid', () => {
      mockVerify.mockImplementation(() => { throw new Error('expired'); });
      const { req, res, next } = mockReqResNext({ authorization: 'Bearer bad' });
      optionalAuthMiddleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req as AuthRequest).user).toBeUndefined();
    });
  });
});
