/**
 * Unit Tests for Print/PDF Service
 * 
 * Tests form data retrieval, HTML generation, and PDF creation
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  pool: {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn()
    })
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

describe('PDF Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFormDataForPrint', () => {
    it('should return form data with all sections', async () => {
      // Mock form info query
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            event_crf_id: 1,
            form_name: 'Vital Signs',
            form_version: '1.0',
            event_name: 'Baseline Visit',
            subject_label: 'SUB001',
            study_name: 'Test Study',
            site_name: 'Site A',
            status: 'data_entry_complete'
          }]
        })
        .mockResolvedValueOnce({
          rows: [
            { section_id: 1, title: 'Demographics', subtitle: null, instructions: null },
            { section_id: 2, title: 'Measurements', subtitle: null, instructions: null }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            { item_id: 1, name: 'weight', description: 'Weight (kg)', value: '75' },
            { item_id: 2, name: 'height', description: 'Height (cm)', value: '180' }
          ]
        });

      const { getFormDataForPrint } = await import('../../src/services/pdf/pdf.service');
      const result = await getFormDataForPrint(1);

      expect(result).not.toBeNull();
      expect(result.formName).toBe('Vital Signs');
      expect(result.subjectLabel).toBe('SUB001');
    });

    it('should return null when form not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getFormDataForPrint } = await import('../../src/services/pdf/pdf.service');
      const result = await getFormDataForPrint(999);

      expect(result).toBeNull();
    });
  });

  describe('getBlankFormDataForPrint', () => {
    it('should return blank form template', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            crf_version_id: 1,
            form_name: 'Adverse Events',
            version: '1.0'
          }]
        })
        .mockResolvedValueOnce({
          rows: [
            { section_id: 1, title: 'Event Details', instructions: 'Enter event information' }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            { item_id: 1, name: 'event_term', description: 'Event Term', response_type: 'text' }
          ]
        });

      const { getBlankFormDataForPrint } = await import('../../src/services/pdf/pdf.service');
      const result = await getBlankFormDataForPrint(1);

      expect(result).not.toBeNull();
      expect(result.formName).toBe('Adverse Events');
    });
  });

  describe('getCasebookDataForPrint', () => {
    it('should return complete casebook data', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            study_subject_id: 1,
            subject_label: 'SUB001',
            study_name: 'Test Study',
            site_name: 'Site A',
            enrollment_date: new Date(),
            status: 'enrolled'
          }]
        })
        .mockResolvedValueOnce({
          rows: [
            { event_id: 1, event_name: 'Screening', event_date: new Date() },
            { event_id: 2, event_name: 'Baseline', event_date: new Date() }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            { event_crf_id: 1, form_name: 'Demographics' }
          ]
        });

      const { getCasebookDataForPrint } = await import('../../src/services/pdf/pdf.service');
      const result = await getCasebookDataForPrint(1, 'testuser');

      expect(result).not.toBeNull();
      expect(result.subjectLabel).toBe('SUB001');
    });
  });

  describe('getAuditTrailForPrint', () => {
    it('should return audit trail entries', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { 
            audit_id: 1, 
            audit_date: new Date(), 
            action: 'create',
            entity_type: 'item_data',
            old_value: null,
            new_value: '75',
            user_name: 'testuser',
            first_name: 'Test',
            last_name: 'User'
          },
          {
            audit_id: 2,
            audit_date: new Date(),
            action: 'update',
            entity_type: 'item_data',
            old_value: '75',
            new_value: '76',
            user_name: 'testuser',
            first_name: 'Test',
            last_name: 'User'
          }
        ]
      });

      const { getAuditTrailForPrint } = await import('../../src/services/pdf/pdf.service');
      const result = await getAuditTrailForPrint('event_crf', 1, 'testuser');

      expect(result).not.toBeNull();
      expect(result.entries).toHaveLength(2);
    });
  });

  describe('generateFormHtml', () => {
    it('should generate valid HTML string', async () => {
      const mockForm = {
        formId: 1,
        formName: 'Test Form',
        formVersion: '1.0',
        eventName: 'Visit 1',
        subjectLabel: 'SUB001',
        studyName: 'Test Study',
        siteName: 'Site A',
        sections: [{
          sectionId: 1,
          title: 'Section 1',
          fields: [{
            fieldId: 1,
            name: 'field1',
            label: 'Field 1',
            type: 'text',
            value: 'Test Value'
          }]
        }],
        status: 'complete'
      };

      const { generateFormHtml } = await import('../../src/services/pdf/pdf.service');
      const html = generateFormHtml(mockForm, { pageSize: 'A4' });

      expect(html).toContain('Test Form');
      expect(html).toContain('SUB001');
      expect(html).toContain('Section 1');
      expect(html).toContain('Test Value');
    });

    it('should include watermark when specified', async () => {
      const mockForm = {
        formId: 1,
        formName: 'Test Form',
        formVersion: '1.0',
        eventName: 'Visit 1',
        subjectLabel: 'SUB001',
        studyName: 'Test Study',
        siteName: 'Site A',
        sections: [],
        status: 'draft'
      };

      const { generateFormHtml } = await import('../../src/services/pdf/pdf.service');
      const html = generateFormHtml(mockForm, { watermark: 'DRAFT' });

      expect(html).toContain('DRAFT');
    });
  });

  describe('generateCasebookHtml', () => {
    it('should generate casebook HTML with all events', async () => {
      const mockCasebook = {
        studySubjectId: 1,
        subjectLabel: 'SUB001',
        studyName: 'Test Study',
        siteName: 'Site A',
        enrollmentDate: new Date(),
        status: 'enrolled',
        events: [{
          eventId: 1,
          eventName: 'Baseline',
          status: 'complete',
          forms: []
        }],
        generatedAt: new Date(),
        generatedBy: 'testuser'
      };

      const { generateCasebookHtml } = await import('../../src/services/pdf/pdf.service');
      const html = generateCasebookHtml(mockCasebook, {});

      expect(html).toContain('SUB001');
      expect(html).toContain('Baseline');
    });
  });

  describe('generateAuditTrailHtml', () => {
    it('should generate audit trail HTML with entries', async () => {
      const mockAuditTrail = {
        entityType: 'event_crf',
        entityId: 1,
        entityName: 'Vital Signs Form',
        entries: [{
          auditId: 1,
          auditDate: new Date(),
          action: 'create',
          entityType: 'item_data',
          entityId: 1,
          oldValue: undefined,
          newValue: '75',
          username: 'testuser',
          userFullName: 'Test User'
        }],
        generatedAt: new Date(),
        generatedBy: 'admin'
      };

      const { generateAuditTrailHtml } = await import('../../src/services/pdf/pdf.service');
      const html = generateAuditTrailHtml(mockAuditTrail, {});

      expect(html).toContain('Audit Trail');
      expect(html).toContain('Test User');
    });
  });
});

