/**
 * Unit Tests for Flagging Service
 *
 * Tests CRF and item-level flag CRUD operations.
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

describe('Flagging Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getCrfFlags
  // =========================================================================
  describe('getCrfFlags', () => {
    it('should return mapped CRF flags for a given eventCrfId', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            eventCrfFlagId: 1,
            eventCrfId: 10,
            flagType: 'review',
            comment: 'Needs review',
            userId: 5,
            createdAt: '2025-06-01T00:00:00Z',
          },
          {
            eventCrfFlagId: 2,
            eventCrfId: 10,
            flagType: 'issue',
            comment: 'Data mismatch',
            userId: 6,
            createdAt: '2025-06-02T00:00:00Z',
          },
        ],
      });

      const { getCrfFlags } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flags = await getCrfFlags(10);

      expect(flags).toHaveLength(2);
      expect(flags[0].eventCrfFlagId).toBe(1);
      expect(flags[0].flagType).toBe('review');
      expect(flags[1].comment).toBe('Data mismatch');
    });

    it('should return empty array when no flags exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getCrfFlags } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flags = await getCrfFlags(999);

      expect(flags).toEqual([]);
    });
  });

  // =========================================================================
  // createCrfFlag
  // =========================================================================
  describe('createCrfFlag', () => {
    it('should insert and return a new CRF flag', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            eventCrfFlagId: 50,
            eventCrfId: 10,
            flagType: 'issue',
            comment: 'Missing value',
            userId: 3,
            createdAt: '2025-07-01T00:00:00Z',
          },
        ],
      });

      const { createCrfFlag } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flag = await createCrfFlag(10, 'issue', 'Missing value', 3);

      expect(flag.eventCrfFlagId).toBe(50);
      expect(flag.flagType).toBe('issue');
      expect(flag.comment).toBe('Missing value');
    });

    it('should default flagType to review when empty string provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            eventCrfFlagId: 51,
            eventCrfId: 10,
            flagType: 'review',
            comment: '',
            userId: 3,
            createdAt: '2025-07-01T00:00:00Z',
          },
        ],
      });

      const { createCrfFlag } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flag = await createCrfFlag(10, '', '', 3);

      const callArgs = mockQuery.mock.calls[0] as unknown[];
      const params = callArgs[1] as unknown[];
      expect(params[1]).toBe('review');
      expect(flag.flagType).toBe('review');
    });
  });

  // =========================================================================
  // getItemFlags
  // =========================================================================
  describe('getItemFlags', () => {
    it('should return mapped item flags', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            itemDataFlagId: 7,
            itemDataId: 200,
            flagType: 'review',
            comment: 'Check unit',
            userId: 4,
            createdAt: '2025-08-01T00:00:00Z',
          },
        ],
      });

      const { getItemFlags } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flags = await getItemFlags(200);

      expect(flags).toHaveLength(1);
      expect(flags[0].itemDataFlagId).toBe(7);
      expect(flags[0].itemDataId).toBe(200);
    });

    it('should return empty array for item with no flags', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getItemFlags } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flags = await getItemFlags(9999);

      expect(flags).toEqual([]);
    });
  });

  // =========================================================================
  // createItemFlag
  // =========================================================================
  describe('createItemFlag', () => {
    it('should default flagType to review when empty string provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            itemDataFlagId: 20,
            itemDataId: 300,
            flagType: 'review',
            comment: '',
            userId: 8,
            createdAt: '2025-09-01T00:00:00Z',
          },
        ],
      });

      const { createItemFlag } = await import(
        '../../../src/services/database/flagging.service'
      );
      const flag = await createItemFlag(300, '', '', 8);

      const callArgs = mockQuery.mock.calls[0] as unknown[];
      const params = callArgs[1] as unknown[];
      expect(params[1]).toBe('review');
      expect(flag.itemDataFlagId).toBe(20);
    });
  });
});
