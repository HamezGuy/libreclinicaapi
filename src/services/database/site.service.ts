/**
 * Site/Location Management Service
 * 
 * Manages study sites (locations) for multi-site clinical trials.
 * In LibreClinica, sites are stored as child studies with parent_study_id.
 * 
 * Features:
 * - CRUD operations for sites
 * - Patient-to-site assignment
 * - Site enrollment tracking
 * - Site staff management
 * 
 * Database Tables Used:
 * - study: Sites are child records with parent_study_id set
 * - study_subject: Patients are linked to sites via study_id
 * - study_user_role: Site staff assignments
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ============================================================================
// INTERFACES
// ============================================================================

export interface Site {
  id: number;
  siteNumber: string;
  siteName: string;
  description?: string;
  parentStudyId: number;
  parentStudyName?: string;
  status: 'active' | 'pending' | 'frozen' | 'locked' | 'completed';
  statusId: number;
  
  // Principal Investigator
  principalInvestigator?: string;
  
  // Facility Information
  facilityName?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  
  // Contact Information
  contactName?: string;
  contactDegree?: string;
  contactEmail?: string;
  contactPhone?: string;
  
  // Enrollment
  targetEnrollment: number;
  actualEnrollment: number;
  enrollmentPercentage: number;
  
  // Timestamps
  dateCreated: Date;
  dateUpdated?: Date;
  
  // OID
  ocOid?: string;
}

export interface CreateSiteRequest {
  parentStudyId: number;
  siteNumber: string;
  siteName: string;
  description?: string;
  principalInvestigator?: string;
  targetEnrollment?: number;
  
  // Facility
  facilityName?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  
  // Contact
  contactName?: string;
  contactDegree?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UpdateSiteRequest {
  siteName?: string;
  description?: string;
  principalInvestigator?: string;
  targetEnrollment?: number;
  statusId?: number;
  
  // Facility
  facilityName?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  
  // Contact
  contactName?: string;
  contactDegree?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface SitePatient {
  studySubjectId: number;
  label: string;
  secondaryLabel?: string;
  enrollmentDate?: string;
  status: string;
  currentPhase?: string;
  progress: number;
}

export interface SiteStaff {
  userId: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  assignedDate: Date;
  status: string;
}

// ============================================================================
// SITE CRUD OPERATIONS
// ============================================================================

/**
 * Get all sites for a study
 */
export const getSitesForStudy = async (
  parentStudyId: number,
  options?: { status?: string; includeStats?: boolean }
): Promise<{ success: boolean; data?: Site[]; message?: string }> => {
  logger.info('Getting sites for study', { parentStudyId, options });

  try {
    const query = `
      SELECT 
        s.study_id,
        s.unique_identifier,
        s.name,
        s.summary,
        s.parent_study_id,
        ps.name as parent_study_name,
        s.status_id,
        st.name as status_name,
        s.principal_investigator,
        s.facility_name,
        s.facility_city,
        s.facility_state,
        s.facility_zip,
        s.facility_country,
        s.facility_recruitment_status,
        s.facility_contact_name,
        s.facility_contact_degree,
        s.facility_contact_email,
        s.facility_contact_phone,
        s.expected_total_enrollment,
        s.date_created,
        s.date_updated,
        s.oc_oid,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as enrolled_subjects
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      LEFT JOIN study ps ON s.parent_study_id = ps.study_id
      WHERE s.parent_study_id = $1
      ${options?.status ? 'AND st.name = $2' : ''}
      ORDER BY s.name
    `;

    const params = options?.status 
      ? [parentStudyId, options.status]
      : [parentStudyId];

    const result = await pool.query(query, params);

    const sites: Site[] = result.rows.map(row => ({
      id: row.study_id,
      siteNumber: row.unique_identifier,
      siteName: row.name,
      description: row.summary || '',
      parentStudyId: row.parent_study_id,
      parentStudyName: row.parent_study_name,
      status: mapStatusIdToName(row.status_id),
      statusId: row.status_id,
      principalInvestigator: row.principal_investigator || '',
      facilityName: row.facility_name || '',
      facilityCity: row.facility_city || '',
      facilityState: row.facility_state || '',
      facilityZip: row.facility_zip || '',
      facilityCountry: row.facility_country || '',
      facilityRecruitmentStatus: row.facility_recruitment_status || '',
      contactName: row.facility_contact_name || '',
      contactDegree: row.facility_contact_degree || '',
      contactEmail: row.facility_contact_email || '',
      contactPhone: row.facility_contact_phone || '',
      targetEnrollment: row.expected_total_enrollment || 0,
      actualEnrollment: parseInt(row.enrolled_subjects) || 0,
      enrollmentPercentage: row.expected_total_enrollment > 0
        ? Math.round((parseInt(row.enrolled_subjects) / row.expected_total_enrollment) * 100)
        : 0,
      dateCreated: row.date_created,
      dateUpdated: row.date_updated,
      ocOid: row.oc_oid
    }));

    logger.info('Sites retrieved', { parentStudyId, count: sites.length });
    return { success: true, data: sites };
  } catch (error: any) {
    logger.error('Get sites error', { error: error.message, parentStudyId });
    return { success: false, message: error.message };
  }
};

