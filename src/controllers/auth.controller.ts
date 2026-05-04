/**
 * Authentication Controller
 * 
 * Handles authentication endpoints
 * - Username/password login
 * - Google OAuth login
 * - Token refresh
 * - Token verification
 * - Capture token generation (WoundScanner)
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as authService from '../services/database/auth.service';
import * as jwtUtil from '../utils/jwt.util';
import { logger } from '../config/logger';
import { config } from '../config/environment';
import jwt from 'jsonwebtoken';
import type { ApiResponse, LoginResponse, UserProfile } from '@accura-trial/shared-types';
import { blockToken, getActiveSession, registerSession, clearSession } from '../services/database/token-blocklist.service';

/**
 * Login with username/password
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ipAddress = req.ip || 'unknown';

  const result = await authService.authenticateUser(username, password, ipAddress);

  if (!result.success || !result.data) {
    const body: ApiResponse<never> = {
      success: false,
      message: result.message || 'Authentication failed'
    };
    res.status(401).json(body);
    return;
  }

  const jwtPayload = await authService.buildJwtPayload(result.data);
  const tokens = jwtUtil.generateTokenPair(jwtPayload);
  const customPermissions = await authService.fetchCustomPermissions(result.data.userId);

  const existingSession = getActiveSession(result.data.userId);
  if (existingSession) {
    const decoded = jwt.decode(existingSession.token);
    const exp = decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
      ? decoded.exp * 1000
      : Date.now();
    blockToken(existingSession.token, exp);
  }
  registerSession(result.data.userId, tokens.accessToken, ipAddress);

  const body: LoginResponse & { organizations: { organizationId: string; organizationName: string; role: string }[] } = {
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      userId: result.data.userId,
      username: result.data.userName,
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      email: result.data.email,
      role: jwtPayload.role,
      studyIds: jwtPayload.studyIds,
      organizationIds: jwtPayload.organizationIds || [],
      customPermissions
    },
    organizations: (jwtPayload.organizationDetails || []).map(o => ({
      organizationId: String(o.organizationId),
      organizationName: o.organizationName,
      role: o.role
    }))
  };

  res.json(body);
});

/**
 * Login with Google OAuth
 */
export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const { idToken } = req.body;
  const ipAddress = req.ip || 'unknown';

  const result = await authService.authenticateWithGoogle(idToken, ipAddress);

  if (!result.success || !result.data) {
    const body: ApiResponse<never> = {
      success: false,
      message: result.message || 'Google authentication failed'
    };
    res.status(401).json(body);
    return;
  }

  const jwtPayload = await authService.buildJwtPayload(result.data);
  const tokens = jwtUtil.generateTokenPair(jwtPayload);
  const customPermissions = await authService.fetchCustomPermissions(result.data.userId);

  const existingSession = getActiveSession(result.data.userId);
  if (existingSession) {
    const decoded = jwt.decode(existingSession.token);
    const exp = decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
      ? decoded.exp * 1000
      : Date.now();
    blockToken(existingSession.token, exp);
  }
  registerSession(result.data.userId, tokens.accessToken, ipAddress);

  const body: LoginResponse & { organizations: { organizationId: string; organizationName: string; role: string }[] } = {
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      userId: result.data.userId,
      username: result.data.userName,
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      email: result.data.email,
      role: jwtPayload.role,
      studyIds: jwtPayload.studyIds,
      organizationIds: jwtPayload.organizationIds || [],
      customPermissions
    },
    organizations: (jwtPayload.organizationDetails || []).map(o => ({
      organizationId: String(o.organizationId),
      organizationName: o.organizationName,
      role: o.role
    }))
  };

  res.json(body);
});

/**
 * Refresh access token
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  const getUserData = async (userId: number) => {
    const user = await authService.getUserById(userId);
    if (!user) return null;
    return await authService.buildJwtPayload(user);
  };

  const tokens = await jwtUtil.refreshAccessToken(refreshToken, getUserData);

  if (!tokens) {
    const body: ApiResponse<never> = {
      success: false,
      message: 'Invalid refresh token'
    };
    res.status(401).json(body);
    return;
  }

  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn
  } as ApiResponse<unknown> & { accessToken: string; refreshToken: string; expiresIn: number });
});

/**
 * Verify current token
 */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    const body: ApiResponse<never> = {
      success: false,
      message: 'Authentication required'
    };
    res.status(401).json(body);
    return;
  }

  const body: ApiResponse<{ userId: number; username: string; email: string; userType: string; organizationIds: number[] }> = {
    success: true,
    data: {
      userId: user.userId,
      username: user.userName || user.username,
      email: user.email,
      userType: user.userType,
      organizationIds: user.organizationIds || []
    }
  };

  res.json(body);
});

