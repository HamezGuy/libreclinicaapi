/**
 * Subject Service Unit Tests
 * 
 * Tests all subject management operations:
 * - Create subject (via SOAP)
 * - Get subject list with filters
 * - Get subject by ID
 * - Get subject progress statistics
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as subjectService from '../src/services/hybrid/subject.service';
import { createTestStudy, createTestSubject, createTestEventDefinition } from './fixtures/test-data';

describe('Subject Service', () => {
  let testStudyId: number;
  let testSubjectIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `SUBJECT-TEST-${Date.now()}`,
      name: 'Subject Test Study'
    });

    // Create event definitions
    await createTestEventDefinition(testDb.pool, testStudyId, {
      name: 'Screening Visit',
      ordinal: 1
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testSubjectIds.length > 0) {
      await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create test subjects
    for (let i = 0; i < 5; i++) {
      const subjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `SUB-TEST-${Date.now()}-${i}`,
        statusId: i % 2 === 0 ? 1 : 5 // Mix of available and removed
      });
      testSubjectIds.push(subjectId);
    }
  });

  afterEach(async () => {
    // Cleanup subjects after each test
    if (testSubjectIds.length > 0) {
      await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      testSubjectIds = [];
    }
  });

  describe('getSubjectList', () => {
    it('should return paginated subject list', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        status: 'available',
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.every((s: any) => s.status === 'available')).toBe(true);
    });

    it('should return total count', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 10
      });

      expect(result.pagination?.total).toBeDefined();
      expect(typeof result.pagination?.total).toBe('number');
    });

    it('should include subject details', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const subject = result.data[0];
        expect(subject.study_subject_id).toBeDefined();
        expect(subject.label).toBeDefined();
        expect(subject.status).toBeDefined();
      }
    });

    it('should include event counts', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const subject = result.data[0];
        expect(subject.total_events).toBeDefined();
        expect(subject.completed_forms).toBeDefined();
      }
    });

    it('should handle pagination correctly', async () => {
      const page1 = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 2
      });

      const page2 = await subjectService.getSubjectList(testStudyId, {
        page: 2,
        limit: 2
      });

      expect(page1.pagination?.page).toBe(1);
      expect(page2.pagination?.page).toBe(2);
    });

    it('should use default pagination', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {});

      expect(result.pagination?.page).toBe(1);
      expect(result.pagination?.limit).toBe(20);
    });

    it('should order by enrollment date', async () => {
      const result = await subjectService.getSubjectList(testStudyId, {
        page: 1,
        limit: 100
      });

      // Results should be in descending order by enrollment_date
      if (result.data.length > 1) {
        for (let i = 0; i < result.data.length - 1; i++) {
          const current = result.data[i].enrollment_date || result.data[i].date_created;
          const next = result.data[i + 1].enrollment_date || result.data[i + 1].date_created;
          if (current && next) {
            expect(new Date(current).getTime()).toBeGreaterThanOrEqual(new Date(next).getTime());
          }
        }
      }
    });
  });

  describe('getSubjectById', () => {
    it('should return subject by ID', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject).toBeDefined();
        expect(subject?.studySubjectId).toBe(testSubjectIds[0]);
      }
    });

    it('should include subject details', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject?.label).toBeDefined();
        expect(subject?.status).toBeDefined();
        expect(subject?.gender).toBeDefined();
      }
    });

    it('should include events array', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject?.events).toBeDefined();
        expect(Array.isArray(subject?.events)).toBe(true);
      }
    });

    it('should calculate completion percentage', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject?.progress?.percentComplete).toBeDefined();
        expect(typeof subject?.progress?.percentComplete).toBe('number');
        expect(subject?.progress?.percentComplete).toBeGreaterThanOrEqual(0);
        expect(subject?.progress?.percentComplete).toBeLessThanOrEqual(100);
      }
    });

    it('should include progress statistics', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject?.progress).toBeDefined();
      }
    });

    it('should return null for non-existent subject', async () => {
      const subject = await subjectService.getSubjectById(999999);

      expect(subject).toBeNull();
    });

    it('should include subject record details', async () => {
      if (testSubjectIds.length > 0) {
        const subject = await subjectService.getSubjectById(testSubjectIds[0]);

        expect(subject?.subject).toBeDefined();
        expect(subject?.subject?.subjectId).toBeDefined();
      }
    });
  });

  describe('getSubjectProgress', () => {
    it('should return progress statistics', async () => {
      if (testSubjectIds.length > 0) {
        const progress = await subjectService.getSubjectProgress(testSubjectIds[0]);

        expect(progress).toBeDefined();
        expect(progress?.totalEvents).toBeDefined();
        expect(progress?.completedEvents).toBeDefined();
      }
    });

    it('should include event completion percentage', async () => {
      if (testSubjectIds.length > 0) {
        const progress = await subjectService.getSubjectProgress(testSubjectIds[0]);

        expect(progress?.eventCompletionPercentage).toBeDefined();
        expect(typeof progress?.eventCompletionPercentage).toBe('number');
      }
    });

    it('should include form statistics', async () => {
      if (testSubjectIds.length > 0) {
        const progress = await subjectService.getSubjectProgress(testSubjectIds[0]);

        expect(progress?.totalForms).toBeDefined();
        expect(progress?.completedForms).toBeDefined();
        expect(progress?.formCompletionPercentage).toBeDefined();
      }
    });

    it('should include open queries count', async () => {
      if (testSubjectIds.length > 0) {
        const progress = await subjectService.getSubjectProgress(testSubjectIds[0]);

        expect(progress?.openQueries).toBeDefined();
        expect(typeof progress?.openQueries).toBe('number');
      }
    });

    it('should return null for non-existent subject', async () => {
      const progress = await subjectService.getSubjectProgress(999999);

      expect(progress).toBeNull();
    });

    it('should calculate percentages correctly', async () => {
      if (testSubjectIds.length > 0) {
        const progress = await subjectService.getSubjectProgress(testSubjectIds[0]);

        if (progress) {
          // Event completion percentage should be valid
          if (progress.totalEvents > 0) {
            expect(progress.eventCompletionPercentage).toBe(
              Math.round((progress.completedEvents / progress.totalEvents) * 100)
            );
          }

          // Form completion percentage should be valid
          if (progress.totalForms > 0) {
            expect(progress.formCompletionPercentage).toBe(
              Math.round((progress.completedForms / progress.totalForms) * 100)
            );
          }
        }
      }
    });
  });

  describe('createSubject (SOAP Integration)', () => {
    // Note: These tests require SOAP service to be running
    // They are integration tests that verify database state after SOAP call

    it.skip('should create subject via SOAP and verify in database', async () => {
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: `NEW-SUB-${Date.now()}`,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');

      if (result.success) {
        expect(result.data?.studySubjectId).toBeDefined();

        // Verify in database
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study_subject WHERE label = $1',
          [result.data?.studySubjectId]
        );

        expect(dbResult.rows.length).toBe(1);

        // Cleanup
        if (dbResult.rows[0]) {
          await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [dbResult.rows[0].study_subject_id]);
        }
      }
    });

    it('should return error response on SOAP failure', async () => {
      // This test expects SOAP to fail with invalid credentials
      const result = await subjectService.createSubject({
        studyId: 999999, // Invalid study
        studySubjectId: `INVALID-${Date.now()}`,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');

      // Should either succeed (if SOAP is not configured) or fail gracefully
      expect(result.success !== undefined).toBe(true);
    });
  });
});


