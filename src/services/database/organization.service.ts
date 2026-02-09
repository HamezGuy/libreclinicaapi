/**
 * Organization Service
 * 
 * Manages organizations, memberships, invite codes, access requests, and invitations.
 * Uses acc_organization* custom tables.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import crypto from 'crypto';

// ============================================================================
// Organization CRUD
// ============================================================================

export const registerOrganization = async (
  data: any,
  ipAddress?: string
): Promise<{ success: boolean; data?: any; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const org = data.organizationDetails;
    const admin = data.adminDetails;

    // 1. Create organization
    const orgResult = await client.query(`
      INSERT INTO acc_organization (name, type, status, email, phone, website, street, city, state, postal_code, country, date_created)
      VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING organization_id
    `, [org.name, org.type || 'sponsor', org.email, org.phone, org.website, org.street, org.city, org.state, org.postalCode, org.country]);

    const organizationId = orgResult.rows[0].organization_id;

    // 2. Create admin user in user_account (LibreClinica native table)
    const passwordHash = crypto.createHash('md5').update(admin.password).digest('hex');
    const username = admin.username || admin.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    // Pre-check: LibreClinica's user_account has no unique constraint on user_name or email
    const existingUser = await client.query(`SELECT user_id FROM user_account WHERE user_name = $1`, [username]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Username already exists' };
    }
    const existingEmail = await client.query(`SELECT user_id FROM user_account WHERE email = $1`, [admin.email]);
    if (existingEmail.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Email already exists' };
    }

    const userResult = await client.query(`
      INSERT INTO user_account (user_name, passwd, first_name, last_name, email, phone, institutional_affiliation, user_type_id, status_id, owner_id, date_created, enabled, account_non_locked)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, 1, NOW(), true, true)
      RETURNING user_id
    `, [username, passwordHash, admin.firstName, admin.lastName, admin.email, admin.phone, org.name]);

    const userId = userResult.rows[0].user_id;

    // 3. Set organization owner
    await client.query(`UPDATE acc_organization SET owner_id = $1, approved_by = $1, approved_at = NOW() WHERE organization_id = $2`, [userId, organizationId]);

    // 4. Create membership
    await client.query(`
      INSERT INTO acc_organization_member (organization_id, user_id, role, status, date_joined)
      VALUES ($1, $2, 'admin', 'active', NOW())
    `, [organizationId, userId]);

    // 5. Store role permissions if provided
    if (data.rolePermissions && Array.isArray(data.rolePermissions)) {
      for (const rp of data.rolePermissions) {
        for (const [key, value] of Object.entries(rp.permissions || {})) {
          await client.query(`
            INSERT INTO acc_role_permission (organization_id, role_name, permission_key, allowed, date_created)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (organization_id, role_name, permission_key) DO UPDATE SET allowed = $4, date_updated = NOW()
          `, [organizationId, rp.roleName, key, value]);
        }
      }
    }

    // 6. Generate JWT tokens for auto-login
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    try {
      const { buildJwtPayload } = await import('./auth.service');
      const { generateTokenPair } = await import('../../utils/jwt.util');
      const user = { user_id: userId, user_name: username, email: admin.email, first_name: admin.firstName, last_name: admin.lastName, user_type_id: 1, user_type: 'admin' } as any;
      const payload = await buildJwtPayload(user);
      const tokens = generateTokenPair(payload);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    } catch (e: any) {
      logger.warn('Could not generate auto-login tokens', { error: e.message });
    }

    await client.query('COMMIT');

    logger.info('Organization registered', { organizationId, userId, username });

    return {
      success: true,
      data: { organizationId, userId, accessToken, refreshToken },
      message: 'Organization registered successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Organization registration error', { error: error.message });
    if (error.constraint === 'user_account_user_name_key') {
      return { success: false, message: 'Username already exists' };
    }
    if (error.constraint === 'user_account_email_key') {
      return { success: false, message: 'Email already exists' };
    }
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

export const getMyOrganizations = async (userId: number): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  try {
    const result = await pool.query(`
      SELECT o.organization_id, o.name, o.type, o.status as org_status, m.role, m.status
      FROM acc_organization o
      INNER JOIN acc_organization_member m ON o.organization_id = m.organization_id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY o.name
    `, [userId]);
    return { success: true, data: result.rows.map(r => ({ organizationId: r.organization_id, name: r.name, type: r.type, orgStatus: r.org_status, role: r.role, status: r.status })) };
  } catch (error: any) {
    logger.error('getMyOrganizations error', { error: error.message, userId });
    return { success: false, data: [], message: error.message };
  }
};

export const listOrganizations = async (filters: any): Promise<{ success: boolean; data?: any[]; pagination?: any }> => {
  try {
    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (filters.status) { where.push(`o.status = $${idx++}`); params.push(filters.status); }
    if (filters.type) { where.push(`o.type = $${idx++}`); params.push(filters.type); }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM acc_organization o ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const result = await pool.query(`SELECT * FROM acc_organization o ${whereClause} ORDER BY o.date_created DESC LIMIT $${idx++} OFFSET $${idx}`, params);

    return { success: true, data: result.rows, pagination: { total, page, limit } };
  } catch (error: any) {
    logger.error('listOrganizations error', { error: error.message });
    return { success: true, data: [], pagination: { total: 0, page: 1, limit: 20 } };
  }
};

export const listPublicOrganizations = async (): Promise<{ success: boolean; data?: any[] }> => {
  try {
    const result = await pool.query(`
      SELECT organization_id, name, type, city, country
      FROM acc_organization
      WHERE status = 'active'
      ORDER BY name
      LIMIT 200
    `);
    return {
      success: true,
      data: result.rows.map(r => ({
        organizationId: r.organization_id,
        name: r.name,
        type: r.type,
        city: r.city,
        country: r.country
      }))
    };
  } catch (error: any) {
    logger.error('listPublicOrganizations error', { error: error.message });
    return { success: true, data: [] };
  }
};

export const getOrganization = async (orgId: number): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    const result = await pool.query(`SELECT * FROM acc_organization WHERE organization_id = $1`, [orgId]);
    if (result.rows.length === 0) return { success: false, message: 'Organization not found' };
    return { success: true, data: result.rows[0] };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const updateOrganizationStatus = async (orgId: number, status: string, userId: number, notes?: string): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`UPDATE acc_organization SET status = $1, approved_by = $2, approved_at = NOW(), date_updated = NOW() WHERE organization_id = $3`, [status, userId, orgId]);
    return { success: true, message: 'Status updated' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Members
// ============================================================================

export const addMember = async (orgId: number, memberData: any, creatorId: number): Promise<{ success: boolean; data?: any; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pre-check: LibreClinica's user_account has no unique constraint on user_name or email
    const existingUser = await client.query(`SELECT user_id FROM user_account WHERE user_name = $1`, [memberData.username]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Username already exists' };
    }
    const existingEmail = await client.query(`SELECT user_id FROM user_account WHERE email = $1`, [memberData.email]);
    if (existingEmail.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Email already exists' };
    }

    const passwordHash = crypto.createHash('md5').update(memberData.password).digest('hex');
    const userResult = await client.query(`
      INSERT INTO user_account (user_name, passwd, first_name, last_name, email, phone, institutional_affiliation, user_type_id, status_id, owner_id, date_created, enabled, account_non_locked)
      VALUES ($1, $2, $3, $4, $5, $6, (SELECT name FROM acc_organization WHERE organization_id = $7), 2, 1, $8, NOW(), true, true)
      RETURNING user_id
    `, [memberData.username, passwordHash, memberData.firstName, memberData.lastName, memberData.email, memberData.phone, orgId, creatorId]);
    const userId = userResult.rows[0].user_id;

    const memResult = await client.query(`
      INSERT INTO acc_organization_member (organization_id, user_id, role, status, date_joined)
      VALUES ($1, $2, $3, 'active', NOW()) RETURNING member_id
    `, [orgId, userId, memberData.role || 'member']);

    await client.query('COMMIT');
    return { success: true, data: { userId, membershipId: memResult.rows[0].member_id } };
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.constraint === 'user_account_user_name_key') return { success: false, message: 'Username already exists' };
    if (error.constraint === 'user_account_email_key') return { success: false, message: 'Email already exists' };
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

export const getMembers = async (orgId: number): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  try {
    const result = await pool.query(`
      SELECT u.user_id, u.user_name as username, u.first_name, u.last_name, u.email, m.role, m.status, m.date_joined
      FROM acc_organization_member m
      INNER JOIN user_account u ON m.user_id = u.user_id
      WHERE m.organization_id = $1 AND m.status = 'active' ORDER BY m.date_joined
    `, [orgId]);
    return { success: true, data: result.rows.map(r => ({ userId: r.user_id, username: r.username, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, status: r.status, dateJoined: r.date_joined })) };
  } catch (error: any) {
    logger.error('getMembers error', { error: error.message, orgId });
    return { success: false, data: [], message: error.message };
  }
};

export const updateMemberRole = async (orgId: number, userId: number, role: string): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`UPDATE acc_organization_member SET role = $1, date_updated = NOW() WHERE organization_id = $2 AND user_id = $3`, [role, orgId, userId]);
    return { success: true, message: 'Role updated' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const removeMember = async (orgId: number, userId: number, reason: string): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`UPDATE acc_organization_member SET status = 'removed', date_updated = NOW() WHERE organization_id = $1 AND user_id = $2`, [orgId, userId]);
    await pool.query(`UPDATE user_account SET status_id = 5, date_updated = CURRENT_DATE WHERE user_id = $1`, [userId]);
    logger.info('Member removed', { orgId, userId, reason });
    return { success: true, message: 'Member removed' };
  } catch (error: any) {
    logger.error('removeMember error', { error: error.message, orgId, userId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Codes
// ============================================================================

export const validateCode = async (code: string): Promise<{ success: boolean; isValid: boolean; organizationId?: number; organizationName?: string; defaultRole?: string; message?: string }> => {
  try {
    const result = await pool.query(`
      SELECT c.*, o.name as organization_name FROM acc_organization_code c
      INNER JOIN acc_organization o ON c.organization_id = o.organization_id
      WHERE c.code = $1 AND c.is_active = true
    `, [code.toUpperCase().replace(/[-\s]/g, '')]);
    if (result.rows.length === 0) return { success: true, isValid: false, message: 'Invalid code' };
    const row = result.rows[0];
    if (row.max_uses && row.current_uses >= row.max_uses) return { success: true, isValid: false, message: 'Code has reached maximum uses' };
    if (row.expires_at && new Date(row.expires_at) < new Date()) return { success: true, isValid: false, message: 'Code has expired' };
    return { success: true, isValid: true, organizationId: row.organization_id, organizationName: row.organization_name, defaultRole: row.default_role };
  } catch (error: any) {
    return { success: false, isValid: false, message: error.message };
  }
};

export const registerWithCode = async (data: any): Promise<{ success: boolean; data?: any; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const codeResult = await client.query(`SELECT * FROM acc_organization_code WHERE code = $1 AND is_active = true`, [data.code.toUpperCase().replace(/[-\s]/g, '')]);
    if (codeResult.rows.length === 0) { await client.query('ROLLBACK'); return { success: false, message: 'Invalid code' }; }
    const codeRow = codeResult.rows[0];

    const passwordHash = crypto.createHash('md5').update(data.password).digest('hex');
    const username = data.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    // Pre-check for duplicate username/email
    const existingUser = await client.query(`SELECT user_id FROM user_account WHERE user_name = $1`, [username]);
    if (existingUser.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Username already exists' }; }
    const existingEmail = await client.query(`SELECT user_id FROM user_account WHERE email = $1`, [data.email]);
    if (existingEmail.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Email already exists' }; }

    const userResult = await client.query(`
      INSERT INTO user_account (user_name, passwd, first_name, last_name, email, phone, user_type_id, status_id, owner_id, date_created, enabled, account_non_locked)
      VALUES ($1, $2, $3, $4, $5, $6, 2, 1, 1, NOW(), true, true) RETURNING user_id
    `, [username, passwordHash, data.firstName, data.lastName, data.email, data.phone]);
    const userId = userResult.rows[0].user_id;

    await client.query(`INSERT INTO acc_organization_member (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [codeRow.organization_id, userId, codeRow.default_role || 'data_entry']);
    await client.query(`UPDATE acc_organization_code SET current_uses = current_uses + 1 WHERE code_id = $1`, [codeRow.code_id]);

    await client.query('COMMIT');
    return { success: true, data: { userId, organizationId: codeRow.organization_id } };
  } catch (error: any) {
    await client.query('ROLLBACK');
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

export const generateCode = async (orgId: number, creatorId: number, data: any): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 12);
    const formatted = `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8)}`;
    const result = await pool.query(`
      INSERT INTO acc_organization_code (code, organization_id, max_uses, expires_at, default_role, created_by, date_created)
      VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING code_id
    `, [code, orgId, data.maxUses, data.expiresAt, data.defaultRole || 'data_entry', creatorId]);
    return { success: true, data: { code: formatted, codeId: result.rows[0].code_id } };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const listCodes = async (orgId: number): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  try {
    const result = await pool.query(`SELECT * FROM acc_organization_code WHERE organization_id = $1 ORDER BY date_created DESC`, [orgId]);
    return { success: true, data: result.rows };
  } catch (error: any) {
    logger.error('listCodes error', { error: error.message, orgId });
    return { success: false, data: [], message: error.message };
  }
};

export const deactivateCode = async (orgId: number, codeId: number): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`UPDATE acc_organization_code SET is_active = false WHERE code_id = $1 AND organization_id = $2`, [codeId, orgId]);
    return { success: true, message: 'Code deactivated' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Access Requests
// ============================================================================

export const createAccessRequest = async (data: any): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    const result = await pool.query(`
      INSERT INTO acc_access_request (email, first_name, last_name, phone, organization_name, professional_title, credentials, reason, organization_id, requested_role, date_created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING request_id
    `, [data.email, data.firstName, data.lastName, data.phone, data.organizationName, data.professionalTitle, data.credentials, data.reason, data.organizationId, data.requestedRole || 'data_entry']);
    return { success: true, data: { requestId: result.rows[0].request_id } };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const listAccessRequests = async (filters: any): Promise<{ success: boolean; data?: any[]; pagination?: any }> => {
  try {
    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (filters.status) { where.push(`status = $${idx++}`); params.push(filters.status); }
    if (filters.organizationId) { where.push(`organization_id = $${idx++}`); params.push(filters.organizationId); }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM acc_access_request ${whereClause}`, params);
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(`SELECT * FROM acc_access_request ${whereClause} ORDER BY date_created DESC LIMIT $${idx++} OFFSET $${idx}`, params);

    return { success: true, data: result.rows, pagination: { total: parseInt(countResult.rows[0].total), page, limit } };
  } catch (error: any) {
    return { success: true, data: [], pagination: { total: 0, page: 1, limit: 20 } };
  }
};

export const reviewAccessRequest = async (requestId: number, decision: string, reviewerId: number, notes?: string, password?: string): Promise<{ success: boolean; data?: any; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE acc_access_request SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3 WHERE request_id = $4`, [decision, reviewerId, notes, requestId]);

    let userId;
    let tempPassword: string | undefined;
    if (decision === 'approved') {
      const req = await client.query(`SELECT * FROM acc_access_request WHERE request_id = $1`, [requestId]);
      if (req.rows.length > 0) {
        const r = req.rows[0];
        // Use admin-provided password, or generate a temporary one and return it
        if (password) {
          tempPassword = password;
        } else {
          tempPassword = crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'A1!';
        }
        const passwordHash = crypto.createHash('md5').update(tempPassword).digest('hex');
        const username = r.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

        // Pre-check for duplicate username/email
        const existingUser = await client.query(`SELECT user_id FROM user_account WHERE user_name = $1`, [username]);
        if (existingUser.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Username already exists for this email prefix' }; }
        const existingEmail = await client.query(`SELECT user_id FROM user_account WHERE email = $1`, [r.email]);
        if (existingEmail.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Email already exists' }; }

        const userResult = await client.query(`
          INSERT INTO user_account (user_name, passwd, first_name, last_name, email, phone, user_type_id, status_id, owner_id, date_created, enabled, account_non_locked)
          VALUES ($1, $2, $3, $4, $5, $6, 2, 1, $7, NOW(), true, true) RETURNING user_id
        `, [username, passwordHash, r.first_name, r.last_name, r.email, r.phone, reviewerId]);
        userId = userResult.rows[0].user_id;
        await client.query(`UPDATE acc_access_request SET user_id = $1 WHERE request_id = $2`, [userId, requestId]);

        if (r.organization_id) {
          await client.query(`INSERT INTO acc_organization_member (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [r.organization_id, userId, r.requested_role || 'data_entry']);
        }
      }
    }
    await client.query('COMMIT');
    return { success: true, data: { userId, username: userId ? (await pool.query(`SELECT user_name FROM user_account WHERE user_id = $1`, [userId])).rows[0]?.user_name : undefined, tempPassword }, message: `Request ${decision}` };
  } catch (error: any) {
    await client.query('ROLLBACK');
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

// ============================================================================
// Invitations
// ============================================================================

export const createInvitation = async (data: any, invitedById: number): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (data.expiresInDays || 7) * 86400000);
    const result = await pool.query(`
      INSERT INTO acc_user_invitation (email, token, organization_id, study_id, role, expires_at, invited_by, message, date_created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING invitation_id
    `, [data.email, token, data.organizationId, data.studyId, data.role || 'data_entry', expiresAt, invitedById, data.message]);
    const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/register/invitation/${token}`;
    return { success: true, data: { token, invitationId: result.rows[0].invitation_id, invitationLink } };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};

export const validateInvitation = async (token: string): Promise<any> => {
  try {
    const result = await pool.query(`
      SELECT i.*, o.name as organization_name, s.name as study_name, u.first_name || ' ' || u.last_name as inviter_name
      FROM acc_user_invitation i
      LEFT JOIN acc_organization o ON i.organization_id = o.organization_id
      LEFT JOIN study s ON i.study_id = s.study_id
      LEFT JOIN user_account u ON i.invited_by = u.user_id
      WHERE i.token = $1
    `, [token]);
    if (result.rows.length === 0) return { success: true, isValid: false, message: 'Invalid invitation' };
    const inv = result.rows[0];
    if (inv.status !== 'pending') return { success: true, isValid: false, message: 'Invitation already used' };
    if (new Date(inv.expires_at) < new Date()) return { success: true, isValid: false, message: 'Invitation expired' };
    return { success: true, isValid: true, email: inv.email, organizationId: inv.organization_id, organizationName: inv.organization_name, studyId: inv.study_id, studyName: inv.study_name, role: inv.role, inviterName: inv.inviter_name };
  } catch (error: any) {
    return { success: false, isValid: false, message: error.message };
  }
};

export const acceptInvitation = async (token: string, data: any): Promise<{ success: boolean; data?: any; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query(`SELECT * FROM acc_user_invitation WHERE token = $1 AND status = 'pending'`, [token]);
    if (inv.rows.length === 0) { await client.query('ROLLBACK'); return { success: false, message: 'Invalid or expired invitation' }; }
    const invitation = inv.rows[0];
    if (new Date(invitation.expires_at) < new Date()) { await client.query('ROLLBACK'); return { success: false, message: 'Invitation expired' }; }

    const passwordHash = crypto.createHash('md5').update(data.password).digest('hex');
    const username = invitation.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    // Pre-check for duplicate username/email
    const existingUser = await client.query(`SELECT user_id FROM user_account WHERE user_name = $1`, [username]);
    if (existingUser.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Username already exists' }; }
    const existingEmail = await client.query(`SELECT user_id FROM user_account WHERE email = $1`, [invitation.email]);
    if (existingEmail.rows.length > 0) { await client.query('ROLLBACK'); return { success: false, message: 'Email already exists' }; }

    const userResult = await client.query(`
      INSERT INTO user_account (user_name, passwd, first_name, last_name, email, phone, user_type_id, status_id, owner_id, date_created, enabled, account_non_locked)
      VALUES ($1, $2, $3, $4, $5, $6, 2, 1, 1, NOW(), true, true) RETURNING user_id
    `, [username, passwordHash, data.firstName, data.lastName, invitation.email, data.phone]);
    const userId = userResult.rows[0].user_id;

    await client.query(`UPDATE acc_user_invitation SET status = 'accepted', accepted_by = $1, accepted_at = NOW() WHERE invitation_id = $2`, [userId, invitation.invitation_id]);

    if (invitation.organization_id) {
      await client.query(`INSERT INTO acc_organization_member (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [invitation.organization_id, userId, invitation.role || 'data_entry']);
    }

    await client.query('COMMIT');
    return { success: true, data: { userId } };
  } catch (error: any) {
    await client.query('ROLLBACK');
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

// ============================================================================
// Role Permissions
// ============================================================================

export const getRolePermissions = async (orgId: number): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  try {
    const result = await pool.query(`SELECT role_name, permission_key, allowed FROM acc_role_permission WHERE organization_id = $1 ORDER BY role_name`, [orgId]);
    // Group by role
    const grouped: Record<string, any> = {};
    for (const row of result.rows) {
      if (!grouped[row.role_name]) grouped[row.role_name] = { roleName: row.role_name, displayName: row.role_name, permissions: {} };
      grouped[row.role_name].permissions[row.permission_key] = row.allowed;
    }
    return { success: true, data: Object.values(grouped) };
  } catch (error: any) {
    logger.error('getRolePermissions error', { error: error.message, orgId });
    return { success: false, data: [], message: error.message };
  }
};

export const updateRolePermissions = async (orgId: number, rolePermissions: any[]): Promise<{ success: boolean; message?: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const rp of rolePermissions) {
      for (const [key, value] of Object.entries(rp.permissions || {})) {
        await client.query(`
          INSERT INTO acc_role_permission (organization_id, role_name, permission_key, allowed, date_created)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (organization_id, role_name, permission_key) DO UPDATE SET allowed = $4, date_updated = NOW()
        `, [orgId, rp.roleName, key, value]);
      }
    }
    await client.query('COMMIT');
    return { success: true, message: 'Permissions updated' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

export default {
  registerOrganization, getMyOrganizations, listOrganizations, listPublicOrganizations, getOrganization, updateOrganizationStatus,
  addMember, getMembers, updateMemberRole, removeMember,
  validateCode, registerWithCode, generateCode, listCodes, deactivateCode,
  createAccessRequest, listAccessRequests, reviewAccessRequest,
  createInvitation, validateInvitation, acceptInvitation,
  getRolePermissions, updateRolePermissions
};
