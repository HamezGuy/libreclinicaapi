/**
 * Study Full Integration Tests
 * 
 * Comprehensive end-to-end tests for study management:
 * - Study creation with all LibreClinica fields
 * - Event definitions (phases) creation
 * - CRF assignment to events
 * - Database verification
 * - Study retrieval and update
 * - Full lifecycle testing
 * 
 * Tests match the exact LibreClinica database schema
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as studyService from '../src/services/hybrid/study.service';
import * as eventService from '../src/services/hybrid/event.service';

describe('Study Full Integration Tests', () => {
  const userId = 1; // Root user
  
  // Track created resources for cleanup
  let createdStudyIds: number[] = [];
  let createdEventDefIds: number[] = [];
  let createdCrfIds: number[] = [];

  beforeAll(async () => {
    await testDb.connect();
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
    createdStudyIds = [];
    createdEventDefIds = [];
    createdCrfIds = [];
  });

  afterEach(async () => {
    // Cleanup created resources in reverse order (dependencies first)
    for (const eventDefId of createdEventDefIds) {
      try {
        await testDb.pool.query('DELETE FROM event_definition_crf WHERE study_event_definition_id = $1', [eventDefId]);
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [eventDefId]);
      } catch (e) { /* ignore */ }
    }
    for (const studyId of createdStudyIds) {
      try {
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study_parameter_value WHERE study_id = $1', [studyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [studyId]);
      } catch (e) { /* ignore */ }
    }
  });

  afterAll(async () => {
    // Final cleanup if needed
  });

  // ============================================================================
  // STUDY CREATION WITH ALL LIBRECLINICA FIELDS
  // ============================================================================

  describe('Study Creation with Full LibreClinica Fields', () => {
    it('should create study with all basic fields', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Full Study ${timestamp}`,
        uniqueIdentifier: `FULL-${timestamp}`,
        officialTitle: 'Official Title for Full Study',
        secondaryIdentifier: 'NCT12345678',
        summary: 'This is a comprehensive test study',
        principalInvestigator: 'Dr. Jane Smith, MD, PhD',
        sponsor: 'Test Pharmaceutical Inc.',
        collaborators: 'University Hospital, Research Institute',
        phase: 'II',
        protocolType: 'interventional',
        expectedTotalEnrollment: 250,
        datePlannedStart: '2025-01-01',
        datePlannedEnd: '2026-12-31'
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      expect(result.studyId).toBeDefined();
      createdStudyIds.push(result.studyId!);

      // Verify all fields in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [result.studyId]
      );

      expect(dbResult.rows.length).toBe(1);
      const study = dbResult.rows[0];

      expect(study.name).toBe(studyData.name);
      expect(study.unique_identifier).toBe(studyData.uniqueIdentifier);
      expect(study.official_title).toBe(studyData.officialTitle);
      expect(study.secondary_identifier).toBe(studyData.secondaryIdentifier);
      expect(study.principal_investigator).toBe(studyData.principalInvestigator);
      expect(study.sponsor).toBe(studyData.sponsor);
      expect(study.collaborators).toBe(studyData.collaborators);
      expect(study.phase).toBe(studyData.phase);
      expect(study.protocol_type).toBe(studyData.protocolType);
      expect(study.expected_total_enrollment).toBe(studyData.expectedTotalEnrollment);
    });

    it('should create study with facility information', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Facility Study ${timestamp}`,
        uniqueIdentifier: `FAC-${timestamp}`,
        facilityName: 'University Medical Center',
        facilityCity: 'Boston',
        facilityState: 'MA',
        facilityZip: '02115',
        facilityCountry: 'United States',
        facilityRecruitmentStatus: 'Recruiting',
        facilityContactName: 'Dr. John Contact',
        facilityContactDegree: 'MD, PhD',
        facilityContactPhone: '617-555-0100',
        facilityContactEmail: 'contact@university.edu'
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify facility fields
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [result.studyId]
      );

      const study = dbResult.rows[0];
      expect(study.facility_name).toBe(studyData.facilityName);
      expect(study.facility_city).toBe(studyData.facilityCity);
      expect(study.facility_state).toBe(studyData.facilityState);
      expect(study.facility_zip).toBe(studyData.facilityZip);
      expect(study.facility_country).toBe(studyData.facilityCountry);
      expect(study.facility_contact_name).toBe(studyData.facilityContactName);
      expect(study.facility_contact_email).toBe(studyData.facilityContactEmail);
    });

    it('should create study with protocol and eligibility fields', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Protocol Study ${timestamp}`,
        uniqueIdentifier: `PROTO-${timestamp}`,
        protocolDescription: 'Detailed protocol description',
        medlineIdentifier: 'PMID12345',
        url: 'https://clinicaltrials.gov/ct2/show/NCT12345',
        urlDescription: 'ClinicalTrials.gov Entry',
        conditions: 'Type 2 Diabetes, Obesity',
        keywords: 'diabetes, weight loss, GLP-1',
        eligibility: 'Adults 18-65 with BMI > 30',
        gender: 'Both',
        ageMin: '18',
        ageMax: '65',
        healthyVolunteerAccepted: false
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify protocol/eligibility fields
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [result.studyId]
      );

      const study = dbResult.rows[0];
      expect(study.protocol_description).toBe(studyData.protocolDescription);
      expect(study.medline_identifier).toBe(studyData.medlineIdentifier);
      expect(study.url).toBe(studyData.url);
      expect(study.conditions).toBe(studyData.conditions);
      expect(study.keywords).toBe(studyData.keywords);
      expect(study.gender).toBe(studyData.gender);
      expect(study.age_min).toBe(studyData.ageMin);
      expect(study.age_max).toBe(studyData.ageMax);
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

      // Verify design fields
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [result.studyId]
      );

      const study = dbResult.rows[0];
      expect(study.purpose).toBe(studyData.purpose);
      expect(study.allocation).toBe(studyData.allocation);
      expect(study.masking).toBe(studyData.masking);
      expect(study.control).toBe(studyData.control);
      expect(study.assignment).toBe(studyData.assignment);
      expect(study.endpoint).toBe(studyData.endpoint);
      expect(study.duration).toBe(studyData.duration);
      expect(study.selection).toBe(studyData.selection);
      expect(study.timing).toBe(studyData.timing);
    });

    it('should initialize study parameters', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Params Study ${timestamp}`,
        uniqueIdentifier: `PARAMS-${timestamp}`
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify study_parameter_value entries were created
      const paramsResult = await testDb.pool.query(
        'SELECT * FROM study_parameter_value WHERE study_id = $1',
        [result.studyId]
      );

      expect(paramsResult.rows.length).toBeGreaterThan(0);
      
      // Check for specific parameters
      const parameterNames = paramsResult.rows.map((r: any) => r.parameter);
      expect(parameterNames).toContain('collectDob');
      expect(parameterNames).toContain('genderRequired');
      expect(parameterNames).toContain('subjectIdGeneration');
    });

    it('should generate OC OID correctly', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `OID Study ${timestamp}`,
        uniqueIdentifier: `OID-TEST-${timestamp}`
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify OC OID
      const dbResult = await testDb.pool.query(
        'SELECT oc_oid FROM study WHERE study_id = $1',
        [result.studyId]
      );

      expect(dbResult.rows[0].oc_oid).toBeDefined();
      expect(dbResult.rows[0].oc_oid).toContain('S_');
    });
  });

  // ============================================================================
  // STUDY CREATION WITH EVENT DEFINITIONS (PHASES)
  // ============================================================================

  describe('Study Creation with Event Definitions', () => {
    it('should create study with event definitions (phases)', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Event Study ${timestamp}`,
        uniqueIdentifier: `EVENT-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Screening',
            description: 'Initial screening visit',
            type: 'scheduled',
            ordinal: 1,
            repeating: false,
            category: 'Baseline'
          },
          {
            name: 'Week 4 Visit',
            description: 'First treatment assessment',
            type: 'scheduled',
            ordinal: 2,
            repeating: false,
            category: 'Treatment'
          },
          {
            name: 'End of Study',
            description: 'Final visit and closeout',
            type: 'scheduled',
            ordinal: 3,
            repeating: false,
            category: 'Closeout'
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify event definitions in database
      const eventsResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_id = $1 ORDER BY ordinal',
        [result.studyId]
      );

      expect(eventsResult.rows.length).toBe(3);
      
      expect(eventsResult.rows[0].name).toBe('Screening');
      expect(eventsResult.rows[0].ordinal).toBe(1);
      expect(eventsResult.rows[0].type).toBe('scheduled');
      expect(eventsResult.rows[0].repeating).toBe(false);
      expect(eventsResult.rows[0].category).toBe('Baseline');

      expect(eventsResult.rows[1].name).toBe('Week 4 Visit');
      expect(eventsResult.rows[1].ordinal).toBe(2);

      expect(eventsResult.rows[2].name).toBe('End of Study');
      expect(eventsResult.rows[2].ordinal).toBe(3);

      // Track for cleanup
      eventsResult.rows.forEach((e: any) => createdEventDefIds.push(e.study_event_definition_id));
    });

    it('should create repeating event correctly', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Repeating Event Study ${timestamp}`,
        uniqueIdentifier: `REP-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Weekly Assessment',
            description: 'Repeating weekly visit',
            type: 'scheduled',
            ordinal: 1,
            repeating: true,
            category: 'Treatment'
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify repeating flag
      const eventsResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );

      expect(eventsResult.rows[0].repeating).toBe(true);
      createdEventDefIds.push(eventsResult.rows[0].study_event_definition_id);
    });

    it('should generate event OID correctly', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Event OID Study ${timestamp}`,
        uniqueIdentifier: `EVOID-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Test Event',
            ordinal: 1
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify event OID
      const eventsResult = await testDb.pool.query(
        'SELECT oc_oid FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );

      expect(eventsResult.rows[0].oc_oid).toBeDefined();
      expect(eventsResult.rows[0].oc_oid).toContain('SE_');
      createdEventDefIds.push(eventsResult.rows[0].study_event_definition_id);
    });

    it('should handle unscheduled event type', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Unscheduled Event Study ${timestamp}`,
        uniqueIdentifier: `UNSCH-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Adverse Event Visit',
            description: 'Unscheduled visit for adverse events',
            type: 'unscheduled',
            ordinal: 1,
            repeating: true
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify unscheduled type
      const eventsResult = await testDb.pool.query(
        'SELECT type FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );

      expect(eventsResult.rows[0].type).toBe('unscheduled');
      createdEventDefIds.push(eventsResult.rows[0].study_event_definition_id);
    });
  });

  // ============================================================================
  // STUDY CREATION WITH CRF ASSIGNMENTS TO EVENTS
  // ============================================================================

  describe('Study Creation with CRF Assignments', () => {
    let testCrfId: number;
    let testCrfVersionId: number;

    beforeEach(async () => {
      // Create a test CRF for assignment
      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ('Test Form', 'Test CRF for integration tests', 1, $1, NOW(), $2)
        RETURNING crf_id
      `, [userId, `CRF_TEST_${Date.now()}`]);

      testCrfId = crfResult.rows[0].crf_id;
      createdCrfIds.push(testCrfId);

      // Create a CRF version
      const versionResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 'Version 1.0', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [testCrfId, userId, `CRF_V_${Date.now()}`]);

      testCrfVersionId = versionResult.rows[0].crf_version_id;
    });

    afterEach(async () => {
      // Cleanup CRFs
      for (const crfId of createdCrfIds) {
        try {
          await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [crfId]);
          await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [crfId]);
        } catch (e) { /* ignore */ }
      }
    });

    it('should create study with events and CRF assignments', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `CRF Assignment Study ${timestamp}`,
        uniqueIdentifier: `CRFAS-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Screening',
            ordinal: 1,
            crfAssignments: [
              {
                crfId: testCrfId,
                required: true,
                doubleDataEntry: false,
                electronicSignature: true
              }
            ]
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Get event definition ID
      const eventResult = await testDb.pool.query(
        'SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );

      expect(eventResult.rows.length).toBe(1);
      const eventDefId = eventResult.rows[0].study_event_definition_id;
      createdEventDefIds.push(eventDefId);

      // Verify CRF assignment
      const assignmentResult = await testDb.pool.query(
        'SELECT * FROM event_definition_crf WHERE study_event_definition_id = $1',
        [eventDefId]
      );

      expect(assignmentResult.rows.length).toBe(1);
      expect(assignmentResult.rows[0].crf_id).toBe(testCrfId);
      expect(assignmentResult.rows[0].required_crf).toBe(true);
      expect(assignmentResult.rows[0].double_entry).toBe(false);
      expect(assignmentResult.rows[0].electronic_signature).toBe(true);
    });

    it('should assign default CRF version when not specified', async () => {
      const timestamp = Date.now();
      const studyData = {
        name: `Default Version Study ${timestamp}`,
        uniqueIdentifier: `DEFVER-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Baseline',
            ordinal: 1,
            crfAssignments: [
              {
                crfId: testCrfId,
                required: true
                // No crfVersionId specified - should use default
              }
            ]
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Get event and verify CRF version
      const eventResult = await testDb.pool.query(
        'SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );
      createdEventDefIds.push(eventResult.rows[0].study_event_definition_id);

      const assignmentResult = await testDb.pool.query(
        'SELECT default_version_id FROM event_definition_crf WHERE study_event_definition_id = $1',
        [eventResult.rows[0].study_event_definition_id]
      );

      expect(assignmentResult.rows[0].default_version_id).toBe(testCrfVersionId);
    });

    it('should handle multiple CRF assignments to one event', async () => {
      // Create second CRF
      const crf2Result = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ('Second Form', 'Second test CRF', 1, $1, NOW(), $2)
        RETURNING crf_id
      `, [userId, `CRF_TEST2_${Date.now()}`]);
      
      const testCrf2Id = crf2Result.rows[0].crf_id;
      createdCrfIds.push(testCrf2Id);

      // Create version for second CRF
      await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      `, [testCrf2Id, userId, `CRF_V2_${Date.now()}`]);

      const timestamp = Date.now();
      const studyData = {
        name: `Multi CRF Study ${timestamp}`,
        uniqueIdentifier: `MULTI-${timestamp}`,
        eventDefinitions: [
          {
            name: 'Comprehensive Visit',
            ordinal: 1,
            crfAssignments: [
              { crfId: testCrfId, required: true, ordinal: 1 },
              { crfId: testCrf2Id, required: false, ordinal: 2 }
            ]
          }
        ]
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      createdStudyIds.push(result.studyId!);

      // Verify both assignments
      const eventResult = await testDb.pool.query(
        'SELECT study_event_definition_id FROM study_event_definition WHERE study_id = $1',
        [result.studyId]
      );
      createdEventDefIds.push(eventResult.rows[0].study_event_definition_id);

      const assignmentsResult = await testDb.pool.query(
        'SELECT * FROM event_definition_crf WHERE study_event_definition_id = $1 ORDER BY ordinal',
        [eventResult.rows[0].study_event_definition_id]
      );

      expect(assignmentsResult.rows.length).toBe(2);
      expect(assignmentsResult.rows[0].crf_id).toBe(testCrfId);
      expect(assignmentsResult.rows[0].required_crf).toBe(true);
      expect(assignmentsResult.rows[1].crf_id).toBe(testCrf2Id);
      expect(assignmentsResult.rows[1].required_crf).toBe(false);
    });
  });

  // ============================================================================
  // STUDY RETRIEVAL AND VERIFICATION
  // ============================================================================

  describe('Study Retrieval', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await studyService.createStudy({
        name: `Retrieval Study ${timestamp}`,
        uniqueIdentifier: `RETR-${timestamp}`,
        principalInvestigator: 'Dr. Retrieval',
        sponsor: 'Retrieval Corp',
        expectedTotalEnrollment: 100
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
    });

    it('should return null for non-existent study', async () => {
      const study = await studyService.getStudyById(999999, userId);

      expect(study).toBeNull();
    });

    it('should include computed statistics', async () => {
      const study = await studyService.getStudyById(testStudyId, userId);

      expect(study).toBeDefined();
      // These fields are computed in the query
      expect(study.total_subjects).toBeDefined();
      expect(study.active_subjects).toBeDefined();
      expect(study.total_events).toBeDefined();
      expect(study.total_forms).toBeDefined();
    });

    it('should retrieve study list with pagination', async () => {
      const result = await studyService.getStudies(userId, { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });
  });

  // ============================================================================
  // STUDY UPDATE AND DATABASE VERIFICATION
  // ============================================================================

  describe('Study Update', () => {
    let updateStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await studyService.createStudy({
        name: `Update Study ${timestamp}`,
        uniqueIdentifier: `UPD-${timestamp}`,
        principalInvestigator: 'Dr. Original',
        sponsor: 'Original Corp',
        expectedTotalEnrollment: 50
      }, userId);

      updateStudyId = result.studyId!;
      createdStudyIds.push(updateStudyId);
    });

    it('should update study basic fields', async () => {
      const updates = {
        name: 'Updated Study Name',
        description: 'Updated description',
        principalInvestigator: 'Dr. Updated',
        sponsor: 'Updated Corp',
        expectedTotalEnrollment: 200
      };

      const result = await studyService.updateStudy(updateStudyId, updates, userId);

      expect(result.success).toBe(true);

      // Verify in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [updateStudyId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].summary).toBe(updates.description);
      expect(dbResult.rows[0].principal_investigator).toBe(updates.principalInvestigator);
      expect(dbResult.rows[0].sponsor).toBe(updates.sponsor);
      expect(dbResult.rows[0].expected_total_enrollment).toBe(updates.expectedTotalEnrollment);
    });

    it('should update date_updated field', async () => {
      const beforeUpdate = await testDb.pool.query(
        'SELECT date_updated FROM study WHERE study_id = $1',
        [updateStudyId]
      );

      await studyService.updateStudy(updateStudyId, { name: 'Timestamp Test' }, userId);

      const afterUpdate = await testDb.pool.query(
        'SELECT date_updated FROM study WHERE study_id = $1',
        [updateStudyId]
      );

      expect(afterUpdate.rows[0].date_updated).not.toBe(beforeUpdate.rows[0].date_updated);
    });

    it('should set update_id field', async () => {
      await studyService.updateStudy(updateStudyId, { name: 'Update ID Test' }, userId);

      const dbResult = await testDb.pool.query(
        'SELECT update_id FROM study WHERE study_id = $1',
        [updateStudyId]
      );

      expect(dbResult.rows[0].update_id).toBe(userId);
    });

    it('should create audit log entry on update', async () => {
      await studyService.updateStudy(updateStudyId, { name: 'Audit Update Test' }, userId);

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

  // ============================================================================
  // STUDY DELETE AND SOFT DELETE
  // ============================================================================

  describe('Study Delete', () => {
    it('should soft delete study (set status to removed)', async () => {
      const timestamp = Date.now();
      const createResult = await studyService.createStudy({
        name: `Delete Study ${timestamp}`,
        uniqueIdentifier: `DEL-${timestamp}`
      }, userId);

      const deleteStudyId = createResult.studyId!;
      createdStudyIds.push(deleteStudyId);

      const deleteResult = await studyService.deleteStudy(deleteStudyId, userId);

      expect(deleteResult.success).toBe(true);

      // Verify status is set to removed (5)
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [deleteStudyId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);
    });
  });

  // ============================================================================
  // EVENT DEFINITION SERVICE DIRECT TESTS
  // ============================================================================

  describe('Event Definition Service', () => {
    let testStudyId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const result = await studyService.createStudy({
        name: `Event Service Study ${timestamp}`,
        uniqueIdentifier: `EVSVC-${timestamp}`
      }, userId);

      testStudyId = result.studyId!;
      createdStudyIds.push(testStudyId);
    });

    it('should create event definition directly', async () => {
      const eventData = {
        studyId: testStudyId,
        name: 'Direct Event',
        description: 'Created directly via service',
        ordinal: 1,
        type: 'scheduled',
        repeating: false,
        category: 'Test'
      };

      const result = await eventService.createStudyEvent(eventData, userId);

      expect(result.success).toBe(true);
      expect(result.eventDefinitionId).toBeDefined();
      createdEventDefIds.push(result.eventDefinitionId!);

      // Verify in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study_event_definition WHERE study_event_definition_id = $1',
        [result.eventDefinitionId]
      );

      expect(dbResult.rows[0].name).toBe(eventData.name);
      expect(dbResult.rows[0].description).toBe(eventData.description);
      expect(dbResult.rows[0].type).toBe(eventData.type);
    });

    it('should get study events', async () => {
      // Create some events
      await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Event 1',
        ordinal: 1
      }, userId);

      await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Event 2',
        ordinal: 2
      }, userId);

      const events = await eventService.getStudyEvents(testStudyId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(2);

      // Track for cleanup
      events.forEach((e: any) => createdEventDefIds.push(e.study_event_definition_id));
    });

    it('should get event by ID', async () => {
      const createResult = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Get By ID Event',
        ordinal: 1
      }, userId);

      createdEventDefIds.push(createResult.eventDefinitionId!);

      const event = await eventService.getStudyEventById(createResult.eventDefinitionId!);

      expect(event).toBeDefined();
      expect(event.name).toBe('Get By ID Event');
    });

    it('should update event definition', async () => {
      const createResult = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Update Event',
        ordinal: 1
      }, userId);

      createdEventDefIds.push(createResult.eventDefinitionId!);

      const updateResult = await eventService.updateStudyEvent(
        createResult.eventDefinitionId!,
        {
          name: 'Updated Event Name',
          description: 'Updated description'
        },
        userId
      );

      expect(updateResult.success).toBe(true);

      // Verify update
      const event = await eventService.getStudyEventById(createResult.eventDefinitionId!);
      expect(event.name).toBe('Updated Event Name');
      expect(event.description).toBe('Updated description');
    });

    it('should delete event definition', async () => {
      const createResult = await eventService.createStudyEvent({
        studyId: testStudyId,
        name: 'Delete Event',
        ordinal: 1
      }, userId);

      const eventId = createResult.eventDefinitionId!;
      createdEventDefIds.push(eventId);

      const deleteResult = await eventService.deleteStudyEvent(eventId, userId);

      expect(deleteResult.success).toBe(true);

      // Verify status is removed
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study_event_definition WHERE study_event_definition_id = $1',
        [eventId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);
    });
  });

  // ============================================================================
  // FULL END-TO-END STUDY LIFECYCLE TEST
  // ============================================================================

  describe('Full Study Lifecycle E2E', () => {
    it('should complete full study lifecycle: create → read → update → delete', async () => {
      const timestamp = Date.now();

      // 1. CREATE STUDY with events and CRF assignments
      // First create a CRF
      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid)
        VALUES ('E2E Form', 'Form for E2E test', 1, $1, NOW(), $2)
        RETURNING crf_id
      `, [userId, `CRF_E2E_${timestamp}`]);
      
      const crfId = crfResult.rows[0].crf_id;
      createdCrfIds.push(crfId);

      await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
      `, [crfId, userId, `CRF_V_E2E_${timestamp}`]);

      const studyData = {
        name: `E2E Study ${timestamp}`,
        uniqueIdentifier: `E2E-${timestamp}`,
        officialTitle: 'End-to-End Test Study',
        principalInvestigator: 'Dr. E2E',
        sponsor: 'E2E Corp',
        phase: 'III',
        expectedTotalEnrollment: 500,
        eventDefinitions: [
          {
            name: 'Screening',
            ordinal: 1,
            type: 'scheduled',
            crfAssignments: [
              { crfId: crfId, required: true }
            ]
          },
          {
            name: 'Treatment',
            ordinal: 2,
            type: 'scheduled'
          }
        ]
      };

      const createResult = await studyService.createStudy(studyData, userId);
      
      expect(createResult.success).toBe(true);
      expect(createResult.studyId).toBeDefined();
      
      const studyId = createResult.studyId!;
      createdStudyIds.push(studyId);

      console.log(`✅ Created study with ID: ${studyId}`);

      // 2. READ and verify study
      const study = await studyService.getStudyById(studyId, userId);
      
      expect(study).toBeDefined();
      expect(study.name).toBe(studyData.name);
      expect(study.principal_investigator).toBe(studyData.principalInvestigator);

      console.log(`✅ Retrieved study: ${study.name}`);

      // Verify events were created
      const events = await eventService.getStudyEvents(studyId);
      
      expect(events.length).toBe(2);
      expect(events[0].name).toBe('Screening');
      expect(events[1].name).toBe('Treatment');
      
      events.forEach((e: any) => createdEventDefIds.push(e.study_event_definition_id));

      console.log(`✅ Verified ${events.length} event definitions`);

      // Verify CRF assignment
      const crfAssignments = await testDb.pool.query(
        'SELECT * FROM event_definition_crf WHERE study_event_definition_id = $1',
        [events[0].study_event_definition_id]
      );
      
      expect(crfAssignments.rows.length).toBe(1);
      expect(crfAssignments.rows[0].crf_id).toBe(crfId);

      console.log(`✅ Verified CRF assignment`);

      // 3. UPDATE study
      const updateResult = await studyService.updateStudy(studyId, {
        name: `E2E Study Updated ${timestamp}`,
        expectedTotalEnrollment: 600
      }, userId);

      expect(updateResult.success).toBe(true);

      // Verify update
      const updatedStudy = await studyService.getStudyById(studyId, userId);
      expect(updatedStudy.expected_total_enrollment).toBe(600);

      console.log(`✅ Updated study enrollment to 600`);

      // 4. VERIFY AUDIT TRAIL
      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = 'study' 
         ORDER BY audit_date`,
        [studyId]
      );

      expect(auditResult.rows.length).toBeGreaterThanOrEqual(1);

      console.log(`✅ Verified ${auditResult.rows.length} audit log entries`);

      // 5. DELETE (soft delete)
      const deleteResult = await studyService.deleteStudy(studyId, userId);

      expect(deleteResult.success).toBe(true);

      // Verify soft delete
      const deletedStudy = await testDb.pool.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [studyId]
      );

      expect(deletedStudy.rows[0].status_id).toBe(5);

      console.log(`✅ Soft deleted study (status_id = 5)`);

      console.log('');
      console.log('='.repeat(60));
      console.log('🎉 FULL E2E STUDY LIFECYCLE TEST COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
    });
  });
});

