/**
 * Unit Tests for Consent Service
 *
 * Tests document CRUD, null handling, and default field population.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnect = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../../src/config/database', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
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

describe('Consent Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  // =========================================================================
  // createConsentDocument
  // =========================================================================
  describe('createConsentDocument', () => {
    it('should insert and return a mapped consent document', async () => {
      const fakeRow = {
        documentId: 1,
        studyId: 10,
        name: 'ICF Main',
        description: 'Informed Consent Form',
        documentType: 'main',
        languageCode: 'en',
        status: 'draft',
        requiresWitness: false,
        requiresLar: false,
        ageOfMajority: 18,
        minReadingTime: 60,
        ownerId: 5,
        ownerName: null,
        dateCreated: new Date('2026-01-01'),
        dateUpdated: new Date('2026-01-01'),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const { createConsentDocument } = await import('../../../src/services/consent/consent.service');
      const doc = await createConsentDocument({
        studyId: 10,
        name: 'ICF Main',
        createdBy: 5,
      });

      expect(doc.documentId).toBe(1);
      expect(doc.name).toBe('ICF Main');
      expect(doc.status).toBe('draft');
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0] as unknown[];
      expect((callArgs[0] as string)).toContain('INSERT INTO acc_consent_document');
    });

    it('should set default values for optional fields', async () => {
      const fakeRow = {
        documentId: 2,
        studyId: 10,
        name: 'Minimal Doc',
        description: null,
        documentType: 'main',
        languageCode: 'en',
        status: 'draft',
        requiresWitness: false,
        requiresLar: false,
        ageOfMajority: 18,
        minReadingTime: 60,
        ownerId: 5,
        ownerName: null,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const { createConsentDocument } = await import('../../../src/services/consent/consent.service');
      const doc = await createConsentDocument({
        studyId: 10,
        name: 'Minimal Doc',
        createdBy: 5,
      });

      expect(doc.documentType).toBe('main');
      expect(doc.languageCode).toBe('en');
      expect(doc.requiresWitness).toBe(false);
      expect(doc.ageOfMajority).toBe(18);
      expect(doc.minReadingTime).toBe(60);
    });

    it('should pass provided optional values to the query', async () => {
      const fakeRow = {
        documentId: 3,
        studyId: 10,
        name: 'Full Doc',
        description: 'Full description',
        documentType: 'addendum',
        languageCode: 'es',
        status: 'draft',
        requiresWitness: true,
        requiresLar: true,
        ageOfMajority: 21,
        minReadingTime: 120,
        ownerId: 5,
        ownerName: null,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const { createConsentDocument } = await import('../../../src/services/consent/consent.service');
      const doc = await createConsentDocument({
        studyId: 10,
        name: 'Full Doc',
        description: 'Full description',
        documentType: 'addendum',
        languageCode: 'es',
        requiresWitness: true,
        requiresLAR: true,
        ageOfMajority: 21,
        minReadingTime: 120,
        createdBy: 5,
      });

      expect(doc.documentType).toBe('addendum');
      expect(doc.languageCode).toBe('es');
      expect(doc.requiresWitness).toBe(true);
      const params = (mockQuery.mock.calls[0] as unknown[])[1] as unknown[];
      expect(params).toContain('Full description');
    });
  });

  // =========================================================================
  // getConsentDocument
  // =========================================================================
  describe('getConsentDocument', () => {
    it('should return null when document ID does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getConsentDocument } = await import('../../../src/services/consent/consent.service');
      const result = await getConsentDocument(999);

      expect(result).toBeNull();
    });

    it('should return mapped document when found', async () => {
      const fakeRow = {
        documentId: 1,
        studyId: 10,
        name: 'Test ICF',
        description: null,
        documentType: 'main',
        languageCode: 'en',
        status: 'active',
        requiresWitness: false,
        requiresLar: false,
        ageOfMajority: 18,
        minReadingTime: 60,
        ownerId: 5,
        ownerName: 'John Doe',
        dateCreated: new Date('2026-01-01'),
        dateUpdated: new Date('2026-01-02'),
      };
      // First call: main document query
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
      // Second call: getActiveVersion (no active version)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getConsentDocument } = await import('../../../src/services/consent/consent.service');
      const doc = await getConsentDocument(1);

      expect(doc).not.toBeNull();
      expect(doc!.documentId).toBe(1);
      expect(doc!.name).toBe('Test ICF');
      expect(doc!.ownerName).toBe('John Doe');
    });

    it('should attach activeVersion when one exists', async () => {
      const fakeDocRow = {
        documentId: 1,
        studyId: 10,
        name: 'Test ICF',
        description: null,
        documentType: 'main',
        languageCode: 'en',
        status: 'active',
        requiresWitness: false,
        requiresLar: false,
        ageOfMajority: 18,
        minReadingTime: 60,
        ownerId: 5,
        ownerName: 'John Doe',
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };
      const fakeVersionRow = {
        versionId: 100,
        documentId: 1,
        versionNumber: '1.0',
        versionName: 'Initial',
        content: '{}',
        pdfTemplate: null,
        effectiveDate: new Date(),
        expirationDate: null,
        irbApprovalDate: null,
        irbApprovalNumber: null,
        changeSummary: null,
        status: 'active',
        approvedBy: 5,
        approvedByName: 'Admin',
        approvedAt: new Date(),
        createdBy: 5,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeDocRow] })
        .mockResolvedValueOnce({ rows: [fakeVersionRow] });

      const { getConsentDocument } = await import('../../../src/services/consent/consent.service');
      const doc = await getConsentDocument(1);

      expect(doc).not.toBeNull();
      expect(doc!.activeVersion).toBeDefined();
      expect(doc!.activeVersion!.versionNumber).toBe('1.0');
    });
  });

  // =========================================================================
  // listConsentDocuments
  // =========================================================================
  describe('listConsentDocuments', () => {
    it('should return empty array when no documents exist for study', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { listConsentDocuments } = await import('../../../src/services/consent/consent.service');
      const docs = await listConsentDocuments(999);

      expect(docs).toEqual([]);
    });

    it('should return mapped documents for a study', async () => {
      const fakeRows = [
        {
          documentId: 1, studyId: 10, name: 'Doc A', description: null,
          documentType: 'main', languageCode: 'en', status: 'draft',
          requiresWitness: false, requiresLar: false, ageOfMajority: 18,
          minReadingTime: 60, ownerId: 5, ownerName: 'Admin',
          dateCreated: new Date(), dateUpdated: new Date(),
        },
        {
          documentId: 2, studyId: 10, name: 'Doc B', description: null,
          documentType: 'addendum', languageCode: 'en', status: 'active',
          requiresWitness: true, requiresLar: false, ageOfMajority: 18,
          minReadingTime: 30, ownerId: 5, ownerName: 'Admin',
          dateCreated: new Date(), dateUpdated: new Date(),
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: fakeRows });

      const { listConsentDocuments } = await import('../../../src/services/consent/consent.service');
      const docs = await listConsentDocuments(10);

      expect(docs).toHaveLength(2);
      expect(docs[0].name).toBe('Doc A');
      expect(docs[1].name).toBe('Doc B');
    });
  });

  // =========================================================================
  // hasValidConsent
  // =========================================================================
  describe('hasValidConsent', () => {
    it('should return false when subject has no consent records', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { hasValidConsent } = await import('../../../src/services/consent/consent.service');
      const result = await hasValidConsent(100);

      expect(result).toBe(false);
    });

    it('should return true when subject has active consent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });

      const { hasValidConsent } = await import('../../../src/services/consent/consent.service');
      const result = await hasValidConsent(100);

      expect(result).toBe(true);
    });
  });
});
