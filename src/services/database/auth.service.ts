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
  verifyAndUpgrade,
  hashPasswordBcrypt,
  isPasswordExpired,
  getDaysUntilPasswordExpires,
  shouldLockAccount,
  calculateLockoutDuration,
  isLockoutExpired,
  PasswordHashType
} from '../../utils/password.util';
import { JwtPayload } from '../../utils/jwt.util';
import { User, ApiResponse, LoginResponse } from '../../types';
import { getRoleByName, getHighestRole, LibreClinicaRole, ROLES } from '../../constants/roles';

const googleClient = new OAuth2Client(config.google.clientId);

/**
 * Authenticate user with username and password
 * Uses LibreClinica's MD5 password hashing
 * 
 * Demo Mode: If DEMO_MODE=true, allows any credentials to login as admin
 */
export const authenticateUser = async (
  username: string,
  password: string,
  ipAddress: string
): Promise<ApiResponse<User>> => {
  logger.info('Authenticating user', { username, ipAddress });

  // Demo mode - allow any credentials
  const isDemoMode = process.env.DEMO_MODE === 'true' || config.demoMode === true;
  
  if (isDemoMode) {
    logger.info('Demo mode - authenticating with demo credentials', { username });
    
    // Return a demo admin user
    const demoUser = {
      user_id: 1,
      user_name: username || 'demo',
      first_name: 'Demo',
      last_name: 'User',
      email: `${username || 'demo'}@demo.local`,
      passwd: '',
      passwd_timestamp: new Date(),
      date_lastvisit: new Date(),
      user_type_id: 1, // Admin type
      user_type: 'admin',
      owner_id: 1,
      date_created: new Date(),
      status_id: 1,
      update_id: 1
    } as User;
    
    return {
      success: true,
      data: demoUser,
      message: 'Demo authentication successful'
    };
  }

  try {
    // Query user from database
    // Note: LibreClinica's user_account table doesn't have enabled/account_non_locked columns
    // All users in the table are considered active. Status is determined by status_id.
    // Also fetch bcrypt hash from extended table if available (for upgraded passwords)
    
    // First check if user_account_extended table exists to avoid query errors
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'user_account_extended'
      ) as table_exists
    `);
    const hasExtendedTable = tableCheck.rows[0]?.table_exists === true;
    
    // Use appropriate query based on table existence
    const query = hasExtendedTable 
      ? `
        SELECT 
          u.user_id,
          u.user_name,
          u.first_name,
          u.last_name,
          u.email,
          u.passwd,
          u.passwd_timestamp,
          u.date_lastvisit,
          u.status_id,
          ut.user_type_id,
          ut.user_type,
          uae.bcrypt_passwd,
          uae.password_version
        FROM user_account u
        LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
        LEFT JOIN user_account_extended uae ON u.user_id = uae.user_id
        WHERE u.user_name = $1
      `
      : `
        SELECT 
          u.user_id,
          u.user_name,
          u.first_name,
          u.last_name,
          u.email,
          u.passwd,
          u.passwd_timestamp,
          u.date_lastvisit,
          u.status_id,
          ut.user_type_id,
          ut.user_type,
          NULL as bcrypt_passwd,
          NULL as password_version
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

    // Check if user is active via status_id (1 = active, other = inactive)
    if (user.status_id !== 1) {
      logger.warn('Authentication failed - user not active', { username, statusId: user.status_id });
      return {
        success: false,
        message: 'User account is not active'
      };
    }

    // Verify password with dual-auth support (MD5 legacy + bcrypt secure)
    // This allows transparent migration from MD5 to bcrypt
    const verification = await verifyAndUpgrade(
      password,
      user.passwd,           // MD5 hash from LibreClinica
      user.bcrypt_passwd     // bcrypt hash if available (from our extended table)
    );

    if (!verification.valid) {
      // Log failed login
      await logFailedLogin(username, ipAddress, 'Invalid password');

      logger.warn('Authentication failed - invalid password', { username });

      return {
        success: false,
        message: 'Invalid username or password'
      };
    }
    
    // If password was verified via MD5 and needs upgrade to bcrypt
    if (verification.shouldUpdateDatabase && verification.upgradedBcryptHash) {
      try {
        await upgradeToBcrypt(user.user_id, verification.upgradedBcryptHash);
        logger.info('Password upgraded from MD5 to bcrypt', { userId: user.user_id });
      } catch (upgradeError: any) {
        // Don't fail login if upgrade fails - just log it
        logger.warn('Failed to upgrade password hash', { 
          userId: user.user_id, 
          error: upgradeError.message 
        });
      }
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

    // Check if user is active (status_id = 1 means active)
    if (user.status_id !== 1) {
      logger.warn('Google OAuth failed - user not active', { email, statusId: user.status_id });
      return {
        success: false,
        message: 'User account is not active'
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
  
  // Fetch organization membership so it's embedded in the JWT
  let organizationIds: number[] = [];
  let organizationDetails: { organizationId: number; organizationName: string; role: string }[] = [];
  try {
    const orgResult = await pool.query(
      `SELECT m.organization_id, o.name as organization_name, m.role
       FROM acc_organization_member m
       INNER JOIN acc_organization o ON m.organization_id = o.organization_id
       WHERE m.user_id = $1 AND m.status = 'active'`,
      [user.user_id]
    );
    organizationIds = orgResult.rows.map((r: any) => r.organization_id);
    organizationDetails = orgResult.rows.map((r: any) => ({
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      role: r.role
    }));
  } catch (e: any) {
    logger.warn('Could not fetch org membership for JWT', { error: e.message });
  }

  logger.info('JWT payload built', { userId: user.user_id, role: primaryRole, studyIds, roleNames, organizationIds });
  
  return {
    userId: user.user_id,
    userName: user.user_name, // Use userName for consistency with auth middleware
    username: user.user_name, // Keep for backwards compatibility
    email: user.email,
    role: primaryRole,
    userType: userType, // Include user type for authorization checks
    studyIds,
    organizationIds,
    organizationDetails
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
  // LibreClinica doesn't have account_non_locked column
  // We use status_id to indicate account status (5 = locked)
  const query = `
    UPDATE user_account
    SET status_id = 5
    WHERE user_id = $1
  `;
  
  await pool.query(query, [userId]);
}

async function unlockAccount(userId: number): Promise<void> {
  // Set status back to active (1)
  const query = `
    UPDATE user_account
    SET status_id = 1
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
 * Upgrade user password from MD5 to bcrypt
 * Stores bcrypt hash in extended user table while keeping MD5 for SOAP compatibility
 * 
 * 21 CFR Part 11 Compliance:
 * - MD5 kept for LibreClinica SOAP WS-Security (legacy requirement)
 * - bcrypt used for API authentication (secure)
 * - Both hashes represent the same password
 */
async function upgradeToBcrypt(userId: number, bcryptHash: string): Promise<void> {
  // First, check if the extended table exists, create if not
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_account_extended (
        user_id INTEGER PRIMARY KEY REFERENCES user_account(user_id),
        bcrypt_passwd VARCHAR(255),
        passwd_upgraded_at TIMESTAMP DEFAULT NOW(),
        password_version INTEGER DEFAULT 2,
        CONSTRAINT fk_user_account FOREIGN KEY (user_id) 
          REFERENCES user_account(user_id) ON DELETE CASCADE
      )
    `);
  } catch (tableError: any) {
    // Table might already exist or FK might fail - continue anyway
    logger.debug('Extended table check', { message: tableError.message });
  }
  
  // Upsert the bcrypt hash
  const query = `
    INSERT INTO user_account_extended (user_id, bcrypt_passwd, passwd_upgraded_at, password_version)
    VALUES ($1, $2, NOW(), 2)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
      bcrypt_passwd = EXCLUDED.bcrypt_passwd,
      passwd_upgraded_at = NOW(),
      password_version = 2
  `;
  
  await pool.query(query, [userId, bcryptHash]);
  
  logger.info('Password hash upgraded to bcrypt', { userId });
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
  
  // LibreClinica user_account - minimal required columns
  const query = `
    INSERT INTO user_account (
      user_name, first_name, last_name, email, passwd,
      user_type_id, status_id, owner_id, date_created
    ) VALUES (
      $1, $2, $3, $4, '', 2, 1, 1, NOW()
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

