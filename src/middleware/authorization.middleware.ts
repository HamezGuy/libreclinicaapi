import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { logger } from '../config/logger';
import { AuthRequest } from './auth.middleware';

/**
 * Role-based authorization middleware (21 CFR Part 11 §11.10(g))
 * Checks user permissions for the requested operation
 * 
 * LibreClinica User Types:
 * - user_type_id 1: business_admin (has all privileges)
 * - user_type_id 2: tech-admin (has technical privileges)
 * - user_type_id 3: user (standard user)
 */
export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    
    if (!authReq.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }
    
    try {
      // Check if user is a system admin by user_type
      const adminCheckQuery = `
        SELECT ut.user_type
        FROM user_account ua
        JOIN user_type ut ON ua.user_type_id = ut.user_type_id
        WHERE ua.user_id = $1
      `;
      const adminResult = await db.query(adminCheckQuery, [authReq.user.userId]);
      const userTypeFromDb = adminResult.rows[0]?.user_type?.toLowerCase() || '';
      
      // Get user roles from study_user_role
      const roleResult = await db.query(`
        SELECT DISTINCT role_name
        FROM study_user_role
        WHERE user_name = $1
          AND status_id = 1
      `, [authReq.user.userName]);
      
      const userRoles = roleResult.rows.map(r => r.role_name);
      
      // System admin types can do anything
      const isSystemAdmin = 
        userTypeFromDb.includes('admin') ||  // business_admin, tech-admin
        userTypeFromDb === 'sysadmin' ||
        authReq.user?.userType?.toLowerCase()?.includes('admin');
      
      // Check if user has at least one of the allowed roles
      const hasPermission = 
        isSystemAdmin ||
        userRoles.includes('admin') ||
        allowedRoles.some(role => userRoles.includes(role));
      
      if (!hasPermission) {
        logger.warn('Insufficient permissions', {
          userId: authReq.user.userId,
          userName: authReq.user.userName,
          userType: userTypeFromDb,
          userRoles,
          requiredRoles: allowedRoles,
          path: req.path
        });
        
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions for this operation. Required role: ' + allowedRoles.join(' or ')
          }
        });
        return;
      }
      
      logger.debug('Authorization check passed', {
        userId: authReq.user.userId,
        userType: userTypeFromDb,
        userRoles,
        requiredRoles: allowedRoles
      });
      
      next();
    } catch (error) {
      logger.error('Authorization check error', {
        error: (error as Error).message,
        userId: authReq.user.userId
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'Failed to verify permissions'
        }
      });
    }
  };
};

/**
 * Check if user has access to specific study
 */
export const requireStudyAccess = (studyIdParam: string = 'studyId') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    
    if (!authReq.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      });
      return;
    }
    
    const studyId = req.params[studyIdParam] || req.body[studyIdParam] || req.query[studyIdParam];
    
    if (!studyId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Study ID required' }
      });
      return;
    }
    
    try {
      // System admin has access to all studies
      if (authReq.user.userType === 'sysadmin') {
        next();
        return;
      }
      
      // Check if user has access to this study
      const result = await db.query(`
        SELECT COUNT(*) as count
        FROM study_user_role
        WHERE user_name = $1
          AND study_id = $2
          AND status_id = 1
      `, [authReq.user.userName, studyId]);
      
      const hasAccess = parseInt(result.rows[0].count) > 0;
      
      if (!hasAccess) {
        logger.warn('Study access denied', {
          userId: authReq.user.userId,
          studyId,
          path: req.path
        });
        
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'No access to this study' }
        });
        return;
      }
      
      next();
    } catch (error) {
      logger.error('Study access check error', {
        error: (error as Error).message,
        userId: authReq.user.userId,
        studyId
      });
      
      res.status(500).json({
        success: false,
        error: { code: 'ERROR', message: 'Failed to verify study access' }
      });
    }
  };
};

