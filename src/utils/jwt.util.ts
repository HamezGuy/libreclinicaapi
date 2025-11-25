/**
 * JWT Utility
 * 
 * JSON Web Token generation and verification
 * - Generate access and refresh tokens
 * - Verify and decode tokens
 * - Token refresh mechanism
 * - Session management
 * 
 * Compliance: 21 CFR Part 11 §11.10(d) - Access Controls
 */

import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config/environment';
import { logger } from '../config/logger';

/**
 * JWT Payload interface
 */
export interface JwtPayload {
  userId: number;
  username: string;
  userName?: string; // Alias for username (for auth middleware compatibility)
  email: string;
  role: string;
  userType?: string; // User type from user_type table (admin, user, sysadmin, etc.)
  studyIds?: number[];
}

/**
 * Token pair interface
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Decoded token interface
 */
export interface DecodedToken extends JwtPayload {
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

/**
 * Generate access token
 * Short-lived token for API access (30 minutes default)
 */
export const generateAccessToken = (payload: JwtPayload): string => {
  const secret = config.jwt.secret;
  const expiresIn = config.jwt.expiresIn || '30m';

  const signOptions: SignOptions = {
    expiresIn: expiresIn as any,
    issuer: 'libreclinica-api',
    audience: 'libreclinica-client'
  };

  const token = jwt.sign(
    {
      ...payload,
      type: 'access'
    },
    secret,
    signOptions
  );

  logger.debug('Access token generated', {
    userId: payload.userId,
    username: payload.username,
    expiresIn
  });

  return token;
};

/**
 * Generate refresh token
 * Long-lived token for refreshing access tokens (7 days default)
 */
export const generateRefreshToken = (payload: JwtPayload): string => {
  const secret = config.jwt.secret;
  const expiresIn = config.jwt.refreshExpiresIn || '7d';

  const signOptions: SignOptions = {
    expiresIn: expiresIn as any,
    issuer: 'libreclinica-api',
    audience: 'libreclinica-client'
  };

  const token = jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      type: 'refresh'
    },
    secret,
    signOptions
  );

  logger.debug('Refresh token generated', {
    userId: payload.userId,
    username: payload.username,
    expiresIn
  });

  return token;
};

/**
 * Generate both access and refresh tokens
 */
export const generateTokenPair = (payload: JwtPayload): TokenPair => {
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // Calculate expiry time in seconds
  const expiresIn = config.part11.sessionTimeoutMinutes * 60; // Convert minutes to seconds

  return {
    accessToken,
    refreshToken,
    expiresIn
  };
};

/**
 * Verify access token
 * Validates token signature and expiration
 */
export const verifyAccessToken = (token: string): DecodedToken | null => {
  try {
    const secret = config.jwt.secret;
    const decoded = jwt.verify(token, secret, {
      issuer: 'libreclinica-api',
      audience: 'libreclinica-client'
    }) as DecodedToken;

    // Verify it's an access token
    if (decoded.type !== 'access') {
      logger.warn('Invalid token type', { type: decoded.type, expected: 'access' });
      return null;
    }

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Access token expired', { expiredAt: error.expiredAt });
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid access token', { error: error.message });
    } else {
      logger.error('Token verification error', { error: error.message });
    }
    return null;
  }
};

/**
 * Verify refresh token
 * Validates refresh token for token refresh operations
 */
export const verifyRefreshToken = (token: string): DecodedToken | null => {
  try {
    const secret = config.jwt.secret;
    const decoded = jwt.verify(token, secret, {
      issuer: 'libreclinica-api',
      audience: 'libreclinica-client'
    }) as DecodedToken;

    // Verify it's a refresh token
    if (decoded.type !== 'refresh') {
      logger.warn('Invalid token type', { type: decoded.type, expected: 'refresh' });
      return null;
    }

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Refresh token expired', { expiredAt: error.expiredAt });
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid refresh token', { error: error.message });
    } else {
      logger.error('Refresh token verification error', { error: error.message });
    }
    return null;
  }
};

/**
 * Decode token without verification
 * Useful for extracting payload without validating signature
 */
export const decodeToken = (token: string): DecodedToken | null => {
  try {
    const decoded = jwt.decode(token) as DecodedToken;
    return decoded;
  } catch (error: any) {
    logger.error('Token decode error', { error: error.message });
    return null;
  }
};

/**
 * Check if token is expired
 * Returns true if token is expired, false otherwise
 */
export const isTokenExpired = (token: string): boolean => {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  return decoded.exp < currentTime;
};

/**
 * Get token expiration time
 * Returns expiration timestamp in seconds
 */
export const getTokenExpiration = (token: string): number | null => {
  const decoded = decodeToken(token);
  return decoded?.exp || null;
};

/**
 * Get time until token expires
 * Returns remaining time in seconds
 */
export const getTokenTimeRemaining = (token: string): number | null => {
  const exp = getTokenExpiration(token);
  if (!exp) {
    return null;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const remaining = exp - currentTime;
  return remaining > 0 ? remaining : 0;
};

/**
 * Refresh access token using refresh token
 * Returns new token pair if refresh token is valid
 */
export const refreshAccessToken = async (
  refreshToken: string,
  getUserData: (userId: number) => Promise<JwtPayload | null>
): Promise<TokenPair | null> => {
  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    logger.warn('Invalid refresh token provided');
    return null;
  }

  try {
    // Get current user data (may have changed since token was issued)
    const userData = await getUserData(decoded.userId);
    if (!userData) {
      logger.warn('User not found for refresh token', { userId: decoded.userId });
      return null;
    }

    // Generate new token pair
    const tokens = generateTokenPair(userData);

    logger.info('Access token refreshed', {
      userId: userData.userId,
      username: userData.username
    });

    return tokens;
  } catch (error: any) {
    logger.error('Token refresh error', { error: error.message, userId: decoded.userId });
    return null;
  }
};

/**
 * Extract token from Authorization header
 * Supports "Bearer <token>" format
 */
export const extractTokenFromHeader = (authHeader?: string): string | null => {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.warn('Invalid authorization header format', { header: authHeader });
    return null;
  }

  return parts[1];
};

/**
 * Create session identifier
 * Used for tracking user sessions
 */
export const createSessionId = (userId: number, username: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${userId}_${username}_${timestamp}_${random}`;
};

/**
 * Validate token payload
 * Ensures all required fields are present
 */
export const validateTokenPayload = (payload: any): payload is JwtPayload => {
  return (
    typeof payload.userId === 'number' &&
    typeof payload.username === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.role === 'string'
  );
};

export default {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
  isTokenExpired,
  getTokenExpiration,
  getTokenTimeRemaining,
  refreshAccessToken,
  extractTokenFromHeader,
  createSessionId,
  validateTokenPayload
};
