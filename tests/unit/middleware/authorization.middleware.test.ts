/**
 * Unit Tests for Authorization Middleware
 * Tests role matching, requireRole(), and requireStudyAccess().
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockPoolQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('../../../src/config/database', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

jest.mock('../../../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { requireRole, requireStudyAccess } from '../../../src/middleware/authorization.middleware';
import type { AuthRequest } from '../../../src/middleware/auth.middleware';

function mockReqResNext(
  user?: AuthRequest['user'],
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  query: Record<string, unknown> = {}
) {
  const jsonSpy = jest.fn();
  const statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
  const req = { user, params, body, query, path: '/test' } as unknown as Request;
  (req as AuthRequest).user = user;
  return {
    req, jsonSpy, statusSpy,
    res: { status: statusSpy, json: jsonSpy } as unknown as Response,
    next: jest.fn() as unknown as NextFunction,
  };
}

describe('Authorization Middleware', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('requireRole', () => {
    it('should return 401 when user is not attached to request', async () => {
      const middleware = requireRole('admin');
      const { req, res, next, statusSpy } = mockReqResNext(undefined);
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass admin users through immediately (fast path)', async () => {
      const middleware = requireRole('data_manager');
      const user = { userId: 1, userName: 'admin1', email: 'a@a.com', userType: 'sysadmin', role: 'admin' };
      const { req, res, next, statusSpy } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('should pass when token role matches allowed role directly', async () => {
      const middleware = requireRole('investigator');
      const user = { userId: 2, userName: 'inv1', email: 'i@i.com', userType: 'investigator', role: 'investigator' };
      const { req, res, next } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass when token role matches via alias (crc -> coordinator)', async () => {
      const middleware = requireRole('coordinator');
      const user = { userId: 3, userName: 'crc1', email: 'c@c.com', userType: 'crc', role: 'crc' };
      const { req, res, next } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should fall back to DB query when token role does not match', async () => {
      const middleware = requireRole('admin');
      const user = { userId: 4, userName: 'viewer1', email: 'v@v.com', userType: 'viewer', role: 'viewer' };
      mockPoolQuery.mockResolvedValue({ rows: [{ role_name: 'admin' }] });
      const { req, res, next } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(mockPoolQuery).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should return 403 when DB role also does not match', async () => {
      const middleware = requireRole('admin');
      const user = { userId: 5, userName: 'v2', email: 'v@v.com', userType: 'viewer', role: 'viewer' };
      mockPoolQuery.mockResolvedValue({ rows: [{ role_name: 'viewer' }] });
      const { req, res, next, statusSpy } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 500 when DB query throws', async () => {
      const middleware = requireRole('data_manager');
      const user = { userId: 6, userName: 'u6', email: 'u@u.com', userType: 'viewer', role: 'viewer' };
      mockPoolQuery.mockRejectedValue(new Error('connection failed'));
      const { req, res, next, statusSpy } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(500);
    });

    it('should accept system_administrator as admin alias', async () => {
      const middleware = requireRole('data_manager');
      const user = { userId: 7, userName: 'sa', email: 's@s.com', userType: 'system_administrator', role: 'system_administrator' };
      const { req, res, next } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should accept multiple allowed roles', async () => {
      const middleware = requireRole('admin', 'data_manager', 'coordinator');
      const user = { userId: 8, userName: 'dm', email: 'd@d.com', userType: 'data_manager', role: 'data_manager' };
      const { req, res, next } = mockReqResNext(user);
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireStudyAccess', () => {
    it('should return 401 when user is not attached', async () => {
      const middleware = requireStudyAccess();
      const { req, res, next, statusSpy } = mockReqResNext(undefined, { studyId: '1' });
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(401);
    });

    it('should return 400 when studyId is missing', async () => {
      const middleware = requireStudyAccess();
      const user = { userId: 1, userName: 'u', email: 'e@e.com', userType: 'admin', role: 'admin' };
      const { req, res, next, statusSpy } = mockReqResNext(user, {});
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(400);
    });

    it('should pass sysadmin through without DB check', async () => {
      const middleware = requireStudyAccess();
      const user = { userId: 1, userName: 'sa', email: 'e@e.com', userType: 'sysadmin', role: 'admin' };
      const { req, res, next } = mockReqResNext(user, { studyId: '5' });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('should return 403 when user has no study access', async () => {
      const middleware = requireStudyAccess();
      const user = { userId: 2, userName: 'u2', email: 'e@e.com', userType: 'investigator', role: 'investigator' };
      mockPoolQuery.mockResolvedValue({ rows: [{ count: '0' }] });
      const { req, res, next, statusSpy } = mockReqResNext(user, { studyId: '10' });
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(403);
    });

    it('should pass when user has study access', async () => {
      const middleware = requireStudyAccess();
      const user = { userId: 3, userName: 'u3', email: 'e@e.com', userType: 'investigator', role: 'investigator' };
      mockPoolQuery.mockResolvedValue({ rows: [{ count: '1' }] });
      const { req, res, next } = mockReqResNext(user, { studyId: '10' });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should use custom studyIdParam', async () => {
      const middleware = requireStudyAccess('sid');
      const user = { userId: 4, userName: 'u4', email: 'e@e.com', userType: 'coordinator', role: 'coordinator' };
      mockPoolQuery.mockResolvedValue({ rows: [{ count: '1' }] });
      const { req, res, next } = mockReqResNext(user, { sid: '20' });
      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 500 when DB query throws', async () => {
      const middleware = requireStudyAccess();
      const user = { userId: 5, userName: 'u5', email: 'e@e.com', userType: 'coordinator', role: 'coordinator' };
      mockPoolQuery.mockRejectedValue(new Error('timeout'));
      const { req, res, next, statusSpy } = mockReqResNext(user, { studyId: '1' });
      await middleware(req, res, next);
      expect(statusSpy).toHaveBeenCalledWith(500);
    });
  });
});
