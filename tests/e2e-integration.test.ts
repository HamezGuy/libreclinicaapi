/**
 * End-to-End Integration Tests
 * 
 * Tests the complete flow:
 * Angular UI (ElectronicDataCaptureReal) → REST API → LibreClinica Database
 * 
 * Verifies that UI changes are correctly reflected in the database
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('E2E Integration: Angular UI → API → Database', () => {
  let authToken: string;
  let testUserId: number;
  let testStudyId: number;
  let testSubjectId: number;

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

  beforeEach(async () => {
    // Clean database before each test
    await testDb.cleanTables(['study_subject', 'study_user_role', 'study', 'audit_log_event']);
    await testDb.seedTestData();
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  // ==========================================================================
  // USER MANAGEMENT FLOW
  // ==========================================================================

  describe('User Management: UI → API → Database', () => {
    it('should create user from UI and verify in database', async () => {
      const userData = {
        username: `ui_test_user_${Date.now()}`,
        firstName: 'UI',
        lastName: 'Test',
        email: `ui_test_${Date.now()}@example.com`,
        password: 'SecurePassword123!@#',
        role: 'data_entry'
      };

      // Simulate Angular UI making API call
      const apiResponse = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send(userData)
        .expect(201);

      expect(apiResponse.body.success).toBe(true);
      expect(apiResponse.body.userId).toBeDefined();
      testUserId = apiResponse.body.userId;

      // Verify data in database
      const dbResult = await testDb.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [testUserId]
      );

      expect(dbResult.rows.length).toBe(1);
      const dbUser = dbResult.rows[0];
      expect(dbUser.user_name).toBe(userData.username);
      expect(dbUser.first_name).toBe(userData.firstName);
      expect(dbUser.last_name).toBe(userData.lastName);
      expect(dbUser.email).toBe(userData.email);
      expect(dbUser.passwd).toBeDefined(); // Password should be hashed
      expect(dbUser.passwd).not.toBe(userData.password); // Should not be plain text

      // Verify audit trail
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [testUserId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].action_message).toContain('created');
    });

    it('should update user from UI and verify changes in database', async () => {
      // First create a user
      const createResponse = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: `update_test_${Date.now()}`,
          firstName: 'Original',
          lastName: 'Name',
          email: `original_${Date.now()}@example.com`,
          password: 'Password123!@#',
          role: 'data_entry'
        });

      testUserId = createResponse.body.userId;

      // Update via UI
      const updateData = {
        firstName: 'Updated',
        lastName: 'User',
        email: `updated_${Date.now()}@example.com`
      };

      const updateResponse = await request(app)
        .put(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      // Verify changes in database
      const dbResult = await testDb.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [testUserId]
      );

      expect(dbResult.rows[0].first_name).toBe(updateData.firstName);
      expect(dbResult.rows[0].last_name).toBe(updateData.lastName);
      expect(dbResult.rows[0].email).toBe(updateData.email);

      // Verify audit trail captures the change
      const auditResult = await testDb.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = $2 
         ORDER BY audit_date DESC LIMIT 1`,
        [testUserId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].action_message).toContain('updated');
    });
  });

  // ==========================================================================
  // STUDY MANAGEMENT FLOW
  // ==========================================================================

  describe('Study Management: UI → API → Database', () => {
    it('should create study from UI and verify in database', async () => {
      const studyData = {
        uniqueIdentifier: `UI-STUDY-${Date.now()}`,
        name: 'UI Test Study',
        description: 'Study created from Angular UI',
        principalInvestigator: 'Dr. Test',
        expectedTotalEnrollment: 100
      };

      // Simulate Angular UI creating study
      const apiResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData)
        .expect(201);

      expect(apiResponse.body.success).toBe(true);
      expect(apiResponse.body.studyId).toBeDefined();
      testStudyId = apiResponse.body.studyId;

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].unique_identifier).toBe(studyData.uniqueIdentifier);
      expect(dbResult.rows[0].name).toBe(studyData.name);
      expect(dbResult.rows[0].description).toBe(studyData.description);

      // Verify audit log
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [testStudyId, 'study']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });

    it('should update study status from UI and verify in database', async () => {
      // Create study first
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `STATUS-TEST-${Date.now()}`,
          name: 'Status Test Study',
          description: 'Testing status updates'
        });

      testStudyId = createResponse.body.studyId;

      // Update status via UI
      const updateResponse = await request(app)
        .put(`/api/studies/${testStudyId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'available' })
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows[0].status_id).toBe(1); // 1 = available
    });
  });

  // ==========================================================================
  // SUBJECT ENROLLMENT FLOW
  // ==========================================================================

  describe('Subject Enrollment: UI → API → Database', () => {
    beforeEach(async () => {
      // Create a study for subject enrollment
      const studyResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `SUBJECT-STUDY-${Date.now()}`,
          name: 'Subject Enrollment Study',
          description: 'Study for testing subject enrollment'
        });

      testStudyId = studyResponse.body.studyId;
    });

    it('should enroll subject from UI and verify in database', async () => {
      const subjectData = {
        studyId: testStudyId,
        label: `SUBJ-${Date.now()}`,
        enrollmentDate: new Date().toISOString(),
        gender: 'M',
        dateOfBirth: '1990-01-01'
      };

      // Simulate Angular UI enrolling subject
      const apiResponse = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subjectData)
        .expect(201);

      expect(apiResponse.body.success).toBe(true);
      expect(apiResponse.body.subjectId).toBeDefined();
      testSubjectId = apiResponse.body.subjectId;

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM study_subject WHERE study_subject_id = $1',
        [testSubjectId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].label).toBe(subjectData.label);
      expect(dbResult.rows[0].study_id).toBe(testStudyId);

      // Verify audit trail
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [testSubjectId, 'study_subject']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].action_message).toContain('enrolled');
    });

    it('should update subject data from UI and verify in database', async () => {
      // Enroll subject first
      const enrollResponse = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          studyId: testStudyId,
          label: `UPDATE-SUBJ-${Date.now()}`,
          enrollmentDate: new Date().toISOString()
        });

      testSubjectId = enrollResponse.body.subjectId;

      // Update subject via UI
      const updateData = {
        status: 'enrolled',
        notes: 'Updated from UI'
      };

      const updateResponse = await request(app)
        .put(`/api/subjects/${testSubjectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      // Verify changes in database
      const dbResult = await testDb.query(
        'SELECT * FROM study_subject WHERE study_subject_id = $1',
        [testSubjectId]
      );

      expect(dbResult.rows[0].status_id).toBeDefined();

      // Verify audit trail
      const auditResult = await testDb.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = $2 
         ORDER BY audit_date DESC LIMIT 1`,
        [testSubjectId, 'study_subject']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // FORM DATA ENTRY FLOW
  // ==========================================================================

  describe('Form Data Entry: UI → API → Database', () => {
    it('should save form data from UI and verify in database', async () => {
      // This test verifies that form data entered in Angular UI
      // is correctly saved to the database via the API

      const formData = {
        studyId: testStudyId,
        subjectId: testSubjectId,
        formOid: 'DEMOGRAPHICS',
        itemGroupData: [
          {
            itemGroupOid: 'DM',
            items: [
              { itemOid: 'AGE', value: '35' },
              { itemOid: 'GENDER', value: 'M' },
              { itemOid: 'RACE', value: 'Caucasian' }
            ]
          }
        ]
      };

      const apiResponse = await request(app)
        .post('/api/forms/data')
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData)
        .expect(201);

      expect(apiResponse.body.success).toBe(true);

      // Verify audit trail (form data changes should be logged)
      const auditResult = await testDb.query(
        `SELECT * FROM audit_log_event 
         WHERE audit_table = 'item_data' 
         ORDER BY audit_date DESC LIMIT 3`
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // CONCURRENT OPERATIONS TEST
  // ==========================================================================

  describe('Concurrent Operations: Multiple UI Actions', () => {
    it('should handle concurrent user creation from multiple UI sessions', async () => {
      const userPromises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            username: `concurrent_user_${Date.now()}_${i}`,
            firstName: `User${i}`,
            lastName: 'Concurrent',
            email: `concurrent_${Date.now()}_${i}@example.com`,
            password: 'Password123!@#',
            role: 'data_entry'
          })
      );

      const responses = await Promise.all(userPromises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      // Verify all users in database
      const dbResult = await testDb.query(
        `SELECT COUNT(*) as count FROM user_account 
         WHERE user_name LIKE 'concurrent_user_%'`
      );

      expect(parseInt(dbResult.rows[0].count)).toBe(5);
    });
  });
});
