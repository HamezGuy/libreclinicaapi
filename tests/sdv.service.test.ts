/**
 * SDV Service Unit Tests
 * 
 * Tests all Source Data Verification operations:
 * - Get SDV records with filters
 * - Get SDV by ID
 * - Verify SDV (mark as verified)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as sdvService from '../src/services/database/sdv.service';
import { createTestStudy, createTestSubject, createTestEventDefinition, createTestCRF } from './fixtures/test-data';

describe('SDV Service', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testEventCrfId: number;
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(pool, rootUserId, {
      uniqueIdentifier: `SDV-TEST-${Date.now()}`
    });

    // Create test subject
    testSubjectId = await createTestSubject(pool, testStudyId, {
      label: `SDV-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testEventCrfId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]);
    }
    if (testSubjectId) {
      await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE study_id = $1)', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create event definition
    const eventDefResult = await testDb.pool.query(`
      INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
      VALUES ($1, 'SDV Test Event', 'Test event', false, 'scheduled', 1, 1, NOW(), $2)
      RETURNING study_event_definition_id
    `, [testStudyId, `SE_SDV_${Date.now()}`]);

    const eventDefId = eventDefResult.rows[0].study_event_definition_id;

    // Create study event
    const eventResult = await testDb.pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
      VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
      RETURNING study_event_id
    `, [eventDefId, testSubjectId, rootUserId]);

    const studyEventId = eventResult.rows[0].study_event_id;

    // Create CRF and version
    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (study_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'SDV Test CRF', 1, $2, NOW(), $3)
      RETURNING crf_id
    `, [testStudyId, rootUserId, `F_SDV_${Date.now()}`]);

    const crfId = crfResult.rows[0].crf_id;

    const crfVersionResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [crfId, rootUserId, `FV_SDV_${Date.now()}`]);

    const crfVersionId = crfVersionResult.rows[0].crf_version_id;

    // Create event CRF
    const eventCrfResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, sdv_status, owner_id, date_created, study_subject_id)
      VALUES ($1, $2, 1, false, $3, NOW(), $4)
      RETURNING event_crf_id
    `, [studyEventId, crfVersionId, rootUserId, testSubjectId]);

    testEventCrfId = eventCrfResult.rows[0].event_crf_id;
  });

  afterEach(async () => {
    // Cleanup event_crf
    if (testEventCrfId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]);
      testEventCrfId = 0;
    }
  });

  describe('getSDVRecords', () => {
    it('should return SDV records for study', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should filter by verified status', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        status: 'verified',
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.every((r: any) => r.sdv_status === true)).toBe(true);
    });

    it('should filter by pending status', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        status: 'pending',
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.every((r: any) => r.sdv_status === false)).toBe(true);
    });

    it('should include CRF and event details', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const record = result.data[0];
        expect(record.event_crf_id).toBeDefined();
        expect(record.crf_name).toBeDefined();
        expect(record.event_name).toBeDefined();
      }
    });

    it('should include subject information', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        expect(result.data[0].subject_label).toBeDefined();
      }
    });

    it('should paginate results', async () => {
      const result = await sdvService.getSDVRecords({
        studyId: testStudyId,
        page: 1,
        limit: 5
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('getSDVById', () => {
    it('should return SDV record by ID', async () => {
      const sdv = await sdvService.getSDVById(testEventCrfId);

      expect(sdv).toBeDefined();
      expect(sdv.event_crf_id).toBe(testEventCrfId);
    });

    it('should include related information', async () => {
      const sdv = await sdvService.getSDVById(testEventCrfId);

      expect(sdv.subject_label).toBeDefined();
      expect(sdv.event_name).toBeDefined();
      expect(sdv.crf_name).toBeDefined();
    });

    it('should return null for non-existent record', async () => {
      const sdv = await sdvService.getSDVById(999999);

      expect(sdv).toBeNull();
    });
  });

  describe('verifySDV', () => {
    it('should mark record as verified', async () => {
      const result = await sdvService.verifySDV(testEventCrfId, rootUserId);

      expect(result.success).toBe(true);
      expect(result.data.sdv_status).toBe(true);
    });

    it('should set sdv_update_id to verifying user', async () => {
      await sdvService.verifySDV(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT sdv_update_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].sdv_update_id).toBe(rootUserId);
    });

    it('should update date_updated', async () => {
      const beforeResult = await testDb.pool.query(
        'SELECT date_updated FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      const beforeDate = beforeResult.rows[0].date_updated;

      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

      await sdvService.verifySDV(testEventCrfId, rootUserId);

      const afterResult = await testDb.pool.query(
        'SELECT date_updated FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      const afterDate = afterResult.rows[0].date_updated;

      expect(new Date(afterDate).getTime()).toBeGreaterThan(new Date(beforeDate || 0).getTime());
    });

    it('should create audit log entry', async () => {
      await sdvService.verifySDV(testEventCrfId, rootUserId);

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [testEventCrfId, 'event_crf']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].entity_name).toBe('SDV Verified');
    });
  });
});


