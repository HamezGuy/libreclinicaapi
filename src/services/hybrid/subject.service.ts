/**
 * Subject Service (Hybrid)
 * 
 * Combines SOAP and Database operations for subject management
 * - Use SOAP for creating subjects (GxP compliant with validation)
 * - Use Database for reading/listing subjects (faster)
 * - Provides complete subject information with progress tracking
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as subjectSoap from '../soap/subjectSoap.service';
import { SubjectCreateRequest, SubjectDetails, ApiResponse, PaginatedResponse } from '../../types';

/**
 * Create subject via SOAP (GxP compliant)
 */
export const createSubject = async (
  request: SubjectCreateRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating subject (hybrid)', { request, userId });

  // Use SOAP service for GxP-compliant creation
  const result = await subjectSoap.createSubject(request, userId, username);

  if (!result.success) {
    return result;
  }

  // Verify creation in database
  try {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DB sync

    const verifyQuery = `
      SELECT study_subject_id
      FROM study_subject
      WHERE label = $1 AND study_id = $2
    `;

    const verifyResult = await pool.query(verifyQuery, [request.studySubjectId, request.studyId]);

    if (verifyResult.rows.length > 0) {
      result.data = {
        ...result.data,
        studySubjectId: verifyResult.rows[0].study_subject_id
      } as any;
    }
  } catch (error: any) {
    logger.warn('Subject verification warning', { error: error.message });
  }

  return result;
};

/**
 * Get subject list with filters (Database - fast)
 */
export const getSubjectList = async (
  studyId: number,
  filters: {
    status?: string;
    page?: number;
    limit?: number;
  }
): Promise<PaginatedResponse<any>> => {
  logger.info('Getting subject list', { studyId, filters });

  try {
    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['ss.study_id = $1'];
    const params: any[] = [studyId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`st.name = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    // Count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM study_subject ss
      INNER JOIN status st ON ss.status_id = st.status_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get subjects with details
    const dataQuery = `
      SELECT 
        ss.study_subject_id,
        ss.label,
        ss.secondary_label,
        ss.enrollment_date,
        st.name as status,
        s.gender,
        s.date_of_birth,
        ss.date_created,
        u.user_name as created_by,
        (
          SELECT COUNT(*)
          FROM study_event se
          WHERE se.study_subject_id = ss.study_subject_id
        ) as total_events,
        (
          SELECT COUNT(*)
          FROM study_event se
          INNER JOIN event_crf ec ON se.study_event_id = ec.study_event_id
          INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
          WHERE se.study_subject_id = ss.study_subject_id
            AND cs.name IN ('complete', 'signed')
        ) as completed_forms
      FROM study_subject ss
      INNER JOIN subject s ON ss.subject_id = s.subject_id
      INNER JOIN status st ON ss.status_id = st.status_id
      LEFT JOIN user_account u ON ss.owner_id = u.user_id
      WHERE ${whereClause}
      ORDER BY ss.enrollment_date DESC
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
    logger.error('Get subject list error', { error: error.message });
    throw error;
  }
};

/**
 * Get subject by ID with full details
 */
export const getSubjectById = async (subjectId: number): Promise<SubjectDetails | null> => {
  logger.info('Getting subject details', { subjectId });

  try {
    // Get subject basic info
    const subjectQuery = `
      SELECT 
        ss.*,
        s.gender,
        s.date_of_birth,
        st.name as status_name,
        u.user_name as created_by
      FROM study_subject ss
      INNER JOIN subject s ON ss.subject_id = s.subject_id
      INNER JOIN status st ON ss.status_id = st.status_id
      LEFT JOIN user_account u ON ss.owner_id = u.user_id
      WHERE ss.study_subject_id = $1
    `;

    const subjectResult = await pool.query(subjectQuery, [subjectId]);

    if (subjectResult.rows.length === 0) {
      return null;
    }

    const subject = subjectResult.rows[0];

    // Get events
    const eventsQuery = `
      SELECT 
        se.*,
        sed.name as event_name,
        sed.repeating,
        sest.name as status_name,
        u.user_name as created_by,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          WHERE ec.study_event_id = se.study_event_id
        ) as total_forms,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
          WHERE ec.study_event_id = se.study_event_id
            AND cs.name IN ('complete', 'signed')
        ) as completed_forms
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      LEFT JOIN user_account u ON se.owner_id = u.user_id
      WHERE se.study_subject_id = $1
      ORDER BY sed.ordinal, se.sample_ordinal
    `;

    const eventsResult = await pool.query(eventsQuery, [subjectId]);

    // Calculate completion percentage
    const totalForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.total_forms), 0);
    const completedForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.completed_forms), 0);
    const completionPercentage = totalForms > 0 ? Math.round((completedForms / totalForms) * 100) : 0;

    // Get last activity
    // Note: audit_log_event doesn't have direct subject_id, would need to join through entity mappings
    // For now, use the subject's date_updated as last activity
    const lastActivity = subject.date_updated || subject.date_created;

    const details: SubjectDetails = {
      ...subject,
      subject: {
        subject_id: subject.subject_id,
        unique_identifier: subject.label,
        gender: subject.gender,
        date_of_birth: subject.date_of_birth,
        status_id: subject.status_id,
        date_created: subject.date_created,
        owner_id: subject.owner_id,
        update_id: subject.update_id
      },
      events: eventsResult.rows,
      completionPercentage,
      lastActivity
    };

    return details;
  } catch (error: any) {
    logger.error('Get subject details error', { error: error.message });
    throw error;
  }
};

