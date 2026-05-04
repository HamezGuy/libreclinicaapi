/**
 * Unit Tests for Tasks Service
 *
 * Tests module import, helper patterns, and parameterized query usage.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnect = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockTransaction = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  db: {
    query: (...args: unknown[]) => mockQuery(...args),
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

jest.mock('../../../src/utils/date.util', () => ({
  parseDateLocal: jest.fn().mockImplementation((d: unknown) => (d ? new Date(d as string) : null)),
}));

jest.mock('../../../src/services/database/query.service', () => ({
  updateFormQueryCounts: jest.fn(),
}));

jest.mock('../../../src/utils/org.util', () => ({
  getOrgMemberUserIds: jest.fn().mockReturnValue(Promise.resolve(null)),
}));

describe('Tasks Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  // =========================================================================
  // Module import
  // =========================================================================
  it('should import the module without errors', async () => {
    const tasksModule = await import('../../../src/services/database/tasks.service');
    expect(tasksModule).toBeDefined();
    expect(typeof tasksModule.getUserTasks).toBe('function');
    expect(typeof tasksModule.getTaskSummary).toBe('function');
    expect(typeof tasksModule.completeTask).toBe('function');
    expect(typeof tasksModule.dismissTask).toBe('function');
    expect(typeof tasksModule.reopenTask).toBe('function');
    expect(typeof tasksModule.getTaskById).toBe('function');
  });

  // =========================================================================
  // dismissTask
  // =========================================================================
  describe('dismissTask', () => {
    it('should reject dismissal without a reason', async () => {
      const { dismissTask } = await import('../../../src/services/database/tasks.service');
      const result = await dismissTask('query-1', 5, '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('reason is required');
    });

    it('should write to acc_task_status on valid dismissal', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ organizationId: 10 }] })
        .mockResolvedValueOnce({ rows: [] });

      const { dismissTask } = await import('../../../src/services/database/tasks.service');
      const result = await dismissTask('query-1', 5, 'Not applicable');

      expect(result.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const insertCall = mockQuery.mock.calls[1] as unknown[];
      expect((insertCall[0] as string)).toContain('acc_task_status');
    });
  });

  // =========================================================================
  // reopenTask
  // =========================================================================
  describe('reopenTask', () => {
    it('should delete the task_status record to reopen', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { reopenTask } = await import('../../../src/services/database/tasks.service');
      const result = await reopenTask('sdv-42', 5);

      expect(result.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const deleteCall = mockQuery.mock.calls[0] as unknown[];
      expect((deleteCall[0] as string)).toContain('DELETE FROM acc_task_status');
      expect((deleteCall[1] as unknown[])[0]).toBe('sdv-42');
    });

    it('should return failure on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));

      const { reopenTask } = await import('../../../src/services/database/tasks.service');
      const result = await reopenTask('sdv-42', 5);

      expect(result.success).toBe(false);
      expect(result.message).toContain('connection lost');
    });
  });

  // =========================================================================
  // getTaskById
  // =========================================================================
  describe('getTaskById', () => {
    it('should return failure for invalid task ID format', async () => {
      const { getTaskById } = await import('../../../src/services/database/tasks.service');
      const result = await getTaskById('invalidformat');

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });

    it('should return null data when source record does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getTaskById } = await import('../../../src/services/database/tasks.service');
      const result = await getTaskById('query-99999');

      expect(result.data).toBeNull();
    });

    it('should use parameterized queries with $1 placeholders', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getTaskById } = await import('../../../src/services/database/tasks.service');
      await getTaskById('form-123');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0] as unknown[];
      expect((callArgs[0] as string)).toContain('$1');
      expect((callArgs[1] as unknown[])[0]).toBe(123);
    });
  });

  // =========================================================================
  // getCompletedTasks
  // =========================================================================
  describe('getCompletedTasks', () => {
    it('should return empty data with total 0 when no tasks found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const { getCompletedTasks } = await import('../../../src/services/database/tasks.service');
      const result = await getCompletedTasks({ limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
