/**
 * Organization Controller
 * 
 * Handles HTTP requests for organization management, invite codes, 
 * access requests, and invitations
 */

import { Request, Response } from 'express';
import { logger } from '../config/logger';
import * as organizationService from '../services/database/organization.service';

// ============================================================================
// Organization Endpoints
// ============================================================================

/**
 * POST /api/organizations/register
 * Register a new organization with admin user (public endpoint)
 */
export const registerOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { organizationDetails, adminDetails } = req.body;

    if (!organizationDetails || !adminDetails) {
      res.status(400).json({
        success: false,
        message: 'Organization details and admin details are required'
      });
      return;
    }

    // Map frontend field names to service field names
    const orgData = {
      name: organizationDetails.name,
      type: organizationDetails.type,
      email: organizationDetails.email,
      phone: organizationDetails.phone,
      website: organizationDetails.website,
      street: organizationDetails.street,
      city: organizationDetails.city,
      state: organizationDetails.state,
      postalCode: organizationDetails.postalCode,
      country: organizationDetails.country
    };

    const adminData = {
      firstName: adminDetails.firstName,
      lastName: adminDetails.lastName,
      email: adminDetails.email,
      phone: adminDetails.phone,
      professionalTitle: adminDetails.professionalTitle,
      credentials: adminDetails.credentials,
      password: adminDetails.password
    };

    const result = await organizationService.createOrganizationWithAdmin(orgData, adminData);

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          organizationId: result.organizationId,
          userId: result.userId
        },
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Register organization error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/organizations
 * Get organizations (admin only)
 */
export const listOrganizations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, type, page, limit } = req.query;

    const result = await organizationService.getOrganizations({
      status: status as string,
      type: type as string,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      }
    });
  } catch (error: any) {
    logger.error('List organizations error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/organizations/:id
 * Get organization by ID
 */
export const getOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = parseInt(req.params.id);

    const organization = await organizationService.getOrganizationById(organizationId);

    if (!organization) {
      res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
      return;
    }

    res.json({
      success: true,
      data: organization
    });
  } catch (error: any) {
    logger.error('Get organization error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * PATCH /api/organizations/:id/status
 * Update organization status (approve/reject/suspend)
 */
export const updateStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = parseInt(req.params.id);
    const { status, notes } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!['active', 'suspended', 'inactive'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: active, suspended, or inactive'
      });
      return;
    }

    const result = await organizationService.updateOrganizationStatus(
      organizationId,
      status,
      userId,
      notes
    );

    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Update organization status error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/organizations/my
 * Get current user's organizations
 */
export const getMyOrganizations = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const organizations = await organizationService.getUserOrganizations(userId);

    res.json({
      success: true,
      data: organizations
    });
  } catch (error: any) {
    logger.error('Get my organizations error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// ============================================================================
// Organization Code Endpoints
// ============================================================================

/**
 * POST /api/codes/validate
 * Validate an organization code (public endpoint)
 */
export const validateCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body;

    if (!code) {
      res.status(400).json({
        success: false,
        isValid: false,
        message: 'Code is required'
      });
      return;
    }

    const result = await organizationService.validateOrganizationCode(code);

    res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    logger.error('Validate code error', { error: error.message });
    res.status(500).json({
      success: false,
      isValid: false,
      message: 'Internal server error'
    });
  }
};

/**
 * POST /api/codes/register
 * Register with an organization code (public endpoint)
 */
export const registerWithCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, email, password, firstName, lastName, phone } = req.body;

    if (!code || !email || !password || !firstName || !lastName) {
      res.status(400).json({
        success: false,
        message: 'Code, email, password, firstName, and lastName are required'
      });
      return;
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;

    const result = await organizationService.registerWithCode(
      code,
      { email, password, firstName, lastName, phone },
      ipAddress
    );

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          userId: result.userId,
          organizationId: result.organizationId
        },
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Register with code error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * POST /api/organizations/:id/codes
 * Generate a new organization code
 */
