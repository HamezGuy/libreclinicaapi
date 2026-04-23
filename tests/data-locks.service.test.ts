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

    const eventDefId = eventDefResult.rows[0].studyEventDefinitionId;

    // Create study event
    const eventResult = await testDb.pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
      VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
      RETURNING study_event_id
    `, [eventDefId, testSubjectId, rootUserId]);

    const studyEventId = eventResult.rows[0].studyEventId;

    // Create CRF and version
    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (source_study_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'Lock Test CRF', 1, $2, NOW(), $3)
      RETURNING crf_id
    `, [testStudyId, rootUserId, `F_LOCK_${Date.now()}`]);

    const crfId = crfResult.rows[0].crfId;

    const crfVersionResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [crfId, rootUserId, `FV_LOCK_${Date.now()}`]);

    const crfVersionId = crfVersionResult.rows[0].crfVersionId;

    // Create event CRF (unlocked)
    const eventCrfResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id)
      VALUES ($1, $2, 1, $3, NOW(), $4)
      RETURNING event_crf_id
    `, [studyEventId, crfVersionId, rootUserId, testSubjectId]);

    testEventCrfId = eventCrfResult.rows[0].eventCrfId;
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

      expect(result.data.every((r: any) => r.statusId === 6)).toBe(true);
    });

    it('should include CRF and event details', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        const record = result.data[0];
        expect(record.crfName).toBeDefined();
        expect(record.eventName).toBeDefined();
      }
    });

    it('should include subject information', async () => {
      const result = await dataLocksService.getLockedRecords({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      if (result.data.length > 0) {
        expect(result.data[0].subjectLabel).toBeDefined();
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
      expect(result.message).toBeDefined();
    });

    it('should set status_id to 6 (locked)', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].statusId).toBe(6);
    });

    it('should set update_id to locking user', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT update_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].updateId).toBe(rootUserId);
    });

    it('should return error for already locked record', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId);
      const result = await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already locked');
    });

    it('should return error for non-existent record', async () => {
      const result = await dataLocksService.lockRecord(999999, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should create audit log entry with reason', async () => {
      await dataLocksService.lockRecord(testEventCrfId, rootUserId, 'Locking for review');

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [testEventCrfId, 'event_crf']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].entityName).toBe('Data Locked');
      expect(auditResult.rows[0].reasonForChange).toBe('Locking for review');
    });

    it('should accept lock without reason (reason is optional)', async () => {
      const result = await dataLocksService.lockRecord(testEventCrfId, rootUserId);
      expect(result.success).toBe(true);
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

    it('should restore status_id to 2 (data complete) after unlock', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].statusId).toBe(2);
    });

    it('should set update_id to unlocking user', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT update_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].updateId).toBe(rootUserId);
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

    it('should create audit log entry with reason', async () => {
      await dataLocksService.unlockRecord(testEventCrfId, rootUserId, 'Data correction needed');

      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [testEventCrfId, 'event_crf']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].entityName).toBe('Data Unlocked');
      expect(auditResult.rows[0].reasonForChange).toBe('Data correction needed');
    });

    it('should clear frozen flag when unlocking', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 6, frozen = true WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      await dataLocksService.unlockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT frozen FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].frozen).toBe(false);
    });
  });

  describe('lockRecord — frozen flag cleanup', () => {
    it('should clear frozen flag when locking a frozen form', async () => {
      // Mark form as complete + frozen first
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4, frozen = true WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      await dataLocksService.lockRecord(testEventCrfId, rootUserId);

      const dbResult = await testDb.pool.query(
        'SELECT status_id, frozen FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].statusId).toBe(6);
      expect(dbResult.rows[0].frozen).toBe(false);
    });
  });

  describe('lockRecord — blocks on open queries', () => {
    it('should reject lock when open queries exist via dn_item_data_map', async () => {
      // Make form complete
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      // Create an item_data row and a query mapped to it
      const itemResult = await testDb.pool.query(`
        SELECT i.item_id FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        INNER JOIN crf_version cv ON igm.crf_version_id = cv.crf_version_id
        INNER JOIN event_crf ec ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.event_crf_id = $1
        LIMIT 1
      `, [testEventCrfId]);

      if (itemResult.rows.length > 0) {
        const itemId = itemResult.rows[0].itemId;

        // Insert item_data
        const idResult = await testDb.pool.query(`
          INSERT INTO item_data (item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal)
          VALUES ($1, $2, 'test', 1, $3, NOW(), 1)
          RETURNING item_data_id
        `, [itemId, testEventCrfId, rootUserId]);
        const itemDataId = idResult.rows[0].itemDataId;

        // Create open query
        const dnResult = await testDb.pool.query(`
          INSERT INTO discrepancy_note (description, discrepancy_note_type_id, resolution_status_id, study_id, entity_type, owner_id, date_created)
          VALUES ('Test query', 3, 1, $1, 'itemData', $2, NOW())
          RETURNING discrepancy_note_id
        `, [testStudyId, rootUserId]);
        const dnId = dnResult.rows[0].discrepancyNoteId;

        // Map it via dn_item_data_map
        await testDb.pool.query(`
          INSERT INTO dn_item_data_map (discrepancy_note_id, item_data_id, column_name)
          VALUES ($1, $2, 'value')
        `, [dnId, itemDataId]);

        const result = await dataLocksService.lockRecord(testEventCrfId, rootUserId);
        expect(result.success).toBe(false);
        expect(result.message || result.blockingReasons?.join(' ')).toContain('quer');

        // Cleanup
        await testDb.pool.query('DELETE FROM dn_item_data_map WHERE discrepancy_note_id = $1', [dnId]);
        await testDb.pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = $1', [dnId]);
        await testDb.pool.query('DELETE FROM item_data WHERE item_data_id = $1', [itemDataId]);
      }
    });
  });

  describe('freezeRecord', () => {
    it('should freeze a complete form', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.freezeRecord(testEventCrfId, rootUserId);
      expect(result.success).toBe(true);

      const db = await testDb.pool.query(
        'SELECT frozen FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(db.rows[0].frozen).toBe(true);
    });

    it('should reject freezing a locked form', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 6, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.freezeRecord(testEventCrfId, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('locked');
    });

    it('should reject freezing an already frozen form', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4, frozen = true WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.freezeRecord(testEventCrfId, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('already frozen');
    });

    it('should reject freezing an incomplete form', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 1, completion_status_id = 2 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.freezeRecord(testEventCrfId, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('complete');
    });
  });

  describe('unfreezeRecord', () => {
    beforeEach(async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4, frozen = true WHERE event_crf_id = $1',
        [testEventCrfId]
      );
    });

    it('should unfreeze a frozen form', async () => {
      const result = await dataLocksService.unfreezeRecord(testEventCrfId, rootUserId, 'Need edits');
      expect(result.success).toBe(true);

      const db = await testDb.pool.query(
        'SELECT frozen FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(db.rows[0].frozen).toBe(false);
    });

    it('should reject unfreezing a non-frozen form', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET frozen = false WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.unfreezeRecord(testEventCrfId, rootUserId, 'test');
      expect(result.success).toBe(false);
    });
  });

  describe('checkSubjectLockEligibility', () => {
    it('should return canLock = true when no issues exist', async () => {
      // Mark form as complete (no open queries)
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.checkSubjectLockEligibility(testSubjectId);

      expect(result.canLock).toBe(true);
      expect(result.openQueries).toBe(0);
      expect(result.incompleteForms).toBe(0);
    });

    it('should return canLock = false when forms are incomplete', async () => {
      // Leave form as status_id = 1 (available/incomplete)
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 1, completion_status_id = 1 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.checkSubjectLockEligibility(testSubjectId);

      expect(result.canLock).toBe(false);
      expect(result.incompleteForms).toBeGreaterThan(0);
    });
  });

  describe('lockSubjectData', () => {
    it('should lock all forms for a subject when eligible', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.lockSubjectData(testSubjectId, rootUserId, 'Testing');
      expect(result.success).toBe(true);
      expect(result.lockedCount).toBeGreaterThanOrEqual(1);
    });

    it('should reject when not eligible', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 1 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.lockSubjectData(testSubjectId, rootUserId, 'Testing');
      expect(result.success).toBe(false);
    });
  });

  describe('batchLockRecords', () => {
    it('should handle partial failures', async () => {
      // Lock one, leave another unlockable
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.batchLockRecords([testEventCrfId, 999999], rootUserId);
      expect(result.locked).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getStudySanitationReport', () => {
    it('should return a valid report', async () => {
      const report = await dataLocksService.getStudySanitationReport(testStudyId);

      expect(report.studyId).toBe(testStudyId);
      expect(report.totalSubjects).toBeGreaterThanOrEqual(1);
      expect(report.subjectsByStatus).toBeDefined();
      expect(typeof report.lockReadinessScore).toBe('number');
      expect(report.lockReadinessScore).toBeGreaterThanOrEqual(0);
      expect(report.lockReadinessScore).toBeLessThanOrEqual(100);
    });
  });

  describe('getSanitationSubjects', () => {
    it('should return per-subject data with pagination', async () => {
      const result = await dataLocksService.getSanitationSubjects(testStudyId, 1, 10);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);

      if (result.data.length > 0) {
        const subject = result.data[0];
        expect(subject.studySubjectId).toBeDefined();
        expect(subject.subjectLabel).toBeDefined();
        expect(typeof subject.totalForms).toBe('number');
        expect(typeof subject.openQueries).toBe('number');
        expect(['locked', 'frozen', 'complete', 'in_progress', 'no_data']).toContain(subject.overallStatus);
      }
    });
  });

  describe('getStudyLockStatus', () => {
    it('should return unlocked status for a new study', async () => {
      const status = await dataLocksService.getStudyLockStatus(testStudyId);
      expect(status.studyId).toBe(testStudyId);
      expect(status.isLocked).toBe(false);
    });
  });

  describe('unlockEventData', () => {
    let testStudyEventId: number;

    beforeEach(async () => {
      // Get the study_event_id from the test event_crf
      const seResult = await testDb.pool.query(
        'SELECT study_event_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      testStudyEventId = seResult.rows[0]?.studyEventId;

      // Lock the form
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 6, completion_status_id = 4 WHERE event_crf_id = $1',
        [testEventCrfId]
      );
    });

    it('should unlock all locked forms for the event', async () => {
      const result = await dataLocksService.unlockEventData(testStudyEventId, rootUserId, 'Event unlock test');

      expect(result.success).toBe(true);
      expect(result.unlockedCount).toBeGreaterThanOrEqual(1);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(dbResult.rows[0].statusId).toBe(2);
    });

    it('should log audit entries with reason', async () => {
      await dataLocksService.unlockEventData(testStudyEventId, rootUserId, 'Audit reason test');

      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = 'event_crf'
         AND entity_name = 'Data Unlocked' ORDER BY audit_date DESC LIMIT 1`,
        [testEventCrfId]
      );
      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].reasonForChange).toBe('Audit reason test');
    });

    it('should return 0 unlocked when no locked forms exist', async () => {
      // Unlock first
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.unlockEventData(testStudyEventId, rootUserId, 'Nothing to unlock');
      expect(result.success).toBe(true);
      expect(result.unlockedCount).toBe(0);
    });
  });

  describe('batchSDV — transaction behavior', () => {
    it('should mark records as SDV verified', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET sdv_status = false WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.batchSDV([testEventCrfId], rootUserId);
      expect(result.success).toBe(true);
      expect(result.verified).toBe(1);

      const dbResult = await testDb.pool.query(
        'SELECT sdv_status FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(dbResult.rows[0].sdvStatus).toBe(true);
    });

    it('should return success with 0 verified for empty array', async () => {
      const result = await dataLocksService.batchSDV([], rootUserId);
      expect(result.success).toBe(true);
      expect(result.verified).toBe(0);
    });

    it('should skip already verified records', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET sdv_status = true WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.batchSDV([testEventCrfId], rootUserId);
      expect(result.success).toBe(true);
      expect(result.verified).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getLockedRecords — count matches filters', () => {
    it('should return matching pagination total when filtering by subjectId', async () => {
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 6 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const result = await dataLocksService.getLockedRecords({
        subjectId: testSubjectId,
        page: 1,
        limit: 100
      });

      expect(result.success).toBe(true);
      expect(result.pagination.total).toBe(result.data.length);
    });
  });
});