/**
 * Logout - Record logout in audit trail
 * 21 CFR Part 11 §11.10(e) - Audit Trail compliance
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const ipAddress = req.ip || 'unknown';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);
    const exp = decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
      ? decoded.exp * 1000
      : Date.now();
    blockToken(token, exp);
  }

  const username = user?.userName || user?.username;
  if (user?.userId && username) {
    clearSession(user.userId);
    await authService.logUserLogout(user.userId, username, ipAddress);
  }

  logger.info('User logged out', { userId: user?.userId, username });

  const body: ApiResponse<null> = {
    success: true,
    message: 'Logged out successfully'
  };
  res.json(body);
});

// ============================================================================
// CAPTURE TOKEN (WoundScanner iOS App)
// ============================================================================

interface CaptureTokenResponse {
  token: string;
  expiresAt: string;
  universalLink: string;
}

interface CaptureTokenValidation {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    permissions: string[];
    siteId: string | null;
    studyId: string;
  };
  context?: {
    patientId: string;
    patientInitials: string;
    templateId: string;
    templateName: string;
    studyId: string;
    studyEventId: string;
    siteId: string | null;
  };
  expiresAt?: string;
  error?: string;
}

/**
 * Generate a capture token for WoundScanner iOS app
 * POST /api/auth/capture-token
 */
export const generateCaptureToken = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  if (!user) {
    const body: ApiResponse<never> = { success: false, message: 'Unauthorized' };
    res.status(401).json(body);
    return;
  }

  const { 
    patient_id, patientId, 
    template_id, templateId, 
    study_id, studyId,
    study_event_id, studyEventId,
    expires_in, expiresIn 
  } = req.body;

  const finalPatientId = patient_id || patientId;
  const finalTemplateId = template_id || templateId;
  const finalStudyId = study_id || studyId;
  const finalStudyEventId = study_event_id || studyEventId;
  const expiresInValue = expires_in || expiresIn || '15m';

  if (!finalPatientId || !finalTemplateId) {
    const body: ApiResponse<never> = {
      success: false,
      message: 'patientId and templateId are required'
    };
    res.status(400).json(body);
    return;
  }

  let expirationSeconds = 900;
  if (expiresInValue.endsWith('m')) {
    expirationSeconds = parseInt(expiresInValue) * 60;
  } else if (expiresInValue.endsWith('h')) {
    expirationSeconds = parseInt(expiresInValue) * 3600;
  }

  const capturePayload = {
    type: 'capture',
    userId: user.userId,
    userName: user.userName || user.username,
    userEmail: user.email,
    userRole: user.userType || 'clinical_staff',
    patientId: finalPatientId,
    templateId: finalTemplateId,
    studyId: finalStudyId,
    studyEventId: finalStudyEventId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expirationSeconds
  };

  const captureToken = jwt.sign(capturePayload, config.jwt.secret);
  const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

  const appDomain = config.woundScanner?.appDomain || 'yourapp.com';
  const universalLinkParams = new URLSearchParams({
    token: captureToken,
    patientId: finalPatientId,
    templateId: finalTemplateId
  });
  if (finalStudyId) universalLinkParams.set('studyId', finalStudyId);
  if (finalStudyEventId) universalLinkParams.set('studyEventId', finalStudyEventId);
  
  const universalLink = `https://${appDomain}/app/capture?${universalLinkParams.toString()}`;

  logger.info('Generated capture token', {
    userId: user.userId,
    patientId: finalPatientId,
    templateId: finalTemplateId,
    expiresAt
  });

  res.json({
    success: true,
    token: captureToken,
    expiresAt: expiresAt.toISOString(),
    universalLink
  } satisfies ApiResponse<unknown> & CaptureTokenResponse);
});

/**
 * Validate a capture token from WoundScanner iOS app
 * POST /api/auth/validate-token
 */
export const validateCaptureToken = asyncHandler(async (req: Request, res: Response) => {
  const { token, device_id, deviceId, device_info, deviceInfo } = req.body;

  const finalDeviceId = device_id || deviceId;
  const finalDeviceInfo = device_info || deviceInfo || {};

  if (!token) {
    const body: CaptureTokenValidation = { valid: false, error: 'Token is required' };
    res.status(400).json(body);
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;

    if (decoded.type !== 'capture') {
      const body: CaptureTokenValidation = { valid: false, error: 'Invalid token type' };
      res.status(401).json(body);
      return;
    }

    if (finalDeviceId) {
      await authService.registerDevice(
        finalDeviceId,
        {
          model: finalDeviceInfo.model || undefined,
          osVersion: finalDeviceInfo.osVersion || finalDeviceInfo.os_version || undefined,
          appVersion: finalDeviceInfo.appVersion || finalDeviceInfo.app_version || undefined
        },
        decoded.userId?.toString() || null
      );
    }

    const patientInitials = await authService.getPatientInitials(parseInt(decoded.patientId));
    const templateName = await authService.getTemplateName(decoded.templateId);

    logger.info('Validated capture token', {
      userId: decoded.userId,
      patientId: decoded.patientId,
      deviceId: finalDeviceId
    });

    const body: CaptureTokenValidation = {
      valid: true,
      user: {
        id: decoded.userId?.toString(),
        email: decoded.userEmail,
        fullName: decoded.userName,
        role: decoded.userRole,
        permissions: ['wound_capture', 'wound_submit'],
        siteId: null,
        studyId: decoded.studyId
      },
      context: {
        patientId: decoded.patientId,
        patientInitials,
        templateId: decoded.templateId,
        templateName,
        studyId: decoded.studyId,
        studyEventId: decoded.studyEventId,
        siteId: null
      },
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    };
    res.json(body);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn('Invalid capture token', { error: err.message });
    
    if (err.name === 'TokenExpiredError') {
      const body: CaptureTokenValidation = { valid: false, error: 'Token has expired' };
      res.status(401).json(body);
    } else {
      const body: CaptureTokenValidation = { valid: false, error: 'Invalid token' };
      res.status(401).json(body);
    }
  }
});

