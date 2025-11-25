/**
 * Integration Tests - API to Database
 * 
 * These tests verify that API calls properly modify the database
 * Tests the complete flow: Frontend → API → Database
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('API to Database Integration Tests', () => {
  let authToken: string;
  let testUserId: number | undefined;
  let testStudyId: number | undefined;
  let testSubjectId: number | undefined;

  beforeAll(async () => {
    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'root',
        password: 'root'
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);
    authToken = loginResponse.body.accessToken;
  });

  beforeEach(async () => {
    // Clean database before each test
    await testDb.cleanDatabase();
    await testDb.seedTestData();
  });

  afterAll(async () => {
    // Don't close connection - handled by global teardown
  });

  describe('User Management - Frontend to Database', () => {
    it('should create user via API and verify in database', async () => {
      const userData = {
        username: `testapi_${Date.now()}`,
        firstName: 'Test',
        lastName: 'API',
        email: `testapi_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
        role: 'data_entry'
      };

      // Make API call
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send(userData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBeDefined();

      testUserId = response.body.userId;

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [testUserId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].user_name).toBe(userData.username);
      expect(dbResult.rows[0].first_name).toBe(userData.firstName);
      expect(dbResult.rows[0].email).toBe(userData.email);

      // Verify audit log
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [testUserId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });

    it('should update user via API and verify changes in database', async () => {
      // First create a user to update
      const createResponse = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: `update_test_${Date.now()}`,
          firstName: 'Original',
          lastName: 'Name',
          email: `original_${Date.now()}@example.com`,
          password: 'TestPassword123!@#',
          role: 'data_entry'
        });

      expect(createResponse.status).toBe(201);
      const userId = createResponse.body.userId;

      const updates = {
        firstName: 'Updated',
        lastName: 'Name',
        email: `updated_${Date.now()}@example.com`
      };

      // Make API call
      const response = await request(app)
        .put(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify changes in database
      const dbResult = await testDb.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [userId]
      );

      expect(dbResult.rows[0].first_name).toBe(updates.firstName);
      expect(dbResult.rows[0].last_name).toBe(updates.lastName);
      expect(dbResult.rows[0].email).toBe(updates.email);
    });

    it('should delete user via API and verify in database', async () => {
      // First create a user to delete
      const createResponse = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: `delete_test_${Date.now()}`,
          firstName: 'Delete',
          lastName: 'Test',
          email: `delete_${Date.now()}@example.com`,
          password: 'TestPassword123!@#',
          role: 'data_entry'
        });

      expect(createResponse.status).toBe(201);
      const userId = createResponse.body.userId;

      // Make API call
      const response = await request(app)
        .delete(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify user is disabled in database
      const dbResult = await testDb.query(
        'SELECT enabled FROM user_account WHERE user_id = $1',
        [userId]
      );

      expect(dbResult.rows[0].enabled).toBe(false);
    });
  });

  describe('Study Management - Frontend to Database', () => {
    it('should create study via API and verify in database', async () => {
      const studyData = {
        name: `API Test Study ${Date.now()}`,
        uniqueIdentifier: `API-TEST-${Date.now()}`,
        description: 'Created via API test',
        principalInvestigator: 'Dr. API Test',
        sponsor: 'Test Sponsor Inc.',
        phase: 'III',
        expectedTotalEnrollment: 150
      };

      // Make API call
      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.studyId).toBeDefined();

      testStudyId = response.body.studyId;

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(studyData.name);
      expect(dbResult.rows[0].unique_identifier).toBe(studyData.uniqueIdentifier);
      expect(dbResult.rows[0].expected_total_enrollment).toBe(studyData.expectedTotalEnrollment);

      // Verify audit log
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [testStudyId, 'study']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });

    it('should update study via API and verify changes in database', async () => {
      // First create a study to update
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Update Test Study ${Date.now()}`,
          uniqueIdentifier: `UPDATE-TEST-${Date.now()}`,
          description: 'Original description',
          phase: 'II'
        });

      expect(createResponse.status).toBe(201);
      const studyId = createResponse.body.studyId;

      const updates = {
        name: 'Updated Study Name',
        description: 'Updated via API',
        expectedTotalEnrollment: 200
      };

      // Make API call
      const response = await request(app)
        .put(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify changes in database
      const dbResult = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [studyId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].expected_total_enrollment).toBe(updates.expectedTotalEnrollment);
    });

    it('should delete study via API and verify status in database', async () => {
      // First create a study to delete
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Delete Test Study ${Date.now()}`,
          uniqueIdentifier: `DELETE-TEST-${Date.now()}`,
          description: 'Will be deleted',
          phase: 'I'
        });

      expect(createResponse.status).toBe(201);
      const studyId = createResponse.body.studyId;

      // Make API call
      const response = await request(app)
        .delete(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify status is set to removed (5)
      const dbResult = await testDb.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [studyId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);
    });
  });

  describe('Authentication - Token Management', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/studies');

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should accept requests with valid token', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
    });

    it('should refresh expired token', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'root',
          password: 'root'
        });

      const refreshToken = loginResponse.body.refreshToken;

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.accessToken).toBeDefined();
    });
  });

  describe('Authorization - Role-Based Access', () => {
    it('should allow admin to create users', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: `roletest_${Date.now()}`,
          firstName: 'Role',
          lastName: 'Test',
          email: `role_${Date.now()}@example.com`,
          password: 'TestPassword123!@#',
          role: 'data_entry'
        });

      // Should succeed because root is admin
      expect(response.status).toBe(201);
      
      // Cleanup
      if (response.body.userId) {
        await testDb.query('DELETE FROM user_account WHERE user_id = $1', [response.body.userId]);
      }
    });

    it('should allow admin to delete studies', async () => {
      // Create a test study
      const studyData = {
        name: `Role Study ${Date.now()}`,
        uniqueIdentifier: `ROLE-${Date.now()}`
      };

      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      const studyId = createResponse.body.studyId;

      // Try to delete
      const deleteResponse = await request(app)
        .delete(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Cleanup
      await testDb.query('DELETE FROM study WHERE study_id = $1', [studyId]);
    });
  });

  describe('Audit Trail - All Operations Logged', () => {
    it('should log user creation in audit_log_event', async () => {
      const userData = {
        username: `auditlog_${Date.now()}`,
        firstName: 'Audit',
        lastName: 'Log',
        email: `audit_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
        role: 'data_entry'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send(userData);

      const userId = response.body.userId;

      // Check audit log
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [userId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].new_value).toBe(userData.username);

      // Cleanup
      await testDb.query('DELETE FROM user_account WHERE user_id = $1', [userId]);
    });

    it('should log study creation in audit_log_event', async () => {
      const studyData = {
        name: `Audit Study ${Date.now()}`,
        uniqueIdentifier: `AUDIT-${Date.now()}`
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      const studyId = response.body.studyId;

      // Check audit log
      const auditResult = await testDb.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2',
        [studyId, 'study']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);

      // Cleanup
      await testDb.query('DELETE FROM study WHERE study_id = $1', [studyId]);
    });
  });

  describe('Data Validation - Input Validation', () => {
    it('should reject user creation with weak password', async () => {
      const userData = {
        username: `weakpass_${Date.now()}`,
        firstName: 'Weak',
        lastName: 'Password',
        email: `weak_${Date.now()}@example.com`,
        password: 'weak',
        role: 'data_entry'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send(userData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject study creation with invalid data', async () => {
      const studyData = {
        name: 'X', // Too short
        uniqueIdentifier: 'T!'  // Invalid characters
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Rate Limiting - Protection Against Abuse', () => {
    it('should enforce rate limiting on auth endpoints', async () => {
      const promises = [];

      // Make 10 rapid login attempts
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/api/auth/login')
            .send({
              username: 'invalid',
              password: 'invalid'
            })
        );
      }

      const responses = await Promise.all(promises);

      // Some requests should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Transaction Management - Data Integrity', () => {
    it('should rollback on error during user creation', async () => {
      const userData = {
        username: 'root', // Duplicate username - should fail
        firstName: 'Test',
        lastName: 'Rollback',
        email: `rollback_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
        role: 'data_entry'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send(userData);

      expect(response.body.success).toBe(false);

      // Verify no partial data in database
      const dbResult = await testDb.query(
        'SELECT * FROM user_account WHERE email = $1',
        [userData.email]
      );

      expect(dbResult.rows.length).toBe(0);
    });
  });

  describe('CRUD Operations - Complete Lifecycle', () => {
    it('should handle complete study lifecycle: Create → Read → Update → Delete', async () => {
      // CREATE
      const createData = {
        name: `Lifecycle Study ${Date.now()}`,
        uniqueIdentifier: `LIFECYCLE-${Date.now()}`,
        description: 'Test complete lifecycle',
        expectedTotalEnrollment: 100
      };

      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createData);

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.success).toBe(true);

      const studyId = createResponse.body.studyId;

      // READ
      const readResponse = await request(app)
        .get(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(readResponse.status).toBe(200);
      expect(readResponse.body.success).toBe(true);
      expect(readResponse.body.data.name).toBe(createData.name);

      // UPDATE
      const updateData = {
        name: 'Updated Lifecycle Study',
        expectedTotalEnrollment: 150
      };

      const updateResponse = await request(app)
        .put(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);

      // Verify update in database
      const dbCheck = await testDb.query(
        'SELECT * FROM study WHERE study_id = $1',
        [studyId]
      );
      expect(dbCheck.rows[0].name).toBe(updateData.name);
      expect(dbCheck.rows[0].expected_total_enrollment).toBe(updateData.expectedTotalEnrollment);

      // DELETE
      const deleteResponse = await request(app)
        .delete(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify soft delete in database
      const statusCheck = await testDb.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [studyId]
      );
      expect(statusCheck.rows[0].status_id).toBe(5); // Removed status

      // Cleanup
      await testDb.query('DELETE FROM study_user_role WHERE study_id = $1', [studyId]);
      await testDb.query('DELETE FROM study WHERE study_id = $1', [studyId]);
    });
  });

  describe('Query Operations - Complete Flow', () => {
    it('should create and respond to query via API', async () => {
      const queryData = {
        entityType: 'studySubject',
        entityId: 1,
        studyId: 1,
        description: 'Test query created via API',
        detailedNotes: 'This is a test query to verify API integration',
        typeId: 1
      };

      // CREATE query
      const createResponse = await request(app)
        .post('/api/queries')
        .set('Authorization', `Bearer ${authToken}`)
        .send(queryData);

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.success).toBe(true);

      const queryId = createResponse.body.queryId;

      // Verify in database
      const dbResult = await testDb.query(
        'SELECT * FROM discrepancy_note WHERE discrepancy_note_id = $1',
        [queryId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].description).toBe(queryData.description);

      // RESPOND to query
      const respondResponse = await request(app)
        .post(`/api/queries/${queryId}/respond`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'This is a response to the query',
          detailedNotes: 'Response details'
        });

      expect(respondResponse.status).toBe(200);
      expect(respondResponse.body.success).toBe(true);

      // Verify response in database
      const responseResult = await testDb.query(
        'SELECT * FROM discrepancy_note WHERE parent_dn_id = $1',
        [queryId]
      );

      expect(responseResult.rows.length).toBeGreaterThan(0);

      // Cleanup
      await testDb.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = $1 OR parent_dn_id = $1', [queryId]);
    });
  });

  describe('Pagination - Large Datasets', () => {
    it('should paginate user lists correctly', async () => {
      const page1Response = await request(app)
        .get('/api/users?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(page1Response.status).toBe(200);
      expect(page1Response.body.success).toBe(true);
      expect(page1Response.body.data.length).toBeLessThanOrEqual(5);
      expect(page1Response.body.pagination.page).toBe(1);
    });

    it('should paginate study lists correctly', async () => {
      const page1Response = await request(app)
        .get('/api/studies?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(page1Response.status).toBe(200);
      expect(page1Response.body.success).toBe(true);
      expect(page1Response.body.pagination).toBeDefined();
    });
  });

  describe('Error Handling - Graceful Failures', () => {
    it('should return 404 for non-existent study', async () => {
      const response = await request(app)
        .get('/api/studies/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/users/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});

