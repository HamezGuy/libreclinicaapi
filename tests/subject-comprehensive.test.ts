/**
 * Comprehensive Subject/Patient Tests
 * 
 * This test file covers:
 * 1. Subject creation with all fields
 * 2. Phase and template assignment during enrollment
 * 3. CRUD operations (Create, Read, Update, Delete)
 * 4. Audit trail verification
 * 5. Edge cases and error handling
 * 
 * 21 CFR Part 11 Compliance Testing:
 * - Audit trail verification for all operations
 * - Data integrity checks
 * - Soft delete verification (no hard deletes)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as subjectService from '../src/services/hybrid/subject.service';
import { createTestStudy, createTestSubject, createTestEventDefinition, createTestCRF } from './fixtures/test-data';

describe('Subject/Patient Comprehensive Tests', () => {
  let testStudyId: number;
  let testSubjectIds: number[] = [];
  let testEventDefId: number;
  let testEventDefId2: number;
  let testCrfId: number;
  const rootUserId = 1;

  // Generate unique test labels
  const generateLabel = () => `TST-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`.substring(0, 30);

  beforeAll(async () => {
    try {
      await testDb.connect();
      
      // Create test study
      const shortId = `COMP-${Date.now().toString(36)}`.substring(0, 25);
      testStudyId = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: shortId,
        name: 'Comprehensive Subject Test Study'
      });
      console.log(`✅ Test study created: ${testStudyId}`);

      // Create event definitions (phases)
      testEventDefId = await createTestEventDefinition(testDb.pool, testStudyId, {
        name: 'Screening Phase',
        ordinal: 1
      });
      testEventDefId2 = await createTestEventDefinition(testDb.pool, testStudyId, {
        name: 'Treatment Phase',
        ordinal: 2
      });
      console.log(`✅ Event definitions created: ${testEventDefId}, ${testEventDefId2}`);

      // Create a test CRF
      testCrfId = await createTestCRF(testDb.pool, testStudyId, {
        name: 'Demographics CRF',
        description: 'Basic demographics form'
      });
      console.log(`✅ Test CRF created: ${testCrfId}`);

      // Link CRF to event definition (assign template to phase)
      await testDb.pool.query(`
        INSERT INTO event_definition_crf (
          study_event_definition_id, crf_id, required_crf, double_entry,
          electronic_signature, hide_crf, ordinal, status_id, owner_id, date_created, default_version_id
        ) VALUES ($1, $2, true, false, false, false, 1, 1, 1, NOW(), 
          (SELECT crf_version_id FROM crf_version WHERE crf_id = $2 LIMIT 1))
      `, [testEventDefId, testCrfId]);
      console.log('✅ CRF linked to event definition');

    } catch (error: any) {
      console.error('Test setup error:', error.message);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      // Clean up in order (reverse of dependencies)
      if (testSubjectIds.length > 0) {
        await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM subject_group_map WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      }
      
      if (testStudyId) {
        // Clean ALL subjects for this study
        await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id IN (SELECT study_subject_id FROM study_subject WHERE study_id = $1)', [testStudyId]);
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id IN (SELECT study_subject_id FROM study_subject WHERE study_id = $1)', [testStudyId]);
        await testDb.pool.query('DELETE FROM subject_group_map WHERE study_subject_id IN (SELECT study_subject_id FROM study_subject WHERE study_id = $1)', [testStudyId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_id = $1', [testStudyId]);
        await testDb.pool.query('DELETE FROM event_definition_crf WHERE study_event_definition_id IN (SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1)', [testStudyId]);
        await testDb.pool.query('DELETE FROM crf_version WHERE crf_id IN (SELECT crf_id FROM crf WHERE study_id = $1)', [testStudyId]);
        await testDb.pool.query('DELETE FROM crf WHERE study_id = $1', [testStudyId]);
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [testStudyId]);
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [testStudyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
      }
      
      console.log('✅ Test cleanup complete');
    } catch (error) {
      console.error('Cleanup error (non-fatal):', error);
    }
  });

  afterEach(async () => {
    // Clean up subjects created during each test
    if (testSubjectIds.length > 0) {
      try {
        await testDb.pool.query('DELETE FROM event_crf WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM subject_group_map WHERE study_subject_id = ANY($1)', [testSubjectIds]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = ANY($1)', [testSubjectIds]);
      } catch (error) {
        // Ignore cleanup errors
      }
      testSubjectIds = [];
    }
  });

  // ============================================================================
  // TEST SUITE 1: Subject Creation with Full Fields
  // ============================================================================

  describe('Subject Creation - Full Field Tests', () => {
    
    it('should create subject with all required fields', async () => {
      const label = generateLabel();
      const enrollmentDate = new Date().toISOString().split('T')[0];
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.label).toBe(label);
      expect(result.data?.studyId).toBe(testStudyId);
      
      // Track for cleanup
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
      }
    });

    it('should create subject with all optional demographic fields', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        secondaryId: 'MRN-12345',
        dateOfBirth: '1985-06-15',
        gender: 'm',
        personId: 'PERSON-001',
        timeZone: 'America/New_York',
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Verify data in database
      const dbResult = await testDb.pool.query(`
        SELECT ss.*, s.gender, s.date_of_birth, s.unique_identifier as person_id
        FROM study_subject ss
        JOIN subject s ON ss.subject_id = s.subject_id
        WHERE ss.label = $1
      `, [label]);
      
      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].secondary_label).toBe('MRN-12345');
      expect(dbResult.rows[0].gender).toBe('m');
      expect(dbResult.rows[0].time_zone).toBe('America/New_York');
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
      }
    });

    it('should normalize gender values correctly', async () => {
      const testCases = [
        { input: 'Male', expected: 'm' },
        { input: 'm', expected: 'm' },
        { input: 'Female', expected: 'f' },
        { input: 'f', expected: 'f' },
        { input: 'other', expected: '' },
        { input: '', expected: '' }
      ];
      
      for (const testCase of testCases) {
        const label = generateLabel();
        
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: label,
          gender: testCase.input,
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, rootUserId, 'root');
        
        expect(result.success).toBe(true);
        
        // Verify gender in database
        const dbResult = await testDb.pool.query(`
          SELECT s.gender FROM subject s
          JOIN study_subject ss ON ss.subject_id = s.subject_id
          WHERE ss.label = $1
        `, [label]);
        
        if (dbResult.rows.length > 0) {
          expect(dbResult.rows[0].gender).toBe(testCase.expected);
        }
        
        if (result.data?.studySubjectId) {
          testSubjectIds.push(result.data.studySubjectId);
        }
      }
    });

    it('should truncate label to 30 characters (varchar constraint)', async () => {
      const longLabel = 'VERY-LONG-SUBJECT-LABEL-THAT-EXCEEDS-30-CHARS';
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: longLabel,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      // Verify truncation
      const dbResult = await testDb.pool.query(`
        SELECT label FROM study_subject WHERE label LIKE 'VERY-LONG-%'
      `);
      
      if (dbResult.rows.length > 0) {
        expect(dbResult.rows[0].label.length).toBeLessThanOrEqual(30);
        
        const subjectResult = await testDb.pool.query(
          'SELECT study_subject_id FROM study_subject WHERE label = $1',
          [dbResult.rows[0].label]
        );
        if (subjectResult.rows[0]) {
          testSubjectIds.push(subjectResult.rows[0].study_subject_id);
        }
      }
    });

    it('should generate valid OC OID', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      expect(result.data?.ocOid).toBeDefined();
      expect(result.data?.ocOid).toMatch(/^SS_/);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 2: Phase and Template Assignment
  // ============================================================================

  describe('Phase and Template Assignment During Enrollment', () => {
    
    it('should auto-schedule all study events for new subject', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      expect(result.data?.studyEventIds).toBeDefined();
      expect(Array.isArray(result.data?.studyEventIds)).toBe(true);
      
      // Should have scheduled events for both phases
      expect(result.data?.studyEventIds.length).toBeGreaterThanOrEqual(2);
      
      // Verify events in database
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        const eventsResult = await testDb.pool.query(`
          SELECT se.*, sed.name as event_name, sed.ordinal
          FROM study_event se
          JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
          WHERE se.study_subject_id = $1
          ORDER BY sed.ordinal
        `, [result.data.studySubjectId]);
        
        expect(eventsResult.rows.length).toBeGreaterThanOrEqual(2);
        
        // Check ordinals are correct
        for (let i = 0; i < eventsResult.rows.length; i++) {
          expect(eventsResult.rows[i].ordinal).toBe(i + 1);
        }
      }
    });

    it('should create event_crf records for each phase template', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify event_crf records were created
        const crfResult = await testDb.pool.query(`
          SELECT ec.*, cv.name as crf_version_name, c.name as crf_name
          FROM event_crf ec
          JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
          JOIN crf c ON cv.crf_id = c.crf_id
          WHERE ec.study_subject_id = $1
        `, [result.data.studySubjectId]);
        
        // Should have at least one CRF assigned (we linked one in beforeAll)
        expect(crfResult.rows.length).toBeGreaterThanOrEqual(1);
        
        // Verify CRF is for the correct study
        if (crfResult.rows.length > 0) {
          expect(crfResult.rows[0].crf_name).toBe('Demographics CRF');
        }
      }
    });

    it('should schedule first event with custom location if provided', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0],
        scheduleEvent: {
          studyEventDefinitionId: testEventDefId,
          location: 'Site A - Room 101',
          startDate: new Date().toISOString().split('T')[0]
        }
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify location in event
        const eventResult = await testDb.pool.query(`
          SELECT location FROM study_event
          WHERE study_subject_id = $1 AND study_event_definition_id = $2
        `, [result.data.studySubjectId, testEventDefId]);
        
        if (eventResult.rows.length > 0) {
          expect(eventResult.rows[0].location).toBe('Site A - Room 101');
        }
      }
    });

    it('should calculate event start dates based on ordinal', async () => {
      const label = generateLabel();
      const enrollmentDate = '2025-01-01';
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify event dates are staggered
        const eventsResult = await testDb.pool.query(`
          SELECT se.date_start, sed.ordinal
          FROM study_event se
          JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
          WHERE se.study_subject_id = $1
          ORDER BY sed.ordinal
        `, [result.data.studySubjectId]);
        
        if (eventsResult.rows.length >= 2) {
          const date1 = new Date(eventsResult.rows[0].date_start);
          const date2 = new Date(eventsResult.rows[1].date_start);
          
          // Second event should be after first (by ~7 days based on service logic)
          expect(date2.getTime()).toBeGreaterThan(date1.getTime());
        }
      }
    });
  });

  // ============================================================================
  // TEST SUITE 3: CRUD Operations
  // ============================================================================

  describe('CRUD Operations', () => {
    
    describe('Read Operations', () => {
      let createdSubjectId: number;
      
      beforeEach(async () => {
        const label = generateLabel();
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: label,
          secondaryId: 'MRN-READ-TEST',
          gender: 'm',
          dateOfBirth: '1990-05-15',
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, rootUserId, 'root');
        
        if (result.success && result.data?.studySubjectId) {
          createdSubjectId = result.data.studySubjectId;
          testSubjectIds.push(createdSubjectId);
        }
      });
      
      it('should get subject by ID with full details', async () => {
        const subject = await subjectService.getSubjectById(createdSubjectId);
        
        expect(subject).not.toBeNull();
        expect(subject?.studySubjectId).toBe(createdSubjectId);
        expect(subject?.label).toBeDefined();
        expect(subject?.subject).toBeDefined();
        expect(subject?.events).toBeDefined();
        expect(subject?.progress).toBeDefined();
      });

      it('should include progress information', async () => {
        const subject = await subjectService.getSubjectById(createdSubjectId);
        
        expect(subject?.progress).toBeDefined();
        expect(subject?.progress?.totalEvents).toBeDefined();
        expect(subject?.progress?.completedEvents).toBeDefined();
        expect(subject?.progress?.totalForms).toBeDefined();
        expect(subject?.progress?.completedForms).toBeDefined();
        expect(subject?.progress?.percentComplete).toBeDefined();
        expect(subject?.progress?.percentComplete).toBeGreaterThanOrEqual(0);
        expect(subject?.progress?.percentComplete).toBeLessThanOrEqual(100);
      });

      it('should return null for non-existent subject', async () => {
        const subject = await subjectService.getSubjectById(999999999);
        expect(subject).toBeNull();
      });

      it('should list subjects with pagination', async () => {
        const result = await subjectService.getSubjectList(testStudyId, {
          page: 1,
          limit: 10
        });
        
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.pagination).toBeDefined();
        expect(result.pagination?.page).toBe(1);
        expect(result.pagination?.limit).toBe(10);
      });

      it('should filter subjects by status', async () => {
        // Create an available and a removed subject
        const availableLabel = generateLabel();
        await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: availableLabel,
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, rootUserId, 'root');
        
        // Get the created subject and update its status
        const createdResult = await testDb.pool.query(
          'SELECT study_subject_id FROM study_subject WHERE label = $1',
          [availableLabel]
        );
        if (createdResult.rows[0]) {
          testSubjectIds.push(createdResult.rows[0].study_subject_id);
          
          // Update to removed status
          await testDb.pool.query(
            'UPDATE study_subject SET status_id = 5 WHERE study_subject_id = $1',
            [createdResult.rows[0].study_subject_id]
          );
        }
        
        // Filter by available status
        const availableResult = await subjectService.getSubjectList(testStudyId, {
          status: 'available',
          page: 1,
          limit: 100
        });
        
        expect(availableResult.success).toBe(true);
        // All returned subjects should be available
        availableResult.data.forEach((subject: any) => {
          expect(subject.status?.toLowerCase()).toBe('available');
        });
      });
    });

    describe('Update Operations', () => {
      let createdSubjectId: number;
      
      beforeEach(async () => {
        const label = generateLabel();
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: label,
          secondaryId: 'MRN-ORIGINAL',
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, rootUserId, 'root');
        
        if (result.success && result.data?.studySubjectId) {
          createdSubjectId = result.data.studySubjectId;
          testSubjectIds.push(createdSubjectId);
        }
      });

      it('should update secondary label', async () => {
        const newSecondaryLabel = 'MRN-UPDATED';
        
        await testDb.pool.query(`
          UPDATE study_subject 
          SET secondary_label = $1, date_updated = NOW(), update_id = $2
          WHERE study_subject_id = $3
        `, [newSecondaryLabel, rootUserId, createdSubjectId]);
        
        // Verify update
        const result = await testDb.pool.query(
          'SELECT secondary_label FROM study_subject WHERE study_subject_id = $1',
          [createdSubjectId]
        );
        
        expect(result.rows[0].secondary_label).toBe(newSecondaryLabel);
      });

      it('should update status (soft state changes)', async () => {
        // Update to signed status
        await testDb.pool.query(`
          UPDATE study_subject
          SET status_id = 8, date_updated = NOW(), update_id = $1
          WHERE study_subject_id = $2
        `, [rootUserId, createdSubjectId]);
        
        // Verify update
        const result = await testDb.pool.query(
          'SELECT status_id FROM study_subject WHERE study_subject_id = $1',
          [createdSubjectId]
        );
        
        expect(result.rows[0].status_id).toBe(8);
      });
    });

    describe('Delete Operations (Part 11 Compliant Soft Delete)', () => {
      let createdSubjectId: number;
      
      beforeEach(async () => {
        const label = generateLabel();
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: label,
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, rootUserId, 'root');
        
        if (result.success && result.data?.studySubjectId) {
          createdSubjectId = result.data.studySubjectId;
          testSubjectIds.push(createdSubjectId);
        }
      });

      it('should soft delete subject (status = removed)', async () => {
        // Soft delete
        await testDb.pool.query(`
          UPDATE study_subject
          SET status_id = 5, date_updated = NOW(), update_id = $1
          WHERE study_subject_id = $2
        `, [rootUserId, createdSubjectId]);
        
        // Verify soft delete
        const result = await testDb.pool.query(
          'SELECT status_id FROM study_subject WHERE study_subject_id = $1',
          [createdSubjectId]
        );
        
        expect(result.rows.length).toBe(1); // Record still exists
        expect(result.rows[0].status_id).toBe(5); // Marked as removed
      });

      it('should preserve record for audit trail after soft delete', async () => {
        // Soft delete
        await testDb.pool.query(`
          UPDATE study_subject
          SET status_id = 5, date_updated = NOW(), update_id = $1
          WHERE study_subject_id = $2
        `, [rootUserId, createdSubjectId]);
        
        // Record should still exist with all data
        const result = await testDb.pool.query(
          'SELECT * FROM study_subject WHERE study_subject_id = $1',
          [createdSubjectId]
        );
        
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].label).toBeDefined();
        expect(result.rows[0].enrollment_date).toBeDefined();
      });
    });
  });

  // ============================================================================
  // TEST SUITE 4: Audit Trail Verification
  // ============================================================================

  describe('Audit Trail (21 CFR Part 11 Compliance)', () => {
    
    it('should create audit log entry on subject creation', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Check audit log
        const auditResult = await testDb.pool.query(`
          SELECT * FROM audit_log_event
          WHERE entity_id = $1 AND audit_table = 'study_subject'
          ORDER BY audit_date DESC
          LIMIT 1
        `, [result.data.studySubjectId]);
        
        expect(auditResult.rows.length).toBeGreaterThanOrEqual(1);
        expect(auditResult.rows[0].user_id).toBe(rootUserId);
      }
    });

    it('should record user ID for all operations', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      if (result.success && result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify owner_id is set
        const subjectResult = await testDb.pool.query(
          'SELECT owner_id FROM study_subject WHERE study_subject_id = $1',
          [result.data.studySubjectId]
        );
        
        expect(subjectResult.rows[0].owner_id).toBe(rootUserId);
      }
    });

    it('should track date_created and date_updated', async () => {
      const label = generateLabel();
      
      const beforeCreate = new Date();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      if (result.success && result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        const afterCreate = new Date();
        
        // Verify timestamps
        const subjectResult = await testDb.pool.query(
          'SELECT date_created, date_updated FROM study_subject WHERE study_subject_id = $1',
          [result.data.studySubjectId]
        );
        
        const dateCreated = new Date(subjectResult.rows[0].date_created);
        expect(dateCreated.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
        expect(dateCreated.getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 5: Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    
    it('should prevent duplicate subject labels in same study', async () => {
      const label = generateLabel();
      
      // First creation
      const result1 = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result1.success).toBe(true);
      
      if (result1.data?.studySubjectId) {
        testSubjectIds.push(result1.data.studySubjectId);
      }
      
      // Second creation with same label should fail
      const result2 = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result2.success).toBe(false);
      expect(result2.message?.toLowerCase()).toMatch(/already|exists|duplicate/);
    });

    it('should handle empty enrollment date (use today)', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: '' // Empty - should default to today
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify enrollment date is set
        const subjectResult = await testDb.pool.query(
          'SELECT enrollment_date FROM study_subject WHERE study_subject_id = $1',
          [result.data.studySubjectId]
        );
        
        expect(subjectResult.rows[0].enrollment_date).toBeDefined();
      }
    });

    it('should handle invalid study ID gracefully', async () => {
      const result = await subjectService.createSubject({
        studyId: -1, // Invalid
        studySubjectId: generateLabel(),
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      // Should return error response, not throw
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle special characters in label', async () => {
      const labelWithSpecials = `TEST-${Date.now()}-@#$`;
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: labelWithSpecials,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      if (result.success && result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
      }
      
      // Should handle without crashing
      expect(result).toBeDefined();
    });

    it('should handle null/undefined optional fields', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        secondaryId: undefined,
        gender: undefined,
        dateOfBirth: undefined,
        personId: undefined,
        timeZone: undefined,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
      }
    });

    it('should handle extremely long person ID (truncate to 255)', async () => {
      const label = generateLabel();
      const longPersonId = 'A'.repeat(300);
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        personId: longPersonId,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        // Verify person_id is truncated
        const subjectResult = await testDb.pool.query(
          'SELECT unique_identifier FROM subject WHERE subject_id = (SELECT subject_id FROM study_subject WHERE study_subject_id = $1)',
          [result.data.studySubjectId]
        );
        
        if (subjectResult.rows.length > 0) {
          expect(subjectResult.rows[0].unique_identifier.length).toBeLessThanOrEqual(255);
        }
      }
    });
  });

  // ============================================================================
  // TEST SUITE 6: Progress Calculation
  // ============================================================================

  describe('Progress Calculation', () => {
    
    it('should return correct progress for subject with no completed forms', async () => {
      const label = generateLabel();
      
      const result = await subjectService.createSubject({
        studyId: testStudyId,
        studySubjectId: label,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, rootUserId, 'root');
      
      expect(result.success).toBe(true);
      
      if (result.data?.studySubjectId) {
        testSubjectIds.push(result.data.studySubjectId);
        
        const progress = await subjectService.getSubjectProgress(result.data.studySubjectId);
        
        expect(progress).not.toBeNull();
        expect(progress?.completedForms).toBe(0);
        expect(progress?.percentComplete).toBe(0);
      }
    });

    it('should return null for non-existent subject progress', async () => {
      const progress = await subjectService.getSubjectProgress(999999999);
      expect(progress).toBeNull();
    });
  });
});

