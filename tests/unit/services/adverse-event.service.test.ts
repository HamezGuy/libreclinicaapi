/**
 * Unit Tests for Adverse Event Service
 *
 * Tests interface shapes, default config, and AE summary/report logic.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: jest.fn(),
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

jest.mock('../../../src/services/soap/soapClient', () => ({
  getSoapClient: jest.fn(),
}));

import type { AdverseEvent, AEFormConfig } from '../../../src/services/ae/adverse-event.service';

describe('Adverse Event Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Interface shape checks
  // =========================================================================
  describe('AdverseEvent interface shape', () => {
    it('should accept a minimal AdverseEvent object', () => {
      const ae: AdverseEvent = {
        subjectOID: 'SUBJ-001',
        aeTerm: 'Headache',
        onsetDate: '2026-01-15',
        severity: 'Mild',
        isSerious: false,
      };
      expect(ae.subjectOID).toBe('SUBJ-001');
      expect(ae.aeTerm).toBe('Headache');
      expect(ae.severity).toBe('Mild');
      expect(ae.isSerious).toBe(false);
      expect(ae.aeId).toBeUndefined();
      expect(ae.meddraCode).toBeUndefined();
      expect(ae.resolutionDate).toBeUndefined();
    });

    it('should accept a fully-populated AdverseEvent object', () => {
      const ae: AdverseEvent = {
        aeId: 42,
        subjectOID: 'SUBJ-002',
        aeTerm: 'Nausea',
        meddraCode: '10028813',
        onsetDate: '2026-02-01',
        resolutionDate: '2026-02-10',
        severity: 'Moderate',
        isSerious: true,
        seriousnessCriteria: {
          resultsDeath: false,
          lifeThreatening: false,
          hospitalization: true,
          disability: false,
          congenitalAnomaly: false,
          medicallyImportant: true,
        },
        causalityAssessment: 'Probable',
        outcome: 'Recovered',
        actionTaken: 'Dose Reduced',
      };
      expect(ae.aeId).toBe(42);
      expect(ae.isSerious).toBe(true);
      expect(ae.seriousnessCriteria?.hospitalization).toBe(true);
      expect(ae.outcome).toBe('Recovered');
    });
  });

  // =========================================================================
  // AEFormConfig and DEFAULT_AE_CONFIG
  // =========================================================================
  describe('AEFormConfig and DEFAULT_AE_CONFIG', () => {
    it('should export DEFAULT_AE_CONFIG with all required item OIDs', async () => {
      const { DEFAULT_AE_CONFIG } = await import('../../../src/services/ae/adverse-event.service');

      expect(DEFAULT_AE_CONFIG).toBeDefined();
      expect(DEFAULT_AE_CONFIG.eventOID).toBe('SE_ADVERSEEVENT');
      expect(DEFAULT_AE_CONFIG.formOID).toBe('F_AEFORM_V1');
      expect(DEFAULT_AE_CONFIG.itemGroupOID).toBe('IG_AEFORM_UNGROUPED');
    });

    it('should have all required item OIDs in DEFAULT_AE_CONFIG.items', async () => {
      const { DEFAULT_AE_CONFIG } = await import('../../../src/services/ae/adverse-event.service');
      const items = DEFAULT_AE_CONFIG.items;

      expect(items.term).toBeDefined();
      expect(items.onsetDate).toBeDefined();
      expect(items.severity).toBeDefined();
      expect(items.isSerious).toBeDefined();
    });

    it('should have optional item OIDs in DEFAULT_AE_CONFIG.items', async () => {
      const { DEFAULT_AE_CONFIG } = await import('../../../src/services/ae/adverse-event.service');
      const items = DEFAULT_AE_CONFIG.items;

      expect(items.meddraCode).toBeDefined();
      expect(items.resolutionDate).toBeDefined();
      expect(items.causality).toBeDefined();
      expect(items.outcome).toBeDefined();
      expect(items.action).toBeDefined();
    });

    it('should use correct naming convention (I_AEFOR_ prefix) for item OIDs', async () => {
      const { DEFAULT_AE_CONFIG } = await import('../../../src/services/ae/adverse-event.service');
      const items = DEFAULT_AE_CONFIG.items;
      const allOids = [
        items.term, items.onsetDate, items.severity, items.isSerious,
        items.meddraCode, items.resolutionDate, items.causality,
        items.outcome, items.action,
      ].filter(Boolean);

      for (const oid of allOids) {
        expect(oid).toMatch(/^I_AEFOR_/);
      }
    });
  });

  // =========================================================================
  // getAESummary
  // =========================================================================
  describe('getAESummary', () => {
    it('should return zero-valued summary when no AEs exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ totalAes: '0', seriousAes: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getAESummary } = await import('../../../src/services/ae/adverse-event.service');
      const summary = await getAESummary(1);

      expect(summary.totalAEs).toBe(0);
      expect(summary.seriousAEs).toBe(0);
      expect(summary.bySeverity).toEqual([]);
      expect(summary.recentAEs).toEqual([]);
    });

    it('should parse numeric counts from database rows', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ totalAes: '5', seriousAes: '2' }] })
        .mockResolvedValueOnce({ rows: [{ severity: 'Mild', count: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      const { getAESummary } = await import('../../../src/services/ae/adverse-event.service');
      const summary = await getAESummary(1);

      expect(summary.totalAEs).toBe(5);
      expect(summary.seriousAEs).toBe(2);
      expect(summary.bySeverity).toEqual([{ severity: 'Mild', count: 3 }]);
    });

    it('should return empty summary on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      const { getAESummary } = await import('../../../src/services/ae/adverse-event.service');
      const summary = await getAESummary(999);

      expect(summary.totalAEs).toBe(0);
      expect(summary.seriousAEs).toBe(0);
      expect(summary.bySeverity).toEqual([]);
      expect(summary.recentAEs).toEqual([]);
    });
  });

  // =========================================================================
  // getSubjectAEs
  // =========================================================================
  describe('getSubjectAEs', () => {
    it('should return empty array when no AEs found for subject', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getSubjectAEs } = await import('../../../src/services/ae/adverse-event.service');
      const result = await getSubjectAEs(1, 100);

      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      const { getSubjectAEs } = await import('../../../src/services/ae/adverse-event.service');
      const result = await getSubjectAEs(1, 100);

      expect(result).toEqual([]);
    });
  });
});
