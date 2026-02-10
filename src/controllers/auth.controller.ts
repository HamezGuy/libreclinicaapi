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

/**
 * Login with username/password
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ipAddress = req.ip || 'unknown';

  const result = await authService.authenticateUser(username, password, ipAddress);

  if (!result.success || !result.data) {
    res.status(401).json({
      success: false,
      message: result.message || 'Authentication failed'
    });
    return;
  }

  // Generate JWT tokens
  const jwtPayload = await authService.buildJwtPayload(result.data);
  const tokens = jwtUtil.generateTokenPair(jwtPayload);

  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      userId: result.data.user_id,
      username: result.data.user_name,
      firstName: result.data.first_name,
      lastName: result.data.last_name,
      email: result.data.email,
      role: jwtPayload.role,
      studyIds: jwtPayload.studyIds,
      organizationIds: jwtPayload.organizationIds || []
    },
    organizations: (jwtPayload.organizationDetails || []).map(o => ({
      organizationId: String(o.organizationId),
      organizationName: o.organizationName,
      role: o.role
    }))
  });
});

/**
 * Login with Google OAuth
 */
export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const { idToken } = req.body;
  const ipAddress = req.ip || 'unknown';

  const result = await authService.authenticateWithGoogle(idToken, ipAddress);

  if (!result.success || !result.data) {
    res.status(401).json({
      success: false,
      message: result.message || 'Google authentication failed'
    });
    return;
  }

  const jwtPayload = await authService.buildJwtPayload(result.data);
  const tokens = jwtUtil.generateTokenPair(jwtPayload);

  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      userId: result.data.user_id,
      username: result.data.user_name,
      firstName: result.data.first_name,
      lastName: result.data.last_name,
      email: result.data.email,
      role: jwtPayload.role,
      studyIds: jwtPayload.studyIds,
      organizationIds: jwtPayload.organizationIds || []
    },
    organizations: (jwtPayload.organizationDetails || []).map(o => ({
      organizationId: String(o.organizationId),
      organizationName: o.organizationName,
      role: o.role
    }))
  });
});

/**
 * Refresh access token
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  const getUserData = async (userId: number) => {
    const query = `SELECT * FROM user_account WHERE user_id = $1`;
    const { pool } = await import('../config/database');
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) return null;
    
    return await authService.buildJwtPayload(result.rows[0]);
  };

  const tokens = await jwtUtil.refreshAccessToken(refreshToken, getUserData);

  if (!tokens) {
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
    return;
  }

  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn
  });
});

/**
 * Verify current token
 */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  res.json({
    success: true,
    user: {
      userId: user.userId,
      username: user.userName || user.username,
      email: user.email,
      userType: user.userType,
      organizationIds: user.organizationIds || []
    }
  });
});

/**
 * Logout - Record logout in audit trail
 * 21 CFR Part 11 §11.10(e) - Audit Trail compliance
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const ipAddress = req.ip || 'unknown';

  // Record logout in audit trail
  // Note: JWT payload uses userName (not username)
  const username = user?.userName || user?.username;
  if (user?.userId && username) {
    await authService.logUserLogout(user.userId, username, ipAddress);
  }

  logger.info('User logged out', { userId: user?.userId, username });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ============================================================================
// CAPTURE TOKEN (WoundScanner iOS App)
// ============================================================================

/**
 * Generate a capture token for WoundScanner iOS app
 * POST /api/auth/capture-token
 * 
 * This creates a short-lived token that includes patient/template context
 * for the iOS app to use during wound capture.
 */
