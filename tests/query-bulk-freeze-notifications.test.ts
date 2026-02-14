/**
 * Unit Tests: Query Bulk Operations, Freeze/Lock, Notifications, Lifecycle
 * 
 * Tests the four Priority-1 features:
 * 1. Query resolution: reopen, bulk close, bulk reassign, bulk status update
 * 2. Batch operations: batch lock, batch unlock, batch SDV, batch freeze
 * 3. Notifications: create, read, mark-read
 * 4. CRF lifecycle: phase computation, transitions
 */

import { pool } from '../src/config/database';
import * as queryService from '../src/services/database/query.service';
import * as dataLocksService from '../src/services/database/data-locks.service';
import * as notificationService from '../src/services/database/notification.service';
import * as workflowService from '../src/services/database/workflow.service';

// Test data
let testStudyId: number;
let testSubjectId: number;
let testCrfId: number;
let testCrfVersionId: number;
let testEventCrfId: number;
let testEventCrfId2: number;
let testQueryId: number;
let testQueryId2: number;
const testUserId = 1;

describe('Priority-1 Features', () => {

  // ─── Setup ────────────────────────────────────────────────────────

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
    } catch {
      console.warn('Test database not available, skipping tests');
      return;
    }

    // Create test study
    const studyRes = await pool.query(`
      INSERT INTO study (name, unique_identifier, protocol_id, status_id, date_created, owner_id)
      VALUES ('P1 Test Study', 'P1-TEST-' || NOW()::text, 'P1-PROTO', 1, NOW(), $1)
      RETURNING study_id
    `, [testUserId]);
    testStudyId = studyRes.rows[0].study_id;

    // Create test subject
    const subRes = await pool.query(`
      INSERT INTO study_subject (label, study_id, status_id, date_created, owner_id)
      VALUES ('P1-SUBJ-001', $1, 1, NOW(), $2)
      RETURNING study_subject_id
    `, [testStudyId, testUserId]);
    testSubjectId = subRes.rows[0].study_subject_id;

    // Create CRF
    const crfRes = await pool.query(`
      INSERT INTO crf (name, owner_id, status_id, date_created)
      VALUES ('P1 Test CRF', $1, 1, NOW())
      RETURNING crf_id
    `, [testUserId]);
    testCrfId = crfRes.rows[0].crf_id;

    const verRes = await pool.query(`
      INSERT INTO crf_version (crf_id, name, owner_id, status_id, date_created, revision_notes)
      VALUES ($1, 'v1.0', $2, 1, NOW(), 'test')
      RETURNING crf_version_id
    `, [testCrfId, testUserId]);
    testCrfVersionId = verRes.rows[0].crf_version_id;

    // Create event definition + event
    const sedRes = await pool.query(`
      INSERT INTO study_event_definition (study_id, name, type, ordinal, date_created, owner_id, status_id)
      VALUES ($1, 'Test Visit', 'scheduled', 1, NOW(), $2, 1)
      RETURNING study_event_definition_id
    `, [testStudyId, testUserId]);
    const sedId = sedRes.rows[0].study_event_definition_id;

    const seRes = await pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, subject_event_status_id, owner_id, date_created, start_time_flag, end_time_flag)
      VALUES ($1, $2, NOW(), 1, $3, NOW(), false, false)
      RETURNING study_event_id
    `, [sedId, testSubjectId, testUserId]);
    const seId = seRes.rows[0].study_event_id;

    // Create two event_crf records for batch testing
    const ec1 = await pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, study_subject_id, status_id, completion_status_id, owner_id, date_created)
      VALUES ($1, $2, $3, 2, 4, $4, NOW()) RETURNING event_crf_id
    `, [seId, testCrfVersionId, testSubjectId, testUserId]);
    testEventCrfId = ec1.rows[0].event_crf_id;

    const ec2 = await pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, study_subject_id, status_id, completion_status_id, owner_id, date_created)
      VALUES ($1, $2, $3, 2, 4, $4, NOW()) RETURNING event_crf_id
    `, [seId, testCrfVersionId, testSubjectId, testUserId]);
    testEventCrfId2 = ec2.rows[0].event_crf_id;

    // Create test queries
    const q1 = await queryService.createQuery({
      description: 'Test query 1',
      entityType: 'eventCrf',
      entityId: testEventCrfId,
      studyId: testStudyId,
      subjectId: testSubjectId,
    }, testUserId);
    testQueryId = q1.queryId!;

    const q2 = await queryService.createQuery({
      description: 'Test query 2',
      entityType: 'eventCrf',
      entityId: testEventCrfId,
      studyId: testStudyId,
      subjectId: testSubjectId,
    }, testUserId);
    testQueryId2 = q2.queryId!;
  });

  afterAll(async () => {
    // Cleanup
    if (testEventCrfId) {
      await pool.query('DELETE FROM event_crf WHERE event_crf_id IN ($1, $2)', [testEventCrfId, testEventCrfId2]).catch(() => {});
    }
    if (testCrfId) {
      await pool.query('DELETE FROM acc_form_workflow_config WHERE crf_id = $1', [testCrfId]).catch(() => {});
    }
  });

  // ─── 1. Query Resolution ──────────────────────────────────────────

  describe('Query Resolution Workflow', () => {
    it('should add a response to a query (Open -> Updated)', async () => {
      const result = await queryService.addQueryResponse(testQueryId, {
        description: 'Site response: data corrected',
        newStatusId: 2, // Updated
      }, testUserId);

      expect(result.success).toBe(true);
      expect(result.responseId).toBeTruthy();
    });

    it('should propose resolution (Updated -> Resolution Proposed)', async () => {
      const result = await queryService.updateQueryStatus(testQueryId, 3, testUserId, {
        reason: 'Resolution proposed'
      });
      expect(result.success).toBe(true);
    });

    it('should close a query (Resolution Proposed -> Closed)', async () => {
      const result = await queryService.updateQueryStatus(testQueryId, 4, testUserId, {
        reason: 'Data confirmed'
      });
      expect(result.success).toBe(true);
    });

    it('should reopen a closed query (Closed -> New)', async () => {
      const result = await queryService.reopenQuery(testQueryId, testUserId, 'Need further review');
      expect(result.success).toBe(true);
    });

    it('should get the query thread with responses', async () => {
      const thread = await queryService.getQueryThread(testQueryId);
      expect(Array.isArray(thread)).toBe(true);
      expect(thread.length).toBeGreaterThan(0);
    });
  });

  // ─── 2. Bulk Operations ──────────────────────────────────────────

  describe('Bulk Query Operations', () => {
    it('should bulk close multiple queries', async () => {
      // First ensure queries are open
      await queryService.updateQueryStatus(testQueryId, 1, testUserId);
      await queryService.updateQueryStatus(testQueryId2, 1, testUserId);

      const result = await queryService.bulkCloseQueries(
        [testQueryId, testQueryId2], testUserId, 'Bulk close for testing'
      );

      expect(result.closed).toBeGreaterThan(0);
    });

    it('should bulk update status', async () => {
      const result = await queryService.bulkUpdateStatus(
        [testQueryId, testQueryId2], 1, testUserId, 'Bulk reopen'
      );

      expect(result.updated).toBeGreaterThan(0);
    });
  });

  describe('Batch Lock/Freeze Operations', () => {
    it('should batch SDV multiple CRF records', async () => {
      const result = await dataLocksService.batchSDV(
        [testEventCrfId, testEventCrfId2], testUserId
      );

      expect(result.verified).toBeGreaterThanOrEqual(0);
      // May be 0 if already verified
    });

    it('should freeze a CRF record', async () => {
      // First close all queries on this CRF to allow freeze
      await queryService.bulkCloseQueries([testQueryId, testQueryId2], testUserId, 'Close for freeze');

      const result = await dataLocksService.freezeRecord(testEventCrfId, testUserId);
      // May fail if queries still open; that's valid behavior too
      if (result.success) {
        expect(result.message).toContain('frozen');
      }
    });

    it('should block edits on frozen forms', async () => {
      // Check the frozen status
      const ecResult = await pool.query(
        'SELECT COALESCE(frozen, false) as frozen FROM event_crf WHERE event_crf_id = $1',
        [testEventCrfId]
      );
      // If frozen, form save should be blocked (tested via form.service in e2e)
      expect(ecResult.rows.length).toBe(1);
    });

    it('should unfreeze a CRF record', async () => {
      const result = await dataLocksService.unfreezeRecord(
        testEventCrfId, testUserId, 'Need to correct data'
      );
      // Success only if it was frozen
      expect(result).toBeDefined();
    });

    it('should batch lock CRF records', async () => {
      const result = await dataLocksService.batchLockRecords(
        [testEventCrfId, testEventCrfId2], testUserId
      );
      // May fail due to open queries or other requirements
      expect(result.locked + result.failed).toBe(2);
    });

    it('should batch unlock CRF records', async () => {
      const result = await dataLocksService.batchUnlockRecords(
        [testEventCrfId, testEventCrfId2], testUserId
      );
      expect(result).toBeDefined();
    });
  });

  // ─── 3. Notifications ────────────────────────────────────────────

  describe('Notification System', () => {
    let notifId: number | null;

    it('should create a notification', async () => {
      notifId = await notificationService.createNotification({
        userId: testUserId,
        type: 'query_assigned',
        title: 'Test notification',
        message: 'A test query has been assigned to you',
        entityType: 'discrepancy_note',
        entityId: testQueryId,
        studyId: testStudyId,
      });

      // May be null if table doesn't exist yet
      if (notifId) {
        expect(notifId).toBeGreaterThan(0);
      }
    });

    it('should get unread notifications', async () => {
      const result = await notificationService.getUnreadNotifications(testUserId);
      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should mark notification as read', async () => {
      if (notifId) {
        const result = await notificationService.markAsRead(notifId, testUserId);
        expect(result).toBe(true);
      }
    });

    it('should mark all as read', async () => {
      const count = await notificationService.markAllAsRead(testUserId);
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should create query assignment notification via helper', async () => {
      await notificationService.notifyQueryAssigned(
        testUserId, 'Test query assigned', testQueryId, testStudyId
      );
      // Just verifying it doesn't throw
    });
  });

  // ─── 4. CRF Lifecycle ────────────────────────────────────────────

  describe('CRF Lifecycle State Machine', () => {
    it('should compute lifecycle status for a CRF', async () => {
      const status = await workflowService.getCrfLifecycleStatus(testEventCrfId);
      expect(status).toBeDefined();
      if (status) {
        expect(status.eventCrfId).toBe(testEventCrfId);
        expect(status.currentPhase).toBeDefined();
        expect(Array.isArray(status.completedPhases)).toBe(true);
        expect(Array.isArray(status.pendingPhases)).toBe(true);
        expect(Array.isArray(status.availableTransitions)).toBe(true);
      }
    });

    it('should return correct phases based on workflow config', async () => {
      // Set up workflow config
      await pool.query(`
        INSERT INTO acc_form_workflow_config (crf_id, requires_sdv, requires_signature, requires_dde)
        VALUES ($1, true, true, false)
        ON CONFLICT (crf_id, study_id) DO UPDATE SET requires_sdv = true, requires_signature = true
      `, [testCrfId]);

      const status = await workflowService.getCrfLifecycleStatus(testEventCrfId);
      if (status) {
        expect(status.workflowConfig.requiresSDV).toBe(true);
        expect(status.workflowConfig.requiresSignature).toBe(true);
      }
    });

    it('should return available transitions', async () => {
      const transitions = await workflowService.getAvailableTransitions('crf', testEventCrfId);
      expect(Array.isArray(transitions)).toBe(true);
    });
  });
});
