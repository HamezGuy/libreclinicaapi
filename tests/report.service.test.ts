/**
 * Report Service Unit Tests
 * 
 * Tests all report generation operations:
 * - Generate enrollment report
 * - Generate completion report
 * - Generate query report
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as reportService from '../src/services/database/report.service';
import { createTestStudy, createTestSubject, createTestQuery } from './fixtures/test-data';

describe('Report Service', () => {
  let testStudyId: number;
  let testSubjectIds: number[] = [];
  let testQueryIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.connect();
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `REPORT-TEST-${Date.now()}`,
      name: 'Report Test Study'
    });

    // Create test subjects
    for (let i = 0; i < 3; i++) {
      const subjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `RPT-SUB-${Date.now()}-${i}`
      });
      testSubjectIds.push(subjectId);
    }

    // Create test queries
    for (let i = 0; i < 2; i++) {
      const queryId = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: `Test Query ${i}`
      });
      testQueryIds.push(queryId);
    }
  });

  afterEach(async () => {
    // Cleanup
    if (testQueryIds.length > 0) {
      await testDb.pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = ANY($1)', [testQueryIds]);
      testQueryIds = [];
    }
    if (testSubjectIds.length > 0) {
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      testSubjectIds = [];
    }
    testStudyId = 0;
  });

  afterAll(async () => {
    // Cleanup handled by global teardown
  });

  describe('generateEnrollmentReport', () => {
    it('should generate CSV enrollment report', async () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();

      const csv = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate, 'csv');

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Subject ID');
      expect(csv).toContain('Enrollment Date');
      expect(csv).toContain('Status');
    });

    it('should include subject data in report', async () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();

      const csv = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate, 'csv');

      // Should have header + data rows
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by date range', async () => {
      // Use future dates to get no results
      const startDate = new Date('2099-01-01');
      const endDate = new Date('2099-12-31');

      const csv = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate, 'csv');

      // Should only have header
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1); // Just header
    });

    it('should include all required columns', async () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();

      const csv = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate, 'csv');

      expect(csv).toContain('Subject ID');
      expect(csv).toContain('Secondary ID');
      expect(csv).toContain('Enrollment Date');
      expect(csv).toContain('Status');
      expect(csv).toContain('Gender');
      expect(csv).toContain('DOB');
      expect(csv).toContain('Enrolled By');
      expect(csv).toContain('Created');
    });

    it('should default to CSV format', async () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();

      const csv = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate);

      expect(csv).toContain('Subject ID'); // CSV header format
    });

    it('should return message for PDF format', async () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();

      const result = await reportService.generateEnrollmentReport(testStudyId, startDate, endDate, 'pdf');

      expect(result).toContain('PDF generation not implemented');
    });
  });

  describe('generateCompletionReport', () => {
    it('should generate CSV completion report', async () => {
      const csv = await reportService.generateCompletionReport(testStudyId, 'csv');

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Subject ID');
      expect(csv).toContain('Event');
      expect(csv).toContain('Form');
    });

    it('should include all required columns', async () => {
      const csv = await reportService.generateCompletionReport(testStudyId, 'csv');

      expect(csv).toContain('Subject ID');
      expect(csv).toContain('Event');
      expect(csv).toContain('Form');
      expect(csv).toContain('Status');
      expect(csv).toContain('Created');
      expect(csv).toContain('Updated');
      expect(csv).toContain('Completed By');
    });

    it('should default to CSV format', async () => {
      const csv = await reportService.generateCompletionReport(testStudyId);

      expect(csv).toContain('Subject ID'); // CSV header
    });

    it('should return message for PDF format', async () => {
      const result = await reportService.generateCompletionReport(testStudyId, 'pdf');

      expect(result).toContain('PDF generation not implemented');
    });

    it('should handle study with no event CRFs', async () => {
      // Use a new empty study
      const emptyStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `EMPTY-RPT-${Date.now()}`
      });

      const csv = await reportService.generateCompletionReport(emptyStudyId, 'csv');

      // Should have header only
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [emptyStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [emptyStudyId]);
    });
  });

  describe('generateQueryReport', () => {
    it('should generate CSV query report', async () => {
      const csv = await reportService.generateQueryReport(testStudyId, 'csv');

      expect(typeof csv).toBe('string');
      expect(csv).toContain('Query ID');
      expect(csv).toContain('Subject');
      expect(csv).toContain('Type');
    });

    it('should include all required columns', async () => {
      const csv = await reportService.generateQueryReport(testStudyId, 'csv');

      expect(csv).toContain('Query ID');
      expect(csv).toContain('Subject');
      expect(csv).toContain('Type');
      expect(csv).toContain('Description');
      expect(csv).toContain('Status');
      expect(csv).toContain('Created By');
      expect(csv).toContain('Date');
      expect(csv).toContain('Assigned To');
      expect(csv).toContain('Responses');
    });

    it('should include query data in report', async () => {
      const csv = await reportService.generateQueryReport(testStudyId, 'csv');

      // Should have header + data rows (we created 2 queries)
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should default to CSV format', async () => {
      const csv = await reportService.generateQueryReport(testStudyId);

      expect(csv).toContain('Query ID'); // CSV header
    });

    it('should return message for PDF format', async () => {
      const result = await reportService.generateQueryReport(testStudyId, 'pdf');

      expect(result).toContain('PDF generation not implemented');
    });

    it('should only include parent queries (not responses)', async () => {
      // Create a response to a query
      if (testQueryIds.length > 0) {
        await testDb.pool.query(`
          INSERT INTO discrepancy_note (
            description, discrepancy_note_type_id, resolution_status_id,
            parent_dn_id, date_created, owner_id, study_id
          ) VALUES ('Response', 3, 1, $1, NOW(), $2, $3)
        `, [testQueryIds[0], rootUserId, testStudyId]);
      }

      const csv = await reportService.generateQueryReport(testStudyId, 'csv');

      // Count data rows (excluding header)
      const lines = csv.split('\n').filter(line => line.trim());
      // Should have header + only parent queries (not responses)
      expect(lines.length).toBe(testQueryIds.length + 1);
    });

    it('should handle study with no queries', async () => {
      const emptyStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `NOQUERY-${Date.now()}`
      });

      const csv = await reportService.generateQueryReport(emptyStudyId, 'csv');

      // Should have header only
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [emptyStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [emptyStudyId]);
    });
  });
});
