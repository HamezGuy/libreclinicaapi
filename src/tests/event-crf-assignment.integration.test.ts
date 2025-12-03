/**
 * Event CRF Assignment Integration Tests
 * 
 * Tests the full flow of assigning CRFs (templates) to study events (phases):
 * 1. Get available CRFs for an event
 * 2. Assign CRF to event
 * 3. Update CRF assignment settings
 * 4. Reorder CRFs
 * 5. Remove CRF from event
 * 6. Bulk assign CRFs
 * 
 * Verifies:
 * - API endpoints work correctly
 * - Database records are created/updated/deleted properly
 * - Audit trails are logged
 * - Error handling works
 */

import request from 'supertest';
import { Pool } from 'pg';
import app from '../app';
import { pool } from '../config/database';

// Test configuration
const TEST_CONFIG = {
  API_BASE: '/api/events',
  AUTH_TOKEN: '', // Will be set during setup
};

// Test data
let testStudyId: number;
let testEventId: number;
let testCrfId: number;
let testCrfVersionId: number;
let testEventCrfId: number;
let testUserId: number = 1;

describe('Event CRF Assignment - Integration Tests', () => {
  
  beforeAll(async () => {
    console.log('🔧 Setting up test environment...');
    
    // Verify database connection
    try {
      const result = await pool.query('SELECT NOW() as time');
      console.log('✅ Database connected:', result.rows[0].time);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }

    // Find or create test data
    try {
      // Get a study
      let studyResult = await pool.query('SELECT study_id FROM study LIMIT 1');
      if (studyResult.rows.length === 0) {
        // Create a test study
        studyResult = await pool.query(`
          INSERT INTO study (name, oc_oid, status_id, owner_id, date_created)
          VALUES ('Test Study', 'S_TEST_001', 1, 1, NOW())
          RETURNING study_id
        `);
      }
      testStudyId = studyResult.rows[0].study_id;
      console.log('✅ Test study ID:', testStudyId);

      // Get or create a study event definition
      let eventResult = await pool.query(
        'SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1 LIMIT 1',
        [testStudyId]
      );
      if (eventResult.rows.length === 0) {
        eventResult = await pool.query(`
          INSERT INTO study_event_definition 
          (study_id, name, description, ordinal, type, repeating, status_id, owner_id, date_created, oc_oid)
          VALUES ($1, 'Test Event', 'Test event for CRF assignment', 1, 'scheduled', false, 1, 1, NOW(), 'SE_TEST_001')
          RETURNING study_event_definition_id
        `, [testStudyId]);
      }
      testEventId = eventResult.rows[0].study_event_definition_id;
      console.log('✅ Test event ID:', testEventId);

      // Get or create a CRF
      let crfResult = await pool.query('SELECT crf_id FROM crf WHERE status_id = 1 LIMIT 1');
      if (crfResult.rows.length === 0) {
        crfResult = await pool.query(`
          INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
          VALUES ('Test CRF', 'Test CRF for assignment', 1, 1, NOW(), 'F_TEST_001')
          RETURNING crf_id
        `);
      }
      testCrfId = crfResult.rows[0].crf_id;
      console.log('✅ Test CRF ID:', testCrfId);

      // Get or create a CRF version
      let versionResult = await pool.query(
        'SELECT crf_version_id FROM crf_version WHERE crf_id = $1 LIMIT 1',
        [testCrfId]
      );
      if (versionResult.rows.length === 0) {
        versionResult = await pool.query(`
          INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
          VALUES ($1, 'v1.0', 1, 1, NOW(), 'F_TEST_001_V1')
          RETURNING crf_version_id
        `, [testCrfId]);
      }
      testCrfVersionId = versionResult.rows[0].crf_version_id;
      console.log('✅ Test CRF version ID:', testCrfVersionId);

      // Get auth token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ username: 'root', password: '12345678' });
      
      if (loginResponse.body.success && loginResponse.body.token) {
        TEST_CONFIG.AUTH_TOKEN = loginResponse.body.token;
        console.log('✅ Auth token obtained');
      } else {
        console.log('⚠️ Using mock auth - some tests may be limited');
      }

    } catch (error) {
      console.error('❌ Test setup failed:', error);
      throw error;
    }
  });

  afterAll(async () => {
    console.log('🧹 Cleaning up test data...');
    
    // Clean up any test event_definition_crf records we created
    try {
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1
      `, [testEventId]);
      console.log('✅ Test data cleaned up');
    } catch (error) {
      console.error('⚠️ Cleanup warning:', error);
    }
  });

  // ============================================
  // SECTION 1: GET AVAILABLE CRFs
  // ============================================
  
  describe('1. Get Available CRFs for Event', () => {
    
    it('should return list of CRFs available for assignment', async () => {
      const response = await request(app)
        .get(`${TEST_CONFIG.API_BASE}/study/${testStudyId}/event/${testEventId}/available-crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`);

      console.log('Available CRFs response:', {
        status: response.status,
        total: response.body.total,
        sampleCrf: response.body.data?.[0]
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // Should include our test CRF
      if (response.body.data.length > 0) {
        const crf = response.body.data[0];
        expect(crf).toHaveProperty('crf_id');
        expect(crf).toHaveProperty('name');
        expect(crf).toHaveProperty('status_name');
      }
    });

    it('should exclude already assigned CRFs from available list', async () => {
      // First assign a CRF
      await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({
          crfId: testCrfId,
          required: true
        });

      // Now check available CRFs - should not include the assigned one
      const response = await request(app)
        .get(`${TEST_CONFIG.API_BASE}/study/${testStudyId}/event/${testEventId}/available-crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`);

      expect(response.status).toBe(200);
      
      const assignedCrfInList = response.body.data.find((c: any) => c.crf_id === testCrfId);
      expect(assignedCrfInList).toBeUndefined();

      console.log('✅ Assigned CRF correctly excluded from available list');
    });
  });

  // ============================================
  // SECTION 2: ASSIGN CRF TO EVENT
  // ============================================

  describe('2. Assign CRF to Event', () => {
    
    beforeEach(async () => {
      // Clean up any existing assignments
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND crf_id = $2
      `, [testEventId, testCrfId]);
    });

    it('should assign CRF to event with all settings', async () => {
      const assignmentData = {
        crfId: testCrfId,
        crfVersionId: testCrfVersionId,
        required: true,
        doubleEntry: false,
        hideCrf: false,
        electronicSignature: true
      };

      const response = await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send(assignmentData);

      console.log('Assign CRF response:', response.body);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.eventDefinitionCrfId).toBeDefined();

      testEventCrfId = response.body.eventDefinitionCrfId;

      // Verify in database
      const dbResult = await pool.query(
        'SELECT * FROM event_definition_crf WHERE event_definition_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].crf_id).toBe(testCrfId);
      expect(dbResult.rows[0].required_crf).toBe(true);
      expect(dbResult.rows[0].electronic_signature).toBe(true);

      console.log('✅ CRF assigned successfully and verified in database');
    });

    it('should auto-assign ordinal when not provided', async () => {
      // Assign first CRF
      await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ crfId: testCrfId });

      // Get another CRF
      const anotherCrfResult = await pool.query(`
        SELECT crf_id FROM crf 
        WHERE crf_id != $1 AND status_id = 1 
        LIMIT 1
      `, [testCrfId]);

      if (anotherCrfResult.rows.length > 0) {
        const anotherCrfId = anotherCrfResult.rows[0].crf_id;

        // Assign second CRF without ordinal
        const response = await request(app)
          .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
          .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
          .send({ crfId: anotherCrfId });

        expect(response.body.success).toBe(true);

        // Verify ordinal is auto-assigned
        const dbResult = await pool.query(
          'SELECT ordinal FROM event_definition_crf WHERE event_definition_crf_id = $1',
          [response.body.eventDefinitionCrfId]
        );

        expect(dbResult.rows[0].ordinal).toBeGreaterThan(1);
        console.log('✅ Auto-assigned ordinal:', dbResult.rows[0].ordinal);
      }
    });

    it('should reject duplicate assignment', async () => {
      // First assignment
      await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ crfId: testCrfId });

      // Duplicate assignment
      const response = await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ crfId: testCrfId });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already assigned');

      console.log('✅ Duplicate assignment correctly rejected');
    });
  });

  // ============================================
  // SECTION 3: UPDATE CRF ASSIGNMENT
  // ============================================

  describe('3. Update CRF Assignment', () => {
    
    beforeEach(async () => {
      // Ensure we have an assignment to update
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND crf_id = $2
      `, [testEventId, testCrfId]);

      const result = await pool.query(`
        INSERT INTO event_definition_crf 
        (study_event_definition_id, study_id, crf_id, required_crf, ordinal, status_id, owner_id, date_created)
        VALUES ($1, $2, $3, false, 1, 1, 1, NOW())
        RETURNING event_definition_crf_id
      `, [testEventId, testStudyId, testCrfId]);
      
      testEventCrfId = result.rows[0].event_definition_crf_id;
    });

    it('should update CRF assignment settings', async () => {
      const updateData = {
        required: true,
        doubleEntry: true,
        electronicSignature: true
      };

      const response = await request(app)
        .put(`${TEST_CONFIG.API_BASE}/crf-assignment/${testEventCrfId}`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send(updateData);

      console.log('Update CRF response:', response.body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify in database
      const dbResult = await pool.query(
        'SELECT * FROM event_definition_crf WHERE event_definition_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].required_crf).toBe(true);
      expect(dbResult.rows[0].double_entry).toBe(true);
      expect(dbResult.rows[0].electronic_signature).toBe(true);

      console.log('✅ CRF assignment updated successfully');
    });

    it('should update only provided fields', async () => {
      // First set to specific values
      await pool.query(`
        UPDATE event_definition_crf 
        SET required_crf = false, double_entry = false, ordinal = 5
        WHERE event_definition_crf_id = $1
      `, [testEventCrfId]);

      // Update only required
      const response = await request(app)
        .put(`${TEST_CONFIG.API_BASE}/crf-assignment/${testEventCrfId}`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ required: true });

      expect(response.body.success).toBe(true);

      // Verify other fields unchanged
      const dbResult = await pool.query(
        'SELECT * FROM event_definition_crf WHERE event_definition_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows[0].required_crf).toBe(true);
      expect(dbResult.rows[0].double_entry).toBe(false); // Unchanged
      expect(dbResult.rows[0].ordinal).toBe(5); // Unchanged

      console.log('✅ Partial update works correctly');
    });
  });

  // ============================================
  // SECTION 4: REORDER CRFs
  // ============================================

  describe('4. Reorder CRFs in Event', () => {
    
    let crfAssignment1Id: number;
    let crfAssignment2Id: number;

    beforeEach(async () => {
      // Clean up and create two assignments
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1
      `, [testEventId]);

      const result1 = await pool.query(`
        INSERT INTO event_definition_crf 
        (study_event_definition_id, study_id, crf_id, ordinal, status_id, owner_id, date_created)
        VALUES ($1, $2, $3, 1, 1, 1, NOW())
        RETURNING event_definition_crf_id
      `, [testEventId, testStudyId, testCrfId]);
      crfAssignment1Id = result1.rows[0].event_definition_crf_id;

      // Get another CRF
      const anotherCrfResult = await pool.query(`
        SELECT crf_id FROM crf WHERE crf_id != $1 AND status_id = 1 LIMIT 1
      `, [testCrfId]);

      if (anotherCrfResult.rows.length > 0) {
        const result2 = await pool.query(`
          INSERT INTO event_definition_crf 
          (study_event_definition_id, study_id, crf_id, ordinal, status_id, owner_id, date_created)
          VALUES ($1, $2, $3, 2, 1, 1, NOW())
          RETURNING event_definition_crf_id
        `, [testEventId, testStudyId, anotherCrfResult.rows[0].crf_id]);
        crfAssignment2Id = result2.rows[0].event_definition_crf_id;
      }
    });

    it('should reorder CRFs', async () => {
      if (!crfAssignment2Id) {
        console.log('⚠️ Skipping reorder test - need at least 2 CRFs');
        return;
      }

      // Reverse the order
      const response = await request(app)
        .put(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs/reorder`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ orderedCrfIds: [crfAssignment2Id, crfAssignment1Id] });

      console.log('Reorder response:', response.body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify ordinals swapped
      const dbResult = await pool.query(`
        SELECT event_definition_crf_id, ordinal 
        FROM event_definition_crf 
        WHERE event_definition_crf_id IN ($1, $2)
        ORDER BY ordinal
      `, [crfAssignment1Id, crfAssignment2Id]);

      expect(dbResult.rows[0].event_definition_crf_id).toBe(crfAssignment2Id);
      expect(dbResult.rows[0].ordinal).toBe(1);
      expect(dbResult.rows[1].event_definition_crf_id).toBe(crfAssignment1Id);
      expect(dbResult.rows[1].ordinal).toBe(2);

      console.log('✅ CRFs reordered successfully');
    });
  });

  // ============================================
  // SECTION 5: REMOVE CRF FROM EVENT
  // ============================================

  describe('5. Remove CRF from Event', () => {
    
    beforeEach(async () => {
      // Create an assignment to remove
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND crf_id = $2
      `, [testEventId, testCrfId]);

      const result = await pool.query(`
        INSERT INTO event_definition_crf 
        (study_event_definition_id, study_id, crf_id, ordinal, status_id, owner_id, date_created)
        VALUES ($1, $2, $3, 1, 1, 1, NOW())
        RETURNING event_definition_crf_id
      `, [testEventId, testStudyId, testCrfId]);
      
      testEventCrfId = result.rows[0].event_definition_crf_id;
    });

    it('should remove CRF from event (hard delete when no usage)', async () => {
      const response = await request(app)
        .delete(`${TEST_CONFIG.API_BASE}/crf-assignment/${testEventCrfId}`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`);

      console.log('Remove CRF response:', response.body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify deleted from database
      const dbResult = await pool.query(
        'SELECT * FROM event_definition_crf WHERE event_definition_crf_id = $1',
        [testEventCrfId]
      );

      expect(dbResult.rows.length).toBe(0);

      console.log('✅ CRF removed from event successfully');
    });
  });

  // ============================================
  // SECTION 6: BULK ASSIGN CRFs
  // ============================================

  describe('6. Bulk Assign CRFs', () => {
    
    beforeEach(async () => {
      // Clean up existing assignments
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1
      `, [testEventId]);
    });

    it('should bulk assign multiple CRFs', async () => {
      // Get multiple CRFs
      const crfsResult = await pool.query(`
        SELECT crf_id FROM crf WHERE status_id = 1 LIMIT 3
      `);

      if (crfsResult.rows.length < 2) {
        console.log('⚠️ Skipping bulk test - need at least 2 CRFs');
        return;
      }

      const crfAssignments = crfsResult.rows.map((row, index) => ({
        crfId: row.crf_id,
        required: index === 0, // First one required
        ordinal: index + 1
      }));

      const response = await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs/bulk`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ crfAssignments });

      console.log('Bulk assign response:', response.body);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.assignedCount).toBe(crfAssignments.length);

      // Verify in database
      const dbResult = await pool.query(`
        SELECT COUNT(*) as count 
        FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND status_id = 1
      `, [testEventId]);

      expect(parseInt(dbResult.rows[0].count)).toBe(crfAssignments.length);

      console.log(`✅ ${crfAssignments.length} CRFs bulk assigned successfully`);
    });
  });

  // ============================================
  // SECTION 7: GET EVENT CRFs (verify integration)
  // ============================================

  describe('7. Verify Integration - Get Event CRFs', () => {
    
    beforeEach(async () => {
      // Create an assignment
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1
      `, [testEventId]);

      await pool.query(`
        INSERT INTO event_definition_crf 
        (study_event_definition_id, study_id, crf_id, required_crf, double_entry, ordinal, status_id, owner_id, date_created, default_version_id)
        VALUES ($1, $2, $3, true, false, 1, 1, 1, NOW(), $4)
      `, [testEventId, testStudyId, testCrfId, testCrfVersionId]);
    });

    it('should return assigned CRFs with all details', async () => {
      const response = await request(app)
        .get(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`);

      console.log('Get event CRFs response:', {
        status: response.status,
        total: response.body.total,
        crfs: response.body.data
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const crf = response.body.data[0];
      expect(crf).toHaveProperty('event_definition_crf_id');
      expect(crf).toHaveProperty('crf_id');
      expect(crf).toHaveProperty('crf_name');
      expect(crf).toHaveProperty('required_crf');
      expect(crf).toHaveProperty('ordinal');

      console.log('✅ Event CRFs retrieved with all details');
    });
  });

  // ============================================
  // SECTION 8: AUDIT TRAIL VERIFICATION
  // ============================================

  describe('8. Audit Trail Verification', () => {
    
    it('should create audit records for CRF assignment', async () => {
      // Clean up
      await pool.query(`
        DELETE FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND crf_id = $2
      `, [testEventId, testCrfId]);

      // Assign CRF
      const response = await request(app)
        .post(`${TEST_CONFIG.API_BASE}/${testEventId}/crfs`)
        .set('Authorization', `Bearer ${TEST_CONFIG.AUTH_TOKEN}`)
        .send({ crfId: testCrfId, required: true });

      expect(response.body.success).toBe(true);

      // Check audit log
      const auditResult = await pool.query(`
        SELECT * FROM audit_log_event 
        WHERE audit_table = 'event_definition_crf' 
          AND entity_id = $1
        ORDER BY audit_date DESC
        LIMIT 1
      `, [response.body.eventDefinitionCrfId]);

      expect(auditResult.rows.length).toBe(1);
      expect(auditResult.rows[0].entity_name).toBe('Event CRF Assignment');

      console.log('✅ Audit trail created for CRF assignment');
    });
  });
});

// Export for running standalone
export {};

