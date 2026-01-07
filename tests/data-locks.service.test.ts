/**
 * Data Locks Service Unit Tests
 * 
 * Tests all data locking operations:
 * - Get locked records
 * - Lock record
 * - Unlock record
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as dataLocksService from '../src/services/database/data-locks.service';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

describe('Data Locks Service', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testEventCrfId: number;
  let additionalEventCrfIds: number[] = [];
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    // Create test study
    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `LOCK-TEST-${Date.now()}`
    });

    // Create test subject
    testSubjectId = await createTestSubject(testDb.pool, testStudyId, {
      label: `LOCK-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testEventCrfId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]);
    }
    if (additionalEventCrfIds.length > 0) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = ANY($1)', [additionalEventCrfIds]);
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
      VALUES ($1, 'Lock Test Event', 'Test event', false, 'scheduled', 1, 1, NOW(), $2)
      RETURNING study_event_definition_id
    `, [testStudyId, `SE_LOCK_${Date.now()}`]);

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
      INSERT INTO crf (source_study_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'Lock Test CRF', 1, $2, NOW(), $3)
      RETURNING crf_id
    `, [testStudyId, rootUserId, `F_LOCK_${Date.now()}`]);

    const crfId = crfResult.rows[0].crf_id;

    const crfVersionResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [crfId, rootUserId, `FV_LOCK_${Date.now()}`]);

    const crfVersionId = crfVersionResult.rows[0].crf_version_id;

    // Create event CRF (unlocked)
    const eventCrfResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id)
      VALUES ($1, $2, 1, $3, NOW(), $4)
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
    if (additionalEventCrfIds.length > 0) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = ANY($1)', [additionalEventCrfIds]);
      additionalEventCrfIds = [];
    }
  });

  describe('getLockedRecords', () => {
    beforeEach(async () => {
      // Lock the test record
      await testDb.pool.query('UPDATE event_crf SET status_id = 6 WHERE event_crf_id = $1', [testEventCrfId]);
    });

    it('should return locked records for study', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should only return records with status_id = 6 (locked)', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 100
      });

      expect(result.data.every((r: any) => r.status_id === 6)).toBe(true);
    });

    it('should include CRF and event details', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const record = result.data[0];
        expect(record.crf_name).toBeDefined();
        expect(record.event_name).toBeDefined();
      }
    });

    it('should include subject information', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        expect(result.data[0].subject_label).toBeDefined();
      }
    });

    it('should paginate results', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 5
      });

      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeDefined();
    });
  });

  describe('lockRecord', () => {
    it('should lock an unlocked record', async () => {
      const result = await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should set status_id to 6 (locked)', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].status_id).toBe(6);
    });

    it('should set update_id to locking user', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT update_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].update_id).toBe(rootUserId);
    });

    it('should return error for already locked record', async () => {
      // First lock
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      // Try to lock again
      const result = await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already locked');
    });

    it('should return error for non-existent record', async () => {
      const result = await dataLocksService.lockRecord(999999, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should create audit log entry', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [testEventCrfId, 'event_crf']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].entity_name).toBe('Data Locked');
    });
  });

  describe('unlockRecord', () => {
    beforeEach(async () => {
      // Lock the record first
      await testDb.pool.query('UPDATE event_crf SET status_id = 6 WHERE event_crf_id = $1', [testEventCrfId]);
    });

    it('should unlock a locked record', async () => {
      const result = await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      expect(result.success).toBe(true);
    });

    it('should set status_id to 1 (available)', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].status_id).toBe(1);
    });

    it('should set update_id to unlocking user', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT update_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].update_id).toBe(rootUserId);
    });

    it('should return error for not locked record', async () => {
      // Unlock first
      await testDb.pool.query('UPDATE event_crf SET status_id = 1 WHERE event_crf_id = $1', [testEventCrfId]);

      const result = await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not locked');
    });

    it('should return error for non-existent record', async () => {
      const result = await dataLocksService.unlockRecord(999999, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should create audit log entry', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [testEventCrfId, 'event_crf']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].entity_name).toBe('Data Unlocked');
    });
  });
});