export const generateCaptureToken = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { 
    patient_id, patientId, 
    template_id, templateId, 
    study_id, studyId,
    study_event_id, studyEventId,
    expires_in, expiresIn 
  } = req.body;

  // Support both snake_case and camelCase
  const finalPatientId = patient_id || patientId;
  const finalTemplateId = template_id || templateId;
  const finalStudyId = study_id || studyId;
  const finalStudyEventId = study_event_id || studyEventId;
  const expiresInValue = expires_in || expiresIn || '15m';

  if (!finalPatientId || !finalTemplateId) {
    res.status(400).json({
      success: false,
      message: 'patient_id and template_id are required'
    });
    return;
  }

  // Parse expiration time
  let expirationSeconds = 900; // 15 minutes default
  if (expiresInValue.endsWith('m')) {
    expirationSeconds = parseInt(expiresInValue) * 60;
  } else if (expiresInValue.endsWith('h')) {
    expirationSeconds = parseInt(expiresInValue) * 3600;
  }

  // Create capture token payload
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

  // Sign the token
  const captureToken = jwt.sign(capturePayload, config.jwt.secret);
  const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

  // Build Universal Link
  const appDomain = config.woundScanner?.appDomain || 'yourapp.com';
  const universalLinkParams = new URLSearchParams({
    token: captureToken,
    patient_id: finalPatientId,
    template_id: finalTemplateId
  });
  if (finalStudyId) universalLinkParams.set('study_id', finalStudyId);
  if (finalStudyEventId) universalLinkParams.set('study_event_id', finalStudyEventId);
  
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
    expires_at: expiresAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    universal_link: universalLink,
    universalLink
  });
});

/**
 * Validate a capture token from WoundScanner iOS app
 * POST /api/auth/validate-token
 * 
 * Called by iOS app when it receives a deep link with a token.
 * Validates the token and returns user/patient context.
 */
export const validateCaptureToken = asyncHandler(async (req: Request, res: Response) => {
  const { token, device_id, deviceId, device_info, deviceInfo } = req.body;

  const finalDeviceId = device_id || deviceId;
  const finalDeviceInfo = device_info || deviceInfo || {};

  if (!token) {
    res.status(400).json({
      valid: false,
      error: 'Token is required'
    });
    return;
  }

  try {
    // Verify and decode token
    const decoded = jwt.verify(token, config.jwt.secret) as any;

    // Check token type
    if (decoded.type !== 'capture') {
      res.status(401).json({
        valid: false,
        error: 'Invalid token type'
      });
      return;
    }

    // Register/update device if deviceId provided
    if (finalDeviceId) {
      try {
        const { pool } = await import('../config/database');
        await pool.query(`
          INSERT INTO devices (id, device_id, model, os_version, app_version, user_id, first_seen_at, last_seen_at, is_active, created_at, updated_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW(), true, NOW(), NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            model = COALESCE($2, devices.model),
            os_version = COALESCE($3, devices.os_version),
            app_version = COALESCE($4, devices.app_version),
            user_id = $5,
            last_seen_at = NOW(),
            updated_at = NOW()
        `, [
          finalDeviceId,
          finalDeviceInfo.model || null,
          finalDeviceInfo.os_version || finalDeviceInfo.osVersion || null,
          finalDeviceInfo.app_version || finalDeviceInfo.appVersion || null,
          decoded.userId?.toString() || null
        ]);
      } catch (dbError: any) {
        logger.warn('Failed to register device', { error: dbError.message, deviceId: finalDeviceId });
      }
    }

    // Get patient info for context
    let patientInitials = '';
    try {
      const { pool } = await import('../config/database');
      const patientResult = await pool.query(
        'SELECT label FROM study_subject WHERE study_subject_id = $1',
        [parseInt(decoded.patientId)]
      );
      if (patientResult.rows.length > 0) {
        const label = patientResult.rows[0].label || '';
        patientInitials = label.substring(0, 2).toUpperCase();
      }
    } catch (dbError: any) {
      logger.warn('Failed to get patient info', { error: dbError.message });
    }

    // Get template info
    let templateName = decoded.templateId;
    try {
      const { pool } = await import('../config/database');
      const templateResult = await pool.query(
        "SELECT name FROM crf WHERE oc_oid = $1 OR name LIKE $2 LIMIT 1",
        [decoded.templateId, `%${decoded.templateId}%`]
      );
      if (templateResult.rows.length > 0) {
        templateName = templateResult.rows[0].name;
      }
    } catch (dbError: any) {
      logger.warn('Failed to get template info', { error: dbError.message });
    }

    logger.info('Validated capture token', {
      userId: decoded.userId,
      patientId: decoded.patientId,
      deviceId: finalDeviceId
    });

    res.json({
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
      expires_at: new Date(decoded.exp * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    });
  } catch (error: any) {
    logger.warn('Invalid capture token', { error: error.message });
    
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        valid: false,
        error: 'Token has expired'
      });
    } else {
      res.status(401).json({
        valid: false,
        error: 'Invalid token'
      });
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
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  // Get full profile from database
  const { pool } = await import('../config/database');
  const result = await pool.query(`
    SELECT 
      user_id,
      user_name,
      first_name,
      last_name,
      email,
      phone,
      institutional_affiliation,
      status_id,
      user_type_id,
      time_zone,
      date_created,
      date_updated
    FROM user_account 
    WHERE user_id = $1
  `, [user.userId]);

  if (result.rows.length === 0) {
    res.status(404).json({
      success: false,
      message: 'User not found'
    });
    return;
  }

  const dbUser = result.rows[0];
  
  // Get user type name
  const typeResult = await pool.query(
    'SELECT name FROM user_type WHERE user_type_id = $1',
    [dbUser.user_type_id]
  );
  const userTypeName = typeResult.rows.length > 0 ? typeResult.rows[0].name : 'unknown';

  res.json({
    success: true,
    data: {
      userId: dbUser.user_id,
      username: dbUser.user_name,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      email: dbUser.email,
      phone: dbUser.phone || '',
      institutionalAffiliation: dbUser.institutional_affiliation || '',
      role: userTypeName,
      timeZone: dbUser.time_zone || 'America/New_York',
      isActive: dbUser.status_id === 1,
      createdAt: dbUser.date_created,
      updatedAt: dbUser.date_updated
    }
  });
});

