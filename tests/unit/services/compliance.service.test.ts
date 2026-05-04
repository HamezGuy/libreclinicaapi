/**
 * Unit Tests for Compliance Service
 *
 * Tests 21 CFR Part 11 audit event logging and enum values.
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

jest.mock('../../../src/utils/password.util', () => ({
  verifyAndUpgrade: jest.fn(),
}));

describe('Compliance Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // LibreClinicaAuditEventType enum
  // =========================================================================
  describe('LibreClinicaAuditEventType', () => {
    it('should define ITEM_DATA_VALUE_UPDATED as 1', async () => {
      const { LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      expect(LibreClinicaAuditEventType.ITEM_DATA_VALUE_UPDATED).toBe(1);
    });

    it('should define electronic signature event types', async () => {
      const { LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      expect(LibreClinicaAuditEventType.EVENT_CRF_COMPLETE_WITH_PASSWORD).toBe(14);
      expect(LibreClinicaAuditEventType.EVENT_CRF_IDE_COMPLETE_WITH_PASSWORD).toBe(15);
      expect(LibreClinicaAuditEventType.EVENT_CRF_DDE_COMPLETE_WITH_PASSWORD).toBe(16);
      expect(LibreClinicaAuditEventType.STUDY_EVENT_SIGNED).toBe(31);
    });

    it('should define study event lifecycle types', async () => {
      const { LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      expect(LibreClinicaAuditEventType.STUDY_EVENT_SCHEDULED).toBe(17);
      expect(LibreClinicaAuditEventType.STUDY_EVENT_COMPLETED).toBe(19);
      expect(LibreClinicaAuditEventType.STUDY_EVENT_LOCKED).toBe(22);
      expect(LibreClinicaAuditEventType.STUDY_EVENT_REMOVED).toBe(23);
    });

    it('should define SDV and CRF version change types', async () => {
      const { LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      expect(LibreClinicaAuditEventType.EVENT_CRF_SDV_STATUS).toBe(32);
      expect(LibreClinicaAuditEventType.CHANGE_CRF_VERSION).toBe(33);
    });
  });

  // =========================================================================
  // logLibreClinicaAuditEvent
  // =========================================================================
  describe('logLibreClinicaAuditEvent', () => {
    it('should insert audit event and return auditId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ auditId: 555 }] });

      const { logLibreClinicaAuditEvent, LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      const result = await logLibreClinicaAuditEvent(
        LibreClinicaAuditEventType.ITEM_DATA_VALUE_UPDATED,
        42,
        {
          auditTable: 'item_data',
          entityId: 100,
          oldValue: 'foo',
          newValue: 'bar',
          reasonForChange: 'correction',
        },
      );

      expect(result.success).toBe(true);
      expect(result.auditId).toBe(555);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0] as unknown[];
      expect((callArgs[0] as string)).toContain('INSERT INTO audit_log_event');
    });

    it('should pass null for optional params when not provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ auditId: 600 }] });

      const { logLibreClinicaAuditEvent, LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      const result = await logLibreClinicaAuditEvent(
        LibreClinicaAuditEventType.STUDY_SUBJECT_CREATED,
        1,
        { auditTable: 'study_subject' },
      );

      expect(result.success).toBe(true);
      const params = (mockQuery.mock.calls[0] as unknown[])[1] as unknown[];
      expect(params[2]).toBeNull(); // entityId
      expect(params[3]).toBeNull(); // entityName
      expect(params[4]).toBeNull(); // oldValue
      expect(params[5]).toBeNull(); // newValue
    });

    it('should handle DB errors gracefully and return success false', async () => {
      mockQuery.mockRejectedValueOnce(new Error('relation does not exist'));

      const { logLibreClinicaAuditEvent, LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      const result = await logLibreClinicaAuditEvent(
        LibreClinicaAuditEventType.ITEM_DATA_VALUE_UPDATED,
        1,
        { auditTable: 'item_data', entityId: 1 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('relation does not exist');
    });

    it('should include eventCrfId and studyEventId when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ auditId: 700 }] });

      const { logLibreClinicaAuditEvent, LibreClinicaAuditEventType } = await import(
        '../../../src/services/database/compliance.service'
      );
      await logLibreClinicaAuditEvent(
        LibreClinicaAuditEventType.EVENT_CRF_MARKED_COMPLETE,
        10,
        { auditTable: 'event_crf', eventCrfId: 88, studyEventId: 99 },
      );

      const params = (mockQuery.mock.calls[0] as unknown[])[1] as unknown[];
      expect(params[8]).toBe(88); // eventCrfId
      expect(params[9]).toBe(99); // studyEventId
    });
  });
});
