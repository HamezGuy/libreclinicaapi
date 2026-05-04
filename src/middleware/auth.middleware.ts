import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/environment';
import { logger } from '../config/logger';
import { isTokenBlocked } from '../services/database/token-blocklist.service';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    userName: string;
    email: string;
    userType: string;
    role: string;      // User's global role (highest across all studies)
    studyIds?: number[];
    organizationIds?: number[];
  };
}

/**
 * JWT Authentication Middleware (21 CFR Part 11 §11.10(d))
 * Verifies JWT token and enforces session timeout
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid authorization header', { 
      path: req.path, 
      ip: req.ip 
    });
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }
  
  const token = authHeader.substring(7);
  
  if (isTokenBlocked(token)) {
    logger.warn('Blocked token used', { path: req.path, ip: req.ip });
    res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_REVOKED',
        message: 'Token has been revoked'
      }
    });
    return;
  }
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    
    // Token expiration is handled by jwt.verify() using the JWT `exp` claim.
    // Inactivity-based session timeout is enforced by the frontend's 20-minute
    // idle timer (IdleTimeoutService). No server-side iat-based age check is
    // needed — it caused a competing timeout that conflicted with the frontend
    // idle system and triggered spurious 401s during background token refreshes.
    
    // Attach user to request (including role for permission checks)
    (req as AuthRequest).user = {
      userId: decoded.userId,
      userName: decoded.userName,
      email: decoded.email,
      userType: decoded.userType,
      role: decoded.role || decoded.userType, // Use role from token, fallback to userType
      studyIds: decoded.studyIds,
      organizationIds: decoded.organizationIds || []
    };
    
    logger.debug('User authenticated', { 
      userId: decoded.userId,
      userName: decoded.userName,
      path: req.path
    });
    
    next();
  } catch (error) {
    logger.warn('Invalid JWT token', { 
      error: (error as Error).message, 
      ip: req.ip,
      path: req.path
    });
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token'
      }
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      (req as AuthRequest).user = {
        userId: decoded.userId,
        userName: decoded.userName,
        email: decoded.email,
        userType: decoded.userType,
        role: decoded.role || decoded.userType,
        studyIds: decoded.studyIds,
        organizationIds: decoded.organizationIds || []
      };
    } catch (error) {
      // Ignore errors for optional auth
    }
  }
  
  next();
};

