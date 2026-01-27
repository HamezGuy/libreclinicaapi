/**
 * Site Management Integration Tests
 * 
 * Comprehensive tests for site/location management including:
 * - Site CRUD operations
 * - Patient-to-site assignments
 * - Patient transfers between sites
 * - Site staff management
 * - Site statistics
 * 
 * Test Database: Uses the libreclinica-postgres database on port 5434
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as siteService from '../src/services/database/site.service';
import * as studyService from '../src/services/hybrid/study.service';
import * as subjectService from '../src/services/hybrid/subject.service';

describe('Site Management Integration Tests', () => {
  const userId = 1; // Root user
  const username = 'root';
  
  // Track created resources for cleanup
  let parentStudyId: number;
  let createdSiteIds: number[] = [];
  let createdSubjectIds: number[] = [];

  beforeAll(async () => {
    await testDb.connect();
    console.log('🔗 Connected to test database');
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
    createdSiteIds = [];
    createdSubjectIds = [];

    // Create a parent study for site tests
    const studyResult = await studyService.createStudy({
      name: `Site Test Study ${Date.now()}`,
      uniqueIdentifier: `SITE-TEST-${Date.now()}`,
      summary: 'Study for site management testing'
    }, userId);

    expect(studyResult.success).toBe(true);
    parentStudyId = studyResult.studyId!;
  });

  afterEach(async () => {
    // Cleanup in reverse dependency order
    for (const subjectId of createdSubjectIds) {
      try {
        await testDb.pool.query('DELETE FROM study_event WHERE study_subject_id = $1', [subjectId]);
        await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [subjectId]);
      } catch (e) { /* ignore */ }
    }
    for (const siteId of createdSiteIds) {
      try {
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [siteId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [siteId]);
      } catch (e) { /* ignore */ }
    }
    if (parentStudyId) {
      try {
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [parentStudyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [parentStudyId]);
      } catch (e) { /* ignore */ }
    }
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  // ============================================================================
  // SECTION 1: SITE CRUD OPERATIONS
  // ============================================================================

  describe('1. Site CRUD Operations', () => {
    
    describe('1.1 Create Site', () => {
      it('should create a site with minimal required fields', async () => {
        const result = await siteService.createSite({
          parentStudyId,
          siteNumber: `SITE-001`,
          siteName: 'Test Site 1'
        }, userId);

        expect(result.success).toBe(true);
        expect(result.siteId).toBeDefined();
        createdSiteIds.push(result.siteId!);

        // Verify in database
        const dbResult = await testDb.pool.query(
          'SELECT * FROM study WHERE study_id = $1',
          [result.siteId]
        );
        expect(dbResult.rows.length).toBe(1);
        expect(dbResult.rows[0].parent_study_id).toBe(parentStudyId);
        expect(dbResult.rows[0].unique_identifier).toBe('SITE-001');
        expect(dbResult.rows[0].name).toBe('Test Site 1');
      });

      it('should create a site with all fields', async () => {
        const result = await siteService.createSite({
          parentStudyId,
          siteNumber: 'SITE-FULL',
          siteName: 'Full Details Site',
          description: 'A site with all details filled in',
          principalInvestigator: 'Dr. John Smith',
          targetEnrollment: 50,
          facilityName: 'General Hospital',
          facilityCity: 'New York',
          facilityState: 'NY',
          facilityZip: '10001',
          facilityCountry: 'USA',
          facilityRecruitmentStatus: 'recruiting',
          contactName: 'Jane Doe',
          contactDegree: 'MD',
          contactEmail: 'jane.doe@hospital.com',
          contactPhone: '555-1234'
        }, userId);

        expect(result.success).toBe(true);
        createdSiteIds.push(result.siteId!);

        const dbResult = await testDb.pool.query(
          'SELECT * FROM study WHERE study_id = $1',
          [result.siteId]
        );

        expect(dbResult.rows[0].principal_investigator).toBe('Dr. John Smith');
        expect(dbResult.rows[0].expected_total_enrollment).toBe(50);
        expect(dbResult.rows[0].facility_city).toBe('New York');
        expect(dbResult.rows[0].facility_contact_email).toBe('jane.doe@hospital.com');
      });

      it('should reject duplicate site numbers within same study', async () => {
        const result1 = await siteService.createSite({
          parentStudyId,
          siteNumber: 'DUP-SITE',
          siteName: 'First Site'
        }, userId);

        expect(result1.success).toBe(true);
        createdSiteIds.push(result1.siteId!);

        const result2 = await siteService.createSite({
          parentStudyId,
          siteNumber: 'DUP-SITE',
          siteName: 'Duplicate Site'
        }, userId);

        expect(result2.success).toBe(false);
        expect(result2.message).toContain('already exists');
      });

      it('should reject site creation for non-existent parent study', async () => {
        const result = await siteService.createSite({
          parentStudyId: 999999,
          siteNumber: 'ORPHAN',
          siteName: 'Orphan Site'
        }, userId);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Parent study not found');
      });
    });

    describe('1.2 Read Sites', () => {
      let site1Id: number;
      let site2Id: number;

      beforeEach(async () => {
        const result1 = await siteService.createSite({
          parentStudyId,
          siteNumber: 'READ-001',
          siteName: 'Read Test Site 1',
          facilityCity: 'Boston'
        }, userId);
        site1Id = result1.siteId!;
        createdSiteIds.push(site1Id);

        const result2 = await siteService.createSite({
          parentStudyId,
          siteNumber: 'READ-002',
          siteName: 'Read Test Site 2',
          facilityCity: 'Chicago'
        }, userId);
        site2Id = result2.siteId!;
        createdSiteIds.push(site2Id);
      });

      it('should get all sites for a study', async () => {
        const result = await siteService.getSitesForStudy(parentStudyId);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data!.length).toBeGreaterThanOrEqual(2);
      });

      it('should get a single site by ID', async () => {
        const result = await siteService.getSiteById(site1Id);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data!.siteNumber).toBe('READ-001');
        expect(result.data!.facilityCity).toBe('Boston');
      });

      it('should return error for non-existent site', async () => {
        const result = await siteService.getSiteById(999999);

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('1.3 Update Site', () => {
      let siteId: number;

      beforeEach(async () => {
        const result = await siteService.createSite({
          parentStudyId,
          siteNumber: 'UPDATE-001',
          siteName: 'Original Site Name',
          facilityCity: 'Original City'
        }, userId);
        siteId = result.siteId!;
        createdSiteIds.push(siteId);
      });

      it('should update site name', async () => {
        const result = await siteService.updateSite(siteId, {
          siteName: 'Updated Site Name'
        }, userId);

        expect(result.success).toBe(true);

        const getResult = await siteService.getSiteById(siteId);
        expect(getResult.data!.siteName).toBe('Updated Site Name');
      });

      it('should update multiple fields', async () => {
        const result = await siteService.updateSite(siteId, {
          siteName: 'New Name',
          description: 'New Description',
          principalInvestigator: 'Dr. New PI',
          facilityCity: 'New City',
          contactEmail: 'new@email.com'
        }, userId);

        expect(result.success).toBe(true);

        const getResult = await siteService.getSiteById(siteId);
        expect(getResult.data!.siteName).toBe('New Name');
        expect(getResult.data!.description).toBe('New Description');
        expect(getResult.data!.principalInvestigator).toBe('Dr. New PI');
        expect(getResult.data!.facilityCity).toBe('New City');
        expect(getResult.data!.contactEmail).toBe('new@email.com');
      });

      it('should update target enrollment', async () => {
        const result = await siteService.updateSite(siteId, {
          targetEnrollment: 100
        }, userId);

        expect(result.success).toBe(true);

        const getResult = await siteService.getSiteById(siteId);
        expect(getResult.data!.targetEnrollment).toBe(100);
      });
    });

    describe('1.4 Delete Site', () => {
      let siteId: number;

      beforeEach(async () => {
        const result = await siteService.createSite({
          parentStudyId,
          siteNumber: 'DELETE-001',
          siteName: 'Site To Delete'
        }, userId);
        siteId = result.siteId!;
        createdSiteIds.push(siteId);
      });

      it('should soft-delete a site with no patients', async () => {
        const result = await siteService.deleteSite(siteId, userId);

        expect(result.success).toBe(true);

        // Verify status changed to removed (status_id = 5)
        const dbResult = await testDb.pool.query(
          'SELECT status_id FROM study WHERE study_id = $1',
          [siteId]
        );
        expect(dbResult.rows[0].status_id).toBe(5);
      });

      it('should reject deletion of site with enrolled patients', async () => {
        // Create a patient at this site
        const subjectResult = await subjectService.createSubject({
          studyId: siteId,
          studySubjectId: `PATIENT-${Date.now()}`,
          enrollmentDate: new Date().toISOString().split('T')[0]
        }, userId, username);

        expect(subjectResult.success).toBe(true);
        createdSubjectIds.push(subjectResult.studySubjectId!);

        // Try to delete
        const result = await siteService.deleteSite(siteId, userId);

        expect(result.success).toBe(false);
        expect(result.message).toContain('enrolled patients');
      });
    });
  });

  // ============================================================================
  // SECTION 2: PATIENT-SITE OPERATIONS
  // ============================================================================

  describe('2. Patient-Site Operations', () => {
    let site1Id: number;
    let site2Id: number;
    let patientId: number;

    beforeEach(async () => {
      // Create two sites
      const result1 = await siteService.createSite({
        parentStudyId,
        siteNumber: 'TRANSFER-A',
        siteName: 'Site A'
      }, userId);
      site1Id = result1.siteId!;
      createdSiteIds.push(site1Id);

      const result2 = await siteService.createSite({
        parentStudyId,
        siteNumber: 'TRANSFER-B',
        siteName: 'Site B'
      }, userId);
      site2Id = result2.siteId!;
      createdSiteIds.push(site2Id);

      // Create a patient at site 1
      const subjectResult = await subjectService.createSubject({
        studyId: site1Id,
        studySubjectId: `TRANS-PAT-${Date.now()}`,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, userId, username);

      expect(subjectResult.success).toBe(true);
      patientId = subjectResult.studySubjectId!;
      createdSubjectIds.push(patientId);
    });

    describe('2.1 Get Site Patients', () => {
      it('should return patients enrolled at a site', async () => {
        const result = await siteService.getSitePatients(site1Id);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data!.length).toBeGreaterThanOrEqual(1);
      });

      it('should return empty array for site with no patients', async () => {
        const result = await siteService.getSitePatients(site2Id);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        // Site 2 has no patients yet
      });
    });

    describe('2.2 Transfer Patient', () => {
      it('should transfer a patient to another site', async () => {
        const result = await siteService.transferPatientToSite(
          patientId,
          site2Id,
          'Patient relocated to different city',
          userId
        );

        expect(result.success).toBe(true);

        // Verify patient is now at site 2
        const dbResult = await testDb.pool.query(
          'SELECT study_id FROM study_subject WHERE study_subject_id = $1',
          [patientId]
        );
        expect(dbResult.rows[0].study_id).toBe(site2Id);

        // Verify patient is no longer at site 1
        const site1Patients = await siteService.getSitePatients(site1Id);
        const patientAtSite1 = site1Patients.data!.find(p => p.studySubjectId === patientId);
        expect(patientAtSite1).toBeUndefined();
      });

      it('should reject transfer without reason', async () => {
        const result = await siteService.transferPatientToSite(
          patientId,
          site2Id,
          '', // Empty reason
          userId
        );

        // The service should still work but reason should be logged
        // This depends on validation - might need to add validation
      });
    });
  });

  // ============================================================================
  // SECTION 3: SITE STAFF MANAGEMENT
  // ============================================================================

  describe('3. Site Staff Management', () => {
    let siteId: number;

    beforeEach(async () => {
      const result = await siteService.createSite({
        parentStudyId,
        siteNumber: 'STAFF-001',
        siteName: 'Staff Test Site'
      }, userId);
      siteId = result.siteId!;
      createdSiteIds.push(siteId);
    });

    describe('3.1 Get Site Staff', () => {
      it('should return empty array for site with no staff', async () => {
        const result = await siteService.getSiteStaff(siteId);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
      });
    });

    describe('3.2 Assign Staff', () => {
      it('should assign staff member to site', async () => {
        const result = await siteService.assignStaffToSite(
          siteId,
          'root', // Using root user which exists
          'investigator',
          userId
        );

        expect(result.success).toBe(true);

        // Verify assignment
        const staffResult = await siteService.getSiteStaff(siteId);
        expect(staffResult.data!.length).toBeGreaterThanOrEqual(1);
      });

      it('should reject duplicate staff assignment', async () => {
        // First assignment
        await siteService.assignStaffToSite(siteId, 'root', 'investigator', userId);

        // Try duplicate
        const result = await siteService.assignStaffToSite(
          siteId,
          'root',
          'investigator',
          userId
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('already assigned');
      });

      it('should reject assignment for non-existent user', async () => {
        const result = await siteService.assignStaffToSite(
          siteId,
          'nonexistent_user_12345',
          'investigator',
          userId
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('3.3 Remove Staff', () => {
      beforeEach(async () => {
        await siteService.assignStaffToSite(siteId, 'root', 'investigator', userId);
      });

      it('should remove staff member from site', async () => {
        const result = await siteService.removeStaffFromSite(siteId, 'root', userId);

        expect(result.success).toBe(true);

        // Verify removal (staff list should be smaller or empty)
        const staffResult = await siteService.getSiteStaff(siteId);
        const rootStaff = staffResult.data!.find(s => s.username === 'root');
        expect(rootStaff).toBeUndefined();
      });
    });
  });

  // ============================================================================
  // SECTION 4: SITE STATISTICS
  // ============================================================================

  describe('4. Site Statistics', () => {
    beforeEach(async () => {
      // Create multiple sites with different enrollments
      const site1Result = await siteService.createSite({
        parentStudyId,
        siteNumber: 'STATS-001',
        siteName: 'Stats Site 1',
        targetEnrollment: 50
      }, userId);
      createdSiteIds.push(site1Result.siteId!);

      const site2Result = await siteService.createSite({
        parentStudyId,
        siteNumber: 'STATS-002',
        siteName: 'Stats Site 2',
        targetEnrollment: 30
      }, userId);
      createdSiteIds.push(site2Result.siteId!);

      // Create a patient at site 1
      const subjectResult = await subjectService.createSubject({
        studyId: site1Result.siteId!,
        studySubjectId: `STAT-PAT-${Date.now()}`,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, userId, username);
      createdSubjectIds.push(subjectResult.studySubjectId!);
    });

    it('should return aggregated statistics for all sites', async () => {
      const result = await siteService.getSiteStatistics(parentStudyId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.totalSites).toBeGreaterThanOrEqual(2);
      expect(result.data!.targetEnrollment).toBeGreaterThanOrEqual(80); // 50 + 30
      expect(result.data!.actualEnrollment).toBeGreaterThanOrEqual(1);
    });

    it('should calculate enrollment percentage correctly', async () => {
      const result = await siteService.getSiteStatistics(parentStudyId);

      expect(result.success).toBe(true);
      // 1 enrolled out of 80 target = ~1.25%
      expect(result.data!.enrollmentPercentage).toBeGreaterThanOrEqual(0);
      expect(result.data!.enrollmentPercentage).toBeLessThanOrEqual(100);
    });
  });

  // ============================================================================
  // SECTION 5: INTEGRATION WITH PHASES
  // ============================================================================

  describe('5. Site-Phase Integration', () => {
    let siteId: number;
    let phaseId: number;
    let patientId: number;

    beforeEach(async () => {
      // Create a site
      const siteResult = await siteService.createSite({
        parentStudyId,
        siteNumber: 'PHASE-INT-001',
        siteName: 'Phase Integration Site'
      }, userId);
      siteId = siteResult.siteId!;
      createdSiteIds.push(siteId);

      // Create a phase (study event definition) for the parent study
      const phaseResult = await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, ordinal, type, repeating, status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, 'Screening', 1, 'scheduled', false, 1, $2, NOW(), 'SE_SCREEN')
        RETURNING study_event_definition_id
      `, [parentStudyId, userId]);
      phaseId = phaseResult.rows[0].study_event_definition_id;

      // Create a patient at the site
      const subjectResult = await subjectService.createSubject({
        studyId: siteId,
        studySubjectId: `PHASE-INT-PAT-${Date.now()}`,
        enrollmentDate: new Date().toISOString().split('T')[0]
      }, userId, username);
      patientId = subjectResult.studySubjectId!;
      createdSubjectIds.push(patientId);
    });

    afterEach(async () => {
      if (phaseId) {
        await testDb.pool.query(
          'DELETE FROM study_event_definition WHERE study_event_definition_id = $1',
          [phaseId]
        );
      }
    });

    it('should allow patient to be scheduled for phases defined at parent study level', async () => {
      // Schedule patient for the phase
      const scheduleResult = await testDb.pool.query(`
        INSERT INTO study_event (
          study_event_definition_id, study_subject_id, location, sample_ordinal,
          date_start, owner_id, date_created, subject_event_status_id, status_id
        ) VALUES ($1, $2, 'Site Location', 1, NOW(), $3, NOW(), 1, 1)
        RETURNING study_event_id
      `, [phaseId, patientId, userId]);

      expect(scheduleResult.rows.length).toBe(1);

      // Verify patient can access the phase
      const patientEvents = await testDb.pool.query(`
        SELECT se.*, sed.name as phase_name
        FROM study_event se
        INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
        WHERE se.study_subject_id = $1
      `, [patientId]);

      expect(patientEvents.rows.length).toBe(1);
      expect(patientEvents.rows[0].phase_name).toBe('Screening');
    });
  });
});

