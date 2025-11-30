/**
 * Study Controller
 * 
 * Handles all study-related API endpoints including:
 * - CRUD operations for studies
 * - Study metadata, forms, sites, events
 * - Study statistics and enrollment data
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as studyService from '../services/hybrid/study.service';
import { pool } from '../config/database';
import { logger } from '../config/logger';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { status, page, limit } = req.query;

  logger.info('📋 Study list request', {
    userId: user.userId,
    username: user.userName,
    filters: { status, page, limit }
  });

  const result = await studyService.getStudies(user.userId, {
    status: status as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  logger.info('📋 Study list response', {
    userId: user.userId,
    count: result.data?.length || 0,
    total: result.pagination?.total || 0
  });

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.getStudyById(parseInt(id), user.userId);

  if (!result) {
    res.status(404).json({ success: false, message: 'Study not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.getStudyMetadata(parseInt(id), user.userId, user.username);

  if (!result) {
    res.status(404).json({ success: false, message: 'Study not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const getForms = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await studyService.getStudyForms(parseInt(id));

  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  logger.info('📥 Received study creation request', { 
    body: req.body,
    userId: user.userId,
    username: user.username
  });

  const result = await studyService.createStudy(req.body, user.userId);

  logger.info('📤 Study creation result', { result });

  res.status(result.success ? 201 : 400).json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.updateStudy(parseInt(id), req.body, user.userId);

  res.json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await studyService.deleteStudy(parseInt(id), user.userId);

  res.json(result);
});

/**
 * Get study sites (child studies with parent_study_id = studyId)
 */
