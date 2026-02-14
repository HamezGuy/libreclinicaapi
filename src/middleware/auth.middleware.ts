import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/environment';
import { logger } from '../config/logger';

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
  
  const token = authHeader.substring(7); // Remove 'Bearer '
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    
    // Check token expiration (session timeout - §11.300)
    const tokenAge = Date.now() - (decoded.iat * 1000);
    const maxAge = config.part11.sessionTimeoutMinutes * 60 * 1000;
    
    if (tokenAge > maxAge) {
      logger.warn('Token expired (session timeout)', { 
        userId: decoded.userId,
        tokenAge: Math.round(tokenAge / 1000 / 60),
        maxAge: config.part11.sessionTimeoutMinutes
      });
      res.status(401).json({
        success: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session has expired. Please log in again.'
        }
      });
      return;
    }
    
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

