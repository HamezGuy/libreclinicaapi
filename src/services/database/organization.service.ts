/**
 * Organization Service
 * 
 * Handles organization management, invite codes, access requests, and invitations
 * Integrates with LibreClinica's user_account and study tables
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { hashPasswordMD5, validatePassword } from '../../utils/password.util';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface Organization {
  organizationId: number;
  name: string;
  type: string;
  status: string;
  email: string;
  phone?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  ownerId?: number;
  approvedBy?: number;
  approvedAt?: Date;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface OrganizationMembership {
  membershipId: number;
  organizationId: number;
  userId: number;
  role: string;
  status: string;
  invitedBy?: number;
  dateCreated: Date;
}

export interface OrganizationCode {
  codeId: number;
  code: string;
  organizationId: number;
  organizationName?: string;
  maxUses?: number;
  currentUses: number;
  expiresAt?: Date;
  defaultRole: string;
  isActive: boolean;
  createdBy?: number;
  dateCreated: Date;
}

export interface AccessRequest {
  requestId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  organizationName?: string;
  professionalTitle?: string;
  credentials?: string;
  reason?: string;
  organizationId?: number;
  requestedRole: string;
  status: string;
  reviewedBy?: number;
  reviewedAt?: Date;
  reviewNotes?: string;
  userId?: number;
  dateCreated: Date;
}

export interface UserInvitation {
  invitationId: number;
  email: string;
  token: string;
  organizationId?: number;
  studyId?: number;
  role: string;
  status: string;
  expiresAt: Date;
  invitedBy?: number;
  message?: string;
  acceptedBy?: number;
  acceptedAt?: Date;
  dateCreated: Date;
}

export interface CreateOrganizationDto {
  name: string;
  type: string;
  email: string;
  phone?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CreateAdminDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  professionalTitle?: string;
  credentials?: string;
  password: string;
}

// ============================================================================
// Organization CRUD
// ============================================================================

/**
 * Create a new organization with admin user
 * This is used for self-registration - creates org + first admin user in one transaction
 */
