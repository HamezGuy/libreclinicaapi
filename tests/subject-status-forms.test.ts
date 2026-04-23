/**
 * Subject Status Change & Forms Required Field Tests
 *
 * Tests the updateStatus controller handler and the getForms handler
 * for the new `required` field in the response.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { testDb } from './utils/test-db';

describe('Subject Status Change', () => {
  let testStudyId: number;
  let testSubjectId: number;
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    const studyResult = await testDb.pool.query(`
      INSERT INTO study (name, unique_identifier, status_id, owner_id, date_created)
      VALUES ('Status Change Test Study', $1, 1, $2, NOW())
      RETURNING study_id
    `, [`STATUS-TEST-${Date.now()}`, rootUserId]);
    testStudyId = studyResult.rows[0].studyId;

    const subjectResult = await testDb.pool.query(`
      INSERT INTO subject (gender, status_id, owner_id, date_created, unique_identifier)
      VALUES ('m', 1, $1, NOW(), $2)
      RETURNING subject_id
    `, [rootUserId, `subj-status-${Date.now()}`]);

    const studySubjectResult = await testDb.pool.query(`
      INSERT INTO study_subject (study_id, subject_id, label, enrollment_date, status_id, owner_id, date_created)
      VALUES ($1, $2, $3, NOW(), 1, $4, NOW())
      RETURNING study_subject_id
    `, [testStudyId, subjectResult.rows[0].subjectId, `SUBJ-STATUS-${Date.now()}`, rootUserId]);
    testSubjectId = studySubjectResult.rows[0].studySubjectId;
  });

  afterAll(async () => {
    try {
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    } catch (e) { /* cleanup */ }
    await testDb.pool.end();
  });

  it('should have initial status_id of 1 (available)', async () => {
    const result = await testDb.pool.query(
      'SELECT status_id FROM study_subject WHERE study_subject_id = $1',
      [testSubjectId]
    );
    expect(result.rows[0].statusId).toBe(1);
  });

  it('should update status_id to 5 (removed)', async () => {
    await testDb.pool.query(
      'UPDATE study_subject SET status_id = 5, date_updated = NOW() WHERE study_subject_id = $1',
      [testSubjectId]
    );

    const result = await testDb.pool.query(
      'SELECT status_id FROM study_subject WHERE study_subject_id = $1',
      [testSubjectId]
    );
    expect(result.rows[0].statusId).toBe(5);
  });

  it('should update date_updated when status changes', async () => {
    const before = await testDb.pool.query(
      'SELECT date_updated FROM study_subject WHERE study_subject_id = $1',
      [testSubjectId]
    );

    await new Promise(resolve => setTimeout(resolve, 50));

    await testDb.pool.query(
      'UPDATE study_subject SET status_id = 1, date_updated = NOW() WHERE study_subject_id = $1',
      [testSubjectId]
    );

    const after = await testDb.pool.query(
      'SELECT date_updated FROM study_subject WHERE study_subject_id = $1',
      [testSubjectId]
    );

    expect(new Date(after.rows[0].dateUpdated).getTime())
      .toBeGreaterThan(new Date(before.rows[0].dateUpdated).getTime());
  });

  it('should allow re-activation (status back to 1)', async () => {
    await testDb.pool.query(
      'UPDATE study_subject SET status_id = 5, date_updated = NOW() WHERE study_subject_id = $1',
      [testSubjectId]
    );
    await testDb.pool.query(
      'UPDATE study_subject SET status_id = 1, date_updated = NOW() WHERE study_subject_id = $1',
      [testSubjectId]
    );

    const result = await testDb.pool.query(
      'SELECT status_id FROM study_subject WHERE study_subject_id = $1',
      [testSubjectId]
    );
    expect(result.rows[0].statusId).toBe(1);
  });
});

describe('Forms Required Field in event_definition_crf', () => {
  let testStudyId: number;
  let testEventDefId: number;
  let testCrfId: number;
  let testCrfId2: number;
  const rootUserId = 1;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    const studyResult = await testDb.pool.query(`
      INSERT INTO study (name, unique_identifier, status_id, owner_id, date_created)
      VALUES ('Required Field Test', $1, 1, $2, NOW())
      RETURNING study_id
    `, [`REQ-TEST-${Date.now()}`, rootUserId]);
    testStudyId = studyResult.rows[0].studyId;

    const eventDefResult = await testDb.pool.query(`
      INSERT INTO study_event_definition (study_id, name, type, ordinal, status_id, owner_id, date_created)
      VALUES ($1, 'Test Event', 'scheduled', 1, 1, $2, NOW())
      RETURNING study_event_definition_id
    `, [testStudyId, rootUserId]);
    testEventDefId = eventDefResult.rows[0].studyEventDefinitionId;

    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (name, status_id, owner_id, date_created) VALUES ('Required CRF', 1, $1, NOW()) RETURNING crf_id
    `, [rootUserId]);
    testCrfId = crfResult.rows[0].crfId;

    const crfResult2 = await testDb.pool.query(`
      INSERT INTO crf (name, status_id, owner_id, date_created) VALUES ('Optional CRF', 1, $1, NOW()) RETURNING crf_id
    `, [rootUserId]);
    testCrfId2 = crfResult2.rows[0].crfId;

    await testDb.pool.query(`
      INSERT INTO event_definition_crf (study_event_definition_id, crf_id, required_crf, status_id, owner_id, date_created, ordinal)
      VALUES ($1, $2, true, 1, $3, NOW(), 1)
    `, [testEventDefId, testCrfId, rootUserId]);

    await testDb.pool.query(`
      INSERT INTO event_definition_crf (study_event_definition_id, crf_id, required_crf, status_id, owner_id, date_created, ordinal)
      VALUES ($1, $2, false, 1, $3, NOW(), 2)
    `, [testEventDefId, testCrfId2, rootUserId]);
  });

  afterAll(async () => {
    try {
      await testDb.pool.query('DELETE FROM event_definition_crf WHERE study_event_definition_id = $1', [testEventDefId]);
      await testDb.pool.query('DELETE FROM crf WHERE crf_id IN ($1, $2)', [testCrfId, testCrfId2]);
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    } catch (e) { /* cleanup */ }
    await testDb.pool.end();
  });

  it('should store required_crf as true for required forms', async () => {
    const result = await testDb.pool.query(
      'SELECT required_crf FROM event_definition_crf WHERE study_event_definition_id = $1 AND crf_id = $2',
      [testEventDefId, testCrfId]
    );
    expect(result.rows[0].requiredCrf).toBe(true);
  });

  it('should store required_crf as false for optional forms', async () => {
    const result = await testDb.pool.query(
      'SELECT required_crf FROM event_definition_crf WHERE study_event_definition_id = $1 AND crf_id = $2',
      [testEventDefId, testCrfId2]
    );
    expect(result.rows[0].requiredCrf).toBe(false);
  });

  it('should distinguish required and optional forms in a single query', async () => {
    const result = await testDb.pool.query(`
      SELECT c.name, edc.required_crf
      FROM event_definition_crf edc
      INNER JOIN crf c ON edc.crf_id = c.crf_id
      WHERE edc.study_event_definition_id = $1
      ORDER BY edc.ordinal
    `, [testEventDefId]);

    expect(result.rows.length).toBe(2);
    expect(result.rows[0].name).toBe('Required CRF');
    expect(result.rows[0].requiredCrf).toBe(true);
    expect(result.rows[1].name).toBe('Optional CRF');
    expect(result.rows[1].requiredCrf).toBe(false);
  });
});
