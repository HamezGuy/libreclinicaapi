/**
 * Site Service (Database)
 *
 * Data-access layer for site (child-study) management.
 * Every function runs parameterised SQL against the pool and returns
 * camelCase rows thanks to the auto-camelization layer in database.ts.
 */

import { pool } from '../../config/database';

// ─── Read operations ─────────────────────────────────────────────────────────

export const getSites = async (
  studyId: number,
  status?: string
): Promise<Record<string, unknown>[]> => {
  let query = `
    SELECT 
      s.study_id as id,
      s.secondary_identifier as site_number,
      s.name as site_name,
      s.summary as description,
      s.parent_study_id,
      ps.name as parent_study_name,
      s.status_id,
      s.principal_investigator,
      s.facility_name, s.facility_address, s.facility_city, s.facility_state,
      s.facility_zip, s.facility_country, s.facility_recruitment_status,
      s.facility_contact_name as contact_name, s.facility_contact_degree as contact_degree,
      s.facility_contact_email as contact_email, s.facility_contact_phone as contact_phone,
      s.expected_total_enrollment,
      s.date_created, s.date_updated, s.oc_oid,
      (SELECT COUNT(*) FROM study_subject ss WHERE ss.study_id = s.study_id AND ss.status_id = 1) as enrolled_subjects
    FROM study s
    LEFT JOIN study ps ON s.parent_study_id = ps.study_id
    WHERE s.parent_study_id = $1
  `;
  const params: unknown[] = [studyId];

  if (status === 'active') {
    query += ` AND s.status_id = 1`;
  }

  query += ` ORDER BY s.secondary_identifier, s.name`;

  const result = await pool.query(query, params);
  return result.rows;
};

export const getSite = async (
  siteId: number
): Promise<Record<string, unknown> | null> => {
  const result = await pool.query(
    `SELECT s.*, ps.name as parent_study_name,
       (SELECT COUNT(*) FROM study_subject ss WHERE ss.study_id = s.study_id AND ss.status_id = 1) as enrolled_subjects
     FROM study s LEFT JOIN study ps ON s.parent_study_id = ps.study_id
     WHERE s.study_id = $1 AND s.parent_study_id IS NOT NULL`,
    [siteId]
  );
  return result.rows[0] ?? null;
};

export const getSiteStats = async (
  studyId: number
): Promise<Record<string, unknown>> => {
  const result = await pool.query(
    `SELECT 
       COUNT(DISTINCT s.study_id) as total_sites,
       COUNT(DISTINCT CASE WHEN s.status_id = 1 THEN s.study_id END) as active_sites,
       COALESCE(SUM(sub_counts.subject_count), 0) as total_subjects,
       COALESCE(SUM(s.expected_total_enrollment), 0) as target_enrollment
     FROM study s
     LEFT JOIN (
       SELECT study_id, COUNT(*) as subject_count 
       FROM study_subject WHERE status_id = 1 
       GROUP BY study_id
     ) sub_counts ON s.study_id = sub_counts.study_id
     WHERE s.parent_study_id = $1`,
    [studyId]
  );
  return result.rows[0] ?? {};
};

// ─── Site patients ───────────────────────────────────────────────────────────

export const getSitePatients = async (
  siteId: number,
  page: number,
  limit: number,
  status?: string
): Promise<{ rows: Record<string, unknown>[]; total: number }> => {
  let whereClause = `ss.study_id = $1`;
  const params: unknown[] = [siteId];

  if (status) {
    params.push(status === 'active' ? 1 : 5);
    whereClause += ` AND ss.status_id = $${params.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM study_subject ss WHERE ${whereClause}`,
    params
  );

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT ss.study_subject_id, ss.label, ss.secondary_label, ss.enrollment_date, ss.status_id,
       s.unique_identifier as person_id, s.gender, s.date_of_birth
     FROM study_subject ss
     LEFT JOIN subject s ON ss.subject_id = s.subject_id
     WHERE ${whereClause}
     ORDER BY ss.label
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows: result.rows,
    total: parseInt(countResult.rows[0].total as string) || 0,
  };
};

// ─── Site staff ──────────────────────────────────────────────────────────────

export const getSiteStaff = async (
  siteId: number
): Promise<Record<string, unknown>[]> => {
  const result = await pool.query(
    `SELECT u.user_id, u.user_name as username, u.first_name, u.last_name, u.email,
       sur.role_name as role, sur.status_id
     FROM study_user_role sur
     INNER JOIN user_account u ON sur.user_name = u.user_name
     WHERE sur.study_id = $1 AND sur.status_id = 1
     ORDER BY u.last_name, u.first_name`,
    [siteId]
  );
  return result.rows;
};

