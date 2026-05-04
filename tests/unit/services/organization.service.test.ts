/**
 * Unit Tests for Organization Service
 *
 * Tests registration, lookup, and member listing.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnect = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect,
  },
  db: {
    query: mockQuery,
  },
}));

jest.mock('../../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Organization Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  // =========================================================================
  // registerOrganization
  // =========================================================================
  describe('registerOrganization', () => {
    it('should register org and admin user with valid data', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({});
      // INSERT org
      mockClientQuery.mockResolvedValueOnce({ rows: [{ organizationId: 10 }] });
      // username check
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // email check
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT user
      mockClientQuery.mockResolvedValueOnce({ rows: [{ userId: 42 }] });
      // UPDATE org owner
      mockClientQuery.mockResolvedValueOnce({});
      // INSERT membership
      mockClientQuery.mockResolvedValueOnce({});
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({});

      const { registerOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await registerOrganization({
        organizationDetails: { name: 'Acme', email: 'org@acme.com' },
        adminDetails: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@acme.com',
          password: 'Str0ng!',
          username: 'janedoe',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.organizationId).toBe(10);
      expect(result.data.userId).toBe(42);
    });

    it('should return error when username already exists', async () => {
      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [{ organizationId: 10 }] }); // INSERT org
      mockClientQuery.mockResolvedValueOnce({ rows: [{ userId: 99 }] }); // username check — duplicate
      mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

      const { registerOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await registerOrganization({
        organizationDetails: { name: 'Acme', email: 'org@acme.com' },
        adminDetails: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@acme.com',
          password: 'Str0ng!',
          username: 'janedoe',
        },
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Username already exists');
    });

    it('should return error when email already exists', async () => {
      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [{ organizationId: 10 }] }); // INSERT org
      mockClientQuery.mockResolvedValueOnce({ rows: [] }); // username check — ok
      mockClientQuery.mockResolvedValueOnce({ rows: [{ userId: 77 }] }); // email check — duplicate
      mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

      const { registerOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await registerOrganization({
        organizationDetails: { name: 'Acme', email: 'org@acme.com' },
        adminDetails: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@acme.com',
          password: 'Str0ng!',
          username: 'janedoe',
        },
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Email already exists');
    });

    it('should rollback and return error on unexpected DB failure', async () => {
      mockClientQuery.mockResolvedValueOnce({}); // BEGIN
      mockClientQuery.mockRejectedValueOnce(new Error('connection lost'));
      mockClientQuery.mockResolvedValueOnce({}); // ROLLBACK

      const { registerOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await registerOrganization({
        organizationDetails: { name: 'Acme', email: 'org@acme.com' },
        adminDetails: {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@acme.com',
          password: 'Str0ng!',
          username: 'janedoe',
        },
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('connection lost');
    });
  });

  // =========================================================================
  // getOrganization
  // =========================================================================
  describe('getOrganization', () => {
    it('should return organization data when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ organizationId: 5, name: 'Trial Corp', status: 'active' }],
      });

      const { getOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await getOrganization(5);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ organizationId: 5, name: 'Trial Corp', status: 'active' });
    });

    it('should return success false for non-existent org', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getOrganization } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await getOrganization(9999);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Organization not found');
    });
  });

  // =========================================================================
  // getMembers
  // =========================================================================
  describe('getMembers', () => {
    it('should return mapped member list', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            userId: 1,
            username: 'alice',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
            role: 'admin',
            status: 'active',
            dateJoined: '2025-01-01',
          },
        ],
      });

      const { getMembers } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await getMembers(5);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].username).toBe('alice');
      expect(result.data![0].role).toBe('admin');
    });

    it('should return empty array when org has no members', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getMembers } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await getMembers(5);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should return error on DB failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      const { getMembers } = await import(
        '../../../src/services/database/organization.service'
      );
      const result = await getMembers(5);

      expect(result.success).toBe(false);
      expect(result.message).toBe('timeout');
    });
  });
});