/**
 * Get a single site by ID
 */
export const getSiteById = async (
  siteId: number
): Promise<{ success: boolean; data?: Site; message?: string }> => {
  logger.info('Getting site by ID', { siteId });

  try {
    const query = `
      SELECT 
        s.study_id,
        s.unique_identifier,
        s.name,
        s.summary,
        s.parent_study_id,
        ps.name as parent_study_name,
        s.status_id,
        st.name as status_name,
        s.principal_investigator,
        s.facility_name,
        s.facility_city,
        s.facility_state,
        s.facility_zip,
        s.facility_country,
        s.facility_recruitment_status,
        s.facility_contact_name,
        s.facility_contact_degree,
        s.facility_contact_email,
        s.facility_contact_phone,
        s.expected_total_enrollment,
        s.date_created,
        s.date_updated,
        s.oc_oid,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as enrolled_subjects
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      LEFT JOIN study ps ON s.parent_study_id = ps.study_id
      WHERE s.study_id = $1 AND s.parent_study_id IS NOT NULL
    `;

    const result = await pool.query(query, [siteId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Site not found' };
    }

    const row = result.rows[0];
    const site: Site = {
      id: row.study_id,
      siteNumber: row.unique_identifier,
      siteName: row.name,
      description: row.summary || '',
      parentStudyId: row.parent_study_id,
      parentStudyName: row.parent_study_name,
      status: mapStatusIdToName(row.status_id),
      statusId: row.status_id,
      principalInvestigator: row.principal_investigator || '',
      facilityName: row.facility_name || '',
      facilityCity: row.facility_city || '',
      facilityState: row.facility_state || '',
      facilityZip: row.facility_zip || '',
      facilityCountry: row.facility_country || '',
      facilityRecruitmentStatus: row.facility_recruitment_status || '',
      contactName: row.facility_contact_name || '',
      contactDegree: row.facility_contact_degree || '',
      contactEmail: row.facility_contact_email || '',
      contactPhone: row.facility_contact_phone || '',
      targetEnrollment: row.expected_total_enrollment || 0,
      actualEnrollment: parseInt(row.enrolled_subjects) || 0,
      enrollmentPercentage: row.expected_total_enrollment > 0
        ? Math.round((parseInt(row.enrolled_subjects) / row.expected_total_enrollment) * 100)
        : 0,
      dateCreated: row.date_created,
      dateUpdated: row.date_updated,
      ocOid: row.oc_oid
    };

    return { success: true, data: site };
  } catch (error: any) {
    logger.error('Get site by ID error', { error: error.message, siteId });
    return { success: false, message: error.message };
  }
};

/**
 * Create a new site (child study)
 */
export const createSite = async (
  request: CreateSiteRequest,
  userId: number
): Promise<{ success: boolean; siteId?: number; message?: string }> => {
  logger.info('Creating site', { request, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify parent study exists
    const parentCheck = await client.query(
      'SELECT study_id, name FROM study WHERE study_id = $1',
      [request.parentStudyId]
    );

    if (parentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Parent study not found' };
    }

    // Check for duplicate site number
    const duplicateCheck = await client.query(
      `SELECT study_id FROM study 
       WHERE unique_identifier = $1 AND parent_study_id = $2`,
      [request.siteNumber, request.parentStudyId]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Site with this number already exists in this study' };
    }

    // Generate OC OID
    const ocOid = `S_${request.siteNumber.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Insert site as child study
    const insertQuery = `
      INSERT INTO study (
        parent_study_id,
        unique_identifier,
        name,
        summary,
        principal_investigator,
        expected_total_enrollment,
        facility_name,
        facility_city,
        facility_state,
        facility_zip,
        facility_country,
        facility_recruitment_status,
        facility_contact_name,
        facility_contact_degree,
        facility_contact_email,
        facility_contact_phone,
        status_id,
        owner_id,
        date_created,
        oc_oid
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, 2, $17, NOW(), $18
      )
      RETURNING study_id
    `;

    const insertResult = await client.query(insertQuery, [
      request.parentStudyId,
      request.siteNumber,
      request.siteName,
      request.description || '',
      request.principalInvestigator || '',
      request.targetEnrollment || 0,
      request.facilityName || '',
      request.facilityCity || '',
      request.facilityState || '',
      request.facilityZip || '',
      request.facilityCountry || '',
      request.facilityRecruitmentStatus || 'not yet recruiting',
      request.contactName || '',
      request.contactDegree || '',
      request.contactEmail || '',
      request.contactPhone || '',
      userId,
      ocOid
    ]);

    const siteId = insertResult.rows[0].study_id;

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (NOW(), 'study', $1, $2, 'Site', 1)
    `, [userId, siteId]);

    await client.query('COMMIT');

    logger.info('Site created successfully', { siteId, siteName: request.siteName });
    return { success: true, siteId };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create site error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Update a site
 */
export const updateSite = async (
  siteId: number,
  updates: UpdateSiteRequest,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating site', { siteId, updates, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify site exists
    const siteCheck = await client.query(
      'SELECT study_id, name FROM study WHERE study_id = $1 AND parent_study_id IS NOT NULL',
      [siteId]
    );

    if (siteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Site not found' };
    }

    const oldName = siteCheck.rows[0].name;

    // Build dynamic update query
    const setClauses: string[] = ['date_updated = NOW()'];
    const params: any[] = [siteId, userId];
    let paramIndex = 3;

    if (updates.siteName) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(updates.siteName);
    }
    if (updates.description !== undefined) {
      setClauses.push(`summary = $${paramIndex++}`);
      params.push(updates.description);
    }
    if (updates.principalInvestigator !== undefined) {
      setClauses.push(`principal_investigator = $${paramIndex++}`);
      params.push(updates.principalInvestigator);
    }
    if (updates.targetEnrollment !== undefined) {
      setClauses.push(`expected_total_enrollment = $${paramIndex++}`);
      params.push(updates.targetEnrollment);
    }
    if (updates.statusId !== undefined) {
      setClauses.push(`status_id = $${paramIndex++}`);
      params.push(updates.statusId);
    }
    if (updates.facilityName !== undefined) {
      setClauses.push(`facility_name = $${paramIndex++}`);
      params.push(updates.facilityName);
    }
    if (updates.facilityCity !== undefined) {
      setClauses.push(`facility_city = $${paramIndex++}`);
      params.push(updates.facilityCity);
    }
    if (updates.facilityState !== undefined) {
      setClauses.push(`facility_state = $${paramIndex++}`);
      params.push(updates.facilityState);
    }
    if (updates.facilityZip !== undefined) {
      setClauses.push(`facility_zip = $${paramIndex++}`);
      params.push(updates.facilityZip);
    }
    if (updates.facilityCountry !== undefined) {
      setClauses.push(`facility_country = $${paramIndex++}`);
      params.push(updates.facilityCountry);
    }
    if (updates.facilityRecruitmentStatus !== undefined) {
      setClauses.push(`facility_recruitment_status = $${paramIndex++}`);
      params.push(updates.facilityRecruitmentStatus);
    }
    if (updates.contactName !== undefined) {
      setClauses.push(`facility_contact_name = $${paramIndex++}`);
      params.push(updates.contactName);
    }
    if (updates.contactDegree !== undefined) {
      setClauses.push(`facility_contact_degree = $${paramIndex++}`);
      params.push(updates.contactDegree);
    }
    if (updates.contactEmail !== undefined) {
      setClauses.push(`facility_contact_email = $${paramIndex++}`);
      params.push(updates.contactEmail);
    }
    if (updates.contactPhone !== undefined) {
      setClauses.push(`facility_contact_phone = $${paramIndex++}`);
      params.push(updates.contactPhone);
    }

    const updateQuery = `
      UPDATE study 
      SET ${setClauses.join(', ')}, update_id = $2
      WHERE study_id = $1
    `;

    await client.query(updateQuery, params);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id, old_value, new_value
      ) VALUES (NOW(), 'study', $1, $2, 'Site', 2, $3, $4)
    `, [userId, siteId, oldName, updates.siteName || oldName]);

    await client.query('COMMIT');

    logger.info('Site updated successfully', { siteId });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update site error', { error: error.message, siteId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Delete (soft-delete) a site
 */
export const deleteSite = async (
  siteId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting site', { siteId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify site exists
    const siteCheck = await client.query(
      'SELECT study_id, name FROM study WHERE study_id = $1 AND parent_study_id IS NOT NULL',
      [siteId]
    );

    if (siteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Site not found' };
    }

    // Check for enrolled patients
    const patientCheck = await client.query(
      'SELECT COUNT(*) as count FROM study_subject WHERE study_id = $1 AND status_id = 1',
      [siteId]
    );

    if (parseInt(patientCheck.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        message: 'Cannot delete site with enrolled patients. Transfer patients first.' 
      };
    }

    // Soft delete (status_id = 5 = removed in LibreClinica)
    await client.query(
      'UPDATE study SET status_id = 5, date_updated = NOW(), update_id = $2 WHERE study_id = $1',
      [siteId, userId]
    );

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (NOW(), 'study', $1, $2, 'Site', 3)
    `, [userId, siteId]);

    await client.query('COMMIT');

    logger.info('Site deleted successfully', { siteId });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Delete site error', { error: error.message, siteId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

// ============================================================================
// PATIENT-SITE ASSIGNMENT
// ============================================================================

/**
 * Get patients for a specific site
 */
export const getSitePatients = async (
  siteId: number,
  options?: { status?: string; page?: number; limit?: number }
): Promise<{ success: boolean; data?: SitePatient[]; total?: number; message?: string }> => {
  logger.info('Getting site patients', { siteId, options });

  try {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM study_subject ss
      WHERE ss.study_id = $1
      ${options?.status ? 'AND ss.status_id = $2' : ''}
    `;

    const countParams = options?.status 
      ? [siteId, getStatusIdFromName(options.status)]
      : [siteId];

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Data query
    const query = `
      SELECT 
        ss.study_subject_id,
        ss.label,
        ss.secondary_label,
        ss.enrollment_date,
        st.name as status_name,
        ss.status_id,
        (
          SELECT sed.name 
          FROM study_event se
          INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
          WHERE se.study_subject_id = ss.study_subject_id
          ORDER BY se.date_start DESC
          LIMIT 1
        ) as current_phase,
        (
          SELECT COUNT(*) 
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id AND ec.status_id = 2
        ) as completed_forms,
        (
          SELECT COUNT(*) 
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id
        ) as total_forms
      FROM study_subject ss
      INNER JOIN status st ON ss.status_id = st.status_id
      WHERE ss.study_id = $1
      ${options?.status ? 'AND ss.status_id = $2' : ''}
      ORDER BY ss.enrollment_date DESC, ss.label
      LIMIT $${options?.status ? 3 : 2} OFFSET $${options?.status ? 4 : 3}
    `;

    const params = options?.status
      ? [siteId, getStatusIdFromName(options.status), limit, offset]
      : [siteId, limit, offset];

    const result = await pool.query(query, params);

    const patients: SitePatient[] = result.rows.map(row => {
      const totalForms = parseInt(row.total_forms) || 1;
      const completedForms = parseInt(row.completed_forms) || 0;
      return {
        studySubjectId: row.study_subject_id,
        label: row.label,
        secondaryLabel: row.secondary_label,
        enrollmentDate: row.enrollment_date,
        status: row.status_name,
        currentPhase: row.current_phase || 'Not Started',
        progress: Math.round((completedForms / totalForms) * 100)
      };
    });

    return { success: true, data: patients, total };
  } catch (error: any) {
    logger.error('Get site patients error', { error: error.message, siteId });
    return { success: false, message: error.message };
  }
};

/**
 * Transfer a patient to a different site
 */
export const transferPatientToSite = async (
  studySubjectId: number,
  targetSiteId: number,
  reason: string,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Transferring patient to site', { studySubjectId, targetSiteId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify patient exists
    const patientCheck = await client.query(
      'SELECT study_subject_id, study_id, label FROM study_subject WHERE study_subject_id = $1',
      [studySubjectId]
    );

    if (patientCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Patient not found' };
    }

    const currentSiteId = patientCheck.rows[0].study_id;
    const patientLabel = patientCheck.rows[0].label;

    // Verify target site exists and is a valid site (has parent)
    const siteCheck = await client.query(
      'SELECT study_id, name, parent_study_id FROM study WHERE study_id = $1',
      [targetSiteId]
    );

    if (siteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Target site not found' };
    }

    // Verify both sites belong to the same parent study
    const currentSiteResult = await client.query(
      'SELECT parent_study_id FROM study WHERE study_id = $1',
      [currentSiteId]
    );

    const currentParent = currentSiteResult.rows[0]?.parent_study_id || currentSiteId;
    const targetParent = siteCheck.rows[0].parent_study_id || targetSiteId;

    if (currentParent !== targetParent) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Cannot transfer between different studies' };
    }

    // Update patient's site
    await client.query(
      'UPDATE study_subject SET study_id = $1, date_updated = NOW(), update_id = $3 WHERE study_subject_id = $2',
      [targetSiteId, studySubjectId, userId]
    );

    // Log audit event with reason
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id, reason_for_change
      ) VALUES (NOW(), 'study_subject', $1, $2, 'Subject Transfer', 2, $3)
    `, [userId, studySubjectId, reason]);

    await client.query('COMMIT');

    logger.info('Patient transferred successfully', { 
      studySubjectId, 
      fromSite: currentSiteId, 
      toSite: targetSiteId 
    });

    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Transfer patient error', { error: error.message, studySubjectId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get site staff/users
 */
export const getSiteStaff = async (
  siteId: number
): Promise<{ success: boolean; data?: SiteStaff[]; message?: string }> => {
  logger.info('Getting site staff', { siteId });

  try {
    const query = `
      SELECT 
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        u.email,
        sur.role_name,
        sur.date_created,
        st.name as status_name
      FROM study_user_role sur
      INNER JOIN user_account u ON sur.user_name = u.user_name
      INNER JOIN status st ON sur.status_id = st.status_id
      WHERE sur.study_id = $1 AND sur.status_id = 1
      ORDER BY sur.role_name, u.last_name
    `;

    const result = await pool.query(query, [siteId]);

    const staff: SiteStaff[] = result.rows.map(row => ({
      userId: row.user_id,
      username: row.user_name,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      role: row.role_name,
      assignedDate: row.date_created,
      status: row.status_name
    }));

    return { success: true, data: staff };
  } catch (error: any) {
    logger.error('Get site staff error', { error: error.message, siteId });
    return { success: false, message: error.message };
  }
};

/**
 * Assign staff to a site
 */
export const assignStaffToSite = async (
  siteId: number,
  username: string,
  roleName: string,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Assigning staff to site', { siteId, username, roleName, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify user exists
    const userCheck = await client.query(
      'SELECT user_id FROM user_account WHERE user_name = $1 AND status_id = 1',
      [username]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'User not found or inactive' };
    }

    // Check if already assigned
    const existingCheck = await client.query(
      'SELECT sur_id FROM study_user_role WHERE study_id = $1 AND user_name = $2 AND status_id = 1',
      [siteId, username]
    );

    if (existingCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'User is already assigned to this site' };
    }

    // Insert assignment
    await client.query(`
      INSERT INTO study_user_role (
        study_id, user_name, role_name, status_id, owner_id, date_created
      ) VALUES ($1, $2, $3, 1, $4, NOW())
    `, [siteId, username, roleName, userId]);

    await client.query('COMMIT');

    logger.info('Staff assigned to site', { siteId, username, roleName });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Assign staff error', { error: error.message, siteId, username });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Remove staff from a site
 */
export const removeStaffFromSite = async (
  siteId: number,
  username: string,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Removing staff from site', { siteId, username, userId });

  try {
    const result = await pool.query(
      'UPDATE study_user_role SET status_id = 5, date_updated = NOW(), update_id = $3 WHERE study_id = $1 AND user_name = $2',
      [siteId, username, userId]
    );

    if (result.rowCount === 0) {
      return { success: false, message: 'Staff assignment not found' };
    }

    logger.info('Staff removed from site', { siteId, username });
    return { success: true };
  } catch (error: any) {
    logger.error('Remove staff error', { error: error.message, siteId, username });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// SITE STATISTICS
// ============================================================================

/**
 * Get aggregated statistics for all sites in a study
 */
export const getSiteStatistics = async (
  parentStudyId: number
): Promise<{ success: boolean; data?: any; message?: string }> => {
  logger.info('Getting site statistics', { parentStudyId });

  try {
    const query = `
      SELECT 
        COUNT(DISTINCT s.study_id) as total_sites,
        COUNT(DISTINCT CASE WHEN s.status_id = 1 THEN s.study_id END) as active_sites,
        COALESCE(SUM(s.expected_total_enrollment), 0) as total_target_enrollment,
        (
          SELECT COUNT(*) 
          FROM study_subject ss 
          WHERE ss.study_id IN (SELECT study_id FROM study WHERE parent_study_id = $1)
        ) as total_enrolled,
        (
          SELECT COUNT(*) 
          FROM study_user_role sur 
          WHERE sur.study_id IN (SELECT study_id FROM study WHERE parent_study_id = $1) 
          AND sur.status_id = 1
        ) as total_staff
      FROM study s
      WHERE s.parent_study_id = $1
    `;

    const result = await pool.query(query, [parentStudyId]);

    if (result.rows.length === 0) {
      return { success: true, data: {} };
    }

    const stats = result.rows[0];

    return {
      success: true,
      data: {
        totalSites: parseInt(stats.total_sites) || 0,
        activeSites: parseInt(stats.active_sites) || 0,
        targetEnrollment: parseInt(stats.total_target_enrollment) || 0,
        actualEnrollment: parseInt(stats.total_enrolled) || 0,
        enrollmentPercentage: stats.total_target_enrollment > 0
          ? Math.round((stats.total_enrolled / stats.total_target_enrollment) * 100)
          : 0,
        totalStaff: parseInt(stats.total_staff) || 0
      }
    };
  } catch (error: any) {
    logger.error('Get site statistics error', { error: error.message, parentStudyId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mapStatusIdToName(statusId: number): 'active' | 'pending' | 'frozen' | 'locked' | 'completed' {
  const statusMap: Record<number, 'active' | 'pending' | 'frozen' | 'locked' | 'completed'> = {
    1: 'active',
    2: 'pending',
    3: 'frozen',
    4: 'locked',
    5: 'completed'
  };
  return statusMap[statusId] || 'pending';
}

function getStatusIdFromName(status: string): number {
  const statusMap: Record<string, number> = {
    'active': 1,
    'available': 1,
    'pending': 2,
    'frozen': 3,
    'locked': 4,
    'completed': 5,
    'removed': 5
  };
  return statusMap[status.toLowerCase()] || 1;
}

export default {
  getSitesForStudy,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  getSitePatients,
  transferPatientToSite,
  getSiteStaff,
  assignStaffToSite,
  removeStaffFromSite,
  getSiteStatistics
};

