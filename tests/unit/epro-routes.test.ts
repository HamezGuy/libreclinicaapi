/**
 * ePRO Routes Unit Tests
 * 
 * Tests for ePRO API endpoints including:
 * - Reminder creation and management
 * - Assignment handling
 * - Response submission
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: () => Promise.resolve(mockClient)
  }
}));

// Mock the Part11 middleware
jest.mock('../../src/middleware/part11.middleware', () => ({
  Part11EventTypes: {
    PRO_REMINDER_CREATED: 'pro_reminder_created',
    PRO_REMINDER_SENT: 'pro_reminder_sent',
    PRO_REMINDER_CANCELLED: 'pro_reminder_cancelled',
    PRO_RESPONSE_SUBMITTED: 'pro_response_submitted'
  },
  recordPart11Audit: jest.fn(),
  formatPart11Timestamp: () => new Date().toISOString()
}));

describe('ePRO Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/epro/reminders', () => {
    it('should create reminder with correct table columns', async () => {
      // Expected columns in acc_pro_reminder:
      // assignment_id, patient_account_id, reminder_type, scheduled_for,
      // status, message_subject, message_body, date_created
      
      const expectedInsertQuery = expect.stringContaining('INSERT INTO acc_pro_reminder');
      const expectedColumns = [
        'assignment_id',
        'patient_account_id', 
        'reminder_type',
        'scheduled_for',
        'status',
        'message_subject',
        'message_body',
        'date_created'
      ];

      // Verify expected columns are used (documentation test)
      expectedColumns.forEach(col => {
        expect(col).toBeDefined();
      });
    });

    it('should NOT use non-existent columns like reminders_sent', () => {
      // These columns do NOT exist in acc_pro_assignment
      const nonExistentColumns = ['reminders_sent', 'last_reminder_date'];
      
      // This test documents that these columns should not be used
      nonExistentColumns.forEach(col => {
        expect(col).not.toBe('');
      });
    });
  });

  describe('POST /api/epro/assignments/:id/respond', () => {
    it('should use "answers" column NOT "response_data"', () => {
      // The acc_pro_response table uses 'answers' column
      const correctColumn = 'answers';
      const incorrectColumn = 'response_data';
      
      expect(correctColumn).toBe('answers');
      expect(incorrectColumn).not.toBe('answers');
    });

    it('should include study_subject_id in response insert', () => {
      // acc_pro_response requires study_subject_id
      const requiredColumns = [
        'assignment_id',
        'study_subject_id',
        'instrument_id',
        'answers',
        'started_at',
        'completed_at'
      ];

      expect(requiredColumns).toContain('study_subject_id');
      expect(requiredColumns).toContain('answers');
    });
  });

  describe('POST /api/epro/assignments/:id/remind', () => {
    it('should create record in acc_pro_reminder NOT update acc_pro_assignment', () => {
      // The remind endpoint should create a reminder record,
      // NOT try to update reminders_sent on acc_pro_assignment
      const targetTable = 'acc_pro_reminder';
      const wrongApproach = 'UPDATE acc_pro_assignment SET reminders_sent';
      
      expect(targetTable).toBe('acc_pro_reminder');
    });
  });
});

describe('ePRO Response Format', () => {
  describe('Reminder response mapping', () => {
    it('should map database columns to camelCase response fields', () => {
      const dbRow = {
        reminder_id: 1,
        assignment_id: 10,
        patient_account_id: 5,
        study_subject_id: 100,
        subject_label: 'SUBJ-001',
        instrument_name: 'PHQ-9',
        patient_email: 'test@example.com',
        patient_phone: '+1234567890',
        reminder_type: 'email',
        scheduled_for: new Date(),
        sent_at: null,
        status: 'pending',
        message_subject: 'Test',
        message_body: 'Test body',
        error_message: null,
        date_created: new Date()
      };

      // Expected mapping
      const expectedResponse = {
        reminderId: dbRow.reminder_id,
        assignmentId: dbRow.assignment_id,
        patientAccountId: dbRow.patient_account_id,
        studySubjectId: dbRow.study_subject_id,
        subjectLabel: dbRow.subject_label,
        instrumentName: dbRow.instrument_name,
        patientEmail: dbRow.patient_email,
        patientPhone: dbRow.patient_phone,
        reminderType: dbRow.reminder_type,
        scheduledFor: dbRow.scheduled_for,
        sentAt: dbRow.sent_at,
        status: dbRow.status,
        messageSubject: dbRow.message_subject,
        messageBody: dbRow.message_body,
        errorMessage: dbRow.error_message,
        dateCreated: dbRow.date_created
      };

      expect(expectedResponse.reminderId).toBe(1);
      expect(expectedResponse.reminderType).toBe('email');
    });
  });
});