export const createOrganizationWithAdmin = async (
  orgData: CreateOrganizationDto,
  adminData: CreateAdminDto
): Promise<{ success: boolean; organizationId?: number; userId?: number; message?: string }> => {
  logger.info('Creating organization with admin', { orgName: orgData.name, adminEmail: adminData.email });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate password
    const passwordValidation = validatePassword(adminData.password);
    if (!passwordValidation.isValid) {
      return {
        success: false,
        message: `Password validation failed: ${passwordValidation.errors.join(', ')}`
      };
    }

    // Check if organization name already exists
    const orgExists = await client.query(
      'SELECT organization_id FROM acc_organization WHERE name = $1',
      [orgData.name]
    );
    if (orgExists.rows.length > 0) {
      return { success: false, message: 'Organization name already exists' };
    }

    // Check if org email already exists
    const orgEmailExists = await client.query(
      'SELECT organization_id FROM acc_organization WHERE email = $1',
      [orgData.email]
    );
    if (orgEmailExists.rows.length > 0) {
      return { success: false, message: 'Organization email already registered' };
    }

    // Check if admin email already exists in user_account
    const userEmailExists = await client.query(
      'SELECT user_id FROM user_account WHERE email = $1',
      [adminData.email]
    );
    if (userEmailExists.rows.length > 0) {
      return { success: false, message: 'Admin email already registered as a user' };
    }

    // Generate username from email
    let username = adminData.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Ensure username is unique
    const usernameExists = await client.query(
      'SELECT user_id FROM user_account WHERE user_name = $1',
      [username]
    );
    if (usernameExists.rows.length > 0) {
      username = `${username}${Date.now().toString().slice(-4)}`;
    }

    // Hash password (MD5 for LibreClinica compatibility)
    const hashedPassword = hashPasswordMD5(adminData.password);

    // Create user account first (so we have owner_id for organization)
    const userInsert = await client.query(`
      INSERT INTO user_account (
        user_name, first_name, last_name, email, passwd, passwd_timestamp,
        phone, institutional_affiliation, user_type_id, status_id, owner_id,
        date_created
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), $6, $7, 1, 1, 1, NOW()
      )
      RETURNING user_id
    `, [
      username,
      adminData.firstName,
      adminData.lastName,
      adminData.email,
      hashedPassword,
      adminData.phone || null,
      orgData.name  // Use org name as institutional affiliation
    ]);

    const userId = userInsert.rows[0].user_id;

    // Update owner_id to self
    await client.query('UPDATE user_account SET owner_id = $1 WHERE user_id = $1', [userId]);

    // Create organization with pending status (requires approval)
    const orgInsert = await client.query(`
      INSERT INTO acc_organization (
        name, type, status, email, phone, website,
        street, city, state, postal_code, country,
        owner_id, date_created, date_updated
      ) VALUES (
        $1, $2, 'pending', $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, NOW(), NOW()
      )
      RETURNING organization_id
    `, [
      orgData.name,
      orgData.type,
      orgData.email,
      orgData.phone || null,
      orgData.website || null,
      orgData.street || null,
      orgData.city || null,
      orgData.state || null,
      orgData.postalCode || null,
      orgData.country || null,
      userId
    ]);

    const organizationId = orgInsert.rows[0].organization_id;

    // Create organization membership for admin
    await client.query(`
      INSERT INTO acc_organization_membership (
        organization_id, user_id, role, status, date_created
      ) VALUES ($1, $2, 'owner', 'active', NOW())
    `, [organizationId, userId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'acc_organization', $1, $2, 'Organization', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'User Created' LIMIT 1)
      )
    `, [userId, organizationId, `Organization "${orgData.name}" created with admin "${adminData.email}"`]);

    await client.query('COMMIT');

    logger.info('Organization created successfully', { organizationId, userId, orgName: orgData.name });

    return {
      success: true,
      organizationId,
      userId,
      message: 'Organization registration submitted. Pending approval.'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create organization error', { error: error.message, orgData });

    // Handle specific postgres errors
    if (error.code === '23505') {
      if (error.constraint?.includes('org_name')) {
        return { success: false, message: 'Organization name already exists' };
      }
      if (error.constraint?.includes('org_email')) {
        return { success: false, message: 'Organization email already registered' };
      }
    }

    return {
      success: false,
      message: `Failed to create organization: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Get organization by ID
 */
export const getOrganizationById = async (organizationId: number): Promise<Organization | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        organization_id, name, type, status, email, phone, website,
        street, city, state, postal_code, country,
        owner_id, approved_by, approved_at, date_created, date_updated
      FROM acc_organization
      WHERE organization_id = $1
    `, [organizationId]);

    if (result.rows.length === 0) {
      return null;
    }

    return mapOrganizationRow(result.rows[0]);
  } catch (error: any) {
    logger.error('Get organization error', { error: error.message, organizationId });
    throw error;
  }
};

/**
 * Get organizations with optional filters
 */
export const getOrganizations = async (filters: {
  status?: string;
  type?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: Organization[]; total: number }> => {
  try {
    const { status, type, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM acc_organization ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Get data
    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT 
        organization_id, name, type, status, email, phone, website,
        street, city, state, postal_code, country,
        owner_id, approved_by, approved_at, date_created, date_updated
      FROM acc_organization
      ${whereClause}
      ORDER BY date_created DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, params);

    return {
      data: dataResult.rows.map(mapOrganizationRow),
      total
    };
  } catch (error: any) {
    logger.error('Get organizations error', { error: error.message });
    throw error;
  }
};

/**
 * Update organization status (approve/reject/suspend)
 */
export const updateOrganizationStatus = async (
  organizationId: number,
  status: 'active' | 'suspended' | 'inactive',
  approvedBy: number,
  notes?: string
): Promise<{ success: boolean; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateResult = await client.query(`
      UPDATE acc_organization
      SET status = $1, approved_by = $2, approved_at = NOW(), date_updated = NOW()
      WHERE organization_id = $3
      RETURNING name
    `, [status, approvedBy, organizationId]);

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Organization not found' };
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'acc_organization', $1, $2, 'Organization', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'User Updated' LIMIT 1)
      )
    `, [approvedBy, organizationId, `Status changed to ${status}${notes ? ': ' + notes : ''}`]);

    await client.query('COMMIT');

    logger.info('Organization status updated', { organizationId, status, approvedBy });

    return { success: true, message: `Organization ${status}` };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update organization status error', { error: error.message, organizationId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get user's organizations
 */
