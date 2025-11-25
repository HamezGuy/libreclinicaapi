/**
 * Authentication Controller
 * 
 * Handles authentication endpoints
 * - Username/password login
 * - Google OAuth login
 * - Token refresh
 * - Token verification
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as authService from '../services/database/auth.service';
import * as jwtUtil from '../utils/jwt.util';
import { logger } from '../config/logger';

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
      studyIds: jwtPayload.studyIds
    }
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
      studyIds: jwtPayload.studyIds
    }
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
      userType: user.userType
    }
  });
});

/**
 * Logout (client-side token invalidation)
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  logger.info('User logged out', { userId: user?.userId, username: user?.username });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

export default {
  login,
  googleLogin,
  refresh,
  verify,
  logout
};

