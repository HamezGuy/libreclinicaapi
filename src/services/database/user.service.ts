/**
 * User Service
 * 
 * Handles user management (CRUD operations)
 * RED X Feature: User Management API
 * 
 * LibreClinica has NO user management API - we build it!
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { hashPasswordMD5, validatePassword } from '../../utils/password.util';
import { User, PaginatedResponse } from '../../types';
import { getRoleByName, ALL_ROLES, STUDY_ROLE_MAP, SITE_ROLE_MAP } from '../../constants/roles';

/**
 * Get users with filters
 */
export const getUsers = async (
  filters: {
    studyId?: number;
    role?: string;
    enabled?: boolean;
    page?: number;
    limit?: number;
  },
  callerUserId?: number
): Promise<PaginatedResponse<User>> => {
  logger.info('Getting users', { ...filters, callerUserId });

  try {
    const { studyId, role, enabled, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    // Org-scoping: if caller belongs to an org, only show users from same org(s)
    if (callerUserId) {
      const orgCheck = await pool.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [callerUserId]
      );
      const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

      if (userOrgIds.length > 0) {
        conditions.push(`u.user_id IN (
          SELECT m.user_id FROM acc_organization_member m
          WHERE m.organization_id = ANY($${paramIndex++}::int[])
            AND m.status = 'active'
        )`);
        params.push(userOrgIds);
      }
    }

    if (studyId) {
      conditions.push(`sur.study_id = $${paramIndex++}`);
      params.push(studyId);
    }

    if (role) {
      conditions.push(`sur.role_name ILIKE $${paramIndex++}`);
      params.push(`%${role}%`);
    }

    if (enabled !== undefined) {
      conditions.push(`u.enabled = $${paramIndex++}`);
      params.push(enabled);
    }

    const whereClause = conditions.join(' AND ');

    // Count
    const countQuery = `
      SELECT COUNT(DISTINCT u.user_id) as total
      FROM user_account u
      LEFT JOIN study_user_role sur ON u.user_name = sur.user_name
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get users
    const dataQuery = `
      SELECT DISTINCT ON (u.user_id)
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        u.email,
        u.institutional_affiliation,
        u.phone,
        u.status_id,
        u.date_created,
        u.date_lastvisit,
        u.date_updated,
        u.enabled,
        u.account_non_locked,
        u.lock_counter,
        u.run_webservices,
        u.enable_api_key,
        u.user_type_id,
        ut.user_type
      FROM user_account u
      LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
      LEFT JOIN study_user_role sur ON u.user_name = sur.user_name
      WHERE ${whereClause}
      ORDER BY u.user_id, u.date_created DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

    return {
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error: any) {
    logger.error('Get users error', { error: error.message, filters });
    throw error;
  }
};

/**
 * Get user by ID
 * Org-scoped: if caller belongs to an org, target user must be in the same org(s)
 */
export const getUserById = async (userId: number, callerUserId?: number): Promise<User | null> => {
  logger.info('Getting user by ID', { userId, callerUserId });

  try {
    // Org-scoping: verify caller and target share an org
    if (callerUserId) {
      const orgCheck = await pool.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [callerUserId]
      );
      const callerOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

      if (callerOrgIds.length > 0) {
        const targetOrgCheck = await pool.query(
          `SELECT 1 FROM acc_organization_member WHERE user_id = $1 AND organization_id = ANY($2::int[]) AND status = 'active' LIMIT 1`,
          [userId, callerOrgIds]
        );
        if (targetOrgCheck.rows.length === 0) {
          logger.warn('getUserById org-scoping denied', { userId, callerUserId, callerOrgIds });
          return null;
        }
      }
    }

    const query = `
      SELECT 
        u.*,
        ut.user_type,
        array_agg(DISTINCT sur.study_id) FILTER (WHERE sur.study_id IS NOT NULL) as study_ids,
        array_agg(DISTINCT sur.role_name) FILTER (WHERE sur.role_name IS NOT NULL) as roles
      FROM user_account u
      LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
      LEFT JOIN study_user_role sur ON u.user_name = sur.user_name AND sur.status_id = 1
      WHERE u.user_id = $1
      GROUP BY u.user_id, ut.user_type
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get user by ID error', { error: error.message, userId });
    throw error;
  }
};

/**
 * Create new user - supports ALL LibreClinica user_account fields
 */
export const createUser = async (
  data: {
    // Required fields
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    
    // Personal info
    phone?: string;
    institutionalAffiliation?: string;
    
    // User type and role
    userTypeId?: number;     // 1=admin, 2=user, 3=tech-admin
    role?: string;           // Role for study assignment
    studyId?: number;        // Study to assign to
    activeStudyId?: number;  // Default active study
    
    // API Access
    runWebservices?: boolean;
    enableApiKey?: boolean;
    apiKey?: string;
    accessCode?: string;
    
    // Two-Factor Auth
    authtype?: 'STANDARD' | 'MARKED' | 'TWO_FACTOR';
    authsecret?: string;
    
    // Password challenge (for password recovery)
    passwdChallengeQuestion?: string;
    passwdChallengeAnswer?: string;
    
    // Timezone
    timeZone?: string;
  },
  creatorId: number
): Promise<{ success: boolean; userId?: number; message?: string }> => {
  logger.info('Creating user', { username: data.username, role: data.role, creatorId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate password
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.isValid) {
      return {
        success: false,
        message: `Password validation failed: ${passwordValidation.errors.join(', ')}`
      };
    }

    // Check if username exists
    const existsQuery = `SELECT user_id FROM user_account WHERE user_name = $1`;
    const existsResult = await client.query(existsQuery, [data.username]);

    if (existsResult.rows.length > 0) {
      return {
        success: false,
        message: 'Username already exists'
      };
    }

    // Check if email exists
    const emailExistsQuery = `SELECT user_id FROM user_account WHERE email = $1`;
    const emailExistsResult = await client.query(emailExistsQuery, [data.email]);

    if (emailExistsResult.rows.length > 0) {
      return {
        success: false,
        message: 'Email already exists'
      };
    }

    // Hash password
    const hashedPassword = hashPasswordMD5(data.password);

    // Map role to user_type_id
    let userTypeId = data.userTypeId || 2;
    if (data.role) {
      const roleToUserType: Record<string, number> = {
        'admin': 1,       // tech-admin
        'coordinator': 2, // user
        'investigator': 2,
        'monitor': 2,
        'data_entry': 2
      };
      userTypeId = roleToUserType[data.role.toLowerCase()] || 2;
    }

    // Insert user - using only columns that exist in LibreClinica's user_account table
    const insertQuery = `
      INSERT INTO user_account (
        user_name, first_name, last_name, email, passwd, passwd_timestamp,
        phone, institutional_affiliation, user_type_id, status_id, owner_id,
        date_created, active_study, passwd_challenge_question, passwd_challenge_answer
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), $6, $7, $8, 1, $9, NOW(), $10, $11, $12
      )
      RETURNING user_id
    `;

    const insertResult = await client.query(insertQuery, [
      data.username,
      data.firstName,
      data.lastName,
      data.email,
      hashedPassword,
      data.phone || null,
      data.institutionalAffiliation || null,
      userTypeId,
      creatorId,
      data.activeStudyId || null,
      data.passwdChallengeQuestion || null,
      data.passwdChallengeAnswer || null
    ]);

    const userId = insertResult.rows[0].user_id;

    // Assign to default study (study_id=1) with the specified role if role is provided
    if (data.role) {
      const studyId = data.studyId || 1; // Default to study 1
      
      // Map frontend role names to LibreClinica role names
      const roleNameMap: Record<string, string> = {
        'admin': 'admin',
        'coordinator': 'coordinator',
        'investigator': 'Investigator',
        'monitor': 'monitor',
        'data_entry': 'ra'
      };
      
      const lcRoleName = roleNameMap[data.role.toLowerCase()] || data.role;

      await client.query(`
        INSERT INTO study_user_role (
          role_name, study_id, status_id, owner_id, date_created, user_name
        ) VALUES ($1, $2, 1, $3, NOW(), $4)
      `, [lcRoleName, studyId, creatorId, data.username]);

      logger.info('User assigned to study', { userId, studyId, role: lcRoleName });
    }

    // Add user to creator's organization(s)
    try {
      const creatorOrgs = await client.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [creatorId]
      );
      for (const orgRow of creatorOrgs.rows) {
        await client.query(`
          INSERT INTO acc_organization_member (organization_id, user_id, role, status, date_joined)
          VALUES ($1, $2, $3, 'active', NOW())
          ON CONFLICT (organization_id, user_id) DO NOTHING
        `, [orgRow.organization_id, userId, data.role || 'data_entry']);
        logger.info('User added to organization', { userId, organizationId: orgRow.organization_id });
      }
    } catch (orgError: any) {
      logger.warn('Could not add user to creator org', { error: orgError.message });
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'user_account', $1, $2, 'User', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'User Created' LIMIT 1)
      )
    `, [creatorId, userId, data.username]);

    await client.query('COMMIT');

    logger.info('User created successfully', { userId, username: data.username });

    return {
      success: true,
      userId,
      message: 'User created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create user error', { error: error.message, data });

    return {
      success: false,
      message: `Failed to create user: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update user - supports ALL LibreClinica user_account fields
 */
export const updateUser = async (
  userId: number,
  data: {
    // Personal info
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    institutionalAffiliation?: string;
    
    // Status
    enabled?: boolean;
    accountNonLocked?: boolean;
    
    // User type
    userTypeId?: number;
    activeStudyId?: number;
    
    // API Access
    runWebservices?: boolean;
    enableApiKey?: boolean;
    apiKey?: string;
    accessCode?: string;
    
    // Two-Factor Auth
    authtype?: 'STANDARD' | 'MARKED' | 'TWO_FACTOR';
    authsecret?: string;
    
    // Password challenge
    passwdChallengeQuestion?: string;
    passwdChallengeAnswer?: string;
    
    // Timezone
    timeZone?: string;
  },
  updaterId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating user', { userId, updaterId });

  // Org-scoping: verify updater and target share an org
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [updaterId]
  );
  const updaterOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
  if (updaterOrgIds.length > 0) {
    const targetCheck = await pool.query(
      `SELECT 1 FROM acc_organization_member WHERE user_id = $1 AND organization_id = ANY($2::int[]) AND status = 'active' LIMIT 1`,
      [userId, updaterOrgIds]
    );
    if (targetCheck.rows.length === 0) {
      logger.warn('updateUser org-scoping denied', { userId, updaterId, updaterOrgIds });
      return { success: false, message: 'User not found in your organization' };
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.firstName !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      params.push(data.firstName);
    }

    if (data.lastName !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      params.push(data.lastName);
    }

    if (data.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(data.email);
    }

    if (data.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      params.push(data.phone);
    }

    if (data.institutionalAffiliation !== undefined) {
      updates.push(`institutional_affiliation = $${paramIndex++}`);
      params.push(data.institutionalAffiliation);
    }

    // Use status_id for enabled/locked state (1 = active, 5 = locked)
    if (data.enabled !== undefined) {
      updates.push(`status_id = $${paramIndex++}`);
      params.push(data.enabled ? 1 : 5);
    }

    if (data.accountNonLocked !== undefined) {
      updates.push(`status_id = $${paramIndex++}`);
      params.push(data.accountNonLocked ? 1 : 5);
    }

    if (data.userTypeId !== undefined) {
      updates.push(`user_type_id = $${paramIndex++}`);
      params.push(data.userTypeId);
    }

    if (data.activeStudyId !== undefined) {
      updates.push(`active_study = $${paramIndex++}`);
      params.push(data.activeStudyId);
    }

    if (data.passwdChallengeQuestion !== undefined) {
      updates.push(`passwd_challenge_question = $${paramIndex++}`);
      params.push(data.passwdChallengeQuestion);
    }

    if (data.passwdChallengeAnswer !== undefined) {
      updates.push(`passwd_challenge_answer = $${paramIndex++}`);
      params.push(data.passwdChallengeAnswer);
    }

    if ((data as any).timeZone !== undefined) {
      updates.push(`time_zone = $${paramIndex++}`);
      params.push((data as any).timeZone);
    }

    if ((data as any).runWebservices !== undefined) {
      updates.push(`run_webservices = $${paramIndex++}`);
      params.push((data as any).runWebservices);
    }

    if ((data as any).enableApiKey !== undefined) {
      updates.push(`enable_api_key = $${paramIndex++}`);
      params.push((data as any).enableApiKey);
    }

    if (updates.length === 0) {
      return {
        success: false,
        message: 'No fields to update'
      };
    }

    updates.push(`date_updated = NOW()`);
    updates.push(`update_id = $${paramIndex++}`);
    params.push(updaterId);

    params.push(userId);

    const updateQuery = `
      UPDATE user_account
      SET ${updates.join(', ')}
      WHERE user_id = $${paramIndex}
    `;

    await client.query(updateQuery, params);

    // Handle role change: update study_user_role for the user's active study
    if ((data as any).role) {
      const newRole = (data as any).role;
      const roleNameMap: Record<string, string> = {
        'admin': 'admin',
        'coordinator': 'coordinator',
        'investigator': 'Investigator',
        'monitor': 'monitor',
        'data_entry': 'ra',
        'ra': 'ra',
        'viewer': 'ra'
      };
      const lcRoleName = roleNameMap[newRole.toLowerCase()] || newRole;

      // Get the user's username
      const userNameResult = await client.query(
        `SELECT user_name, active_study FROM user_account WHERE user_id = $1`,
        [userId]
      );
      if (userNameResult.rows.length > 0) {
        const userName = userNameResult.rows[0].user_name;
        const activeStudy = userNameResult.rows[0].active_study || 1;

        // Update existing role or insert new one for the active study
        const existingRole = await client.query(
          `SELECT role_id FROM study_user_role WHERE user_name = $1 AND study_id = $2 AND status_id = 1`,
          [userName, activeStudy]
        );
        if (existingRole.rows.length > 0) {
          await client.query(
            `UPDATE study_user_role SET role_name = $1, date_updated = NOW(), update_id = $2
             WHERE user_name = $3 AND study_id = $4 AND status_id = 1`,
            [lcRoleName, updaterId, userName, activeStudy]
          );
        } else {
          await client.query(
            `INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, date_created, user_name)
             VALUES ($1, $2, 1, $3, NOW(), $4)`,
            [lcRoleName, activeStudy, updaterId, userName]
          );
        }

        // Also update user_type_id based on role
        const roleToUserType: Record<string, number> = {
          'admin': 1, 'coordinator': 2, 'investigator': 2,
          'monitor': 2, 'data_entry': 2, 'ra': 2, 'viewer': 2
        };
        const newUserTypeId = roleToUserType[newRole.toLowerCase()] || 2;
        await client.query(
          `UPDATE user_account SET user_type_id = $1 WHERE user_id = $2`,
          [newUserTypeId, userId]
        );

        logger.info('User role updated', { userId, userName, newRole: lcRoleName, studyId: activeStudy });
      }
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'user_account', $1, $2, 'User',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'User Updated' LIMIT 1)
      )
    `, [updaterId, userId]);

    await client.query('COMMIT');

    logger.info('User updated successfully', { userId });

    return {
      success: true,
      message: 'User updated successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update user error', { error: error.message, userId });

    return {
      success: false,
      message: `Failed to update user: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Soft delete user (disable)
 */
export const deleteUser = async (
  userId: number,
  deleterId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting user', { userId, deleterId });

  // Org-scoping: verify deleter and target share an org
  const orgCheck = await pool.query(
    `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
    [deleterId]
  );
  const deleterOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
  if (deleterOrgIds.length > 0) {
    const targetCheck = await pool.query(
      `SELECT 1 FROM acc_organization_member WHERE user_id = $1 AND organization_id = ANY($2::int[]) AND status = 'active' LIMIT 1`,
      [userId, deleterOrgIds]
    );
    if (targetCheck.rows.length === 0) {
      logger.warn('deleteUser org-scoping denied', { userId, deleterId, deleterOrgIds });
      return { success: false, message: 'User not found in your organization' };
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Soft delete (disable)
    await client.query(`
      UPDATE user_account
      SET enabled = false, date_updated = NOW(), update_id = $1
      WHERE user_id = $2
    `, [deleterId, userId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'user_account', $1, $2, 'User',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'User Updated' LIMIT 1)
      )
    `, [deleterId, userId]);

    await client.query('COMMIT');

    logger.info('User deleted successfully', { userId });

    return {
      success: true,
      message: 'User deleted successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Delete user error', { error: error.message, userId });

    return {
      success: false,
      message: `Failed to delete user: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Assign user to study with role
 * Note: roleName should match LibreClinica role names exactly
 * Valid role names: admin, coordinator, director, Investigator, ra, monitor, ra2
 */
export const assignUserToStudy = async (
  userId: number,
  studyId: number,
  roleName: string,
  assignerId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Assigning user to study', { userId, studyId, roleName });

  const client = await pool.connect();

  try {
    // Validate role name
    const role = getRoleByName(roleName);
    if (role.id === 0) {
      logger.warn('Invalid role name provided', { roleName });
      return {
        success: false,
        message: `Invalid role name: ${roleName}. Valid roles: ${ALL_ROLES.map(r => r.name).join(', ')}`
      };
    }

    await client.query('BEGIN');

    // Get username
    const userQuery = `SELECT user_name FROM user_account WHERE user_id = $1`;
    const userResult = await client.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'User not found'
      };
    }

    const username = userResult.rows[0].user_name;

    // Check if study is a site (has parent_study_id) to use appropriate role name
    const studyQuery = `SELECT parent_study_id FROM study WHERE study_id = $1`;
    const studyResult = await client.query(studyQuery, [studyId]);
    
    let finalRoleName = roleName;
    if (studyResult.rows.length > 0 && studyResult.rows[0].parent_study_id) {
      // This is a site - use site role names if appropriate
      const siteRoleName = SITE_ROLE_MAP[role.id];
      if (siteRoleName) {
        finalRoleName = siteRoleName;
        logger.debug('Using site role name', { originalRole: roleName, siteRole: finalRoleName });
      }
    }

    // Check if already assigned
    const existsQuery = `
      SELECT * FROM study_user_role
      WHERE user_name = $1 AND study_id = $2 AND status_id = 1
    `;
    const existsResult = await client.query(existsQuery, [username, studyId]);

    if (existsResult.rows.length > 0) {
      // Update role
      await client.query(`
        UPDATE study_user_role
        SET role_name = $1, date_updated = NOW(), update_id = $2
        WHERE user_name = $3 AND study_id = $4
      `, [finalRoleName, assignerId, username, studyId]);
    } else {
      // Insert new assignment
      await client.query(`
        INSERT INTO study_user_role (
          role_name, study_id, status_id, owner_id, date_created, user_name
        ) VALUES ($1, $2, 1, $3, NOW(), $4)
      `, [finalRoleName, studyId, assignerId, username]);
    }

    await client.query('COMMIT');

    logger.info('User assigned to study successfully', { userId, studyId, roleName: finalRoleName });

    return {
      success: true,
      message: 'User assigned to study successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Assign user to study error', { error: error.message });

    return {
      success: false,
      message: `Failed to assign user: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get all available roles
 */
export const getAvailableRoles = (): { id: number; name: string; description: string }[] => {
  return ALL_ROLES.map(role => ({
    id: role.id,
    name: role.name,
    description: role.description
  }));
};

/**
 * Get user's role for a specific study with permissions
 */
export const getUserStudyRole = async (
  userId: number,
  studyId: number
): Promise<{ roleName: string; canSubmitData: boolean; canExtractData: boolean; canManageStudy: boolean; canMonitor: boolean } | null> => {
  try {
    const query = `
      SELECT sur.role_name
      FROM study_user_role sur
      INNER JOIN user_account u ON sur.user_name = u.user_name
      WHERE u.user_id = $1 AND sur.study_id = $2 AND sur.status_id = 1
    `;
    
    const result = await pool.query(query, [userId, studyId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const roleName = result.rows[0].role_name;
    const role = getRoleByName(roleName);

    return {
      roleName,
      canSubmitData: role.canSubmitData,
      canExtractData: role.canExtractData,
      canManageStudy: role.canManageStudy,
      canMonitor: role.canMonitor
    };
  } catch (error: any) {
    logger.error('Get user study role error', { error: error.message, userId, studyId });
    return null;
  }
};

export default {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  assignUserToStudy,
  getAvailableRoles,
  getUserStudyRole
};