export const getUserOrganizations = async (userId: number): Promise<{
  organizationId: number;
  name: string;
  role: string;
  status: string;
}[]> => {
  try {
    const result = await pool.query(`
      SELECT o.organization_id, o.name, m.role, o.status
      FROM acc_organization o
      INNER JOIN acc_organization_membership m ON o.organization_id = m.organization_id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY o.name
    `, [userId]);

    return result.rows.map(row => ({
      organizationId: row.organization_id,
      name: row.name,
      role: row.role,
      status: row.status
    }));
  } catch (error: any) {
    logger.error('Get user organizations error', { error: error.message, userId });
    return [];
  }
};

// ============================================================================
// Organization Codes
// ============================================================================

/**
 * Generate a new organization invite code
 */
export const generateOrganizationCode = async (
  organizationId: number,
  createdBy: number,
  options: {
    maxUses?: number;
    expiresAt?: Date;
    defaultRole?: string;
  } = {}
): Promise<{ success: boolean; code?: string; codeId?: number; message?: string }> => {
  try {
    // Verify organization exists and is active
    const orgCheck = await pool.query(
      'SELECT status FROM acc_organization WHERE organization_id = $1',
      [organizationId]
    );
    if (orgCheck.rows.length === 0) {
      return { success: false, message: 'Organization not found' };
    }
    if (orgCheck.rows[0].status !== 'active') {
      return { success: false, message: 'Organization is not active' };
    }

    // Generate unique code (12 chars, uppercase alphanumeric)
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();

    const result = await pool.query(`
      INSERT INTO acc_organization_code (
        code, organization_id, max_uses, expires_at, default_role, is_active, created_by, date_created
      ) VALUES ($1, $2, $3, $4, $5, true, $6, NOW())
      RETURNING code_id
    `, [
      code,
      organizationId,
      options.maxUses || null,
      options.expiresAt || null,
      options.defaultRole || 'member',
      createdBy
    ]);

    logger.info('Organization code generated', { organizationId, codeId: result.rows[0].code_id });

    return {
      success: true,
      code,
      codeId: result.rows[0].code_id
    };
  } catch (error: any) {
    logger.error('Generate organization code error', { error: error.message, organizationId });
    return { success: false, message: error.message };
  }
};

/**
 * Validate an organization code
 */
export const validateOrganizationCode = async (code: string): Promise<{
  isValid: boolean;
  organizationId?: number;
  organizationName?: string;
  defaultRole?: string;
  message?: string;
}> => {
  try {
    const result = await pool.query(`
      SELECT 
        c.code_id, c.organization_id, c.max_uses, c.current_uses, 
        c.expires_at, c.default_role, c.is_active,
        o.name as organization_name, o.status as org_status
      FROM acc_organization_code c
      INNER JOIN acc_organization o ON c.organization_id = o.organization_id
      WHERE c.code = $1
    `, [code.toUpperCase()]);

    if (result.rows.length === 0) {
      return { isValid: false, message: 'Invalid code' };
    }

    const codeData = result.rows[0];

    // Check if code is active
    if (!codeData.is_active) {
      return { isValid: false, message: 'This code has been deactivated' };
    }

    // Check organization status
    if (codeData.org_status !== 'active') {
      return { isValid: false, message: 'Organization is not active' };
    }

    // Check expiration
    if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) {
      return { isValid: false, message: 'This code has expired' };
    }

    // Check usage limit
    if (codeData.max_uses !== null && codeData.current_uses >= codeData.max_uses) {
      return { isValid: false, message: 'This code has reached its usage limit' };
    }

    return {
      isValid: true,
      organizationId: codeData.organization_id,
      organizationName: codeData.organization_name,
      defaultRole: codeData.default_role
    };
  } catch (error: any) {
    logger.error('Validate organization code error', { error: error.message });
    return { isValid: false, message: 'Error validating code' };
  }
};

