/**
 * Study Parameters Tests
 * 
 * Tests the parameter handling fixes for study creation and updates.
 * Specifically tests:
 * - personIdShownOnCRF key naming (uppercase CRF vs lowercase)
 * - subjectIdPrefixSuffix combined key handling
 * - eventLocationRequired string vs boolean handling
 * - All parameter defaults on create
 * - Parameter upsert on update
 * - Nested data (events, groups, sites) round-trip
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as studyService from '../src/services/hybrid/study.service';

describe('Study Parameters - Key Naming and Data Integrity', () => {
  const userId = 1;
  let studyId: number;

  beforeAll(async () => {
    await testDb.connect();
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
  });

  afterAll(async () => {
    // Cleanup handled by global teardown
  });

  // ============================================================
  // Parameter Key Naming on CREATE
  // ============================================================
  describe('CREATE - Parameter Key Naming', () => {
    it('should store personIdShownOnCRF with uppercase CRF key', async () => {
      const result = await studyService.createStudy({
        name: 'Param Test Study',
        uniqueIdentifier: `PTS-${Date.now()}`,
        studyParameters: {
          personIdShownOnCRF: 'true'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'personIdShownOnCRF'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('true');
    });

    it('should accept lowercase personIdShownOnCrf and store as uppercase CRF key', async () => {
      const result = await studyService.createStudy({
        name: 'Param Test Study 2',
        uniqueIdentifier: `PTS2-${Date.now()}`,
        studyParameters: {
          personIdShownOnCrf: 'true' // lowercase 'f'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      // Should be stored with uppercase CRF key
      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'personIdShownOnCRF'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('true');
    });

    it('should store subjectIdPrefixSuffix from combined key', async () => {
      const result = await studyService.createStudy({
        name: 'Prefix Test',
        uniqueIdentifier: `PT-${Date.now()}`,
        studyParameters: {
          subjectIdPrefixSuffix: 'SUBJ-|-2025'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'subjectIdPrefixSuffix'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('SUBJ-|-2025');
    });

    it('should store subjectIdPrefixSuffix from individual prefix/suffix keys', async () => {
      const result = await studyService.createStudy({
        name: 'Prefix Test 2',
        uniqueIdentifier: `PT2-${Date.now()}`,
        studyParameters: {
          subjectIdPrefix: 'ABC-',
          subjectIdSuffix: '-XYZ'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'subjectIdPrefixSuffix'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('ABC-|-XYZ');
    });

    it('should handle eventLocationRequired as string "required"', async () => {
      const result = await studyService.createStudy({
        name: 'Event Location Test',
        uniqueIdentifier: `ELT-${Date.now()}`,
        studyParameters: {
          eventLocationRequired: 'required'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'eventLocationRequired'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('required');
    });

    it('should handle eventLocationRequired as string "not_used"', async () => {
      const result = await studyService.createStudy({
        name: 'Event Location Test 2',
        uniqueIdentifier: `ELT2-${Date.now()}`,
        studyParameters: {
          eventLocationRequired: 'not_used'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'eventLocationRequired'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('not_used');
    });

    it('should handle eventLocationRequired as boolean true', async () => {
      const result = await studyService.createStudy({
        name: 'Event Location Bool Test',
        uniqueIdentifier: `ELBT-${Date.now()}`,
        studyParameters: {
          eventLocationRequired: true
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'eventLocationRequired'`,
        [studyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('required');
    });

    it('should initialize all default parameters on create', async () => {
      const result = await studyService.createStudy({
        name: 'Defaults Test',
        uniqueIdentifier: `DFT-${Date.now()}`
      }, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1`,
        [studyId]
      );

      const paramMap: Record<string, string> = {};
      for (const row of params.rows) {
        paramMap[row.parameter] = row.value;
      }

      expect(paramMap['collectDob']).toBe('1');
      expect(paramMap['genderRequired']).toBe('true');
      expect(paramMap['subjectIdGeneration']).toBe('manual');
      expect(paramMap['discrepancyManagement']).toBe('true');
      expect(paramMap['personIdShownOnCRF']).toBe('false');
      expect(paramMap['eventLocationRequired']).toBe('not_used');
      expect(paramMap['allowAdministrativeEditing']).toBe('true');
    });
  });

  // ============================================================
  // Parameter Upsert on UPDATE
  // ============================================================
  describe('UPDATE - Parameter Upsert', () => {
    let existingStudyId: number;

    beforeEach(async () => {
      const result = await studyService.createStudy({
        name: 'Update Param Test',
        uniqueIdentifier: `UPT-${Date.now()}`
      }, userId);
      existingStudyId = result.studyId!;
    });

    it('should update existing parameter values', async () => {
      const updateResult = await studyService.updateStudy(existingStudyId, {
        studyParameters: {
          collectDob: '3',
          genderRequired: 'false'
        }
      }, userId);

      expect(updateResult.success).toBe(true);

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter IN ('collectDob', 'genderRequired')`,
        [existingStudyId]
      );

      const paramMap: Record<string, string> = {};
      for (const row of params.rows) {
        paramMap[row.parameter] = row.value;
      }

      expect(paramMap['collectDob']).toBe('3');
      expect(paramMap['genderRequired']).toBe('false');
    });

    it('should update personIdShownOnCRF with correct DB key', async () => {
      const updateResult = await studyService.updateStudy(existingStudyId, {
        studyParameters: {
          personIdShownOnCRF: 'true'
        }
      }, userId);

      expect(updateResult.success).toBe(true);

      const params = await testDb.pool.query(
        `SELECT value FROM study_parameter_value WHERE study_id = $1 AND parameter = 'personIdShownOnCRF'`,
        [existingStudyId]
      );

      expect(params.rows.length).toBe(1);
      expect(params.rows[0].value).toBe('true');
    });

    it('should NOT create duplicate parameter rows on update', async () => {
      // Update with the correct DB key
      await studyService.updateStudy(existingStudyId, {
        studyParameters: {
          personIdShownOnCRF: 'true'
        }
      }, userId);

      const params = await testDb.pool.query(
        `SELECT parameter, value FROM study_parameter_value WHERE study_id = $1 AND parameter LIKE 'personIdShown%'`,
        [existingStudyId]
      );

      // Should only have ONE entry (not duplicates with different casing)
      expect(params.rows.length).toBe(1);
      expect(params.rows[0].parameter).toBe('personIdShownOnCRF');
    });
  });

  // ============================================================
  // Nested Data Round-Trip (Create → Read → Update)
  // ============================================================
  describe('Nested Data Round-Trip', () => {
    it('should create and retrieve event definitions', async () => {
      const result = await studyService.createStudy({
        name: 'Events Test',
        uniqueIdentifier: `EVT-${Date.now()}`,
        eventDefinitions: [
          { name: 'Screening', type: 'scheduled', ordinal: 1, repeating: false },
          { name: 'Week 4', type: 'scheduled', ordinal: 2, repeating: false },
          { name: 'End of Study', type: 'scheduled', ordinal: 3, repeating: false }
        ]
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      // Retrieve and verify
      const study = await studyService.getStudyById(studyId, userId);
      expect(study).toBeTruthy();
      expect(study.eventDefinitions).toBeTruthy();
      expect(study.eventDefinitions.length).toBe(3);
      expect(study.eventDefinitions[0].name).toBe('Screening');
      expect(study.eventDefinitions[1].name).toBe('Week 4');
    });

    it('should create and retrieve group classes with groups', async () => {
      const result = await studyService.createStudy({
        name: 'Groups Test',
        uniqueIdentifier: `GRP-${Date.now()}`,
        groupClasses: [
          {
            name: 'Treatment Arm',
            groupClassTypeId: 1,
            subjectAssignment: 'required',
            groups: [
              { name: 'Placebo', description: 'Placebo group' },
              { name: 'Drug A 10mg', description: 'Active treatment low dose' },
              { name: 'Drug A 50mg', description: 'Active treatment high dose' }
            ]
          }
        ]
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const study = await studyService.getStudyById(studyId, userId);
      expect(study.groupClasses).toBeTruthy();
      expect(study.groupClasses.length).toBe(1);
      expect(study.groupClasses[0].name).toBe('Treatment Arm');
      expect(study.groupClasses[0].groups.length).toBe(3);
    });

    it('should create and retrieve sites', async () => {
      const result = await studyService.createStudy({
        name: 'Sites Test',
        uniqueIdentifier: `SIT-${Date.now()}`,
        sites: [
          {
            name: 'Site Alpha',
            uniqueIdentifier: `SIT-S01-${Date.now()}`,
            principalInvestigator: 'Dr. Alpha',
            facilityName: 'Alpha Hospital',
            facilityCity: 'Boston',
            expectedTotalEnrollment: 50
          }
        ]
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const study = await studyService.getStudyById(studyId, userId);
      expect(study.sites).toBeTruthy();
      expect(study.sites.length).toBe(1);
      expect(study.sites[0].name).toBe('Site Alpha');
      expect(study.sites[0].facilityCity).toBe('Boston');
    });

    it('should create and retrieve study parameters', async () => {
      const result = await studyService.createStudy({
        name: 'Params Round-Trip',
        uniqueIdentifier: `PRT-${Date.now()}`,
        studyParameters: {
          collectDob: '2',
          genderRequired: 'false',
          subjectIdGeneration: 'auto_editable',
          subjectIdPrefixSuffix: 'PRT-|-2025',
          personIdShownOnCRF: 'true',
          eventLocationRequired: 'required',
          contactEmail: 'test@trial.com'
        }
      } as any, userId);

      expect(result.success).toBe(true);
      studyId = result.studyId!;

      const study = await studyService.getStudyById(studyId, userId);
      expect(study.studyParameters).toBeTruthy();
      expect(study.studyParameters['collectDob']).toBe('2');
      expect(study.studyParameters['genderRequired']).toBe('false');
      expect(study.studyParameters['subjectIdGeneration']).toBe('auto_editable');
      expect(study.studyParameters['subjectIdPrefixSuffix']).toBe('PRT-|-2025');
      expect(study.studyParameters['personIdShownOnCRF']).toBe('true');
      expect(study.studyParameters['eventLocationRequired']).toBe('required');
      expect(study.studyParameters['contactEmail']).toBe('test@trial.com');
    });

    it('should update event definitions (add new, update existing)', async () => {
      // Create with initial events
      const createResult = await studyService.createStudy({
        name: 'Event Update Test',
        uniqueIdentifier: `EUT-${Date.now()}`,
        eventDefinitions: [
          { name: 'Screening', type: 'scheduled', ordinal: 1, repeating: false }
        ]
      } as any, userId);

      studyId = createResult.studyId!;
      const initial = await studyService.getStudyById(studyId, userId);
      const existingEventId = initial.eventDefinitions[0].studyEventDefinitionId;

      // Update: modify existing + add new
      const updateResult = await studyService.updateStudy(studyId, {
        eventDefinitions: [
          { studyEventDefinitionId: existingEventId, name: 'Screening (Updated)', type: 'scheduled', ordinal: 1 },
          { name: 'Week 4 (New)', type: 'scheduled', ordinal: 2 }
        ]
      }, userId);

      expect(updateResult.success).toBe(true);

      const updated = await studyService.getStudyById(studyId, userId);
      expect(updated.eventDefinitions.length).toBeGreaterThanOrEqual(2);
      
      const screeningEvent = updated.eventDefinitions.find((e: any) => e.studyEventDefinitionId === existingEventId);
      expect(screeningEvent?.name).toBe('Screening (Updated)');
    });

    it('should handle full study CRUD lifecycle', async () => {
      // CREATE
      const createResult = await studyService.createStudy({
        name: 'Lifecycle Test Study',
        uniqueIdentifier: `LCS-${Date.now()}`,
        principalInvestigator: 'Dr. Test',
        sponsor: 'Test Pharma',
        phase: 'III',
        expectedTotalEnrollment: 500,
        datePlannedStart: '2025-06-01',
        eventDefinitions: [
          { name: 'Screening', type: 'scheduled', ordinal: 1, repeating: false }
        ],
        groupClasses: [
          { name: 'Arm A', groupClassTypeId: 1, groups: [{ name: 'Drug', description: 'Active' }] }
        ],
        studyParameters: {
          collectDob: '1',
          personIdShownOnCRF: 'false'
        }
      } as any, userId);

      expect(createResult.success).toBe(true);
      studyId = createResult.studyId!;

      // READ
      const study = await studyService.getStudyById(studyId, userId);
      expect(study.name).toBe('Lifecycle Test Study');
      expect(study.eventDefinitions.length).toBe(1);
      expect(study.groupClasses.length).toBe(1);
      expect(study.studyParameters['collectDob']).toBe('1');

      // UPDATE
      const updateResult = await studyService.updateStudy(studyId, {
        name: 'Lifecycle Test Study (Updated)',
        expectedTotalEnrollment: 600,
        studyParameters: {
          collectDob: '2',
          personIdShownOnCRF: 'true'
        }
      }, userId);

      expect(updateResult.success).toBe(true);

      const updated = await studyService.getStudyById(studyId, userId);
      expect(updated.name).toBe('Lifecycle Test Study (Updated)');
      expect(updated.expected_total_enrollment).toBe(600);
      expect(updated.studyParameters['collectDob']).toBe('2');
      expect(updated.studyParameters['personIdShownOnCRF']).toBe('true');

      // ARCHIVE (soft delete)
      const archiveResult = await studyService.archiveStudy(studyId, userId);
      expect(archiveResult.success).toBe(true);

      // Verify archived
      const archived = await testDb.pool.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [studyId]
      );
      expect(archived.rows[0].status_id).toBe(5);
    });
  });

  // ============================================================
  // All Database Fields Verification
  // ============================================================
  describe('All Database Fields', () => {
    it('should persist ALL study table fields', async () => {
      const fullStudyData = {
        name: 'Full Field Test',
        uniqueIdentifier: `FFT-${Date.now()}`,
        officialTitle: 'Full Official Title of Study',
        secondaryIdentifier: 'NCT99999999',
        summary: 'Brief summary text',
        principalInvestigator: 'Dr. Full Test',
        sponsor: 'Full Pharma Corp',
        collaborators: 'University of Testing, Hospital of Trials',
        phase: 'II',
        protocolType: 'interventional',
        expectedTotalEnrollment: 300,
        datePlannedStart: '2025-09-01',
        datePlannedEnd: '2027-03-31',
        facilityName: 'Test Medical Center',
        facilityCity: 'Cambridge',
        facilityState: 'MA',
        facilityZip: '02139',
        facilityCountry: 'USA',
        facilityRecruitmentStatus: 'Recruiting',
        facilityContactName: 'Contact Person',
        facilityContactDegree: 'MD, PhD',
        facilityContactPhone: '+1-555-0199',
        facilityContactEmail: 'contact@test.edu',
        protocolDescription: 'Detailed protocol description...',
        medlineIdentifier: 'PMID12345',
        url: 'https://clinicaltrials.gov/test',
        urlDescription: 'Study registration page',
        resultsReference: true,
        conditions: 'Hypertension, Diabetes',
        keywords: 'blood pressure, glucose',
        interventions: 'Drug: Test Drug 100mg daily',
        eligibility: 'Adults aged 18-75 with confirmed diagnosis',
        gender: 'All',
        ageMin: '18',
        ageMax: '75',
        healthyVolunteerAccepted: false,
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

      const result = await studyService.createStudy(fullStudyData, userId);
      expect(result.success).toBe(true);
      studyId = result.studyId!;

      // Read back ALL fields
      const study = await studyService.getStudyById(studyId, userId);
      
      expect(study.name).toBe(fullStudyData.name);
      expect(study.official_title).toBe(fullStudyData.officialTitle);
      expect(study.secondary_identifier).toBe(fullStudyData.secondaryIdentifier);
      expect(study.summary).toBe(fullStudyData.summary);
      expect(study.principal_investigator).toBe(fullStudyData.principalInvestigator);
      expect(study.sponsor).toBe(fullStudyData.sponsor);
      expect(study.collaborators).toBe(fullStudyData.collaborators);
      expect(study.phase).toBe(fullStudyData.phase);
      expect(study.protocol_type).toBe(fullStudyData.protocolType);
      expect(study.expected_total_enrollment).toBe(fullStudyData.expectedTotalEnrollment);
      expect(study.facility_name).toBe(fullStudyData.facilityName);
      expect(study.facility_city).toBe(fullStudyData.facilityCity);
      expect(study.facility_state).toBe(fullStudyData.facilityState);
      expect(study.facility_zip).toBe(fullStudyData.facilityZip);
      expect(study.facility_country).toBe(fullStudyData.facilityCountry);
      expect(study.facility_recruitment_status).toBe(fullStudyData.facilityRecruitmentStatus);
      expect(study.facility_contact_name).toBe(fullStudyData.facilityContactName);
      expect(study.facility_contact_degree).toBe(fullStudyData.facilityContactDegree);
      expect(study.facility_contact_phone).toBe(fullStudyData.facilityContactPhone);
      expect(study.facility_contact_email).toBe(fullStudyData.facilityContactEmail);
      expect(study.protocol_description).toBe(fullStudyData.protocolDescription);
      expect(study.medline_identifier).toBe(fullStudyData.medlineIdentifier);
      expect(study.url).toBe(fullStudyData.url);
      expect(study.url_description).toBe(fullStudyData.urlDescription);
      expect(study.conditions).toBe(fullStudyData.conditions);
      expect(study.keywords).toBe(fullStudyData.keywords);
      expect(study.interventions).toBe(fullStudyData.interventions);
      expect(study.eligibility).toBe(fullStudyData.eligibility);
      expect(study.gender).toBe(fullStudyData.gender);
      expect(study.age_min).toBe(fullStudyData.ageMin);
      expect(study.age_max).toBe(fullStudyData.ageMax);
      expect(study.purpose).toBe(fullStudyData.purpose);
      expect(study.allocation).toBe(fullStudyData.allocation);
      expect(study.masking).toBe(fullStudyData.masking);
      expect(study.control).toBe(fullStudyData.control);
      expect(study.assignment).toBe(fullStudyData.assignment);
      expect(study.endpoint).toBe(fullStudyData.endpoint);
      expect(study.duration).toBe(fullStudyData.duration);
      expect(study.selection).toBe(fullStudyData.selection);
      expect(study.timing).toBe(fullStudyData.timing);
    });

    it('should update ALL main study fields', async () => {
      // Create minimal study first
      const createResult = await studyService.createStudy({
        name: 'Update All Fields',
        uniqueIdentifier: `UAF-${Date.now()}`
      }, userId);

      studyId = createResult.studyId!;

      // Update ALL fields
      const updateResult = await studyService.updateStudy(studyId, {
        name: 'Updated Name',
        officialTitle: 'Updated Official Title',
        summary: 'Updated summary',
        principalInvestigator: 'Dr. Updated',
        sponsor: 'Updated Pharma',
        collaborators: 'Updated Collaborator',
        phase: 'IV',
        protocolType: 'observational',
        expectedTotalEnrollment: 999,
        datePlannedStart: '2026-01-01',
        datePlannedEnd: '2028-12-31',
        facilityName: 'Updated Hospital',
        facilityCity: 'Updated City',
        facilityState: 'UC',
        facilityZip: '99999',
        facilityCountry: 'Updated Country',
        purpose: 'Prevention',
        allocation: 'Non-Randomized',
        masking: 'Single',
        control: 'Active'
      }, userId);

      expect(updateResult.success).toBe(true);

      const study = await studyService.getStudyById(studyId, userId);
      expect(study.name).toBe('Updated Name');
      expect(study.official_title).toBe('Updated Official Title');
      expect(study.principal_investigator).toBe('Dr. Updated');
      expect(study.sponsor).toBe('Updated Pharma');
      expect(study.phase).toBe('IV');
      expect(study.expected_total_enrollment).toBe(999);
      expect(study.facility_name).toBe('Updated Hospital');
      expect(study.purpose).toBe('Prevention');
    });
  });
});
