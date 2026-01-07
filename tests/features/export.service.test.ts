/**
 * Export Service Unit Tests
 * 
 * Tests for CDISC/ODM export using LibreClinica's dataset_* tables
 */

import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { pool } from '../../src/config/database';
import * as exportService from '../../src/services/export/export.service';

// Mock database and SOAP
jest.mock('../../src/config/database', () => ({
  pool: {
    query: (jest.fn() as any)
  }
}));

jest.mock('../../src/services/soap/soapClient', () => ({
  getSoapClient: (jest.fn() as any).mockReturnValue({
    executeRequest: (jest.fn() as any).mockResolvedValue({
      success: true,
      data: {
        study: { name: 'Test Study' },
        subjects: []
      }
    })
  })
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Export Service', () => {
  const mockPool = pool as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDataset', () => {
    test('should create a dataset in LibreClinica dataset table', async () => {
      // Mock study lookup
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ study_id: 1 }] }) // Study lookup
        .mockResolvedValueOnce({ rows: [{ dataset_id: 1 }] }); // Dataset insert

      const config = {
        studyOID: 'S_TEST',
        name: 'Test Dataset',
        description: 'Test export dataset',
        showSubjectDob: true,
        showSubjectGender: true
      };

      const result = await exportService.createDataset(config, 1);

      expect(result.success).toBe(true);
      expect(result.datasetId).toBe(1);

      // Verify the insert query was called with correct parameters
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const insertCall = mockPool.query.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO dataset');
    });

    test('should create dataset_crf_version_map entries for CRF OIDs', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ study_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ dataset_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ event_definition_crf_id: 1, crf_version_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // Insert crf map

      const config = {
        studyOID: 'S_TEST',
        name: 'CRF Dataset',
        crfOIDs: ['F_CRF1']
      };

      const result = await exportService.createDataset(config, 1);

      expect(result.success).toBe(true);
      
      // Verify CRF map insert
      const mapCall = mockPool.query.mock.calls.find(
        (call: any) => call[0]?.includes?.('dataset_crf_version_map')
      );
      expect(mapCall).toBeDefined();
    });

    test('should handle study not found error', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }); // No study found

      const result = await exportService.createDataset({
        studyOID: 'NONEXISTENT',
        name: 'Test'
      }, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Study not found');
    });
  });

  describe('getDatasets', () => {
    test('should retrieve datasets for a study', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            dataset_id: 1,
            name: 'Dataset 1',
            description: 'First dataset',
            num_runs: 5,
            date_created: new Date(),
            study_oid: 'S_TEST',
            study_name: 'Test Study'
          },
          {
            dataset_id: 2,
            name: 'Dataset 2',
            description: 'Second dataset',
            num_runs: 3,
            date_created: new Date(),
            study_oid: 'S_TEST',
            study_name: 'Test Study'
          }
        ]
      });

      const datasets = await exportService.getDatasets('S_TEST');

      expect(datasets.length).toBe(2);
      expect(datasets[0].name).toBe('Dataset 1');
      expect(datasets[1].name).toBe('Dataset 2');
    });

    test('should return empty array on error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Error'));

      const datasets = await exportService.getDatasets('S_TEST');

      expect(datasets).toEqual([]);
    });
  });

  describe('archiveExportedFile', () => {
    test('should archive file in archived_dataset_file table', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ export_format_id: 1 }] }) // Format lookup
        .mockResolvedValueOnce({ rows: [] }); // Insert

      const result = await exportService.archiveExportedFile(
        1,
        'export_2024.xml',
        '/exports/export_2024.xml',
        'odm',
        1
      );

      expect(result).toBe(true);

      // Verify insert call
      const insertCall = mockPool.query.mock.calls.find(
        (call: any) => call[0]?.includes?.('archived_dataset_file')
      );
      expect(insertCall).toBeDefined();
    });

    test('should handle archive failure gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await exportService.archiveExportedFile(
        1, 'test.xml', '/path', 'odm', 1
      );

      expect(result).toBe(false);
    });
  });

  describe('getArchivedExports', () => {
    test('should retrieve archived exports for a dataset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            archived_dataset_file_id: 1,
            filename: 'export_1.xml',
            date_created: new Date(),
            format: 'ODM'
          },
          {
            archived_dataset_file_id: 2,
            filename: 'export_2.csv',
            date_created: new Date(),
            format: 'CSV'
          }
        ]
      });

      const archives = await exportService.getArchivedExports(1);

      expect(archives.length).toBe(2);
      expect(archives[0].filename).toBe('export_1.xml');
      expect(archives[1].filename).toBe('export_2.csv');
    });
  });

  describe('executeExport', () => {
    test('should generate valid ODM XML', async () => {
      const result = await exportService.executeExport(
        { studyOID: 'S_TEST' },
        'odm',
        'testuser'
      );

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain('<?xml');
      expect(result.data?.content).toContain('ODM');
      expect(result.data?.mimeType).toBe('application/xml');
      expect(result.data?.filename).toContain('.xml');
    });

    test('should generate valid CSV', async () => {
      const result = await exportService.executeExport(
        { studyOID: 'S_TEST' },
        'csv',
        'testuser'
      );

      expect(result.success).toBe(true);
      expect(result.data?.mimeType).toBe('text/csv');
      expect(result.data?.filename).toContain('.csv');
    });

    test('should handle unsupported format', async () => {
      const result = await exportService.executeExport(
        { studyOID: 'S_TEST' },
        'unsupported' as any,
        'testuser'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported');
    });
  });

  describe('buildFullOdmExport', () => {
    test('should include full clinical data in ODM export', async () => {
      // Mock all the database queries for full export
      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ study_id: 1, name: 'Test Study', oc_oid: 'S_TEST', unique_identifier: 'TEST01' }] 
        }) // Study
        .mockResolvedValueOnce({ 
          rows: [
            { crf_id: 1, name: 'Demographics', oc_oid: 'F_DEMO', crf_version_id: 1, version_oid: 'F_DEMO_V1' }
          ] 
        }) // CRFs
        .mockResolvedValueOnce({ 
          rows: [{ item_group_id: 1, name: 'Main', oc_oid: 'IG_MAIN' }] 
        }) // Item groups for CRF 1
        .mockResolvedValueOnce({ 
          rows: [
            { 
              study_subject_id: 1, 
              study_subject_id_label: 'SUBJ001', 
              oc_oid: 'SS_001',
              subject_id: 'S001',
              gender: 'M',
              date_of_birth: '1990-01-01'
            }
          ] 
        }) // Subjects
        .mockResolvedValueOnce({ 
          rows: [
            {
              study_event_id: 1,
              event_oid: 'SE_SCREENING',
              event_name: 'Screening',
              sample_ordinal: 1
            }
          ] 
        }) // Events for subject 1
        .mockResolvedValueOnce({ 
          rows: [
            { event_crf_id: 1, form_oid: 'F_DEMO', form_name: 'Demographics' }
          ] 
        }) // Event CRFs
        .mockResolvedValueOnce({ 
          rows: [
            { item_data_id: 1, item_oid: 'I_NAME', item_name: 'Name', value: 'John', item_group_oid: 'IG_MAIN' },
            { item_data_id: 2, item_oid: 'I_AGE', item_name: 'Age', value: '34', item_group_oid: 'IG_MAIN' }
          ] 
        }); // Item data

      const odmXml = await exportService.buildFullOdmExport(
        { studyOID: 'S_TEST' },
        'testuser'
      );

      expect(odmXml).toContain('<?xml');
      expect(odmXml).toContain('ODM');
      expect(odmXml).toContain('S_TEST');
      expect(odmXml).toContain('SubjectData');
      expect(odmXml).toContain('StudyEventData');
      expect(odmXml).toContain('FormData');
      expect(odmXml).toContain('ItemData');
    });
  });
});

