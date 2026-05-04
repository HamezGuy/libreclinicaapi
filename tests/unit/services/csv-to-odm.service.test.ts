/**
 * Unit Tests for CSV-to-ODM Service
 *
 * Tests parseCSV pure function logic — no database mocks needed.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('../../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/services/import/odm-builder.service', () => ({
  buildOdmFromCsvRows: jest.fn(() => '<ODM/>'),
}));

describe('CSV-to-ODM Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // parseCSV
  // =========================================================================
  describe('parseCSV', () => {
    it('should return empty result for empty string', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const result = parseCSV('');

      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('should return headers only when CSV has no data rows', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const result = parseCSV('SubjectID,Age,Gender');

      expect(result.headers).toEqual(['SubjectID', 'Age', 'Gender']);
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('should parse valid CSV with headers and rows', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Age,Gender\nSUBJ-001,45,Male\nSUBJ-002,32,Female';
      const result = parseCSV(csv);

      expect(result.headers).toEqual(['SubjectID', 'Age', 'Gender']);
      expect(result.rowCount).toBe(2);
      expect(result.rows[0]).toEqual({
        SubjectID: 'SUBJ-001',
        Age: '45',
        Gender: 'Male',
      });
      expect(result.rows[1]).toEqual({
        SubjectID: 'SUBJ-002',
        Age: '32',
        Gender: 'Female',
      });
    });

    it('should handle Windows line endings (CRLF)', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Age\r\nSUBJ-001,45\r\nSUBJ-002,32';
      const result = parseCSV(csv);

      expect(result.headers).toEqual(['SubjectID', 'Age']);
      expect(result.rowCount).toBe(2);
      expect(result.rows[0].SubjectID).toBe('SUBJ-001');
      expect(result.rows[1].SubjectID).toBe('SUBJ-002');
    });

    it('should handle old Mac line endings (CR only)', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Age\rSUBJ-001,45\rSUBJ-002,32';
      const result = parseCSV(csv);

      expect(result.headers).toEqual(['SubjectID', 'Age']);
      expect(result.rowCount).toBe(2);
    });

    it('should handle quoted fields containing commas', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Notes\nSUBJ-001,"Adverse event, mild"\nSUBJ-002,"Normal"';
      const result = parseCSV(csv);

      expect(result.rowCount).toBe(2);
      expect(result.rows[0].Notes).toBe('Adverse event, mild');
      expect(result.rows[1].Notes).toBe('Normal');
    });

    it('should handle escaped double quotes inside quoted fields', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Notes\nSUBJ-001,"Said ""hello"" to doctor"';
      const result = parseCSV(csv);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].Notes).toBe('Said "hello" to doctor');
    });

    it('should skip blank lines', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Age\n\nSUBJ-001,45\n\n\nSUBJ-002,32\n';
      const result = parseCSV(csv);

      expect(result.rowCount).toBe(2);
    });

    it('should handle missing trailing column values as empty strings', async () => {
      const { parseCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const csv = 'SubjectID,Age,Gender\nSUBJ-001,45';
      const result = parseCSV(csv);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].Gender).toBe('');
    });
  });

  // =========================================================================
  // validateCSV
  // =========================================================================
  describe('validateCSV', () => {
    it('should report error when subject ID column is missing', async () => {
      const { validateCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const result = validateCSV('Name,Age\nJohn,30', {
        subjectIdColumn: 'SubjectID',
        defaultEventOID: 'SE_V1',
        defaultFormOID: 'F_DEMO',
        defaultItemGroupOID: 'IG_DEMO',
        columnToItemOID: { Age: 'I_AGE' },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('SubjectID'))).toBe(true);
    });

    it('should pass validation with correct mapping', async () => {
      const { validateCSV } = await import('../../../src/services/import/csv-to-odm.service');
      const result = validateCSV('SubjectID,Age\nSUBJ-001,30', {
        subjectIdColumn: 'SubjectID',
        defaultEventOID: 'SE_V1',
        defaultFormOID: 'F_DEMO',
        defaultItemGroupOID: 'IG_DEMO',
        columnToItemOID: { Age: 'I_AGE' },
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
