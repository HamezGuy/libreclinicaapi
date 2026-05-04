/**
 * Unit Tests for PDF Service
 *
 * Tests getFormDataForPrint with mock database and utility dependencies.
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

jest.mock('../../../src/utils/extended-props', () => ({
  stripExtendedProps: jest.fn((v: unknown) => v),
  parseExtendedProps: jest.fn(() => ({})),
}));

jest.mock('../../../src/utils/query-correction.helper', () => ({
  parseResponseSetOptions: jest.fn(() => []),
}));

jest.mock('../../../src/utils/date.util', () => ({
  formatDate: jest.fn((d: unknown) => String(d)),
  formatDateTimeFull: jest.fn((d: unknown) => String(d)),
}));

describe('PDF Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getFormDataForPrint
  // =========================================================================
  describe('getFormDataForPrint', () => {
    it('should return null when event_crf_id is not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const result = await getFormDataForPrint(99999);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should return PrintableForm with correct structure when data exists', async () => {
      const headerRow = {
        eventCrfId: 1,
        crfId: 10,
        crfName: 'Vitals',
        versionName: 'v1',
        eventName: 'Screening',
        subjectLabel: 'SUBJ-001',
        studyName: 'STUDY-A',
        siteName: 'Site Alpha',
        status: 'Available',
        dateCompleted: new Date('2026-03-01'),
        electronicSignatureStatus: false,
        sdvStatus: false,
        completedBy: 'Dr. Smith',
        isLocked: false,
      };
      const sectionRow = {
        sectionId: 100,
        title: 'Demographics',
        subtitle: null,
        instructions: null,
        ordinal: 1,
      };
      const fieldRow = {
        itemId: 200,
        name: 'I_VITALS_HEIGHT',
        description: 'Height',
        units: 'cm',
        dataType: 'REAL',
        sectionId: 100,
        ordinal: 1,
        required: true,
        placeholder: 'Enter height',
        value: '175.5',
        valueStatus: 1,
        optionsText: null,
        optionsValues: null,
        responseType: null,
        openQueryId: null,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [headerRow] })
        .mockResolvedValueOnce({ rows: [sectionRow] })
        .mockResolvedValueOnce({ rows: [fieldRow] });

      const { getFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const form = await getFormDataForPrint(1);

      expect(form).not.toBeNull();
      expect(form!.formName).toBe('Vitals');
      expect(form!.subjectLabel).toBe('SUBJ-001');
      expect(form!.studyName).toBe('STUDY-A');
      expect(form!.sections).toHaveLength(1);
      expect(form!.sections[0].title).toBe('Demographics');
      expect(form!.sections[0].fields).toHaveLength(1);
      expect(form!.sections[0].fields[0].name).toBe('I_VITALS_HEIGHT');
    });

    it('should handle form with empty sections', async () => {
      const headerRow = {
        eventCrfId: 2,
        crfId: 11,
        crfName: 'Empty Form',
        versionName: 'v1',
        eventName: 'Visit 1',
        subjectLabel: 'SUBJ-002',
        studyName: 'STUDY-B',
        siteName: 'Site Beta',
        status: 'Available',
        dateCompleted: null,
        electronicSignatureStatus: null,
        sdvStatus: null,
        completedBy: null,
        isLocked: false,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [headerRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const form = await getFormDataForPrint(2);

      expect(form).not.toBeNull();
      expect(form!.formName).toBe('Empty Form');
      expect(form!.sections).toEqual([]);
    });

    it('should propagate database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));

      const { getFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      await expect(getFormDataForPrint(1)).rejects.toThrow('connection lost');
    });

    it('should set locked status when status_id indicates locked', async () => {
      const headerRow = {
        eventCrfId: 3,
        crfId: 12,
        crfName: 'Locked Form',
        versionName: 'v2',
        eventName: 'Visit 2',
        subjectLabel: 'SUBJ-003',
        studyName: 'STUDY-C',
        siteName: 'Site Gamma',
        status: 'Locked',
        dateCompleted: new Date(),
        electronicSignatureStatus: true,
        sdvStatus: true,
        completedBy: 'Dr. Jones',
        isLocked: true,
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [headerRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const form = await getFormDataForPrint(3);

      expect(form).not.toBeNull();
      expect(form!.lockStatus).toBe(true);
      expect(form!.signatureStatus).toBe(true);
      expect(form!.sdvStatus).toBe(true);
    });
  });

  // =========================================================================
  // getBlankFormDataForPrint
  // =========================================================================
  describe('getBlankFormDataForPrint', () => {
    it('should return null when crf_version_id is not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getBlankFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const result = await getBlankFormDataForPrint(99999);

      expect(result).toBeNull();
    });

    it('should return blank template with placeholder labels', async () => {
      const headerRow = {
        crfVersionId: 50,
        crfId: 10,
        crfName: 'Template Form',
        versionName: 'v1',
        studyName: 'STUDY-A',
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [headerRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { getBlankFormDataForPrint } = await import('../../../src/services/pdf/pdf.service');
      const form = await getBlankFormDataForPrint(50);

      expect(form).not.toBeNull();
      expect(form!.formName).toBe('Template Form');
      expect(form!.subjectLabel).toBe('________________');
      expect(form!.status).toBe('BLANK TEMPLATE');
    });
  });

  // =========================================================================
  // generateFormHtml
  // =========================================================================
  describe('generateFormHtml', () => {
    it('should generate HTML string with form name in title', async () => {
      const { generateFormHtml } = await import('../../../src/services/pdf/pdf.service');

      const form = {
        formId: 1,
        formName: 'Test CRF',
        formVersion: 'v1',
        eventName: 'Screening',
        subjectLabel: 'SUBJ-001',
        studyName: 'Study A',
        siteName: 'Site 1',
        sections: [],
        status: 'Available',
      };

      const html = generateFormHtml(form, {
        pageSize: 'Letter',
        orientation: 'portrait',
        includeHeader: true,
        includeFooter: true,
        includeAuditTrail: false,
      });

      expect(html).toContain('Test CRF');
      expect(html).toContain('SUBJ-001');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });
});
