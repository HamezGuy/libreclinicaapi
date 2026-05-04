/**
 * Unit Tests for Site Service
 *
 * Tests site listing, single-site retrieval, and aggregate stats.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: jest.fn(),
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

describe('Site Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getSites
  // =========================================================================
  describe('getSites', () => {
    it('should return array of sites for a study', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, siteName: 'Site A', enrolledSubjects: '10' },
          { id: 2, siteName: 'Site B', enrolledSubjects: '5' },
        ],
      });

      const { getSites } = await import(
        '../../../src/services/database/site.service'
      );
      const sites = await getSites(100);

      expect(sites).toHaveLength(2);
      expect(sites[0].siteName).toBe('Site A');
    });

    it('should append active status filter when status is active', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSites } = await import(
        '../../../src/services/database/site.service'
      );
      await getSites(100, 'active');

      const callArgs = mockQuery.mock.calls[0] as unknown[];
      const sql = callArgs[0] as string;
      expect(sql).toContain('status_id = 1');
    });

    it('should not append status filter when status is undefined', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSites } = await import(
        '../../../src/services/database/site.service'
      );
      await getSites(100);

      const callArgs = mockQuery.mock.calls[0] as unknown[];
      const sql = callArgs[0] as string;
      expect(sql).not.toContain('AND s.status_id = 1');
    });

    it('should return empty array when no sites exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSites } = await import(
        '../../../src/services/database/site.service'
      );
      const sites = await getSites(999);

      expect(sites).toEqual([]);
    });
  });

  // =========================================================================
  // getSite
  // =========================================================================
  describe('getSite', () => {
    it('should return site data when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ studyId: 5, name: 'Test Site', parentStudyName: 'Main Study' }],
      });

      const { getSite } = await import(
        '../../../src/services/database/site.service'
      );
      const site = await getSite(5);

      expect(site).not.toBeNull();
      expect(site!.name).toBe('Test Site');
    });

    it('should return null for non-existent site', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSite } = await import(
        '../../../src/services/database/site.service'
      );
      const site = await getSite(9999);

      expect(site).toBeNull();
    });
  });

  // =========================================================================
  // getSiteStats
  // =========================================================================
  describe('getSiteStats', () => {
    it('should return aggregate counts', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            totalSites: '3',
            activeSites: '2',
            totalSubjects: '50',
            targetEnrollment: '100',
          },
        ],
      });

      const { getSiteStats } = await import(
        '../../../src/services/database/site.service'
      );
      const stats = await getSiteStats(100);

      expect(stats.totalSites).toBe('3');
      expect(stats.activeSites).toBe('2');
      expect(stats.totalSubjects).toBe('50');
    });

    it('should return empty object when no sites match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSiteStats } = await import(
        '../../../src/services/database/site.service'
      );
      const stats = await getSiteStats(9999);

      expect(stats).toEqual({});
    });
  });
});