export const assignStaffToSite = async (
  siteId: number,
  staffUsername: string,
  role: string,
  ownerId: number
): Promise<void> => {
  await pool.query(
    `INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
     VALUES ($1, $2, 1, $3, $4, NOW())`,
    [role, siteId, ownerId, staffUsername]
  );
};

export const removeStaffFromSite = async (
  siteId: number,
  username: string,
  updatedBy: number
): Promise<void> => {
  await pool.query(
    `UPDATE study_user_role SET status_id = 5, date_updated = NOW(), update_id = $1
     WHERE study_id = $2 AND user_name = $3 AND status_id = 1`,
    [updatedBy, siteId, username]
  );
};

export const resolveStaffUsername = async (
  userId: number
): Promise<string | null> => {
  const result = await pool.query(
    `SELECT user_name FROM user_account WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0 ? (result.rows[0].userName as string) : null;
};

// ─── Write operations ────────────────────────────────────────────────────────

export interface CreateSiteData {
  parentStudyId: number;
  siteName: string;
  siteNumber?: string;
  principalInvestigator?: string;
  facilityName?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  expectedTotalEnrollment?: number;
  description?: string;
}

export const createSite = async (
  data: CreateSiteData,
  userId: number
): Promise<{ studyId: number } | null> => {
  const uniqueId = `${data.siteNumber || data.siteName.replace(/\s+/g, '_').substring(0, 20)}_${Date.now()}`;
  const ocOid = `S_${uniqueId}`.substring(0, 40);

  const result = await pool.query(
    `INSERT INTO study (parent_study_id, unique_identifier, secondary_identifier, name, summary, principal_investigator,
       facility_name, facility_address, facility_city, facility_state, facility_zip, facility_country,
       expected_total_enrollment, type_id, status_id, owner_id, date_created, oc_oid)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, type_id, 1, $14, NOW(), $15
     FROM study WHERE study_id = $1
     RETURNING study_id`,
    [
      data.parentStudyId, uniqueId, data.siteNumber, data.siteName, data.description,
      data.principalInvestigator, data.facilityName, data.facilityAddress, data.facilityCity,
      data.facilityState, data.facilityZip, data.facilityCountry, data.expectedTotalEnrollment,
      userId, ocOid,
    ]
  );

  return result.rows.length > 0 ? { studyId: result.rows[0].studyId as number } : null;
};

export interface UpdateSiteData {
  siteName?: string;
  siteNumber?: string;
  principalInvestigator?: string;
  facilityName?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  expectedTotalEnrollment?: number;
  description?: string;
}

export const updateSite = async (
  siteId: number,
  data: UpdateSiteData,
  userId: number
): Promise<void> => {
  await pool.query(
    `UPDATE study SET name = COALESCE($1, name), secondary_identifier = COALESCE($2, secondary_identifier),
       principal_investigator = COALESCE($3, principal_investigator), facility_name = COALESCE($4, facility_name),
       facility_address = COALESCE($5, facility_address),
       facility_city = COALESCE($6, facility_city), facility_state = COALESCE($7, facility_state),
       facility_zip = COALESCE($8, facility_zip), facility_country = COALESCE($9, facility_country),
       expected_total_enrollment = COALESCE($10, expected_total_enrollment), summary = COALESCE($11, summary),
       update_id = $12, date_updated = NOW()
     WHERE study_id = $13 AND parent_study_id IS NOT NULL`,
    [
      data.siteName, data.siteNumber, data.principalInvestigator, data.facilityName,
      data.facilityAddress, data.facilityCity, data.facilityState, data.facilityZip,
      data.facilityCountry, data.expectedTotalEnrollment, data.description, userId, siteId,
    ]
  );
};

export const updateSiteStatus = async (
  siteId: number,
  statusId: number,
  userId: number
): Promise<void> => {
  await pool.query(
    `UPDATE study SET status_id = $1, update_id = $2, date_updated = NOW()
     WHERE study_id = $3 AND parent_study_id IS NOT NULL`,
    [statusId, userId, siteId]
  );
};

// ─── Transfer ────────────────────────────────────────────────────────────────

export interface TransferPatientData {
  studySubjectId: number;
  fromSiteId?: number;
  toSiteId: number;
  reason: string;
}

export const transferPatient = async (
  data: TransferPatientData,
  userId: number
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE study_subject SET study_id = $1, date_updated = NOW(), update_id = $2 WHERE study_subject_id = $3`,
      [data.toSiteId, userId, data.studySubjectId]
    );

    await client.query(
      `INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, audit_log_event_type_id, reason_for_change)
       VALUES (NOW(), 'study_subject', $1, $2, 'Site Transfer', $3, $4,
         (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1), $5)`,
      [userId, data.studySubjectId, data.fromSiteId?.toString() || '', data.toSiteId.toString(), data.reason]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
