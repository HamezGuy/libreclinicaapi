/**
 * Query Correction Flow Tests
 * 
 * Tests the complete flow:
 * 1. Form data saved with validation failure -> Query created linked to item_data
 * 2. User responds to query with corrected value -> item_data updated
 * 3. Query shows current field value from linked item_data
 * 
 * This ensures:
 * - Queries are properly linked to item_data via dn_item_data_map
 * - Query responses with correctedValue actually update the form data
 * - Audit trail is maintained for 21 CFR Part 11 compliance
 */

import request from 'supertest';
import { pool } from '../config/database';
import app from '../app';
import * as validationRulesService from '../services/database/validation-rules.service';
import * as queryService from '../services/database/query.service';

const TEST_CONFIG = {
  AUTH_ENDPOINT: '/api/auth/login',
  QUERIES_ENDPOINT: '/api/queries',
  FORMS_ENDPOINT: '/api/forms',
  VALIDATION_ENDPOINT: '/api/validation-rules',
  USERNAME: 'root',
  PASSWORD: '12345678',
  TIMEOUT_MS: 60000
};

describe('Query Correction Flow', () => {
  let authToken: string;
  let userId: number = 1;
  let testStudyId: number = 1;
  let testSubjectId: number;
  let testEventCrfId: number;
  let testItemDataId: number;
  let testQueryId: number;
  let testCrfId: number;
  let databaseConnected = false;
  let createdQueryIds: number[] = [];
  let createdRuleIds: number[] = [];

  beforeAll(async () => {
    // Check database connection
    try {
      await pool.query('SELECT 1');
      databaseConnected = true;
      console.log('✅ Database connected');
    } catch (e) {
      console.warn('⚠️ Database not connected - tests will be skipped');
      return;
    }

    // Initialize validation rules table
    await validationRulesService.initializeValidationRulesTable();

    // Get auth token
    try {
      const response = await request(app)
        .post(TEST_CONFIG.AUTH_ENDPOINT)
        .send({ username: TEST_CONFIG.USERNAME, password: TEST_CONFIG.PASSWORD });
      if (response.status === 200) {
        authToken = response.body.accessToken;
        userId = response.body.userId || 1;
        console.log('✅ Auth token obtained');
      }
    } catch (e) {
      console.warn('⚠️ Could not get auth token');
    }

    // Get test data IDs from database
    try {
      // Get a study
      const studyResult = await pool.query('SELECT study_id FROM study LIMIT 1');
      if (studyResult.rows.length > 0) {
        testStudyId = studyResult.rows[0].study_id;
      }

      // Get a subject
      const subjectResult = await pool.query('SELECT study_subject_id FROM study_subject LIMIT 1');
      if (subjectResult.rows.length > 0) {
        testSubjectId = subjectResult.rows[0].study_subject_id;
      }

      // Get a CRF
      const crfResult = await pool.query('SELECT crf_id FROM crf WHERE status_id = 1 LIMIT 1');
      if (crfResult.rows.length > 0) {
        testCrfId = crfResult.rows[0].crf_id;
      }

      // Get or create an event_crf for testing
      const eventCrfResult = await pool.query(`
        SELECT ec.event_crf_id, ec.study_subject_id
        FROM event_crf ec
        WHERE ec.status_id != 6  -- Not locked
        LIMIT 1
      `);
      if (eventCrfResult.rows.length > 0) {
        testEventCrfId = eventCrfResult.rows[0].event_crf_id;
        testSubjectId = eventCrfResult.rows[0].study_subject_id;
      }

      // Get an item_data record
      if (testEventCrfId) {
        const itemDataResult = await pool.query(`
          SELECT id.item_data_id, id.item_id, id.value, i.name as field_name
          FROM item_data id
          INNER JOIN item i ON id.item_id = i.item_id
          WHERE id.event_crf_id = $1 AND id.deleted = false
          LIMIT 1
        `, [testEventCrfId]);
        if (itemDataResult.rows.length > 0) {
          testItemDataId = itemDataResult.rows[0].item_data_id;
          console.log(`✅ Found item_data for testing: ${testItemDataId} (field: ${itemDataResult.rows[0].field_name})`);
        }
      }

      console.log('Test IDs:', { testStudyId, testSubjectId, testEventCrfId, testItemDataId, testCrfId });
    } catch (e: any) {
      console.warn('⚠️ Could not get test data:', e.message);
    }
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    // Clean up created queries
    for (const id of createdQueryIds) {
      try {
        await pool.query('DELETE FROM dn_item_data_map WHERE discrepancy_note_id = $1', [id]);
        await pool.query('DELETE FROM dn_event_crf_map WHERE discrepancy_note_id = $1', [id]);
        await pool.query('DELETE FROM dn_study_subject_map WHERE discrepancy_note_id = $1', [id]);
        await pool.query('DELETE FROM discrepancy_note WHERE parent_dn_id = $1', [id]);
        await pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = $1', [id]);
      } catch (e) {}
    }
    // Clean up created rules
    for (const id of createdRuleIds) {
      try {
        await pool.query('DELETE FROM validation_rules WHERE validation_rule_id = $1', [id]);
      } catch (e) {}
    }
  });

  // ============================================================================
  // TEST 1: Create query linked to item_data
  // ============================================================================
  describe('Query Creation with item_data Link', () => {
    
    it('creates a query linked to a specific item_data record', async () => {
      if (!databaseConnected || !testItemDataId || !testStudyId) {
        console.warn('⚠️ Skipping - missing test data');
        return;
      }

      console.log('\n📋 TEST: Create query linked to item_data\n');

      // Create a query linked to the item_data
      const result = await queryService.createQuery({
        entityType: 'itemData',
        entityId: testItemDataId,
        studyId: testStudyId,
        studySubjectId: testSubjectId,
        description: 'Test validation query - value needs correction',
        detailedNotes: 'Created by automated test',
        typeId: 1  // Failed Validation Check
      }, userId);

      console.log('Query creation result:', result);

      expect(result.success).toBe(true);
      expect(result.queryId).toBeDefined();
      
      testQueryId = result.queryId!;
      createdQueryIds.push(testQueryId);

      // Verify the query is linked to item_data via dn_item_data_map
      const linkResult = await pool.query(`
        SELECT * FROM dn_item_data_map WHERE discrepancy_note_id = $1
      `, [testQueryId]);

      console.log('dn_item_data_map link:', linkResult.rows);

      expect(linkResult.rows.length).toBe(1);
      expect(linkResult.rows[0].item_data_id).toBe(testItemDataId);

      console.log('✅ Query created and linked to item_data');
    });

    it('getQueryById returns linked item_data info', async () => {
      if (!testQueryId) {
        console.warn('⚠️ Skipping - no test query');
        return;
      }

      console.log('\n📋 TEST: getQueryById returns linkedItemData\n');

      const query = await queryService.getQueryById(testQueryId);
      
      console.log('Query details:', {
        discrepancyNoteId: query?.discrepancy_note_id,
        linkedItemData: query?.linkedItemData,
        canCorrectValue: query?.canCorrectValue
      });

      expect(query).not.toBeNull();
      expect(query.linkedItemData).toBeDefined();
      expect(query.linkedItemData.itemDataId).toBe(testItemDataId);
      expect(query.linkedItemData.currentValue).toBeDefined();
      expect(query.linkedItemData.fieldName).toBeDefined();
      expect(query.canCorrectValue).toBe(true);

      console.log('✅ Query returns linkedItemData with currentValue and fieldName');
    });
  });

  // ============================================================================
  // TEST 2: Query Response with Data Correction
  // ============================================================================
  describe('Query Response with Data Correction', () => {
    
    it('updates item_data when correctedValue is provided', async () => {
      if (!testQueryId || !testItemDataId) {
        console.warn('⚠️ Skipping - no test query or item_data');
        return;
      }

      console.log('\n📋 TEST: Query response with correctedValue updates item_data\n');

      // Get the current value before correction
      const beforeResult = await pool.query(`
        SELECT value FROM item_data WHERE item_data_id = $1
      `, [testItemDataId]);
      const oldValue = beforeResult.rows[0].value;
      console.log('Old value:', oldValue);

      // New corrected value
      const correctedValue = 'CORRECTED_' + Date.now();

      // Submit response with correction
      const result = await queryService.addQueryResponse(testQueryId, {
        description: 'Correcting the data value',
        correctedValue: correctedValue,
        correctionReason: 'Data entry error - corrected per source document',
        newStatusId: 4  // Close the query
      }, userId);

      console.log('Response result:', result);

      expect(result.success).toBe(true);
      expect(result.itemDataUpdated).toBe(true);

      // Verify the item_data was updated
      const afterResult = await pool.query(`
        SELECT value FROM item_data WHERE item_data_id = $1
      `, [testItemDataId]);
      const newValue = afterResult.rows[0].value;
      console.log('New value:', newValue);

      expect(newValue).toBe(correctedValue);

      // Verify audit trail was created
      const auditResult = await pool.query(`
        SELECT * FROM audit_log_event 
        WHERE entity_id = $1 AND audit_table = 'item_data'
        ORDER BY audit_date DESC
        LIMIT 1
      `, [testItemDataId]);

      console.log('Audit entry:', auditResult.rows[0]);

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].old_value).toBe(oldValue);
      expect(auditResult.rows[0].new_value).toBe(correctedValue);

      console.log('✅ item_data updated and audit trail created');

      // Revert the value for other tests
      await pool.query(`
        UPDATE item_data SET value = $1 WHERE item_data_id = $2
      `, [oldValue, testItemDataId]);
    });

    it('fails to update locked records', async () => {
      if (!testEventCrfId || !testQueryId) {
        console.warn('⚠️ Skipping - no test data');
        return;
      }

      console.log('\n📋 TEST: Cannot update locked records\n');

      // Lock the event_crf
      await pool.query(`
        UPDATE event_crf SET status_id = 6 WHERE event_crf_id = $1
      `, [testEventCrfId]);

      try {
        // Create a new query for this test
        const createResult = await queryService.createQuery({
          entityType: 'itemData',
          entityId: testItemDataId,
          studyId: testStudyId,
          description: 'Test locked query',
          typeId: 1
        }, userId);

        if (createResult.success && createResult.queryId) {
          createdQueryIds.push(createResult.queryId);

          // Try to update - should fail
          const result = await queryService.addQueryResponse(createResult.queryId, {
            description: 'Trying to correct locked data',
            correctedValue: 'SHOULD_FAIL',
            correctionReason: 'This should not work'
          }, userId);

          console.log('Locked update result:', result);

          expect(result.success).toBe(false);
          expect(result.message).toContain('locked');
        }
      } finally {
        // Unlock the event_crf
        await pool.query(`
          UPDATE event_crf SET status_id = 1 WHERE event_crf_id = $1
        `, [testEventCrfId]);
      }

      console.log('✅ Locked record protection works');
    });
  });

  // ============================================================================
  // TEST 3: API Endpoint Tests
  // ============================================================================
  describe('API Endpoints', () => {
    
    it('POST /api/queries/:id/respond with correctedValue', async () => {
      if (!authToken || !testItemDataId || !testStudyId) {
        console.warn('⚠️ Skipping - no auth or test data');
        return;
      }

      console.log('\n📋 TEST: API endpoint with correctedValue\n');

      // Create a query for this test
      const createResult = await queryService.createQuery({
        entityType: 'itemData',
        entityId: testItemDataId,
        studyId: testStudyId,
        description: 'API test query',
        typeId: 1
      }, userId);

      if (!createResult.success || !createResult.queryId) {
        console.warn('⚠️ Could not create test query');
        return;
      }

      const queryId = createResult.queryId;
      createdQueryIds.push(queryId);

      // Get original value
      const beforeResult = await pool.query(`
        SELECT value FROM item_data WHERE item_data_id = $1
      `, [testItemDataId]);
      const originalValue = beforeResult.rows[0].value;

      const correctedValue = 'API_CORRECTED_' + Date.now();

      // Call the API endpoint
      const response = await request(app)
        .post(`${TEST_CONFIG.QUERIES_ENDPOINT}/${queryId}/respond`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          response: 'API correction test',
          correctedValue: correctedValue,
          correctionReason: 'Corrected via API test',
          newStatusId: 4
        });

      console.log('API response:', response.status, response.body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.itemDataUpdated).toBe(true);

      // Verify the update
      const afterResult = await pool.query(`
        SELECT value FROM item_data WHERE item_data_id = $1
      `, [testItemDataId]);

      expect(afterResult.rows[0].value).toBe(correctedValue);

      console.log('✅ API endpoint correctly updates item_data');

      // Revert
      await pool.query(`
        UPDATE item_data SET value = $1 WHERE item_data_id = $2
      `, [originalValue, testItemDataId]);
    });

    it('GET /api/queries/:id returns linkedItemData', async () => {
      if (!authToken || !testQueryId) {
        console.warn('⚠️ Skipping - no auth or test query');
        return;
      }

      console.log('\n📋 TEST: GET query returns linkedItemData\n');

      const response = await request(app)
        .get(`${TEST_CONFIG.QUERIES_ENDPOINT}/${testQueryId}`)
        .set('Authorization', `Bearer ${authToken}`);

      console.log('GET query response:', response.status, {
        linkedItemData: response.body.data?.linkedItemData,
        canCorrectValue: response.body.data?.canCorrectValue
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.linkedItemData).toBeDefined();
      expect(response.body.data.canCorrectValue).toBe(true);

      console.log('✅ GET query returns linked item data info');
    });
  });

  // ============================================================================
  // TEST 4: Validation Rule Triggered Query Creation
  // ============================================================================
  describe('Validation Triggered Query Creation', () => {
    
    it('validates form data and creates queries linked to item_data', async () => {
      if (!testEventCrfId || !testCrfId) {
        console.warn('⚠️ Skipping - no test event_crf or crf');
        return;
      }

      console.log('\n📋 TEST: Validation creates queries linked to item_data\n');

      // Create a validation rule
      const ruleResult = await validationRulesService.createRule({
        crfId: testCrfId,
        name: 'Test Range Rule',
        ruleType: 'range',
        fieldPath: 'test_field',
        severity: 'error',
        errorMessage: 'Value must be between 1 and 100',
        minValue: 1,
        maxValue: 100
      }, userId);

      if (ruleResult.success && ruleResult.ruleId) {
        createdRuleIds.push(ruleResult.ruleId);
      }

      // Validate the event_crf (this should find any violations)
      const validationResult = await validationRulesService.validateEventCrf(
        testEventCrfId,
        {
          createQueries: true,
          userId: userId
        }
      );

      console.log('Validation result:', {
        valid: validationResult.valid,
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length,
        queriesCreated: validationResult.queriesCreated
      });

      // Check that any created queries have item_data links
      if (validationResult.queriesCreated && validationResult.queriesCreated > 0) {
        for (const error of validationResult.errors) {
          if (error.queryId) {
            createdQueryIds.push(error.queryId);
            
            // Check the link
            const linkResult = await pool.query(`
              SELECT * FROM dn_item_data_map WHERE discrepancy_note_id = $1
            `, [error.queryId]);

            if (error.itemDataId) {
              expect(linkResult.rows.length).toBe(1);
              console.log(`✅ Query ${error.queryId} linked to item_data ${error.itemDataId}`);
            }
          }
        }
      }

      console.log('✅ Validation creates properly linked queries');
    });
  });
});
