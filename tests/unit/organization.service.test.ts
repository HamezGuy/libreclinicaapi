/**
 * Organization Service Unit Tests
 * 
 * Comprehensive tests for organization management including:
 * - Organization creation with admin user
 * - Organization codes (generation, validation, registration)
 * - Access requests (creation, review)
 * - User invitations (creation, validation, acceptance)
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { testDb } from '../utils/test-db';
import * as organizationService from '../../src/services/database/organization.service';

describe('Organization Service', () => {
  const creatorId = 1; // Root user

  beforeAll(async () => {
    // Ensure database connection and organization tables exist
    await testDb.connect();
    
    // Create organization tables if they don't exist
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
  });

  afterAll(async () => {
    // Clean up test data
    await testDb.cleanTables([
      'acc_organization_code_usage',
      'acc_organization_code',
      'acc_user_invitation',
      'acc_access_request',
      'acc_organization_membership',
      'acc_organization'
    ]);
  });

  // ============================================================================
  // Organization Creation Tests
  // ============================================================================
  describe('createOrganizationWithAdmin', () => {
    afterEach(async () => {
      // Clean up after each test
      await testDb.cleanTables([
        'acc_organization_membership',
        'acc_organization'
      ]);
      // Clean up any test users created (except root)
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    it('should create organization with admin user successfully', async () => {
      const orgData = {
        name: `Test Org ${Date.now()}`,
        type: 'hospital',
        email: `org_${Date.now()}@test.com`,
        phone: '555-1234',
        street: '123 Test St',
        city: 'Boston',
        state: 'MA',
        postalCode: '02101',
        country: 'United States'
      };

      const adminData = {
        firstName: 'Admin',
        lastName: 'User',
        email: `admin_${Date.now()}@test.com`,
        phone: '555-5678',
        password: 'SecureP@ss123!'
      };

      const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);

      expect(result.success).toBe(true);
      expect(result.organizationId).toBeDefined();
      expect(result.userId).toBeDefined();
      expect(result.message).toContain('pending');

      // Verify organization in database
      const orgResult = await testDb.pool.query(
        'SELECT * FROM acc_organization WHERE organization_id = $1',
        [result.organizationId]
      );
      expect(orgResult.rows.length).toBe(1);
      expect(orgResult.rows[0].name).toBe(orgData.name);
      expect(orgResult.rows[0].status).toBe('pending');

      // Verify user in database
      const userResult = await testDb.pool.query(
        'SELECT * FROM user_account WHERE user_id = $1',
        [result.userId]
      );
      expect(userResult.rows.length).toBe(1);
      expect(userResult.rows[0].first_name).toBe(adminData.firstName);

      // Verify membership created
      const memberResult = await testDb.pool.query(
        'SELECT * FROM acc_organization_membership WHERE organization_id = $1 AND user_id = $2',
        [result.organizationId, result.userId]
      );
      expect(memberResult.rows.length).toBe(1);
      expect(memberResult.rows[0].role).toBe('owner');
    });

    it('should reject duplicate organization name', async () => {
      const orgData = {
        name: `Duplicate Org ${Date.now()}`,
        type: 'clinic',
        email: `org1_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Admin',
        lastName: 'User',
        email: `admin1_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      // Create first org
      const result1 = await organizationService.createOrganizationWithAdmin(orgData, adminData);
      expect(result1.success).toBe(true);

      // Try to create duplicate
      const adminData2 = {
        ...adminData,
        email: `admin2_${Date.now()}@test.com`
      };

      const result2 = await organizationService.createOrganizationWithAdmin(orgData, adminData2);

      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');
    });

    it('should reject duplicate organization email', async () => {
      const sharedEmail = `shared_${Date.now()}@test.com`;

      const orgData1 = {
        name: `Org1 ${Date.now()}`,
        type: 'hospital',
        email: sharedEmail
      };

      const orgData2 = {
        name: `Org2 ${Date.now()}`,
        type: 'clinic',
        email: sharedEmail
      };

      const adminData1 = {
        firstName: 'Admin',
        lastName: 'User',
        email: `admin1_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const adminData2 = {
        firstName: 'Admin',
        lastName: 'User',
        email: `admin2_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result1 = await organizationService.createOrganizationWithAdmin(orgData1, adminData1);
      expect(result1.success).toBe(true);

      const result2 = await organizationService.createOrganizationWithAdmin(orgData2, adminData2);
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('email already');
    });

    it('should reject weak password', async () => {
      const orgData = {
        name: `Weak Pass Org ${Date.now()}`,
        type: 'cro',
        email: `org_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Admin',
        lastName: 'User',
        email: `admin_${Date.now()}@test.com`,
        password: 'weak'
      };

      const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password validation failed');
    });

    it('should reject duplicate admin email', async () => {
      const sharedEmail = `sharedadmin_${Date.now()}@test.com`;

      const orgData1 = {
        name: `OrgA ${Date.now()}`,
        type: 'university',
        email: `orgA_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Admin',
        lastName: 'User',
        email: sharedEmail,
        password: 'SecureP@ss123!'
      };

      const result1 = await organizationService.createOrganizationWithAdmin(orgData1, adminData);
      expect(result1.success).toBe(true);

      const orgData2 = {
        name: `OrgB ${Date.now()}`,
        type: 'research_institution',
        email: `orgB_${Date.now()}@test.com`
      };

      const result2 = await organizationService.createOrganizationWithAdmin(orgData2, adminData);
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('Admin email already');
    });

    it('should handle all organization types', async () => {
      const types = ['hospital', 'clinic', 'research_institution', 'pharmaceutical', 'cro', 'university', 'government', 'other'];

      for (const type of types) {
        const orgData = {
          name: `Type Test ${type} ${Date.now()}`,
          type,
          email: `${type}_${Date.now()}@test.com`
        };

        const adminData = {
          firstName: 'Admin',
          lastName: type,
          email: `admin_${type}_${Date.now()}@test.com`,
          password: 'SecureP@ss123!'
        };

        const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);
        expect(result.success).toBe(true);
      }
    });
  });

  // ============================================================================
  // Organization Code Tests
  // ============================================================================
  describe('Organization Codes', () => {
    let testOrgId: number;
    let testUserId: number;

    beforeAll(async () => {
      // Create a test organization that is active
      const orgData = {
        name: `Code Test Org ${Date.now()}`,
        type: 'hospital',
        email: `codetest_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Code',
        lastName: 'Admin',
        email: `codeadmin_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);
      testOrgId = result.organizationId!;
      testUserId = result.userId!;

      // Activate the organization
      await organizationService.updateOrganizationStatus(testOrgId, 'active', 1);
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

    describe('generateOrganizationCode', () => {
      it('should generate a valid code', async () => {
        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {});

        expect(result.success).toBe(true);
        expect(result.code).toBeDefined();
        expect(result.code?.length).toBe(12);
        expect(result.codeId).toBeDefined();
      });

      it('should generate code with max uses', async () => {
        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          maxUses: 5
        });

        expect(result.success).toBe(true);

        // Verify in database
        const dbResult = await testDb.pool.query(
          'SELECT max_uses FROM acc_organization_code WHERE code_id = $1',
          [result.codeId]
        );
        expect(dbResult.rows[0].max_uses).toBe(5);
      });

      it('should generate code with expiration', async () => {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          expiresAt
        });

        expect(result.success).toBe(true);

        const dbResult = await testDb.pool.query(
          'SELECT expires_at FROM acc_organization_code WHERE code_id = $1',
          [result.codeId]
        );
        expect(dbResult.rows[0].expires_at).toBeDefined();
      });

      it('should generate code with custom role', async () => {
        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          defaultRole: 'investigator'
        });

        expect(result.success).toBe(true);

        const dbResult = await testDb.pool.query(
          'SELECT default_role FROM acc_organization_code WHERE code_id = $1',
          [result.codeId]
        );
        expect(dbResult.rows[0].default_role).toBe('investigator');
      });

      it('should fail for non-existent organization', async () => {
        const result = await organizationService.generateOrganizationCode(999999, testUserId, {});

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });
    });

    describe('validateOrganizationCode', () => {
      let validCode: string;

      beforeAll(async () => {
        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {});
        validCode = result.code!;
      });

      it('should validate a valid code', async () => {
        const result = await organizationService.validateOrganizationCode(validCode);

        expect(result.isValid).toBe(true);
        expect(result.organizationId).toBe(testOrgId);
        expect(result.organizationName).toBeDefined();
      });

      it('should be case-insensitive', async () => {
        const result = await organizationService.validateOrganizationCode(validCode.toLowerCase());

        expect(result.isValid).toBe(true);
      });

      it('should reject invalid code', async () => {
        const result = await organizationService.validateOrganizationCode('INVALID123');

        expect(result.isValid).toBe(false);
        expect(result.message).toContain('Invalid code');
      });

      it('should reject expired code', async () => {
        // Create an expired code
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() - 1); // Yesterday

        const codeResult = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          expiresAt
        });

        const result = await organizationService.validateOrganizationCode(codeResult.code!);

        expect(result.isValid).toBe(false);
        expect(result.message).toContain('expired');
      });

      it('should reject deactivated code', async () => {
        const codeResult = await organizationService.generateOrganizationCode(testOrgId, testUserId, {});
        
        // Deactivate the code
        await organizationService.deactivateOrganizationCode(codeResult.codeId!, testUserId);

        const result = await organizationService.validateOrganizationCode(codeResult.code!);

        expect(result.isValid).toBe(false);
        expect(result.message).toContain('deactivated');
      });

      it('should reject code that reached max uses', async () => {
        const codeResult = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          maxUses: 1
        });

        // Manually set current_uses to max
        await testDb.pool.query(
          'UPDATE acc_organization_code SET current_uses = max_uses WHERE code_id = $1',
          [codeResult.codeId]
        );

        const result = await organizationService.validateOrganizationCode(codeResult.code!);

        expect(result.isValid).toBe(false);
        expect(result.message).toContain('usage limit');
      });
    });

    describe('registerWithCode', () => {
      let registrationCode: string;

      beforeEach(async () => {
        const result = await organizationService.generateOrganizationCode(testOrgId, testUserId, {
          maxUses: 10
        });
        registrationCode = result.code!;
      });

      afterEach(async () => {
        // Clean up registered users (except test admin)
        await testDb.pool.query("DELETE FROM user_account WHERE user_id > $1", [testUserId]);
        await testDb.cleanTables(['acc_organization_code_usage']);
      });

      it('should register user with valid code', async () => {
        const userData = {
          email: `codeuser_${Date.now()}@test.com`,
          password: 'UserP@ss123!',
          firstName: 'Code',
          lastName: 'User'
        };

        const result = await organizationService.registerWithCode(registrationCode, userData);

        expect(result.success).toBe(true);
        expect(result.userId).toBeDefined();
        expect(result.organizationId).toBe(testOrgId);

        // Verify user created in database
        const userResult = await testDb.pool.query(
          'SELECT * FROM user_account WHERE user_id = $1',
          [result.userId]
        );
        expect(userResult.rows.length).toBe(1);
        expect(userResult.rows[0].email).toBe(userData.email);

        // Verify membership created
        const memberResult = await testDb.pool.query(
          'SELECT * FROM acc_organization_membership WHERE user_id = $1',
          [result.userId]
        );
        expect(memberResult.rows.length).toBe(1);
        expect(memberResult.rows[0].organization_id).toBe(testOrgId);
      });

      it('should increment code usage count', async () => {
        const userData = {
          email: `counter_${Date.now()}@test.com`,
          password: 'UserP@ss123!',
          firstName: 'Counter',
          lastName: 'User'
        };

        // Get initial count
        const initialResult = await testDb.pool.query(
          "SELECT current_uses FROM acc_organization_code WHERE code = $1",
          [registrationCode]
        );
        const initialCount = initialResult.rows[0].current_uses;

        await organizationService.registerWithCode(registrationCode, userData);

        // Check incremented count
        const finalResult = await testDb.pool.query(
          "SELECT current_uses FROM acc_organization_code WHERE code = $1",
          [registrationCode]
        );
        expect(finalResult.rows[0].current_uses).toBe(initialCount + 1);
      });

      it('should log code usage', async () => {
        const userData = {
          email: `loguser_${Date.now()}@test.com`,
          password: 'UserP@ss123!',
          firstName: 'Log',
          lastName: 'User'
        };

        const result = await organizationService.registerWithCode(registrationCode, userData, '192.168.1.1');

        const usageResult = await testDb.pool.query(
          'SELECT * FROM acc_organization_code_usage WHERE user_id = $1',
          [result.userId]
        );
        expect(usageResult.rows.length).toBe(1);
        expect(usageResult.rows[0].ip_address).toBe('192.168.1.1');
      });

      it('should reject duplicate email', async () => {
        const email = `dupe_${Date.now()}@test.com`;

        const userData1 = {
          email,
          password: 'UserP@ss123!',
          firstName: 'First',
          lastName: 'User'
        };

        const result1 = await organizationService.registerWithCode(registrationCode, userData1);
        expect(result1.success).toBe(true);

        const userData2 = {
          email,
          password: 'UserP@ss123!',
          firstName: 'Second',
          lastName: 'User'
        };

        const result2 = await organizationService.registerWithCode(registrationCode, userData2);
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('already registered');
      });

      it('should reject invalid code', async () => {
        const userData = {
          email: `invalid_${Date.now()}@test.com`,
          password: 'UserP@ss123!',
          firstName: 'Invalid',
          lastName: 'Code'
        };

        const result = await organizationService.registerWithCode('INVALID123', userData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid');
      });

      it('should reject weak password', async () => {
        const userData = {
          email: `weakpass_${Date.now()}@test.com`,
          password: 'weak',
          firstName: 'Weak',
          lastName: 'Password'
        };

        const result = await organizationService.registerWithCode(registrationCode, userData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Password');
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

    describe('createAccessRequest', () => {
      it('should create an access request', async () => {
        const requestData = {
          email: `request_${Date.now()}@test.com`,
          firstName: 'Request',
          lastName: 'User',
          phone: '555-1234',
          reason: 'I need access to participate in research studies.'
        };

        const result = await organizationService.createAccessRequest(requestData);

        expect(result.success).toBe(true);
        expect(result.requestId).toBeDefined();

        // Verify in database
        const dbResult = await testDb.pool.query(
          'SELECT * FROM acc_access_request WHERE request_id = $1',
          [result.requestId]
        );
        expect(dbResult.rows.length).toBe(1);
        expect(dbResult.rows[0].status).toBe('pending');
      });

      it('should include optional fields', async () => {
        const requestData = {
          email: `full_${Date.now()}@test.com`,
          firstName: 'Full',
          lastName: 'Data',
          phone: '555-9999',
          organizationName: 'External Research Corp',
          professionalTitle: 'Senior Researcher',
          credentials: 'PhD, MPH',
          reason: 'Requesting access for monitoring purposes.',
          requestedRole: 'monitor'
        };

        const result = await organizationService.createAccessRequest(requestData);
        expect(result.success).toBe(true);

        const dbResult = await testDb.pool.query(
          'SELECT * FROM acc_access_request WHERE request_id = $1',
          [result.requestId]
        );
        expect(dbResult.rows[0].professional_title).toBe(requestData.professionalTitle);
        expect(dbResult.rows[0].credentials).toBe(requestData.credentials);
        expect(dbResult.rows[0].requested_role).toBe(requestData.requestedRole);
      });

      it('should reject request from existing user', async () => {
        // Create a user first
        await testDb.pool.query(`
          INSERT INTO user_account (user_name, passwd, first_name, last_name, email, user_type_id, status_id, owner_id, date_created)
          VALUES ('existinguser', 'hash', 'Existing', 'User', 'existing@test.com', 2, 1, 1, NOW())
        `);

        const requestData = {
          email: 'existing@test.com',
          firstName: 'Existing',
          lastName: 'User',
          reason: 'I want access'
        };

        const result = await organizationService.createAccessRequest(requestData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('already registered');
      });

      it('should reject duplicate pending request', async () => {
        const email = `pending_${Date.now()}@test.com`;

        const requestData = {
          email,
          firstName: 'Pending',
          lastName: 'User',
          reason: 'First request'
        };

        const result1 = await organizationService.createAccessRequest(requestData);
        expect(result1.success).toBe(true);

        const result2 = await organizationService.createAccessRequest(requestData);
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('pending');
      });
    });

    describe('reviewAccessRequest', () => {
      let testRequestId: number;

      beforeEach(async () => {
        const requestData = {
          email: `review_${Date.now()}@test.com`,
          firstName: 'Review',
          lastName: 'Test',
          reason: 'Need access for testing'
        };

        const result = await organizationService.createAccessRequest(requestData);
        testRequestId = result.requestId!;
      });

      it('should approve request and create user', async () => {
        const result = await organizationService.reviewAccessRequest(
          testRequestId,
          creatorId,
          'approved',
          'Welcome to the team!',
          'ApprovedP@ss123!'
        );

        expect(result.success).toBe(true);
        expect(result.userId).toBeDefined();

        // Verify request updated
        const reqResult = await testDb.pool.query(
          'SELECT * FROM acc_access_request WHERE request_id = $1',
          [testRequestId]
        );
        expect(reqResult.rows[0].status).toBe('approved');
        expect(reqResult.rows[0].user_id).toBe(result.userId);

        // Verify user created
        const userResult = await testDb.pool.query(
          'SELECT * FROM user_account WHERE user_id = $1',
          [result.userId]
        );
        expect(userResult.rows.length).toBe(1);
      });

      it('should reject request', async () => {
        const result = await organizationService.reviewAccessRequest(
          testRequestId,
          creatorId,
          'rejected',
          'Does not meet requirements'
        );

        expect(result.success).toBe(true);
        expect(result.userId).toBeUndefined();

        const reqResult = await testDb.pool.query(
          'SELECT * FROM acc_access_request WHERE request_id = $1',
          [testRequestId]
        );
        expect(reqResult.rows[0].status).toBe('rejected');
        expect(reqResult.rows[0].review_notes).toContain('requirements');
      });

      it('should fail for non-existent request', async () => {
        const result = await organizationService.reviewAccessRequest(
          999999,
          creatorId,
          'approved'
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });

      it('should fail for already reviewed request', async () => {
        // Review once
        await organizationService.reviewAccessRequest(testRequestId, creatorId, 'rejected');

        // Try to review again
        const result = await organizationService.reviewAccessRequest(
          testRequestId,
          creatorId,
          'approved'
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('already been reviewed');
      });
    });
  });

  // ============================================================================
  // Invitation Tests
  // ============================================================================
  describe('Invitations', () => {
    let testOrgId: number;
    let testUserId: number;

    beforeAll(async () => {
      const orgData = {
        name: `Invite Test Org ${Date.now()}`,
        type: 'research_institution',
        email: `invitetest_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Invite',
        lastName: 'Admin',
        email: `inviteadmin_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);
      testOrgId = result.organizationId!;
      testUserId = result.userId!;

      await organizationService.updateOrganizationStatus(testOrgId, 'active', 1);
    });

    afterAll(async () => {
      await testDb.cleanTables([
        'acc_user_invitation',
        'acc_organization_membership',
        'acc_organization'
      ]);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    afterEach(async () => {
      await testDb.cleanTables(['acc_user_invitation']);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > $1", [testUserId]);
    });

    describe('createInvitation', () => {
      it('should create an invitation', async () => {
        const result = await organizationService.createInvitation(
          `invite_${Date.now()}@test.com`,
          testUserId,
          { organizationId: testOrgId }
        );

        expect(result.success).toBe(true);
        expect(result.token).toBeDefined();
        expect(result.token?.length).toBe(64);
        expect(result.invitationId).toBeDefined();
      });

      it('should set expiration date', async () => {
        const result = await organizationService.createInvitation(
          `expire_${Date.now()}@test.com`,
          testUserId,
          { expiresInDays: 14 }
        );

        expect(result.success).toBe(true);

        const dbResult = await testDb.pool.query(
          'SELECT expires_at FROM acc_user_invitation WHERE invitation_id = $1',
          [result.invitationId]
        );

        const expiresAt = new Date(dbResult.rows[0].expires_at);
        const now = new Date();
        const daysDiff = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        expect(daysDiff).toBeGreaterThanOrEqual(13);
        expect(daysDiff).toBeLessThanOrEqual(14);
      });

      it('should include message', async () => {
        const message = 'Welcome to our research team!';
        const result = await organizationService.createInvitation(
          `message_${Date.now()}@test.com`,
          testUserId,
          { organizationId: testOrgId, message }
        );

        expect(result.success).toBe(true);

        const dbResult = await testDb.pool.query(
          'SELECT message FROM acc_user_invitation WHERE invitation_id = $1',
          [result.invitationId]
        );
        expect(dbResult.rows[0].message).toBe(message);
      });

      it('should reject invitation for existing user', async () => {
        // Create a user first
        await testDb.pool.query(`
          INSERT INTO user_account (user_name, passwd, first_name, last_name, email, user_type_id, status_id, owner_id, date_created)
          VALUES ('existingforInvite', 'hash', 'Existing', 'User', 'existing_invite@test.com', 2, 1, 1, NOW())
        `);

        const result = await organizationService.createInvitation(
          'existing_invite@test.com',
          testUserId
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('already registered');
      });

      it('should reject duplicate pending invitation', async () => {
        const email = `dupe_invite_${Date.now()}@test.com`;

        const result1 = await organizationService.createInvitation(email, testUserId);
        expect(result1.success).toBe(true);

        const result2 = await organizationService.createInvitation(email, testUserId);
        expect(result2.success).toBe(false);
        expect(result2.message).toContain('pending invitation');
      });
    });

    describe('validateInvitation', () => {
      let validToken: string;

      beforeEach(async () => {
        const result = await organizationService.createInvitation(
          `validate_${Date.now()}@test.com`,
          testUserId,
          {
            organizationId: testOrgId,
            role: 'investigator',
            message: 'Welcome!'
          }
        );
        validToken = result.token!;
      });

      it('should validate a valid invitation', async () => {
        const result = await organizationService.validateInvitation(validToken);

        expect(result.isValid).toBe(true);
        expect(result.email).toBeDefined();
        expect(result.organizationId).toBe(testOrgId);
        expect(result.role).toBe('investigator');
        expect(result.inviterName).toBeDefined();
        expect(result.message).toBe('Welcome!');
      });

      it('should reject invalid token', async () => {
        const result = await organizationService.validateInvitation('invalid_token_123');

        expect(result.isValid).toBe(false);
      });

      it('should reject expired invitation', async () => {
        // Create an expired invitation
        const email = `expired_${Date.now()}@test.com`;
        await testDb.pool.query(`
          INSERT INTO acc_user_invitation (email, token, expires_at, invited_by, status, date_created)
          VALUES ($1, 'expired_token_123', NOW() - INTERVAL '1 day', $2, 'pending', NOW())
        `, [email, testUserId]);

        const result = await organizationService.validateInvitation('expired_token_123');

        expect(result.isValid).toBe(false);
      });

      it('should reject already accepted invitation', async () => {
        // Accept the invitation in database
        await testDb.pool.query(
          "UPDATE acc_user_invitation SET status = 'accepted' WHERE token = $1",
          [validToken]
        );

        const result = await organizationService.validateInvitation(validToken);

        expect(result.isValid).toBe(false);
      });
    });

    describe('acceptInvitation', () => {
      let acceptToken: string;

      beforeEach(async () => {
        const result = await organizationService.createInvitation(
          `accept_${Date.now()}@test.com`,
          testUserId,
          { organizationId: testOrgId, role: 'member' }
        );
        acceptToken = result.token!;
      });

      it('should accept invitation and create user', async () => {
        const userData = {
          password: 'AcceptP@ss123!',
          firstName: 'Accepted',
          lastName: 'User',
          phone: '555-1234'
        };

        const result = await organizationService.acceptInvitation(acceptToken, userData);

        expect(result.success).toBe(true);
        expect(result.userId).toBeDefined();

        // Verify user created
        const userResult = await testDb.pool.query(
          'SELECT * FROM user_account WHERE user_id = $1',
          [result.userId]
        );
        expect(userResult.rows.length).toBe(1);
        expect(userResult.rows[0].first_name).toBe(userData.firstName);

        // Verify membership created
        const memberResult = await testDb.pool.query(
          'SELECT * FROM acc_organization_membership WHERE user_id = $1',
          [result.userId]
        );
        expect(memberResult.rows.length).toBe(1);
        expect(memberResult.rows[0].organization_id).toBe(testOrgId);

        // Verify invitation status updated
        const invResult = await testDb.pool.query(
          'SELECT * FROM acc_user_invitation WHERE token = $1',
          [acceptToken]
        );
        expect(invResult.rows[0].status).toBe('accepted');
        expect(invResult.rows[0].accepted_by).toBe(result.userId);
      });

      it('should reject weak password', async () => {
        const userData = {
          password: 'weak',
          firstName: 'Weak',
          lastName: 'Password'
        };

        const result = await organizationService.acceptInvitation(acceptToken, userData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Password');
      });

      it('should reject invalid token', async () => {
        const userData = {
          password: 'ValidP@ss123!',
          firstName: 'Invalid',
          lastName: 'Token'
        };

        const result = await organizationService.acceptInvitation('invalid_token', userData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid');
      });

      it('should reject already accepted invitation', async () => {
        // Accept once
        const userData = {
          password: 'FirstP@ss123!',
          firstName: 'First',
          lastName: 'Accept'
        };
        await organizationService.acceptInvitation(acceptToken, userData);

        // Try to accept again
        const result = await organizationService.acceptInvitation(acceptToken, {
          password: 'SecondP@ss123!',
          firstName: 'Second',
          lastName: 'Accept'
        });

        expect(result.success).toBe(false);
      });
    });
  });

  // ============================================================================
  // Organization Status Tests
  // ============================================================================
  describe('Organization Status Management', () => {
    let statusTestOrgId: number;

    beforeEach(async () => {
      const orgData = {
        name: `Status Test ${Date.now()}`,
        type: 'clinic',
        email: `statustest_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Status',
        lastName: 'Admin',
        email: `statusadmin_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);
      statusTestOrgId = result.organizationId!;
    });

    afterEach(async () => {
      await testDb.cleanTables(['acc_organization_membership', 'acc_organization']);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    it('should activate pending organization', async () => {
      const result = await organizationService.updateOrganizationStatus(
        statusTestOrgId,
        'active',
        creatorId,
        'Approved after review'
      );

      expect(result.success).toBe(true);

      const dbResult = await testDb.pool.query(
        'SELECT status, approved_by, approved_at FROM acc_organization WHERE organization_id = $1',
        [statusTestOrgId]
      );
      expect(dbResult.rows[0].status).toBe('active');
      expect(dbResult.rows[0].approved_by).toBe(creatorId);
      expect(dbResult.rows[0].approved_at).toBeDefined();
    });

    it('should suspend active organization', async () => {
      // First activate
      await organizationService.updateOrganizationStatus(statusTestOrgId, 'active', creatorId);

      // Then suspend
      const result = await organizationService.updateOrganizationStatus(
        statusTestOrgId,
        'suspended',
        creatorId,
        'Compliance issue'
      );

      expect(result.success).toBe(true);

      const dbResult = await testDb.pool.query(
        'SELECT status FROM acc_organization WHERE organization_id = $1',
        [statusTestOrgId]
      );
      expect(dbResult.rows[0].status).toBe('suspended');
    });

    it('should fail for non-existent organization', async () => {
      const result = await organizationService.updateOrganizationStatus(
        999999,
        'active',
        creatorId
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  // ============================================================================
  // User Organizations Tests
  // ============================================================================
  describe('getUserOrganizations', () => {
    let multiOrgUserId: number;

    beforeAll(async () => {
      // Create user and multiple organizations
      const orgData1 = {
        name: `Multi Org 1 ${Date.now()}`,
        type: 'hospital',
        email: `multiorg1_${Date.now()}@test.com`
      };

      const adminData = {
        firstName: 'Multi',
        lastName: 'Org',
        email: `multiadmin_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result1 = await organizationService.createOrganizationWithAdmin(orgData1, adminData);
      multiOrgUserId = result1.userId!;

      // Create second org and add user as member
      const orgData2 = {
        name: `Multi Org 2 ${Date.now()}`,
        type: 'clinic',
        email: `multiorg2_${Date.now()}@test.com`
      };

      const adminData2 = {
        firstName: 'Second',
        lastName: 'Admin',
        email: `secondadmin_${Date.now()}@test.com`,
        password: 'SecureP@ss123!'
      };

      const result2 = await organizationService.createOrganizationWithAdmin(orgData2, adminData2);

      // Activate both orgs
      await organizationService.updateOrganizationStatus(result1.organizationId!, 'active', 1);
      await organizationService.updateOrganizationStatus(result2.organizationId!, 'active', 1);

      // Add multiOrgUserId to second org as member
      await testDb.pool.query(`
        INSERT INTO acc_organization_membership (organization_id, user_id, role, status, date_created)
        VALUES ($1, $2, 'member', 'active', NOW())
      `, [result2.organizationId, multiOrgUserId]);
    });

    afterAll(async () => {
      await testDb.cleanTables(['acc_organization_membership', 'acc_organization']);
      await testDb.pool.query("DELETE FROM user_account WHERE user_id > 1");
    });

    it('should return all organizations for a user', async () => {
      const orgs = await organizationService.getUserOrganizations(multiOrgUserId);

      expect(orgs.length).toBe(2);
      expect(orgs.some(o => o.role === 'owner')).toBe(true);
      expect(orgs.some(o => o.role === 'member')).toBe(true);
    });

    it('should return empty array for user with no organizations', async () => {
      const orgs = await organizationService.getUserOrganizations(999999);

      expect(orgs).toEqual([]);
    });
  });
});

