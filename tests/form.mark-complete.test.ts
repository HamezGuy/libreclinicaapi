/**
 * markFormComplete Unit Tests
 *
 * Tests the form completion marking function which is a prerequisite
 * for the data lock pipeline: Complete -> Freeze -> Lock.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as formService from '../src/services/hybrid/form.service';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

describe('markFormComplete', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testEventCrfId: number;
  let crfId: number;
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `COMPLETE-TEST-${Date.now()}`
    });

    testSubjectId = await createTestSubject(testDb.pool, testStudyId, {
      label: `COMP-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    if (testSubjectId) {
      await testDb.pool.query('DELETE FROM item_data WHERE event_crf_id IN (SELECT event_crf_id FROM event_crf WHERE study_subject_id = $1)', [testSubjectId]);
      await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM item_form_metadata WHERE crf_version_id IN (SELECT crf_version_id FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE source_study_id = $1))', [testStudyId]);
      await testDb.pool.query('DELETE FROM item_group_metadata WHERE crf_version_id IN (SELECT crf_version_id FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE source_study_id = $1))', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE source_study_id = $1)', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf WHERE source_study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create event definition, event, CRF, CRF version, event_crf
    const eventDefResult = await testDb.pool.query(`
      INSERT INTO study_event_definition (study_id, name, repeating, type, ordinal, status_id, date_created, oc_oid)
      VALUES ($1, 'Complete Test Event', false, 'scheduled', 1, 1, NOW(), $2)
      RETURNING study_event_definition_id
    `, [testStudyId, `SE_COMP_${Date.now()}`]);

    const eventResult = await testDb.pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
      VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
      RETURNING study_event_id
    `, [eventDefResult.rows[0].study_event_definition_id, testSubjectId, rootUserId]);

    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (source_study_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'Complete Test CRF', 1, $2, NOW(), $3)
      RETURNING crf_id
    `, [testStudyId, rootUserId, `F_COMP_${Date.now()}`]);
    crfId = crfResult.rows[0].crf_id;

    const cvResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [crfId, rootUserId, `FV_COMP_${Date.now()}`]);

    const ecResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, completion_status_id, owner_id, date_created, study_subject_id)
      VALUES ($1, $2, 1, 2, $3, NOW(), $4)
      RETURNING event_crf_id
    `, [eventResult.rows[0].study_event_id, cvResult.rows[0].crf_version_id, rootUserId, testSubjectId]);

    testEventCrfId = ecResult.rows[0].event_crf_id;
  });

  afterEach(async () => {
    if (testEventCrfId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]).catch(() => {});
      testEventCrfId = 0;
    }
  });

  it('should mark a form as complete', async () => {
    const result = await formService.markFormComplete(testEventCrfId, rootUserId);

    expect(result.success).toBe(true);
    expect(result.message).toContain('complete');

    const db = await testDb.pool.query(
      'SELECT status_id, completion_status_id FROM event_crf WHERE event_crf_id = $1',
      [testEventCrfId]
    );
    expect(db.rows[0].status_id).toBe(2);
    expect(db.rows[0].completion_status_id).toBe(4);
  });

  it('should reject if form is already locked', async () => {
    await testDb.pool.query('UPDATE event_crf SET status_id = 6 WHERE event_crf_id = $1', [testEventCrfId]);

    const result = await formService.markFormComplete(testEventCrfId, rootUserId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('locked');
  });

  it('should reject if form is frozen', async () => {
    await testDb.pool.query('UPDATE event_crf SET frozen = true WHERE event_crf_id = $1', [testEventCrfId]);

    const result = await formService.markFormComplete(testEventCrfId, rootUserId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('frozen');
  });

  it('should reject if form is already complete', async () => {
    await testDb.pool.query(
      'UPDATE event_crf SET status_id = 2, completion_status_id = 4 WHERE event_crf_id = $1',
      [testEventCrfId]
    );

    const result = await formService.markFormComplete(testEventCrfId, rootUserId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('already');
  });

  it('should reject for non-existent form', async () => {
    const result = await formService.markFormComplete(999999, rootUserId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should create an audit log entry', async () => {
    await formService.markFormComplete(testEventCrfId, rootUserId);

    const audit = await testDb.pool.query(
      'SELECT * FROM audit_log_event WHERE entity_id = $1 AND entity_name = $2 ORDER BY audit_date DESC LIMIT 1',
      [testEventCrfId, 'Form Marked Complete']
    );

    expect(audit.rows.length).toBeGreaterThan(0);
  });
});
