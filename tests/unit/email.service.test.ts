/**
 * Unit Tests for Email Notification Service
 * 
 * Tests template rendering, email queuing, and preference management
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect
  },
  db: {
    query: mockQuery,
    connect: mockConnect
  }
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Email Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease
    });
  });

  describe('getTemplate', () => {
    it('should return template when found', async () => {
      const mockTemplate = {
        template_id: 1,
        name: 'query_created',
        subject: 'New Query - {{studyName}}',
        html_body: '<p>Hello {{userName}}</p>',
        text_body: 'Hello {{userName}}',
        description: 'Query notification',
        variables: ['userName', 'studyName'],
        version: 1,
        status_id: 1,
        owner_id: 1,
        date_created: new Date(),
        date_updated: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockTemplate] });

      const { getTemplate } = await import('../../src/services/email/email.service');
      const result = await getTemplate('query_created');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('query_created');
      expect(result?.templateId).toBe(1);
    });

    it('should return null when template not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getTemplate } = await import('../../src/services/email/email.service');
      const result = await getTemplate('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listTemplates', () => {
    it('should return all templates', async () => {
      const mockTemplates = [
        { template_id: 1, name: 'template1', subject: 'Subject 1', html_body: '<p>Body 1</p>' },
        { template_id: 2, name: 'template2', subject: 'Subject 2', html_body: '<p>Body 2</p>' }
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockTemplates });

      const { listTemplates } = await import('../../src/services/email/email.service');
      const result = await listTemplates();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('template1');
    });

    it('should return empty array on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const { listTemplates } = await import('../../src/services/email/email.service');
      const result = await listTemplates();

      expect(result).toEqual([]);
    });
  });

  describe('queueEmail', () => {
    it('should queue email with rendered template', async () => {
      const mockTemplate = {
        template_id: 1,
        name: 'query_created',
        subject: 'New Query - {{studyName}}',
        html_body: '<p>Hello {{userName}}</p>',
        text_body: 'Hello {{userName}}'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockTemplate] }) // getTemplate
        .mockResolvedValueOnce({ rows: [{ queue_id: 123 }] }); // insert

      const { queueEmail } = await import('../../src/services/email/email.service');
      const result = await queueEmail({
        templateName: 'query_created',
        recipientEmail: 'test@example.com',
        variables: { userName: 'John', studyName: 'Test Study' }
      });

      expect(result).toBe(123);
    });

    it('should return null when template not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { queueEmail } = await import('../../src/services/email/email.service');
      const result = await queueEmail({
        templateName: 'nonexistent',
        recipientEmail: 'test@example.com',
        variables: {}
      });

      expect(result).toBeNull();
    });
  });

  describe('getUserPreferences', () => {
    it('should return user preferences', async () => {
      const mockPrefs = [
        { preference_id: 1, user_id: 1, notification_type: 'query_opened', email_enabled: true },
        { preference_id: 2, user_id: 1, notification_type: 'form_submitted', email_enabled: false }
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockPrefs });

      const { getUserPreferences } = await import('../../src/services/email/email.service');
      const result = await getUserPreferences(1);

      expect(result).toHaveLength(2);
      expect(result[0].emailEnabled).toBe(true);
    });
  });

  describe('updatePreference', () => {
    it('should update preference successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const { updatePreference } = await import('../../src/services/email/email.service');
      const result = await updatePreference({
        userId: 1,
        notificationType: 'query_opened' as any,
        emailEnabled: true
      });

      expect(result).toBe(true);
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status counts', async () => {
      const mockCounts = [
        { status: 'pending', count: '5' },
        { status: 'sent', count: '10' },
        { status: 'failed', count: '2' }
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockCounts });

      const { getQueueStatus } = await import('../../src/services/email/email.service');
      const result = await getQueueStatus();

      expect(result.pending).toBe(5);
      expect(result.sent).toBe(10);
      expect(result.failed).toBe(2);
      expect(result.total).toBe(17);
    });
  });

  describe('cancelEmail', () => {
    it('should cancel pending email', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const { cancelEmail } = await import('../../src/services/email/email.service');
      const result = await cancelEmail(123);

      expect(result).toBe(true);
    });

    it('should return false when email not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const { cancelEmail } = await import('../../src/services/email/email.service');
      const result = await cancelEmail(999);

      expect(result).toBe(false);
    });
  });

  describe('retryEmail', () => {
    it('should retry failed email', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const { retryEmail } = await import('../../src/services/email/email.service');
      const result = await retryEmail(123);

      expect(result).toBe(true);
    });
  });
});

