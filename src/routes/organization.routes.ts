/**
 * Organization Routes
 * 
 * Manages organizations, memberships, invite codes, access requests, invitations.
 * Uses acc_organization* custom tables.
 * 
 * IMPORTANT: Route ordering matters! Static paths must come before :id params.
 */

import express from 'express';
import * as controller from '../controllers/organization.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

// ============================================================================
// PUBLIC ROUTES (no auth required)
// ============================================================================

// Organization registration (creates org + admin user)
router.post('/register', controller.register);

// Code validation and registration
router.post('/codes/validate', controller.validateCode);
router.post('/codes/register', controller.registerWithCode);

// Access requests (public submission)
router.post('/access-requests', controller.createAccessRequest);

// Public organization directory (for access request form - returns only name/type of active orgs)
router.get('/public', controller.listPublic);

// Invitation validation and acceptance (public)
router.get('/invitations/:token/validate', controller.validateInvitation);
router.post('/invitations/:token/accept', controller.acceptInvitation);

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

router.use(authMiddleware);

// Current user's organizations
router.get('/my', controller.getMyOrganizations);

// Access requests (admin review) - MUST be before /:id to avoid parameter matching
router.get('/access-requests', requireRole('admin'), controller.listAccessRequests);
router.patch('/access-requests/:requestId', requireRole('admin'), controller.reviewAccessRequest);

// Invitations (create - requires auth) - MUST be before /:id
router.post('/invitations', requireRole('admin', 'coordinator', 'investigator'), controller.createInvitation);

// Organization CRUD
router.get('/', requireRole('admin'), controller.list);
router.get('/:id', controller.get);
router.patch('/:id/status', requireRole('admin'), controller.updateStatus);

// Role permissions
router.get('/:id/role-permissions', controller.getRolePermissions);
router.put('/:id/role-permissions', requireRole('admin', 'investigator'), controller.updateRolePermissions);

// Members
router.post('/:id/members', requireRole('admin', 'investigator'), controller.addMember);
router.get('/:id/members', controller.getMembers);
router.patch('/:id/members/:userId/role', requireRole('admin', 'investigator'), controller.updateMemberRole);
router.delete('/:id/members/:userId', requireRole('admin'), controller.removeMember);

// Codes
router.post('/:id/codes', requireRole('admin', 'coordinator'), controller.generateCode);
router.get('/:id/codes', controller.listCodes);
router.patch('/:id/codes/:codeId', requireRole('admin', 'coordinator'), controller.deactivateCode);

export default router;
