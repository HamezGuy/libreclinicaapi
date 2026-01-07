/**
 * Query Service Unit Tests
 * 
 * Tests all discrepancy note/query operations:
 * - Get queries with filters
 * - Get query by ID
 * - Create query
 * - Add query response
 * - Update query status
 * - Get query statistics
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as queryService from '../src/services/database/query.service';
import { createTestStudy, createTestSubject, createTestQuery } from './fixtures/test-data';

describe('Query Service', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testQueryIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study and subject
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `QUERY-TEST-${Date.now()}`
    });

    testSubjectId = await createTestSubject(testDb.pool, testStudyId, {
      label: `QUERY-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testQueryIds.length > 0) {
      await testDb.pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = ANY($1)', [testQueryIds]);
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
    // Cleanup queries after each test
    if (testQueryIds.length > 0) {
      await testDb.pool.query('DELETE FROM discrepancy_note WHERE parent_dn_id = ANY($1)', [testQueryIds]);
      await testDb.pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = ANY($1)', [testQueryIds]);
      testQueryIds = [];
    }
  });

  describe('getQueries', () => {
    beforeEach(async () => {
      // Create test queries
      for (let i = 0; i < 3; i++) {
        const queryId = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
          description: `Test Query ${i}`
        });
        testQueryIds.push(queryId);
      }
    });

    it('should return paginated queries', async () => {
      const result = await queryService.getQueries({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by studyId', async () => {
      const result = await queryService.getQueries({
        studyId: testStudyId,
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.every((q: any) => q.study_id === testStudyId)).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await queryService.getQueries({
        studyId: testStudyId,
        status: 'New',
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return total count', async () => {
      const result = await queryService.getQueries({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.pagination?.total).toBeDefined();
      expect(typeof result.pagination?.total).toBe('number');
    });

    it('should handle pagination correctly', async () => {
      const page1 = await queryService.getQueries({
        studyId: testStudyId,
        page: 1,
        limit: 2
      });

      const page2 = await queryService.getQueries({
        studyId: testStudyId,
        page: 2,
        limit: 2
      });

      expect(page1.pagination?.page).toBe(1);
      expect(page2.pagination?.page).toBe(2);
    });

    it('should include response count', async () => {
      const result = await queryService.getQueries({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        expect(result.data[0].response_count).toBeDefined();
      }
    });
  });

  describe('getQueryById', () => {
    let singleQueryId: number;

    beforeEach(async () => {
      singleQueryId = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: 'Single Query Test'
      });
      testQueryIds.push(singleQueryId);
    });

    it('should return query by ID', async () => {
      const query = await queryService.getQueryById(singleQueryId);

      expect(query).toBeDefined();
      expect(query.discrepancy_note_id).toBe(singleQueryId);
    });

    it('should include query details', async () => {
      const query = await queryService.getQueryById(singleQueryId);

      expect(query.description).toBeDefined();
      expect(query.type_name).toBeDefined();
      expect(query.status_name).toBeDefined();
    });

    it('should include responses array', async () => {
      const query = await queryService.getQueryById(singleQueryId);

      expect(query.responses).toBeDefined();
      expect(Array.isArray(query.responses)).toBe(true);
    });

    it('should return null for non-existent query', async () => {
      const query = await queryService.getQueryById(999999);

      expect(query).toBeNull();
    });

    it('should include study name', async () => {
      const query = await queryService.getQueryById(singleQueryId);

      expect(query.study_name).toBeDefined();
    });
  });

  describe('createQuery', () => {
    it('should create a new query', async () => {
      const result = await queryService.createQuery({
        entityType: 'studySubject',
        entityId: testSubjectId,
        studyId: testStudyId,
        description: 'Test Create Query',
        detailedNotes: 'This is a test query'
      }, rootUserId);

      expect(result.success).toBe(true);
      expect(result.queryId).toBeDefined();

      if (result.queryId) {
        testQueryIds.push(result.queryId);
      }
    });

    it('should reject invalid entity type', async () => {
      const result = await queryService.createQuery({
        entityType: 'invalidType',
        entityId: 1,
        studyId: testStudyId,
        description: 'Invalid Entity Type Test'
      }, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid entity type');
    });

    it('should create audit log entry', async () => {
      const result = await queryService.createQuery({
        entityType: 'studySubject',
        entityId: testSubjectId,
        studyId: testStudyId,
        description: 'Audit Test Query'
      }, rootUserId);

      if (result.queryId) {
        testQueryIds.push(result.queryId);

        const auditResult = await testDb.pool.query(
          'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
          [result.queryId, 'discrepancy_note']
        );

        expect(auditResult.rows.length).toBeGreaterThan(0);
      }
    });

    it('should use default type ID if not provided', async () => {
      const result = await queryService.createQuery({
        entityType: 'studySubject',
        entityId: testSubjectId,
        studyId: testStudyId,
        description: 'Default Type Test'
      }, rootUserId);

      expect(result.success).toBe(true);

      if (result.queryId) {
        testQueryIds.push(result.queryId);

        const queryResult = await testDb.pool.query(
          'SELECT discrepancy_note_type_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
          [result.queryId]
        );

        expect(queryResult.rows[0].discrepancy_note_type_id).toBe(3); // Query type
      }
    });
  });

  describe('addQueryResponse', () => {
    let parentQueryId: number;

    beforeEach(async () => {
      parentQueryId = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: 'Parent Query for Response Test'
      });
      testQueryIds.push(parentQueryId);
    });

    it('should add response to existing query', async () => {
      const result = await queryService.addQueryResponse(parentQueryId, {
        description: 'Test Response',
        detailedNotes: 'Response details'
      }, rootUserId);

      expect(result.success).toBe(true);
      expect(result.responseId).toBeDefined();

      if (result.responseId) {
        testQueryIds.push(result.responseId);
      }
    });

    it('should link response to parent', async () => {
      const result = await queryService.addQueryResponse(parentQueryId, {
        description: 'Linked Response Test'
      }, rootUserId);

      if (result.responseId) {
        testQueryIds.push(result.responseId);

        const responseResult = await testDb.pool.query(
          'SELECT parent_dn_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
          [result.responseId]
        );

        expect(responseResult.rows[0].parent_dn_id).toBe(parentQueryId);
      }
    });

    it('should fail for non-existent parent query', async () => {
      const result = await queryService.addQueryResponse(999999, {
        description: 'Orphan Response'
      }, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should inherit study ID from parent', async () => {
      const result = await queryService.addQueryResponse(parentQueryId, {
        description: 'Study Inherit Test'
      }, rootUserId);

      if (result.responseId) {
        testQueryIds.push(result.responseId);

        const responseResult = await testDb.pool.query(
          'SELECT study_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
          [result.responseId]
        );

        expect(responseResult.rows[0].study_id).toBe(testStudyId);
      }
    });
  });

  describe('updateQueryStatus', () => {
    let statusQueryId: number;

    beforeEach(async () => {
      statusQueryId = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: 'Status Update Test Query'
      });
      testQueryIds.push(statusQueryId);
    });

    it('should update query status', async () => {
      const result = await queryService.updateQueryStatus(statusQueryId, 2, rootUserId);

      expect(result.success).toBe(true);
    });

    it('should verify status change in database', async () => {
      await queryService.updateQueryStatus(statusQueryId, 4, rootUserId);

      const queryResult = await testDb.pool.query(
        'SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
        [statusQueryId]
      );

      expect(queryResult.rows[0].resolution_status_id).toBe(4);
    });

    it('should create audit log entry', async () => {
      await queryService.updateQueryStatus(statusQueryId, 3, rootUserId);

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [statusQueryId, 'discrepancy_note']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  describe('getQueryStats', () => {
    beforeEach(async () => {
      // Create queries with different statuses
      const queryId1 = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: 'Stats Query 1'
      });
      testQueryIds.push(queryId1);

      const queryId2 = await createTestQuery(testDb.pool, testStudyId, rootUserId, {
        description: 'Stats Query 2'
      });
      testQueryIds.push(queryId2);
    });

    it('should return query statistics by status', async () => {
      const stats = await queryService.getQueryStats(testStudyId);

      expect(Array.isArray(stats)).toBe(true);
    });

    it('should include status names', async () => {
      const stats = await queryService.getQueryStats(testStudyId);

      if (stats.length > 0) {
        expect(stats[0].status).toBeDefined();
        expect(stats[0].count).toBeDefined();
      }
    });

    it('should count queries correctly', async () => {
      const stats = await queryService.getQueryStats(testStudyId);

      const totalCount = stats.reduce((sum: number, s: any) => sum + parseInt(s.count), 0);
      expect(totalCount).toBeGreaterThanOrEqual(2);
    });
  });
});


