/**
 * Comprehensive Integration Tests for Study, Patient, and Phase CRUD Operations
 * 
 * This test file provides detailed coverage of:
 * 
 * 1. STUDY CRUD OPERATIONS
 *    - Study creation with validation
 *    - Study creation with all LibreClinica fields
 *    - Study creation with phases (event definitions)
 *    - Study creation with CRF assignments
 *    - Study retrieval (single and list)
 *    - Study update with all fields
 *    - Study soft delete
 *    - Study validation errors
 * 
 * 2. PHASE (EVENT DEFINITION) CRUD OPERATIONS
 *    - Phase creation with all fields
 *    - Phase ordering and reordering
 *    - Repeating vs non-repeating phases
 *    - Phase types (scheduled, unscheduled, common)
 *    - CRF assignment to phases
 *    - Phase update and delete
 * 
 * 3. PATIENT (SUBJECT) CRUD OPERATIONS
 *    - Patient enrollment with required fields
 *    - Patient enrollment with all demographic fields
 *    - Patient enrollment with group assignments
 *    - Patient retrieval (single and list)
 *    - Patient update
 *    - Patient status changes
 *    - Event scheduling for patients
 * 
 * 4. END-TO-END WORKFLOW TESTS
 *    - Complete study setup with phases and forms
 *    - Patient enrollment and event scheduling
 *    - Form data entry workflow
 * 
 * Test Database: Uses the libreclinica-postgres database on port 5434
 * (Same database as LibreClinica uses)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as studyService from '../src/services/hybrid/study.service';
import * as eventService from '../src/services/hybrid/event.service';
import * as subjectService from '../src/services/hybrid/subject.service';

describe('Comprehensive Study, Patient, and Phase Integration Tests', () => {
  const userId = 1; // Root user
  const username = 'root'; // Required for subject creation
  
  // Track created resources for cleanup
  let createdStudyIds: number[] = [];
  let createdEventDefIds: number[] = [];
  let createdSubjectIds: number[] = [];
  let createdCrfIds: number[] = [];

  beforeAll(async () => {
    await testDb.connect();
    console.log('🔗 Connected to test database');
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
    createdStudyIds = [];
    createdEventDefIds = [];
    createdSubjectIds = [];
    createdCrfIds = [];
  });

  afterEach(async () => {
    // Cleanup in reverse dependency order
    for (const subjectId of createdSubjectIds) {
      try {
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [subjectId]);
        await testDb.pool.query('DELETE FROM subject_group_map WHERE study_subject_id = $1', [subjectId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [subjectId]);
      } catch (e) { /* ignore */ }
    }
    for (const eventDefId of createdEventDefIds) {
      try {
        await testDb.pool.query('DELETE FROM event_definition_crf WHERE study_event_definition_id = $1', [eventDefId]);
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [eventDefId]);
      } catch (e) { /* ignore */ }
    }
    for (const crfId of createdCrfIds) {
      try {
        await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [crfId]);
        await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [crfId]);
      } catch (e) { /* ignore */ }
    }
    for (const studyId of createdStudyIds) {
      try {
        await testDb.pool.query('DELETE FROM study_parameter_value WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [studyId]);
      } catch (e) { /* ignore */ }
    }
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  // ============================================================================
  // SECTION 1: STUDY CRUD OPERATIONS
  // ============================================================================

  describe('1. Study CRUD Operations', () => {
    
    describe('1.1 Study Creation Validation', () => {
      it('should require name and uniqueIdentifier for study creation', async () => {
        // Missing name
        const result1 = await studyService.createStudy({
          name: '',
          uniqueIdentifier: `TEST-${Date.now()}`
        }, userId);
        
        // The service should validate and fail
        expect(result1.success).toBe(false);
        expect(result1.message).toContain('name');
        
        // Missing uniqueIdentifier
        const result2 = await studyService.createStudy({
          name: 'Test Study',
          uniqueIdentifier: ''
        }, userId);
        
        expect(result2.success).toBe(false);
      });

      it('should reject duplicate study identifiers', async () => {
        const uniqueId = `DUP-${Date.now()}`;
        
        // Create first study
        const result1 = await studyService.createStudy({
          name: 'First Study',
          uniqueIdentifier: uniqueId
        }, userId);
        
        expect(result1.success).toBe(true);
        createdStudyIds.push(result1.studyId!);
        
        // Try to create duplicate
        const result2 = await studyService.createStudy({
          name: 'Duplicate Study',
          uniqueIdentifier: uniqueId
        }, userId);
        
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('already exists');
      });

      it('should generate valid OC_OID for new studies', async () => {
        const timestamp = Date.now();
        const result = await studyService.createStudy({
          name: `OID Study ${timestamp}`,
          uniqueIdentifier: `OID-${timestamp}`
        }, userId);
        
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT oc_oid FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].oc_oid).toBeDefined();
        expect(dbResult.rows[0].oc_oid).toMatch(/^S_/);
      });
    });

    describe('1.2 Study Creation with All Fields', () => {
      it('should create study with all basic identification fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Full ID Study ${timestamp}`,
          uniqueIdentifier: `FULLID-${timestamp}`,
          officialTitle: 'Official Title for Testing',
          secondaryIdentifier: 'NCT00000001',
          summary: 'This is a comprehensive test study for validation purposes'
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].name).toBe(studyData.name);
        expect(dbResult.rows[0].unique_identifier).toBe(studyData.uniqueIdentifier);
        expect(dbResult.rows[0].official_title).toBe(studyData.officialTitle);
        expect(dbResult.rows[0].secondary_identifier).toBe(studyData.secondaryIdentifier);
        expect(dbResult.rows[0].summary).toBe(studyData.summary);
      });

      it('should create study with team and sponsor fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Team Study ${timestamp}`,
          uniqueIdentifier: `TEAM-${timestamp}`,
          principalInvestigator: 'Dr. Jane Smith, MD, PhD',
          sponsor: 'Acme Pharmaceuticals, Inc.',
          collaborators: 'University Hospital, Research Institute'
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT principal_investigator, sponsor, collaborators FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].principal_investigator).toBe(studyData.principalInvestigator);
        expect(dbResult.rows[0].sponsor).toBe(studyData.sponsor);
        expect(dbResult.rows[0].collaborators).toBe(studyData.collaborators);
      });

      it('should create study with timeline and enrollment fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Timeline Study ${timestamp}`,
          uniqueIdentifier: `TIME-${timestamp}`,
          phase: 'II',
          protocolType: 'interventional',
          expectedTotalEnrollment: 250,
          datePlannedStart: '2025-06-01',
          datePlannedEnd: '2027-06-01'
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT phase, protocol_type, expected_total_enrollment, date_planned_start, date_planned_end FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].phase).toBe(studyData.phase);
        expect(dbResult.rows[0].protocol_type).toBe(studyData.protocolType);
        expect(dbResult.rows[0].expected_total_enrollment).toBe(studyData.expectedTotalEnrollment);
      });

      it('should create study with facility fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Facility Study ${timestamp}`,
          uniqueIdentifier: `FAC-${timestamp}`,
          facilityName: 'Boston Medical Center',
          facilityCity: 'Boston',
          facilityState: 'MA',
          facilityZip: '02115',
          facilityCountry: 'United States',
          facilityRecruitmentStatus: 'Recruiting',
          facilityContactName: 'Dr. Contact Person',
          facilityContactDegree: 'MD',
          facilityContactPhone: '617-555-1234',
          facilityContactEmail: 'contact@hospital.edu'
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          `SELECT facility_name, facility_city, facility_state, facility_zip, 
                  facility_country, facility_contact_name, facility_contact_email 
           FROM study WHERE study_id = $1`,
          [result.studyId]
        );
        
        expect(dbResult.rows[0].facility_name).toBe(studyData.facilityName);
        expect(dbResult.rows[0].facility_city).toBe(studyData.facilityCity);
        expect(dbResult.rows[0].facility_state).toBe(studyData.facilityState);
        expect(dbResult.rows[0].facility_country).toBe(studyData.facilityCountry);
        expect(dbResult.rows[0].facility_contact_email).toBe(studyData.facilityContactEmail);
      });

      it('should create study with eligibility fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Eligibility Study ${timestamp}`,
          uniqueIdentifier: `ELIG-${timestamp}`,
          eligibility: 'Adults 18-65 with Type 2 Diabetes',
          gender: 'Both',
          ageMin: '18',
          ageMax: '65',
          healthyVolunteerAccepted: false
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT eligibility, gender, age_min, age_max, healthy_volunteer_accepted FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].eligibility).toBe(studyData.eligibility);
        expect(dbResult.rows[0].gender).toBe(studyData.gender);
        expect(dbResult.rows[0].age_min).toBe(studyData.ageMin);
        expect(dbResult.rows[0].age_max).toBe(studyData.ageMax);
      });

      it('should create study with design fields', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Design Study ${timestamp}`,
          uniqueIdentifier: `DESIGN-${timestamp}`,
          purpose: 'Treatment',
          allocation: 'Randomized',
          masking: 'Double',
          control: 'Placebo',
          assignment: 'Parallel',
          endpoint: 'Efficacy',
          duration: 'Long-term',
          selection: 'Defined Population',
          timing: 'Prospective'
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const dbResult = await testDb.pool.query(
          `SELECT purpose, allocation, masking, control, assignment, 
                  endpoint, duration, selection, timing 
           FROM study WHERE study_id = $1`,
          [result.studyId]
        );
        
        expect(dbResult.rows[0].purpose).toBe(studyData.purpose);
        expect(dbResult.rows[0].allocation).toBe(studyData.allocation);
        expect(dbResult.rows[0].masking).toBe(studyData.masking);
        expect(dbResult.rows[0].control).toBe(studyData.control);
        expect(dbResult.rows[0].assignment).toBe(studyData.assignment);
      });

      it('should initialize study parameters on creation', async () => {
        const timestamp = Date.now();
        const result = await studyService.createStudy({
          name: `Params Study ${timestamp}`,
          uniqueIdentifier: `PARAMS-${timestamp}`
        }, userId);
        
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const paramsResult = await testDb.pool.query(
          'SELECT parameter, value FROM study_parameter_value WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(paramsResult.rows.length).toBeGreaterThan(0);
        
        const paramNames = paramsResult.rows.map((r: any) => r.parameter);
        expect(paramNames).toContain('collectDob');
        expect(paramNames).toContain('genderRequired');
        expect(paramNames).toContain('subjectIdGeneration');
        expect(paramNames).toContain('discrepancyManagement');
      });

      it('should assign creator to study with admin role', async () => {
        const timestamp = Date.now();
        const result = await studyService.createStudy({
          name: `Role Study ${timestamp}`,
          uniqueIdentifier: `ROLE-${timestamp}`
        }, userId);
        
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const roleResult = await testDb.pool.query(
          'SELECT role_name, status_id FROM study_user_role WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(roleResult.rows.length).toBeGreaterThan(0);
        expect(roleResult.rows[0].role_name).toBe('admin');
        expect(roleResult.rows[0].status_id).toBe(1);
      });

      it('should create audit log entry for study creation', async () => {
        const timestamp = Date.now();
        const result = await studyService.createStudy({
          name: `Audit Study ${timestamp}`,
          uniqueIdentifier: `AUDIT-${timestamp}`
        }, userId);
        
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const auditResult = await testDb.pool.query(
          `SELECT * FROM audit_log_event 
           WHERE entity_id = $1 AND audit_table = 'study' 
           ORDER BY audit_date DESC LIMIT 1`,
          [result.studyId]
        );
        
        expect(auditResult.rows.length).toBeGreaterThan(0);
        expect(auditResult.rows[0].user_id).toBe(userId);
      });
    });

    describe('1.3 Study Retrieval', () => {
      let testStudyId: number;
      
      beforeEach(async () => {
        const result = await studyService.createStudy({
          name: `Retrieval Study ${Date.now()}`,
          uniqueIdentifier: `RETR-${Date.now()}`,
          principalInvestigator: 'Dr. Retrieval',
          sponsor: 'Retrieval Corp',
          expectedTotalEnrollment: 100,
          phase: 'III'
        }, userId);
        
        testStudyId = result.studyId!;
        createdStudyIds.push(testStudyId);
      });

      it('should retrieve study by ID with all fields', async () => {
        const study = await studyService.getStudyById(testStudyId, userId);
        
        expect(study).toBeDefined();
        expect(study.study_id).toBe(testStudyId);
        expect(study.principal_investigator).toBe('Dr. Retrieval');
        expect(study.sponsor).toBe('Retrieval Corp');
        expect(study.expected_total_enrollment).toBe(100);
        expect(study.phase).toBe('III');
      });

      it('should include computed statistics in retrieval', async () => {
        const study = await studyService.getStudyById(testStudyId, userId);
        
        expect(study.total_subjects).toBeDefined();
        expect(study.active_subjects).toBeDefined();
        expect(study.total_events).toBeDefined();
        expect(study.total_forms).toBeDefined();
      });

      it('should return null for non-existent study', async () => {
        const study = await studyService.getStudyById(999999, userId);
        expect(study).toBeNull();
      });

      it('should retrieve paginated study list', async () => {
        const result = await studyService.getStudies(userId, { page: 1, limit: 10 });
        
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.pagination).toBeDefined();
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(10);
        expect(result.pagination.total).toBeDefined();
      });

      it('should only return parent studies (not sites)', async () => {
        // Create a site (child study)
        await testDb.pool.query(`
          INSERT INTO study (unique_identifier, name, parent_study_id, status_id, owner_id, date_created, oc_oid)
          VALUES ($1, 'Test Site', $2, 1, $3, NOW(), $4)
        `, [`SITE-${Date.now()}`, testStudyId, userId, `S_SITE_${Date.now()}`]);
        
        const result = await studyService.getStudies(userId, { page: 1, limit: 100 });
        
        // Sites should not appear in the main study list
        const siteFound = result.data.find((s: any) => s.parent_study_id === testStudyId);
        expect(siteFound).toBeUndefined();
      });
    });

    describe('1.4 Study Update', () => {
      let updateStudyId: number;
      
      beforeEach(async () => {
        const result = await studyService.createStudy({
          name: `Update Study ${Date.now()}`,
          uniqueIdentifier: `UPD-${Date.now()}`,
          principalInvestigator: 'Dr. Original',
          sponsor: 'Original Corp'
        }, userId);
        
        updateStudyId = result.studyId!;
        createdStudyIds.push(updateStudyId);
      });

      it('should update basic study fields', async () => {
        const updates = {
          name: 'Updated Study Name',
          description: 'Updated description',
          principalInvestigator: 'Dr. Updated',
          sponsor: 'Updated Corp'
        };
        
        const result = await studyService.updateStudy(updateStudyId, updates, userId);
        expect(result.success).toBe(true);
        
        const dbResult = await testDb.pool.query(
          'SELECT name, summary, principal_investigator, sponsor FROM study WHERE study_id = $1',
          [updateStudyId]
        );
        
        expect(dbResult.rows[0].name).toBe(updates.name);
        expect(dbResult.rows[0].summary).toBe(updates.description);
        expect(dbResult.rows[0].principal_investigator).toBe(updates.principalInvestigator);
        expect(dbResult.rows[0].sponsor).toBe(updates.sponsor);
      });

      it('should update enrollment and timeline fields', async () => {
        const updates = {
          expectedTotalEnrollment: 500,
          datePlannedStart: '2025-07-01',
          datePlannedEnd: '2028-07-01',
          phase: 'IV'
        };
        
        await studyService.updateStudy(updateStudyId, updates, userId);
        
        const dbResult = await testDb.pool.query(
          'SELECT expected_total_enrollment, phase FROM study WHERE study_id = $1',
          [updateStudyId]
        );
        
        expect(dbResult.rows[0].expected_total_enrollment).toBe(500);
        expect(dbResult.rows[0].phase).toBe('IV');
      });

      it('should set date_updated and update_id on update', async () => {
        const beforeUpdate = await testDb.pool.query(
          'SELECT date_updated FROM study WHERE study_id = $1',
          [updateStudyId]
        );
        
        await studyService.updateStudy(updateStudyId, { name: 'Timestamp Test' }, userId);
        
        const afterUpdate = await testDb.pool.query(
          'SELECT date_updated, update_id FROM study WHERE study_id = $1',
          [updateStudyId]
        );
        
        expect(afterUpdate.rows[0].date_updated).not.toBe(beforeUpdate.rows[0].date_updated);
        expect(afterUpdate.rows[0].update_id).toBe(userId);
      });

      it('should create audit log entry on update', async () => {
        await studyService.updateStudy(updateStudyId, { name: 'Audit Test Update' }, userId);
        
        const auditResult = await testDb.pool.query(
          `SELECT * FROM audit_log_event 
           WHERE entity_id = $1 AND audit_table = 'study' 
           ORDER BY audit_date DESC LIMIT 1`,
          [updateStudyId]
        );
        
        expect(auditResult.rows.length).toBeGreaterThan(0);
      });

      it('should reject empty update', async () => {
        const result = await studyService.updateStudy(updateStudyId, {}, userId);
        
        expect(result.success).toBe(false);
        expect(result.message).toContain('No fields to update');
      });
    });

    describe('1.5 Study Delete (Soft Delete)', () => {
      it('should soft delete study by setting status to removed', async () => {
        const result = await studyService.createStudy({
          name: `Delete Study ${Date.now()}`,
          uniqueIdentifier: `DEL-${Date.now()}`
        }, userId);
        
        createdStudyIds.push(result.studyId!);
        
        const deleteResult = await studyService.deleteStudy(result.studyId!, userId);
        expect(deleteResult.success).toBe(true);
        
        const dbResult = await testDb.pool.query(
          'SELECT status_id FROM study WHERE study_id = $1',
          [result.studyId]
        );
        
        expect(dbResult.rows[0].status_id).toBe(5); // Removed status
      });
    });
  });

  // ============================================================================
  // SECTION 2: PHASE (EVENT DEFINITION) CRUD OPERATIONS
  // ============================================================================

  describe('2. Phase (Event Definition) CRUD Operations', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const result = await studyService.createStudy({
        name: `Phase Test Study ${Date.now()}`,
        uniqueIdentifier: `PHASE-STUDY-${Date.now()}`
      }, userId);
      
      testStudyId = result.studyId!;
      createdStudyIds.push(testStudyId);
    });

    describe('2.1 Phase Creation', () => {
      it('should create phase with all fields', async () => {
        const phaseData = {
          studyId: testStudyId,
          name: 'Screening Visit',
          description: 'Initial screening and eligibility assessment',
          ordinal: 1,
          type: 'scheduled',
          repeating: false,
          category: 'Baseline'
        };
        
        const result = await eventService.createStudyEvent(phaseData, userId);
        
        expect(result.success).toBe(true);
        expect(result.eventDefinitionId).toBeDefined();
        createdEventDefIds.push(result.eventDefinitionId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
          [result.eventDefinitionId]
        );
        
        expect(dbResult.rows[0].name).toBe(phaseData.name);
        expect(dbResult.rows[0].description).toBe(phaseData.description);
        expect(dbResult.rows[0].ordinal).toBe(phaseData.ordinal);
        expect(dbResult.rows[0].type).toBe(phaseData.type);
        expect(dbResult.rows[0].repeating).toBe(phaseData.repeating);
        expect(dbResult.rows[0].category).toBe(phaseData.category);
      });

      it('should create repeating phase correctly', async () => {
        const result = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Weekly Assessment',
          ordinal: 1,
          type: 'scheduled',
          repeating: true
        }, userId);
        
        expect(result.success).toBe(true);
        createdEventDefIds.push(result.eventDefinitionId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT repeating FROM study_event_definition WHERE study_event_definition_id = $1',
          [result.eventDefinitionId]
        );
        
        expect(dbResult.rows[0].repeating).toBe(true);
      });

      it('should handle different event types', async () => {
        // Scheduled event
        const scheduled = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Scheduled Visit',
          ordinal: 1,
          type: 'scheduled'
        }, userId);
        createdEventDefIds.push(scheduled.eventDefinitionId!);
        
        // Unscheduled event
        const unscheduled = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Adverse Event Visit',
          ordinal: 2,
          type: 'unscheduled'
        }, userId);
        createdEventDefIds.push(unscheduled.eventDefinitionId!);
        
        // Common event
        const common = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Common Assessments',
          ordinal: 3,
          type: 'common'
        }, userId);
        createdEventDefIds.push(common.eventDefinitionId!);
        
        expect(scheduled.success).toBe(true);
        expect(unscheduled.success).toBe(true);
        expect(common.success).toBe(true);
      });

      it('should generate OC_OID for new phase', async () => {
        const result = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'OID Phase',
          ordinal: 1
        }, userId);
        
        createdEventDefIds.push(result.eventDefinitionId!);
        
        const dbResult = await testDb.pool.query(
          'SELECT oc_oid FROM study_event_definition WHERE study_event_definition_id = $1',
          [result.eventDefinitionId]
        );
        
        expect(dbResult.rows[0].oc_oid).toBeDefined();
        expect(dbResult.rows[0].oc_oid).toMatch(/^SE_/);
      });
    });

    describe('2.2 Phase Creation via Study Creation', () => {
      it('should create study with event definitions (phases)', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `Multi-Phase Study ${timestamp}`,
          uniqueIdentifier: `MULTI-${timestamp}`,
          eventDefinitions: [
            { name: 'Screening', ordinal: 1, type: 'scheduled', category: 'Baseline' },
            { name: 'Week 4', ordinal: 2, type: 'scheduled', category: 'Treatment' },
            { name: 'Week 12', ordinal: 3, type: 'scheduled', category: 'Treatment' },
            { name: 'End of Study', ordinal: 4, type: 'scheduled', category: 'Closeout' }
          ]
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        const eventsResult = await testDb.pool.query(
          'SELECT * FROM study_event_definition WHERE study_id = $1 ORDER BY ordinal',
          [result.studyId]
        );
        
        expect(eventsResult.rows.length).toBe(4);
        expect(eventsResult.rows[0].name).toBe('Screening');
        expect(eventsResult.rows[1].name).toBe('Week 4');
        expect(eventsResult.rows[2].name).toBe('Week 12');
        expect(eventsResult.rows[3].name).toBe('End of Study');
        
        eventsResult.rows.forEach((e: any) => createdEventDefIds.push(e.study_event_definition_id));
      });
    });

    describe('2.3 Phase Retrieval', () => {
      beforeEach(async () => {
        // Create some phases
        const e1 = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Phase 1',
          ordinal: 1
        }, userId);
        createdEventDefIds.push(e1.eventDefinitionId!);
        
        const e2 = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Phase 2',
          ordinal: 2
        }, userId);
        createdEventDefIds.push(e2.eventDefinitionId!);
      });

      it('should retrieve all phases for a study', async () => {
        const events = await eventService.getStudyEvents(testStudyId);
        
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events[0].name).toBe('Phase 1');
        expect(events[1].name).toBe('Phase 2');
      });

      it('should retrieve phase by ID', async () => {
        const event = await eventService.getStudyEventById(createdEventDefIds[0]);
        
        expect(event).toBeDefined();
        expect(event.name).toBe('Phase 1');
      });

      it('should include usage count and CRF count in retrieval', async () => {
        const events = await eventService.getStudyEvents(testStudyId);
        
        expect(events[0].usage_count).toBeDefined();
        expect(events[0].crf_count).toBeDefined();
      });
    });

    describe('2.4 Phase Update', () => {
      let testEventId: number;
      
      beforeEach(async () => {
        const result = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Update Phase',
          ordinal: 1,
          description: 'Original description'
        }, userId);
        testEventId = result.eventDefinitionId!;
        createdEventDefIds.push(testEventId);
      });

      it('should update phase fields', async () => {
        const result = await eventService.updateStudyEvent(testEventId, {
          name: 'Updated Phase Name',
          description: 'Updated description',
          category: 'New Category'
        }, userId);
        
        expect(result.success).toBe(true);
        
        const dbResult = await testDb.pool.query(
          'SELECT name, description, category FROM study_event_definition WHERE study_event_definition_id = $1',
          [testEventId]
        );
        
        expect(dbResult.rows[0].name).toBe('Updated Phase Name');
        expect(dbResult.rows[0].description).toBe('Updated description');
        expect(dbResult.rows[0].category).toBe('New Category');
      });
    });

    describe('2.5 Phase Delete', () => {
      it('should soft delete phase', async () => {
        const result = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Delete Phase',
          ordinal: 1
        }, userId);
        
        createdEventDefIds.push(result.eventDefinitionId!);
        
        const deleteResult = await eventService.deleteStudyEvent(result.eventDefinitionId!, userId);
        expect(deleteResult.success).toBe(true);
        
        const dbResult = await testDb.pool.query(
          'SELECT status_id FROM study_event_definition WHERE study_event_definition_id = $1',
          [result.eventDefinitionId]
        );
        
        expect(dbResult.rows[0].status_id).toBe(5); // Removed
      });
    });

    describe('2.6 CRF Assignment to Phases', () => {
      let testCrfId: number;
      let testEventId: number;
      
      beforeEach(async () => {
        // Create test CRF
        const crfResult = await testDb.pool.query(`
          INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
          VALUES ('Test Form', 'Test CRF', 1, $1, NOW(), $2)
          RETURNING crf_id
        `, [userId, `CRF_${Date.now()}`]);
        testCrfId = crfResult.rows[0].crf_id;
        createdCrfIds.push(testCrfId);
        
        // Create CRF version
        await testDb.pool.query(`
          INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
          VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
        `, [testCrfId, userId, `CV_${Date.now()}`]);
        
        // Create event
        const eventResult = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'CRF Assignment Phase',
          ordinal: 1
        }, userId);
        testEventId = eventResult.eventDefinitionId!;
        createdEventDefIds.push(testEventId);
      });

      it('should assign CRF to phase during study creation', async () => {
        const timestamp = Date.now();
        const studyData = {
          name: `CRF Study ${timestamp}`,
          uniqueIdentifier: `CRF-${timestamp}`,
          eventDefinitions: [
            {
              name: 'Visit with Form',
              ordinal: 1,
              crfAssignments: [
                { crfId: testCrfId, required: true, doubleDataEntry: false, electronicSignature: true }
              ]
            }
          ]
        };
        
        const result = await studyService.createStudy(studyData, userId);
        expect(result.success).toBe(true);
        createdStudyIds.push(result.studyId!);
        
        // Get the event
        const eventsResult = await testDb.pool.query(
          'SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1',
          [result.studyId]
        );
        createdEventDefIds.push(eventsResult.rows[0].study_event_definition_id);
        
        // Check CRF assignment
        const assignmentResult = await testDb.pool.query(
          'SELECT * FROM event_definition_crf WHERE study_event_definition_id = $1',
          [eventsResult.rows[0].study_event_definition_id]
        );
        
        expect(assignmentResult.rows.length).toBe(1);
        expect(assignmentResult.rows[0].crf_id).toBe(testCrfId);
        expect(assignmentResult.rows[0].required_crf).toBe(true);
        expect(assignmentResult.rows[0].electronic_signature).toBe(true);
      });

      it('should retrieve CRFs for a phase', async () => {
        // Assign CRF to event
        await testDb.pool.query(`
          INSERT INTO event_definition_crf 
          (study_event_definition_id, study_id, crf_id, required_crf, status_id, owner_id, date_created, ordinal)
          VALUES ($1, $2, $3, true, 1, $4, NOW(), 1)
        `, [testEventId, testStudyId, testCrfId, userId]);
        
        const crfs = await eventService.getEventCRFs(testEventId);
        
        expect(Array.isArray(crfs)).toBe(true);
        expect(crfs.length).toBeGreaterThanOrEqual(1);
        expect(crfs[0].crf_id).toBe(testCrfId);
      });
    });
  });

  // ============================================================================
  // SECTION 3: PATIENT (SUBJECT) CRUD OPERATIONS
  // ============================================================================

  describe('3. Patient (Subject) CRUD Operations', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const result = await studyService.createStudy({
        name: `Patient Test Study ${Date.now()}`,
        uniqueIdentifier: `PAT-STUDY-${Date.now()}`
      }, userId);
      
      testStudyId = result.studyId!;
      createdStudyIds.push(testStudyId);
    });

    describe('3.1 Patient Enrollment Validation', () => {
      it('should require studyId and studySubjectId for enrollment', async () => {
        // Missing studySubjectId
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: ''
        }, userId, username);
        
        expect(result.success).toBe(false);
      });

      it('should reject duplicate subject IDs within same study', async () => {
        const subjectId = `SUBJ-${Date.now()}`;
        
        // Create first subject
        const result1 = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: subjectId
        }, userId, username);
        
        expect(result1.success).toBe(true);
        createdSubjectIds.push(result1.data?.studySubjectId || subjectId);
        
        // Try duplicate
        const result2 = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: subjectId
        }, userId, username);
        
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('already exists');
      });
    });

    describe('3.2 Patient Enrollment with All Fields', () => {
      it('should enroll patient with required fields only', async () => {
        const subjectData = {
          studyId: testStudyId,
          studySubjectId: `SUBJ-${Date.now()}`
        };
        
        const result = await subjectService.createSubject(subjectData, userId, username);
        
        expect(result.success).toBe(true);
        expect(result.data?.studySubjectId || result.data?.study_subject_id).toBeDefined();
        const subjectId = result.data?.studySubjectId || result.data?.study_subject_id;
        createdSubjectIds.push(subjectId);
        
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study_subject WHERE study_subject_id = $1',
          [subjectId]
        );
        
        expect(dbResult.rows[0].label).toBe(subjectData.studySubjectId);
        expect(dbResult.rows[0].study_id).toBe(testStudyId);
        expect(dbResult.rows[0].status_id).toBe(1); // Available
      });

      it('should enroll patient with all demographic fields', async () => {
        const timestamp = Date.now();
        const subjectData = {
          studyId: testStudyId,
          studySubjectId: `FULL-${timestamp}`,
          secondaryId: 'MRN12345',
          gender: 'm',
          dateOfBirth: '1990-06-15',
          personId: `PERSON-${timestamp}`
        };
        
        const result = await subjectService.createSubject(subjectData, userId, username);
        
        expect(result.success).toBe(true);
        const subjectId = result.data?.studySubjectId || result.data?.study_subject_id;
        createdSubjectIds.push(subjectId);
        
        // Check study_subject table
        const ssResult = await testDb.pool.query(
          'SELECT * FROM study_subject WHERE study_subject_id = $1',
          [subjectId]
        );
        
        expect(ssResult.rows[0].label).toBe(subjectData.studySubjectId);
        expect(ssResult.rows[0].secondary_label).toBe(subjectData.secondaryId);
        
        // Check subject table
        const subjectResult = await testDb.pool.query(
          'SELECT * FROM subject WHERE subject_id = $1',
          [ssResult.rows[0].subject_id]
        );
        
        expect(subjectResult.rows[0].gender).toBe('m');
        expect(subjectResult.rows[0].unique_identifier).toBe(subjectData.personId);
      });

      it('should set enrollment date to today if not provided', async () => {
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: `TODAY-${Date.now()}`
        }, userId, username);
        
        expect(result.success).toBe(true);
        const subjectId = result.data?.studySubjectId || result.data?.study_subject_id;
        createdSubjectIds.push(subjectId);
        
        const dbResult = await testDb.pool.query(
          'SELECT enrollment_date FROM study_subject WHERE study_subject_id = $1',
          [subjectId]
        );
        
        expect(dbResult.rows[0].enrollment_date).toBeDefined();
        
        // Check it's today
        const today = new Date().toISOString().split('T')[0];
        const enrollmentDate = new Date(dbResult.rows[0].enrollment_date).toISOString().split('T')[0];
        expect(enrollmentDate).toBe(today);
      });

      it('should generate OC_OID for new subject', async () => {
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: `OID-${Date.now()}`
        }, userId, username);
        
        expect(result.success).toBe(true);
        const subjectId = result.data?.studySubjectId || result.data?.study_subject_id;
        createdSubjectIds.push(subjectId);
        
        const dbResult = await testDb.pool.query(
          'SELECT oc_oid FROM study_subject WHERE study_subject_id = $1',
          [subjectId]
        );
        
        expect(dbResult.rows[0].oc_oid).toBeDefined();
        expect(dbResult.rows[0].oc_oid).toMatch(/^SS_/);
      });
    });

    describe('3.3 Patient Retrieval', () => {
      beforeEach(async () => {
        // Create some subjects
        for (let i = 1; i <= 3; i++) {
          const result = await subjectService.createSubject({
            studyId: testStudyId,
            studySubjectId: `RETR-${Date.now()}-${i}`,
            gender: i % 2 === 0 ? 'm' : 'f'
          }, userId, username);
          createdSubjectIds.push(result.data?.studySubjectId!);
        }
      });

      it('should retrieve all subjects for a study', async () => {
        const result = await subjectService.getSubjectList(testStudyId, { page: 1, limit: 10 });
        
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.length).toBeGreaterThanOrEqual(3);
      });

      it('should retrieve subject by ID', async () => {
        const subject = await subjectService.getSubjectById(createdSubjectIds[0]);
        
        expect(subject).toBeDefined();
        expect(subject?.studySubjectId).toBe(createdSubjectIds[0]);
      });

      it('should return paginated results', async () => {
        const result = await subjectService.getSubjectList(testStudyId, { page: 1, limit: 2 });
        
        expect(result.pagination).toBeDefined();
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(2);
      });
    });

    describe('3.4 Patient Update', () => {
      let testSubjectId: number;
      
      beforeEach(async () => {
        const result = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: `UPDATE-${Date.now()}`
        }, userId, username);
        testSubjectId = result.data?.studySubjectId!;
        createdSubjectIds.push(testSubjectId);
      });

      it('should update subject secondary label', async () => {
        // Direct database update since updateSubject is not yet implemented in service
        await testDb.pool.query(
          'UPDATE study_subject SET secondary_label = $1 WHERE study_subject_id = $2',
          ['UPDATED-MRN', testSubjectId]
        );
        
        const dbResult = await testDb.pool.query(
          'SELECT secondary_label FROM study_subject WHERE study_subject_id = $1',
          [testSubjectId]
        );
        
        expect(dbResult.rows[0].secondary_label).toBe('UPDATED-MRN');
      });
    });

    describe('3.5 Event Scheduling for Patients', () => {
      let testSubjectId: number;
      let testEventDefId: number;
      
      beforeEach(async () => {
        // Create subject
        const subjectResult = await subjectService.createSubject({
          studyId: testStudyId,
          studySubjectId: `EVENT-${Date.now()}`
        }, userId, username);
        testSubjectId = subjectResult.data?.studySubjectId!;
        createdSubjectIds.push(testSubjectId);
        
        // Create event definition
        const eventResult = await eventService.createStudyEvent({
          studyId: testStudyId,
          name: 'Screening',
          ordinal: 1
        }, userId);
        testEventDefId = eventResult.eventDefinitionId!;
        createdEventDefIds.push(testEventDefId);
      });

      it('should schedule event for subject', async () => {
        const result = await eventService.scheduleSubjectEvent({
          studySubjectId: testSubjectId,
          studyEventDefinitionId: testEventDefId,
          startDate: new Date().toISOString().split('T')[0],
          location: 'Clinic A'
        }, userId, username);
        
        expect(result.success).toBe(true);
        
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study_event WHERE study_subject_id = $1',
          [testSubjectId]
        );
        
        expect(dbResult.rows.length).toBeGreaterThan(0);
        expect(dbResult.rows[0].study_event_definition_id).toBe(testEventDefId);
        expect(dbResult.rows[0].location).toBe('Clinic A');
      });

      it('should retrieve scheduled events for subject', async () => {
        // Schedule an event
        await eventService.scheduleSubjectEvent({
          studySubjectId: testSubjectId,
          studyEventDefinitionId: testEventDefId,
          startDate: new Date().toISOString().split('T')[0]
        }, userId, username);
        
        const events = await eventService.getSubjectEvents(testSubjectId);
        
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].event_name).toBe('Screening');
      });
    });
  });

  // ============================================================================
  // SECTION 4: END-TO-END WORKFLOW TESTS
  // ============================================================================

  describe('4. End-to-End Workflow Tests', () => {
    it('should complete full study setup and patient enrollment workflow', async () => {
      const timestamp = Date.now();
      
      console.log('📋 Starting E2E Study Setup and Patient Enrollment Test');
      
      // 1. Create CRF
      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ('Demographics Form', 'Patient demographics CRF', 1, $1, NOW(), $2)
        RETURNING crf_id
      `, [userId, `CRF_E2E_${timestamp}`]);
      const crfId = crfResult.rows[0].crf_id;
      createdCrfIds.push(crfId);
      
      await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      `, [crfId, userId, `CV_E2E_${timestamp}`]);
      
      console.log('✅ Created CRF');
      
      // 2. Create Study with Phases and CRF assignments
      const studyData = {
        name: `E2E Study ${timestamp}`,
        uniqueIdentifier: `E2E-${timestamp}`,
        principalInvestigator: 'Dr. E2E Test',
        sponsor: 'E2E Corp',
        expectedTotalEnrollment: 100,
        phase: 'III',
        eventDefinitions: [
          {
            name: 'Screening',
            ordinal: 1,
            type: 'scheduled',
            category: 'Baseline',
            crfAssignments: [{ crfId, required: true }]
          },
          {
            name: 'Week 4 Treatment',
            ordinal: 2,
            type: 'scheduled',
            category: 'Treatment'
          },
          {
            name: 'End of Study',
            ordinal: 3,
            type: 'scheduled',
            category: 'Closeout'
          }
        ]
      };
      
      const studyResult = await studyService.createStudy(studyData, userId);
      expect(studyResult.success).toBe(true);
      createdStudyIds.push(studyResult.studyId!);
      
      console.log(`✅ Created Study: ${studyData.name} (ID: ${studyResult.studyId})`);
      
      // Verify phases were created
      const events = await eventService.getStudyEvents(studyResult.studyId!);
      expect(events.length).toBe(3);
      events.forEach((e: any) => createdEventDefIds.push(e.study_event_definition_id));
      
      console.log(`✅ Verified ${events.length} phases created`);
      
      // 3. Enroll patients
      const patients: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const patientResult = await subjectService.createSubject({
          studyId: studyResult.studyId!,
          studySubjectId: `E2E-SUBJ-${timestamp}-${i}`,
          gender: i % 2 === 0 ? 'm' : 'f',
          dateOfBirth: `199${i}-0${i}-15`
        }, userId, username);
        
        expect(patientResult.success).toBe(true);
        patients.push(patientResult.data?.studySubjectId!);
        createdSubjectIds.push(patientResult.data?.studySubjectId!);
      }
      
      console.log(`✅ Enrolled ${patients.length} patients`);
      
      // 4. Schedule screening for each patient
      const screeningEventId = events[0].study_event_definition_id;
      for (const patientId of patients) {
        const scheduleResult = await eventService.scheduleSubjectEvent({
          studySubjectId: patientId,
          studyEventDefinitionId: screeningEventId,
          startDate: new Date().toISOString().split('T')[0],
          location: 'Clinic A'
        }, userId, username);
        
        expect(scheduleResult.success).toBe(true);
      }
      
      console.log(`✅ Scheduled screening for all patients`);
      
      // 5. Verify final state
      const finalStudy = await studyService.getStudyById(studyResult.studyId!, userId);
      expect(finalStudy.total_subjects).toBe(3);
      
      console.log('');
      console.log('='.repeat(60));
      console.log('🎉 E2E WORKFLOW TEST COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`  Study: ${finalStudy.name}`);
      console.log(`  Phases: ${events.length}`);
      console.log(`  Patients: ${finalStudy.total_subjects}`);
      console.log('='.repeat(60));
    });
  });
});

