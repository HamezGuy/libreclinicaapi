/**
 * SOAP Integration Tests
 * 
 * Tests the integration between REST API and LibreClinica SOAP Web Services
 * Verifies that SOAP calls are correctly made and responses are properly handled
 * 
 * REQUIRES: LibreClinica SOAP services running at LIBRECLINICA_SOAP_URL
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('SOAP Integration: API → LibreClinica SOAP Services', () => {
  let authToken: string;

  beforeAll(async () => {
    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'root',
        password: 'root'
      });

    expect(loginResponse.status).toBe(200);
    authToken = loginResponse.body.accessToken;
  });

  afterAll(async () => {
    // Don't disconnect - handled by global teardown
  });

  // ==========================================================================
  // SOAP AUTHENTICATION TESTS
  // ==========================================================================

  describe('SOAP Authentication', () => {
    it('should authenticate via SOAP when user logs in through API', async () => {
      const loginData = {
        username: 'root',
        password: 'root'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.user).toBeDefined();
      
      // The API should have validated credentials via SOAP
      expect(response.body.user.username).toBe(loginData.username);
    });

    it('should reject invalid SOAP credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'invalid_user',
          password: 'wrong_password'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
    });
  });

  // ==========================================================================
  // SOAP STUDY OPERATIONS
  // ==========================================================================

  describe('SOAP Study Operations', () => {
    it('should fetch studies via SOAP and return via API', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.studies)).toBe(true);
      
      // Verify study structure (should come from SOAP)
      if (response.body.studies.length > 0) {
        const study = response.body.studies[0];
        expect(study).toHaveProperty('studyId');
        expect(study).toHaveProperty('identifier');
        expect(study).toHaveProperty('name');
      }
    });

    it('should create study via SOAP when requested through API', async () => {
      const studyData = {
        uniqueIdentifier: `SOAP-TEST-${Date.now()}`,
        name: 'SOAP Integration Test Study',
        description: 'Testing SOAP integration',
        principalInvestigator: 'Dr. SOAP Test'
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.studyId).toBeDefined();

      // Verify study was created in database (via SOAP)
      const dbResult = await testDb.query(
        'SELECT * FROM study WHERE unique_identifier = $1',
        [studyData.uniqueIdentifier]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(studyData.name);
    });

    it('should get study metadata via SOAP', async () => {
      // First create a study
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `METADATA-TEST-${Date.now()}`,
          name: 'Metadata Test Study',
          description: 'Testing metadata retrieval'
        });

      const studyId = createResponse.body.studyId;

      // Get metadata via SOAP
      const metadataResponse = await request(app)
        .get(`/api/studies/${studyId}/metadata`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(metadataResponse.body.success).toBe(true);
      expect(metadataResponse.body.metadata).toBeDefined();
      
      // Metadata should include ODM structure from SOAP
      expect(metadataResponse.body.metadata).toHaveProperty('studyOID');
    });
  });

  // ==========================================================================
  // SOAP SUBJECT OPERATIONS
  // ==========================================================================

  describe('SOAP Subject Operations', () => {
    let testStudyId: number;

    beforeAll(async () => {
      // Create a study for subject tests
      const studyResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `SUBJECT-SOAP-${Date.now()}`,
          name: 'Subject SOAP Test Study',
          description: 'Testing subject operations via SOAP'
        });

      testStudyId = studyResponse.body.studyId;
    });

    it('should create subject via SOAP when requested through API', async () => {
      const subjectData = {
        studyId: testStudyId,
        label: `SOAP-SUBJ-${Date.now()}`,
        enrollmentDate: new Date().toISOString(),
        gender: 'M'
      };

      const response = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subjectData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.subjectId).toBeDefined();

      // Verify subject in database (created via SOAP)
      const dbResult = await testDb.query(
        'SELECT * FROM study_subject WHERE study_subject_id = $1',
        [response.body.subjectId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].label).toBe(subjectData.label);
    });

    it('should fetch subjects for study via SOAP', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}/subjects`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.subjects)).toBe(true);
    });
  });

  // ==========================================================================
  // SOAP EVENT/FORM OPERATIONS
  // ==========================================================================

  describe('SOAP Event and Form Operations', () => {
    it('should fetch study events via SOAP', async () => {
      // Create a study first
      const studyResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `EVENT-SOAP-${Date.now()}`,
          name: 'Event SOAP Test Study',
          description: 'Testing event operations'
        });

      const studyId = studyResponse.body.studyId;

      // Get events via SOAP
      const eventsResponse = await request(app)
        .get(`/api/studies/${studyId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(eventsResponse.body.success).toBe(true);
      expect(Array.isArray(eventsResponse.body.events)).toBe(true);
    });

    it('should submit form data via SOAP', async () => {
      const formData = {
        studyOid: 'TEST_STUDY',
        subjectKey: 'SS_001',
        eventOid: 'SE_SCREENING',
        formOid: 'F_DEMOGRAPHICS',
        itemGroupData: [
          {
            itemGroupOid: 'IG_DEMO',
            items: [
              { itemOid: 'I_AGE', value: '35' },
              { itemOid: 'I_GENDER', value: 'M' }
            ]
          }
        ]
      };

      const response = await request(app)
        .post('/api/forms/data')
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData)
        .expect(201);

      expect(response.body.success).toBe(true);
      
      // Verify audit trail for form submission
      const auditResult = await testDb.query(
        `SELECT * FROM audit_log_event 
         WHERE audit_table = 'item_data' 
         ORDER BY audit_date DESC LIMIT 1`
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // SOAP ERROR HANDLING
  // ==========================================================================

  describe('SOAP Error Handling', () => {
    it('should handle SOAP connection errors gracefully', async () => {
      // This test assumes SOAP service might be unavailable
      // The API should return a proper error instead of crashing
      
      const response = await request(app)
        .get('/api/soap/health')
        .set('Authorization', `Bearer ${authToken}`);

      // Should return either success or a proper error
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
      expect(response.body).toHaveProperty('success');
    });

    it('should handle invalid SOAP requests', async () => {
      const response = await request(app)
        .get('/api/studies/999999/metadata') // Non-existent study
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
    });
  });

  // ==========================================================================
  // SOAP DATA SYNCHRONIZATION
  // ==========================================================================

  describe('SOAP Data Synchronization', () => {
    it('should sync data between REST API and SOAP service', async () => {
      // Create data via REST API
      const studyData = {
        uniqueIdentifier: `SYNC-TEST-${Date.now()}`,
        name: 'Sync Test Study',
        description: 'Testing data synchronization'
      };

      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData)
        .expect(201);

      const studyId = createResponse.body.studyId;

      // Fetch via SOAP (should be synchronized)
      const fetchResponse = await request(app)
        .get(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(fetchResponse.body.success).toBe(true);
      expect(fetchResponse.body.study.identifier).toBe(studyData.uniqueIdentifier);
      expect(fetchResponse.body.study.name).toBe(studyData.name);
    });

    it('should maintain data consistency across SOAP operations', async () => {
      // Create study
      const studyResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `CONSISTENCY-${Date.now()}`,
          name: 'Consistency Test',
          description: 'Testing data consistency'
        });

      const studyId = studyResponse.body.studyId;

      // Create subject
      const subjectResponse = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          studyId: studyId,
          label: `SUBJ-CONSISTENCY-${Date.now()}`,
          enrollmentDate: new Date().toISOString()
        });

      const subjectId = subjectResponse.body.subjectId;

      // Verify both exist in database
      const studyCheck = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [studyId]
      );

      const subjectCheck = await testDb.query(
        'SELECT * FROM study_subject WHERE study_subject_id = $1',
        [subjectId]
      );

      expect(studyCheck.rows.length).toBe(1);
      expect(subjectCheck.rows.length).toBe(1);
      expect(subjectCheck.rows[0].study_id).toBe(studyId);
    });
  });
});