/**
 * Update current user's profile (self-service)
 * PUT /api/auth/profile
 * 
 * Users can update their own: firstName, lastName, email, phone, institutionalAffiliation, timeZone
 * They CANNOT change: username, role, status
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const ipAddress = req.ip || 'unknown';

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  const { firstName, lastName, email, phone, institutionalAffiliation, timeZone } = req.body;

  // Validate at least one field is provided
  if (!firstName && !lastName && !email && !phone && institutionalAffiliation === undefined && !timeZone) {
    res.status(400).json({
      success: false,
      message: 'At least one field to update is required'
    });
    return;
  }

  // Validate email format if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
    return;
  }

  const { pool } = await import('../config/database');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (firstName !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      params.push(firstName);
    }

    if (lastName !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      params.push(lastName);
    }

    if (email !== undefined) {
      // Check if email is already used by another user
      const emailCheck = await client.query(
        'SELECT user_id FROM user_account WHERE email = $1 AND user_id != $2',
        [email, user.userId]
      );
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(400).json({
          success: false,
          message: 'Email is already in use by another user'
        });
        return;
      }
      updates.push(`email = $${paramIndex++}`);
      params.push(email);
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      params.push(phone);
    }

    if (institutionalAffiliation !== undefined) {
      updates.push(`institutional_affiliation = $${paramIndex++}`);
      params.push(institutionalAffiliation);
    }

    if (timeZone !== undefined) {
      updates.push(`time_zone = $${paramIndex++}`);
      params.push(timeZone);
    }

    updates.push(`date_updated = NOW()`);

    params.push(user.userId);
    const updateQuery = `
      UPDATE user_account 
      SET ${updates.join(', ')}
      WHERE user_id = $${paramIndex}
      RETURNING user_id, user_name, first_name, last_name, email, phone, institutional_affiliation, time_zone
    `;

    const result = await client.query(updateQuery, params);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Create audit log entry
    await client.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id,
        audit_date,
        entity_id,
        entity_name,
        user_account_id,
        audit_table,
        reason_for_change,
        old_value,
        new_value,
        details
      ) VALUES (
        44, NOW(), $1, 'Profile Updated', $2, 'user_account', 
        'User updated their profile', '', $3, $4
      )
    `, [
      user.userId,
      user.userId,
      JSON.stringify(result.rows[0]),
      `Profile updated from ${ipAddress}`
    ]);

    await client.query('COMMIT');

    const updatedUser = result.rows[0];
    
    logger.info('Profile updated', { userId: user.userId, fields: Object.keys(req.body) });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        userId: updatedUser.user_id,
        username: updatedUser.user_name,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        email: updatedUser.email,
        phone: updatedUser.phone || '',
        institutionalAffiliation: updatedUser.institutional_affiliation || '',
        timeZone: updatedUser.time_zone || 'America/New_York'
      }
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Profile update error', { error: error.message, userId: user.userId });
    
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  } finally {
    client.release();
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
  updateProfile
};

