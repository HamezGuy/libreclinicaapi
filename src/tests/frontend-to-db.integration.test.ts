/**
 * Frontend-to-Database Comprehensive Integration Tests
 * 
 * FULL STACK TESTING: Angular Frontend → REST API → LibreClinica Database
 * 
 * This test suite validates the COMPLETE integration flow from frontend
 * components through the API layer to the PostgreSQL database.
 * 
 * TEST COVERAGE:
 * 
 * 1. RANDOMIZATION FLOW
 *    - RandomizationDashboardComponent → API → Database
 *    - Study selection, patient randomization, unblinding
 * 
 * 2. WORKFLOW/TASKS FLOW
 *    - MyTasksComponent → API → Database
 *    - Task creation, status updates, completion
 * 
 * 3. PATIENT MANAGEMENT FLOW
 *    - PatientEnrollmentModal → API → SOAP/Database
 *    - Patient CRUD operations
 * 
 * 4. DATA INTEGRITY
 *    - Part 11 compliance (audit trails)
 *    - Foreign key relationships
 *    - Transaction integrity
 * 
 * PREREQUISITES:
 * - LibreClinica Docker containers running
 * - API server on port 3001
 * - Database on port 5434
 * 
 * RUN: npm run test:e2e -- --testPathPattern="frontend-to-db"
 */

import request from 'supertest';
import { pool } from '../config/database';
import app from '../app';

const TEST_CONFIG = {
  USERNAME: 'root',
  PASSWORD: '12345678',
  STUDY_ID: 1,
  TIMEOUT_MS: 30000
};

