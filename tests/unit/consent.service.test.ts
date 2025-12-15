/**
 * Unit Tests for eConsent Service
 * 
 * Tests consent document management, version control, and subject consent recording
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

describe('Consent Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease
    });
  });

  describe('createConsentDocument', () => {
    it('should create a new consent document', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          document_id: 1,
          study_id: 1,
          name: 'Main Consent',
          description: 'Main study consent form',
          document_type: 'main',
          language_code: 'en',
          status: 'draft',
          requires_witness: false,
          requires_lar: false,
          date_created: new Date()
        }]
      });

      const { createConsentDocument } = await import('../../src/services/consent/consent.service');
      const result = await createConsentDocument({
        studyId: 1,
        name: 'Main Consent',
        description: 'Main study consent form',
        documentType: 'main',
        createdBy: 1
      });

      expect(result.documentId).toBe(1);
      expect(result.name).toBe('Main Consent');
      expect(result.status).toBe('draft');
    });
  });

  describe('getConsentDocument', () => {
    it('should return document with active version', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            document_id: 1,
            study_id: 1,
            name: 'Main Consent',
            document_type: 'main',
            status: 'active',
            owner_name: 'Dr. Smith'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            version_id: 1,
            version_number: '1.0',
            status: 'active',
            content: { pages: [] }
          }]
        });

      const { getConsentDocument } = await import('../../src/services/consent/consent.service');
      const result = await getConsentDocument(1);

      expect(result).not.toBeNull();
      expect(result?.documentId).toBe(1);
      expect(result?.activeVersion).toBeDefined();
    });

    it('should return null when document not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getConsentDocument } = await import('../../src/services/consent/consent.service');
      const result = await getConsentDocument(999);

      expect(result).toBeNull();
    });
  });

  describe('listConsentDocuments', () => {
    it('should return all documents for a study', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { document_id: 1, name: 'Main Consent', document_type: 'main' },
          { document_id: 2, name: 'Assent Form', document_type: 'assent' }
        ]
      });

      const { listConsentDocuments } = await import('../../src/services/consent/consent.service');
      const result = await listConsentDocuments(1);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Main Consent');
    });
  });

  describe('createConsentVersion', () => {
    it('should create a new version', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          version_id: 1,
          document_id: 1,
          version_number: '1.0',
          status: 'draft',
          content: { pages: [{ pageNumber: 1, title: 'Introduction' }] },
          effective_date: new Date()
        }]
      });

      const { createConsentVersion } = await import('../../src/services/consent/consent.service');
      const result = await createConsentVersion({
        documentId: 1,
        versionNumber: '1.0',
        content: { pages: [{ pageNumber: 1, title: 'Introduction', content: '', requiresView: true }], acknowledgments: [], signatureRequirements: [] },
        effectiveDate: new Date(),
        createdBy: 1
      });

      expect(result.versionId).toBe(1);
      expect(result.versionNumber).toBe('1.0');
    });
  });

  describe('getActiveVersion', () => {
    it('should return active version', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          version_id: 2,
          version_number: '2.0',
          status: 'active',
          content: { pages: [] }
        }]
      });

      const { getActiveVersion } = await import('../../src/services/consent/consent.service');
      const result = await getActiveVersion(1);

      expect(result).not.toBeNull();
      expect(result?.versionNumber).toBe('2.0');
    });

    it('should return null when no active version', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getActiveVersion } = await import('../../src/services/consent/consent.service');
      const result = await getActiveVersion(1);

      expect(result).toBeNull();
    });
  });

  describe('activateConsentVersion', () => {
    it('should activate version and supersede previous', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ document_id: 1 }] }) // get version
        .mockResolvedValueOnce({ rows: [] }) // supersede old
        .mockResolvedValueOnce({ rows: [] }) // activate new
        .mockResolvedValueOnce({ rows: [] }) // update document
        .mockResolvedValueOnce({ rows: [] }) // audit log
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      mockQuery.mockResolvedValueOnce({
        rows: [{
          version_id: 1,
          version_number: '1.0',
          status: 'active'
        }]
      });

      const { activateConsentVersion } = await import('../../src/services/consent/consent.service');
      const result = await activateConsentVersion(1, 1);

      expect(result.status).toBe('active');
    });
  });

  describe('hasValidConsent', () => {
    it('should return true when valid consent exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ consent_id: 1 }] });

      const { hasValidConsent } = await import('../../src/services/consent/consent.service');
      const result = await hasValidConsent(1);

      expect(result).toBe(true);
    });

    it('should return false when no valid consent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { hasValidConsent } = await import('../../src/services/consent/consent.service');
      const result = await hasValidConsent(1);

      expect(result).toBe(false);
    });
  });

  describe('getSubjectConsent', () => {
    it('should return consent history', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { consent_id: 1, consent_status: 'consented', version_number: '1.0' },
          { consent_id: 2, consent_status: 'withdrawn', version_number: '1.0' }
        ]
      });

      const { getSubjectConsent } = await import('../../src/services/consent/consent.service');
      const result = await getSubjectConsent(1);

      expect(result).toHaveLength(2);
      expect(result[0].consentStatus).toBe('consented');
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent successfully', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ consent_status: 'consented', study_subject_id: 1 }] }) // get consent
        .mockResolvedValueOnce({ rows: [] }) // update consent
        .mockResolvedValueOnce({ rows: [] }) // audit log
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      mockQuery.mockResolvedValueOnce({
        rows: [{
          consent_id: 1,
          consent_status: 'withdrawn',
          withdrawal_reason: 'Personal reasons'
        }]
      });

      const { withdrawConsent } = await import('../../src/services/consent/consent.service');
      const result = await withdrawConsent(1, 'Personal reasons', 1);

      expect(result.consentStatus).toBe('withdrawn');
    });

    it('should throw error if already withdrawn', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ consent_status: 'withdrawn' }] }); // already withdrawn

      const { withdrawConsent } = await import('../../src/services/consent/consent.service');
      
      await expect(withdrawConsent(1, 'Test', 1)).rejects.toThrow('Consent already withdrawn');
    });
  });

  describe('getConsentDashboard', () => {
    it('should return dashboard statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ 
          rows: [{ total_subjects: '100', consented: '80', pending_reconsent: '5' }] 
        })
        .mockResolvedValueOnce({ rows: [] }) // pending consents
        .mockResolvedValueOnce({ rows: [] }); // recent consents

      const { getConsentDashboard } = await import('../../src/services/consent/consent.service');
      const result = await getConsentDashboard(1);

      expect(result.stats.totalSubjects).toBe(100);
      expect(result.stats.consented).toBe(80);
      expect(result.stats.pending).toBe(20);
    });
  });
});

