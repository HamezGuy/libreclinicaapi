/**
 * Unit Tests for Monitoring Service
 *
 * Tests system stats retrieval and error resilience.
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

describe('Monitoring Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getSystemStats
  // =========================================================================
  describe('getSystemStats', () => {
    it('should return all required SystemStats fields', async () => {
      // user count
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '15' }] });
      // study count
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
      // query stats
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '100', open: '20', critical: '5' }],
      });
      // SDV stats
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '80', pending: '30' }],
      });
      // validation stats
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '80', pending: '10' }],
      });
      // data quality
      mockQuery.mockResolvedValueOnce({
        rows: [{ completeness: '87.5' }],
      });

      const { getSystemStats } = await import(
        '../../../src/services/database/monitoring.service'
      );
      const stats = await getSystemStats();

      expect(stats.activeUsers).toBe(15);
      expect(stats.activeStudies).toBe(3);
      expect(stats.totalQueries).toBe(100);
      expect(stats.openQueries).toBe(20);
      expect(stats.criticalQueries).toBe(5);
      expect(stats.totalSDV).toBe(80);
      expect(stats.pendingSDV).toBe(30);
      expect(stats.totalValidations).toBe(80);
      expect(stats.pendingValidations).toBe(10);
      expect(stats.dataQuality.completeness).toBe(87.5);
      expect(stats.systemHealth.status).toBe('healthy');
      expect(typeof stats.systemHealth.uptime).toBe('number');
    });

    it('should handle query stats DB error gracefully and default to zeros', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] }); // users
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // studies
      mockQuery.mockRejectedValueOnce(new Error('relation discrepancy_note does not exist')); // query stats fail
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] }); // SDV
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] }); // validation
      mockQuery.mockResolvedValueOnce({ rows: [{ completeness: '100' }] }); // quality

      const { getSystemStats } = await import(
        '../../../src/services/database/monitoring.service'
      );
      const stats = await getSystemStats();

      expect(stats.totalQueries).toBe(0);
      expect(stats.openQueries).toBe(0);
      expect(stats.criticalQueries).toBe(0);
      expect(stats.activeUsers).toBe(5);
    });

    it('should return zero counts on empty database', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // users
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // studies
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', open: '0', critical: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ completeness: '100' }] });

      const { getSystemStats } = await import(
        '../../../src/services/database/monitoring.service'
      );
      const stats = await getSystemStats();

      expect(stats.activeUsers).toBe(0);
      expect(stats.activeStudies).toBe(0);
      expect(stats.totalQueries).toBe(0);
      expect(stats.totalSDV).toBe(0);
      expect(stats.totalValidations).toBe(0);
      expect(stats.droppedVerifications).toBe(0);
    });

    it('should handle SDV stats failure gracefully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] }); // users
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // studies
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10', open: '2', critical: '0' }] }); // queries
      mockQuery.mockRejectedValueOnce(new Error('event_crf missing')); // SDV fail
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] }); // validation
      mockQuery.mockResolvedValueOnce({ rows: [{ completeness: '100' }] }); // quality

      const { getSystemStats } = await import(
        '../../../src/services/database/monitoring.service'
      );
      const stats = await getSystemStats();

      expect(stats.totalSDV).toBe(0);
      expect(stats.pendingSDV).toBe(0);
      expect(stats.totalQueries).toBe(10);
    });

    it('should include lastCheck as ISO string in systemHealth', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', open: '0', critical: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0', pending: '0' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ completeness: '100' }] });

      const { getSystemStats } = await import(
        '../../../src/services/database/monitoring.service'
      );
      const stats = await getSystemStats();

      expect(stats.systemHealth.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
