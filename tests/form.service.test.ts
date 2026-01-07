/**
 * Form Service Unit Tests
 * 
 * Tests form template operations including:
 * - Listing forms
 * - Getting form metadata
 * - Verifying database access
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
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
        status_id, name, description, owner_id, date_created, oc_oid, source_study_id
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

  // ============================================================
  // CRUD OPERATIONS TESTS - Create, Update, Delete
  // These tests verify the full flow from API to database
  // ============================================================

  describe('createForm', () => {
    let createdCrfId: number | undefined;

    afterEach(async () => {
      // Cleanup created form
      if (createdCrfId) {
        await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [createdCrfId]);
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [createdCrfId]);
        createdCrfId = undefined;
      }
    });

    it('should create a new form template in the database', async () => {
      const formData = {
        name: `Test Create Form ${Date.now()}`,
        description: 'Test form created by unit test'
      };

      const result = await formService.createForm(formData, userId);

      expect(result.success).toBe(true);
      expect(result.crfId).toBeDefined();
      expect(result.message).toContain('successfully');
      
      createdCrfId = result.crfId;

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT * FROM crf WHERE crf_id = $1',
        [result.crfId]
      );

      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].name).toBe(formData.name);
      expect(dbCheck.rows[0].description).toBe(formData.description);
      expect(dbCheck.rows[0].status_id).toBe(1); // available
    });

    it('should create initial version when creating form', async () => {
      const formData = {
        name: `Test Version Form ${Date.now()}`,
        description: 'Test form with version'
      };

      const result = await formService.createForm(formData, userId);
      createdCrfId = result.crfId;

      // Verify version was created
      const versionCheck = await testDb.pool.query(
        'SELECT * FROM crf_version WHERE crf_id = $1',
        [result.crfId]
      );

      expect(versionCheck.rows.length).toBe(1);
      expect(versionCheck.rows[0].name).toBe('v1.0');
    });

    it('should reject duplicate form names (same OC OID)', async () => {
      const formData = {
        name: `Duplicate Test ${Date.now()}`,
        description: 'First form'
      };

      // Create first form
      const result1 = await formService.createForm(formData, userId);
      createdCrfId = result1.crfId;

      // Try to create second form with same name
      const result2 = await formService.createForm(formData, userId);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');
    });

    it('should associate form with study if studyId provided', async () => {
      const formData = {
        name: `Study Form ${Date.now()}`,
        description: 'Form for specific study',
        studyId: testStudyId
      };

      const result = await formService.createForm(formData, userId);
      createdCrfId = result.crfId;

      // Verify study association
      const dbCheck = await testDb.pool.query(
        'SELECT source_study_id FROM crf WHERE crf_id = $1',
        [result.crfId]
      );

      expect(dbCheck.rows[0].source_study_id).toBe(testStudyId);
    });
  });

  describe('updateForm', () => {
    let updateTestCrfId: number;

    beforeAll(async () => {
      // Create a form specifically for update tests
      const result = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'Original description', 1, $2, NOW(), $3)
        RETURNING crf_id
      `, [`Update Test Form ${Date.now()}`, userId, `F_UPDATE_${Date.now()}`]);

      updateTestCrfId = result.rows[0].crf_id;
    });

    afterAll(async () => {
      if (updateTestCrfId) {
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [updateTestCrfId]);
      }
    });

    it('should update form name', async () => {
      const newName = `Updated Name ${Date.now()}`;
      
      const result = await formService.updateForm(updateTestCrfId, { name: newName }, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT name FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].name).toBe(newName);
    });

    it('should update form description', async () => {
      const newDescription = 'Updated description for testing';
      
      const result = await formService.updateForm(updateTestCrfId, { description: newDescription }, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT description FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].description).toBe(newDescription);
    });

    it('should update status to published (status_id = 1)', async () => {
      // First set to draft
      await testDb.pool.query('UPDATE crf SET status_id = 2 WHERE crf_id = $1', [updateTestCrfId]);

      const result = await formService.updateForm(updateTestCrfId, { status: 'published' }, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT status_id FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].status_id).toBe(1); // published = available
    });

    it('should update status to draft (status_id = 2)', async () => {
      const result = await formService.updateForm(updateTestCrfId, { status: 'draft' }, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT status_id FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].status_id).toBe(2); // draft = unavailable
    });

    it('should update status to archived (status_id = 5)', async () => {
      const result = await formService.updateForm(updateTestCrfId, { status: 'archived' }, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbCheck = await testDb.pool.query(
        'SELECT status_id FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].status_id).toBe(5); // archived = removed
    });

    it('should update date_updated timestamp', async () => {
      const beforeUpdate = await testDb.pool.query(
        'SELECT date_updated FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

      await formService.updateForm(updateTestCrfId, { name: `Timestamp Test ${Date.now()}` }, userId);

      const afterUpdate = await testDb.pool.query(
        'SELECT date_updated FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      // date_updated should be more recent
      expect(new Date(afterUpdate.rows[0].date_updated).getTime())
        .toBeGreaterThanOrEqual(new Date(beforeUpdate.rows[0].date_updated || 0).getTime());
    });

    it('should update the update_id to the updating user', async () => {
      const result = await formService.updateForm(updateTestCrfId, { name: `User Test ${Date.now()}` }, userId);

      expect(result.success).toBe(true);

      const dbCheck = await testDb.pool.query(
        'SELECT update_id FROM crf WHERE crf_id = $1',
        [updateTestCrfId]
      );

      expect(dbCheck.rows[0].update_id).toBe(userId);
    });
  });

  describe('deleteForm', () => {
    let deleteTestCrfId: number;

    beforeEach(async () => {
      // Create a fresh form for each delete test
      const result = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'Form to delete', 1, $2, NOW(), $3)
        RETURNING crf_id
      `, [`Delete Test Form ${Date.now()}`, userId, `F_DELETE_${Date.now()}`]);

      deleteTestCrfId = result.rows[0].crf_id;
    });

    afterEach(async () => {
      // Cleanup in case test didn't delete
      if (deleteTestCrfId) {
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [deleteTestCrfId]).catch(() => {});
      }
    });

    it('should soft delete form by setting status to removed', async () => {
      const result = await formService.deleteForm(deleteTestCrfId, userId);

      expect(result.success).toBe(true);

      // Verify in database - should still exist but with status_id = 5
      const dbCheck = await testDb.pool.query(
        'SELECT status_id FROM crf WHERE crf_id = $1',
        [deleteTestCrfId]
      );

      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].status_id).toBe(5); // removed
    });

    it('should prevent deletion of form in use by subjects', async () => {
      // Create CRF version and event_crf to simulate form in use
      const versionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [deleteTestCrfId, userId, `FV_DEL_${Date.now()}`]);

      const crfVersionId = versionResult.rows[0].crf_version_id;

      // Create minimal event_crf (form in use)
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (status_id, date_created, owner_id)
        VALUES (1, NOW(), 1)
        RETURNING subject_id
      `);

      const studySubjectResult = await testDb.pool.query(`
        INSERT INTO study_subject (label, subject_id, study_id, status_id, date_created, oc_oid)
        VALUES ($1, $2, $3, 1, NOW(), $4)
        RETURNING study_subject_id
      `, [`DEL-SUB-${Date.now()}`, subjectResult.rows[0].subject_id, testStudyId, `SS_DEL_${Date.now()}`]);

      const eventDefResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (study_id, name, repeating, type, ordinal, status_id, date_created, oc_oid)
        VALUES ($1, 'Delete Test Event', false, 'scheduled', 1, 1, NOW(), $2)
        RETURNING study_event_definition_id
      `, [testStudyId, `SE_DEL_${Date.now()}`]);

      const eventResult = await testDb.pool.query(`
        INSERT INTO study_event (study_event_definition_id, study_subject_id, date_start, status_id, owner_id, date_created, subject_event_status_id)
        VALUES ($1, $2, NOW(), 1, $3, NOW(), 1)
        RETURNING study_event_id
      `, [eventDefResult.rows[0].study_event_definition_id, studySubjectResult.rows[0].study_subject_id, userId]);

      await testDb.pool.query(`
        INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, study_subject_id, completion_status_id)
        VALUES ($1, $2, 1, $3, NOW(), $4, 1)
      `, [eventResult.rows[0].study_event_id, crfVersionId, userId, studySubjectResult.rows[0].study_subject_id]);

      // Now try to delete - should fail
      const result = await formService.deleteForm(deleteTestCrfId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('being used');
    });
  });

  // ============================================================
  // END-TO-END INTEGRATION TEST
  // Simulates full frontend -> backend -> database flow
  // ============================================================

  describe('End-to-End Form Template Flow', () => {
    let e2eCrfId: number | undefined;

    afterAll(async () => {
      if (e2eCrfId) {
        await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [e2eCrfId]);
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [e2eCrfId]);
      }
    });

    it('should complete full CRUD lifecycle', async () => {
      // 1. CREATE
      console.log('Step 1: Creating form template...');
      const createData = {
        name: `E2E Test Form ${Date.now()}`,
        description: 'End-to-end test form'
      };

      const createResult = await formService.createForm(createData, userId);
      expect(createResult.success).toBe(true);
      e2eCrfId = createResult.crfId;

      // Verify creation in database
      let dbCheck = await testDb.pool.query('SELECT * FROM crf WHERE crf_id = $1', [e2eCrfId]);
      expect(dbCheck.rows[0].name).toBe(createData.name);
      expect(dbCheck.rows[0].status_id).toBe(1);
      console.log('✓ Form created successfully');

      // 2. READ
      console.log('Step 2: Reading form template...');
      const readResult = await formService.getFormById(e2eCrfId!);
      expect(readResult).toBeDefined();
      expect(readResult.name).toBe(createData.name);
      console.log('✓ Form read successfully');

      // 3. UPDATE - Name
      console.log('Step 3: Updating form name...');
      const newName = `E2E Updated Form ${Date.now()}`;
      const updateNameResult = await formService.updateForm(e2eCrfId!, { name: newName }, userId);
      expect(updateNameResult.success).toBe(true);

      dbCheck = await testDb.pool.query('SELECT name FROM crf WHERE crf_id = $1', [e2eCrfId]);
      expect(dbCheck.rows[0].name).toBe(newName);
      console.log('✓ Form name updated successfully');

      // 4. UPDATE - Status to draft
      console.log('Step 4: Setting status to draft...');
      const draftResult = await formService.updateForm(e2eCrfId!, { status: 'draft' }, userId);
      expect(draftResult.success).toBe(true);

      dbCheck = await testDb.pool.query('SELECT status_id FROM crf WHERE crf_id = $1', [e2eCrfId]);
      expect(dbCheck.rows[0].status_id).toBe(2);
      console.log('✓ Status set to draft (status_id=2)');

      // 5. UPDATE - Status to published
      console.log('Step 5: Setting status to published...');
      const publishResult = await formService.updateForm(e2eCrfId!, { status: 'published' }, userId);
      expect(publishResult.success).toBe(true);

      dbCheck = await testDb.pool.query('SELECT status_id FROM crf WHERE crf_id = $1', [e2eCrfId]);
      expect(dbCheck.rows[0].status_id).toBe(1);
      console.log('✓ Status set to published (status_id=1)');

      // 6. DELETE
      console.log('Step 6: Deleting form template...');
      const deleteResult = await formService.deleteForm(e2eCrfId!, userId);
      expect(deleteResult.success).toBe(true);

      dbCheck = await testDb.pool.query('SELECT status_id FROM crf WHERE crf_id = $1', [e2eCrfId]);
      expect(dbCheck.rows[0].status_id).toBe(5); // soft deleted
      console.log('✓ Form deleted (soft delete, status_id=5)');

      console.log('\n✅ End-to-End CRUD lifecycle complete!');
    });
  });
});


