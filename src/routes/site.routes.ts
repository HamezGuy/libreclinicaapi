/**
 * Site Routes
 * 
 * Sites in LibreClinica are child studies (study records with parent_study_id set).
 * This provides a dedicated API for site management operations.
 */

import express from 'express';
import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { pool } from '../config/database';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/sites/study/:studyId
 * Get all sites for a study
 */
router.get('/study/:studyId', asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;
  const { status } = req.query;

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
  const params: any[] = [studyId];

  if (status === 'active') {
    query += ` AND s.status_id = 1`;
  }

  query += ` ORDER BY s.secondary_identifier, s.name`;

  const result = await pool.query(query, params);

  const sites = result.rows.map(row => ({
    id: row.id,
    siteNumber: row.site_number || '',
    siteName: row.site_name,
    description: row.description,
    parentStudyId: row.parent_study_id,
    parentStudyName: row.parent_study_name,
    statusId: row.status_id,
    status: row.status_id === 1 ? 'active' : row.status_id === 6 ? 'locked' : row.status_id === 9 ? 'frozen' : 'inactive',
    principalInvestigator: row.principal_investigator,
    facilityName: row.facility_name,
    facilityAddress: row.facility_address,
    facilityCity: row.facility_city,
    facilityState: row.facility_state,
    facilityZip: row.facility_zip,
    facilityCountry: row.facility_country,
    facilityRecruitmentStatus: row.facility_recruitment_status,
    contactName: row.contact_name,
    contactDegree: row.contact_degree,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    expectedTotalEnrollment: row.expected_total_enrollment,
    enrolledSubjects: parseInt(row.enrolled_subjects) || 0,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    oid: row.oc_oid
  }));

  res.json({ success: true, data: sites });
}));

/**
 * GET /api/sites/:siteId
 * Get site details
 */
router.get('/:siteId', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const result = await pool.query(`
    SELECT s.*, ps.name as parent_study_name,
      (SELECT COUNT(*) FROM study_subject ss WHERE ss.study_id = s.study_id AND ss.status_id = 1) as enrolled_subjects
    FROM study s LEFT JOIN study ps ON s.parent_study_id = ps.study_id
    WHERE s.study_id = $1 AND s.parent_study_id IS NOT NULL
  `, [siteId]);

  if (result.rows.length === 0) {
    res.status(404).json({ success: false, message: 'Site not found' });
    return;
  }

  const row = result.rows[0];
  res.json({
    success: true,
    data: {
      id: row.study_id,
      siteNumber: row.secondary_identifier || '',
      siteName: row.name,
      description: row.summary,
      parentStudyId: row.parent_study_id,
      parentStudyName: row.parent_study_name,
      statusId: row.status_id,
      principalInvestigator: row.principal_investigator,
      facilityName: row.facility_name,
      facilityAddress: row.facility_address,
      facilityCity: row.facility_city,
      facilityState: row.facility_state,
      facilityZip: row.facility_zip,
      facilityCountry: row.facility_country,
      expectedTotalEnrollment: row.expected_total_enrollment,
      enrolledSubjects: parseInt(row.enrolled_subjects) || 0,
      dateCreated: row.date_created,
      dateUpdated: row.date_updated
    }
  });
}));

/**
 * POST /api/sites
 * Create a new site (child study)
 */
