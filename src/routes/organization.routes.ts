/**
 * Organization Routes
 * 
 * Routes for organization management, invite codes, access requests, and invitations
 */

import express from 'express';
import * as controller from '../controllers/organization.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

// ============================================================================
// Public Routes (no authentication required)
// ============================================================================

// Organization registration (self-service)
router.post('/register', controller.registerOrganization);

// Code validation and registration
router.post('/codes/validate', controller.validateCode);
router.post('/codes/register', controller.registerWithCode);

// Access requests
router.post('/access-requests', controller.createAccessRequest);

// Invitation validation and acceptance
router.get('/invitations/:token/validate', controller.validateInvitation);
router.post('/invitations/:token/accept', controller.acceptInvitation);

// ============================================================================
// Protected Routes (authentication required)
// ============================================================================

router.use(authMiddleware);

// Get current user's organizations
router.get('/my', controller.getMyOrganizations);

// ============================================================================
// Admin Routes (admin or coordinator role required)
// ============================================================================

// List and manage organizations
router.get('/', requireRole('admin'), controller.listOrganizations);
router.get('/:id', requireRole('admin', 'coordinator'), controller.getOrganization);
router.patch('/:id/status', requireRole('admin'), controller.updateStatus);

// Organization codes management
router.post('/:id/codes', requireRole('admin', 'coordinator'), controller.generateCode);
router.get('/:id/codes', requireRole('admin', 'coordinator'), controller.listCodes);
router.patch('/:orgId/codes/:codeId', requireRole('admin', 'coordinator'), controller.deactivateCode);

// Access requests management
router.get('/access-requests', requireRole('admin'), controller.listAccessRequests);
router.patch('/access-requests/:id', requireRole('admin'), controller.reviewAccessRequest);

// User invitations
router.post('/invitations', requireRole('admin', 'coordinator'), controller.createInvitation);

export default router;

