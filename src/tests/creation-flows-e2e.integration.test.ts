/**
 * Creation Flows End-to-End Integration Tests
 * 
 * COMPREHENSIVE TESTING: Frontend → API → Database → Response → Retrieval
 * 
 * This test suite verifies the COMPLETE creation flow for:
 * 1. Studies - from frontend payload to database to retrieval
 * 2. Patients/Subjects - from enrollment modal to database to patient list
 * 3. Form Templates (CRFs) - from template builder to database to form display
 * 
 * CRITICAL: These tests verify the EXACT flow that the Angular frontend uses,
 * ensuring full compatibility between frontend and backend.
 * 
 * PREREQUISITES:
 * - LibreClinica Docker containers running (docker-compose.libreclinica.yml)
 * - API server running on port 3001
 * - Database accessible on port 5434
 * 
 * RUN: npm run test:e2e -- --testPathPattern="creation-flows"
 */

import request from 'supertest';
import { pool } from '../config/database';
import app from '../app';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  API_BASE: '/api',
  TIMEOUT_MS: 30000,
  
  // Default test credentials
  USERNAME: 'root',
  PASSWORD: '12345678',
  
  // Generated IDs for cleanup
  testIds: {
    studies: [] as number[],
    subjects: [] as number[],
    forms: [] as number[]
  }
};

// ============================================================================
// TEST HELPERS
// ============================================================================

let authToken: string = '';

async function authenticate(): Promise<string> {
  if (authToken) return authToken;
  
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      username: TEST_CONFIG.USERNAME,
      password: TEST_CONFIG.PASSWORD
    })
    .set('Content-Type', 'application/json')
    .timeout(TEST_CONFIG.TIMEOUT_MS);

  if (response.status === 200 && response.body.accessToken) {
    authToken = response.body.accessToken;
    return authToken;
  }
  
  throw new Error(`Authentication failed: ${JSON.stringify(response.body)}`);
}

function generateUniqueId(prefix: string): string {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
}

// ============================================================================
// STUDY CREATION TESTS
// ============================================================================