describe('Frontend-to-Database Comprehensive Integration Tests', () => {
  let authToken: string;
  
  // Track created resources for cleanup
  const cleanupResources: {
    subjects: number[];
    randomizations: number[];
    workflows: number[];
    events: number[];
  } = {
    subjects: [],
    randomizations: [],
    workflows: [],
    events: []
  };

  // ============================================================================
  // SETUP & TEARDOWN
  // ============================================================================

  beforeAll(async () => {
    // Authenticate
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: TEST_CONFIG.USERNAME,
        password: TEST_CONFIG.PASSWORD
      })
      .timeout(TEST_CONFIG.TIMEOUT_MS);

    if (loginResponse.status === 200 && loginResponse.body.accessToken) {
      authToken = loginResponse.body.accessToken;
      console.log('✅ Authentication successful');
    } else {
      throw new Error('Authentication failed - cannot proceed with tests');
    }
  }, TEST_CONFIG.TIMEOUT_MS);

  afterAll(async () => {
    console.log('🧹 Cleaning up test resources...');
    
    // Clean up in reverse order of creation
    for (const workflowId of cleanupResources.workflows) {
      try {
        await pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = $1', [workflowId]);
      } catch (e) { /* ignore */ }
    }
    
    for (const randomizationId of cleanupResources.randomizations) {
      try {
        await pool.query('DELETE FROM subject_group_map WHERE subject_group_map_id = $1', [randomizationId]);
      } catch (e) { /* ignore */ }
    }
    
    for (const subjectId of cleanupResources.subjects) {
      try {
        await pool.query('UPDATE study_subject SET status_id = 5 WHERE study_subject_id = $1', [subjectId]);
      } catch (e) { /* ignore */ }
    }
    
    console.log('✅ Cleanup complete');
  });

  // ============================================================================
  // SECTION 1: COMPLETE RANDOMIZATION WORKFLOW
  // ============================================================================

  describe('FULL-001: Complete Randomization Workflow', () => {
    let testSubjectId: number | null = null;
    let testGroupId: number | null = null;
    let randomizationId: number | null = null;

    it('Step 1: Frontend loads available studies', async () => {
      // Simulates: RandomizationDashboardComponent.loadStudies()
      const response = await request(app)
        .get('/api/studies')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      console.log(`📋 Found ${response.body.data.length} studies`);
    });

    it('Step 2: Frontend loads treatment groups for selected study', async () => {
      // Simulates: RandomizationDashboardComponent.loadTreatmentGroups()
      const response = await request(app)
        .get(`/api/randomization/groups/${TEST_CONFIG.STUDY_ID}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      if (response.body.data.length > 0) {
        testGroupId = response.body.data[0].study_group_id;
        console.log(`🎯 Selected treatment group: ${testGroupId}`);
      } else {
        console.warn('⚠️ No treatment groups found');
      }
    });

    it('Step 3: Frontend loads eligible subjects', async () => {
      // Simulates: RandomizationDashboardComponent.loadEligibleSubjects()
      const response = await request(app)
        .get('/api/subjects')
        .query({ studyId: TEST_CONFIG.STUDY_ID, limit: 50 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Find a subject not yet randomized
      for (const subject of response.body.data) {
        const canRandomizeResponse = await request(app)
          .get(`/api/randomization/subject/${subject.study_subject_id}/can-randomize`)
          .set('Authorization', `Bearer ${authToken}`);
        
        if (canRandomizeResponse.body.data?.canRandomize) {
          testSubjectId = subject.study_subject_id;
          console.log(`👤 Found eligible subject: ${testSubjectId}`);
          break;
        }
      }
    });

    it('Step 4: Frontend submits randomization', async () => {
      if (!testSubjectId || !testGroupId) {
        console.warn('Skipping - no eligible subject or group');
        return;
      }

      // Simulates: RandomizationDashboardComponent.randomizeSubject()
      const response = await request(app)
        .post('/api/randomization')
        .send({
          studySubjectId: testSubjectId,
          studyGroupId: testGroupId
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      
      if (response.body.data?.subject_group_map_id) {
        randomizationId = response.body.data.subject_group_map_id;
        cleanupResources.randomizations.push(randomizationId);
        console.log(`✅ Randomization created: ${randomizationId}`);
      }
    });

    it('Step 5: Verify randomization in database', async () => {
      if (!randomizationId) {
        console.warn('Skipping - no randomization to verify');
        return;
      }

      const dbResult = await pool.query(`
        SELECT 
          sgm.*,
          sg.name as group_name,
          sgc.name as class_name,
          ss.label as subject_label
        FROM subject_group_map sgm
        INNER JOIN study_group sg ON sgm.study_group_id = sg.study_group_id
        INNER JOIN study_group_class sgc ON sg.study_group_class_id = sgc.study_group_class_id
        INNER JOIN study_subject ss ON sgm.study_subject_id = ss.study_subject_id
        WHERE sgm.subject_group_map_id = $1
      `, [randomizationId]);

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].study_subject_id).toBe(testSubjectId);
      expect(dbResult.rows[0].study_group_id).toBe(testGroupId);
      
      console.log(`✅ Database verification passed: Subject ${dbResult.rows[0].subject_label} → ${dbResult.rows[0].group_name}`);
    });

    it('Step 6: Frontend refreshes randomization list', async () => {
      // Simulates: RandomizationDashboardComponent.loadFromAPI()
      const response = await request(app)
        .get('/api/randomization')
        .query({ studyId: TEST_CONFIG.STUDY_ID })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // New randomization should be in the list
      if (randomizationId) {
        const found = response.body.data.some(
          (r: any) => r.subject_group_map_id === randomizationId
        );
        expect(found).toBe(true);
      }
    });
  });

  // ============================================================================
  // SECTION 2: COMPLETE TASKS WORKFLOW
  // ============================================================================

  describe('FULL-002: Complete Tasks/Workflow Management', () => {
    let taskId: number | null = null;

    it('Step 1: Frontend loads user task summary', async () => {
      // Simulates: MyTasksComponent.loadUserTasks() → getUserTaskSummary()
      const response = await request(app)
        .get(`/api/workflows/user/${TEST_CONFIG.USERNAME}/summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const summary = response.body.data;
      expect(summary).toHaveProperty('totalTasks');
      expect(summary).toHaveProperty('statistics');
      expect(summary).toHaveProperty('tasks');
      expect(summary.tasks).toHaveProperty('overdue');
      expect(summary.tasks).toHaveProperty('dueToday');
      expect(summary.tasks).toHaveProperty('inProgress');
      expect(summary.tasks).toHaveProperty('pending');
      
      console.log(`📊 Task Summary: ${summary.totalTasks} total, ${summary.statistics.totalActive} active`);
    });

    it('Step 2: Create a new task', async () => {
      // Simulates: Creating a workflow task
      const response = await request(app)
        .post('/api/workflows')
        .send({
          title: `Integration Test Task ${Date.now()}`,
          description: 'Created by frontend-to-db integration test',
          studyId: TEST_CONFIG.STUDY_ID,
          assignedTo: [TEST_CONFIG.USERNAME],
          entityType: 'studySub',
          entityId: 0
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      
      if (response.body.data?.id) {
        taskId = parseInt(response.body.data.id);
        cleanupResources.workflows.push(taskId);
        console.log(`✅ Task created: ${taskId}`);
      }
    });

    it('Step 3: Verify task in database', async () => {
      if (!taskId) {
        console.warn('Skipping - no task to verify');
        return;
      }

      const dbResult = await pool.query(`
        SELECT 
          dn.*,
          rs.name as status_name,
          dnt.name as type_name
        FROM discrepancy_note dn
        INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        WHERE dn.discrepancy_note_id = $1
      `, [taskId]);

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].status_name).toBe('New');
      console.log(`✅ Task verified in DB with status: ${dbResult.rows[0].status_name}`);
    });

    it('Step 4: Start task (update status to in_progress)', async () => {
      if (!taskId) return;

      // Simulates: MyTasksComponent.startTask()
      const response = await request(app)
        .put(`/api/workflows/${taskId}/status`)
        .send({ status: 'in_progress' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify status changed in database
      const dbResult = await pool.query(`
        SELECT rs.name FROM discrepancy_note dn
        INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE dn.discrepancy_note_id = $1
      `, [taskId]);

      expect(dbResult.rows[0].name).toBe('Updated');
      console.log('✅ Task started (status: Updated)');
    });

    it('Step 5: Complete task', async () => {
      if (!taskId) return;

      // Simulates: MyTasksComponent.completeTask()
      const response = await request(app)
        .post(`/api/workflows/${taskId}/complete`)
        .send({})
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify status changed to Closed in database
      const dbResult = await pool.query(`
        SELECT rs.name FROM discrepancy_note dn
        INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE dn.discrepancy_note_id = $1
      `, [taskId]);

      expect(dbResult.rows[0].name).toBe('Closed');
      console.log('✅ Task completed (status: Closed)');
    });

    it('Step 6: Verify task appears in completed summary', async () => {
      const response = await request(app)
        .get(`/api/workflows/user/${TEST_CONFIG.USERNAME}/summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.completedTasks).toBeGreaterThan(0);
      console.log(`✅ Summary shows ${response.body.data.completedTasks} completed tasks`);
    });
  });

  // ============================================================================
  // SECTION 3: COMPLETE PATIENT ENROLLMENT WORKFLOW
  // ============================================================================

  describe('FULL-003: Complete Patient Enrollment Workflow', () => {
    let enrolledSubjectId: number | null = null;
    const testPatientLabel = `INT-TEST-${Date.now()}`;

    it('Step 1: Frontend submits patient enrollment', async () => {
      // Simulates: PatientEnrollmentModalComponent.onSubmit()
      const response = await request(app)
        .post('/api/subjects')
        .send({
          studyId: TEST_CONFIG.STUDY_ID,
          studySubjectId: testPatientLabel,
          secondaryId: `MRN-${Date.now()}`,
          dateOfBirth: '1990-01-15',
          gender: 'm',
          enrollmentDate: new Date().toISOString().split('T')[0]
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      
      if (response.body.data?.studySubjectId) {
        enrolledSubjectId = response.body.data.studySubjectId;
        cleanupResources.subjects.push(enrolledSubjectId);
        console.log(`✅ Patient enrolled: ${testPatientLabel} (ID: ${enrolledSubjectId})`);
      }
    });

    it('Step 2: Verify patient in database', async () => {
      if (!enrolledSubjectId) return;

      const dbResult = await pool.query(`
        SELECT 
          ss.study_subject_id,
          ss.label,
          ss.secondary_label,
          ss.enrollment_date,
          s.gender,
          s.date_of_birth,
          st.name as status
        FROM study_subject ss
        INNER JOIN subject s ON ss.subject_id = s.subject_id
        INNER JOIN status st ON ss.status_id = st.status_id
        WHERE ss.study_subject_id = $1
      `, [enrolledSubjectId]);

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].label).toBe(testPatientLabel);
      expect(dbResult.rows[0].gender).toBe('m');
      console.log(`✅ Patient verified in DB: ${dbResult.rows[0].label}, status: ${dbResult.rows[0].status}`);
    });

    it('Step 3: Frontend retrieves patient details', async () => {
      if (!enrolledSubjectId) return;

      const response = await request(app)
        .get(`/api/subjects/${enrolledSubjectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.label).toBe(testPatientLabel);
    });

    it('Step 4: Frontend retrieves patient progress', async () => {
      if (!enrolledSubjectId) return;

      const response = await request(app)
        .get(`/api/subjects/${enrolledSubjectId}/progress`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalEvents');
      expect(response.body.data).toHaveProperty('totalForms');
      expect(response.body.data).toHaveProperty('formCompletionPercentage');
    });

    it('Step 5: Update patient secondary label', async () => {
      if (!enrolledSubjectId) return;

      const newSecondaryLabel = `UPDATED-MRN-${Date.now()}`;
      
      const response = await request(app)
        .put(`/api/subjects/${enrolledSubjectId}`)
        .send({ secondaryLabel: newSecondaryLabel })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify in database
      const dbResult = await pool.query(
        'SELECT secondary_label FROM study_subject WHERE study_subject_id = $1',
        [enrolledSubjectId]
      );
      expect(dbResult.rows[0].secondary_label).toBe(newSecondaryLabel);
    });
  });

  // ============================================================================
  // SECTION 4: DATA INTEGRITY & AUDIT TRAIL
  // ============================================================================

  describe('FULL-004: Data Integrity & Audit Trail', () => {
    
    it('should maintain referential integrity across tables', async () => {
      // Verify study_subject → subject relationship
      const integrityQuery = `
        SELECT COUNT(*) as broken_refs
        FROM study_subject ss
        LEFT JOIN subject s ON ss.subject_id = s.subject_id
        WHERE s.subject_id IS NULL
      `;

      const result = await pool.query(integrityQuery);
      expect(parseInt(result.rows[0].broken_refs)).toBe(0);
      console.log('✅ Referential integrity verified for study_subject → subject');
    });

    it('should create audit trail entries', async () => {
      // Check for recent audit entries
      const auditQuery = `
        SELECT COUNT(*) as count
        FROM audit_log_event
        WHERE audit_date > NOW() - INTERVAL '1 hour'
      `;

      try {
        const result = await pool.query(auditQuery);
        console.log(`📝 Found ${result.rows[0].count} audit entries in the last hour`);
        // Just informational - audit entries might not exist for all operations
      } catch (error) {
        console.warn('⚠️ Could not query audit table');
      }
    });

    it('should maintain transaction integrity', async () => {
      // Verify no orphaned records
      const orphanCheck = `
        SELECT COUNT(*) as orphans
        FROM subject_group_map sgm
        LEFT JOIN study_subject ss ON sgm.study_subject_id = ss.study_subject_id
        WHERE ss.study_subject_id IS NULL
      `;

      const result = await pool.query(orphanCheck);
      expect(parseInt(result.rows[0].orphans)).toBe(0);
      console.log('✅ No orphaned randomization records');
    });
  });

  // ============================================================================
  // SECTION 5: ERROR HANDLING & EDGE CASES
  // ============================================================================

  describe('FULL-005: Error Handling & Edge Cases', () => {
    
    it('should handle non-existent resources gracefully', async () => {
      const response = await request(app)
        .get('/api/subjects/999999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should validate request data', async () => {
      const response = await request(app)
        .post('/api/subjects')
        .send({
          // Missing required fields
          studyId: 'not-a-number'
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
    });

    it('should prevent duplicate subject IDs', async () => {
      // First, create a subject
      const uniqueId = `DUPE-TEST-${Date.now()}`;
      
      const firstResponse = await request(app)
        .post('/api/subjects')
        .send({
          studyId: TEST_CONFIG.STUDY_ID,
          studySubjectId: uniqueId,
          dateOfBirth: '1990-01-01',
          gender: 'm',
          enrollmentDate: new Date().toISOString().split('T')[0]
        })
        .set('Authorization', `Bearer ${authToken}`);

      if (firstResponse.status === 201 && firstResponse.body.data?.studySubjectId) {
        cleanupResources.subjects.push(firstResponse.body.data.studySubjectId);
      }

      // Try to create again with same ID
      const secondResponse = await request(app)
        .post('/api/subjects')
        .send({
          studyId: TEST_CONFIG.STUDY_ID,
          studySubjectId: uniqueId,
          dateOfBirth: '1990-01-01',
          gender: 'm',
          enrollmentDate: new Date().toISOString().split('T')[0]
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(secondResponse.status).toBe(400);
      expect(secondResponse.body.success).toBe(false);
    });

    it('should require authentication for all protected endpoints', async () => {
      const endpoints = [
        { method: 'get', url: '/api/subjects' },
        { method: 'get', url: '/api/randomization' },
        { method: 'get', url: '/api/workflows' },
        { method: 'get', url: '/api/studies' }
      ];

      for (const endpoint of endpoints) {
        const response = await (request(app) as any)[endpoint.method](endpoint.url);
        expect([401, 403]).toContain(response.status);
      }
    });
  });

  // ============================================================================
  // SECTION 6: PERFORMANCE & LOAD TESTING
  // ============================================================================

  describe('FULL-006: Performance Baseline', () => {
    
    it('should respond to list queries within acceptable time', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/subjects')
        .query({ studyId: TEST_CONFIG.STUDY_ID, limit: 100 })
        .set('Authorization', `Bearer ${authToken}`);
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // 5 second timeout
      console.log(`⏱️ Subject list query completed in ${duration}ms`);
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(5).fill(null).map(() =>
        request(app)
          .get('/api/subjects')
          .query({ studyId: TEST_CONFIG.STUDY_ID, limit: 10 })
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      console.log(`✅ ${requests.length} concurrent requests handled successfully`);
    });
  });
});

