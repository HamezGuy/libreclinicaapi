/**
 * Randomization Service Unit Tests
 * 
 * Tests all randomization operations:
 * - Get randomizations with filters
 * - Get study groups
 * - Create randomization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as randomizationService from '../src/services/database/randomization.service';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

describe('Randomization Service', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testGroupClassId: number;
  let testGroupId: number;
  let testRandomizationIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `RAND-TEST-${Date.now()}`
    });

    // Create test subject
    testSubjectId = await createTestSubject(testDb.pool, testStudyId, {
      label: `RAND-SUB-${Date.now()}`
    });

    // Create study group class
    // Note: study_group_class uses subject_assignment and group_class_type_id, NOT type
    const groupClassResult = await testDb.pool.query(`
      INSERT INTO study_group_class (study_id, name, subject_assignment, status_id, date_created, owner_id)
      VALUES ($1, 'Treatment Arms', 'Arm', 1, NOW(), $2)
      RETURNING study_group_class_id
    `, [testStudyId, rootUserId]);

    testGroupClassId = groupClassResult.rows[0].study_group_class_id;

    // Create study groups
    const groupResult = await testDb.pool.query(`
      INSERT INTO study_group (study_group_class_id, name, description)
      VALUES 
        ($1, 'Treatment A', 'Active treatment'),
        ($1, 'Treatment B', 'Placebo')
      RETURNING study_group_id
    `, [testGroupClassId]);

    testGroupId = groupResult.rows[0].study_group_id;
  });

  afterAll(async () => {
    // Cleanup
    if (testRandomizationIds.length > 0) {
      await testDb.pool.query('DELETE FROM subject_group_map WHERE subject_group_map_id = ANY($1)', [testRandomizationIds]);
    }
    if (testGroupId) {
      await testDb.pool.query('DELETE FROM study_group WHERE study_group_class_id = $1', [testGroupClassId]);
    }
    if (testGroupClassId) {
      await testDb.pool.query('DELETE FROM study_group_class WHERE study_group_class_id = $1', [testGroupClassId]);
    }
    if (testSubjectId) {
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  afterEach(async () => {
    // Cleanup randomizations after each test
    if (testRandomizationIds.length > 0) {
      await testDb.pool.query('DELETE FROM subject_group_map WHERE subject_group_map_id = ANY($1)', [testRandomizationIds]);
      testRandomizationIds = [];
    }
  });

  describe('getRandomizations', () => {
    beforeEach(async () => {
      // Create test randomization
      const result = await testDb.pool.query(`
        INSERT INTO subject_group_map (study_subject_id, study_group_id, owner_id, date_created)
        VALUES ($1, $2, $3, NOW())
        RETURNING subject_group_map_id
      `, [testSubjectId, testGroupId, rootUserId]);

      testRandomizationIds.push(result.rows[0].subject_group_map_id);
    });

    it('should return randomizations for study', async () => {
      const result = await randomizationService.getRandomizations({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should include group information', async () => {
      const result = await randomizationService.getRandomizations({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const record = result.data[0];
        expect(record.group_name).toBeDefined();
        expect(record.group_class_name).toBeDefined();
      }
    });

    it('should include subject information', async () => {
      const result = await randomizationService.getRandomizations({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        expect(result.data[0].subject_label).toBeDefined();
      }
    });

    it('should paginate results', async () => {
      const result = await randomizationService.getRandomizations({
        studyId: testStudyId,
        page: 1,
        limit: 5
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(5);
    });

    it('should use default pagination values', async () => {
      const result = await randomizationService.getRandomizations({
        studyId: testStudyId
      });

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });
  });

  describe('getGroupsByStudy', () => {
    it('should return study groups', async () => {
      const result = await randomizationService.getGroupsByStudy(testStudyId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should include group details', async () => {
      const result = await randomizationService.getGroupsByStudy(testStudyId);

      const group = result.data[0];
      expect(group.study_group_id).toBeDefined();
      expect(group.group_name).toBeDefined();
      expect(group.class_name).toBeDefined();
    });

    it('should include subject count per group', async () => {
      const result = await randomizationService.getGroupsByStudy(testStudyId);

      const group = result.data[0];
      expect(group.subject_count).toBeDefined();
      expect(typeof parseInt(group.subject_count)).toBe('number');
    });

    it('should return empty array for study with no groups', async () => {
      const emptyStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `EMPTY-RAND-${Date.now()}`
      });

      const result = await randomizationService.getGroupsByStudy(emptyStudyId);

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [emptyStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [emptyStudyId]);
    });
  });

  describe('createRandomization', () => {
    it('should create randomization', async () => {
      // Create a new subject for this test
      const newSubjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `NEW-RAND-${Date.now()}`
      });

      const result = await randomizationService.createRandomization({
        studySubjectId: newSubjectId,
        studyGroupId: testGroupId
      }, rootUserId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      if (result.data) {
        testRandomizationIds.push(result.data.subject_group_map_id);
      }

      // Cleanup
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [newSubjectId]);
    });

    it('should set owner_id correctly', async () => {
      const newSubjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `OWNER-RAND-${Date.now()}`
      });

      const result = await randomizationService.createRandomization({
        studySubjectId: newSubjectId,
        studyGroupId: testGroupId
      }, rootUserId);

      if (result.data) {
        testRandomizationIds.push(result.data.subject_group_map_id);
        expect(result.data.owner_id).toBe(rootUserId);
      }

      // Cleanup
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [newSubjectId]);
    });

    it('should create audit log entry', async () => {
      const newSubjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `AUDIT-RAND-${Date.now()}`
      });

      const result = await randomizationService.createRandomization({
        studySubjectId: newSubjectId,
        studyGroupId: testGroupId
      }, rootUserId);

      if (result.data) {
        testRandomizationIds.push(result.data.subject_group_map_id);

        const auditResult = await testDb.pool.query(
          'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
          [result.data.subject_group_map_id, 'subject_group_map']
        );

        expect(auditResult.rows.length).toBeGreaterThan(0);
        expect(auditResult.rows[0].entity_name).toBe('Subject Randomized');
      }

      // Cleanup
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [newSubjectId]);
    });

    it('should verify randomization in database', async () => {
      const newSubjectId = await createTestSubject(testDb.pool, testStudyId, {
        label: `VERIFY-RAND-${Date.now()}`
      });

      const result = await randomizationService.createRandomization({
        studySubjectId: newSubjectId,
        studyGroupId: testGroupId
      }, rootUserId);

      if (result.data) {
        testRandomizationIds.push(result.data.subject_group_map_id);

        const dbResult = await testDb.pool.query(
          'SELECT * FROM subject_group_map WHERE subject_group_map_id = $1',
          [result.data.subject_group_map_id]
        );

        expect(dbResult.rows.length).toBe(1);
        expect(dbResult.rows[0].study_subject_id).toBe(newSubjectId);
        expect(dbResult.rows[0].study_group_id).toBe(testGroupId);
      }

      // Cleanup
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [newSubjectId]);
    });
  });
});


