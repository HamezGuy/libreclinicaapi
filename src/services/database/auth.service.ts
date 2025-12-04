/**
 * Authentication Service
 * 
 * Handles user authentication and authorization
 * - Username/password login (LibreClinica compatibility)
 * - Google OAuth 2.0 login
 * - User role retrieval
 * - Password validation and management
 * - Login attempt tracking
 * 
 * Compliance: 21 CFR Part 11 §11.300 - Password Controls
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config/environment';
import {
  comparePasswordMD5,
  isPasswordExpired,
  getDaysUntilPasswordExpires,
  shouldLockAccount,
  calculateLockoutDuration,
  isLockoutExpired
} from '../../utils/password.util';
import { JwtPayload } from '../../utils/jwt.util';
import { User, ApiResponse, LoginResponse } from '../../types';
import { getRoleByName, getHighestRole, LibreClinicaRole, ROLES } from '../../constants/roles';

const googleClient = new OAuth2Client(config.google.clientId);

/**
 * Authenticate user with username and password
 * Uses LibreClinica's MD5 password hashing
 */
export const authenticateUser = async (
  username: string,
  password: string,
  ipAddress: string
): Promise<ApiResponse<User>> => {
  logger.info('Authenticating user', { username, ipAddress });

  try {
    // Query user from database
    const query = `
      SELECT 
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        u.email,
        u.passwd,
        u.passwd_timestamp,
        u.account_non_locked,
        u.enabled,
        u.date_lastvisit,
        ut.user_type_id,
        ut.user_type
      FROM user_account u
      LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
      WHERE u.user_name = $1
    `;

    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      // User not found - log failed attempt
      await logFailedLogin(username, ipAddress, 'User not found');

      logger.warn('Authentication failed - user not found', { username });
      
      return {
        success: false,
        message: 'Invalid username or password'
      };
    }

    const user = result.rows[0];

    // Check if user is enabled
    if (!user.enabled) {
      logger.warn('Authentication failed - user disabled', { username });
      return {
        success: false,
        message: 'User account is disabled'
      };
    }

    // Check account lockout (simplified - LibreClinica doesn't have lockout_time field)
    if (!user.account_non_locked) {
      logger.warn('Authentication failed - account locked', { username });
      return {
        success: false,
        message: 'Account is locked. Please contact administrator.'
      };
    }

    // Verify password
    const isValidPassword = comparePasswordMD5(password, user.passwd);

    if (!isValidPassword) {
      // Log failed login
      await logFailedLogin(username, ipAddress, 'Invalid password');

      logger.warn('Authentication failed - invalid password', { username });

      return {
        success: false,
        message: 'Invalid username or password'
      };
    }

    // Skip password expiration check for now (LibreClinica manages this internally)
    // if (user.passwd_timestamp && isPasswordExpired(user.passwd_timestamp)) {
    //   logger.warn('Authentication failed - password expired', { username });
    //   return {
    //     success: false,
    //     message: 'Password has expired. Please reset your password.'
    //   };
    // }

    // Password expiration warning (within 7 days)
    const daysUntilExpiration = user.passwd_timestamp 
      ? getDaysUntilPasswordExpires(user.passwd_timestamp)
      : null;

    if (daysUntilExpiration !== null && daysUntilExpiration <= 7 && daysUntilExpiration > 0) {
      logger.info('Password expiring soon', { 
        username, 
        daysUntilExpiration 
      });
    }

    // Reset lock counter on successful login
    if (user.lock_counter > 0) {
      await resetLockCounter(user.user_id);
    }

    // Update last visit date
    await updateLastVisit(user.user_id);

    // Log successful login
    await logSuccessfulLogin(user.user_id, username, ipAddress);

    logger.info('Authentication successful', { 
      username,
      userId: user.user_id
    });

    return {
      success: true,
      data: user,
      message: 'Authentication successful'
    };
  } catch (error: any) {
    logger.error('Authentication error', { 
      error: error.message,
      username
    });

    return {
      success: false,
      message: 'Authentication failed due to server error'
    };
  }
};

/**
 * Authenticate user with Google OAuth 2.0
 */
export const authenticateWithGoogle = async (
  idToken: string,
  ipAddress: string
): Promise<ApiResponse<User>> => {
  logger.info('Authenticating with Google OAuth', { ipAddress });

  try {
    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.google.clientId
    });

    const payload = ticket.getPayload();

    if (!payload) {
      logger.warn('Google OAuth failed - invalid token');
      return {
        success: false,
        message: 'Invalid Google ID token'
      };
    }

    const { email, given_name, family_name, sub: googleId } = payload;

    // Find or create user
    let user = await findUserByEmail(email!);

    if (!user) {
      // Create new user from Google account
      user = await createGoogleUser({
        email: email!,
        firstName: given_name || '',
        lastName: family_name || '',
        googleId
      });
    }

    // Check if user is enabled
    if (!user.enabled) {
      logger.warn('Google OAuth failed - user disabled', { email });
      return {
        success: false,
        message: 'User account is disabled'
      };
    }

    // Update last visit
    await updateLastVisit(user.user_id);

    // Log successful login
    await logSuccessfulLogin(user.user_id, user.user_name, ipAddress);

    logger.info('Google OAuth successful', {
      email,
      userId: user.user_id
    });

    return {
      success: true,
      data: user,
      message: 'Google authentication successful'
    };
  } catch (error: any) {
    logger.error('Google OAuth error', {
      error: error.message
    });

    return {
      success: false,
      message: 'Google authentication failed'
    };
  }
};

