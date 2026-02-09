/**
 * Organization Controller
 * 
 * Handles organization management, membership, codes, access requests, invitations.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as orgService from '../services/database/organization.service';

// ============================================================================
// Registration (Public)
// ============================================================================

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.registerOrganization(req.body, req.ip);
  res.status(result.success ? 201 : 400).json(result);
});

// ============================================================================
// Organization CRUD (Authenticated)
// ============================================================================

export const getMyOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const result = await orgService.getMyOrganizations(user.userId);
  res.json(result);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.listOrganizations(req.query);
  res.json(result);
});

export const listPublic = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.listPublicOrganizations();
  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.getOrganization(parseInt(req.params.id));
  res.status(result.success ? 200 : 404).json(result);
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { status, notes } = req.body;
  const result = await orgService.updateOrganizationStatus(parseInt(req.params.id), status, user.userId, notes);
  res.json(result);
});

// ============================================================================
// Members
// ============================================================================

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const result = await orgService.addMember(parseInt(req.params.id), req.body, user.userId);
  res.status(result.success ? 201 : 400).json(result);
});

export const getMembers = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.getMembers(parseInt(req.params.id));
  res.json(result);
});

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.body;
  const result = await orgService.updateMemberRole(parseInt(req.params.id), parseInt(req.params.userId), role);
  res.json(result);
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await orgService.removeMember(parseInt(req.params.id), parseInt(req.params.userId), reason || 'Removed by admin');
  res.json(result);
});

// ============================================================================
// Codes
// ============================================================================

export const validateCode = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.body;
  const result = await orgService.validateCode(code);
  res.json(result);
});

export const registerWithCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.registerWithCode(req.body);
  res.status(result.success ? 201 : 400).json(result);
});

export const generateCode = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const result = await orgService.generateCode(parseInt(req.params.id), user.userId, req.body);
  res.json(result);
});

export const listCodes = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.listCodes(parseInt(req.params.id));
  res.json(result);
});

export const deactivateCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.deactivateCode(parseInt(req.params.id), parseInt(req.params.codeId));
  res.json(result);
});

// ============================================================================
// Access Requests
// ============================================================================

export const createAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.createAccessRequest(req.body);
  res.status(result.success ? 201 : 400).json(result);
});

export const listAccessRequests = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.listAccessRequests(req.query);
  res.json(result);
});

export const reviewAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { decision, notes, password } = req.body;
  const result = await orgService.reviewAccessRequest(parseInt(req.params.requestId), decision, user.userId, notes, password);
  res.json(result);
});

// ============================================================================
// Invitations
// ============================================================================

export const createInvitation = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const result = await orgService.createInvitation(req.body, user.userId);
  res.json(result);
});

export const validateInvitation = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.validateInvitation(req.params.token);
  res.json(result);
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.acceptInvitation(req.params.token, req.body);
  res.status(result.success ? 201 : 400).json(result);
});

// ============================================================================
// Role Permissions
// ============================================================================

export const getRolePermissions = asyncHandler(async (req: Request, res: Response) => {
  const result = await orgService.getRolePermissions(parseInt(req.params.id));
  res.json(result);
});

export const updateRolePermissions = asyncHandler(async (req: Request, res: Response) => {
  const { rolePermissions } = req.body;
  const result = await orgService.updateRolePermissions(parseInt(req.params.id), rolePermissions);
  res.json(result);
});

export default {
  register, getMyOrganizations, list, listPublic, get, updateStatus,
  addMember, getMembers, updateMemberRole, removeMember,
  validateCode, registerWithCode, generateCode, listCodes, deactivateCode,
  createAccessRequest, listAccessRequests, reviewAccessRequest,
  createInvitation, validateInvitation, acceptInvitation,
  getRolePermissions, updateRolePermissions
};
