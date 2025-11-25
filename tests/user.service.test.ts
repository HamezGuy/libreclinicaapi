/**
 * User Service Unit Tests
 * 
 * Tests user management operations including:
 * - Creating users
 * - Updating users
 * - Deleting users
 * - Verifying database changes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from './utils/test-db';
import * as userService from '../src/services/database/user.service';

describe('User Service', () => {
  let testUserId: number;
  let creatorId: number = 1; // Assuming root user has ID 1

  beforeAll(async () => {
    // Ensure database connection
    const result = await testDb.pool.query('SELECT NOW()');
    expect(result.rows).toBeDefined();
  });

  afterAll(async () => {
    // Cleanup: Delete test users
    if (testUserId) {
      await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [testUserId]);
    }
    await testDb.pool.end();
  });

  describe('createUser', () => {
    it('should create a new user in the database', async () => {
      const userData = {
        username: `testuser_${Date.now()}`,
        firstName: 'Test',
        lastName: 'User',
        email: `test_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
        phone: '555-1234',
        institutionalAffiliation: 'Test Hospital'
      };

      const result = await userService.createUser(userData, creatorId);

      expect(result.success).toBe(true);
      expect(result.userId).toBeDefined();
      testUserId = result.userId!;

      // Verify user exists in database
      const dbResult = await testDb.pool.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [testUserId]
      );

      expect(dbResult.rows.length).toBe(1);
      expect(dbResult.rows[0].user_name).toBe(userData.username);
      expect(dbResult.rows[0].first_name).toBe(userData.firstName);
      expect(dbResult.rows[0].last_name).toBe(userData.lastName);
      expect(dbResult.rows[0].email).toBe(userData.email);
    });

    it('should reject weak passwords', async () => {
      const userData = {
        username: `testuser_${Date.now()}`,
        firstName: 'Test',
        lastName: 'User',
        email: `test_${Date.now()}@example.com`,
        password: 'weak', // Too short, no complexity
      };

      const result = await userService.createUser(userData, creatorId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password validation failed');
    });

    it('should reject duplicate usernames', async () => {
      const username = `duplicate_${Date.now()}`;
      
      const userData1 = {
        username,
        firstName: 'Test',
        lastName: 'User',
        email: `test1_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
      };

      // Create first user
      const result1 = await userService.createUser(userData1, creatorId);
      expect(result1.success).toBe(true);

      // Try to create duplicate
      const userData2 = {
        ...userData1,
        email: `test2_${Date.now()}@example.com`
      };

      const result2 = await userService.createUser(userData2, creatorId);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');

      // Cleanup
      if (result1.userId) {
        await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [result1.userId]);
      }
    });

    it('should create audit log entry when creating user', async () => {
      const userData = {
        username: `audituser_${Date.now()}`,
        firstName: 'Audit',
        lastName: 'Test',
        email: `audit_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
      };

      const result = await userService.createUser(userData, creatorId);
      expect(result.success).toBe(true);

      // Check audit log
      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [result.userId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].user_id).toBe(creatorId);

      // Cleanup
      if (result.userId) {
        await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [result.userId]);
      }
    });
  });

  describe('updateUser', () => {
    let updateTestUserId: number;

    beforeEach(async () => {
      // Create a user to update
      const userData = {
        username: `updateuser_${Date.now()}`,
        firstName: 'Update',
        lastName: 'Test',
        email: `update_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
      };

      const result = await userService.createUser(userData, creatorId);
      updateTestUserId = result.userId!;
    });

    afterEach(async () => {
      // Cleanup
      if (updateTestUserId) {
        await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [updateTestUserId]);
      }
    });

    it('should update user information in database', async () => {
      const updates = {
        firstName: 'Updated',
        lastName: 'Name',
        email: `updated_${Date.now()}@example.com`,
        phone: '555-9999'
      };

      const result = await userService.updateUser(updateTestUserId, updates, creatorId);

      expect(result.success).toBe(true);

      // Verify database changes
      const dbResult = await testDb.pool.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [updateTestUserId]
      );

      expect(dbResult.rows[0].first_name).toBe(updates.firstName);
      expect(dbResult.rows[0].last_name).toBe(updates.lastName);
      expect(dbResult.rows[0].email).toBe(updates.email);
      expect(dbResult.rows[0].phone).toBe(updates.phone);
    });

    it('should create audit log entry when updating user', async () => {
      const updates = { firstName: 'AuditUpdate' };

      await userService.updateUser(updateTestUserId, updates, creatorId);

      // Check audit log
      const auditResult = await testDb.pool.query(
        'SELECT * FROM audit_log_event WHERE entity_id = $1 AND audit_table = $2 ORDER BY audit_date DESC LIMIT 1',
        [updateTestUserId, 'user_account']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user (disable) in database', async () => {
      // Create a user to delete
      const userData = {
        username: `deleteuser_${Date.now()}`,
        firstName: 'Delete',
        lastName: 'Test',
        email: `delete_${Date.now()}@example.com`,
        password: 'TestPassword123!@#',
      };

      const createResult = await userService.createUser(userData, creatorId);
      const deleteTestUserId = createResult.userId!;

      // Delete (disable) user
      const deleteResult = await userService.deleteUser(deleteTestUserId, creatorId);

      expect(deleteResult.success).toBe(true);

      // Verify user is disabled in database
      const dbResult = await testDb.pool.query(
        'SELECT enabled FROM user_account WHERE user_id = $1',
        [deleteTestUserId]
      );

      expect(dbResult.rows[0].enabled).toBe(false);

      // Cleanup
      await testDb.pool.query('DELETE FROM user_account WHERE user_id = $1', [deleteTestUserId]);
    });
  });

  describe('getUserById', () => {
    it('should retrieve user from database', async () => {
      // Use root user (assumed to exist)
      const user = await userService.getUserById(1);

      expect(user).toBeDefined();
      expect(user?.user_name).toBeDefined();
    });

    it('should return null for non-existent user', async () => {
      const user = await userService.getUserById(999999);

      expect(user).toBeNull();
    });
  });

  describe('getUsers', () => {
    it('should return paginated user list', async () => {
      const result = await userService.getUsers({ page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(result.pagination?.page).toBe(1);
      expect(result.pagination?.limit).toBe(10);
    });

    it('should filter users by enabled status', async () => {
      const result = await userService.getUsers({ enabled: true, limit: 100 });

      expect(result.success).toBe(true);
      expect(result.data.every((user: any) => user.enabled === true)).toBe(true);
    });
  });
});