export const generateCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = parseInt(req.params.id);
    const userId = (req as any).user?.userId;
    const { maxUses, expiresAt, defaultRole } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const result = await organizationService.generateOrganizationCode(
      organizationId,
      userId,
      {
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        defaultRole
      }
    );

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          code: result.code,
          codeId: result.codeId
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Generate code error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/organizations/:id/codes
 * List organization codes
 */
export const listCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = parseInt(req.params.id);

    const codes = await organizationService.getOrganizationCodes(organizationId);

    res.json({
      success: true,
      data: codes
    });
  } catch (error: any) {
    logger.error('List codes error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * PATCH /api/organizations/:orgId/codes/:codeId
 * Deactivate a code
 */
export const deactivateCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const codeId = parseInt(req.params.codeId);
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const result = await organizationService.deactivateOrganizationCode(codeId, userId);

    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Deactivate code error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// ============================================================================
// Access Request Endpoints
// ============================================================================

/**
 * POST /api/access-requests
 * Create an access request (public endpoint)
 */
export const createAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      email, firstName, lastName, phone,
      organizationName, professionalTitle, credentials,
      reason, organizationId, requestedRole
    } = req.body;

    if (!email || !firstName || !lastName) {
      res.status(400).json({
        success: false,
        message: 'Email, firstName, and lastName are required'
      });
      return;
    }

    const result = await organizationService.createAccessRequest({
      email, firstName, lastName, phone,
      organizationName, professionalTitle, credentials,
      reason, organizationId, requestedRole
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          requestId: result.requestId
        },
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Create access request error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/access-requests
 * List access requests (admin only)
 */
export const listAccessRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, organizationId, page, limit } = req.query;

    const result = await organizationService.getAccessRequests({
      status: status as string,
      organizationId: organizationId ? parseInt(organizationId as string) : undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      }
    });
  } catch (error: any) {
    logger.error('List access requests error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * PATCH /api/access-requests/:id
 * Review an access request (approve/reject)
 */
export const reviewAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const requestId = parseInt(req.params.id);
    const userId = (req as any).user?.userId;
    const { decision, notes, password } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!['approved', 'rejected'].includes(decision)) {
      res.status(400).json({
        success: false,
        message: 'Decision must be: approved or rejected'
      });
      return;
    }

    const result = await organizationService.reviewAccessRequest(
      requestId,
      userId,
      decision,
      notes,
      password
    );

    if (result.success) {
      res.json({
        success: true,
        data: {
          userId: result.userId
        },
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Review access request error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// ============================================================================
// Invitation Endpoints
// ============================================================================

/**
 * POST /api/invitations
 * Create a user invitation
 */
export const createInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const { email, organizationId, studyId, role, message, expiresInDays } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    const result = await organizationService.createInvitation(email, userId, {
      organizationId,
      studyId,
      role,
      message,
      expiresInDays
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          token: result.token,
          invitationId: result.invitationId,
          // Generate full invitation link
          invitationLink: `/register/invitation/${result.token}`
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Create invitation error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * GET /api/invitations/:token/validate
 * Validate an invitation token (public endpoint)
 */
export const validateInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    const result = await organizationService.validateInvitation(token);

    res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    logger.error('Validate invitation error', { error: error.message });
    res.status(500).json({
      success: false,
      isValid: false,
      message: 'Internal server error'
    });
  }
};

/**
 * POST /api/invitations/:token/accept
 * Accept an invitation and create account (public endpoint)
 */
export const acceptInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { password, firstName, lastName, phone } = req.body;

    if (!password || !firstName || !lastName) {
      res.status(400).json({
        success: false,
        message: 'Password, firstName, and lastName are required'
      });
      return;
    }

    const result = await organizationService.acceptInvitation(token, {
      password,
      firstName,
      lastName,
      phone
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        data: {
          userId: result.userId
        },
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error: any) {
    logger.error('Accept invitation error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export default {
  // Organizations
  registerOrganization,
  listOrganizations,
  getOrganization,
  updateStatus,
  getMyOrganizations,
  // Codes
  validateCode,
  registerWithCode,
  generateCode,
  listCodes,
  deactivateCode,
  // Access Requests
  createAccessRequest,
  listAccessRequests,
  reviewAccessRequest,
  // Invitations
  createInvitation,
  validateInvitation,
  acceptInvitation
};

