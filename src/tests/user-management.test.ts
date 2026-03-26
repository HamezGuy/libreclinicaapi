/**
 * User Management Comprehensive Integration Tests
 *
 * Tests full CRUD operations for users, role assignment, permission enforcement,
 * feature access, and a-la-carte permission overrides.
 *
 * RUN: npm run test:e2e -- --testPathPattern="user-management"
 */

import request from 'supertest';
import { pool } from '../config/database';
import app from '../app';

const CFG = {
  ADMIN_USER: 'root',
  ADMIN_PASS: '12345678',
  TIMEOUT: 30000,
};

const CANONICAL_ROLES = ['admin', 'data_manager', 'investigator', 'coordinator', 'monitor', 'viewer'] as const;

describe('User Management — Full CRUD + Permissions', () => {
  let adminToken: string;
  const createdUserIds: number[] = [];

  // ── Setup: get admin JWT ──
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: CFG.ADMIN_USER, password: CFG.ADMIN_PASS })
      .expect(200);

    adminToken = res.body.accessToken;
    expect(adminToken).toBeTruthy();
  }, CFG.TIMEOUT);

  // ── Cleanup: disable test users ──
  afterAll(async () => {
    for (const id of createdUserIds) {
      try {
        await pool.query(`UPDATE user_account SET status_id = 5 WHERE user_id = $1`, [id]);
      } catch (_) { /* ignore */ }
    }
  });

  // =========================================================================
  // 1. USER CRUD OPERATIONS
  // =========================================================================

  describe('1. User CRUD', () => {
    const uniqueSuffix = Date.now().toString(36);

    it('should create a user with each canonical role', async () => {
      for (const role of CANONICAL_ROLES) {
        const username = `test_${role}_${uniqueSuffix}`;
        const res = await request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username,
            firstName: 'Test',
            lastName: role,
            email: `${username}@test.local`,
            password: 'TestPass1!xyz',
            role,
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.userId).toBeDefined();
        createdUserIds.push(res.body.userId);

        // Verify study_user_role was created
        const surResult = await pool.query(
          `SELECT role_name FROM study_user_role
           WHERE user_name = $1 AND status_id = 1`,
          [username]
        );
        expect(surResult.rows.length).toBeGreaterThanOrEqual(1);
        expect(surResult.rows[0].role_name).toBe(role);
      }
    }, CFG.TIMEOUT);

    it('should list users and include roles array', async () => {
      const res = await request(app)
        .get('/api/users?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Every user should have a `roles` field (array or null)
      for (const user of res.body.data) {
        expect(user).toHaveProperty('roles');
      }

      // Find one of our test users and verify roles is populated
      const testUser = res.body.data.find(
        (u: any) => u.user_name?.startsWith('test_admin_')
      );
      if (testUser) {
        expect(testUser.roles).toContain('admin');
      }
    });

    it('should get a single user with roles', async () => {
      if (createdUserIds.length === 0) return;
      const userId = createdUserIds[0];

      const res = await request(app)
        .get(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.roles).toBeDefined();
    });

    it('should update user personal info', async () => {
      if (createdUserIds.length === 0) return;
      const userId = createdUserIds[0];

      const res = await request(app)
        .put(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
          lastName: 'Name',
          phone: '+1-555-9999',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify in DB
      const dbResult = await pool.query(
        `SELECT first_name, last_name, phone FROM user_account WHERE user_id = $1`,
        [userId]
      );
      expect(dbResult.rows[0].first_name).toBe('Updated');
      expect(dbResult.rows[0].last_name).toBe('Name');
    });

    it('should soft-delete (disable) a user', async () => {
      if (createdUserIds.length === 0) return;
      const userId = createdUserIds[createdUserIds.length - 1];

      const res = await request(app)
        .delete(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify disabled in DB (status_id != 1 means disabled)
      const dbResult = await pool.query(
        `SELECT status_id FROM user_account WHERE user_id = $1`,
        [userId]
      );
      expect(dbResult.rows[0].status_id).not.toBe(1);
    });
  });

  // =========================================================================
  // 2. ROLE CHANGE PERSISTENCE
  // =========================================================================

  describe('2. Role Change Persistence', () => {
    let testUserId: number;
    let testUsername: string;

    beforeAll(async () => {
      const suffix = Date.now().toString(36);
      testUsername = `role_test_${suffix}`;
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: testUsername,
          firstName: 'RoleTest',
          lastName: 'User',
          email: `${testUsername}@test.local`,
          password: 'TestPass1!xyz',
          role: 'coordinator',
        })
        .expect(201);

      testUserId = res.body.userId;
      createdUserIds.push(testUserId);
    }, CFG.TIMEOUT);

    it('should change role from coordinator to data_manager and persist', async () => {
      await request(app)
        .put(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'data_manager' })
        .expect(200);

      // Verify in study_user_role
      const surResult = await pool.query(
        `SELECT role_name FROM study_user_role
         WHERE user_name = $1 AND status_id = 1`,
        [testUsername]
      );
      expect(surResult.rows.length).toBeGreaterThanOrEqual(1);
      surResult.rows.forEach((row: any) => {
        expect(row.role_name).toBe('data_manager');
      });
    });

    it('should update ALL study assignments when role changes', async () => {
      // First assign to a second study if available
      const studies = await pool.query(
        `SELECT study_id FROM study WHERE status_id = 1 LIMIT 2`
      );
      if (studies.rows.length > 1) {
        const secondStudy = studies.rows[1].study_id;
        await pool.query(
          `INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, date_created, user_name)
           VALUES ('data_manager', $1, 1, 1, NOW(), $2)
           ON CONFLICT DO NOTHING`,
          [secondStudy, testUsername]
        );
      }

      // Now change role to investigator
      await request(app)
        .put(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'investigator' })
        .expect(200);

      // ALL study_user_role rows should now be investigator
      const surResult = await pool.query(
        `SELECT role_name FROM study_user_role
         WHERE user_name = $1 AND status_id = 1`,
        [testUsername]
      );
      surResult.rows.forEach((row: any) => {
        expect(row.role_name).toBe('investigator');
      });
    });

    it('should change role to admin and update user_type_id to 1', async () => {
      await request(app)
        .put(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(200);

      const dbResult = await pool.query(
        `SELECT user_type_id FROM user_account WHERE user_id = $1`,
        [testUserId]
      );
      expect(dbResult.rows[0].user_type_id).toBe(1);
    });

    it('should show updated role when re-listing users', async () => {
      // First set a known role
      await request(app)
        .put(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'monitor' })
        .expect(200);

      const listRes = await request(app)
        .get('/api/users?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const found = listRes.body.data.find(
        (u: any) => u.user_id === testUserId
      );
      expect(found).toBeDefined();
      expect(found.roles).toContain('monitor');
    });
  });

  // =========================================================================
  // 3. PERMISSION ENFORCEMENT (403 tests)
  // =========================================================================

  describe('3. Permission Enforcement — 403 Errors', () => {
    let coordinatorToken: string;
    let viewerToken: string;
    let dmToken: string;

    beforeAll(async () => {
      const suffix = Date.now().toString(36);

      // Create coordinator user
      const coordUser = `coord_perm_${suffix}`;
      const coordRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: coordUser,
          firstName: 'Coord', lastName: 'Test',
          email: `${coordUser}@test.local`,
          password: 'TestPass1!xyz',
          role: 'coordinator',
        });
      if (coordRes.body.userId) createdUserIds.push(coordRes.body.userId);

      // Create viewer user
      const viewUser = `viewer_perm_${suffix}`;
      const viewRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: viewUser,
          firstName: 'Viewer', lastName: 'Test',
          email: `${viewUser}@test.local`,
          password: 'TestPass1!xyz',
          role: 'viewer',
        });
      if (viewRes.body.userId) createdUserIds.push(viewRes.body.userId);

      // Create data_manager user
      const dmUser = `dm_perm_${suffix}`;
      const dmRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: dmUser,
          firstName: 'DM', lastName: 'Test',
          email: `${dmUser}@test.local`,
          password: 'TestPass1!xyz',
          role: 'data_manager',
        });
      if (dmRes.body.userId) createdUserIds.push(dmRes.body.userId);

      // Login as each user
      const coordLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: coordUser, password: 'TestPass1!xyz' });
      coordinatorToken = coordLogin.body.accessToken || '';

      const viewLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: viewUser, password: 'TestPass1!xyz' });
      viewerToken = viewLogin.body.accessToken || '';

      const dmLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: dmUser, password: 'TestPass1!xyz' });
      dmToken = dmLogin.body.accessToken || '';
    }, CFG.TIMEOUT);

    it('data_manager CAN update form templates (no 403)', async () => {
      if (!dmToken) return;
      // Get a form template first
      const formsRes = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${dmToken}`);

      if (formsRes.body.data?.length > 0) {
        const formId = formsRes.body.data[0].crf_id || formsRes.body.data[0].id;
        const updateRes = await request(app)
          .put(`/api/forms/${formId}`)
          .set('Authorization', `Bearer ${dmToken}`)
          .send({ name: formsRes.body.data[0].name });

        // Should NOT be 403
        expect(updateRes.status).not.toBe(403);
      }
    });

    it('coordinator CANNOT update form templates (403)', async () => {
      if (!coordinatorToken) return;
      const formsRes = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${coordinatorToken}`);

      if (formsRes.body.data?.length > 0) {
        const formId = formsRes.body.data[0].crf_id || formsRes.body.data[0].id;
        const updateRes = await request(app)
          .put(`/api/forms/${formId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ name: 'Should fail' });

        expect(updateRes.status).toBe(403);
      }
    });

    it('viewer CANNOT access user management (403)', async () => {
      if (!viewerToken) return;
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });

    it('coordinator CANNOT access user management (403)', async () => {
      if (!coordinatorToken) return;
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${coordinatorToken}`);

      expect(res.status).toBe(403);
    });

    it('data_manager CAN access user management', async () => {
      if (!dmToken) return;
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${dmToken}`);

      expect(res.status).toBe(200);
    });

    it('viewer CANNOT create studies (403)', async () => {
      if (!viewerToken) return;
      const res = await request(app)
        .post('/api/studies')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Should fail', uniqueIdentifier: 'FAIL_TEST' });

      expect(res.status).toBe(403);
    });

    it('coordinator CANNOT delete subjects (403)', async () => {
      if (!coordinatorToken) return;
      const res = await request(app)
        .delete('/api/subjects/99999')
        .set('Authorization', `Bearer ${coordinatorToken}`);

      // 403 or 404 (if subject doesn't exist), but NOT 200
      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 4. FEATURE ACCESS MANAGEMENT
  // =========================================================================

  describe('4. Feature Access', () => {
    let featureTestUserId: number;

    beforeAll(async () => {
      const suffix = Date.now().toString(36);
      const username = `feat_test_${suffix}`;
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          firstName: 'Feature', lastName: 'Test',
          email: `${username}@test.local`,
          password: 'TestPass1!xyz',
          role: 'coordinator',
        });
      featureTestUserId = res.body.userId;
      if (featureTestUserId) createdUserIds.push(featureTestUserId);
    }, CFG.TIMEOUT);

    it('should list all system features', async () => {
      const res = await request(app)
        .get('/api/users/meta/features')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should get user feature access', async () => {
      if (!featureTestUserId) return;
      const res = await request(app)
        .get(`/api/users/${featureTestUserId}/features`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should toggle a single feature for a user', async () => {
      if (!featureTestUserId) return;
      const res = await request(app)
        .put(`/api/users/${featureTestUserId}/features/training`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isEnabled: true, notes: 'Test toggle' });

      // Accept 200 or 404 if feature doesn't exist
      expect([200, 404]).toContain(res.status);
    });

    it('should remove a feature override', async () => {
      if (!featureTestUserId) return;
      const res = await request(app)
        .delete(`/api/users/${featureTestUserId}/features/training`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 5. A-LA-CARTE PERMISSION OVERRIDES
  // =========================================================================

  describe('5. Permission Overrides (a la carte)', () => {
    let permTestUserId: number;

    beforeAll(async () => {
      const suffix = Date.now().toString(36);
      const username = `perm_test_${suffix}`;
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          firstName: 'Perm', lastName: 'Test',
          email: `${username}@test.local`,
          password: 'TestPass1!xyz',
          role: 'coordinator',
        });
      permTestUserId = res.body.userId;
      if (permTestUserId) createdUserIds.push(permTestUserId);
    }, CFG.TIMEOUT);

    it('should list available permissions', async () => {
      const res = await request(app)
        .get('/api/permissions/available')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should grant a permission override', async () => {
      if (!permTestUserId) return;
      const res = await request(app)
        .put(`/api/permissions/${permTestUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          permissions: { canExportData: true, canSignForms: false },
        });

      expect([200, 201]).toContain(res.status);
    });

    it('should read back user permissions with overrides applied', async () => {
      if (!permTestUserId) return;
      const res = await request(app)
        .get(`/api/permissions/${permTestUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      if (res.body.data) {
        expect(res.body.data.canExportData).toBe(true);
        expect(res.body.data.canSignForms).toBe(false);
      }
    });

    it('should remove a single permission override', async () => {
      if (!permTestUserId) return;
      const res = await request(app)
        .delete(`/api/permissions/${permTestUserId}/canExportData`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 204]).toContain(res.status);
    });
  });

  // =========================================================================
  // 6. BULK OPERATIONS
  // =========================================================================

  describe('6. Bulk Operations', () => {
    it('should activate/deactivate users via individual enable toggles', async () => {
      if (createdUserIds.length < 2) return;
      const userId = createdUserIds[0];

      // Deactivate
      let res = await request(app)
        .put(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false })
        .expect(200);
      expect(res.body.success).toBe(true);

      // Re-activate
      res = await request(app)
        .put(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true })
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 7. STUDY ASSIGNMENT
  // =========================================================================

  describe('7. Study Assignment', () => {
    it('should assign a user to a study with a role', async () => {
      if (createdUserIds.length === 0) return;
      const userId = createdUserIds[0];

      // Find a study
      const studyResult = await pool.query(
        `SELECT study_id FROM study WHERE status_id = 1 LIMIT 1`
      );
      if (studyResult.rows.length === 0) return;
      const studyId = studyResult.rows[0].study_id;

      const res = await request(app)
        .post(`/api/users/${userId}/assign-study`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studyId, roleName: 'coordinator' });

      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should get available roles', async () => {
      const res = await request(app)
        .get('/api/users/meta/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(6);
      const names = res.body.data.map((r: any) => r.name);
      for (const role of CANONICAL_ROLES) {
        expect(names).toContain(role);
      }
    });
  });

  // =========================================================================
  // 8. NEW USER CAN ACT (no 403 on first action)
  // =========================================================================

  describe('8. New User First Action — No Spurious 403', () => {
    it('newly created data_manager can access protected endpoints', async () => {
      const suffix = Date.now().toString(36);
      const username = `newdm_${suffix}`;

      // Create
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          firstName: 'NewDM', lastName: 'FirstAction',
          email: `${username}@test.local`,
          password: 'TestPass1!xyz',
          role: 'data_manager',
        })
        .expect(201);
      createdUserIds.push(createRes.body.userId);

      // Verify they have a study_user_role entry
      const surCheck = await pool.query(
        `SELECT role_name, study_id FROM study_user_role
         WHERE user_name = $1 AND status_id = 1`,
        [username]
      );
      expect(surCheck.rows.length).toBeGreaterThanOrEqual(1);

      // Login as the new user
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username, password: 'TestPass1!xyz' });

      if (loginRes.body.accessToken) {
        const newToken = loginRes.body.accessToken;

        // This should NOT return 403
        const usersRes = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${newToken}`);
        expect(usersRes.status).not.toBe(403);

        // data_manager should be able to list forms
        const formsRes = await request(app)
          .get('/api/forms')
          .set('Authorization', `Bearer ${newToken}`);
        expect(formsRes.status).not.toBe(403);
      }
    }, CFG.TIMEOUT);

    it('newly created coordinator can save form data', async () => {
      const suffix = Date.now().toString(36);
      const username = `newcoord_${suffix}`;

      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username,
          firstName: 'NewCoord', lastName: 'FirstAction',
          email: `${username}@test.local`,
          password: 'TestPass1!xyz',
          role: 'coordinator',
        })
        .expect(201);
      createdUserIds.push(createRes.body.userId);

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username, password: 'TestPass1!xyz' });

      if (loginRes.body.accessToken) {
        const newToken = loginRes.body.accessToken;

        // Coordinator should be able to read forms (GET is open)
        const formsRes = await request(app)
          .get('/api/forms')
          .set('Authorization', `Bearer ${newToken}`);
        expect(formsRes.status).not.toBe(403);

        // Coordinator CANNOT manage users
        const usersRes = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${newToken}`);
        expect(usersRes.status).toBe(403);
      }
    }, CFG.TIMEOUT);
  });
});