router.post('/', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { parentStudyId, siteName, siteNumber, principalInvestigator, facilityName, facilityAddress, facilityCity, facilityState, facilityZip, facilityCountry, expectedTotalEnrollment, description } = req.body;

  if (!parentStudyId || !siteName) {
    res.status(400).json({ success: false, message: 'parentStudyId and siteName are required' });
    return;
  }

  const uniqueId = `${siteNumber || siteName.replace(/\s+/g, '_').substring(0, 20)}_${Date.now()}`;

  const result = await pool.query(`
    INSERT INTO study (parent_study_id, unique_identifier, secondary_identifier, name, summary, principal_investigator,
      facility_name, facility_address, facility_city, facility_state, facility_zip, facility_country,
      expected_total_enrollment, type_id, status_id, owner_id, date_created)
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, type_id, 1, $14, NOW()
    FROM study WHERE study_id = $1
    RETURNING study_id
  `, [parentStudyId, uniqueId, siteNumber, siteName, description, principalInvestigator, facilityName, facilityAddress, facilityCity, facilityState, facilityZip, facilityCountry, expectedTotalEnrollment, user.userId]);

  if (result.rows.length === 0) {
    res.status(400).json({ success: false, message: 'Parent study not found' });
    return;
  }

  res.status(201).json({ success: true, data: { siteId: result.rows[0].study_id } });
}));

/**
 * PUT /api/sites/:siteId
 * Update a site
 */
router.put('/:siteId', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const user = (req as any).user;
  const { siteName, siteNumber, principalInvestigator, facilityName, facilityAddress, facilityCity, facilityState, facilityZip, facilityCountry, expectedTotalEnrollment, description } = req.body;

  await pool.query(`
    UPDATE study SET name = COALESCE($1, name), secondary_identifier = COALESCE($2, secondary_identifier),
      principal_investigator = COALESCE($3, principal_investigator), facility_name = COALESCE($4, facility_name),
      facility_address = COALESCE($5, facility_address),
      facility_city = COALESCE($6, facility_city), facility_state = COALESCE($7, facility_state),
      facility_zip = COALESCE($8, facility_zip), facility_country = COALESCE($9, facility_country),
      expected_total_enrollment = COALESCE($10, expected_total_enrollment), summary = COALESCE($11, summary),
      update_id = $12, date_updated = NOW()
    WHERE study_id = $13 AND parent_study_id IS NOT NULL
  `, [siteName, siteNumber, principalInvestigator, facilityName, facilityAddress, facilityCity, facilityState, facilityZip, facilityCountry, expectedTotalEnrollment, description, user.userId, siteId]);

  res.json({ success: true, message: 'Site updated' });
}));

/**
 * PATCH /api/sites/:siteId/status
 * Update site status
 */
router.patch('/:siteId/status', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { statusId } = req.body;
  const user = (req as any).user;

  await pool.query(`UPDATE study SET status_id = $1, update_id = $2, date_updated = NOW() WHERE study_id = $3 AND parent_study_id IS NOT NULL`, [statusId, user.userId, siteId]);
  res.json({ success: true, message: 'Site status updated' });
}));

/**
 * GET /api/sites/:siteId/patients
 * Get patients enrolled at a specific site
 */
router.get('/:siteId/patients', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { page = '1', limit = '20', status } = req.query;
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

  let whereClause = `ss.study_id = $1`;
  const params: any[] = [siteId];
  if (status) {
    params.push(status === 'active' ? 1 : 5);
    whereClause += ` AND ss.status_id = $${params.length}`;
  }

  const countResult = await pool.query(`SELECT COUNT(*) as total FROM study_subject ss WHERE ${whereClause}`, params);
  params.push(parseInt(limit as string), offset);
  const result = await pool.query(`
    SELECT ss.study_subject_id, ss.label, ss.secondary_label, ss.enrollment_date, ss.status_id,
      s.unique_identifier as person_id, s.gender, s.date_of_birth
    FROM study_subject ss
    LEFT JOIN subject s ON ss.subject_id = s.subject_id
    WHERE ${whereClause}
    ORDER BY ss.label
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({
    success: true,
    data: result.rows.map(r => ({
      studySubjectId: r.study_subject_id,
      label: r.label,
      secondaryLabel: r.secondary_label,
      enrollmentDate: r.enrollment_date,
      statusId: r.status_id,
      gender: r.gender
    })),
    total: parseInt(countResult.rows[0].total)
  });
}));

/**
 * POST /api/sites/transfer
 * Transfer a patient between sites
 */
router.post('/transfer', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studySubjectId, fromSiteId, toSiteId, reason } = req.body;

  if (!studySubjectId || !toSiteId || !reason) {
    res.status(400).json({ success: false, message: 'studySubjectId, toSiteId, and reason are required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Update the study_subject's study_id to the new site
    await client.query(`UPDATE study_subject SET study_id = $1, date_updated = NOW(), update_id = $2 WHERE study_subject_id = $3`, [toSiteId, user.userId, studySubjectId]);

    // Audit trail
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, audit_log_event_type_id, reason_for_change)
      VALUES (NOW(), 'study_subject', $1, $2, 'Site Transfer', $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1), $5)
    `, [user.userId, studySubjectId, fromSiteId?.toString() || '', toSiteId.toString(), reason]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Patient transferred successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
}));

