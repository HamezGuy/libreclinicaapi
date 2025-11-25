/**
 * Form Service Unit Tests
 * 
 * Tests form template operations including:
 * - Listing forms
 * - Getting form metadata
 * - Verifying database access
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as formService from '../src/services/hybrid/form.service';

describe('Form Service', () => {
  let testCrfId: number;
  let testStudyId: number;
  const userId = 1;

  beforeAll(async () => {
    // Create a test study
    const studyResult = await testDb.pool.query(`
      INSERT INTO study (
        unique_identifier, name, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4
      )
      RETURNING study_id
    `, [`FORM-TEST-${Date.now()}`, 'Form Test Study', userId, `S_FORM_${Date.now()}`]);
    
    testStudyId = studyResult.rows[0].study_id;

    // Create a test CRF
    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (
        status_id, name, description, owner_id, date_created, oc_oid, study_id
      ) VALUES (
        1, $1, 'Test CRF Description', $2, NOW(), $3, $4
      )
      RETURNING crf_id
    `, [`Test CRF ${Date.now()}`, userId, `F_TEST_${Date.now()}`, testStudyId]);

    testCrfId = crfResult.rows[0].crf_id;

    // Create CRF version
    await testDb.pool.query(`
      INSERT INTO crf_version (
        crf_id, name, description, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, 'v1.0', 'Initial version', 1, $2, NOW(), $3
      )
    `, [testCrfId, userId, `F_TEST_v10`]);
  });

  afterAll(async () => {
    // Cleanup
    if (testCrfId) {
      await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [testCrfId]);
      await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [testCrfId]);
    }
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
    await testDb.pool.end();
  });

  describe('getAllForms', () => {
    it('should list all available forms', async () => {
      const forms = await formService.getAllForms();

      expect(Array.isArray(forms)).toBe(true);
      expect(forms.length).toBeGreaterThan(0);
      
      const testForm = forms.find(f => f.crf_id === testCrfId);
      expect(testForm).toBeDefined();
      expect(testForm.status_id).toBe(1);
    });
  });

  describe('getStudyForms', () => {
    it('should list forms for a specific study', async () => {
      const forms = await formService.getStudyForms(testStudyId);

      expect(Array.isArray(forms)).toBe(true);
      expect(forms.length).toBeGreaterThan(0);
      expect(forms[0].crf_id).toBe(testCrfId);
    });
  });

  describe('getFormById', () => {
    it('should get form details by ID', async () => {
      const form = await formService.getFormById(testCrfId);

      expect(form).toBeDefined();
      expect(form.crf_id).toBe(testCrfId);
      expect(form.version_count).toBeGreaterThan(0);
    });

    it('should return null for non-existent form', async () => {
      const form = await formService.getFormById(999999);
      expect(form).toBeNull();
    });
  });

  describe('getFormMetadata', () => {
    it('should get form metadata including version info', async () => {
      const metadata = await formService.getFormMetadata(testCrfId);

      expect(metadata).toBeDefined();
      expect(metadata.crf).toBeDefined();
      expect(metadata.version).toBeDefined();
      expect(metadata.version.name).toBe('v1.0');
    });
  });

  describe('validateFormData', () => {
    it('should validate non-empty form data', () => {
      const data = { item1: 'value1' };
      const result = formService.validateFormData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject empty form data', () => {
      const data = {};
      const result = formService.validateFormData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form data is empty');
    });
  });

  describe('getFormData', () => {
    let testEventCrfId: number;
    let testItemId: number;

    beforeAll(async () => {
      // Create necessary test data for form data retrieval
      // Create event definition
      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Form Data Test Event', 'Test event', false, 'scheduled', 1, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_FORMDATA_${Date.now()}`]);

      const eventDefId = eventDefResult.rows[0].study_event_definition_id;

      // Create subject for this test
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
      `, [`FORMDATA-SUB-${Date.now()}`, subjectId, testStudyId, `SS_FD_${Date.now()}`]);

      const studySubjectId = studySubjectResult.rows[0].study_subject_id;

      // Create study event
      const eventResult = await testDb.pool.query(`
        INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
        VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
        RETURNING study_event_id
      `, [eventDefId, studySubjectId, userId]);

      const studyEventId = eventResult.rows[0].study_event_id;

      // Create CRF version for event CRF
      const crfVersionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.1', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [testCrfId, userId, `FV_FD_${Date.now()}`]);

      const crfVersionId = crfVersionResult.rows[0].crf_version_id;

      // Create event CRF
      const eventCrfResult = await testDb.pool.query(`
        INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id, completion_status_id)
        VALUES ($1, $2, 1, $3, NOW(), $4, 1)
        RETURNING event_crf_id
      `, [studyEventId, crfVersionId, userId, studySubjectId]);

      testEventCrfId = eventCrfResult.rows[0].event_crf_id;

      // Create item
      const itemResult = await testDb.pool.query(`
        INSERT INTO item (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'Test Item', 1, $2, NOW(), $3)
        RETURNING item_id
      `, [`test_item_${Date.now()}`, userId, `I_FD_${Date.now()}`]);

      testItemId = itemResult.rows[0].item_id;

      // Create item data
      await testDb.pool.query(`
        INSERT INTO item_data (item_id, event_crf_id, status_id, value, date_created, owner_id, ordinal, deleted)
        VALUES ($1, $2, 1, 'Test Value', NOW(), $3, 1, false)
      `, [testItemId, testEventCrfId, userId]);
    });

    it('should return form data for event CRF', async () => {
      const data = await formService.getFormData(testEventCrfId);

      expect(Array.isArray(data)).toBe(true);
    });

    it('should include item details in form data', async () => {
      const data = await formService.getFormData(testEventCrfId);

      if (data.length > 0) {
        expect(data[0].item_data_id).toBeDefined();
        expect(data[0].item_name).toBeDefined();
        expect(data[0].value).toBeDefined();
      }
    });

    it('should not include deleted items', async () => {
      // Create a deleted item
      await testDb.pool.query(`
        INSERT INTO item_data (item_id, event_crf_id, status_id, value, date_created, owner_id, ordinal, deleted)
        VALUES ($1, $2, 1, 'Deleted Value', NOW(), $3, 2, true)
      `, [testItemId, testEventCrfId, userId]);

      const data = await formService.getFormData(testEventCrfId);

      // Should not include deleted items
      const deletedItem = data.find((d: any) => d.value === 'Deleted Value');
      expect(deletedItem).toBeUndefined();
    });

    it('should return empty array for non-existent event CRF', async () => {
      const data = await formService.getFormData(999999);

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });
  });

  describe('getFormStatus', () => {
    let testEventCrfId: number;

    beforeAll(async () => {
      // Create necessary test data
      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Form Status Test Event', 'Test event', false, 'scheduled', 2, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_FORMST_${Date.now()}`]);

      const eventDefId = eventDefResult.rows[0].study_event_definition_id;

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
      `, [`FORMST-SUB-${Date.now()}`, subjectId, testStudyId, `SS_FS_${Date.now()}`]);

      const studySubjectId = studySubjectResult.rows[0].study_subject_id;

      const eventResult = await testDb.pool.query(`
        INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
        VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
        RETURNING study_event_id
      `, [eventDefId, studySubjectId, userId]);

      const studyEventId = eventResult.rows[0].study_event_id;

      const crfVersionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.2', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [testCrfId, userId, `FV_FS_${Date.now()}`]);

      const crfVersionId = crfVersionResult.rows[0].crf_version_id;

      const eventCrfResult = await testDb.pool.query(`
        INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id, completion_status_id, sdv_status)
        VALUES ($1, $2, 1, $3, NOW(), $4, 2, false)
        RETURNING event_crf_id
      `, [studyEventId, crfVersionId, userId, studySubjectId]);

      testEventCrfId = eventCrfResult.rows[0].event_crf_id;
    });

    it('should return form status for event CRF', async () => {
      const status = await formService.getFormStatus(testEventCrfId);

      expect(status).toBeDefined();
      expect(status.event_crf_id).toBe(testEventCrfId);
    });

    it('should include completion status', async () => {
      const status = await formService.getFormStatus(testEventCrfId);

      expect(status.completion_status_id).toBeDefined();
      expect(status.completion_status).toBeDefined();
    });

    it('should include SDV status', async () => {
      const status = await formService.getFormStatus(testEventCrfId);

      expect(status.sdv_status).toBeDefined();
    });

    it('should include date information', async () => {
      const status = await formService.getFormStatus(testEventCrfId);

      expect(status.date_created).toBeDefined();
    });

    it('should include user information', async () => {
      const status = await formService.getFormStatus(testEventCrfId);

      expect(status.created_by).toBeDefined();
    });

    it('should return null for non-existent event CRF', async () => {
      const status = await formService.getFormStatus(999999);

      expect(status).toBeNull();
    });
  });
});