/**
 * Get current user's profile
 * GET /api/auth/profile
 */
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    const body: ApiResponse<never> = { success: false, message: 'Authentication required' };
    res.status(401).json(body);
    return;
  }

  const profile = await authService.getProfile(user.userId);

  if (!profile) {
    const body: ApiResponse<never> = { success: false, message: 'User not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<UserProfile & { secondaryRole: string; userTypeId: number; isActive: boolean; createdAt: Date | string | null; updatedAt: Date | string | null }> = {
    success: true,
    data: {
      userId: profile.userId,
      userName: profile.userName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      institutionalAffiliation: profile.institutionalAffiliation,
      role: profile.role,
      secondaryRole: profile.secondaryRole,
      userTypeId: profile.userTypeId,
      timeZone: profile.timeZone,
      enabled: profile.isActive,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    }
  };

  res.json(body);
});

/**
 * Update current user's profile (self-service)
 * PUT /api/auth/profile
 * 
 * Users can update their own: firstName, lastName, email, phone, institutionalAffiliation, timeZone
 * They CANNOT change: role, status
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    const body: ApiResponse<never> = { success: false, message: 'Authentication required' };
    res.status(401).json(body);
    return;
  }

  const { firstName, lastName, email, phone, institutionalAffiliation, timeZone, secondaryRole, username } = req.body;

  if (!firstName && !lastName && !email && !phone && institutionalAffiliation === undefined && !timeZone && secondaryRole === undefined && !username) {
    const body: ApiResponse<never> = { success: false, message: 'At least one field to update is required' };
    res.status(400).json(body);
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const body: ApiResponse<never> = { success: false, message: 'Invalid email format' };
    res.status(400).json(body);
    return;
  }

  if (username !== undefined) {
    if (typeof username !== 'string' || username.length < 3 || username.length > 50) {
      const body: ApiResponse<never> = { success: false, message: 'Username must be between 3 and 50 characters' };
      res.status(400).json(body);
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      const body: ApiResponse<never> = { success: false, message: 'Username can only contain letters, numbers, dots, hyphens, and underscores' };
      res.status(400).json(body);
      return;
    }
  }

  try {
    const updated = await authService.updateProfile(user.userId, {
      firstName, lastName, username, email, phone,
      institutionalAffiliation, timeZone, secondaryRole
    });

    if (!updated) {
      const body: ApiResponse<never> = { success: false, message: 'User not found' };
      res.status(404).json(body);
      return;
    }

    logger.info('Profile updated', { userId: user.userId, fields: Object.keys(req.body) });

    const body: ApiResponse<typeof updated> = {
      success: true,
      message: 'Profile updated successfully',
      data: updated
    };
    res.json(body);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message === 'Username is already taken' || err.message === 'Email is already in use by another user') {
      const body: ApiResponse<never> = { success: false, message: err.message };
      res.status(400).json(body);
      return;
    }
    logger.error('Profile update error', { error: err.message, userId: user.userId });
    const body: ApiResponse<never> = { success: false, message: 'Failed to update profile' };
    res.status(500).json(body);
  }
});

/**
 * Change password (self-service)
 * POST /api/auth/change-password
 *
 * 21 CFR Part 11 §11.300 - Password Controls
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    const body: ApiResponse<never> = { success: false, message: 'Authentication required' };
    res.status(401).json(body);
    return;
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    const body: ApiResponse<never> = { success: false, message: 'Current password and new password are required' };
    res.status(400).json(body);
    return;
  }

  if (newPassword.length < 8) {
    const body: ApiResponse<never> = { success: false, message: 'New password must be at least 8 characters' };
    res.status(400).json(body);
    return;
  }

  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    const body: ApiResponse<never> = {
      success: false,
      message: 'New password must contain at least one uppercase letter, one lowercase letter, and one number'
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await authService.changePassword(user.userId, currentPassword, newPassword);

    if (!result.success) {
      const statusCode = result.message === 'User not found' ? 404 : 400;
      const body: ApiResponse<never> = { success: false, message: result.message };
      res.status(statusCode).json(body);
      return;
    }

    logger.info('Password changed', { userId: user.userId });

    const body: ApiResponse<null> = { success: true, message: result.message };
    res.json(body);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Password change error', { error: err.message, userId: user.userId });
    const body: ApiResponse<never> = { success: false, message: 'Failed to change password' };
    res.status(500).json(body);
  }
});

export default {
  login,
  googleLogin,
  refresh,
  verify,
  logout,
  generateCaptureToken,
  validateCaptureToken,
  getProfile,
  updateProfile,
  changePassword
};