/**
 * GET /api/sites/:siteId/staff
 * Get staff assigned to a site
 */
router.get('/:siteId/staff', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;

  const result = await pool.query(`
    SELECT u.user_id, u.user_name as username, u.first_name, u.last_name, u.email,
      sur.role_name as role, sur.status_id
    FROM study_user_role sur
    INNER JOIN user_account u ON sur.user_name = u.user_name
    WHERE sur.study_id = $1 AND sur.status_id = 1
    ORDER BY u.last_name, u.first_name
  `, [siteId]);

  res.json({
    success: true,
    data: result.rows.map(r => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      role: r.role,
      isPrimary: r.role === 'investigator'
    }))
  });
}));

/**
 * POST /api/sites/:siteId/staff
 * Assign staff to a site
 */
router.post('/:siteId/staff', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const user = (req as any).user;
  const { username, userId, role } = req.body;

  // Get username if userId provided
  let staffUsername = username;
  if (!staffUsername && userId) {
    const userResult = await pool.query(`SELECT user_name FROM user_account WHERE user_id = $1`, [userId]);
    if (userResult.rows.length > 0) staffUsername = userResult.rows[0].user_name;
  }

  if (!staffUsername || !role) {
    res.status(400).json({ success: false, message: 'username/userId and role are required' });
    return;
  }

  try {
    await pool.query(`
      INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
      VALUES ($1, $2, 1, $3, $4, NOW())
    `, [role, siteId, user.userId, staffUsername]);
    res.json({ success: true, message: 'Staff assigned to site' });
  } catch (error: any) {
    if (error.constraint) {
      res.status(400).json({ success: false, message: 'Staff member already assigned to this site' });
    } else {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}));

/**
 * DELETE /api/sites/:siteId/staff/:username
 * Remove staff from a site
 */
router.delete('/:siteId/staff/:username', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const { siteId, username } = req.params;
  const user = (req as any).user;

  await pool.query(`
    UPDATE study_user_role SET status_id = 5, date_updated = NOW(), update_id = $1
    WHERE study_id = $2 AND user_name = $3 AND status_id = 1
  `, [user.userId, siteId, username]);

  res.json({ success: true, message: 'Staff removed from site' });
}));

/**
 * GET /api/sites/study/:studyId/stats
 * Get aggregated site statistics for a study
 */
router.get('/study/:studyId/stats', asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  const result = await pool.query(`
    SELECT 
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
    WHERE s.parent_study_id = $1
  `, [studyId]);

  const row = result.rows[0] || {};
  res.json({
    success: true,
    data: {
      totalSites: parseInt(row.total_sites) || 0,
      activeSites: parseInt(row.active_sites) || 0,
      totalSubjects: parseInt(row.total_subjects) || 0,
      targetEnrollment: parseInt(row.target_enrollment) || 0,
      averageEnrollment: (parseInt(row.active_sites) || 0) > 0 
        ? Math.round((parseInt(row.total_subjects) || 0) / (parseInt(row.active_sites) || 1)) 
        : 0
    }
  });
}));

export default router;
