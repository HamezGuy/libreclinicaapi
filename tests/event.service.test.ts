/**
 * Event Service Unit Tests
 * 
 * Tests study event (phase) management operations including:
 * - Creating events
 * - Updating events
 * - Deleting events
 * - Scheduling events
 * - Verifying database changes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as eventService from '../src/services/hybrid/event.service';

describe('Event Service', () => {
  let testStudyId: number;
  let testEventId: number;
  const userId = 1; // Root user

  beforeAll(async () => {
    // Ensure database connection
    const result = await testDb.pool.query('SELECT NOW()');
    expect(result.rows).toBeDefined();

    // Create a test study for events
    const studyResult = await testDb.pool.query(`
      INSERT INTO study (
        unique_identifier, name, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4
      )
      RETURNING study_id
    `, [`EVENT-TEST-${Date.now()}`, 'Event Test Study', userId, `S_EVT_${Date.now()}`]);
    
    testStudyId = studyResult.rows[0].study_id;
  });

  afterAll(async () => {
    // Cleanup
    if (testEventId) {
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [testEventId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  describe('createStudyEvent', () => {
    it('should create a new study event definition', async () => {
      const eventData = {
        studyId: testStudyId,
        name: 'Screening Visit',
        description: 'Initial screening visit',
        ordinal: 1,
        type: 'scheduled',
        repeating: false,
        category: 'Screening'
      };

      const result = await eventService.createStudyEvent(eventData, userId);

      expect(result.success).toBe(true);
      expect(result.eventDefinitionId).toBeDefined();
      testEventId = result.eventDefinitionId!;

      // Verify in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(eventData.name);
      expect(dbResult.rows[0].ordinal).toBe(eventData.ordinal);
      expect(dbResult.rows[0].oc_oid).toBeDefined();
    });

    it('should create audit log entry', async () => {
      // Check audit log
      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = $2 
         ORDER BY audit_date DESC LIMIT 1`,
        [testEventId, 'study_event_definition']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].user_id).toBe(userId);
    });
  });

  describe('updateStudyEvent', () => {
    it('should update event definition', async () => {
      const updates = {
        name: 'Updated Screening Visit',
        description: 'Updated description',
        ordinal: 2
      };

      const result = await eventService.updateStudyEvent(testEventId, updates, userId);

      expect(result.success).toBe(true);

      // Verify database changes
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].description).toBe(updates.description);
      expect(dbResult.rows[0].ordinal).toBe(updates.ordinal);
    });
  });

  describe('getStudyEvents', () => {
    it('should list events for a study', async () => {
      const events = await eventService.getStudyEvents(testStudyId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].study_event_definition_id).toBe(testEventId);
    });
  });

  describe('getStudyEventById', () => {
    it('should get event details', async () => {
      const event = await eventService.getStudyEventById(testEventId);

      expect(event).toBeDefined();
      expect(event.study_event_definition_id).toBe(testEventId);
      expect(event.study_id).toBe(testStudyId);
    });
  });

  describe('deleteStudyEvent', () => {
    it('should soft delete event definition', async () => {
      const result = await eventService.deleteStudyEvent(testEventId, userId);

      expect(result.success).toBe(true);

      // Verify status is set to removed (5)
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study_event_definition WHERE study_event_definition_id = $1',
        [testEventId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);
    });
  });

  describe('getSubjectEvents', () => {
    let testSubjectId: number;
    let subjectEventDefId: number;

    beforeAll(async () => {
      // Create subject
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id)
        VALUES (1, NOW(), 1)
        RETURNING subject_id
      `);

      const subjectId = subjectResult.rows[0].subject_id;

      const studySubjectResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`SUBEVT-${Date.now()}`, subjectId, testStudyId, `SS_SE_${Date.now()}`]);

      testSubjectId = studySubjectResult.rows[0].study_subject_id;

      // Create event definition
      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Subject Event Test', 'Test event', false, 'scheduled', 10, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_SUBEVT_${Date.now()}`]);

      subjectEventDefId = eventDefResult.rows[0].study_event_definition_id;

      // Create study event for subject
      await testDb.pool.query(`
        INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id, sample_ordinal)
        VALUES ($1, $2, NOW(), 1, $3, NOW(), 1, 1)
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

    it('should include event details', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 0) {
        expect(events[0].study_event_id).toBeDefined();
        expect(events[0].event_name).toBeDefined();
        expect(events[0].status_name).toBeDefined();
      }
    });

    it('should include CRF counts', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 0) {
        expect(events[0].crf_count).toBeDefined();
        expect(events[0].completed_crf_count).toBeDefined();
      }
    });

    it('should order events by ordinal', async () => {
      const events = await eventService.getSubjectEvents(testSubjectId);

      if (events.length > 1) {
        for (let i = 0; i < events.length - 1; i++) {
          expect(events[i].ordinal).toBeLessThanOrEqual(events[i + 1].ordinal);
        }
      }
    });

    it('should return empty array for subject with no events', async () => {
      // Create a new subject with no events
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id) VALUES (1, NOW(), 1) RETURNING subject_id
      `);

      const ssResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`NOEVT-${Date.now()}`, subjectResult.rows[0].subject_id, testStudyId, `SS_NE_${Date.now()}`]);

      const noEventsSubjectId = ssResult.rows[0].study_subject_id;

      const events = await eventService.getSubjectEvents(noEventsSubjectId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [noEventsSubjectId]);
    });
  });

  describe('getEventCRFs', () => {
    let crfEventDefId: number;
    let testCrfId: number;

    beforeAll(async () => {
      // Create event definition
      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'CRF Event Test', 'Test event', false, 'scheduled', 11, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_CRF_${Date.now()}`]);

      crfEventDefId = eventDefResult.rows[0].study_event_definition_id;

      // Create CRF
      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (study_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'Event CRF Test', 1, $2, NOW(), $3)
        RETURNING crf_id
      `, [testStudyId, userId, `F_EVTCRF_${Date.now()}`]);

      testCrfId = crfResult.rows[0].crf_id;

      // Create CRF version
      const crfVersionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [testCrfId, userId, `FV_EVTCRF_${Date.now()}`]);

      const crfVersionId = crfVersionResult.rows[0].crf_version_id;

      // Link CRF to event definition
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
        expect(crfs[0].crf_id).toBeDefined();
        expect(crfs[0].crf_name).toBeDefined();
        expect(crfs[0].required_crf).toBeDefined();
      }
    });

    it('should include default version info', async () => {
      const crfs = await eventService.getEventCRFs(crfEventDefId);

      if (crfs.length > 0) {
        expect(crfs[0].default_version_id).toBeDefined();
        expect(crfs[0].default_version_name).toBeDefined();
      }
    });

    it('should order by ordinal', async () => {
      const crfs = await eventService.getEventCRFs(crfEventDefId);

      if (crfs.length > 1) {
        for (let i = 0; i < crfs.length - 1; i++) {
          expect(crfs[i].ordinal).toBeLessThanOrEqual(crfs[i + 1].ordinal);
        }
      }
    });

    it('should return empty array for event with no CRFs', async () => {
      // Create event definition with no CRFs
      const emptyEventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Empty CRF Event', 'No CRFs', false, 'scheduled', 12, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_EMPTY_${Date.now()}`]);

      const emptyEventDefId = emptyEventDefResult.rows[0].study_event_definition_id;

      const crfs = await eventService.getEventCRFs(emptyEventDefId);

      expect(Array.isArray(crfs)).toBe(true);
      expect(crfs.length).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [emptyEventDefId]);
    });
  });
});


