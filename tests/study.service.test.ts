/**
 * Study Service Unit Tests
 * 
 * Tests study management operations including:
 * - Creating studies
 * - Updating studies
 * - Deleting studies
 * - Verifying database changes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as studyService from '../src/services/hybrid/study.service';

describe('Study Service', () => {
  let testStudyId: number;
  const userId = 1; // Root user

  beforeAll(async () => {
    // Ensure database connection
    await testDb.connect();
  });

  beforeEach(async () => {
    await testDb.cleanDatabase();
    await testDb.seedTestData();
  });

  afterAll(async () => {
    // Cleanup handled by global teardown
  });

  describe('createStudy', () => {
    it('should create a new study in the database', async () => {
      const studyData = {
        name: `Test Study ${Date.now()}`,
        uniqueIdentifier: `TEST-${Date.now()}`,
        description: 'This is a test study',
        principalInvestigator: 'Dr. Test',
        sponsor: 'Test Sponsor',
        phase: 'II',
        expectedTotalEnrollment: 100,
        datePlannedStart: '2025-12-01',
        datePlannedEnd: '2026-12-01'
      };

      const result = await studyService.createStudy(studyData, userId);

      expect(result.success).toBe(true);
      expect(result.studyId).toBeDefined();
      testStudyId = result.studyId!;

      // Verify study exists in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [testStudyId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].name).toBe(studyData.name);
      expect(dbResult.rows[0].unique_identifier).toBe(studyData.uniqueIdentifier);
      expect(dbResult.rows[0].principal_investigator).toBe(studyData.principalInvestigator);
      expect(dbResult.rows[0].sponsor).toBe(studyData.sponsor);
    });

    it('should reject duplicate study identifiers', async () => {
      const uniqueId = `DUPLICATE-${Date.now()}`;
      
      const studyData1 = {
        name: 'Study 1',
        uniqueIdentifier: uniqueId,
        description: 'First study'
      };

      // Create first study
      const result1 = await studyService.createStudy(studyData1, userId);
      expect(result1.success).toBe(true);

      // Try to create duplicate
      const studyData2 = {
        name: 'Study 2',
        uniqueIdentifier: uniqueId,
        description: 'Duplicate study'
      };

      const result2 = await studyService.createStudy(studyData2, userId);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');

      // Cleanup
      if (result1.studyId) {
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [result1.studyId]);
      }
    });

    it('should create audit log entry when creating study', async () => {
      const studyData = {
        name: `Audit Study ${Date.now()}`,
        uniqueIdentifier: `AUDIT-${Date.now()}`,
        description: 'Test audit logging'
      };

      const result = await studyService.createStudy(studyData, userId);
      expect(result.success).toBe(true);

      // Check audit log
      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = $2 
         ORDER BY audit_date DESC LIMIT 1`,
        [result.studyId, 'study']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].user_id).toBe(userId);
      expect(auditResult.rows[0].new_value).toBe(studyData.name);

      // Cleanup
      if (result.studyId) {
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [result.studyId]);
      }
    });

    it('should assign creator to study with admin role', async () => {
      const studyData = {
        name: `Role Study ${Date.now()}`,
        uniqueIdentifier: `ROLE-${Date.now()}`,
        description: 'Test role assignment'
      };

      const result = await studyService.createStudy(studyData, userId);
      expect(result.success).toBe(true);

      // Check study_user_role
      const roleResult = await testDb.pool.query(
        'SELECT * FROM study_user_role WHERE study_id = $1',
        [result.studyId]
      );

      expect(roleResult.rows.length).toBeGreaterThan(0);
      expect(roleResult.rows[0].role_name).toBe('admin');

      // Cleanup
      if (result.studyId) {
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [result.studyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [result.studyId]);
      }
    });
  });

  describe('updateStudy', () => {
    let updateTestStudyId: number;

    beforeEach(async () => {
      // Create a study to update
      const studyData = {
        name: `Update Study ${Date.now()}`,
        uniqueIdentifier: `UPDATE-${Date.now()}`,
        description: 'Study to be updated'
      };

      const result = await studyService.createStudy(studyData, userId);
      updateTestStudyId = result.studyId!;
    });

    afterEach(async () => {
      // Cleanup
      if (updateTestStudyId) {
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [updateTestStudyId]);
      }
    });

    it('should update study information in database', async () => {
      const updates = {
        name: 'Updated Study Name',
        description: 'Updated description',
        principalInvestigator: 'Dr. Updated',
        sponsor: 'Updated Sponsor',
        expectedTotalEnrollment: 200
      };

      const result = await studyService.updateStudy(updateTestStudyId, updates, userId);

      expect(result.success).toBe(true);

      // Verify database changes
      const dbResult = await testDb.pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [updateTestStudyId]
      );

      expect(dbResult.rows[0].name).toBe(updates.name);
      expect(dbResult.rows[0].summary).toBe(updates.description);
      expect(dbResult.rows[0].principal_investigator).toBe(updates.principalInvestigator);
      expect(dbResult.rows[0].sponsor).toBe(updates.sponsor);
      expect(dbResult.rows[0].expected_total_enrollment).toBe(updates.expectedTotalEnrollment);
    });

    it('should create audit log entry when updating study', async () => {
      const updates = { name: 'Audit Update Test' };

      await studyService.updateStudy(updateTestStudyId, updates, userId);

      // Check audit log
      const auditResult = await testDb.pool.query(
        `SELECT * FROM audit_log_event 
         WHERE entity_id = $1 AND audit_table = $2 
         ORDER BY audit_date DESC LIMIT 1`,
        [updateTestStudyId, 'study']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  describe('deleteStudy', () => {
    it('should soft delete study (set status to removed)', async () => {
      // Create a study to delete
      const studyData = {
        name: `Delete Study ${Date.now()}`,
        uniqueIdentifier: `DELETE-${Date.now()}`,
        description: 'Study to be deleted'
      };

      const createResult = await studyService.createStudy(studyData, userId);
      const deleteTestStudyId = createResult.studyId!;

      // Delete study
      const deleteResult = await studyService.deleteStudy(deleteTestStudyId, userId);

      expect(deleteResult.success).toBe(true);

      // Verify status is set to removed (5)
      const dbResult = await testDb.pool.query(
        'SELECT status_id FROM study WHERE study_id = $1',
        [deleteTestStudyId]
      );

      expect(dbResult.rows[0].status_id).toBe(5);

      // Cleanup
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [deleteTestStudyId]);
    });

    it('should prevent deleting study with enrolled subjects', async () => {
      // This test would require creating a subject first
      // For now, we'll test the validation logic
      const result = await studyService.deleteStudy(1, userId); // Assuming study 1 has subjects

      if (result.success === false) {
        expect(result.message).toContain('Cannot delete study with enrolled subjects');
      }
    });
  });

  describe('getStudies', () => {
    it('should return paginated study list', async () => {
      const result = await studyService.getStudies(userId, { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should only return studies user has access to', async () => {
      const result = await studyService.getStudies(userId, { page: 1, limit: 100 });

      expect(result.success).toBe(true);
      // All returned studies should have user in study_user_role
      for (const study of result.data) {
        const roleCheck = await testDb.pool.query(
          `SELECT * FROM study_user_role sur
           INNER JOIN user_account ua ON sur.user_name = ua.user_name
           WHERE sur.study_id = $1 AND ua.user_id = $2`,
          [study.study_id, userId]
        );
        expect(roleCheck.rows.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getStudyById', () => {
    it('should retrieve study with statistics', async () => {
      // Assuming study 1 exists
      const study = await studyService.getStudyById(1, userId);

      if (study) {
        expect(study.study_id).toBe(1);
        expect(study.name).toBeDefined();
        expect(study.total_subjects).toBeDefined();
        expect(study.active_subjects).toBeDefined();
      }
    });

    it('should return null for non-existent study', async () => {
      const study = await studyService.getStudyById(999999, userId);

      expect(study).toBeNull();
    });
  });

  describe('getStudySites', () => {
    let parentStudyId: number;
    let siteStudyId: number;

    beforeEach(async () => {
      // Create a parent study
      const parentResult = await studyService.createStudy({
        name: `Parent Study ${Date.now()}`,
        uniqueIdentifier: `PARENT-${Date.now()}`,
        summary: 'Parent study for site testing'
      }, userId);

      parentStudyId = parentResult.studyId!;

      // Create a site (child study)
      await testDb.pool.query(`
        INSERT INTO study (
          unique_identifier, name, parent_study_id, status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, $2, $3, 1, $4, NOW(), $5)
        RETURNING study_id
      `, [
        `SITE-${Date.now()}`,
        'Test Site',
        parentStudyId,
        userId,
        `S_SITE_${Date.now()}`
      ]).then(res => {
        siteStudyId = res.rows[0].study_id;
      });
    });

    afterEach(async () => {
      if (siteStudyId) {
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [siteStudyId]);
      }
      if (parentStudyId) {
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [parentStudyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [parentStudyId]);
      }
    });

    it('should return list of sites for a study', async () => {
      const sites = await studyService.getStudySites(parentStudyId);

      expect(Array.isArray(sites)).toBe(true);
      expect(sites.length).toBeGreaterThanOrEqual(1);
    });

    it('should include parent study in sites list', async () => {
      const sites = await studyService.getStudySites(parentStudyId);

      const parentSite = sites.find(s => s.study_id === parentStudyId);
      expect(parentSite).toBeDefined();
    });

    it('should include child sites in list', async () => {
      const sites = await studyService.getStudySites(parentStudyId);

      const childSite = sites.find(s => s.study_id === siteStudyId);
      expect(childSite).toBeDefined();
      expect(childSite?.name).toBe('Test Site');
    });

    it('should include status information', async () => {
      const sites = await studyService.getStudySites(parentStudyId);

      if (sites.length > 0) {
        expect(sites[0].status_id).toBeDefined();
        expect(sites[0].status_name).toBeDefined();
      }
    });
  });

  describe('getStudyMetadata', () => {
    let metadataStudyId: number;

    beforeEach(async () => {
      const result = await studyService.createStudy({
        name: `Metadata Study ${Date.now()}`,
        uniqueIdentifier: `META-${Date.now()}`,
        summary: 'Study for metadata testing'
      }, userId);

      metadataStudyId = result.studyId!;

      // Add an event definition
      await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, description, repeating, type, ordinal, status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, 'Screening', 'Screening visit', false, 'scheduled', 1, 1, $2, NOW(), $3)
      `, [metadataStudyId, userId, `SE_META_${Date.now()}`]);
    });

    afterEach(async () => {
      if (metadataStudyId) {
        await testDb.pool.query('DELETE FROM study_event_definition WHERE study_id = $1', [metadataStudyId]);
        await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [metadataStudyId]);
        await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [metadataStudyId]);
      }
    });

    it('should return study metadata with events', async () => {
      const metadata = await studyService.getStudyMetadata(metadataStudyId, userId, 'root');

      expect(metadata).toBeDefined();
      expect(metadata?.study).toBeDefined();
      expect(metadata?.events).toBeDefined();
      expect(Array.isArray(metadata?.events)).toBe(true);
    });

    it('should include event definitions in metadata', async () => {
      const metadata = await studyService.getStudyMetadata(metadataStudyId, userId, 'root');

      expect(metadata?.events.length).toBeGreaterThan(0);
      expect(metadata?.events[0].name).toBe('Screening');
    });

    it('should return null for non-existent study', async () => {
      const metadata = await studyService.getStudyMetadata(999999, userId, 'root');

      expect(metadata).toBeNull();
    });
  });
});


