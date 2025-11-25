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
  }
): Promise<PaginatedResponse<User>> => {
  logger.info('Getting users', filters);

  try {
    const { studyId, role, enabled, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

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
        u.enabled,
        u.account_non_locked,
        u.date_created,
        u.date_lastvisit,
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
 */
export const getUserById = async (userId: number): Promise<User | null> => {
  logger.info('Getting user by ID', { userId });

  try {
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
 * Create new user
 */
export const createUser = async (
  data: {
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    institutionalAffiliation?: string;
    userTypeId?: number;
  },
  creatorId: number
): Promise<{ success: boolean; userId?: number; message?: string }> => {
  logger.info('Creating user', { username: data.username, creatorId });

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

    // Hash password
    const hashedPassword = hashPasswordMD5(data.password);

    // Insert user
    // Note: user_account table uses lock_counter NOT failed_login_attempts
    const insertQuery = `
      INSERT INTO user_account (
        user_name, first_name, last_name, email, passwd, passwd_timestamp,
        phone, institutional_affiliation, user_type_id, status_id, owner_id,
        date_created, enabled, account_non_locked, lock_counter
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), $6, $7, $8, 1, $9, NOW(), true, true, 0
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
      data.userTypeId || 2, // Default to user type
      creatorId
    ]);

    const userId = insertResult.rows[0].user_id;

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
 * Update user
 */
export const updateUser = async (
  userId: number,
  data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    institutionalAffiliation?: string;
    enabled?: boolean;
  },
  updaterId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating user', { userId, updaterId });

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

    if (data.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      params.push(data.enabled);
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

