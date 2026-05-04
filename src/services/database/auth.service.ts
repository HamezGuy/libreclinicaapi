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
import { getUserCustomPermissions } from './permission.service';

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

  // Demo mode - allow any credentials (NEVER in production)
  const isDemoMode = process.env.DEMO_MODE === 'true' || config.demoMode === true;
  
  if (isDemoMode && process.env.NODE_ENV === 'production') {
    logger.error('[21 CFR Part 11 VIOLATION] DEMO_MODE=true in production — authentication refused');
    return {
      success: false,
      message: 'Demo mode is disabled in production environments'
    };
  }

  if (isDemoMode) {
    logger.info('Demo mode - authenticating with demo credentials', { username });
    
    // Return a demo admin user
    const demoUser = {
      userId: 1,
      userName: username || 'demo',
      firstName: 'Demo',
      lastName: 'User',
      email: `${username || 'demo'}@demo.local`,
      passwd: '',
      passwdTimestamp: new Date(),
      dateLastvisit: new Date(),
      userTypeId: 1,
      userType: 'admin',
      ownerId: 1,
      dateCreated: new Date(),
      statusId: 1,
      updateId: 1
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
    const hasExtendedTable = tableCheck.rows[0]?.tableExists === true;
    
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

    // Check if account is locked (status_id = 5) — §11.300(d) lockout enforcement
    if (user.statusId === 5) {
      logger.warn('Authentication failed - account locked', { username });
      return {
        success: false,
        message: 'Account is locked due to excessive failed login attempts. Please contact your administrator.'
      };
    }

    // Check if user is active via status_id (1 = active, other = inactive)
    if (user.statusId !== 1) {
      logger.warn('Authentication failed - user not active', { username, statusId: user.statusId });
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
      user.bcryptPasswd     // bcrypt hash if available (from our extended table)
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
        await upgradeToBcrypt(user.userId, verification.upgradedBcryptHash);
        logger.info('Password upgraded from MD5 to bcrypt', { userId: user.userId });
      } catch (upgradeError: any) {
        // Don't fail login if upgrade fails - just log it
        logger.warn('Failed to upgrade password hash', { 
          userId: user.userId, 
          error: upgradeError.message 
        });
      }
    }

    if (user.passwdTimestamp && isPasswordExpired(user.passwdTimestamp)) {
      logger.warn('Authentication failed - password expired', { username });
      return {
        success: false,
        message: 'Password has expired. Please reset your password.'
      };
    }

    // Password expiration warning (within 7 days)
    const daysUntilExpiration = user.passwdTimestamp 
      ? getDaysUntilPasswordExpires(user.passwdTimestamp)
      : null;

    if (daysUntilExpiration !== null && daysUntilExpiration <= 7 && daysUntilExpiration > 0) {
      logger.info('Password expiring soon', { 
        username, 
        daysUntilExpiration 
      });
    }

    // Reset lock counter on successful login
    if (user.lockCounter > 0) {
      await resetLockCounter(user.userId);
    }

    // Update last visit date
    await updateLastVisit(user.userId);

    // Log successful login
    await logSuccessfulLogin(user.userId, username, ipAddress);

    logger.info('Authentication successful', { 
      username,
      userId: user.userId
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
    if (user.statusId !== 1) {
      logger.warn('Google OAuth failed - user not active', { email, statusId: user.statusId });
      return {
        success: false,
        message: 'User account is not active'
      };
    }

    // Update last visit
    await updateLastVisit(user.userId);

    // Log successful login
    await logSuccessfulLogin(user.userId, user.userName, ipAddress);

    logger.info('Google OAuth successful', {
      email,
      userId: user.userId
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
    return result.rows.map(row => row.roleName);
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
    return result.rows.map(row => row.studyId);
  } catch (error: any) {
    logger.error('Failed to get user studies', {
      error: error.message,
      userId
    });
    return [];
  }
};

/**
 * Build JWT payload from user data.
 *
 * Role resolution (single source of truth):
 *   1. user_type_id 0 or 1  → 'admin'
 *   2. platform_role from user_account_extended (set by createUser / updateUser)
 *   3. Fallback: 'coordinator'
 *
 * study_user_role is NOT consulted here — it controls study-level access
 * (requireStudyAccess), not feature-level permissions (requireRole).
 */
export const buildJwtPayload = async (user: User): Promise<JwtPayload> => {
  const studyIds = await getUserStudies(user.userId);
  const userTypeId = (user as any).userTypeId;

  let primaryRole = 'coordinator';

  if (userTypeId === 1 || userTypeId === 0) {
    primaryRole = 'admin';
  } else {
    try {
      const result = await pool.query(
        `SELECT platform_role FROM user_account_extended WHERE user_id = $1`,
        [user.userId]
      );
      if (result.rows.length > 0 && result.rows[0].platformRole) {
        primaryRole = result.rows[0].platformRole;
      }
    } catch (e: any) {
      logger.warn('Could not read platform_role', { error: e.message, userId: user.userId });
    }
  }

  let userType = (user as any).user_type || 'user';

  let organizationIds: number[] = [];
  let organizationDetails: { organizationId: number; organizationName: string; role: string }[] = [];
  try {
    const orgResult = await pool.query(
      `SELECT m.organization_id, o.name as organization_name, m.role
       FROM acc_organization_member m
       INNER JOIN acc_organization o ON m.organization_id = o.organization_id
       WHERE m.user_id = $1 AND m.status = 'active'`,
      [user.userId]
    );
    organizationIds = orgResult.rows.map((r: any) => r.organizationId);
    organizationDetails = orgResult.rows.map((r: any) => ({
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      role: r.role
    }));
  } catch (e: any) {
    logger.warn('Could not fetch org membership for JWT', { error: e.message });
  }

  logger.info('JWT payload built', { userId: user.userId, role: primaryRole, studyIds, organizationIds });

  return {
    userId: user.userId,
    userName: user.userName,
    username: user.userName,
    email: user.email,
    role: primaryRole,
    userType: userType,
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
  // Table is created by startup migrations (config/migrations.ts)
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to log failed login to audit_user_login', {
      error: msg,
      username,
      reason
    });
  }

  // §11.300(d) — Account lockout enforcement
  try {
    const userResult = await pool.query(
      'SELECT user_id, lock_counter FROM user_account WHERE user_name = $1',
      [username]
    );
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0] as { userId: number; lockCounter: number };
      const newCount = (user.lockCounter || 0) + 1;
      const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);

      await incrementLockCounter(user.userId, newCount);

      if (newCount >= maxAttempts) {
        await lockAccount(user.userId);
        logger.warn('Account locked due to excessive failed login attempts', {
          username,
          attempts: newCount,
          ipAddress,
        });

        try {
          const { notifyUsers } = await import('./notification.service');
          const adminResult = await pool.query(
            `SELECT u.user_id FROM user_account u
             JOIN user_type ut ON u.user_type_id = ut.user_type_id
             WHERE ut.user_type IN ('admin', 'sysadmin') AND u.status_id = 1`
          );
          const adminIds = adminResult.rows.map((r: Record<string, unknown>) => (r as { userId: number }).userId);
          if (adminIds.length > 0) {
            await notifyUsers(
              adminIds,
              'general',
              `SECURITY ALERT: Account Locked — "${username}"`,
              `Account "${username}" was locked after ${newCount} failed login attempts from IP ${ipAddress}. Per 21 CFR Part 11 §11.300(d), this requires immediate review.`
            );
          }
        } catch {
          logger.error('Failed to send security alert notification for account lockout', { username });
        }
      } else if (newCount >= 3) {
        logger.warn('Multiple failed login attempts detected (§11.300(d))', {
          username, attempts: newCount, maxAttempts, ipAddress,
        });

        try {
          const { notifyUsers } = await import('./notification.service');
          const adminResult = await pool.query(
            `SELECT u.user_id FROM user_account u
             JOIN user_type ut ON u.user_type_id = ut.user_type_id
             WHERE ut.user_type IN ('admin', 'sysadmin') AND u.status_id = 1`
          );
          const adminIds = adminResult.rows.map((r: Record<string, unknown>) => (r as { userId: number }).userId);
          if (adminIds.length > 0) {
            await notifyUsers(
              adminIds,
              'general',
              `Security Warning: Repeated Failed Logins — "${username}"`,
              `${newCount} failed login attempts detected for account "${username}" from IP ${ipAddress} (lockout threshold: ${maxAttempts}). Per 21 CFR Part 11 §11.300(d), unauthorized use attempts must be reported.`
            );
          }
        } catch {
          logger.error('Failed to send pre-lockout warning notification', { username });
        }
      }
    }
  } catch (lockError: unknown) {
    const msg = lockError instanceof Error ? lockError.message : String(lockError);
    logger.error('Failed to enforce account lockout', { error: msg, username });
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

/**
 * Fetch per-user custom permission overrides for inclusion in login response.
 * These are NOT included in the JWT (to keep it small) but are sent alongside it.
 */
export const fetchCustomPermissions = async (userId: number): Promise<Record<string, boolean>> => {
  try {
    return await getUserCustomPermissions(userId);
  } catch (error: any) {
    logger.warn('Could not fetch custom permissions for login response', { error: error.message, userId });
    return {};
  }
};

/**
 * Get full user profile by userId, including role resolution.
 * Returns a camelCase profile object ready for the controller to return.
 */
export const getProfile = async (userId: number): Promise<{
  userId: number;
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  institutionalAffiliation: string;
  role: string;
  secondaryRole: string;
  userType: string;
  userTypeId: number;
  timeZone: string;
  isActive: boolean;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
} | null> => {
  const result = await pool.query(`
    SELECT 
      user_id, user_name, first_name, last_name, email, phone,
      institutional_affiliation, status_id, user_type_id,
      time_zone, date_created, date_updated
    FROM user_account 
    WHERE user_id = $1
  `, [userId]);

  if (result.rows.length === 0) return null;

  const dbUser = result.rows[0];

  const typeResult = await pool.query(
    'SELECT user_type FROM user_type WHERE user_type_id = $1',
    [dbUser.userTypeId]
  );
  const userTypeName = typeResult.rows.length > 0 ? typeResult.rows[0].userType : 'unknown';

  let primaryRole: string;
  const userTypeId = dbUser.userTypeId;

  if (userTypeId === 1 || userTypeId === 0) {
    primaryRole = 'admin';
  } else {
    try {
      const platformResult = await pool.query(
        `SELECT platform_role FROM user_account_extended WHERE user_id = $1`,
        [userId]
      );
      if (platformResult.rows.length > 0 && platformResult.rows[0].platformRole) {
        primaryRole = platformResult.rows[0].platformRole;
      } else {
        primaryRole = 'coordinator';
      }
    } catch (e: unknown) {
      primaryRole = 'coordinator';
    }
  }

  let secondaryRole = '';
  try {
    const secondaryRoleResult = await pool.query(
      `SELECT secondary_role FROM user_account_extended WHERE user_id = $1`,
      [userId]
    );
    if (secondaryRoleResult.rows.length > 0) {
      secondaryRole = secondaryRoleResult.rows[0].secondaryRole || '';
    }
  } catch (e: unknown) {
    // extended table may not exist yet
  }

  return {
    userId: dbUser.userId,
    userName: dbUser.userName,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    phone: dbUser.phone || '',
    institutionalAffiliation: dbUser.institutionalAffiliation || '',
    role: primaryRole,
    secondaryRole,
    userType: userTypeName,
    userTypeId,
    timeZone: dbUser.timeZone || 'America/New_York',
    isActive: dbUser.statusId === 1,
    createdAt: dbUser.dateCreated,
    updatedAt: dbUser.dateUpdated
  };
};

/**
 * Update user profile (self-service). Runs in a transaction.
 * Returns the updated profile fields, or null if user not found.
 * Throws on uniqueness violations (email/username taken) with a descriptive message.
 */
export const updateProfile = async (
  userId: number,
  profileData: {
    firstName?: string;
    lastName?: string;
    username?: string;
    email?: string;
    phone?: string;
    institutionalAffiliation?: string;
    timeZone?: string;
    secondaryRole?: string;
  }
): Promise<{
  userId: number;
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  institutionalAffiliation: string;
  timeZone: string;
  secondaryRole?: string;
} | null> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (profileData.firstName !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      params.push(profileData.firstName);
    }
    if (profileData.lastName !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      params.push(profileData.lastName);
    }
    if (profileData.username !== undefined) {
      const usernameCheck = await client.query(
        'SELECT user_id FROM user_account WHERE user_name = $1 AND user_id != $2',
        [profileData.username, userId]
      );
      if (usernameCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new Error('Username is already taken');
      }
      updates.push(`user_name = $${paramIndex++}`);
      params.push(profileData.username);
    }
    if (profileData.email !== undefined) {
      const emailCheck = await client.query(
        'SELECT user_id FROM user_account WHERE email = $1 AND user_id != $2',
        [profileData.email, userId]
      );
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new Error('Email is already in use by another user');
      }
      updates.push(`email = $${paramIndex++}`);
      params.push(profileData.email);
    }
    if (profileData.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      params.push(profileData.phone);
    }
    if (profileData.institutionalAffiliation !== undefined) {
      updates.push(`institutional_affiliation = $${paramIndex++}`);
      params.push(profileData.institutionalAffiliation);
    }
    if (profileData.timeZone !== undefined) {
      updates.push(`time_zone = $${paramIndex++}`);
      params.push(profileData.timeZone);
    }

    updates.push(`date_updated = NOW()`);
    params.push(userId);

    const updateQuery = `
      UPDATE user_account 
      SET ${updates.join(', ')}
      WHERE user_id = $${paramIndex}
      RETURNING user_id, user_name, first_name, last_name, email, phone, institutional_affiliation, time_zone
    `;

    const result = await client.query(updateQuery, params);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    if (profileData.secondaryRole !== undefined) {
      await client.query(`
        INSERT INTO user_account_extended (user_id, secondary_role)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET secondary_role = EXCLUDED.secondary_role
      `, [userId, profileData.secondaryRole || null]);
    }

    await client.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, entity_id, entity_name,
        user_id, audit_table, reason_for_change, old_value, new_value
      ) VALUES (
        44, NOW(), $1, 'Profile Updated', $2, 'user_account', 
        'User updated their profile', '', $3
      )
    `, [userId, userId, JSON.stringify(result.rows[0])]);

    await client.query('COMMIT');

    const row = result.rows[0];
    return {
      userId: row.userId,
      userName: row.userName,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone || '',
      institutionalAffiliation: row.institutionalAffiliation || '',
      timeZone: row.timeZone || 'America/New_York',
      secondaryRole: profileData.secondaryRole !== undefined
        ? (profileData.secondaryRole || '')
        : undefined
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Change user password (self-service). Verifies current password, then updates
 * both MD5 (for SOAP compat) and bcrypt hashes inside a transaction.
 * Returns { success, message }.
 */
export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> => {
  const { verifyAndUpgrade: verifyPwd, hashPasswordMD5, hashPasswordBcrypt: hashBcrypt } = await import('../../utils/password.util');

  const userResult = await pool.query(
    `SELECT u.user_id, u.passwd, uae.bcrypt_passwd
     FROM user_account u
     LEFT JOIN user_account_extended uae ON u.user_id = uae.user_id
     WHERE u.user_id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return { success: false, message: 'User not found' };
  }

  const dbUser = userResult.rows[0];

  const verification = await verifyPwd(
    currentPassword,
    dbUser.passwd,
    dbUser.bcryptPasswd
  );

  if (!verification.valid) {
    return { success: false, message: 'Current password is incorrect' };
  }

  const bcryptHash = await hashBcrypt(newPassword);

  const historyResult = await pool.query(
    `SELECT password_hash FROM acc_password_history
     WHERE user_id = $1 ORDER BY changed_at DESC LIMIT 5`,
    [userId]
  );

  const { compareSync } = await import('bcrypt');
  for (const row of historyResult.rows) {
    if (compareSync(newPassword, row.passwordHash)) {
      return { success: false, message: 'New password must not match any of your last 5 passwords' };
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const md5Hash = hashPasswordMD5(newPassword);

    await client.query(
      `INSERT INTO acc_password_history (user_id, password_hash, changed_at)
       VALUES ($1, $2, NOW())`,
      [userId, bcryptHash]
    );

    await client.query(
      `UPDATE user_account SET passwd = $1, passwd_timestamp = NOW(), date_updated = NOW() WHERE user_id = $2`,
      [md5Hash, userId]
    );

    await client.query(
      `INSERT INTO user_account_extended (user_id, bcrypt_passwd, passwd_upgraded_at, password_version)
       VALUES ($1, $2, NOW(), 2)
       ON CONFLICT (user_id) DO UPDATE SET
         bcrypt_passwd = EXCLUDED.bcrypt_passwd,
         passwd_upgraded_at = NOW(),
         password_version = 2`,
      [userId, bcryptHash]
    );

    await client.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, entity_id, entity_name,
        user_id, audit_table, reason_for_change, old_value, new_value
      ) VALUES (
        44, NOW(), $1, 'Password Changed', $2, 'user_account',
        'User changed their password', '', ''
      )
    `, [userId, userId]);

    await client.query('COMMIT');

    logger.info('Password changed via service', { userId });
    return { success: true, message: 'Password changed successfully' };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Register or update a device record (WoundScanner).
 * Silently swallows DB errors so token validation is not blocked.
 */
export const registerDevice = async (
  deviceId: string,
  deviceInfo: { model?: string; osVersion?: string; appVersion?: string },
  userId: string | null
): Promise<void> => {
  try {
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
      deviceId,
      deviceInfo.model || null,
      deviceInfo.osVersion || null,
      deviceInfo.appVersion || null,
      userId
    ]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to register device', { error: msg, deviceId });
  }
};

/**
 * Lookup patient initials from study_subject by ID.
 */
export const getPatientInitials = async (patientId: number): Promise<string> => {
  try {
    const result = await pool.query(
      'SELECT label FROM study_subject WHERE study_subject_id = $1',
      [patientId]
    );
    if (result.rows.length > 0) {
      const label: string = result.rows[0].label || '';
      return label.substring(0, 2).toUpperCase();
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to get patient initials', { error: msg, patientId });
  }
  return '';
};

/**
 * Lookup template/CRF name by OID or name fragment.
 */
export const getTemplateName = async (templateId: string): Promise<string> => {
  try {
    const result = await pool.query(
      "SELECT name FROM crf WHERE oc_oid = $1 OR name LIKE $2 LIMIT 1",
      [templateId, `%${templateId}%`]
    );
    if (result.rows.length > 0) {
      return result.rows[0].name;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to get template name', { error: msg, templateId });
  }
  return templateId;
};

/**
 * Get user_account row by userId. Used by the refresh-token flow.
 */
export const getUserById = async (userId: number): Promise<User | null> => {
  const result = await pool.query(
    `SELECT * FROM user_account WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
};

export default {
  authenticateUser,
  authenticateWithGoogle,
  getUserRoles,
  getUserStudies,
  buildJwtPayload,
  getUserRoleDetails,
  userHasPermission,
  isUserAdmin,
  logUserLogout,
  fetchCustomPermissions,
  getProfile,
  updateProfile,
  changePassword,
  registerDevice,
  getPatientInitials,
  getTemplateName,
  getUserById
};