export const getSites = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study sites', { studyId: id });

  try {
    const query = `
      SELECT 
        s.study_id,
        s.unique_identifier,
        s.name,
        s.summary,
        s.principal_investigator,
        s.facility_name,
        s.facility_city,
        s.facility_state,
        s.facility_country,
        s.facility_contact_email,
        s.facility_contact_phone,
        st.name as status_name,
        s.status_id,
        s.date_created,
        s.expected_total_enrollment,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as enrolled_subjects
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE s.parent_study_id = $1
      ORDER BY s.name
    `;

    const result = await pool.query(query, [parseInt(id)]);

    const sites = result.rows.map(site => ({
      id: site.study_id.toString(),
      siteNumber: site.unique_identifier,
      siteName: site.name,
      description: site.summary || '',
      principalInvestigator: site.principal_investigator || '',
      status: mapSiteStatus(site.status_id),
      address: {
        facility: site.facility_name || '',
        city: site.facility_city || '',
        state: site.facility_state || '',
        country: site.facility_country || ''
      },
      contact: {
        email: site.facility_contact_email || '',
        phone: site.facility_contact_phone || ''
      },
      targetEnrollment: site.expected_total_enrollment || 0,
      actualEnrollment: parseInt(site.enrolled_subjects) || 0,
      dateCreated: site.date_created
    }));

    res.json({ success: true, data: sites });
  } catch (error: any) {
    logger.error('Get study sites error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get study events/phases (study_event_definition)
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study events', { studyId: id });

  try {
    const query = `
      SELECT 
        sed.study_event_definition_id,
        sed.oc_oid,
        sed.name,
        sed.description,
        sed.type,
        sed.repeating,
        sed.category,
        sed.ordinal,
        st.name as status_name,
        sed.status_id,
        (
          SELECT COUNT(DISTINCT edc.crf_id)
          FROM event_definition_crf edc
          WHERE edc.study_event_definition_id = sed.study_event_definition_id
        ) as form_count
      FROM study_event_definition sed
      INNER JOIN status st ON sed.status_id = st.status_id
      WHERE sed.study_id = $1
      ORDER BY sed.ordinal
    `;

    const result = await pool.query(query, [parseInt(id)]);

    const events = result.rows.map(event => ({
      id: event.study_event_definition_id.toString(),
      oid: event.oc_oid,
      name: event.name,
      description: event.description || '',
      type: event.type || 'scheduled',
      repeating: event.repeating || false,
      category: event.category || '',
      order: event.ordinal,
      status: event.status_name,
      formCount: parseInt(event.form_count) || 0
    }));

    res.json({ success: true, data: events });
  } catch (error: any) {
    logger.error('Get study events error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get study statistics
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study statistics', { studyId: id });

  try {
    const statsQuery = `
      SELECT 
        s.expected_total_enrollment as target_enrollment,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = $1) as total_subjects,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = $1 AND status_id = 1) as active_subjects,
        (SELECT COUNT(*) FROM study_subject ss
         INNER JOIN study_event se ON ss.study_subject_id = se.study_subject_id
         INNER JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
         WHERE ss.study_id = $1 AND ses.name = 'completed') as completed_subjects,
        (SELECT COUNT(*) FROM discrepancy_note dn
         INNER JOIN dn_study_subject_map dnm ON dn.discrepancy_note_id = dnm.discrepancy_note_id
         INNER JOIN study_subject ss ON dnm.study_subject_id = ss.study_subject_id
         WHERE ss.study_id = $1 AND dn.parent_dn_id IS NULL) as total_queries,
        (SELECT COUNT(*) FROM discrepancy_note dn
         INNER JOIN dn_study_subject_map dnm ON dn.discrepancy_note_id = dnm.discrepancy_note_id
         INNER JOIN study_subject ss ON dnm.study_subject_id = ss.study_subject_id
         INNER JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
         WHERE ss.study_id = $1 AND dn.parent_dn_id IS NULL 
         AND rs.name NOT IN ('Closed', 'Not Applicable')) as open_queries,
        (SELECT COUNT(DISTINCT s2.study_id) FROM study s2 WHERE s2.parent_study_id = $1) as site_count,
        (SELECT COUNT(*) FROM study_event_definition WHERE study_id = $1) as event_count,
        (SELECT COUNT(*) FROM crf WHERE source_study_id = $1) as form_count
      FROM study s
      WHERE s.study_id = $1
    `;

    const result = await pool.query(statsQuery, [parseInt(id)]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Study not found' });
      return;
    }

    const stats = result.rows[0];
    
    res.json({
      success: true,
      data: {
        enrollment: {
          target: parseInt(stats.target_enrollment) || 0,
          actual: parseInt(stats.total_subjects) || 0,
          active: parseInt(stats.active_subjects) || 0,
          completed: parseInt(stats.completed_subjects) || 0,
          percentage: stats.target_enrollment > 0 
            ? Math.round((stats.total_subjects / stats.target_enrollment) * 100) 
            : 0
        },
        queries: {
          total: parseInt(stats.total_queries) || 0,
          open: parseInt(stats.open_queries) || 0,
          closed: (parseInt(stats.total_queries) || 0) - (parseInt(stats.open_queries) || 0)
        },
        sites: parseInt(stats.site_count) || 0,
        events: parseInt(stats.event_count) || 0,
        forms: parseInt(stats.form_count) || 0
      }
    });
  } catch (error: any) {
    logger.error('Get study statistics error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get study users with roles
 */
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  logger.info('Getting study users', { studyId: id });

  try {
    const query = `
      SELECT 
        u.user_id,
        u.user_name,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        sur.role_name,
        sur.date_created,
        st.name as status_name
      FROM study_user_role sur
      INNER JOIN user_account u ON sur.user_name = u.user_name
      INNER JOIN status st ON sur.status_id = st.status_id
      WHERE sur.study_id = $1 AND sur.status_id = 1
      ORDER BY sur.role_name, u.last_name
    `;

    const result = await pool.query(query, [parseInt(id)]);

    const users = result.rows.map(user => ({
      userId: user.user_id,
      username: user.user_name,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone || '',
      role: user.role_name,
      assignedDate: user.date_created,
      status: user.status_name
    }));

    res.json({ success: true, data: users });
  } catch (error: any) {
    logger.error('Get study users error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Helper function to map LibreClinica status ID to frontend site status
 */
function mapSiteStatus(statusId: number): string {
  const statusMap: Record<number, string> = {
    1: 'active',      // available
    2: 'pending',     // pending
    3: 'frozen',      // frozen
    4: 'locked',      // locked
    5: 'completed'    // complete
  };
  return statusMap[statusId] || 'pending';
}

export default { 
  list, 
  get, 
  getMetadata, 
  getForms, 
  getSites, 
  getEvents, 
  getStats, 
  getUsers, 
  create, 
  update, 
  remove 
};

