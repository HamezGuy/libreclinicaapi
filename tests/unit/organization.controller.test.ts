/**
 * Organization Controller Unit Tests
 * 
 * Tests HTTP request/response handling for organization endpoints including:
 * - Request validation
 * - Authentication/authorization
 * - Response formatting
 * - Error handling
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Request, Response } from 'express';
import * as organizationController from '../../src/controllers/organization.controller';
import * as organizationService from '../../src/services/database/organization.service';

// Mock the organization service
jest.mock('../../src/services/database/organization.service');

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Organization Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let responseJson: jest.Mock;
  let responseStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    responseJson = jest.fn().mockReturnThis();
    responseStatus = jest.fn().mockReturnThis();

    mockResponse = {
      json: responseJson,
      status: responseStatus
    };

    mockRequest = {
      body: {},
      params: {},
      query: {},
      user: { userId: 1, username: 'testuser' },
      ip: '192.168.1.1'
    };
  });

  // ============================================================================
  // Register Organization Tests
  // ============================================================================
  describe('registerOrganization', () => {
    const validRegistrationData = {
      organizationDetails: {
        name: 'Test Hospital',
        type: 'hospital',
        email: 'contact@testhospital.com',
        phone: '555-1234',
        street: '123 Medical Dr',
        city: 'Boston',
        state: 'MA',
        postalCode: '02101',
        country: 'United States'
      },
      adminDetails: {
        firstName: 'John',
        lastName: 'Admin',
        email: 'john.admin@testhospital.com',
        phone: '555-5678',
        password: 'SecureP@ss123!'
      },
      termsAccepted: {
        termsOfService: true,
        privacyPolicy: true,
        dataProcessing: true
      }
    };

    it('should successfully register organization', async () => {
      mockRequest.body = validRegistrationData;

      (organizationService.createOrganizationWithAdmin as jest.Mock).mockResolvedValue({
        success: true,
        organizationId: 1,
        userId: 2,
        message: 'Organization registered. Pending approval.'
      });

      await organizationController.registerOrganization(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          organizationId: 1,
          userId: 2
        })
      }));
    });

    it('should return 400 for missing organization details', async () => {
      mockRequest.body = {
        adminDetails: validRegistrationData.adminDetails,
        termsAccepted: validRegistrationData.termsAccepted
      };

      await organizationController.registerOrganization(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('required')
      }));
    });

    it('should return 400 for missing admin details', async () => {
      mockRequest.body = {
        organizationDetails: validRegistrationData.organizationDetails,
        termsAccepted: validRegistrationData.termsAccepted
      };

      await organizationController.registerOrganization(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should return 400 for duplicate organization', async () => {
      mockRequest.body = validRegistrationData;

      (organizationService.createOrganizationWithAdmin as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Organization name already exists'
      });

      await organizationController.registerOrganization(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('already exists')
      }));
    });

    it('should handle service error', async () => {
      mockRequest.body = validRegistrationData;

      (organizationService.createOrganizationWithAdmin as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      await organizationController.registerOrganization(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(500);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('error')
      }));
    });
  });

  // ============================================================================
  // Validate Organization Code Tests
  // ============================================================================
  describe('validateOrganizationCode', () => {
    it('should validate a valid code', async () => {
      mockRequest.body = { code: 'ABC123DEF456' };

      (organizationService.validateOrganizationCode as jest.Mock).mockResolvedValue({
        isValid: true,
        organizationId: 1,
        organizationName: 'Test Hospital',
        role: 'member',
        expiresAt: new Date('2025-12-31')
      });

      await organizationController.validateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        isValid: true,
        organizationName: 'Test Hospital'
      }));
    });

    it('should return invalid for bad code', async () => {
      mockRequest.body = { code: 'INVALID' };

      (organizationService.validateOrganizationCode as jest.Mock).mockResolvedValue({
        isValid: false,
        message: 'Invalid code'
      });

      await organizationController.validateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        isValid: false
      }));
    });

    it('should return 400 for missing code', async () => {
      mockRequest.body = {};

      await organizationController.validateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should sanitize code input', async () => {
      mockRequest.body = { code: '  abc-123-def-456  ' };

      (organizationService.validateOrganizationCode as jest.Mock).mockResolvedValue({
        isValid: true,
        organizationId: 1,
        organizationName: 'Test Org'
      });

      await organizationController.validateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      // Verify the service was called with cleaned code
      expect(organizationService.validateOrganizationCode).toHaveBeenCalledWith(
        expect.stringMatching(/ABC123DEF456/i)
      );
    });
  });

  // ============================================================================
  // Register With Code Tests
  // ============================================================================
  describe('registerWithCode', () => {
    const validRegistration = {
      code: 'ABC123DEF456',
      email: 'newuser@test.com',
      password: 'SecureP@ss123!',
      firstName: 'New',
      lastName: 'User',
      phone: '555-1234'
    };

    it('should successfully register with valid code', async () => {
      mockRequest.body = validRegistration;

      (organizationService.registerWithCode as jest.Mock).mockResolvedValue({
        success: true,
        userId: 5,
        organizationId: 1,
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token'
      });

      await organizationController.registerWithCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        accessToken: expect.any(String),
        refreshToken: expect.any(String)
      }));
    });

    it('should return 400 for invalid code', async () => {
      mockRequest.body = validRegistration;

      (organizationService.registerWithCode as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Invalid or expired code'
      });

      await organizationController.registerWithCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('Invalid')
      }));
    });

    it('should pass IP address for logging', async () => {
      mockRequest.body = validRegistration;
      mockRequest.ip = '10.0.0.1';

      (organizationService.registerWithCode as jest.Mock).mockResolvedValue({
        success: true,
        userId: 5,
        organizationId: 1
      });

      await organizationController.registerWithCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(organizationService.registerWithCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        '10.0.0.1'
      );
    });
  });

  // ============================================================================
  // Generate Organization Code Tests
  // ============================================================================
  describe('generateOrganizationCode', () => {
    beforeEach(() => {
      mockRequest.params = { id: '1' };
      mockRequest.user = { userId: 2, username: 'admin' };
    });

    it('should generate code successfully', async () => {
      mockRequest.body = { maxUses: 10, expiresInDays: 30 };

      (organizationService.generateOrganizationCode as jest.Mock).mockResolvedValue({
        success: true,
        code: 'ABCD1234EFGH',
        codeId: 1
      });

      await organizationController.generateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        code: expect.any(String)
      }));
    });

    it('should fail for non-existent organization', async () => {
      mockRequest.params = { id: '999' };
      mockRequest.body = {};

      (organizationService.generateOrganizationCode as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Organization not found'
      });

      await organizationController.generateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
    });

    it('should require authentication', async () => {
      mockRequest.user = undefined;
      mockRequest.body = {};

      await organizationController.generateOrganizationCode(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
    });
  });

  // ============================================================================
  // Submit Access Request Tests
  // ============================================================================
  describe('submitAccessRequest', () => {
    const validRequest = {
      email: 'requester@test.com',
      firstName: 'Access',
      lastName: 'Requester',
      phone: '555-1234',
      reason: 'I need access to participate in research',
      requestedRole: 'investigator'
    };

    it('should submit access request successfully', async () => {
      mockRequest.body = validRequest;

      (organizationService.createAccessRequest as jest.Mock).mockResolvedValue({
        success: true,
        requestId: 1
      });

      await organizationController.submitAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { requestId: 1 }
      }));
    });

    it('should return 400 for missing required fields', async () => {
      mockRequest.body = { email: 'test@test.com' };

      await organizationController.submitAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should reject duplicate pending request', async () => {
      mockRequest.body = validRequest;

      (organizationService.createAccessRequest as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Pending request already exists'
      });

      await organizationController.submitAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('Pending')
      }));
    });
  });

  // ============================================================================
  // Get Invitation Details Tests
  // ============================================================================
  describe('getInvitationDetails', () => {
    it('should return invitation details for valid token', async () => {
      mockRequest.params = { token: 'valid-invitation-token' };

      (organizationService.validateInvitation as jest.Mock).mockResolvedValue({
        isValid: true,
        email: 'invited@test.com',
        organizationId: 1,
        organizationName: 'Test Hospital',
        role: 'investigator',
        inviterName: 'John Admin',
        message: 'Welcome to our team!',
        expiresAt: new Date('2025-12-31')
      });

      await organizationController.getInvitationDetails(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        email: 'invited@test.com',
        organizationName: 'Test Hospital',
        role: 'investigator'
      }));
    });

    it('should return 404 for invalid token', async () => {
      mockRequest.params = { token: 'invalid-token' };

      (organizationService.validateInvitation as jest.Mock).mockResolvedValue({
        isValid: false,
        message: 'Invalid or expired invitation'
      });

      await organizationController.getInvitationDetails(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
    });

    it('should return 404 for expired invitation', async () => {
      mockRequest.params = { token: 'expired-token' };

      (organizationService.validateInvitation as jest.Mock).mockResolvedValue({
        isValid: false,
        message: 'Invitation has expired'
      });

      await organizationController.getInvitationDetails(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
    });
  });

  // ============================================================================
  // Accept Invitation Tests
  // ============================================================================
  describe('acceptInvitation', () => {
    const validAcceptance = {
      password: 'SecureP@ss123!',
      firstName: 'Invited',
      lastName: 'User',
      phone: '555-9999'
    };

    it('should accept invitation successfully', async () => {
      mockRequest.params = { token: 'valid-token' };
      mockRequest.body = validAcceptance;

      (organizationService.acceptInvitation as jest.Mock).mockResolvedValue({
        success: true,
        userId: 5,
        organizationId: 1,
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token'
      });

      await organizationController.acceptInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        accessToken: expect.any(String)
      }));
    });

    it('should return 400 for invalid token', async () => {
      mockRequest.params = { token: 'invalid-token' };
      mockRequest.body = validAcceptance;

      (organizationService.acceptInvitation as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Invalid or expired invitation'
      });

      await organizationController.acceptInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should return 400 for weak password', async () => {
      mockRequest.params = { token: 'valid-token' };
      mockRequest.body = { ...validAcceptance, password: 'weak' };

      (organizationService.acceptInvitation as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Password validation failed'
      });

      await organizationController.acceptInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should return 400 for already accepted invitation', async () => {
      mockRequest.params = { token: 'already-accepted-token' };
      mockRequest.body = validAcceptance;

      (organizationService.acceptInvitation as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Invitation has already been accepted'
      });

      await organizationController.acceptInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });
  });

  // ============================================================================
  // Review Access Request Tests
  // ============================================================================
  describe('reviewAccessRequest', () => {
    beforeEach(() => {
      mockRequest.user = { userId: 1, username: 'admin' };
    });

    it('should approve request successfully', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {
        status: 'approved',
        notes: 'Approved after verification',
        temporaryPassword: 'TempP@ss123!'
      };

      (organizationService.reviewAccessRequest as jest.Mock).mockResolvedValue({
        success: true,
        userId: 5
      });

      await organizationController.reviewAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true
      }));
    });

    it('should reject request successfully', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {
        status: 'rejected',
        notes: 'Does not meet requirements'
      };

      (organizationService.reviewAccessRequest as jest.Mock).mockResolvedValue({
        success: true
      });

      await organizationController.reviewAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
    });

    it('should return 400 for invalid status', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {
        status: 'invalid-status'
      };

      await organizationController.reviewAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should return 404 for non-existent request', async () => {
      mockRequest.params = { id: '999' };
      mockRequest.body = { status: 'approved' };

      (organizationService.reviewAccessRequest as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Request not found'
      });

      await organizationController.reviewAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
    });

    it('should require admin authentication', async () => {
      mockRequest.user = undefined;
      mockRequest.params = { id: '1' };
      mockRequest.body = { status: 'approved' };

      await organizationController.reviewAccessRequest(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(401);
    });
  });

  // ============================================================================
  // List Organizations Tests
  // ============================================================================
  describe('listOrganizations', () => {
    beforeEach(() => {
      mockRequest.user = { userId: 1, username: 'admin' };
    });

    it('should return paginated organizations', async () => {
      mockRequest.query = { page: '1', limit: '10' };

      (organizationService.listOrganizations as jest.Mock).mockResolvedValue({
        success: true,
        data: [
          { id: 1, name: 'Org 1', type: 'hospital', status: 'active' },
          { id: 2, name: 'Org 2', type: 'clinic', status: 'pending' }
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1
        }
      });

      await organizationController.listOrganizations(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'Org 1' })
        ]),
        pagination: expect.objectContaining({
          total: 2
        })
      }));
    });

    it('should filter by status', async () => {
      mockRequest.query = { status: 'active' };

      (organizationService.listOrganizations as jest.Mock).mockResolvedValue({
        success: true,
        data: [{ id: 1, name: 'Active Org', status: 'active' }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
      });

      await organizationController.listOrganizations(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(organizationService.listOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' })
      );
    });

    it('should filter by type', async () => {
      mockRequest.query = { type: 'hospital' };

      (organizationService.listOrganizations as jest.Mock).mockResolvedValue({
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }
      });

      await organizationController.listOrganizations(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(organizationService.listOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hospital' })
      );
    });
  });

  // ============================================================================
  // Update Organization Status Tests
  // ============================================================================
  describe('updateOrganizationStatus', () => {
    beforeEach(() => {
      mockRequest.user = { userId: 1, username: 'admin' };
      mockRequest.params = { id: '1' };
    });

    it('should activate organization', async () => {
      mockRequest.body = { status: 'active', notes: 'Approved' };

      (organizationService.updateOrganizationStatus as jest.Mock).mockResolvedValue({
        success: true
      });

      await organizationController.updateOrganizationStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true
      }));
    });

    it('should suspend organization', async () => {
      mockRequest.body = { status: 'suspended', notes: 'Compliance violation' };

      (organizationService.updateOrganizationStatus as jest.Mock).mockResolvedValue({
        success: true
      });

      await organizationController.updateOrganizationStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(200);
    });

    it('should return 400 for invalid status', async () => {
      mockRequest.body = { status: 'invalid' };

      await organizationController.updateOrganizationStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should return 404 for non-existent organization', async () => {
      mockRequest.params = { id: '999' };
      mockRequest.body = { status: 'active' };

      (organizationService.updateOrganizationStatus as jest.Mock).mockResolvedValue({
        success: false,
        message: 'Organization not found'
      });

      await organizationController.updateOrganizationStatus(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(404);
    });
  });

  // ============================================================================
  // Create Invitation Tests
  // ============================================================================
  describe('createInvitation', () => {
    beforeEach(() => {
      mockRequest.user = { userId: 1, username: 'admin' };
      mockRequest.params = { id: '1' };
    });

    it('should create invitation successfully', async () => {
      mockRequest.body = {
        email: 'newuser@test.com',
        role: 'investigator',
        message: 'Welcome to our team!'
      };

      (organizationService.createInvitation as jest.Mock).mockResolvedValue({
        success: true,
        token: 'invitation-token-123',
        invitationId: 1,
        invitationLink: 'https://app.example.com/invite/invitation-token-123'
      });

      await organizationController.createInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(201);
      expect(responseJson).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          token: expect.any(String),
          invitationLink: expect.any(String)
        })
      }));
    });

    it('should reject invitation for existing user', async () => {
      mockRequest.body = {
        email: 'existing@test.com',
        role: 'member'
      };

      (organizationService.createInvitation as jest.Mock).mockResolvedValue({
        success: false,
        message: 'User already registered'
      });

      await organizationController.createInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });

    it('should require email', async () => {
      mockRequest.body = { role: 'member' };

      await organizationController.createInvitation(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(responseStatus).toHaveBeenCalledWith(400);
    });
  });
});

