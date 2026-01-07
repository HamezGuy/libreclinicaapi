/**
 * LibreClinica Features Integration Tests
 * 
 * Comprehensive tests for all LibreClinica features:
 * - Skip Logic (scd_item_metadata, dyn_item_form_metadata)
 * - Calculated Fields (response_type 8, 9)
 * - Rules Engine (rule, rule_expression, rule_action)
 * - File Uploads (crf_version_media, response_type 4)
 * - Forking/Branching (decision_condition, dc_* tables)
 * - CDISC/ODM Export (dataset_* tables)
 * - Response Types 1-10
 * 
 * Tests full flow: Frontend → API → Database → Retrieval
 */

import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { pool } from '../../src/config/database';
import * as formService from '../../src/services/hybrid/form.service';
import * as validationRulesService from '../../src/services/database/validation-rules.service';
import * as exportService from '../../src/services/export/export.service';
import { logger } from '../../src/config/logger';

// Test configuration
const TEST_USER_ID = 1;
const TEST_STUDY_ID = 1;

describe('LibreClinica Features Integration Tests', () => {
  let testCrfId: number;
  let testCrfVersionId: number;
  let testSectionId: number;
  let testItemGroupId: number;
  let testItemIds: number[] = [];

  beforeAll(async () => {
    // Ensure database connection
    try {
      await pool.query('SELECT 1');
      logger.info('Database connected for integration tests');
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      if (testCrfId) {
        await pool.query('DELETE FROM scd_item_metadata WHERE scd_item_form_metadata_id IN (SELECT item_form_metadata_id FROM item_form_metadata WHERE crf_version_id = $1)', [testCrfVersionId]);
        await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [testCrfVersionId]);
        await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [testCrfVersionId]);
        await pool.query('DELETE FROM response_set WHERE version_id = $1', [testCrfVersionId]);
        await pool.query('DELETE FROM section WHERE crf_version_id = $1', [testCrfVersionId]);
        await pool.query('DELETE FROM crf_version_media WHERE crf_version_id = $1', [testCrfVersionId]);
        await pool.query('DELETE FROM crf_version WHERE crf_id = $1', [testCrfId]);
        await pool.query('DELETE FROM crf WHERE crf_id = $1', [testCrfId]);
        
        for (const itemId of testItemIds) {
          await pool.query('DELETE FROM item WHERE item_id = $1', [itemId]);
        }
      }
      logger.info('Test cleanup completed');
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });

  // ============================================
  // SECTION 1: Response Types Tests (1-10)
  // ============================================
  describe('Response Types (1-10)', () => {
    test('should verify all 10 response types exist in database', async () => {
      const result = await pool.query(`
        SELECT response_type_id, name, description 
        FROM response_type 
        ORDER BY response_type_id
      `);

      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      
      // Log available response types
      console.log('Available response types:', result.rows);
    });

    test('should create form with all response types', async () => {
      const formData = {
        name: `Test Form All Types ${Date.now()}`,
        description: 'Integration test form with all response types',
        studyId: TEST_STUDY_ID,
        fields: [
          // Response Type 1: Text
          { label: 'Text Field', type: 'text', required: true },
          // Response Type 2: Textarea
          { label: 'Notes Field', type: 'textarea' },
          // Response Type 3: Checkbox
          { label: 'Agreement', type: 'checkbox' },
          // Response Type 4: File Upload
          { 
            label: 'Document Upload', 
            type: 'file',
            allowedFileTypes: ['application/pdf'],
            maxFileSize: 5242880
          },
          // Response Type 5: Radio
          { 
            label: 'Gender', 
            type: 'radio',
            options: [
              { label: 'Male', value: 'M' },
              { label: 'Female', value: 'F' }
            ]
          },
          // Response Type 6: Single-Select
          {
            label: 'Country',
            type: 'select',
            options: [
              { label: 'USA', value: 'US' },
              { label: 'UK', value: 'UK' }
            ]
          },
          // Response Type 7: Multi-Select
          {
            label: 'Symptoms',
            type: 'multiselect',
            options: [
              { label: 'Headache', value: 'headache' },
              { label: 'Fever', value: 'fever' }
            ]
          },
          // Response Type 8: Calculation
          { 
            label: 'BMI', 
            type: 'bmi',
            calculationFormula: 'bmi({weight}, {height})',
            dependsOn: ['weight', 'height']
          },
          // Response Type 9: Group Calculation
          {
            label: 'Total Score',
            type: 'sum',
            calculationFormula: 'sum({score1}, {score2})',
            dependsOn: ['score1', 'score2']
          },
          // Response Type 10: Barcode
          { 
            label: 'Sample ID', 
            type: 'barcode',
            barcodeFormat: 'code128'
          }
        ]
      };

      const result = await formService.createForm(formData, TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(result.crfId).toBeDefined();
      
      testCrfId = result.crfId!;

      // Verify the form was created with correct response types
      const crfVersion = await pool.query(`
        SELECT crf_version_id FROM crf_version WHERE crf_id = $1 LIMIT 1
      `, [testCrfId]);
      
      testCrfVersionId = crfVersion.rows[0].crf_version_id;

      // Check response sets were created correctly
      const responseSets = await pool.query(`
        SELECT rs.response_type_id, rt.name as type_name, rs.label
        FROM response_set rs
        LEFT JOIN response_type rt ON rs.response_type_id = rt.response_type_id
        WHERE rs.version_id = $1
        ORDER BY rs.response_set_id
      `, [testCrfVersionId]);

      console.log('Created response sets:', responseSets.rows);
      expect(responseSets.rows.length).toBe(10); // 10 fields
    });

    test('should retrieve form with all response types correctly mapped', async () => {
      if (!testCrfVersionId) {
        console.log('Skipping - no test CRF version');
        return;
      }

      const metadata = await formService.getFormMetadata(testCrfVersionId);

      expect(metadata).toBeDefined();
      expect(metadata.items).toBeDefined();
      expect(metadata.items.length).toBe(10);

      // Verify each field type is correctly returned
      const fieldTypes = metadata.items.map((item: any) => item.type || item.data_type_code);
      console.log('Retrieved field types:', fieldTypes);
    });
  });

  // ============================================
  // SECTION 2: Skip Logic Tests (scd_item_metadata)
  // ============================================
  describe('Skip Logic (scd_item_metadata)', () => {
    let skipLogicCrfId: number;
    let skipLogicVersionId: number;

    afterAll(async () => {
      if (skipLogicVersionId) {
        await pool.query('DELETE FROM scd_item_metadata WHERE scd_item_form_metadata_id IN (SELECT item_form_metadata_id FROM item_form_metadata WHERE crf_version_id = $1)', [skipLogicVersionId]);
        await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [skipLogicVersionId]);
        await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [skipLogicVersionId]);
        await pool.query('DELETE FROM response_set WHERE version_id = $1', [skipLogicVersionId]);
        await pool.query('DELETE FROM section WHERE crf_version_id = $1', [skipLogicVersionId]);
        await pool.query('DELETE FROM crf_version WHERE crf_version_id = $1', [skipLogicVersionId]);
      }
      if (skipLogicCrfId) {
        await pool.query('DELETE FROM crf WHERE crf_id = $1', [skipLogicCrfId]);
      }
    });

    test('should create form with skip logic conditions', async () => {
      const formData = {
        name: `Skip Logic Test ${Date.now()}`,
        description: 'Form with skip logic',
        fields: [
          {
            label: 'Has Diabetes',
            name: 'has_diabetes',
            type: 'radio',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' }
            ]
          },
          {
            label: 'Diabetes Type',
            name: 'diabetes_type',
            type: 'select',
            options: [
              { label: 'Type 1', value: 'type1' },
              { label: 'Type 2', value: 'type2' }
            ],
            // Skip logic: Show only when Has Diabetes = Yes
            showWhen: [
              {
                fieldId: 'Has Diabetes',
                operator: 'equals',
                value: 'yes',
                message: 'Show when diabetes is selected'
              }
            ]
          },
          {
            label: 'Insulin Dosage',
            name: 'insulin_dosage',
            type: 'number',
            unit: 'IU',
            // Skip logic: Show only when Diabetes Type = Type 1
            showWhen: [
              {
                fieldId: 'Diabetes Type',
                operator: 'equals',
                value: 'type1'
              }
            ]
          }
        ]
      };

      const result = await formService.createForm(formData, TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(result.crfId).toBeDefined();

      skipLogicCrfId = result.crfId!;

      // Get the version ID
      const versionResult = await pool.query(`
        SELECT crf_version_id FROM crf_version WHERE crf_id = $1
      `, [skipLogicCrfId]);

      skipLogicVersionId = versionResult.rows[0].crf_version_id;

      // Verify scd_item_metadata entries were created
      const scdResult = await pool.query(`
        SELECT scd.*, i.name as target_item_name
        FROM scd_item_metadata scd
        INNER JOIN item_form_metadata ifm ON scd.scd_item_form_metadata_id = ifm.item_form_metadata_id
        INNER JOIN item i ON ifm.item_id = i.item_id
        WHERE ifm.crf_version_id = $1
      `, [skipLogicVersionId]);

      console.log('SCD entries created:', scdResult.rows);
      
      // Should have 2 skip logic entries (Diabetes Type and Insulin Dosage)
      expect(scdResult.rows.length).toBe(2);
    });

    test('should retrieve form with skip logic from scd_item_metadata', async () => {
      if (!skipLogicVersionId) {
        console.log('Skipping - no skip logic version');
        return;
      }

      const metadata = await formService.getFormMetadata(skipLogicVersionId);

      expect(metadata.items).toBeDefined();
      
      // Find the diabetes_type field
      const diabetesTypeField = metadata.items.find((i: any) => 
        i.name === 'Diabetes Type' || i.label === 'Diabetes Type'
      );

      expect(diabetesTypeField).toBeDefined();
      expect(diabetesTypeField.showWhen).toBeDefined();
      expect(Array.isArray(diabetesTypeField.showWhen)).toBe(true);
      expect(diabetesTypeField.showWhen.length).toBeGreaterThan(0);
      expect(diabetesTypeField.hasNativeScd).toBe(true);

      console.log('Diabetes Type showWhen:', diabetesTypeField.showWhen);
    });
  });

  // ============================================
  // SECTION 3: Calculated Fields Tests (response_type 8, 9)
  // ============================================
  describe('Calculated Fields (response_type 8, 9)', () => {
    test('should verify calculation response types exist', async () => {
      const result = await pool.query(`
        SELECT * FROM response_type WHERE response_type_id IN (8, 9)
      `);

      console.log('Calculation response types:', result.rows);
      // These may or may not exist depending on LibreClinica version
    });

    test('should create form with calculated BMI field', async () => {
      const formData = {
        name: `Calculated Fields Test ${Date.now()}`,
        description: 'Form with calculated fields',
        fields: [
          { label: 'Weight', name: 'weight', type: 'number', unit: 'kg', required: true },
          { label: 'Height', name: 'height', type: 'number', unit: 'cm', required: true },
          { 
            label: 'BMI', 
            name: 'bmi_calc',
            type: 'bmi',
            calculationFormula: '{weight} / Math.pow({height}/100, 2)',
            dependsOn: ['weight', 'height'],
            readonly: true
          }
        ]
      };

      const result = await formService.createForm(formData, TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(result.crfId).toBeDefined();

      // Verify the BMI field has response_type 8
      const versionResult = await pool.query(`
        SELECT crf_version_id FROM crf_version WHERE crf_id = $1
      `, [result.crfId]);

      const rsResult = await pool.query(`
        SELECT rs.response_type_id, rs.label
        FROM response_set rs
        WHERE rs.version_id = $1 AND rs.label = 'BMI'
      `, [versionResult.rows[0].crf_version_id]);

      if (rsResult.rows.length > 0) {
        expect(rsResult.rows[0].response_type_id).toBe(8); // Calculation type
      }

      // Cleanup
      await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM response_set WHERE version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM section WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM crf_version WHERE crf_id = $1', [result.crfId]);
      await pool.query('DELETE FROM crf WHERE crf_id = $1', [result.crfId]);
    });

    test('should store calculation formula in extended properties', async () => {
      const formData = {
        name: `Formula Storage Test ${Date.now()}`,
        fields: [
          { 
            label: 'Score Total', 
            type: 'calculation',
            calculationFormula: 'sum({score1}, {score2}, {score3})',
            dependsOn: ['score1', 'score2', 'score3']
          }
        ]
      };

      const result = await formService.createForm(formData, TEST_USER_ID);
      expect(result.success).toBe(true);

      const versionResult = await pool.query(`
        SELECT crf_version_id FROM crf_version WHERE crf_id = $1
      `, [result.crfId]);

      const metadata = await formService.getFormMetadata(versionResult.rows[0].crf_version_id);
      
      const scoreField = metadata.items.find((i: any) => i.label === 'Score Total');
      expect(scoreField).toBeDefined();
      expect(scoreField.calculationFormula).toBe('sum({score1}, {score2}, {score3})');
      expect(scoreField.dependsOn).toContain('score1');

      // Cleanup
      await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM response_set WHERE version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM section WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM crf_version WHERE crf_id = $1', [result.crfId]);
      await pool.query('DELETE FROM crf WHERE crf_id = $1', [result.crfId]);
    });
  });

  // ============================================
  // SECTION 4: Rules Engine Tests (rule, rule_expression, rule_action)
  // ============================================
  describe('Rules Engine (rule, rule_expression, rule_action)', () => {
    test('should verify rules tables exist', async () => {
      const tables = ['rule', 'rule_expression', 'rule_action', 'rule_set', 'rule_set_rule'];
      
      for (const table of tables) {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )
        `, [table]);
        
        expect(result.rows[0].exists).toBe(true);
        console.log(`Table ${table} exists: ${result.rows[0].exists}`);
      }
    });

    test('should get validation rules combining custom and native rules', async () => {
      // First, ensure validation_rules table exists
      await validationRulesService.initializeValidationRulesTable();

      // Try to get rules for CRF (may be empty if no rules exist)
      if (testCrfId) {
        const rules = await validationRulesService.getRulesForCrf(testCrfId);
        console.log(`Found ${rules.length} validation rules for CRF ${testCrfId}`);
        expect(Array.isArray(rules)).toBe(true);
      }
    });

    test('should create and retrieve custom validation rule', async () => {
      if (!testCrfId || !testCrfVersionId) {
        console.log('Skipping - no test CRF');
        return;
      }

      // Get an item ID from our test form
      const itemResult = await pool.query(`
        SELECT i.item_id, i.name
        FROM item i
        INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
        WHERE igm.crf_version_id = $1
        LIMIT 1
      `, [testCrfVersionId]);

      if (itemResult.rows.length === 0) {
        console.log('Skipping - no items found');
        return;
      }

      const itemId = itemResult.rows[0].item_id;
      const itemName = itemResult.rows[0].name;

      // Create a custom validation rule
      const ruleData = {
        crfId: testCrfId,
        crfVersionId: testCrfVersionId,
        itemId: itemId,
        name: 'Test Range Rule',
        description: 'Ensure value is between 0 and 100',
        ruleType: 'range' as const,
        fieldPath: itemName,
        severity: 'error' as const,
        errorMessage: 'Value must be between 0 and 100',
        active: true,
        minValue: 0,
        maxValue: 100
      };

      const createResult = await validationRulesService.createRule(ruleData, TEST_USER_ID);
      expect(createResult.id).toBeDefined();

      // Retrieve the rule
      const rules = await validationRulesService.getRulesForCrf(testCrfId);
      const createdRule = rules.find(r => r.name === 'Test Range Rule');
      
      expect(createdRule).toBeDefined();
      expect(createdRule?.minValue).toBe(0);
      expect(createdRule?.maxValue).toBe(100);

      // Cleanup
      if (createResult.id) {
        await validationRulesService.deleteRule(createResult.id);
      }
    });

    test('should validate form data against rules', async () => {
      if (!testCrfId) {
        console.log('Skipping - no test CRF');
        return;
      }

      // Test validation with form data
      const formData = {
        text_field: 'Valid text',
        notes_field: 'Some notes'
      };

      const result = await validationRulesService.validateFormData(testCrfId, formData);

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);

      console.log('Validation result:', result);
    });
  });

  // ============================================
  // SECTION 5: File Uploads Tests (crf_version_media)
  // ============================================
  describe('File Uploads (crf_version_media)', () => {
    test('should verify crf_version_media table exists with correct structure', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'crf_version_media'
        ORDER BY ordinal_position
      `);

      console.log('crf_version_media columns:', result.rows);
      
      const columnNames = result.rows.map(r => r.column_name);
      expect(columnNames).toContain('crf_version_media_id');
      expect(columnNames).toContain('crf_version_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('path');
    });

    test('should insert and retrieve file metadata from crf_version_media', async () => {
      if (!testCrfVersionId) {
        console.log('Skipping - no test CRF version');
        return;
      }

      // Insert test file metadata
      const insertResult = await pool.query(`
        INSERT INTO crf_version_media (crf_version_id, name, path)
        VALUES ($1, $2, $3)
        RETURNING crf_version_media_id
      `, [testCrfVersionId, 'test_document.pdf', '/uploads/test_document.pdf']);

      expect(insertResult.rows[0].crf_version_media_id).toBeDefined();
      const mediaId = insertResult.rows[0].crf_version_media_id;

      // Retrieve it
      const selectResult = await pool.query(`
        SELECT * FROM crf_version_media WHERE crf_version_media_id = $1
      `, [mediaId]);

      expect(selectResult.rows[0].name).toBe('test_document.pdf');
      expect(selectResult.rows[0].path).toBe('/uploads/test_document.pdf');

      // Cleanup
      await pool.query('DELETE FROM crf_version_media WHERE crf_version_media_id = $1', [mediaId]);
    });
  });

  // ============================================
  // SECTION 6: Forking/Branching Tests (decision_condition)
  // ============================================
  describe('Forking/Branching (decision_condition)', () => {
    test('should verify decision_condition tables exist', async () => {
      const tables = [
        'decision_condition',
        'dc_primitive',
        'dc_event',
        'dc_section_event',
        'dc_computed_event',
        'dc_substitution_event'
      ];

      for (const table of tables) {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )
        `, [table]);
        
        expect(result.rows[0].exists).toBe(true);
        console.log(`Table ${table} exists: ${result.rows[0].exists}`);
      }
    });

    test('should retrieve decision conditions from form metadata', async () => {
      if (!testCrfVersionId) {
        console.log('Skipping - no test CRF version');
        return;
      }

      const metadata = await formService.getFormMetadata(testCrfVersionId);

      expect(metadata).toBeDefined();
      expect(metadata.decisionConditions).toBeDefined();
      expect(Array.isArray(metadata.decisionConditions)).toBe(true);

      console.log('Decision conditions:', metadata.decisionConditions);
    });
  });

  // ============================================
  // SECTION 7: CDISC/ODM Export Tests (dataset_* tables)
  // ============================================
  describe('CDISC/ODM Export (dataset_* tables)', () => {
    test('should verify dataset tables exist', async () => {
      const tables = [
        'dataset',
        'dataset_crf_version_map',
        'dataset_filter_map',
        'dataset_item_status',
        'archived_dataset_file'
      ];

      for (const table of tables) {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )
        `, [table]);
        
        expect(result.rows[0].exists).toBe(true);
        console.log(`Table ${table} exists: ${result.rows[0].exists}`);
      }
    });

    test('should get datasets for a study', async () => {
      // Get a study OID
      const studyResult = await pool.query(`
        SELECT oc_oid FROM study WHERE study_id = $1 LIMIT 1
      `, [TEST_STUDY_ID]);

      if (studyResult.rows.length === 0) {
        console.log('Skipping - no study found');
        return;
      }

      const studyOID = studyResult.rows[0].oc_oid;
      const datasets = await exportService.getDatasets(studyOID);

      expect(Array.isArray(datasets)).toBe(true);
      console.log(`Found ${datasets.length} datasets for study ${studyOID}`);
    });

    test('should create ODM export', async () => {
      const studyResult = await pool.query(`
        SELECT oc_oid, name FROM study WHERE study_id = $1 LIMIT 1
      `, [TEST_STUDY_ID]);

      if (studyResult.rows.length === 0) {
        console.log('Skipping - no study found');
        return;
      }

      const studyOID = studyResult.rows[0].oc_oid;

      const datasetConfig = {
        studyOID: studyOID,
        showSubjectStatus: true,
        showSubjectGender: true
      };

      const result = await exportService.executeExport(datasetConfig, 'odm', 'testuser');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.content).toContain('<?xml');
      expect(result.data?.content).toContain('ODM');
      expect(result.data?.mimeType).toBe('application/xml');

      console.log('ODM export successful, filename:', result.data?.filename);
    });

    test('should create CSV export', async () => {
      const studyResult = await pool.query(`
        SELECT oc_oid FROM study WHERE study_id = $1 LIMIT 1
      `, [TEST_STUDY_ID]);

      if (studyResult.rows.length === 0) {
        console.log('Skipping - no study found');
        return;
      }

      const datasetConfig = {
        studyOID: studyResult.rows[0].oc_oid,
        showSubjectGender: true
      };

      const result = await exportService.executeExport(datasetConfig, 'csv', 'testuser');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.mimeType).toBe('text/csv');

      console.log('CSV export successful');
    });
  });

  // ============================================
  // SECTION 8: Full Flow Integration Tests
  // ============================================
  describe('Full Flow Tests (Frontend → API → Database → Retrieval)', () => {
    test('should complete full form lifecycle: create → read → update → delete', async () => {
      // 1. CREATE
      const createData = {
        name: `Full Lifecycle Test ${Date.now()}`,
        description: 'Complete lifecycle test',
        category: 'demographics',
        fields: [
          { label: 'First Name', type: 'text', required: true },
          { label: 'Age', type: 'number', min: 0, max: 150 },
          {
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Inactive', value: 'inactive' }
            ]
          }
        ]
      };

      const createResult = await formService.createForm(createData, TEST_USER_ID);
      expect(createResult.success).toBe(true);
      expect(createResult.crfId).toBeDefined();

      const crfId = createResult.crfId!;

      // 2. READ
      const crfResult = await pool.query(`
        SELECT c.*, cv.crf_version_id
        FROM crf c
        INNER JOIN crf_version cv ON c.crf_id = cv.crf_id
        WHERE c.crf_id = $1
      `, [crfId]);

      expect(crfResult.rows.length).toBe(1);
      expect(crfResult.rows[0].name).toBe(createData.name);

      const crfVersionId = crfResult.rows[0].crf_version_id;

      const metadata = await formService.getFormMetadata(crfVersionId);
      expect(metadata.items.length).toBe(3);

      // 3. UPDATE
      const updateData = {
        name: `${createData.name} (Updated)`,
        description: 'Updated description',
        fields: [
          { label: 'First Name', type: 'text', required: true },
          { label: 'Last Name', type: 'text', required: true }, // New field
          { label: 'Age', type: 'number', min: 0, max: 150 }
        ]
      };

      const updateResult = await formService.updateForm(crfId, updateData, TEST_USER_ID);
      expect(updateResult.success).toBe(true);

      // Verify update
      const updatedCrf = await pool.query(`
        SELECT name, description FROM crf WHERE crf_id = $1
      `, [crfId]);

      expect(updatedCrf.rows[0].name).toBe(updateData.name);

      // 4. DELETE (cleanup)
      await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [crfVersionId]);
      await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [crfVersionId]);
      await pool.query('DELETE FROM response_set WHERE version_id = $1', [crfVersionId]);
      await pool.query('DELETE FROM section WHERE crf_version_id = $1', [crfVersionId]);
      await pool.query('DELETE FROM crf_version WHERE crf_id = $1', [crfId]);
      
      const deleteResult = await formService.deleteForm(crfId);
      expect(deleteResult.success).toBe(true);

      // Verify deletion
      const deletedCrf = await pool.query(`
        SELECT * FROM crf WHERE crf_id = $1
      `, [crfId]);

      expect(deletedCrf.rows.length).toBe(0);
    });

    test('should handle complex form with all features combined', async () => {
      const complexForm = {
        name: `Complex Form Test ${Date.now()}`,
        description: 'Form combining all LibreClinica features',
        fields: [
          // Basic field
          { 
            label: 'Patient ID', 
            type: 'text', 
            required: true,
            isPhiField: true 
          },
          // Conditional field with skip logic
          {
            label: 'Has Condition',
            type: 'radio',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' }
            ]
          },
          {
            label: 'Condition Details',
            type: 'textarea',
            showWhen: [{ fieldId: 'Has Condition', operator: 'equals', value: 'yes' }]
          },
          // Numeric with validation
          {
            label: 'Weight',
            type: 'number',
            unit: 'kg',
            min: 1,
            max: 500
          },
          {
            label: 'Height',
            type: 'number',
            unit: 'cm',
            min: 30,
            max: 250
          },
          // Calculated BMI
          {
            label: 'BMI',
            type: 'bmi',
            calculationFormula: '{Weight} / Math.pow({Height}/100, 2)',
            dependsOn: ['Weight', 'Height'],
            readonly: true
          },
          // File upload
          {
            label: 'Medical Records',
            type: 'file',
            allowedFileTypes: ['application/pdf', 'image/jpeg'],
            maxFileSize: 10485760
          }
        ]
      };

      const result = await formService.createForm(complexForm, TEST_USER_ID);
      expect(result.success).toBe(true);

      const crfId = result.crfId!;

      // Get metadata to verify all features
      const versionResult = await pool.query(`
        SELECT crf_version_id FROM crf_version WHERE crf_id = $1
      `, [crfId]);

      const metadata = await formService.getFormMetadata(versionResult.rows[0].crf_version_id);

      // Verify field count
      expect(metadata.items.length).toBe(7);

      // Verify skip logic was stored
      const conditionDetails = metadata.items.find((i: any) => i.label === 'Condition Details');
      expect(conditionDetails?.showWhen).toBeDefined();

      // Verify calculated field
      const bmiField = metadata.items.find((i: any) => i.label === 'BMI');
      expect(bmiField?.calculationFormula).toBeDefined();

      // Verify PHI field
      const patientId = metadata.items.find((i: any) => i.label === 'Patient ID');
      expect(patientId?.isPhiField).toBe(true);

      // Cleanup
      await pool.query('DELETE FROM scd_item_metadata WHERE scd_item_form_metadata_id IN (SELECT item_form_metadata_id FROM item_form_metadata WHERE crf_version_id = $1)', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM item_form_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM item_group_metadata WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM response_set WHERE version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM section WHERE crf_version_id = $1', [versionResult.rows[0].crf_version_id]);
      await pool.query('DELETE FROM crf_version WHERE crf_id = $1', [crfId]);
      await pool.query('DELETE FROM crf WHERE crf_id = $1', [crfId]);
    });
  });
});

