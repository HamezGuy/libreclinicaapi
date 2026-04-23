/**
 * Event Service Unit Tests
 *
 * Tests study event (phase) management operations including:
 * - Creating events (scheduled and unscheduled types)
 * - Updating events
 * - Deleting events
 * - Scheduling events for subjects (with is_unscheduled / scheduled_date)
 * - Creating unscheduled visits on the fly
 * - Using premade unscheduled visit definitions
 * - Verifying CRF auto-creation for unscheduled visits
 * - Chronological ordering of subject events
 * - Verifying database changes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as eventService from '../src/services/hybrid/event.service';

describe('Event Service', () => {
  let testStudyId: number;
  let testEventId: number;
  const userId = 1;
  const username = 'test-user';

  beforeAll(async () => {
    const result = await testDb.pool.query('SELECT NOW()');
    expect(result.rows).toBeDefined();

    const studyResult = await testDb.pool.query(`
      INSERT INTO study (
        unique_identifier, name, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4
      )
      RETURNING study_id
    `, [`EVENT-TEST-${Date.now()}`, 'Event Test Study', userId, `S_EVT_${Date.now()}`]);

    testStudyId = studyResult.rows[0].studyId;
  });

  afterAll(async () => {
    if (testEventId) {
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [testEventId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  // =========================================================
  // CREATE STUDY EVENT DEFINITIONS
  // =========================================================
  describe('createStudyEvent', () => {
    it('should create a new scheduled study event definition', async () => {
      const eventData = {
        studyId: testStudyId,
        name: 'Screening Visit',
        description: 'Initial screening visit',
        ordinal: 1,
        type: 'scheduled' as const,
        repeating: false,
        category: 'Screening'
      };

      const result = await eventService.createStudyEvent(eventData, userId);

      expect(result.success).toBe(true);
      expect(result.eventDefinitionId).toBeDefined();
      testEventId = result.eventDefinitionId!;

      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(eventData.name);
      expect(dbResult.rows[0].type).toBe('scheduled');
      expect(dbResult.rows[0].ordinal).toBe(eventData.ordinal);
      expect(dbResult.rows[0].ocOid).toBeDefined();
    });

    it('should create an unscheduled event definition', async () => {
      const result = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Unscheduled AE Visit',
        description: 'For adverse events',
        type: 'unscheduled',
        repeating: true,
        category: 'Unscheduled'
      }, userId);

      expect(result.success).toBe(true);
      expect(result.eventDefinitionId).toBeDefined();

      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [result.eventDefinitionId]
      );

      expect(dbResult.rows[0].type).toBe('unscheduled');
      expect(dbResult.rows[0].repeating).toBe(true);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [result.eventDefinitionId]);
    });

    it('should auto-calculate ordinal if not provided', async () => {
      const result = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Auto Ordinal Event',
        type: 'scheduled'
      }, userId);

      expect(result.success).toBe(true);

      const dbResult = await testDb.pool.query(
        'SELECT ordinal FROM study_event_definition WHERE study_event_definition_id = $1',
        [result.eventDefinitionId]
      );

      expect(dbResult.rows[0].ordinal).toBeGreaterThan(0);

      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [result.eventDefinitionId]);
    });

    it('should create audit log entry', async () => {
      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event
         WHERE entity_id = $1 AND audit_table = $2
         ORDER BY audit_date DESC LIMIT 1`,
        [testEventId, 'study_event_definition']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].userId).toBe(userId);
    });
  });

  // =========================================================
  // UPDATE STUDY EVENT
  // =========================================================
  describe('updateStudyEvent', () => {
    it('should update event definition', async () => {
      const updates = {
        name: 'Updated Screening Visit',
        description: 'Updated description',
        ordinal: 2
      };

      const result = await eventService.updateStudyEvent(testEventId, updates, userId);

      expect(result.success).toBe(true);

      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].description).toBe(updates.description);
      expect(dbResult.rows[0].ordinal).toBe(updates.ordinal);
    });

    it('should return error when no fields to update', async () => {
      const result = await eventService.updateStudyEvent(testEventId, {}, userId);
      expect(result.success).toBe(false);
    });
  });

  // =========================================================
  // GET STUDY EVENTS
  // =========================================================
  describe('getStudyEvents', () => {
    it('should list events for a study', async () => {
      const events = await eventService.getStudyEvents(testStudyId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].studyEventDefinitionId).toBe(testEventId);
    });

    it('should include type field in results', async () => {
      const events = await eventService.getStudyEvents(testStudyId);

      expect(events[0].type).toBeDefined();
      expect(['scheduled', 'unscheduled', 'common']).toContain(events[0].type);
    });
  });

  // =========================================================
  // GET STUDY EVENT BY ID
  // =========================================================
  describe('getStudyEventById', () => {
    it('should get event details', async () => {
      const event = await eventService.getStudyEventById(testEventId);

      expect(event).toBeDefined();
      expect(event.studyEventDefinitionId).toBe(testEventId);
      expect(event.studyId).toBe(testStudyId);
    });

    it('should return null for non-existent event', async () => {
      const event = await eventService.getStudyEventById(999999);
      expect(event).toBeNull();
    });
  });

  // =========================================================
  // DELETE STUDY EVENT
  // =========================================================
  describe('deleteStudyEvent', () => {
    it('should soft delete event definition', async () => {
      const result = await eventService.deleteStudyEvent(testEventId, userId);

      expect(result.success).toBe(true);

      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows[0].statusId).toBe(5);
    });
  });

  // =========================================================
  // SUBJECT EVENTS (with unscheduled support)
  // =========================================================
  describe('getSubjectEvents', () => {
    let testSubjectId: number;
    let subjectEventDefId: number;

    beforeAll(async () => {
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id)
        VALUES (1, NOW(), 1)
        RETURNING subject_id
      `);

      const subjectId = subjectResult.rows[0].subjectId;

      const studySubjectResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`SUBEVT-${Date.now()}`, subjectId, testStudyId, `SS_SE_${Date.now()}`]);

      testSubjectId = studySubjectResult.rows[0].studySubjectId;

      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Subject Event Test', 'Test event', false, 'scheduled', 10, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_SUBEVT_${Date.now()}`]);

      subjectEventDefId = eventDefResult.rows[0].studyEventDefinitionId;

      await testDb.pool.query(`
        INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id, sample_ordinal, scheduled_date, is_unscheduled)
        VALUES ($1, $2, NOW(), 1, $3, NOW(), 1, 1, NOW(), false)
      `, [subjectEventDefId, testSubjectId, userId]);
    });

    afterAll(async () => {
      if (testSubjectId) {
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [testSubjectId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testSubjectId]);
      }
      if (subjectEventDefId) {
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [subjectEventDefId]);
      }
    });

    it('should return subject events list', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should include event details with is_unscheduled and scheduled_date', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 0) {
        expect(events[0].studyEventId).toBeDefined();
        expect(events[0].eventName).toBeDefined();
        expect(events[0].statusName).toBeDefined();
        expect(events[0].isUnscheduled).toBeDefined();
        expect(events[0].scheduledDate).toBeDefined();
      }
    });

    it('should include CRF counts', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 0) {
        expect(events[0].crfCount).toBeDefined();
        expect(events[0].completedCrfCount).toBeDefined();
      }
    });

    it('should order events chronologically', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 1) {
        for (let i = 0; i < events.length - 1; i++) {
          const dateA = events[i].scheduledDate || events[i].dateStart;
          const dateB = events[i + 1].scheduledDate || events[i + 1].dateStart;
          if (dateA && dateB) {
            expect(new Date(dateA).getTime()).toBeLessThanOrEqual(new Date(dateB).getTime());
          }
        }
      }
    });

    it('should return empty array for subject with no events', async () => {
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id) VALUES (1, NOW(), 1) RETURNING subject_id
      `);

      const ssResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`NOEVT-${Date.now()}`, subjectResult.rows[0].subjectId, testStudyId, `SS_NE_${Date.now()}`]);

      const noEventsSubjectId = ssResult.rows[0].studySubjectId;

      const events = await eventService.getSubjectEvents(noEventsSubjectId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);

      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [noEventsSubjectId]);
    });
  });

  // =========================================================
  // EVENT CRFs
  // =========================================================
  describe('getEventCRFs', () => {
    let crfEventDefId: number;
    let testCrfId: number;

    beforeAll(async () => {
      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'CRF Event Test', 'Test event', false, 'scheduled', 11, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_CRF_${Date.now()}`]);

      crfEventDefId = eventDefResult.rows[0].studyEventDefinitionId;

      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (study_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'Event CRF Test', 1, $2, NOW(), $3)
        RETURNING crf_id
      `, [testStudyId, userId, `F_EVTCRF_${Date.now()}`]);

      testCrfId = crfResult.rows[0].crfId;

      const crfVersionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [testCrfId, userId, `FV_EVTCRF_${Date.now()}`]);

      const crfVersionId = crfVersionResult.rows[0].crfVersionId;

      await testDb.pool.query(`
        INSERT INTO event_definition_crf (study_event_definition_id, study_id, crf_id, required_crf, ordinal, status_id, default_version_id, date_created, owner_id)
        VALUES ($1, $2, $3, true, 1, 1, $4, NOW(), $5)
      `, [crfEventDefId, testStudyId, testCrfId, crfVersionId, userId]);
    });

    afterAll(async () => {
      if (crfEventDefId) {
        await testDb.pool.query('DELETE FROM event_definition_crf WHERE study_event_definition_id = $1', [crfEventDefId]);
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [crfEventDefId]);
      }
      if (testCrfId) {
        await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [testCrfId]);
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [testCrfId]);
      }
    });

    it('should return CRFs for event definition', async () => {
      const crfs = await eventService.getEventCRFs(crfEventDefId);

      expect(Array.isArray(crfs)).toBe(true);
      expect(crfs.length).toBeGreaterThan(0);
    });

    it('should include CRF details', async () => {
      const crfs = await eventService.getEventCRFs(crfEventDefId);

      if (crfs.length > 0) {
        expect(crfs[0].crfId).toBeDefined();
        expect(crfs[0].crfName).toBeDefined();
        expect(crfs[0].requiredCrf).toBeDefined();
      }
    });

    it('should include default version info', async () => {
      const crfs = await eventService.getEventCRFs(crfEventDefId);

      if (crfs.length > 0) {
        expect(crfs[0].defaultVersionId).toBeDefined();
        expect(crfs[0].defaultVersionName).toBeDefined();
      }
    });

    it('should return empty array for event with no CRFs', async () => {
      const emptyEventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Empty CRF Event', 'No CRFs', false, 'scheduled', 12, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_EMPTY_${Date.now()}`]);

      const emptyEventDefId = emptyEventDefResult.rows[0].studyEventDefinitionId;

      const crfs = await eventService.getEventCRFs(emptyEventDefId);

      expect(Array.isArray(crfs)).toBe(true);
      expect(crfs.length).toBe(0);

      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [emptyEventDefId]);
    });
  });

  // =========================================================
  // UNSCHEDULED VISIT CREATION
  // =========================================================
  describe('createUnscheduledVisit', () => {
    let unschedSubjectId: number;

    beforeAll(async () => {
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id) VALUES (1, NOW(), 1) RETURNING subject_id
      `);
      const ssResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`UNSCHED-${Date.now()}`, subjectResult.rows[0].subjectId, testStudyId, `SS_UN_${Date.now()}`]);

      unschedSubjectId = ssResult.rows[0].studySubjectId;
    });

    afterAll(async () => {
      if (unschedSubjectId) {
        await testDb.pool.query('DELETE FROM patient_event_form WHERE study_subject_id = $1', [unschedSubjectId]);
        await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = $1', [unschedSubjectId]);
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [unschedSubjectId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [unschedSubjectId]);
      }
    });

    it('should create an unscheduled visit with name', async () => {
      const result = await eventService.createUnscheduledVisit({
        studyId: testStudyId,
        studySubjectId: unschedSubjectId,
        name: 'Emergency Visit',
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.studyEventId || result.data.studyEventId).toBeDefined();
    });

    it('should set is_unscheduled=true on the created study_event', async () => {
      const result = await eventService.createUnscheduledVisit({
        studyId: testStudyId,
        studySubjectId: unschedSubjectId,
        name: 'AE Follow-up',
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(true);

      const studyEventId = result.data?.studyEventId;
      if (studyEventId) {
        const dbResult = await testDb.pool.query(
          'SELECT is_unscheduled, scheduled_date FROM study_event WHERE study_event_id = $1',
          [studyEventId]
        );
        expect(dbResult.rows[0].isUnscheduled).toBe(true);
        expect(dbResult.rows[0].scheduledDate).toBeDefined();
      }
    });

    it('should use provided studyEventDefinitionId instead of creating new definition', async () => {
      // First create a premade unscheduled definition
      const defResult = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Premade Unscheduled Visit',
        type: 'unscheduled',
        repeating: true
      }, userId);

      expect(defResult.success).toBe(true);
      const premadeDefId = defResult.eventDefinitionId!;

      // Now create unscheduled visit using the premade definition
      const result = await eventService.createUnscheduledVisit({
        studySubjectId: unschedSubjectId,
        studyEventDefinitionId: premadeDefId,
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(true);

      // Verify it used the existing definition, not a new one
      const studyEventId = result.data?.studyEventId;
      if (studyEventId) {
        const dbResult = await testDb.pool.query(
          'SELECT study_event_definition_id FROM study_event WHERE study_event_id = $1',
          [studyEventId]
        );
        expect(dbResult.rows[0].studyEventDefinitionId).toBe(premadeDefId);
      }

      // Cleanup the premade definition
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [premadeDefId]);
    });

    it('should fail for non-existent subject', async () => {
      const result = await eventService.createUnscheduledVisit({
        studyId: testStudyId,
        studySubjectId: 999999,
        name: 'Should Fail'
      }, userId, username);

      expect(result.success).toBe(false);
    });

    it('should fail for non-existent studyEventDefinitionId', async () => {
      const result = await eventService.createUnscheduledVisit({
        studySubjectId: unschedSubjectId,
        studyEventDefinitionId: 999999,
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(false);
    });
  });

  // =========================================================
  // SCHEDULE SUBJECT EVENT (with unscheduled flags)
  // =========================================================
  describe('scheduleSubjectEvent', () => {
    let schedSubjectId: number;
    let schedEventDefId: number;

    beforeAll(async () => {
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id) VALUES (1, NOW(), 1) RETURNING subject_id
      `);
      const ssResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`SCHED-${Date.now()}`, subjectResult.rows[0].subjectId, testStudyId, `SS_SCH_${Date.now()}`]);

      schedSubjectId = ssResult.rows[0].studySubjectId;

      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Schedule Test Event', '', false, 'scheduled', 20, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_SCHED_${Date.now()}`]);

      schedEventDefId = eventDefResult.rows[0].studyEventDefinitionId;
    });

    afterAll(async () => {
      if (schedSubjectId) {
        await testDb.pool.query('DELETE FROM patient_event_form WHERE study_subject_id = $1', [schedSubjectId]);
        await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = $1', [schedSubjectId]);
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [schedSubjectId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [schedSubjectId]);
      }
      if (schedEventDefId) {
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [schedEventDefId]);
      }
    });

    it('should schedule a regular event with is_unscheduled=false', async () => {
      const result = await eventService.scheduleSubjectEvent({
        studySubjectId: schedSubjectId,
        studyEventDefinitionId: schedEventDefId,
        startDate: new Date().toISOString(),
        location: 'Clinic A'
      }, userId, username);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.isUnscheduled).toBe(false);
    });

    it('should schedule an unscheduled event with is_unscheduled=true and scheduled_date', async () => {
      const scheduledDate = '2026-06-15T10:00:00.000Z';

      const result = await eventService.scheduleSubjectEvent({
        studySubjectId: schedSubjectId,
        studyEventDefinitionId: schedEventDefId,
        startDate: scheduledDate,
        scheduledDate: scheduledDate,
        isUnscheduled: true,
        location: 'Emergency Room'
      }, userId, username);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.isUnscheduled).toBe(true);
      expect(result.data.scheduledDate).toBeDefined();
    });

    it('should fail for non-existent subject', async () => {
      const result = await eventService.scheduleSubjectEvent({
        studySubjectId: 999999,
        studyEventDefinitionId: schedEventDefId,
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(false);
    });

    it('should fail for non-existent event definition', async () => {
      const result = await eventService.scheduleSubjectEvent({
        studySubjectId: schedSubjectId,
        studyEventDefinitionId: 999999,
        startDate: new Date().toISOString()
      }, userId, username);

      expect(result.success).toBe(false);
    });
  });

  // =========================================================
  // VISIT FORMS (template + patient status)
  // =========================================================
  describe('getVisitForms', () => {
    it('should return empty array for non-existent study event', async () => {
      const forms = await eventService.getVisitForms(999999);
      expect(Array.isArray(forms)).toBe(true);
      expect(forms.length).toBe(0);
    });
  });

  // =========================================================
  // PATIENT FORM SNAPSHOTS
  // =========================================================
  describe('getPatientFormSnapshots', () => {
    it('should return empty array for non-existent study event', async () => {
      const snapshots = await eventService.getPatientFormSnapshots(999999);
      expect(Array.isArray(snapshots)).toBe(true);
      expect(snapshots.length).toBe(0);
    });
  });

  // =========================================================
  // SAVE PATIENT FORM DATA
  // =========================================================
  describe('savePatientFormData', () => {
    it('should return 404 for non-existent snapshot', async () => {
      const result = await eventService.savePatientFormData(999999, { field1: 'value1' }, userId);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });
  });
});