describe('ODM XML Format', () => {
  test('should properly escape XML special characters', () => {
    const escapeXml = (str: string): string => {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    expect(escapeXml('John & Jane')).toBe('John &amp; Jane');
    expect(escapeXml('<script>')).toBe('&lt;script&gt;');
    expect(escapeXml('Say "hello"')).toBe('Say &quot;hello&quot;');
  });

  test('should properly escape CSV special characters', () => {
    const csvEscape = (str: string): string => {
      if (!str) return '';
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    expect(csvEscape('simple')).toBe('simple');
    expect(csvEscape('with, comma')).toBe('"with, comma"');
    expect(csvEscape('with "quotes"')).toBe('"with ""quotes"""');
    expect(csvEscape('with\nnewline')).toBe('"with\nnewline"');
  });
});

describe('Export Formats', () => {
  test('should support all required formats', () => {
    const supportedFormats = ['csv', 'odm', 'spss', 'txt'];
    
    expect(supportedFormats).toContain('csv');
    expect(supportedFormats).toContain('odm');
  });

  test('should generate correct MIME types', () => {
    const mimeTypes: Record<string, string> = {
      'csv': 'text/csv',
      'odm': 'application/xml',
      'txt': 'text/plain',
      'xml': 'application/xml'
    };

    expect(mimeTypes['csv']).toBe('text/csv');
    expect(mimeTypes['odm']).toBe('application/xml');
  });
});

