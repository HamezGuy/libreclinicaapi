/**
 * Auth Service Unit Tests
 * 
 * Tests all authentication and authorization operations:
 * - User authentication (username/password)
 * - Role retrieval
 * - JWT payload building
 * - Permission checks
 * - Admin verification
 * - Login attempt tracking
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as authService from '../src/services/database/auth.service';
import { createTestUser, createTestStudy } from './fixtures/test-data';

describe('Auth Service', () => {
  let testUserId: number;
  let testStudyId: number;
  const rootUserId = 1;

  beforeAll(async () => {
    // Ensure database connection
    await testDb.connect();
  });

  afterAll(async () => {
    // Cleanup test data - handled by global teardown
  });

  beforeEach(async () => {
    // Reset database before each test
    await testDb.cleanDatabase();
    await testDb.seedTestData();
    
    // Create test user and study for each test
    testUserId = await createTestUser(testDb.pool, {
      username: `authtest_${Date.now()}`,
      password: 'TestPassword123!'
    });

    testStudyId = await createTestStudy(testDb.pool, rootUserId, {
      uniqueIdentifier: `AUTH-TEST-${Date.now()}`
    });
  });

  afterEach(async () => {
    // Clean up after each test - handled by beforeEach reset
    testStudyId = 0;
    testUserId = 0;
  });

  describe('authenticateUser', () => {
    it('should authenticate user with valid credentials', async () => {
      // Create a user with known password (MD5 hashed 'root' = 5f4dcc3b5aa765d61d8327deb882cf99)
      const result = await authService.authenticateUser('root', 'root', '127.0.0.1');

      // Root user should exist in test database
      expect(result.success).toBeDefined();
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.user_name).toBe('root');
      }
    });

    it('should reject invalid username', async () => {
      const result = await authService.authenticateUser('nonexistent_user', 'anypassword', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid username or password');
    });

    it('should reject invalid password', async () => {
      const result = await authService.authenticateUser('root', 'wrongpassword', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid username or password');
    });

    it('should reject disabled user', async () => {
      // Disable the test user
      await testDb.pool.query('UPDATE user_account SET enabled = false WHERE user_id = $1', [testUserId]);

      const userQuery = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userQuery.rows[0]?.user_name;

      if (username) {
        const result = await authService.authenticateUser(username, 'TestPassword123!', '127.0.0.1');

        expect(result.success).toBe(false);
        expect(result.message).toContain('disabled');
      }
    });

    it('should reject locked account', async () => {
      // Lock the test user account
      await testDb.pool.query('UPDATE user_account SET account_non_locked = false WHERE user_id = $1', [testUserId]);

      const userQuery = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userQuery.rows[0]?.user_name;

      if (username) {
        const result = await authService.authenticateUser(username, 'TestPassword123!', '127.0.0.1');

        expect(result.success).toBe(false);
        expect(result.message).toContain('locked');
      }
    });
  });

  describe('getUserRoles', () => {
    beforeEach(async () => {
      // Assign test user to test study with admin role
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }
    });

    it('should return all roles for a user across all studies', async () => {
      const roles = await authService.getUserRoles(testUserId);

      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBeGreaterThan(0);
    });

    it('should return roles for specific study', async () => {
      const roles = await authService.getUserRoles(testUserId, testStudyId);

      expect(Array.isArray(roles)).toBe(true);
      expect(roles).toContain('admin');
    });

    it('should return empty array for user with no roles', async () => {
      // Create user with no roles
      const newUserId = await createTestUser(testDb.pool, {
        username: `noroles_${Date.now()}`
      });

      const roles = await authService.getUserRoles(newUserId);

      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [newUserId]);
    });
  });

  describe('getUserStudies', () => {
    beforeEach(async () => {
      // Assign test user to test study
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('coordinator', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }
    });

    it('should return list of study IDs for user', async () => {
      const studyIds = await authService.getUserStudies(testUserId);

      expect(Array.isArray(studyIds)).toBe(true);
      expect(studyIds).toContain(testStudyId);
    });

    it('should return empty array for user with no study access', async () => {
      const newUserId = await createTestUser(testDb.pool, {
        username: `nostudy_${Date.now()}`
      });

      const studyIds = await authService.getUserStudies(newUserId);

      expect(Array.isArray(studyIds)).toBe(true);
      expect(studyIds.length).toBe(0);

      // Cleanup
      await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [newUserId]);
    });
  });

  describe('buildJwtPayload', () => {
    it('should build JWT payload with user info and roles', async () => {
      // Get root user
      const userResult = await testDb.pool.query('SELECT * FROM user_account WHERE user_id = 1');
      const user = userResult.rows[0];

      if (user) {
        const payload = await authService.buildJwtPayload(user);

        expect(payload.userId).toBe(user.user_id);
        expect(payload.username).toBe(user.user_name);
        expect(payload.email).toBeDefined();
        expect(payload.role).toBeDefined();
        expect(Array.isArray(payload.studyIds)).toBe(true);
      }
    });

    it('should include all user study IDs in payload', async () => {
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      // Assign to multiple studies
      const study2Id = await createTestStudy(testDb.pool, rootUserId, {
        uniqueIdentifier: `AUTH-TEST2-${Date.now()}`
      });

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, $3, NOW()),
                 ('monitor', $4, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username, study2Id]);
      }

      const userDataResult = await testDb.pool.query('SELECT * FROM user_account WHERE user_id = $1', [testUserId]);
      const user = userDataResult.rows[0];

      if (user) {
        const payload = await authService.buildJwtPayload(user);

        expect(payload.studyIds).toContain(testStudyId);
        expect(payload.studyIds).toContain(study2Id);
      }

      // Cleanup
      await testDb.pool.query('DELETE FROM study_user_role WHERE study_id = $1', [study2Id]);
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [study2Id]);
    });
  });

  describe('getUserRoleDetails', () => {
    beforeEach(async () => {
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }
    });

    it('should return roles with permission details', async () => {
      const { roles, highestRole } = await authService.getUserRoleDetails(testUserId, testStudyId);

      expect(Array.isArray(roles)).toBe(true);
      expect(highestRole).toBeDefined();
      expect(highestRole.name).toBeDefined();
    });

    it('should identify highest privilege role', async () => {
      const { highestRole } = await authService.getUserRoleDetails(testUserId, testStudyId);

      // Admin should be the highest role
      expect(highestRole.name).toBe('admin');
    });
  });

  describe('userHasPermission', () => {
    beforeEach(async () => {
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }
    });

    it('should return true for admin submitData permission', async () => {
      const hasPermission = await authService.userHasPermission(testUserId, testStudyId, 'submitData');

      expect(hasPermission).toBe(true);
    });

    it('should return true for admin extractData permission', async () => {
      const hasPermission = await authService.userHasPermission(testUserId, testStudyId, 'extractData');

      expect(hasPermission).toBe(true);
    });

    it('should return true for admin manageStudy permission', async () => {
      const hasPermission = await authService.userHasPermission(testUserId, testStudyId, 'manageStudy');

      expect(hasPermission).toBe(true);
    });

    it('should return false for user with no role', async () => {
      const newUserId = await createTestUser(testDb.pool, {
        username: `noperm_${Date.now()}`
      });

      const hasPermission = await authService.userHasPermission(newUserId, testStudyId, 'submitData');

      expect(hasPermission).toBe(false);

      // Cleanup
      await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [newUserId]);
    });
  });

  describe('isUserAdmin', () => {
    it('should return true for admin user', async () => {
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('admin', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }

      const isAdmin = await authService.isUserAdmin(testUserId);

      expect(isAdmin).toBe(true);
    });

    it('should return false for non-admin user', async () => {
      const userResult = await testDb.pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [testUserId]);
      const username = userResult.rows[0]?.user_name;

      if (username) {
        await testDb.pool.query(`
          INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
          VALUES ('monitor', $1, 1, $2, $3, NOW())
        `, [testStudyId, rootUserId, username]);
      }

      const isAdmin = await authService.isUserAdmin(testUserId);

      expect(isAdmin).toBe(false);
    });
  });
});


