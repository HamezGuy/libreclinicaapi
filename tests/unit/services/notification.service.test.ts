/**
 * Unit Tests for Notification Service
 *
 * Tests creation, bulk notification, and unread retrieval.
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

jest.mock('../../../src/types', () => ({
  NotificationType: {},
}));

describe('Notification Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createNotification
  // =========================================================================
  describe('createNotification', () => {
    it('should insert and return notification ID', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // table check
        .mockResolvedValueOnce({ rows: [{ notificationId: 101 }] }); // INSERT

      const { createNotification } = await import(
        '../../../src/services/database/notification.service'
      );
      const id = await createNotification({
        userId: 1,
        type: 'query_assigned' as never,
        title: 'New query',
        message: 'A query was assigned to you',
      });

      expect(id).toBe(101);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should return null when acc_notifications table does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

      const { createNotification } = await import(
        '../../../src/services/database/notification.service'
      );
      const id = await createNotification({
        userId: 1,
        type: 'general' as never,
        title: 'Test',
        message: 'msg',
      });

      expect(id).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should return null on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('disk full'));

      const { createNotification } = await import(
        '../../../src/services/database/notification.service'
      );
      const id = await createNotification({
        userId: 1,
        type: 'general' as never,
        title: 'Test',
        message: 'msg',
      });

      expect(id).toBeNull();
    });
  });

  // =========================================================================
  // notifyUsers
  // =========================================================================
  describe('notifyUsers', () => {
    it('should return 0 for empty userIds array', async () => {
      const { notifyUsers } = await import(
        '../../../src/services/database/notification.service'
      );
      const count = await notifyUsers([], 'general' as never, 'Title', 'msg');

      expect(count).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should bulk insert and return inserted count', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // table check
        .mockResolvedValueOnce({ rowCount: 3, rows: [{}, {}, {}] }); // INSERT returning 3

      const { notifyUsers } = await import(
        '../../../src/services/database/notification.service'
      );
      const count = await notifyUsers(
        [1, 2, 3],
        'form_locked' as never,
        'Locked',
        'Form locked',
        { studyId: 10 },
      );

      expect(count).toBe(3);
    });

    it('should return 0 when table does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

      const { notifyUsers } = await import(
        '../../../src/services/database/notification.service'
      );
      const count = await notifyUsers([1, 2], 'general' as never, 'T', 'M');

      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // getUnreadNotifications
  // =========================================================================
  describe('getUnreadNotifications', () => {
    it('should return data and unreadCount', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // table check
        .mockResolvedValueOnce({ rows: [{ cnt: '5' }] }) // COUNT
        .mockResolvedValueOnce({
          rows: [
            { notificationId: 1, title: 'Q1' },
            { notificationId: 2, title: 'Q2' },
          ],
        }); // SELECT

      const { getUnreadNotifications } = await import(
        '../../../src/services/database/notification.service'
      );
      const result = await getUnreadNotifications(42);

      expect(result.unreadCount).toBe(5);
      expect(result.data).toHaveLength(2);
    });

    it('should return empty result when table does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

      const { getUnreadNotifications } = await import(
        '../../../src/services/database/notification.service'
      );
      const result = await getUnreadNotifications(42);

      expect(result.data).toEqual([]);
      expect(result.unreadCount).toBe(0);
    });

    it('should return empty result on DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      const { getUnreadNotifications } = await import(
        '../../../src/services/database/notification.service'
      );
      const result = await getUnreadNotifications(42);

      expect(result.data).toEqual([]);
      expect(result.unreadCount).toBe(0);
    });
  });
});