describe('Study Creation E2E Flow', () => {
  beforeAll(async () => {
    await authenticate();
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    // Cleanup: Mark test studies as deleted
    for (const studyId of TEST_CONFIG.testIds.studies) {
      try {
        await pool.query(`UPDATE study SET status_id = 5 WHERE study_id = $1`, [studyId]);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('POST /api/studies - Create Study', () => {
    it('should create study with minimal required fields', async () => {
      const uniqueId = generateUniqueId('TEST');
      
      // Exact payload format from study-creation-modal.component.ts
      const studyPayload = {
        name: `Test Study ${uniqueId}`,
        uniqueIdentifier: uniqueId
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(studyPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.studyId).toBeDefined();

      const studyId = response.body.studyId;
      TEST_CONFIG.testIds.studies.push(studyId);

      // Verify in database
      const dbCheck = await pool.query(
        `SELECT * FROM study WHERE study_id = $1`,
        [studyId]
      );

      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].name).toBe(studyPayload.name);
      expect(dbCheck.rows[0].unique_identifier).toBe(studyPayload.uniqueIdentifier);
      expect(dbCheck.rows[0].oc_oid).toBeDefined();
    });

    it('should create study with ALL fields from frontend', async () => {
      const uniqueId = generateUniqueId('FULL');
      
      // Complete payload matching study-creation-modal.component.ts onSubmit()
      const studyPayload = {
        // Basic Info (Tab 1)
        name: `Full Test Study ${uniqueId}`,
        uniqueIdentifier: uniqueId,
        officialTitle: 'Official Title for Testing',
        secondaryIdentifier: `SECONDARY_${uniqueId}`,
        summary: 'This is a test study summary',
        principalInvestigator: 'Dr. Test User',
        sponsor: 'Test Sponsor Inc.',
        collaborators: 'Partner A, Partner B',
        phase: 'II',
        protocolType: 'interventional',
        expectedTotalEnrollment: 100,
        datePlannedStart: '2025-01-01',
        datePlannedEnd: '2025-12-31',
        
        // Facility (Tab 2)
        facilityName: 'Test Medical Center',
        facilityCity: 'Boston',
        facilityState: 'MA',
        facilityZip: '02115',
        facilityCountry: 'USA',
        facilityContactName: 'Jane Coordinator',
        facilityContactEmail: 'jane@test.com',
        facilityContactPhone: '617-555-1234',
        
        // Protocol (Tab 3)
        protocolDescription: 'Detailed protocol description',
        conditions: 'Diabetes Type 2',
        keywords: 'diabetes, insulin, glucose',
        
        // Eligibility (Tab 4)
        eligibility: 'Adults 18-65 with Type 2 Diabetes',
        gender: 'Both',
        ageMin: '18',
        ageMax: '65',
        healthyVolunteerAccepted: false,
        
        // Study Design (Tab 5)
        purpose: 'Treatment',
        allocation: 'Randomized',
        masking: 'Double-Blind',
        control: 'Placebo',
        assignment: 'Parallel',
        endpoint: 'Efficacy'
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(studyPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.studyId).toBeDefined();

      const studyId = response.body.studyId;
      TEST_CONFIG.testIds.studies.push(studyId);

      // Verify ALL fields in database
      const dbCheck = await pool.query(
        `SELECT * FROM study WHERE study_id = $1`,
        [studyId]
      );

      expect(dbCheck.rows.length).toBe(1);
      const study = dbCheck.rows[0];
      
      expect(study.name).toBe(studyPayload.name);
      expect(study.unique_identifier).toBe(studyPayload.uniqueIdentifier);
      expect(study.official_title).toBe(studyPayload.officialTitle);
      expect(study.principal_investigator).toBe(studyPayload.principalInvestigator);
      expect(study.sponsor).toBe(studyPayload.sponsor);
      expect(study.phase).toBe(studyPayload.phase);
      expect(study.expected_total_enrollment).toBe(studyPayload.expectedTotalEnrollment);
      expect(study.facility_name).toBe(studyPayload.facilityName);
      expect(study.facility_city).toBe(studyPayload.facilityCity);
      expect(study.conditions).toBe(studyPayload.conditions);
      expect(study.eligibility).toBe(studyPayload.eligibility);
      expect(study.purpose).toBe(studyPayload.purpose);
      expect(study.allocation).toBe(studyPayload.allocation);
      expect(study.masking).toBe(studyPayload.masking);
    });

    it('should create study with event definitions (phases)', async () => {
      const uniqueId = generateUniqueId('EVNT');
      
      const studyPayload = {
        name: `Study With Events ${uniqueId}`,
        uniqueIdentifier: uniqueId,
        eventDefinitions: [
          { name: 'Screening', type: 'scheduled', ordinal: 1 },
          { name: 'Baseline', type: 'scheduled', ordinal: 2 },
          { name: 'Week 4', type: 'scheduled', ordinal: 3 },
          { name: 'Week 8', type: 'scheduled', ordinal: 4 },
          { name: 'Final Visit', type: 'scheduled', ordinal: 5 }
        ]
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(studyPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const studyId = response.body.studyId;
      TEST_CONFIG.testIds.studies.push(studyId);

      // Verify events were created
      const eventsCheck = await pool.query(
        `SELECT * FROM study_event_definition WHERE study_id = $1 ORDER BY ordinal`,
        [studyId]
      );

      expect(eventsCheck.rows.length).toBe(5);
      expect(eventsCheck.rows[0].name).toBe('Screening');
      expect(eventsCheck.rows[4].name).toBe('Final Visit');
    });

    it('should retrieve created study with GET /api/studies/:id', async () => {
      // First create a study
      const uniqueId = generateUniqueId('RETR');
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `Retrieve Test ${uniqueId}`,
          uniqueIdentifier: uniqueId,
          principalInvestigator: 'Dr. Retrieve'
        })
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(createResponse.status).toBe(201);
      const studyId = createResponse.body.studyId;
      TEST_CONFIG.testIds.studies.push(studyId);

      // Now retrieve it
      const getResponse = await request(app)
        .get(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data).toBeDefined();
      expect(getResponse.body.data.name).toBe(`Retrieve Test ${uniqueId}`);
    });

    it('should list created study in GET /api/studies', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });

    it('should reject duplicate study identifier', async () => {
      const uniqueId = generateUniqueId('DUP');
      
      // Create first study
      const first = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `Duplicate Test 1`,
          uniqueIdentifier: uniqueId
        })
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(first.status).toBe(201);
      TEST_CONFIG.testIds.studies.push(first.body.studyId);

      // Try to create with same identifier
      const duplicate = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `Duplicate Test 2`,
          uniqueIdentifier: uniqueId // Same identifier
        })
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(duplicate.status).toBe(400);
      expect(duplicate.body.success).toBe(false);
      expect(duplicate.body.message).toContain('already exists');
    });
  });
});

