import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
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
/**
 * Role alias map: maps the 6 canonical role names used in requireRole() calls
 * to ALL equivalent LibreClinica role_name values (case-insensitive matching).
 * 
 * Canonical roles: admin, data_manager, investigator, coordinator, monitor, viewer
 * 
 * Legacy LibreClinica role names (director, ra, ra2) are included as aliases
 * so existing study_user_role data still grants correct access.
 */
/**
 * Role alias mapping for requireRole() calls.
 * 
 * 6 canonical roles (sorted by descending privilege):
 *   'admin'        → admin, system_administrator
 *   'data_manager' → data_manager, director, study_coordinator (study management level)
 *   'investigator' → investigator, site_investigator (PI / e-sign authority)
 *   'coordinator'  → coordinator, crc, ra, ra2, data_entry_person (CRC / data entry level)
 *   'monitor'      → monitor, site_monitor (SDV / read-only monitoring)
 *   'viewer'       → viewer, sponsor, read_only
 *
 * IMPORTANT: In the new system, 'coordinator' in the DB = CRC (data entry).
 * Legacy LibreClinica data with 'study_coordinator' or 'director' still maps
 * to data_manager-level access via aliases.
 */
// Study management level: data_manager role + legacy aliases that meant study coordination
// NOTE: bare 'coordinator' is NOT here — in the new system 'coordinator' = CRC (data entry)
const STUDY_MGMT_ROLES = ['data_manager', 'study_coordinator', 'site_study_coordinator', 'director', 'study_director', 'site_study_director'];

// Data entry / CRC level: coordinator role + legacy aliases for data entry personnel
const DATA_ENTRY_ROLES = ['coordinator', 'ra', 'ra2', 'data_entry', 'data_entry_person', 'crc', 'site_data_entry_person', 'site_data_entry_person2', 'user'];

const ROLE_ALIASES: Record<string, string[]> = {
  admin:         ['admin', 'system_administrator'],
  data_manager:  STUDY_MGMT_ROLES,   // Study management: data_manager + legacy study-coordinator aliases
  coordinator:   DATA_ENTRY_ROLES,    // CRC / data entry: coordinator (new canonical) + legacy ra/data_entry aliases
  data_entry:    DATA_ENTRY_ROLES,    // Alias for coordinator (backwards compatibility with old route calls)
  investigator:  ['investigator', 'site_investigator'],
  monitor:       ['monitor', 'site_monitor'],
  viewer:        ['viewer', 'sponsor', 'read_only'],
};

/**
 * Check if a user role matches any of the allowed roles (case-insensitive, with aliases).
 */
function roleMatches(userRole: string, allowedRole: string): boolean {
  const lcUserRole = userRole.toLowerCase();
  const lcAllowed = allowedRole.toLowerCase();

  // Direct match (case-insensitive)
  if (lcUserRole === lcAllowed) return true;

  // Check aliases: does the user's role fall within the allowed role's alias group?
  const aliases = ROLE_ALIASES[lcAllowed];
  if (aliases && aliases.includes(lcUserRole)) return true;

  return false;
}

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
      // Use JWT claims first — avoids 2 DB queries per request for common cases.
      // The token carries userType and role set at login time.
      const userTypeFromToken = (authReq.user.userType || '').toLowerCase();
      const roleFromToken = (authReq.user.role || '').toLowerCase();

      const isSystemAdmin =
        userTypeFromToken.includes('admin') ||
        userTypeFromToken === 'sysadmin';

      // Fast path: admin from token can do anything without a DB round-trip
      if (isSystemAdmin || roleFromToken === 'admin') {
        next();
        return;
      }

      // Fast path: check token role against allowed roles
      const tokenRoleMatches = allowedRoles.some(allowed => roleMatches(roleFromToken, allowed));
      if (tokenRoleMatches) {
        next();
        return;
      }

      // Slow path: fall back to DB for users whose study-level roles may differ
      // from their token role (e.g. coordinators with monitor access on specific studies).
      const roleResult = await pool.query(`
        SELECT DISTINCT role_name
        FROM study_user_role
        WHERE user_name = $1
          AND status_id = 1
      `, [authReq.user.userName]);

      const userRoles = roleResult.rows.map((r: any) => r.role_name);

      const hasPermission =
        userRoles.some((r: string) => r.toLowerCase() === 'admin') ||
        allowedRoles.some(allowed =>
          userRoles.some((userRole: string) => roleMatches(userRole, allowed))
        );

      if (!hasPermission) {
        logger.warn('Insufficient permissions', {
          userId: authReq.user.userId,
          userName: authReq.user.userName,
          roleFromToken,
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
      const result = await pool.query(`
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
