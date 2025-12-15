/**
 * Unit Tests for Double Data Entry (DDE) Service
 * 
 * Tests DDE workflow including entry submission, comparison, and resolution
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect
  }
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('DDE Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease
    });
  });

  describe('isDDERequired', () => {
    it('should return true when double_entry is enabled', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ double_entry: true }] });

      const { isDDERequired } = await import('../../src/services/database/dde.service');
      const result = await isDDERequired(1);

      expect(result).toBe(true);
    });

    it('should return false when double_entry is disabled', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ double_entry: false }] });

      const { isDDERequired } = await import('../../src/services/database/dde.service');
      const result = await isDDERequired(1);

      expect(result).toBe(false);
    });

    it('should return false when event_crf not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { isDDERequired } = await import('../../src/services/database/dde.service');
      const result = await isDDERequired(999);

      expect(result).toBe(false);
    });
  });

  describe('getDDEStatus', () => {
    it('should return existing DDE status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'complete',
          second_entry_status: 'pending',
          comparison_status: 'pending',
          total_items: 10,
          matched_items: 0,
          discrepancy_count: 0,
          resolved_count: 0,
          dde_complete: false
        }]
      });

      const { getDDEStatus } = await import('../../src/services/database/dde.service');
      const result = await getDDEStatus(1);

      expect(result).not.toBeNull();
      expect(result?.firstEntryStatus).toBe('complete');
      expect(result?.secondEntryStatus).toBe('pending');
    });

    it('should initialize status when DDE required but no status exists', async () => {
      // First query returns no status
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ double_entry: true }] }); // isDDERequired check

      // Initialize status query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'pending',
          second_entry_status: 'pending',
          comparison_status: 'pending'
        }]
      });

      const { getDDEStatus } = await import('../../src/services/database/dde.service');
      const result = await getDDEStatus(1);

      expect(result).not.toBeNull();
    });

    it('should return null when DDE not required', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ double_entry: false }] });

      const { getDDEStatus } = await import('../../src/services/database/dde.service');
      const result = await getDDEStatus(1);

      expect(result).toBeNull();
    });
  });

  describe('canUserPerformDDE', () => {
    it('should allow first entry by any user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'pending',
          second_entry_status: 'pending',
          comparison_status: 'pending'
        }]
      });

      const { canUserPerformDDE } = await import('../../src/services/database/dde.service');
      const result = await canUserPerformDDE(1, 1);

      expect(result.allowed).toBe(true);
      expect(result.entryType).toBe('first');
    });

    it('should allow second entry by different user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'complete',
          first_entry_by: 1,
          first_entry_by_name: 'User One',
          second_entry_status: 'pending',
          comparison_status: 'pending'
        }]
      });

      const { canUserPerformDDE } = await import('../../src/services/database/dde.service');
      const result = await canUserPerformDDE(1, 2); // Different user

      expect(result.allowed).toBe(true);
      expect(result.entryType).toBe('second');
    });

    it('should deny second entry by same user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'complete',
          first_entry_by: 1,
          first_entry_by_name: 'User One',
          second_entry_status: 'pending',
          comparison_status: 'pending'
        }]
      });

      const { canUserPerformDDE } = await import('../../src/services/database/dde.service');
      const result = await canUserPerformDDE(1, 1); // Same user

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Different user required');
    });

    it('should deny when DDE already complete', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'complete',
          second_entry_status: 'complete',
          comparison_status: 'resolved',
          dde_complete: true
        }]
      });

      const { canUserPerformDDE } = await import('../../src/services/database/dde.service');
      const result = await canUserPerformDDE(1, 3);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DDE entries already complete');
    });
  });

  describe('markFirstEntryComplete', () => {
    it('should mark first entry as complete', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ total: '10' }] }) // item count
        .mockResolvedValueOnce({ rows: [] }) // update status
        .mockResolvedValueOnce({ rows: [] }) // audit log
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      mockQuery.mockResolvedValueOnce({
        rows: [{
          status_id: 1,
          event_crf_id: 1,
          first_entry_status: 'complete',
          first_entry_by: 1,
          total_items: 10
        }]
      });

      const { markFirstEntryComplete } = await import('../../src/services/database/dde.service');
      const result = await markFirstEntryComplete(1, 1);

      expect(result.firstEntryStatus).toBe('complete');
      expect(result.totalItems).toBe(10);
    });
  });

  describe('getDDEDashboard', () => {
    it('should return dashboard with pending items', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // pending second entry
        .mockResolvedValueOnce({ rows: [] }) // pending resolution
        .mockResolvedValueOnce({ 
          rows: [{ total: '10', pending: '3', discrepancies: '2', complete: '5' }] 
        }); // stats

      const { getDDEDashboard } = await import('../../src/services/database/dde.service');
      const result = await getDDEDashboard(1);

      expect(result.stats.total).toBe(10);
      expect(result.stats.pending).toBe(3);
      expect(result.pendingSecondEntry).toEqual([]);
      expect(result.pendingResolution).toEqual([]);
    });
  });
});

