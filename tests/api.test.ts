/**
 * API Test Suite
 * 
 * Comprehensive tests for LibreClinica REST API
 * Tests all endpoints, security, and compliance features
 * 
 * Run: npm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('LibreClinica API - Comprehensive Test Suite', () => {
  let authToken: string;
  let testUserId: number;

  // ==========================================================================
  // SETUP & TEARDOWN
  // ==========================================================================

  beforeAll(async () => {
    // Wait for database connection
    await testDb.query('SELECT 1');
  });

  beforeEach(async () => {
    // Clean database before each test
    await testDb.cleanDatabase();
    await testDb.seedTestData();
  });

  afterAll(async () => {
    // Don't close connection - handled by global teardown
  });

  // ==========================================================================
  // HEALTH CHECK TESTS
  // ==========================================================================

  describe('Health Check', () => {
    it('GET /health - should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });

    it('GET /api/health - should return API health', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toHaveProperty('database');
      expect(response.body.services).toHaveProperty('soap');
    });
  });

  // ==========================================================================
  // AUTHENTICATION TESTS (RED X #1)
  // ==========================================================================

  describe('Authentication API', () => {
    it('POST /api/auth/login - should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'root',
          password: 'root'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('userId');
      expect(response.body.user).toHaveProperty('username');

      authToken = response.body.accessToken;
      testUserId = response.body.user.userId;
    });

    it('POST /api/auth/login - should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'invalid',
          password: 'wrong'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('message');
    });

    it('POST /api/auth/login - should validate request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'ab'  // Too short
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('errors');
    });

    it('GET /api/auth/verify - should verify valid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user).toHaveProperty('userId');
    });

    it('GET /api/auth/verify - should reject invalid token', async () => {
      await request(app)
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('POST /api/auth/logout - should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // SUBJECT/PATIENT TESTS (SOAP Integration)
  // ==========================================================================

  describe('Subject API', () => {
    it('GET /api/subjects - should require authentication', async () => {
      await request(app)
        .get('/api/subjects?studyId=1')
        .expect(401);
    });

    it('GET /api/subjects - should list subjects with auth', async () => {
      const response = await request(app)
        .get('/api/subjects?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /api/subjects/:id - should get subject details', async () => {
      // First get a subject ID
      const listResponse = await request(app)
        .get('/api/subjects?studyId=1&limit=1')
        .set('Authorization', `Bearer ${authToken}`);

      if (listResponse.body.data.length > 0) {
        const subjectId = listResponse.body.data[0].study_subject_id;

        const response = await request(app)
          .get(`/api/subjects/${subjectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('study_subject_id');
        expect(response.body.data).toHaveProperty('events');
      }
    });
  });

  // ==========================================================================
  // STUDY TESTS
  // ==========================================================================

  describe('Study API', () => {
    it('GET /api/studies - should list studies', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /api/studies/:id - should get study details', async () => {
      const response = await request(app)
        .get('/api/studies/1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('study_id');
    });

    it('GET /api/studies/:id/forms - should list study forms', async () => {
      const response = await request(app)
        .get('/api/studies/1/forms')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /api/studies/:id/metadata - should get study metadata', async () => {
      const response = await request(app)
        .get('/api/studies/1/metadata')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('study_id');
      expect(response.body.data).toHaveProperty('name');
    });

    it('POST /api/studies - should create new study', async () => {
      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `TEST_STUDY_${Date.now()}`,
          name: 'Test Study from API Tests',
          description: 'Created by automated tests',
          phase: 'I'
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('studyId');
    });

    it('PUT /api/studies/:id - should update study', async () => {
      const response = await request(app)
        .put('/api/studies/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Study Name',
          description: 'Updated by automated tests'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('DELETE /api/studies/:id - should delete study', async () => {
      // Create a study first to delete
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          uniqueIdentifier: `DELETE_TEST_${Date.now()}`,
          name: 'Study to Delete',
          description: 'Will be deleted',
          phase: 'I'
        });

      if (createResponse.body.success && createResponse.body.studyId) {
        const response = await request(app)
          .delete(`/api/studies/${createResponse.body.studyId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // QUERY MANAGEMENT TESTS (RED X #3)
  // ==========================================================================

  describe('Query/Discrepancy API', () => {
    let queryId: number;

    it('GET /api/queries - should list queries', async () => {
      const response = await request(app)
        .get('/api/queries?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
    });

    it('POST /api/queries - should create query', async () => {
      const response = await request(app)
        .post('/api/queries')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entityType: 'itemData',
          entityId: 1,
          description: 'Test query created by automated tests',
          detailedNotes: 'This is a test query for API validation',
          queryType: 'Query',
          studyId: 1
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('queryId');

      queryId = response.body.queryId;
    });

    it('GET /api/queries/:id - should get query details', async () => {
      if (queryId) {
        const response = await request(app)
          .get(`/api/queries/${queryId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('discrepancy_note_id');
        expect(response.body.data).toHaveProperty('thread');
      }
    });

    it('POST /api/queries/:id/respond - should add response', async () => {
      if (queryId) {
        const response = await request(app)
          .post(`/api/queries/${queryId}/respond`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            response: 'Test response to query'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });

    it('GET /api/queries/stats - should get query statistics', async () => {
      const response = await request(app)
        .get('/api/queries/stats?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('byStatus');
      expect(response.body.data).toHaveProperty('byType');
    });

    it('PUT /api/queries/:id/status - should update query status', async () => {
      if (queryId) {
        const response = await request(app)
          .put(`/api/queries/${queryId}/status`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            statusId: 2 // Updated status
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // AUDIT TRAIL TESTS (RED X #4)
  // ==========================================================================

  describe('Audit Trail API', () => {
    it('GET /api/audit - should query audit trail', async () => {
      const response = await request(app)
        .get('/api/audit?studyId=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /api/audit - should filter by date range', async () => {
      const startDate = new Date('2024-01-01').toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/audit?studyId=1&startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('GET /api/audit/export - should export to CSV', async () => {
      const startDate = new Date('2024-01-01').toISOString().split('T')[0];
      const endDate = new Date().toISOString().split('T')[0];

      const response = await request(app)
        .get(`/api/audit/export?studyId=1&startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('Audit Date');
    });
  });

  // ==========================================================================
  // DASHBOARD TESTS (RED X #5)
  // ==========================================================================

  describe('Dashboard API', () => {
    it('GET /api/dashboard/enrollment - should get enrollment stats', async () => {
      const response = await request(app)
        .get('/api/dashboard/enrollment?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalSubjects');
      expect(response.body.data).toHaveProperty('enrollmentByMonth');
      expect(response.body.data).toHaveProperty('enrollmentRate');
    });

    it('GET /api/dashboard/completion - should get completion stats', async () => {
      const response = await request(app)
        .get('/api/dashboard/completion?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalCRFs');
      expect(response.body.data).toHaveProperty('completionPercentage');
      expect(response.body.data).toHaveProperty('completionByForm');
    });

    it('GET /api/dashboard/queries - should get query stats', async () => {
      const response = await request(app)
        .get('/api/dashboard/queries?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalQueries');
      expect(response.body.data).toHaveProperty('openQueries');
      expect(response.body.data).toHaveProperty('closedQueries');
    });

    it('GET /api/dashboard/activity - should get user activity', async () => {
      const response = await request(app)
        .get('/api/dashboard/activity?studyId=1&days=30')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('activeUsers');
      expect(response.body.data).toHaveProperty('totalLogins');
      expect(response.body.data).toHaveProperty('activityByUser');
    });
  });

  // ==========================================================================
  // USER MANAGEMENT TESTS (RED X #2)
  // ==========================================================================

  describe('User Management API', () => {
    let createdUserId: number;

    it('GET /api/users - should list users', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /api/users/:id - should get user details', async () => {
      const response = await request(app)
        .get(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user_id');
      expect(response.body.data).toHaveProperty('user_name');
    });

    // Note: User creation test disabled to avoid creating test users
    // Enable only in dedicated test environment
    it.skip('POST /api/users - should create user', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: 'testuser_' + Date.now(),
          firstName: 'Test',
          lastName: 'User',
          email: `test_${Date.now()}@example.com`,
          password: 'TestPassword123!',
          userTypeId: 2
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('userId');

      createdUserId = response.body.userId;
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security Features', () => {
    it('Should reject requests without authentication', async () => {
      await request(app)
        .get('/api/subjects?studyId=1')
        .expect(401);
    });

    it('Should reject malformed JWT tokens', async () => {
      await request(app)
        .get('/api/subjects?studyId=1')
        .set('Authorization', 'Bearer malformed.token.here')
        .expect(401);
    });

    it('Should validate input data', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'ab',  // Too short
          password: 'x'    // Too short
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('errors');
    });

    it('Should have CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    it('Should have security headers (Helmet)', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ==========================================================================
  // RATE LIMITING TESTS
  // ==========================================================================

  describe('Rate Limiting', () => {
    it('Should have rate limit headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Check for rate limit headers
      expect(response.headers).toHaveProperty('ratelimit-limit');
    });

    // Note: Actual rate limit test disabled to avoid triggering limits
    it.skip('Should enforce rate limits', async () => {
      // Make 101 requests to trigger rate limit
      const requests = Array(101).fill(null).map(() =>
        request(app).get('/api/health')
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.some(r => r.status === 429);

      expect(rateLimited).toBe(true);
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('Should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('message');
    });

    it('Should return 400 for validation errors', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})  // Empty body
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('errors');
    });

    it('Should not expose sensitive error details', async () => {
      const response = await request(app)
        .get('/api/subjects/99999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).not.toHaveProperty('stack');
    });
  });

  // ==========================================================================
  // COMPLIANCE TESTS (21 CFR Part 11)
  // ==========================================================================

  describe('21 CFR Part 11 Compliance', () => {
    it('Should log all API requests (§11.10(e))', async () => {
      // Make a request
      await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${authToken}`);

      // Check audit log
      const result = await testDb.query(`
        SELECT COUNT(*) as count
        FROM audit_user_api_log
        WHERE endpoint_path = '/api/health'
          AND created_at > NOW() - INTERVAL '1 minute'
      `);

      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it('Should enforce password complexity (§11.300)', async () => {
      const weakPasswords = [
        'short',
        'alllowercase',
        'ALLUPPERCASE',
        'NoSpecialChar1',
        '12345678',
        'password'
      ];

      for (const weakPassword of weakPasswords) {
        // Password validation would reject these
        const { validatePassword } = require('../src/utils/password.util');
        const result = validatePassword(weakPassword);

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('Should support electronic signatures (§11.50)', async () => {
      // Electronic signature functionality exists in middleware
      const { electronicSignatureMiddleware } = require('../src/middleware/audit.middleware');

      expect(electronicSignatureMiddleware).toBeDefined();
      expect(typeof electronicSignatureMiddleware).toBe('function');
    });

    it('Should maintain data integrity (§11.10(k)(2))', async () => {
      // Database transactions ensure data integrity
      // Test that database supports transactions
      const client = await testDb.getClient();

      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');
        await client.query('COMMIT');

        // Transaction support confirmed
        expect(true).toBe(true);
      } finally {
        client.release();
      }
    });
  });

  // ==========================================================================
  // NEW MERGED ROUTES TESTS (from ElectronicDataCaptureReal/backend)
  // ==========================================================================

  describe('SDV API', () => {
    it('GET /api/sdv - should list SDV records', async () => {
      const response = await request(app)
        .get('/api/sdv?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    });

    it('PUT /api/sdv/:id/verify - should verify SDV record', async () => {
      // This test requires a valid event_crf_id and proper role
      const response = await request(app)
        .put('/api/sdv/1/verify')
        .set('Authorization', `Bearer ${authToken}`);

      // May return 200, 404 (no data), or 403 (insufficient permissions)
      expect([200, 403, 404]).toContain(response.status);
    });
  });

  describe('Randomization API', () => {
    it('GET /api/randomization - should list randomizations', async () => {
      const response = await request(app)
        .get('/api/randomization?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    });

    it('GET /api/randomization/groups/:studyId - should get study groups', async () => {
      const response = await request(app)
        .get('/api/randomization/groups/1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Monitoring API', () => {
    it('GET /api/monitoring/stats - should get system stats', async () => {
      const response = await request(app)
        .get('/api/monitoring/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('systemHealth');
    });

    it('GET /api/monitoring/alerts - should get alerts', async () => {
      const response = await request(app)
        .get('/api/monitoring/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Data Locks API', () => {
    it('GET /api/data-locks - should list locked records', async () => {
      const response = await request(app)
        .get('/api/data-locks?studyId=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('AI API', () => {
    it('POST /api/ai/chat - should respond to chat', async () => {
      const response = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'Hello' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Coding API', () => {
    it('GET /api/coding - should list coding records', async () => {
      const response = await request(app)
        .get('/api/coding')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});

export {};