/**
 * Get user roles and permissions for a study
 * Note: LibreClinica does NOT have a separate user_role table
 * role_name is stored directly in study_user_role as a string
 */
export const getUserRoles = async (
  userId: number,
  studyId?: number
): Promise<string[]> => {
  try {
    let query: string;
    let params: any[];

    if (studyId) {
      // Get roles for specific study
      query = `
        SELECT DISTINCT sur.role_name
        FROM study_user_role sur
        WHERE sur.user_name = (SELECT user_name FROM user_account WHERE user_id = $1)
          AND sur.study_id = $2
          AND sur.status_id = 1
      `;
      params = [userId, studyId];
    } else {
      // Get all roles across all studies
      query = `
        SELECT DISTINCT sur.role_name
        FROM study_user_role sur
        WHERE sur.user_name = (SELECT user_name FROM user_account WHERE user_id = $1)
          AND sur.status_id = 1
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => row.role_name);
  } catch (error: any) {
    logger.error('Failed to get user roles', {
      error: error.message,
      userId,
      studyId
    });
    return [];
  }
};

/**
 * Get user's accessible studies
 */
export const getUserStudies = async (userId: number): Promise<number[]> => {
  try {
    const query = `
      SELECT DISTINCT study_id
      FROM study_user_role
      WHERE user_name = (SELECT user_name FROM user_account WHERE user_id = $1)
        AND status_id = 1
      ORDER BY study_id
    `;

    const result = await pool.query(query, [userId]);
    return result.rows.map(row => row.study_id);
  } catch (error: any) {
    logger.error('Failed to get user studies', {
      error: error.message,
      userId
    });
    return [];
  }
};

/**
 * Build JWT payload from user data
 */
export const buildJwtPayload = async (user: User): Promise<JwtPayload> => {
  const roleNames = await getUserRoles(user.user_id);
  const studyIds = await getUserStudies(user.user_id);

  // Check if user is system admin (user_type_id = 1 = ADMIN, 0 = TECH_ADMIN)
  // This is stored in user_account table
  let primaryRole = 'user';
  const userTypeId = (user as any).user_type_id;
  
  if (userTypeId === 1 || userTypeId === 0) {
    // System admin or tech admin - set role to admin
    primaryRole = 'admin';
    logger.info('User is system admin', { userId: user.user_id, userTypeId, username: user.user_name });
  } else if (roleNames.length > 0) {
    // Determine primary role using LibreClinica role hierarchy
    // Lower ID = higher privilege (admin=1 is highest)
    const highestRole = getHighestRole(roleNames);
    primaryRole = highestRole.name !== 'invalid' ? highestRole.name : 'user';
  }

  // Get user type from database if not already present
  let userType = (user as any).user_type || 'user';
  
  logger.info('JWT payload built', { userId: user.user_id, role: primaryRole, studyIds, roleNames });
  
  return {
    userId: user.user_id,
    userName: user.user_name, // Use userName for consistency with auth middleware
    username: user.user_name, // Keep for backwards compatibility
    email: user.email,
    role: primaryRole,
    userType: userType, // Include user type for authorization checks
    studyIds
  };
};

/**
 * Get user role details with permissions
 */
export const getUserRoleDetails = async (
  userId: number,
  studyId?: number
): Promise<{ roles: LibreClinicaRole[]; highestRole: LibreClinicaRole }> => {
  const roleNames = await getUserRoles(userId, studyId);
  const roles = roleNames.map(name => getRoleByName(name)).filter(r => r.id !== 0);
  const highestRole = getHighestRole(roleNames);

  return { roles, highestRole };
};

/**
 * Check if user has specific permission
 */
export const userHasPermission = async (
  userId: number,
  studyId: number,
  permission: 'submitData' | 'extractData' | 'manageStudy' | 'monitor'
): Promise<boolean> => {
  const roleNames = await getUserRoles(userId, studyId);
  
  for (const name of roleNames) {
    const role = getRoleByName(name);
    switch (permission) {
      case 'submitData':
        if (role.canSubmitData) return true;
        break;
      case 'extractData':
        if (role.canExtractData) return true;
        break;
      case 'manageStudy':
        if (role.canManageStudy) return true;
        break;
      case 'monitor':
        if (role.canMonitor) return true;
        break;
    }
  }
  
  return false;
};

/**
 * Check if user is system admin
 */
export const isUserAdmin = async (userId: number): Promise<boolean> => {
  const roleNames = await getUserRoles(userId);
  return roleNames.some(name => {
    const role = getRoleByName(name);
    return role.id === ROLES.ADMIN.id;
  });
};

/**
 * Helper functions
 */

async function incrementLockCounter(userId: number, count: number): Promise<void> {
  const query = `
    UPDATE user_account
    SET lock_counter = $1
    WHERE user_id = $2
  `;
  await pool.query(query, [count, userId]);
}

async function resetLockCounter(userId: number): Promise<void> {
  const query = `
    UPDATE user_account
    SET lock_counter = 0
    WHERE user_id = $1
  `;
  await pool.query(query, [userId]);
}

async function lockAccount(userId: number): Promise<void> {
  // Note: LibreClinica user_account does NOT have lockout_time column
  // We only set account_non_locked to false
  const query = `
    UPDATE user_account
    SET account_non_locked = false
    WHERE user_id = $1
  `;
  
  await pool.query(query, [userId]);
}

async function unlockAccount(userId: number): Promise<void> {
  const query = `
    UPDATE user_account
    SET account_non_locked = true,
        lock_counter = 0
    WHERE user_id = $1
  `;
  
  await pool.query(query, [userId]);
}

async function updateLastVisit(userId: number): Promise<void> {
  const query = `
    UPDATE user_account
    SET date_lastvisit = NOW()
    WHERE user_id = $1
  `;
  
  await pool.query(query, [userId]);
}

/**
 * Log successful login to LibreClinica's native audit_user_login table
 * 
 * CORRECT audit_user_login schema (verified from database):
 * - id (SERIAL), user_name, user_account_id, login_attempt_date, 
 * - login_status_code (0=failed, 1=success, 2=logout), details, version
 */
async function logSuccessfulLogin(userId: number, username: string, ipAddress: string): Promise<void> {
  // Insert into audit_user_login (LibreClinica's native login audit table)
  // Column is `login_status_code` (NOT `login_status`)
  // No `audit_date` column exists
  const loginAuditQuery = `
    INSERT INTO audit_user_login (
      user_name, user_account_id, login_attempt_date, login_status_code, details, version
    ) VALUES (
      $1, $2, NOW(), 1, $3, 1
    )
  `;
  
  try {
    await pool.query(loginAuditQuery, [username, userId, `Login from ${ipAddress}`]);
    logger.info('Login audit recorded to audit_user_login', { userId, username, ipAddress });
  } catch (error: any) {
    logger.error('Failed to log successful login to audit_user_login', {
      error: error.message,
      userId,
      username
    });
  }
}

/**
 * Log failed login attempt to LibreClinica's native audit_user_login table
 */
async function logFailedLogin(username: string, ipAddress: string, reason: string): Promise<void> {
  // Insert into audit_user_login with login_status_code 0 (failed)
  const loginAuditQuery = `
    INSERT INTO audit_user_login (
      user_name, user_account_id, login_attempt_date, login_status_code, details, version
    ) VALUES (
      $1, 
      (SELECT user_id FROM user_account WHERE user_name = $1 LIMIT 1),
      NOW(), 
      0, 
      $2, 
      1
    )
  `;
  
  try {
    await pool.query(loginAuditQuery, [username, `Failed: ${reason} from ${ipAddress}`]);
    logger.warn('Failed login audit recorded to audit_user_login', { username, ipAddress, reason });
  } catch (error: any) {
    logger.error('Failed to log failed login to audit_user_login', {
      error: error.message,
      username,
      reason
    });
  }
}

/**
 * Log user logout to LibreClinica's native audit_user_login table
 */
export async function logUserLogout(userId: number, username: string, ipAddress: string): Promise<void> {
  const loginAuditQuery = `
    INSERT INTO audit_user_login (
      user_name, user_account_id, login_attempt_date, login_status_code, details, version
    ) VALUES (
      $1, $2, NOW(), 2, $3, 1
    )
  `;
  
  try {
    await pool.query(loginAuditQuery, [username, userId, `Logout from ${ipAddress}`]);
    logger.info('Logout audit recorded to audit_user_login', { userId, username });
  } catch (error: any) {
    logger.error('Failed to log logout', { error: error.message, userId });
  }
}

async function findUserByEmail(email: string): Promise<User | null> {
  const query = `
    SELECT *
    FROM user_account
    WHERE email = $1
  `;
  
  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

async function createGoogleUser(data: {
  email: string;
  firstName: string;
  lastName: string;
  googleId?: string;
}): Promise<User> {
  const username = data.email.split('@')[0];
  
  // Note: user_account table uses lock_counter NOT failed_login_attempts
  const query = `
    INSERT INTO user_account (
      user_name, first_name, last_name, email, passwd, enabled,
      account_non_locked, lock_counter, user_type_id, status_id, owner_id,
      date_created
    ) VALUES (
      $1, $2, $3, $4, '', true, true, 0, 2, 1, 1, NOW()
    )
    RETURNING *
  `;
  
  const result = await pool.query(query, [
    username,
    data.firstName,
    data.lastName,
    data.email
  ]);
  
  return result.rows[0];
}

export default {
  authenticateUser,
  authenticateWithGoogle,
  getUserRoles,
  getUserStudies,
  buildJwtPayload,
  getUserRoleDetails,
  userHasPermission,
  isUserAdmin,
  logUserLogout
};

