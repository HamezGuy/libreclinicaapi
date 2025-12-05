/**
 * Study API Integration Tests
 * 
 * Tests the full HTTP API endpoints for study management:
 * - POST /api/studies - Create study
 * - GET /api/studies - List studies
 * - GET /api/studies/:id - Get study by ID
 * - GET /api/studies/:id/events - Get study events
 * - PUT /api/studies/:id - Update study
 * - DELETE /api/studies/:id - Delete study
 * 
 * Uses supertest to make actual HTTP requests to the API
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { testDb } from './utils/test-db';

// Import the app for testing
import app from '../src/app';

describe('Study API Integration Tests', () => {
  const userId = 1;
  let authToken: string;
  let createdStudyIds: number[] = [];

  beforeAll(async () => {
    await testDb.connect();
    
    // Generate a test JWT token for authentication
    // In a real test, you would login first
    const jwt = require('jsonwebtoken');
    authToken = jwt.sign(
      { 
        userId: 1, 
        userName: 'root',
        username: 'root',
        email: 'root@example.com',
        role: 'admin'
      },
      process.env.JWT_SECRET || 'test-secret-key-for-jwt-signing-minimum-32-chars',
      { expiresIn: '1h' }
    );
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
    createdStudyIds = [];
  });

  afterEach(async () => {
    // Cleanup created studies
    for (const studyId of createdStudyIds) {
      try {
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study_parameter_value WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [studyId]);
      } catch (e) { /* ignore */ }
    }
  });

  afterAll(async () => {
    // Cleanup
  });

  // ============================================================================
  // CREATE STUDY API TESTS
  // ============================================================================

  describe('POST /api/studies', () => {
    it('should create a study with valid data', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `API Study ${timestamp}`,
        uniqueIdentifier: `API-${timestamp}`,
        summary: 'Created via API test',
        principalInvestigator: 'Dr. API',
        sponsor: 'API Corp',
        phase: 'II',
        expectedTotalEnrollment: 100
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData)
        .expect('Content-Type', /json/);

      // Accept 201 Created or 200 OK
      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
      expect(response.body.studyId).toBeDefined();

      createdStudyIds.push(response.body.studyId);

      // Verify in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [response.body.studyId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(studyData.name);
    });

    it('should create study with event definitions', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Event API Study ${timestamp}`,
        uniqueIdentifier: `EVAPI-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Screening Visit',
            ordinal: 1,
            type: 'scheduled',
            repeating: false
          },
          {
            name: 'Follow-up Visit',
            ordinal: 2,
            type: 'scheduled',
            repeating: true
          }
        ]
      };

      const response = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);

      createdStudyIds.push(response.body.studyId);

      // Verify events were created
      const eventsResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_id = $1 ORDER BY ordinal',
        [response.body.studyId]
      );

      expect(eventsResult.rows.length).toBe(2);
      expect(eventsResult.rows[0].name).toBe('Screening Visit');
      expect(eventsResult.rows[1].name).toBe('Follow-up Visit');
      expect(eventsResult.rows[1].repeating).toBe(true);
    });

    it('should reject duplicate study identifier', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Duplicate Study ${timestamp}`,
        uniqueIdentifier: `DUP-${timestamp}`
      };

      // Create first study
      const response1 = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send(studyData);

      expect(response1.body.success).toBe(true);
      createdStudyIds.push(response1.body.studyId);

      // Try to create duplicate
      const response2 = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Another Study ${timestamp}`,
          uniqueIdentifier: `DUP-${timestamp}` // Same identifier
        });

      expect(response2.body.success).toBe(false);
      expect(response2.body.message).toContain('already exists');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/studies')
        .send({ name: 'Test', uniqueIdentifier: 'TEST' });

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // GET STUDIES LIST API TESTS
  // ============================================================================

  describe('GET /api/studies', () => {
    beforeEach(async () => {
      // Create some test studies
      for (let i = 1; i <= 3; i++) {
        const timestamp = Date.now();
        const result = await testDb.pool.query(`
          INSERT INTO study (unique_identifier, name, status_id, owner_id, date_created, oc_oid)
          VALUES ($1, $2, 1, $3, NOW(), $4)
          RETURNING study_id
        `, [
          `LIST-${timestamp}-${i}`,
          `List Study ${i}`,
          userId,
          `S_LIST_${timestamp}_${i}`
        ]);

        createdStudyIds.push(result.rows[0].study_id);

        // Assign user to study
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, 'root', NOW())
        `, [result.rows[0].study_id, userId]);
      }
    });

    it('should return list of studies', async () => {
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should include pagination info', async () => {
      const response = await request(app)
        .get('/api/studies?page=1&limit=2')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.total).toBeDefined();
      expect(response.body.pagination.totalPages).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/studies');

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // GET STUDY BY ID API TESTS
  // ============================================================================

  describe('GET /api/studies/:id', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await testDb.pool.query(`
        INSERT INTO study (
          unique_identifier, name, summary, principal_investigator, sponsor,
          status_id, owner_id, date_created, oc_oid
        )
        VALUES ($1, $2, $3, $4, $5, 1, $6, NOW(), $7)
        RETURNING study_id
      `, [
        `GETID-${timestamp}`,
        'Get By ID Study',
        'Test study for GET by ID',
        'Dr. GetById',
        'GetById Corp',
        userId,
        `S_GETID_${timestamp}`
      ]);

      testStudyId = result.rows[0].study_id;
      createdStudyIds.push(testStudyId);

      await testDb.pool.query(`
        INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
        VALUES ('admin', $1, 1, $2, 'root', NOW())
      `, [testStudyId, userId]);
    });

    it('should return study by ID', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.study_id).toBe(testStudyId);
      expect(response.body.data.name).toBe('Get By ID Study');
      expect(response.body.data.principal_investigator).toBe('Dr. GetById');
    });

    it('should return 404 for non-existent study', async () => {
      const response = await request(app)
        .get('/api/studies/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should include computed statistics', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.total_subjects).toBeDefined();
      expect(response.body.data.total_events).toBeDefined();
    });
  });

  // ============================================================================
  // GET STUDY EVENTS API TESTS
  // ============================================================================

  describe('GET /api/studies/:id/events', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      
      // Create study
      const studyResult = await testDb.pool.query(`
        INSERT INTO study (unique_identifier, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, $2, 1, $3, NOW(), $4)
        RETURNING study_id
      `, [`EVENTS-${timestamp}`, 'Events Study', userId, `S_EVENTS_${timestamp}`]);

      testStudyId = studyResult.rows[0].study_id;
      createdStudyIds.push(testStudyId);

      // Create events
      for (let i = 1; i <= 3; i++) {
        await testDb.pool.query(`
          INSERT INTO study_event_definition (
            study_id, name, description, ordinal, type, repeating, status_id, owner_id, date_created, oc_oid
          )
          VALUES ($1, $2, $3, $4, 'scheduled', false, 1, $5, NOW(), $6)
        `, [
          testStudyId,
          `Event ${i}`,
          `Description for event ${i}`,
          i,
          userId,
          `SE_${timestamp}_${i}`
        ]);
      }

      await testDb.pool.query(`
        INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
        VALUES ('admin', $1, 1, $2, 'root', NOW())
      `, [testStudyId, userId]);
    });

    it('should return study events', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(3);
    });

    it('should return events in order', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const events = response.body.data;
      expect(events[0].name).toBe('Event 1');
      expect(events[1].name).toBe('Event 2');
      expect(events[2].name).toBe('Event 3');
      expect(events[0].order).toBe(1);
      expect(events[1].order).toBe(2);
      expect(events[2].order).toBe(3);
    });

    it('should include event type information', async () => {
      const response = await request(app)
        .get(`/api/studies/${testStudyId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const event = response.body.data[0];
      expect(event.type).toBeDefined();
      expect(event.repeating).toBeDefined();
      expect(event.formCount).toBeDefined();
    });
  });

  // ============================================================================
  // UPDATE STUDY API TESTS
  // ============================================================================

  describe('PUT /api/studies/:id', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await testDb.pool.query(`
        INSERT INTO study (
          unique_identifier, name, summary, principal_investigator,
          status_id, owner_id, date_created, oc_oid
        )
        VALUES ($1, $2, $3, $4, 1, $5, NOW(), $6)
        RETURNING study_id
      `, [
        `UPDATE-${timestamp}`,
        'Update Study',
        'Original summary',
        'Dr. Original',
        userId,
        `S_UPDATE_${timestamp}`
      ]);

      testStudyId = result.rows[0].study_id;
      createdStudyIds.push(testStudyId);

      await testDb.pool.query(`
        INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
        VALUES ('admin', $1, 1, $2, 'root', NOW())
      `, [testStudyId, userId]);
    });

    it('should update study fields', async () => {
      const updates = {
        name: 'Updated Study Name',
        description: 'Updated summary',
        principalInvestigator: 'Dr. Updated',
        expectedTotalEnrollment: 150
      };

      const response = await request(app)
        .put(`/api/studies/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].summary).toBe(updates.description);
      expect(dbResult.rows[0].principal_investigator).toBe(updates.principalInvestigator);
      expect(dbResult.rows[0].expected_total_enrollment).toBe(updates.expectedTotalEnrollment);
    });

    it('should return error for non-existent study', async () => {
      const response = await request(app)
        .put('/api/studies/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test' });

      // Depending on implementation, might be 404 or still 200 with success: false
      expect(response.body.success === false || response.status === 404).toBe(true);
    });
  });

  // ============================================================================
  // DELETE STUDY API TESTS
  // ============================================================================

  describe('DELETE /api/studies/:id', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await testDb.pool.query(`
        INSERT INTO study (unique_identifier, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, $2, 1, $3, NOW(), $4)
        RETURNING study_id
      `, [`DELETE-${timestamp}`, 'Delete Study', userId, `S_DELETE_${timestamp}`]);

      testStudyId = result.rows[0].study_id;
      createdStudyIds.push(testStudyId);

      await testDb.pool.query(`
        INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
        VALUES ('admin', $1, 1, $2, 'root', NOW())
      `, [testStudyId, userId]);
    });

    it('should soft delete study', async () => {
      const response = await request(app)
        .delete(`/api/studies/${testStudyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify soft delete (status_id = 5)
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);
    });
  });

  // ============================================================================
  // FULL API E2E TEST
  // ============================================================================

  describe('Full API E2E Flow', () => {
    it('should complete full CRUD cycle via API', async () => {
      const timestamp = Date.now();

      // 1. CREATE
      const createResponse = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `E2E API Study ${timestamp}`,
          uniqueIdentifier: `E2EAPI-${timestamp}`,
          principalInvestigator: 'Dr. E2E',
          sponsor: 'E2E Corp',
          expectedTotalEnrollment: 100,
          eventDefinitions: [
            { name: 'Visit 1', ordinal: 1, type: 'scheduled' }
          ]
        });

      expect([200, 201]).toContain(createResponse.status);
      expect(createResponse.body.success).toBe(true);
      
      const studyId = createResponse.body.studyId;
      createdStudyIds.push(studyId);

      console.log(`✅ Created study via API: ${studyId}`);

      // 2. READ
      const readResponse = await request(app)
        .get(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(readResponse.body.success).toBe(true);
      expect(readResponse.body.data.name).toContain('E2E API Study');

      console.log(`✅ Read study via API`);

      // 3. READ EVENTS
      const eventsResponse = await request(app)
        .get(`/api/studies/${studyId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(eventsResponse.body.success).toBe(true);
      expect(eventsResponse.body.data.length).toBe(1);
      expect(eventsResponse.body.data[0].name).toBe('Visit 1');

      console.log(`✅ Read study events via API`);

      // 4. UPDATE
      const updateResponse = await request(app)
        .put(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `E2E API Study Updated ${timestamp}`,
          expectedTotalEnrollment: 200
        })
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      console.log(`✅ Updated study via API`);

      // 5. VERIFY UPDATE
      const verifyResponse = await request(app)
        .get(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(verifyResponse.body.data.expected_total_enrollment).toBe(200);

      console.log(`✅ Verified update via API`);

      // 6. DELETE
      const deleteResponse = await request(app)
        .delete(`/api/studies/${studyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);

      console.log(`✅ Deleted study via API`);

      console.log('');
      console.log('='.repeat(60));
      console.log('🎉 FULL API E2E CRUD CYCLE COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
    });
  });
});