/**
 * Register a new user with an organization code
 */
export const registerWithCode = async (
  code: string,
  userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  },
  ipAddress?: string
): Promise<{ success: boolean; userId?: number; organizationId?: number; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate code first
    const validation = await validateOrganizationCode(code);
    if (!validation.isValid) {
      return { success: false, message: validation.message };
    }

    // Validate password
    const passwordValidation = validatePassword(userData.password);
    if (!passwordValidation.isValid) {
      return { success: false, message: `Password: ${passwordValidation.errors.join(', ')}` };
    }

    // Check if email already exists
    const emailExists = await client.query(
      'SELECT user_id FROM user_account WHERE email = $1',
      [userData.email]
    );
    if (emailExists.rows.length > 0) {
      return { success: false, message: 'Email already registered' };
    }

    // Generate username
    let username = userData.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const usernameCheck = await client.query(
      'SELECT user_id FROM user_account WHERE user_name = $1',
      [username]
    );
    if (usernameCheck.rows.length > 0) {
      username = `${username}${Date.now().toString().slice(-4)}`;
    }

    // Hash password
    const hashedPassword = hashPasswordMD5(userData.password);

    // Get code details
    const codeResult = await client.query(
      'SELECT code_id, organization_id, default_role FROM acc_organization_code WHERE code = $1',
      [code.toUpperCase()]
    );
    const codeData = codeResult.rows[0];

    // Create user account
    const userInsert = await client.query(`
      INSERT INTO user_account (
        user_name, first_name, last_name, email, passwd, passwd_timestamp,
        phone, user_type_id, status_id, owner_id, date_created
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), $6, 2, 1, 1, NOW()
      )
      RETURNING user_id
    `, [
      username,
      userData.firstName,
      userData.lastName,
      userData.email,
      hashedPassword,
      userData.phone || null
    ]);

    const userId = userInsert.rows[0].user_id;

    // Update owner_id to self
    await client.query('UPDATE user_account SET owner_id = $1 WHERE user_id = $1', [userId]);

    // Create organization membership
    await client.query(`
      INSERT INTO acc_organization_membership (
        organization_id, user_id, role, status, date_created
      ) VALUES ($1, $2, $3, 'active', NOW())
    `, [codeData.organization_id, userId, codeData.default_role]);

    // Update code usage
    await client.query(`
      UPDATE acc_organization_code
      SET current_uses = current_uses + 1, date_updated = NOW()
      WHERE code_id = $1
    `, [codeData.code_id]);

    // Log code usage
    await client.query(`
      INSERT INTO acc_organization_code_usage (code_id, user_id, used_at, ip_address)
      VALUES ($1, $2, NOW(), $3)
    `, [codeData.code_id, userId, ipAddress || null]);

    await client.query('COMMIT');

    logger.info('User registered with code', { userId, organizationId: codeData.organization_id });

    return {
      success: true,
      userId,
      organizationId: codeData.organization_id,
      message: 'Registration successful'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Register with code error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get organization codes
 */
export const getOrganizationCodes = async (organizationId: number): Promise<OrganizationCode[]> => {
  try {
    const result = await pool.query(`
      SELECT 
        c.code_id, c.code, c.organization_id, c.max_uses, c.current_uses,
        c.expires_at, c.default_role, c.is_active, c.created_by, c.date_created,
        o.name as organization_name
      FROM acc_organization_code c
      INNER JOIN acc_organization o ON c.organization_id = o.organization_id
      WHERE c.organization_id = $1
      ORDER BY c.date_created DESC
    `, [organizationId]);

    return result.rows.map(row => ({
      codeId: row.code_id,
      code: row.code,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      maxUses: row.max_uses,
      currentUses: row.current_uses,
      expiresAt: row.expires_at,
      defaultRole: row.default_role,
      isActive: row.is_active,
      createdBy: row.created_by,
      dateCreated: row.date_created
    }));
  } catch (error: any) {
    logger.error('Get organization codes error', { error: error.message, organizationId });
    return [];
  }
};

/**
 * Deactivate an organization code
 */
export const deactivateOrganizationCode = async (
  codeId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    const result = await pool.query(`
      UPDATE acc_organization_code
      SET is_active = false, date_updated = NOW()
      WHERE code_id = $1
      RETURNING organization_id
    `, [codeId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Code not found' };
    }

    logger.info('Organization code deactivated', { codeId, userId });

    return { success: true, message: 'Code deactivated' };
  } catch (error: any) {
    logger.error('Deactivate organization code error', { error: error.message, codeId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Access Requests
// ============================================================================

/**
 * Create an access request
 */
export const createAccessRequest = async (data: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  organizationName?: string;
  professionalTitle?: string;
  credentials?: string;
  reason?: string;
  organizationId?: number;
  requestedRole?: string;
}): Promise<{ success: boolean; requestId?: number; message?: string }> => {
  try {
    // Check if email already registered
    const emailExists = await pool.query(
      'SELECT user_id FROM user_account WHERE email = $1',
      [data.email]
    );
    if (emailExists.rows.length > 0) {
      return { success: false, message: 'Email already registered. Please login.' };
    }

    // Check for pending request with same email
    const pendingExists = await pool.query(
      `SELECT request_id FROM acc_access_request WHERE email = $1 AND status = 'pending'`,
      [data.email]
    );
    if (pendingExists.rows.length > 0) {
      return { success: false, message: 'You already have a pending access request' };
    }

    const result = await pool.query(`
      INSERT INTO acc_access_request (
        email, first_name, last_name, phone, organization_name,
        professional_title, credentials, reason,
        organization_id, requested_role, status, date_created
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
      RETURNING request_id
    `, [
      data.email,
      data.firstName,
      data.lastName,
      data.phone || null,
      data.organizationName || null,
      data.professionalTitle || null,
      data.credentials || null,
      data.reason || null,
      data.organizationId || null,
      data.requestedRole || 'member'
    ]);

    logger.info('Access request created', { requestId: result.rows[0].request_id, email: data.email });

    return {
      success: true,
      requestId: result.rows[0].request_id,
      message: 'Access request submitted. You will be notified once reviewed.'
    };
  } catch (error: any) {
    logger.error('Create access request error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get access requests with filters
 */
export const getAccessRequests = async (filters: {
  status?: string;
  organizationId?: number;
  page?: number;
  limit?: number;
}): Promise<{ data: AccessRequest[]; total: number }> => {
  try {
    const { status, organizationId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (organizationId) {
      conditions.push(`organization_id = $${paramIndex++}`);
      params.push(organizationId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM acc_access_request ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Get data
    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT *
      FROM acc_access_request
      ${whereClause}
      ORDER BY date_created DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, params);

    return {
      data: dataResult.rows.map(row => ({
        requestId: row.request_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        organizationName: row.organization_name,
        professionalTitle: row.professional_title,
        credentials: row.credentials,
        reason: row.reason,
        organizationId: row.organization_id,
        requestedRole: row.requested_role,
        status: row.status,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        reviewNotes: row.review_notes,
        userId: row.user_id,
        dateCreated: row.date_created
      })),
      total
    };
  } catch (error: any) {
    logger.error('Get access requests error', { error: error.message });
    throw error;
  }
};

/**
 * Review an access request (approve or reject)
 */
export const reviewAccessRequest = async (
  requestId: number,
  reviewedBy: number,
  decision: 'approved' | 'rejected',
  notes?: string,
  password?: string
): Promise<{ success: boolean; userId?: number; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get request details
    const requestResult = await client.query(
      'SELECT * FROM acc_access_request WHERE request_id = $1',
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      return { success: false, message: 'Access request not found' };
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      return { success: false, message: 'Request has already been reviewed' };
    }

    let userId: number | undefined;

    if (decision === 'approved') {
      // Generate password if not provided
      const userPassword = password || crypto.randomBytes(8).toString('hex') + '!@1A';
      
      // Validate password
      const passwordValidation = validatePassword(userPassword);
      if (!passwordValidation.isValid) {
        return { success: false, message: `Password: ${passwordValidation.errors.join(', ')}` };
      }

      // Generate username
      let username = request.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      const usernameCheck = await client.query(
        'SELECT user_id FROM user_account WHERE user_name = $1',
        [username]
      );
      if (usernameCheck.rows.length > 0) {
        username = `${username}${Date.now().toString().slice(-4)}`;
      }

      // Hash password
      const hashedPassword = hashPasswordMD5(userPassword);

      // Create user account
      const userInsert = await client.query(`
        INSERT INTO user_account (
          user_name, first_name, last_name, email, passwd, passwd_timestamp,
          phone, user_type_id, status_id, owner_id, date_created
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, 2, 1, $7, NOW())
        RETURNING user_id
      `, [
        username,
        request.first_name,
        request.last_name,
        request.email,
        hashedPassword,
        request.phone,
        reviewedBy
      ]);

      userId = userInsert.rows[0].user_id;

      // If organization specified, add membership
      if (request.organization_id) {
        await client.query(`
          INSERT INTO acc_organization_membership (
            organization_id, user_id, role, status, invited_by, date_created
          ) VALUES ($1, $2, $3, 'active', $4, NOW())
        `, [request.organization_id, userId, request.requested_role || 'member', reviewedBy]);
      }

      // TODO: Send welcome email with password
      logger.info('Access request approved - user created', { 
        requestId, 
        userId, 
        email: request.email,
        tempPassword: userPassword 
      });
    }

    // Update request status
    await client.query(`
      UPDATE acc_access_request
      SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3, user_id = $4, date_updated = NOW()
      WHERE request_id = $5
    `, [decision, reviewedBy, notes || null, userId || null, requestId]);

    await client.query('COMMIT');

    return {
      success: true,
      userId,
      message: decision === 'approved' ? 'Request approved and user created' : 'Request rejected'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Review access request error', { error: error.message, requestId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

// ============================================================================
// User Invitations
// ============================================================================

/**
 * Create a user invitation
 */
export const createInvitation = async (
  email: string,
  invitedBy: number,
  options: {
    organizationId?: number;
    studyId?: number;
    role?: string;
    message?: string;
    expiresInDays?: number;
  } = {}
): Promise<{ success: boolean; token?: string; invitationId?: number; message?: string }> => {
  try {
    // Check if email already registered
    const emailExists = await pool.query(
      'SELECT user_id FROM user_account WHERE email = $1',
      [email]
    );
    if (emailExists.rows.length > 0) {
      return { success: false, message: 'Email already registered' };
    }

    // Check for pending invitation
    const pendingExists = await pool.query(
      `SELECT invitation_id FROM acc_user_invitation WHERE email = $1 AND status = 'pending' AND expires_at > NOW()`,
      [email]
    );
    if (pendingExists.rows.length > 0) {
      return { success: false, message: 'A pending invitation already exists for this email' };
    }

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiration (default 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (options.expiresInDays || 7));

    const result = await pool.query(`
      INSERT INTO acc_user_invitation (
        email, token, organization_id, study_id, role,
        status, expires_at, invited_by, message, date_created
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW())
      RETURNING invitation_id
    `, [
      email,
      token,
      options.organizationId || null,
      options.studyId || null,
      options.role || 'member',
      expiresAt,
      invitedBy,
      options.message || null
    ]);

    logger.info('User invitation created', { invitationId: result.rows[0].invitation_id, email });

    return {
      success: true,
      token,
      invitationId: result.rows[0].invitation_id
    };
  } catch (error: any) {
    logger.error('Create invitation error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Validate an invitation token
 */
export const validateInvitation = async (token: string): Promise<{
  isValid: boolean;
  email?: string;
  organizationId?: number;
  organizationName?: string;
  studyId?: number;
  studyName?: string;
  role?: string;
  inviterName?: string;
  message?: string;
}> => {
  try {
    const result = await pool.query(`
      SELECT 
        i.*,
        o.name as organization_name,
        s.name as study_name,
        CONCAT(u.first_name, ' ', u.last_name) as inviter_name
      FROM acc_user_invitation i
      LEFT JOIN acc_organization o ON i.organization_id = o.organization_id
      LEFT JOIN study s ON i.study_id = s.study_id
      LEFT JOIN user_account u ON i.invited_by = u.user_id
      WHERE i.token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return { isValid: false };
    }

    const invitation = result.rows[0];

    if (invitation.status !== 'pending') {
      return { isValid: false };
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return { isValid: false };
    }

    return {
      isValid: true,
      email: invitation.email,
      organizationId: invitation.organization_id,
      organizationName: invitation.organization_name,
      studyId: invitation.study_id,
      studyName: invitation.study_name,
      role: invitation.role,
      inviterName: invitation.inviter_name,
      message: invitation.message
    };
  } catch (error: any) {
    logger.error('Validate invitation error', { error: error.message });
    return { isValid: false };
  }
};

/**
 * Accept an invitation and create user account
 */
export const acceptInvitation = async (
  token: string,
  userData: {
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }
): Promise<{ success: boolean; userId?: number; message?: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate invitation
    const validation = await validateInvitation(token);
    if (!validation.isValid || !validation.email) {
      return { success: false, message: 'Invalid or expired invitation' };
    }

    // Validate password
    const passwordValidation = validatePassword(userData.password);
    if (!passwordValidation.isValid) {
      return { success: false, message: `Password: ${passwordValidation.errors.join(', ')}` };
    }

    // Generate username
    let username = validation.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const usernameCheck = await client.query(
      'SELECT user_id FROM user_account WHERE user_name = $1',
      [username]
    );
    if (usernameCheck.rows.length > 0) {
      username = `${username}${Date.now().toString().slice(-4)}`;
    }

    // Hash password
    const hashedPassword = hashPasswordMD5(userData.password);

    // Get invitation details
    const invResult = await client.query(
      'SELECT invitation_id, organization_id, study_id, role, invited_by FROM acc_user_invitation WHERE token = $1',
      [token]
    );
    const invitation = invResult.rows[0];

    // Create user account
    const userInsert = await client.query(`
      INSERT INTO user_account (
        user_name, first_name, last_name, email, passwd, passwd_timestamp,
        phone, user_type_id, status_id, owner_id, date_created
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, 2, 1, $7, NOW())
      RETURNING user_id
    `, [
      username,
      userData.firstName,
      userData.lastName,
      validation.email,
      hashedPassword,
      userData.phone || null,
      invitation.invited_by
    ]);

    const userId = userInsert.rows[0].user_id;

    // Add organization membership if specified
    if (invitation.organization_id) {
      await client.query(`
        INSERT INTO acc_organization_membership (
          organization_id, user_id, role, status, invited_by, date_created
        ) VALUES ($1, $2, $3, 'active', $4, NOW())
      `, [invitation.organization_id, userId, invitation.role || 'member', invitation.invited_by]);
    }

    // Add study role if specified
    if (invitation.study_id) {
      await client.query(`
        INSERT INTO study_user_role (
          role_name, study_id, status_id, owner_id, date_created, user_name
        ) VALUES ($1, $2, 1, $3, NOW(), $4)
      `, [invitation.role || 'ra', invitation.study_id, invitation.invited_by, username]);
    }

    // Update invitation status
    await client.query(`
      UPDATE acc_user_invitation
      SET status = 'accepted', accepted_by = $1, accepted_at = NOW()
      WHERE invitation_id = $2
    `, [userId, invitation.invitation_id]);

    await client.query('COMMIT');

    logger.info('Invitation accepted', { invitationId: invitation.invitation_id, userId });

    return {
      success: true,
      userId,
      message: 'Account created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Accept invitation error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function mapOrganizationRow(row: any): Organization {
  return {
    organizationId: row.organization_id,
    name: row.name,
    type: row.type,
    status: row.status,
    email: row.email,
    phone: row.phone,
    website: row.website,
    street: row.street,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    ownerId: row.owner_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated
  };
}

export default {
  // Organizations
  createOrganizationWithAdmin,
  getOrganizationById,
  getOrganizations,
  updateOrganizationStatus,
  getUserOrganizations,
  // Codes
  generateOrganizationCode,
  validateOrganizationCode,
  registerWithCode,
  getOrganizationCodes,
  deactivateOrganizationCode,
  // Access Requests
  createAccessRequest,
  getAccessRequests,
  reviewAccessRequest,
  // Invitations
  createInvitation,
  validateInvitation,
  acceptInvitation
};