/**
 * Get subject progress/completion statistics
 */
export const getSubjectProgress = async (subjectId: number): Promise<any> => {
  logger.info('Getting subject progress', { subjectId });

  try {
    const query = `
      SELECT 
        COUNT(DISTINCT se.study_event_id) as total_events,
        COUNT(DISTINCT CASE WHEN sest.name IN ('completed', 'stopped') THEN se.study_event_id END) as completed_events,
        COUNT(DISTINCT ec.event_crf_id) as total_forms,
        COUNT(DISTINCT CASE WHEN cs.name IN ('complete', 'signed') THEN ec.event_crf_id END) as completed_forms,
        COUNT(DISTINCT CASE WHEN dn.resolution_status_id IN (
          SELECT resolution_status_id FROM resolution_status WHERE name NOT IN ('Closed', 'Not Applicable')
        ) THEN dn.discrepancy_note_id END) as open_queries
      FROM study_subject ss
      LEFT JOIN study_event se ON ss.study_subject_id = se.study_subject_id
      LEFT JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      LEFT JOIN event_crf ec ON se.study_event_id = ec.study_event_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN dn_study_subject_map dnm ON ss.study_subject_id = dnm.study_subject_id
      LEFT JOIN discrepancy_note dn ON dnm.discrepancy_note_id = dn.discrepancy_note_id
      WHERE ss.study_subject_id = $1
      GROUP BY ss.study_subject_id
    `;

    const result = await pool.query(query, [subjectId]);

    if (result.rows.length === 0) {
      return null;
    }

    const stats = result.rows[0];

    return {
      totalEvents: parseInt(stats.total_events) || 0,
      completedEvents: parseInt(stats.completed_events) || 0,
      eventCompletionPercentage: stats.total_events > 0
        ? Math.round((stats.completed_events / stats.total_events) * 100)
        : 0,
      totalForms: parseInt(stats.total_forms) || 0,
      completedForms: parseInt(stats.completed_forms) || 0,
      formCompletionPercentage: stats.total_forms > 0
        ? Math.round((stats.completed_forms / stats.total_forms) * 100)
        : 0,
      openQueries: parseInt(stats.open_queries) || 0
    };
  } catch (error: any) {
    logger.error('Get subject progress error', { error: error.message });
    throw error;
  }
};

export default {
  createSubject,
  getSubjectList,
  getSubjectById,
  getSubjectProgress
};

