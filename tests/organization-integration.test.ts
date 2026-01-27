/**
 * Organization API Integration Tests
 * 
 * End-to-end tests for organization management endpoints including:
 * - Organization registration
 * - Organization codes
 * - Access requests
 * - Invitations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { testDb } from './utils/test-db';

// Use direct database access for setup/teardown
// Tests interact with the API endpoints

describe('Organization API Integration Tests', () => {
  const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';
  let adminToken: string;
  let testOrganizationId: number;
  let testUserId: number;

  beforeAll(async () => {
    await testDb.connect();

    // Create organization tables if they don't exist
    try {
      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_organization (
          organization_id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          type VARCHAR(50) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          email VARCHAR(255) NOT NULL UNIQUE,
          phone VARCHAR(50),
          website VARCHAR(255),
          street VARCHAR(255),
          city VARCHAR(100),
          state VARCHAR(100),
          postal_code VARCHAR(20),
          country VARCHAR(100),
          owner_id INTEGER REFERENCES user_account(user_id),
          approved_by INTEGER REFERENCES user_account(user_id),
          approved_at TIMESTAMP,
          date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_organization_membership (
          membership_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
          role VARCHAR(50) NOT NULL DEFAULT 'member',
          status VARCHAR(20) DEFAULT 'active',
          invited_by INTEGER REFERENCES user_account(user_id),
          date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_user_org UNIQUE (user_id, organization_id)
        )
      `);

      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_organization_code (
          code_id SERIAL PRIMARY KEY,
          code VARCHAR(20) NOT NULL UNIQUE,
          organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id) ON DELETE CASCADE,
          max_uses INTEGER,
          current_uses INTEGER DEFAULT 0,
          expires_at TIMESTAMP,
          default_role VARCHAR(50) DEFAULT 'member',
          is_active BOOLEAN DEFAULT true,
          created_by INTEGER REFERENCES user_account(user_id),
          date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_organization_code_usage (
          usage_id SERIAL PRIMARY KEY,
          code_id INTEGER NOT NULL REFERENCES acc_organization_code(code_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
          used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ip_address VARCHAR(50)
        )
      `);

      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_access_request (
          request_id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          phone VARCHAR(50),
          organization_name VARCHAR(255),
          professional_title VARCHAR(100),
          credentials VARCHAR(100),
          reason TEXT,
          organization_id INTEGER REFERENCES acc_organization(organization_id),
          requested_role VARCHAR(50) DEFAULT 'member',
          status VARCHAR(20) DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES user_account(user_id),
          reviewed_at TIMESTAMP,
          review_notes TEXT,
          user_id INTEGER REFERENCES user_account(user_id),
          date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await testDb.pool.query(`
        CREATE TABLE IF NOT EXISTS acc_user_invitation (
          invitation_id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          token VARCHAR(100) NOT NULL UNIQUE,
          organization_id INTEGER REFERENCES acc_organization(organization_id),
          study_id INTEGER REFERENCES study(study_id),
          role VARCHAR(50) DEFAULT 'member',
          status VARCHAR(20) DEFAULT 'pending',
          expires_at TIMESTAMP NOT NULL,
          invited_by INTEGER REFERENCES user_account(user_id),
          message TEXT,
          accepted_by INTEGER REFERENCES user_account(user_id),
          accepted_at TIMESTAMP,
          date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      // Tables might already exist
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await testDb.cleanTables([
      'acc_organization_code_usage',
      'acc_organization_code',
      'acc_user_invitation',
      'acc_access_request',
      'acc_organization_membership',
      'acc_organization'
    ]);
    await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
  });

  // ============================================================================
  // Organization Registration Tests
  // ============================================================================
  describe('POST /organizations/register', () => {
    afterEach(async () => {
      // Clean up test data after each test
      await testDb.cleanTables([
        'acc_organization_membership',
        'acc_organization'
      ]);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    it('should register a new organization with admin', async () => {
      const registrationData = {
        organizationDetails: {
          name: `Integration Test Org ${Date.now()}`,
          type: 'hospital',
          email: `orgtest_${Date.now()}@test.com`,
          phone: '555-1234',
          street: '123 Test St',
          city: 'Boston',
          state: 'MA',
          postalCode: '02101',
          country: 'United States'
        },
        adminDetails: {
          firstName: 'Admin',
          lastName: 'User',
          email: `admintest_${Date.now()}@test.com`,
          password: 'SecureP@ss123!'
        },
        termsAccepted: {
          acceptTerms: true,
          acceptPrivacy: true,
          acceptCompliance: true
        }
      };

      const response = await request(BASE_URL)
        .post('/organizations/register')
        .send(registrationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.organizationId).toBeDefined();
      expect(response.body.data.userId).toBeDefined();
    });

    it('should reject duplicate organization name', async () => {
      const orgName = `Duplicate Test Org ${Date.now()}`;

      // First registration
      await request(BASE_URL)
        .post('/organizations/register')
        .send({
          organizationDetails: {
            name: orgName,
            type: 'clinic',
            email: `first_${Date.now()}@test.com`
          },
          adminDetails: {
            firstName: 'First',
            lastName: 'Admin',
            email: `first_admin_${Date.now()}@test.com`,
            password: 'SecureP@ss123!'
          }
        })
        .expect(201);

      // Second registration with same name
      const response = await request(BASE_URL)
        .post('/organizations/register')
        .send({
          organizationDetails: {
            name: orgName,
            type: 'hospital',
            email: `second_${Date.now()}@test.com`
          },
          adminDetails: {
            firstName: 'Second',
            lastName: 'Admin',
            email: `second_admin_${Date.now()}@test.com`,
            password: 'SecureP@ss123!'
          }
        });

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject weak password', async () => {
      const response = await request(BASE_URL)
        .post('/organizations/register')
        .send({
          organizationDetails: {
            name: `Weak Pass Org ${Date.now()}`,
            type: 'cro',
            email: `weak_${Date.now()}@test.com`
          },
          adminDetails: {
            firstName: 'Weak',
            lastName: 'Password',
            email: `weakadmin_${Date.now()}@test.com`,
            password: 'weak'
          }
        });

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Password');
    });
  });

  // ============================================================================
  // Organization Code Tests
  // ============================================================================
  describe('Organization Codes', () => {
    let activeOrgId: number;
    let activeUserId: number;
    let generatedCode: string;

    beforeAll(async () => {
      // Create an active organization for code tests
      const registrationData = {
        organizationDetails: {
          name: `Code Test Org ${Date.now()}`,
          type: 'research_institution',
          email: `codeorg_${Date.now()}@test.com`
        },
        adminDetails: {
          firstName: 'Code',
          lastName: 'Admin',
          email: `codeadmin_${Date.now()}@test.com`,
          password: 'SecureP@ss123!'
        }
      };

      const response = await request(BASE_URL)
        .post('/organizations/register')
        .send(registrationData);

      activeOrgId = response.body.data.organizationId;
      activeUserId = response.body.data.userId;

      // Activate the organization (direct DB update for testing)
      await testDb.pool.query(
        "UPDATE acc_organization SET status = 'active' WHERE organization_id = $1",
        [activeOrgId]
      );
    });

    afterAll(async () => {
      await testDb.cleanTables([
        'acc_organization_code_usage',
        'acc_organization_code',
        'acc_organization_membership',
        'acc_organization'
      ]);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    describe('POST /codes/validate', () => {
      beforeAll(async () => {
        // Generate a code for testing (direct DB insert)
        const result = await testDb.pool.query(`
          INSERT INTO acc_organization_code (code, organization_id, is_active, default_role, created_by, date_created)
          VALUES ('TESTCODE1234', $1, true, 'member', $2, NOW())
          RETURNING code
        `, [activeOrgId, activeUserId]);
        generatedCode = result.rows[0].code;
      });

      it('should validate a valid code', async () => {
        const response = await request(BASE_URL)
          .post('/organizations/codes/validate')
          .send({ code: generatedCode });

        expect(response.body.isValid).toBe(true);
        expect(response.body.organizationId).toBe(activeOrgId);
      });

      it('should return invalid for non-existent code', async () => {
        const response = await request(BASE_URL)
          .post('/organizations/codes/validate')
          .send({ code: 'INVALID12345' });

        expect(response.body.isValid).toBe(false);
      });

      it('should be case-insensitive', async () => {
        const response = await request(BASE_URL)
          .post('/organizations/codes/validate')
          .send({ code: generatedCode.toLowerCase() });

        expect(response.body.isValid).toBe(true);
      });
    });

    describe('POST /codes/register', () => {
      let registrationCode: string;

      beforeEach(async () => {
        // Generate a fresh code for each test
        const result = await testDb.pool.query(`
          INSERT INTO acc_organization_code (code, organization_id, is_active, max_uses, default_role, created_by, date_created)
          VALUES ($1, $2, true, 10, 'member', $3, NOW())
          RETURNING code
        `, [`REGCODE${Date.now().toString().slice(-6)}`, activeOrgId, activeUserId]);
        registrationCode = result.rows[0].code;
      });

      afterEach(async () => {
        // Clean up registered users (except org admin)
        await testDb.pool.query("DELETE FROM user_account WHERE user_id > $1", [activeUserId]);
        await testDb.cleanTables(['acc_organization_code_usage']);
      });

      it('should register user with valid code', async () => {
        const response = await request(BASE_URL)
          .post('/organizations/codes/register')
          .send({
            code: registrationCode,
            email: `codeuser_${Date.now()}@test.com`,
            password: 'UserP@ss123!',
            firstName: 'Code',
            lastName: 'User'
          });

        expect(response.body.success).toBe(true);
        expect(response.body.data?.userId).toBeDefined();
        expect(response.body.data?.organizationId).toBe(activeOrgId);
      });

      it('should reject duplicate email', async () => {
        const email = `dupe_${Date.now()}@test.com`;

        // First registration
        await request(BASE_URL)
          .post('/organizations/codes/register')
          .send({
            code: registrationCode,
            email,
            password: 'FirstP@ss123!',
            firstName: 'First',
            lastName: 'User'
          });

        // Second registration with same email
        const response = await request(BASE_URL)
          .post('/organizations/codes/register')
          .send({
            code: registrationCode,
            email,
            password: 'SecondP@ss123!',
            firstName: 'Second',
            lastName: 'User'
          });

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('already');
      });
    });
  });

  // ============================================================================
  // Access Request Tests
  // ============================================================================
  describe('Access Requests', () => {
    afterEach(async () => {
      await testDb.cleanTables(['acc_access_request']);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    describe('POST /access-requests', () => {
      it('should create access request', async () => {
        const response = await request(BASE_URL)
          .post('/organizations/access-requests')
          .send({
            email: `request_${Date.now()}@test.com`,
            firstName: 'Request',
            lastName: 'User',
            phone: '555-1234',
            reason: 'I need access to participate in clinical research studies and contribute to medical advancement.'
          });

        expect(response.body.success).toBe(true);
        expect(response.body.data?.requestId).toBeDefined();
      });

      it('should reject duplicate pending request', async () => {
        const email = `pending_${Date.now()}@test.com`;

        // First request
        await request(BASE_URL)
          .post('/organizations/access-requests')
          .send({
            email,
            firstName: 'First',
            lastName: 'Request',
            reason: 'First access request for testing purposes with sufficient length.'
          });

        // Second request
        const response = await request(BASE_URL)
          .post('/organizations/access-requests')
          .send({
            email,
            firstName: 'Second',
            lastName: 'Request',
            reason: 'Second access request for testing purposes with sufficient length.'
          });

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('pending');
      });
    });
  });

  // ============================================================================
  // Invitation Tests
  // ============================================================================
  describe('Invitations', () => {
    let inviteOrgId: number;
    let inviteUserId: number;
    let testToken: string;

    beforeAll(async () => {
      // Create an organization for invitation tests
      const registrationData = {
        organizationDetails: {
          name: `Invite Test Org ${Date.now()}`,
          type: 'university',
          email: `inviteorg_${Date.now()}@test.com`
        },
        adminDetails: {
          firstName: 'Invite',
          lastName: 'Admin',
          email: `inviteadmin_${Date.now()}@test.com`,
          password: 'SecureP@ss123!'
        }
      };

      const response = await request(BASE_URL)
        .post('/organizations/register')
        .send(registrationData);

      inviteOrgId = response.body.data.organizationId;
      inviteUserId = response.body.data.userId;

      // Activate the organization
      await testDb.pool.query(
        "UPDATE acc_organization SET status = 'active' WHERE organization_id = $1",
        [inviteOrgId]
      );
    });

    afterAll(async () => {
      await testDb.cleanTables([
        'acc_user_invitation',
        'acc_organization_membership',
        'acc_organization'
      ]);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    describe('GET /invitations/:token/validate', () => {
      beforeAll(async () => {
        // Create a test invitation
        testToken = `invitetoken${Date.now()}`;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await testDb.pool.query(`
          INSERT INTO acc_user_invitation (
            email, token, organization_id, role, status, expires_at, invited_by, date_created
          ) VALUES ($1, $2, $3, 'investigator', 'pending', $4, $5, NOW())
        `, [`invited_${Date.now()}@test.com`, testToken, inviteOrgId, expiresAt, inviteUserId]);
      });

      it('should validate a valid invitation', async () => {
        const response = await request(BASE_URL)
          .get(`/organizations/invitations/${testToken}/validate`);

        expect(response.body.isValid).toBe(true);
        expect(response.body.organizationId).toBe(inviteOrgId);
        expect(response.body.role).toBe('investigator');
      });

      it('should return invalid for non-existent token', async () => {
        const response = await request(BASE_URL)
          .get('/organizations/invitations/invalidtoken123/validate');

        expect(response.body.isValid).toBe(false);
      });
    });

    describe('POST /invitations/:token/accept', () => {
      let acceptToken: string;
      let acceptEmail: string;

      beforeEach(async () => {
        // Create a fresh invitation for each test
        acceptToken = `accepttoken${Date.now()}`;
        acceptEmail = `accept_${Date.now()}@test.com`;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await testDb.pool.query(`
          INSERT INTO acc_user_invitation (
            email, token, organization_id, role, status, expires_at, invited_by, date_created
          ) VALUES ($1, $2, $3, 'member', 'pending', $4, $5, NOW())
        `, [acceptEmail, acceptToken, inviteOrgId, expiresAt, inviteUserId]);
      });

      afterEach(async () => {
        await testDb.pool.query("DELETE FROM user_account WHERE user_id > $1", [inviteUserId]);
        await testDb.pool.query("DELETE FROM acc_user_invitation WHERE token LIKE 'accepttoken%'");
      });

      it('should accept invitation and create user', async () => {
        const response = await request(BASE_URL)
          .post(`/organizations/invitations/${acceptToken}/accept`)
          .send({
            password: 'AcceptP@ss123!',
            firstName: 'Accepted',
            lastName: 'User',
            phone: '555-9999'
          });

        expect(response.body.success).toBe(true);
        expect(response.body.data?.userId).toBeDefined();

        // Verify user was created in database
        const userResult = await testDb.pool.query(
          'SELECT * FROM user_account WHERE email = $1',
          [acceptEmail]
        );
        expect(userResult.rows.length).toBe(1);
        expect(userResult.rows[0].first_name).toBe('Accepted');
      });

      it('should reject weak password', async () => {
        const response = await request(BASE_URL)
          .post(`/organizations/invitations/${acceptToken}/accept`)
          .send({
            password: 'weak',
            firstName: 'Weak',
            lastName: 'Password'
          });

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Password');
      });

      it('should reject already accepted invitation', async () => {
        // Accept first time
        await request(BASE_URL)
          .post(`/organizations/invitations/${acceptToken}/accept`)
          .send({
            password: 'FirstP@ss123!',
            firstName: 'First',
            lastName: 'Accept'
          });

        // Try to accept again
        const response = await request(BASE_URL)
          .post(`/organizations/invitations/${acceptToken}/accept`)
          .send({
            password: 'SecondP@ss123!',
            firstName: 'Second',
            lastName: 'Accept'
          });

        expect(response.body.success).toBe(false);
      });
    });
  });
});

