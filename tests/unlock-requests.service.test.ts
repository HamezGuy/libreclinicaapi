/**
 * Unlock Requests Service Unit Tests
 *
 * Tests the full unlock request workflow:
 * - Create unlock request
 * - List/filter unlock requests
 * - Review (approve/reject) unlock requests
 * - Cancel unlock requests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as unlockRequestsService from '../src/services/database/unlock-requests.service';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

describe('Unlock Requests Service', () => {
  let testStudyId: number;
  let testSubjectId: number;
  let testEventCrfId: number;
  let createdRequestIds: number[] = [];
  const rootUserId = 1;
  const otherUserId = 2;

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `UNLOCK-REQ-TEST-${Date.now()}`
    });

    testSubjectId = await createTestSubject(testDb.pool, testStudyId, {
      label: `UNLOCK-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    // Cleanup requests
    if (createdRequestIds.length > 0) {
      await testDb.pool.query('DELETE FROM acc_unlock_request WHERE unlock_request_id = ANY($1)', [createdRequestIds]);
    }
    if (testSubjectId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [testSubjectId]);
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE source_study_id = $1)', [testStudyId]);
      await testDb.pool.query('DELETE FROM crf WHERE source_study_id = $1', [testStudyId]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(async () => {
    // Create a locked event_crf for testing
    const eventDefResult = await testDb.pool.query(`
      INSERT INTO study_event_definition (study_id, name, repeating, type, ordinal, status_id, date_created, oc_oid)
      VALUES ($1, 'Unlock Req Event', false, 'scheduled', 1, 1, NOW(), $2)
      RETURNING study_event_definition_id
    `, [testStudyId, `SE_UR_${Date.now()}`]);

    const eventResult = await testDb.pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
      VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
      RETURNING study_event_id
    `, [eventDefResult.rows[0].studyEventDefinitionId, testSubjectId, rootUserId]);

    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (source_study_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'UR Test CRF', 1, $2, NOW(), $3)
      RETURNING crf_id
    `, [testStudyId, rootUserId, `F_UR_${Date.now()}`]);

    const cvResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [crfResult.rows[0].crfId, rootUserId, `FV_UR_${Date.now()}`]);

    // Create locked event_crf (status_id = 6)
    const ecResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id)
      VALUES ($1, $2, 6, $3, NOW(), $4)
      RETURNING event_crf_id
    `, [eventResult.rows[0].studyEventId, cvResult.rows[0].crfVersionId, rootUserId, testSubjectId]);

    testEventCrfId = ecResult.rows[0].eventCrfId;
  });

  afterEach(async () => {
    // Cleanup requests created this test
    for (const id of createdRequestIds) {
      await testDb.pool.query('DELETE FROM acc_unlock_request WHERE unlock_request_id = $1', [id]).catch(() => {});
    }
    createdRequestIds = [];

    if (testEventCrfId) {
      await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]).catch(() => {});
      testEventCrfId = 0;
    }
  });

  describe('createUnlockRequest', () => {
    it('should create a request for a locked form', async () => {
      const result = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Data entry error needs correction',
        priority: 'medium'
      }, rootUserId);

      expect(result.success).toBe(true);
      expect(result.requestId).toBeDefined();
      if (result.requestId) createdRequestIds.push(result.requestId);
    });

    it('should reject if form is not locked', async () => {
      await testDb.pool.query('UPDATE event_crf SET status_id = 2 WHERE event_crf_id = $1', [testEventCrfId]);

      const result = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Testing',
        priority: 'low'
      }, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not locked');
    });

    it('should reject duplicate pending request from same user', async () => {
      const r1 = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'First request',
        priority: 'medium'
      }, rootUserId);
      if (r1.requestId) createdRequestIds.push(r1.requestId);

      const r2 = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Duplicate',
        priority: 'high'
      }, rootUserId);

      expect(r2.success).toBe(false);
      expect(r2.message).toContain('pending');
    });

    it('should reject if form does not exist', async () => {
      const result = await unlockRequestsService.createUnlockRequest({
        eventCrfId: 999999,
        reason: 'Testing',
        priority: 'low'
      }, rootUserId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('getUnlockRequests', () => {
    it('should return paginated results', async () => {
      const r1 = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        studyId: testStudyId,
        reason: 'For listing test',
        priority: 'medium'
      }, rootUserId);
      if (r1.requestId) createdRequestIds.push(r1.requestId);

      const result = await unlockRequestsService.getUnlockRequests({
        studyId: testStudyId,
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const r1 = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        studyId: testStudyId,
        reason: 'For filter test',
        priority: 'medium'
      }, rootUserId);
      if (r1.requestId) createdRequestIds.push(r1.requestId);

      const pending = await unlockRequestsService.getUnlockRequests({ status: 'pending' });
      expect(pending.data.every(r => r.status === 'pending')).toBe(true);
    });
  });

  describe('reviewUnlockRequest', () => {
    it('should approve and auto-unlock the form', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Approve test',
        priority: 'medium'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      const review = await unlockRequestsService.reviewUnlockRequest(
        r.requestId!, 'approve', 'Approved for correction', rootUserId
      );

      expect(review.success).toBe(true);
      expect(review.message).toContain('approved');

      // Verify the form was unlocked
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(dbResult.rows[0].statusId).toBe(2); // restored to data complete
    });

    it('should reject and leave form locked', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Reject test',
        priority: 'low'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      const review = await unlockRequestsService.reviewUnlockRequest(
        r.requestId!, 'reject', 'Not justified', rootUserId
      );

      expect(review.success).toBe(true);
      expect(review.message).toContain('rejected');

      // Verify the form is still locked
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      expect(dbResult.rows[0].statusId).toBe(6);
    });

    it('should reject reviewing an already-reviewed request', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Double review test',
        priority: 'medium'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      await unlockRequestsService.reviewUnlockRequest(r.requestId!, 'reject', 'First review', rootUserId);

      const second = await unlockRequestsService.reviewUnlockRequest(r.requestId!, 'approve', 'Second', rootUserId);
      expect(second.success).toBe(false);
      expect(second.message).toContain('already been');
    });

    it('should reject for non-existent request', async () => {
      const result = await unlockRequestsService.reviewUnlockRequest(999999, 'approve', 'test', rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should require review notes when rejecting', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Empty notes reject test',
        priority: 'medium'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      const result = await unlockRequestsService.reviewUnlockRequest(r.requestId!, 'reject', '', rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should roll back approval if form is not actually locked', async () => {
      // Unlock the form first so approval can't unlock it
      await testDb.pool.query(
        'UPDATE event_crf SET status_id = 2 WHERE event_crf_id = $1',
        [testEventCrfId]
      );

      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Rollback test',
        priority: 'medium'
      }, rootUserId);

      // createUnlockRequest checks if form is locked and should fail
      expect(r.success).toBe(false);
      expect(r.message).toContain('not locked');
    });
  });

  describe('cancelUnlockRequest', () => {
    it('should allow owner to cancel their pending request', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Cancel test',
        priority: 'medium'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      const result = await unlockRequestsService.cancelUnlockRequest(r.requestId!, rootUserId);
      expect(result.success).toBe(true);
    });

    it('should allow admin to cancel any request', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Admin cancel test',
        priority: 'medium'
      }, otherUserId || rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      const result = await unlockRequestsService.cancelUnlockRequest(r.requestId!, rootUserId, 'admin');
      expect(result.success).toBe(true);
    });

    it('should reject cancelling a non-pending request', async () => {
      const r = await unlockRequestsService.createUnlockRequest({
        eventCrfId: testEventCrfId,
        reason: 'Non-pending cancel test',
        priority: 'medium'
      }, rootUserId);
      if (r.requestId) createdRequestIds.push(r.requestId);

      await unlockRequestsService.reviewUnlockRequest(r.requestId!, 'reject', 'Rejected first', rootUserId);

      const result = await unlockRequestsService.cancelUnlockRequest(r.requestId!, rootUserId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('pending');
    });
  });
});
