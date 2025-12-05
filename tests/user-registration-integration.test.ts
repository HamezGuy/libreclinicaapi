/**
 * User Registration Integration Tests
 * 
 * Comprehensive tests for user registration and account creation
 * following LibreClinica models:
 * - user_account table
 * - user_type table (1=admin, 2=user, 3=tech-admin)
 * - study_user_role table (links users to studies with roles)
 * 
 * Tests the full flow: creation → database verification → retrieval → role assignment
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as userService from '../src/services/database/user.service';
import * as authService from '../src/services/database/auth.service';
import { hashPasswordMD5 } from '../src/utils/password.util';

describe('User Registration Integration Tests', () => {
  const creatorId = 1; // Root user
  let testUserIds: number[] = [];
  let testStudyId: number;

  beforeAll(async () => {
    // Verify database connection
    const result = await testDb.pool.query('SELECT NOW()');
    expect(result.rows).toBeDefined();

    // Create a test study for role assignments
    const studyResult = await testDb.pool.query(`
      INSERT INTO study (
        name, unique_identifier, status_id, owner_id, date_created,
        summary, protocol_type, protocol_description, principal_investigator
      ) VALUES (
        'Test Study for User Registration', 'TEST-USER-REG-${Date.now()}', 1, 1, NOW(),
        'Test study for user registration tests', 1, 'Registration test protocol', 'Dr. Test'
      ) RETURNING study_id
    `);
    testStudyId = studyResult.rows[0].study_id;
  });

  afterAll(async () => {
    // Cleanup test users
    for (const userId of testUserIds) {
      try {
        // Delete study_user_role entries first
        await testDb.pool.query('DELETE FROM study_user_role WHERE user_name = (SELECT user_name FROM user_account WHERE user_id = $1)', [userId]);
        // Then delete the user
        await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [userId]);
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    // Delete test study
    if (testStudyId) {
      await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
    }
  });

  describe('Full User Creation Flow', () => {
    it('should create user with all required fields matching LibreClinica schema', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `fulluser_${timestamp}`,
        firstName: 'John',
        lastName: 'Doe',
        email: `john.doe.${timestamp}@example.com`,
        password: 'SecurePassword123!@#',
        phone: '+1-555-123-4567',
        institutionalAffiliation: 'University Hospital',
        role: 'coordinator',
        studyId: testStudyId
      };

      const result = await userService.createUser(userData, creatorId);
      
      expect(result.success).toBe(true);
      expect(result.userId).toBeDefined();
      testUserIds.push(result.userId!);

      // Verify ALL user fields in database
      const dbUser = await testDb.pool.query(`
        SELECT 
          u.*,
          ut.user_type
        FROM user_account u
        LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
        WHERE u.user_id = $1
      `, [result.userId]);

      const user = dbUser.rows[0];
      
      // Core fields
      expect(user.user_name).toBe(userData.username);
      expect(user.first_name).toBe(userData.firstName);
      expect(user.last_name).toBe(userData.lastName);
      expect(user.email).toBe(userData.email);
      expect(user.phone).toBe(userData.phone);
      expect(user.institutional_affiliation).toBe(userData.institutionalAffiliation);
      
      // Password should be MD5 hashed
      expect(user.passwd).toBe(hashPasswordMD5(userData.password));
      expect(user.passwd_timestamp).toBeDefined();
      
      // Status fields
      expect(user.enabled).toBe(true);
      expect(user.account_non_locked).toBe(true);
      expect(user.status_id).toBe(1);
      expect(user.owner_id).toBe(creatorId);
      expect(user.date_created).toBeDefined();
      
      // User type (coordinator maps to user type 2)
      expect(user.user_type_id).toBe(2);
      expect(user.user_type).toBe('user');
    });

    it('should create admin user with user_type_id = 1', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `adminuser_${timestamp}`,
        firstName: 'Admin',
        lastName: 'User',
        email: `admin.${timestamp}@example.com`,
        password: 'SecurePassword123!@#',
        role: 'admin'
      };

      const result = await userService.createUser(userData, creatorId);
      expect(result.success).toBe(true);
      testUserIds.push(result.userId!);

      // Verify admin user type
      const dbUser = await testDb.pool.query(
        'SELECT user_type_id FROM user_account WHERE user_id = $1',
        [result.userId]
      );
      
      expect(dbUser.rows[0].user_type_id).toBe(1);
    });

    it('should automatically assign user to study with role', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `studyuser_${timestamp}`,
        firstName: 'Study',
        lastName: 'User',
        email: `study.user.${timestamp}@example.com`,
        password: 'SecurePassword123!@#',
        role: 'investigator',
        studyId: testStudyId
      };

      const result = await userService.createUser(userData, creatorId);
      expect(result.success).toBe(true);
      testUserIds.push(result.userId!);

      // Verify study_user_role entry
      const roleResult = await testDb.pool.query(`
        SELECT * FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2
      `, [userData.username, testStudyId]);

      expect(roleResult.rows.length).toBe(1);
      expect(roleResult.rows[0].role_name).toBe('Investigator');
      expect(roleResult.rows[0].status_id).toBe(1);
      expect(roleResult.rows[0].owner_id).toBe(creatorId);
    });
  });

  describe('User Role Assignments', () => {
    let roleTestUserId: number;
    let roleTestUsername: string;

    beforeEach(async () => {
      const timestamp = Date.now();
      roleTestUsername = `roleuser_${timestamp}`;
      const userData = {
        username: roleTestUsername,
        firstName: 'Role',
        lastName: 'Test',
        email: `role.test.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const result = await userService.createUser(userData, creatorId);
      roleTestUserId = result.userId!;
      testUserIds.push(roleTestUserId);
    });

    it('should assign user to study with coordinator role', async () => {
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'coordinator',
        creatorId
      );

      expect(result.success).toBe(true);

      // Verify in database
      const roleResult = await testDb.pool.query(`
        SELECT * FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2
      `, [roleTestUsername, testStudyId]);

      expect(roleResult.rows.length).toBe(1);
      expect(roleResult.rows[0].role_name).toBe('coordinator');
    });

    it('should assign user to study with investigator role', async () => {
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'Investigator',
        creatorId
      );

      expect(result.success).toBe(true);

      const roleResult = await testDb.pool.query(`
        SELECT role_name FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2
      `, [roleTestUsername, testStudyId]);

      expect(roleResult.rows[0].role_name).toBe('Investigator');
    });

    it('should assign user to study with data entry (ra) role', async () => {
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'ra',
        creatorId
      );

      expect(result.success).toBe(true);

      const roleResult = await testDb.pool.query(`
        SELECT role_name FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2
      `, [roleTestUsername, testStudyId]);

      expect(roleResult.rows[0].role_name).toBe('ra');
    });

    it('should assign user to study with monitor role', async () => {
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'monitor',
        creatorId
      );

      expect(result.success).toBe(true);

      const roleResult = await testDb.pool.query(`
        SELECT role_name FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2
      `, [roleTestUsername, testStudyId]);

      expect(roleResult.rows[0].role_name).toBe('monitor');
    });

    it('should update existing role when reassigning', async () => {
      // First assignment
      await userService.assignUserToStudy(roleTestUserId, testStudyId, 'ra', creatorId);

      // Second assignment (update)
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'coordinator',
        creatorId
      );

      expect(result.success).toBe(true);

      // Should only have one entry with updated role
      const roleResult = await testDb.pool.query(`
        SELECT * FROM study_user_role 
        WHERE user_name = $1 AND study_id = $2 AND status_id = 1
      `, [roleTestUsername, testStudyId]);

      expect(roleResult.rows.length).toBe(1);
      expect(roleResult.rows[0].role_name).toBe('coordinator');
    });

    it('should reject invalid role names', async () => {
      const result = await userService.assignUserToStudy(
        roleTestUserId,
        testStudyId,
        'invalid_role',
        creatorId
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid role name');
    });
  });

  describe('User Retrieval and Verification', () => {
    let retrievalTestUserId: number;

    beforeAll(async () => {
      const timestamp = Date.now();
      const userData = {
        username: `retrieveuser_${timestamp}`,
        firstName: 'Retrieve',
        lastName: 'Test',
        email: `retrieve.${timestamp}@example.com`,
        password: 'SecurePassword123!@#',
        phone: '555-0000',
        institutionalAffiliation: 'Test Institute',
        role: 'investigator',
        studyId: testStudyId
      };

      const result = await userService.createUser(userData, creatorId);
      retrievalTestUserId = result.userId!;
      testUserIds.push(retrievalTestUserId);
    });

    it('should retrieve user by ID with all fields', async () => {
      const user = await userService.getUserById(retrievalTestUserId);

      expect(user).toBeDefined();
      expect(user?.user_name).toBeDefined();
      expect(user?.first_name).toBeDefined();
      expect(user?.last_name).toBeDefined();
      expect(user?.email).toBeDefined();
      expect(user?.study_ids).toBeDefined();
      expect(user?.roles).toBeDefined();
    });

    it('should retrieve user roles for specific study', async () => {
      const roleInfo = await userService.getUserStudyRole(retrievalTestUserId, testStudyId);

      expect(roleInfo).toBeDefined();
      expect(roleInfo?.roleName).toBe('Investigator');
      expect(roleInfo?.canSubmitData).toBe(true);
      expect(roleInfo?.canExtractData).toBe(true);
      expect(roleInfo?.canManageStudy).toBe(false);
    });

    it('should list users with pagination', async () => {
      const result = await userService.getUsers({ page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter users by study ID', async () => {
      const result = await userService.getUsers({ studyId: testStudyId, limit: 100 });

      expect(result.success).toBe(true);
      // Should include the user we created
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter users by role', async () => {
      const result = await userService.getUsers({ role: 'Investigator', limit: 100 });

      expect(result.success).toBe(true);
      // Should include users with Investigator role
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Password Validation (8 chars + 1 special)', () => {
    it('should reject password shorter than 8 characters', async () => {
      const userData = {
        username: `shortpwd_${Date.now()}`,
        firstName: 'Test',
        lastName: 'User',
        email: `shortpwd.${Date.now()}@example.com`,
        password: 'short!'  // Only 6 chars
      };

      const result = await userService.createUser(userData, creatorId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password validation failed');
    });

    it('should reject password without special character', async () => {
      const userData = {
        username: `nospecial_${Date.now()}`,
        firstName: 'Test',
        lastName: 'User',
        email: `nospecial.${Date.now()}@example.com`,
        password: 'password123'  // 11 chars but no special
      };

      const result = await userService.createUser(userData, creatorId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password validation failed');
    });

    it('should accept 8+ char password with special character', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `validpwd_${timestamp}`,
        firstName: 'Valid',
        lastName: 'Password',
        email: `validpwd.${timestamp}@example.com`,
        password: 'simple@123'  // 10 chars with @
      };

      const result = await userService.createUser(userData, creatorId);
      expect(result.success).toBe(true);
      testUserIds.push(result.userId!);
    });

    it('should accept various special characters', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `specialpwd_${timestamp}`,
        firstName: 'Special',
        lastName: 'Chars',
        email: `specialpwd.${timestamp}@example.com`,
        password: 'password#'  // 9 chars with #
      };

      const result = await userService.createUser(userData, creatorId);
      expect(result.success).toBe(true);
      testUserIds.push(result.userId!);
    });
  });

  describe('Duplicate Prevention', () => {
    it('should reject duplicate username', async () => {
      const timestamp = Date.now();
      const username = `duplicate_${timestamp}`;
      
      const userData1 = {
        username,
        firstName: 'First',
        lastName: 'User',
        email: `first.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const result1 = await userService.createUser(userData1, creatorId);
      expect(result1.success).toBe(true);
      testUserIds.push(result1.userId!);

      const userData2 = {
        username, // Same username
        firstName: 'Second',
        lastName: 'User',
        email: `second.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const result2 = await userService.createUser(userData2, creatorId);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('Username already exists');
    });

    it('should reject duplicate email', async () => {
      const timestamp = Date.now();
      const email = `duplicate.email.${timestamp}@example.com`;
      
      const userData1 = {
        username: `emailtest1_${timestamp}`,
        firstName: 'First',
        lastName: 'User',
        email,
        password: 'SecurePassword123!@#'
      };

      const result1 = await userService.createUser(userData1, creatorId);
      expect(result1.success).toBe(true);
      testUserIds.push(result1.userId!);

      const userData2 = {
        username: `emailtest2_${timestamp}`,
        firstName: 'Second',
        lastName: 'User',
        email, // Same email
        password: 'SecurePassword123!@#'
      };

      const result2 = await userService.createUser(userData2, creatorId);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('Email already exists');
    });
  });

  describe('Authentication Integration', () => {
    let authTestUsername: string;
    const authTestPassword = 'SecurePassword123!@#';

    beforeAll(async () => {
      const timestamp = Date.now();
      authTestUsername = `authuser_${timestamp}`;
      const userData = {
        username: authTestUsername,
        firstName: 'Auth',
        lastName: 'Test',
        email: `auth.test.${timestamp}@example.com`,
        password: authTestPassword,
        role: 'coordinator',
        studyId: testStudyId
      };

      const result = await userService.createUser(userData, creatorId);
      testUserIds.push(result.userId!);
    });

    it('should authenticate newly created user', async () => {
      const result = await authService.authenticateUser(
        authTestUsername,
        authTestPassword,
        '127.0.0.1'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.user_name).toBe(authTestUsername);
    });

    it('should reject wrong password', async () => {
      const result = await authService.authenticateUser(
        authTestUsername,
        'WrongPassword123!@#',
        '127.0.0.1'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid username or password');
    });

    it('should build JWT payload with correct role', async () => {
      const authResult = await authService.authenticateUser(
        authTestUsername,
        authTestPassword,
        '127.0.0.1'
      );

      expect(authResult.success).toBe(true);

      const jwtPayload = await authService.buildJwtPayload(authResult.data!);

      expect(jwtPayload.userId).toBeDefined();
      expect(jwtPayload.userName).toBe(authTestUsername);
      expect(jwtPayload.studyIds).toContain(testStudyId);
      expect(jwtPayload.role).toBe('coordinator');
    });

    it('should get user roles from JWT', async () => {
      const authResult = await authService.authenticateUser(
        authTestUsername,
        authTestPassword,
        '127.0.0.1'
      );

      const roles = await authService.getUserRoles(authResult.data!.user_id, testStudyId);

      expect(roles).toContain('coordinator');
    });
  });

  describe('User Update Operations', () => {
    let updateTestUserId: number;

    beforeEach(async () => {
      const timestamp = Date.now();
      const userData = {
        username: `updateuser_${timestamp}`,
        firstName: 'Update',
        lastName: 'Test',
        email: `update.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const result = await userService.createUser(userData, creatorId);
      updateTestUserId = result.userId!;
      testUserIds.push(updateTestUserId);
    });

    it('should update user firstName', async () => {
      const result = await userService.updateUser(
        updateTestUserId,
        { firstName: 'UpdatedFirst' },
        creatorId
      );

      expect(result.success).toBe(true);

      const user = await userService.getUserById(updateTestUserId);
      expect(user?.first_name).toBe('UpdatedFirst');
    });

    it('should update user lastName', async () => {
      const result = await userService.updateUser(
        updateTestUserId,
        { lastName: 'UpdatedLast' },
        creatorId
      );

      expect(result.success).toBe(true);

      const user = await userService.getUserById(updateTestUserId);
      expect(user?.last_name).toBe('UpdatedLast');
    });

    it('should update user email', async () => {
      const newEmail = `updated.email.${Date.now()}@example.com`;
      const result = await userService.updateUser(
        updateTestUserId,
        { email: newEmail },
        creatorId
      );

      expect(result.success).toBe(true);

      const user = await userService.getUserById(updateTestUserId);
      expect(user?.email).toBe(newEmail);
    });

    it('should disable user', async () => {
      const result = await userService.updateUser(
        updateTestUserId,
        { enabled: false },
        creatorId
      );

      expect(result.success).toBe(true);

      const user = await userService.getUserById(updateTestUserId);
      expect(user?.enabled).toBe(false);
    });

    it('should update multiple fields at once', async () => {
      const timestamp = Date.now();
      const updates = {
        firstName: 'MultiUpdate',
        lastName: 'Test',
        phone: '555-9999',
        institutionalAffiliation: 'Updated Institute'
      };

      const result = await userService.updateUser(updateTestUserId, updates, creatorId);

      expect(result.success).toBe(true);

      const user = await userService.getUserById(updateTestUserId);
      expect(user?.first_name).toBe(updates.firstName);
      expect(user?.last_name).toBe(updates.lastName);
      expect(user?.phone).toBe(updates.phone);
      expect(user?.institutional_affiliation).toBe(updates.institutionalAffiliation);
    });
  });

  describe('User Deletion (Soft Delete)', () => {
    it('should soft delete user by disabling account', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `deleteuser_${timestamp}`,
        firstName: 'Delete',
        lastName: 'Test',
        email: `delete.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const createResult = await userService.createUser(userData, creatorId);
      const deleteUserId = createResult.userId!;
      testUserIds.push(deleteUserId);

      const deleteResult = await userService.deleteUser(deleteUserId, creatorId);

      expect(deleteResult.success).toBe(true);

      // Verify user is disabled but not actually deleted
      const dbResult = await testDb.pool.query(
        'SELECT enabled FROM user_account WHERE user_id = $1',
        [deleteUserId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].enabled).toBe(false);
    });

    it('should prevent deleted user from authenticating', async () => {
      const timestamp = Date.now();
      const username = `disableduser_${timestamp}`;
      const password = 'SecurePassword123!@#';
      
      const userData = {
        username,
        firstName: 'Disabled',
        lastName: 'Test',
        email: `disabled.${timestamp}@example.com`,
        password
      };

      const createResult = await userService.createUser(userData, creatorId);
      testUserIds.push(createResult.userId!);

      // Delete (disable) the user
      await userService.deleteUser(createResult.userId!, creatorId);

      // Try to authenticate
      const authResult = await authService.authenticateUser(username, password, '127.0.0.1');

      expect(authResult.success).toBe(false);
      expect(authResult.message).toContain('disabled');
    });
  });

  describe('Audit Trail Verification', () => {
    it('should create audit log entry on user creation', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `auditcreate_${timestamp}`,
        firstName: 'Audit',
        lastName: 'Create',
        email: `audit.create.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const result = await userService.createUser(userData, creatorId);
      testUserIds.push(result.userId!);

      // Check audit log
      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [result.userId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].user_id).toBe(creatorId);
      expect(auditResult.rows[0].new_value).toBe(userData.username);
    });

    it('should create audit log entry on user update', async () => {
      const timestamp = Date.now();
      const userData = {
        username: `auditupdate_${timestamp}`,
        firstName: 'Audit',
        lastName: 'Update',
        email: `audit.update.${timestamp}@example.com`,
        password: 'SecurePassword123!@#'
      };

      const createResult = await userService.createUser(userData, creatorId);
      testUserIds.push(createResult.userId!);

      // Update user
      await userService.updateUser(createResult.userId!, { firstName: 'Updated' }, creatorId);

      // Check audit log
      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [createResult.userId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });
});