// ============================================================================
// PATIENT/SUBJECT CREATION TESTS
// ============================================================================

describe('Patient/Subject Creation E2E Flow', () => {
  let testStudyId: number;

  beforeAll(async () => {
    await authenticate();
    
    // Create a test study for patient enrollment
    const uniqueId = generateUniqueId('PTSTUDY');
    const response = await request(app)
      .post('/api/studies')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `Patient Test Study ${uniqueId}`,
        uniqueIdentifier: uniqueId
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    testStudyId = response.body.studyId;
    TEST_CONFIG.testIds.studies.push(testStudyId);
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    // Cleanup subjects
    for (const subjectId of TEST_CONFIG.testIds.subjects) {
      try {
        await pool.query(`UPDATE study_subject SET status_id = 5 WHERE study_subject_id = $1`, [subjectId]);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('POST /api/subjects - Create Subject', () => {
    it('should create subject with minimal required fields', async () => {
      const subjectId = generateUniqueId('SUB').substring(0, 25);
      
      // Exact payload format from patient-enrollment-modal.component.ts
      const subjectPayload = {
        studyId: testStudyId,
        studySubjectId: subjectId,
        enrollmentDate: new Date().toISOString().split('T')[0]
      };

      const response = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(subjectPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      
      // Should return studySubjectId from database
      if (response.body.studySubjectId) {
        TEST_CONFIG.testIds.subjects.push(response.body.studySubjectId);
      }

      // Verify in database
      const dbCheck = await pool.query(
        `SELECT * FROM study_subject WHERE label = $1 AND study_id = $2`,
        [subjectId, testStudyId]
      );

      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].label).toBe(subjectId);
      expect(dbCheck.rows[0].study_id).toBe(testStudyId);
    });

    it('should create subject with ALL fields from frontend', async () => {
      const subjectLabel = generateUniqueId('FULL').substring(0, 25);
      const today = new Date().toISOString().split('T')[0];
      
      // Complete payload matching patient-enrollment-modal.component.ts onSubmit()
      const subjectPayload = {
        studyId: testStudyId,
        studySubjectId: subjectLabel,
        enrollmentDate: today,
        secondaryId: `MRN_${subjectLabel.substring(0, 15)}`,
        gender: 'm',
        dateOfBirth: '1985-03-15',
        personId: `PERSON_${subjectLabel}`,
        timeZone: 'America/New_York'
      };

      const response = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(subjectPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      if (response.body.studySubjectId) {
        TEST_CONFIG.testIds.subjects.push(response.body.studySubjectId);
      }

      // Verify study_subject table
      const ssCheck = await pool.query(
        `SELECT ss.*, s.* 
         FROM study_subject ss
         JOIN subject s ON ss.subject_id = s.subject_id
         WHERE ss.label = $1 AND ss.study_id = $2`,
        [subjectLabel, testStudyId]
      );

      expect(ssCheck.rows.length).toBe(1);
      const record = ssCheck.rows[0];
      
      expect(record.label).toBe(subjectLabel);
      expect(record.secondary_label).toBe(subjectPayload.secondaryId);
      expect(record.gender).toBe('m');
      expect(record.time_zone).toBe('America/New_York');
    });

    it('should retrieve created subject with GET /api/subjects?studyId=', async () => {
      const response = await request(app)
        .get(`/api/subjects?studyId=${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should get enrollment config for study', async () => {
      const response = await request(app)
        .get(`/api/subjects/enrollment-config/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.formConfig).toBeDefined();
    });
  });
});

// ============================================================================
// FORM TEMPLATE (CRF) CREATION TESTS
// ============================================================================

describe('Form Template Creation E2E Flow', () => {
  beforeAll(async () => {
    await authenticate();
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    // Cleanup forms
    for (const crfId of TEST_CONFIG.testIds.forms) {
      try {
        await pool.query(`UPDATE crf SET status_id = 5 WHERE crf_id = $1`, [crfId]);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('POST /api/forms - Create Form Template', () => {
    it('should create form template with minimal fields', async () => {
      const formName = `Test Form ${generateUniqueId('FORM')}`;
      
      const formPayload = {
        name: formName,
        description: 'Test form description'
      };

      const response = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(formPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.crfId).toBeDefined();

      const crfId = response.body.crfId;
      TEST_CONFIG.testIds.forms.push(crfId);

      // Verify CRF in database
      const crfCheck = await pool.query(
        `SELECT * FROM crf WHERE crf_id = $1`,
        [crfId]
      );

      expect(crfCheck.rows.length).toBe(1);
      expect(crfCheck.rows[0].name).toBe(formName);
      expect(crfCheck.rows[0].oc_oid).toBeDefined();

      // Verify CRF version was created
      const versionCheck = await pool.query(
        `SELECT * FROM crf_version WHERE crf_id = $1`,
        [crfId]
      );

      expect(versionCheck.rows.length).toBe(1);
    });

    it('should create form template with fields matching frontend', async () => {
      const formName = `Form With Fields ${generateUniqueId('FWF')}`;
      
      // Exact payload format from template-creation-modal.component.ts
      const formPayload = {
        name: formName,
        description: 'Form with various field types',
        category: 'vitals',
        version: '1.0',
        fields: [
          {
            name: 'patient_name',
            label: 'Patient Name',
            type: 'text',
            required: true,
            helpText: 'Enter full legal name',
            isPhiField: true
          },
          {
            name: 'date_of_birth',
            label: 'Date of Birth',
            type: 'date',
            required: true,
            isPhiField: true
          },
          {
            name: 'weight',
            label: 'Weight',
            type: 'number',
            required: false,
            unit: 'kg',
            min: 0,
            max: 500,
            helpText: 'Patient weight in kilograms'
          },
          {
            name: 'height',
            label: 'Height',
            type: 'number',
            required: false,
            unit: 'cm',
            min: 0,
            max: 300
          },
          {
            name: 'bmi',
            label: 'BMI',
            type: 'calculation',
            calculationFormula: 'bmi({weight}, {height})',
            dependsOn: ['weight', 'height'],
            unit: 'kg/m²'
          },
          {
            name: 'gender',
            label: 'Gender',
            type: 'radio',
            required: true,
            options: [
              { label: 'Male', value: 'm' },
              { label: 'Female', value: 'f' },
              { label: 'Other', value: 'o' }
            ]
          },
          {
            name: 'blood_type',
            label: 'Blood Type',
            type: 'select',
            required: false,
            options: [
              { label: 'A+', value: 'A+' },
              { label: 'A-', value: 'A-' },
              { label: 'B+', value: 'B+' },
              { label: 'B-', value: 'B-' },
              { label: 'AB+', value: 'AB+' },
              { label: 'AB-', value: 'AB-' },
              { label: 'O+', value: 'O+' },
              { label: 'O-', value: 'O-' }
            ]
          },
          {
            name: 'notes',
            label: 'Clinical Notes',
            type: 'textarea',
            required: false,
            helpText: 'Additional observations'
          },
          {
            name: 'consent_signed',
            label: 'Consent Signed',
            type: 'checkbox',
            required: true
          },
          {
            name: 'document',
            label: 'Supporting Document',
            type: 'file',
            required: false,
            allowedFileTypes: ['pdf', 'doc', 'docx'],
            maxFileSize: 10485760
          }
        ]
      };

      const response = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(formPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.crfId).toBeDefined();

      const crfId = response.body.crfId;
      TEST_CONFIG.testIds.forms.push(crfId);

      // Get CRF version
      const versionCheck = await pool.query(
        `SELECT crf_version_id FROM crf_version WHERE crf_id = $1`,
        [crfId]
      );
      const versionId = versionCheck.rows[0].crf_version_id;

      // Verify items were created
      const itemsCheck = await pool.query(
        `SELECT i.*, igm.ordinal
         FROM item i
         JOIN item_group_metadata igm ON i.item_id = igm.item_id
         WHERE igm.crf_version_id = $1
         ORDER BY igm.ordinal`,
        [versionId]
      );

      expect(itemsCheck.rows.length).toBe(formPayload.fields.length);
      expect(itemsCheck.rows[0].name).toBe('patient_name');
    });

    it('should create form with conditional logic (skip logic)', async () => {
      const formName = `Skip Logic Form ${generateUniqueId('SKIP')}`;
      
      const formPayload = {
        name: formName,
        description: 'Form with conditional display logic',
        fields: [
          {
            name: 'has_allergies',
            label: 'Does patient have allergies?',
            type: 'yesno',
            required: true
          },
          {
            name: 'allergy_details',
            label: 'Please describe allergies',
            type: 'textarea',
            required: false,
            showWhen: [
              {
                fieldId: 'has_allergies',
                operator: 'equals',
                value: 'yes'
              }
            ]
          },
          {
            name: 'age',
            label: 'Patient Age',
            type: 'number',
            required: true,
            min: 0,
            max: 120
          },
          {
            name: 'pediatric_notes',
            label: 'Pediatric Specific Notes',
            type: 'textarea',
            required: false,
            showWhen: [
              {
                fieldId: 'age',
                operator: 'less_than',
                value: 18
              }
            ]
          }
        ]
      };

      const response = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(formPayload)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const crfId = response.body.crfId;
      TEST_CONFIG.testIds.forms.push(crfId);
    });

    it('should retrieve form with GET /api/forms/:id', async () => {
      // Create a form first
      const formName = `Retrieve Test ${generateUniqueId('RET')}`;
      const createResponse = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({
          name: formName,
          description: 'Form for retrieval test',
          fields: [
            { name: 'test_field', label: 'Test Field', type: 'text' }
          ]
        })
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(createResponse.status).toBe(201);
      const crfId = createResponse.body.crfId;
      TEST_CONFIG.testIds.forms.push(crfId);

      // Now retrieve it
      const getResponse = await request(app)
        .get(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data).toBeDefined();
    });

    it('should get form metadata with fields', async () => {
      // Create a form
      const formName = `Metadata Test ${generateUniqueId('META')}`;
      const createResponse = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send({
          name: formName,
          description: 'Form for metadata test',
          fields: [
            { name: 'field1', label: 'Field 1', type: 'text', required: true },
            { name: 'field2', label: 'Field 2', type: 'number', unit: 'kg' }
          ]
        })
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(createResponse.status).toBe(201);
      const crfId = createResponse.body.crfId;
      TEST_CONFIG.testIds.forms.push(crfId);

      // Get metadata
      const metadataResponse = await request(app)
        .get(`/api/forms/${crfId}/metadata`)
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(metadataResponse.status).toBe(200);
      expect(metadataResponse.body.success).toBe(true);
      expect(metadataResponse.body.data).toBeDefined();
      expect(metadataResponse.body.data.crf).toBeDefined();
      expect(metadataResponse.body.data.items).toBeDefined();
      expect(metadataResponse.body.data.items.length).toBe(2);
    });

    it('should list all forms with GET /api/forms', async () => {
      const response = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .timeout(TEST_CONFIG.TIMEOUT_MS);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});

// ============================================================================
// FULL WORKFLOW TESTS - Frontend to Database to Retrieval
// ============================================================================

describe('Complete Workflow Integration', () => {
  let workflowStudyId: number;
  let workflowFormId: number;
  let workflowSubjectId: number;

  beforeAll(async () => {
    await authenticate();
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    // Cleanup in reverse order of dependency
    if (workflowSubjectId) {
      await pool.query(`UPDATE study_subject SET status_id = 5 WHERE study_subject_id = $1`, [workflowSubjectId]).catch(() => {});
    }
    if (workflowFormId) {
      await pool.query(`UPDATE crf SET status_id = 5 WHERE crf_id = $1`, [workflowFormId]).catch(() => {});
    }
    if (workflowStudyId) {
      await pool.query(`UPDATE study SET status_id = 5 WHERE study_id = $1`, [workflowStudyId]).catch(() => {});
    }
  });

  it('should complete full workflow: Create Study → Create Form → Enroll Patient → Verify', async () => {
    const workflowId = generateUniqueId('WF');

    // Step 1: Create Study
    console.log('🔵 Step 1: Creating study...');
    const studyResponse = await request(app)
      .post('/api/studies')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `Workflow Study ${workflowId}`,
        uniqueIdentifier: workflowId,
        principalInvestigator: 'Dr. Workflow',
        phase: 'II',
        expectedTotalEnrollment: 50,
        eventDefinitions: [
          { name: 'Screening', ordinal: 1 },
          { name: 'Treatment', ordinal: 2 },
          { name: 'Follow-up', ordinal: 3 }
        ]
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(studyResponse.status).toBe(201);
    workflowStudyId = studyResponse.body.studyId;
    console.log(`✅ Study created with ID: ${workflowStudyId}`);

    // Step 2: Create Form Template
    console.log('🔵 Step 2: Creating form template...');
    const formResponse = await request(app)
      .post('/api/forms')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `Vitals Form ${workflowId}`,
        description: 'Capture vital signs',
        studyId: workflowStudyId,
        fields: [
          { name: 'blood_pressure_sys', label: 'Systolic BP', type: 'number', required: true, unit: 'mmHg', min: 50, max: 250 },
          { name: 'blood_pressure_dia', label: 'Diastolic BP', type: 'number', required: true, unit: 'mmHg', min: 30, max: 150 },
          { name: 'heart_rate', label: 'Heart Rate', type: 'number', required: true, unit: 'bpm', min: 30, max: 200 },
          { name: 'temperature', label: 'Temperature', type: 'number', required: false, unit: '°C', min: 35, max: 42 },
          { name: 'weight', label: 'Weight', type: 'number', required: true, unit: 'kg' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false }
        ]
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(formResponse.status).toBe(201);
    workflowFormId = formResponse.body.crfId;
    console.log(`✅ Form created with ID: ${workflowFormId}`);

    // Step 3: Enroll Patient
    console.log('🔵 Step 3: Enrolling patient...');
    const subjectLabel = `WF_PT_${workflowId}`.substring(0, 25);
    const subjectResponse = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        studyId: workflowStudyId,
        studySubjectId: subjectLabel,
        enrollmentDate: new Date().toISOString().split('T')[0],
        gender: 'f',
        dateOfBirth: '1990-05-20'
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(subjectResponse.status).toBe(201);
    if (subjectResponse.body.studySubjectId) {
      workflowSubjectId = subjectResponse.body.studySubjectId;
    }
    console.log(`✅ Patient enrolled`);

    // Step 4: Verify Everything
    console.log('🔵 Step 4: Verifying all entities...');

    // Verify study
    const studyCheck = await request(app)
      .get(`/api/studies/${workflowStudyId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .timeout(TEST_CONFIG.TIMEOUT_MS);
    expect(studyCheck.status).toBe(200);
    expect(studyCheck.body.data.name).toContain('Workflow Study');

    // Verify form
    const formCheck = await request(app)
      .get(`/api/forms/${workflowFormId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .timeout(TEST_CONFIG.TIMEOUT_MS);
    expect(formCheck.status).toBe(200);
    expect(formCheck.body.data.name).toContain('Vitals Form');

    // Verify patient in study
    const patientsCheck = await request(app)
      .get(`/api/subjects?studyId=${workflowStudyId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .timeout(TEST_CONFIG.TIMEOUT_MS);
    expect(patientsCheck.status).toBe(200);
    expect(patientsCheck.body.data.length).toBeGreaterThan(0);

    // Verify events were created
    const eventsCheck = await pool.query(
      `SELECT COUNT(*) as count FROM study_event_definition WHERE study_id = $1`,
      [workflowStudyId]
    );
    expect(parseInt(eventsCheck.rows[0].count)).toBe(3);

    console.log('✅ Full workflow completed and verified!');
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  beforeAll(async () => {
    await authenticate();
  }, TEST_CONFIG.TIMEOUT_MS);

  it('should return 400 for missing required study fields', async () => {
    const response = await request(app)
      .post('/api/studies')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        // Missing name and uniqueIdentifier
        principalInvestigator: 'Dr. Missing Fields'
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(response.status).toBe(400);
  });

  it('should return 400 for missing required subject fields', async () => {
    const response = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'application/json')
      .send({
        // Missing studyId and studySubjectId
        gender: 'm'
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(response.status).toBe(400);
  });

  it('should return 401 for unauthenticated requests', async () => {
    const response = await request(app)
      .get('/api/studies')
      // No Authorization header
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(response.status).toBe(401);
  });

  it('should return 404 for non-existent study', async () => {
    const response = await request(app)
      .get('/api/studies/999999')
      .set('Authorization', `Bearer ${authToken}`)
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(response.status).toBe(404);
  });

  it('should return 404 for non-existent form', async () => {
    const response = await request(app)
      .get('/api/forms/999999')
      .set('Authorization', `Bearer ${authToken}`)
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    expect(response.status).toBe(404);
  });
});

