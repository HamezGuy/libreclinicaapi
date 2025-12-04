/**
 * Subject Service (Hybrid)
 * 
 * RESPONSIBILITY SEPARATION:
 * ═══════════════════════════════════════════════════════════════
 * SOAP (Part 11 Compliant) - USE THESE:
 *   - createSubject() - Enroll subject via studySubject/create
 *   - isSubjectExists() - Check via studySubject/isStudySubject  
 *   - listSubjects() - Get list via studySubject/listAllByStudy
 * 
 * Database (Stats/Enrichment Only):
 *   - Add progress tracking (form completion %)
 *   - Add statistics (events, queries)
 *   - Fallback when SOAP unavailable
 * ═══════════════════════════════════════════════════════════════
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import * as subjectSoap from '../soap/subjectSoap.service';
import { 
  StudySubject, 
  StudySubjectWithDetails,
  SubjectProgress,
  ApiResponse, 
  PaginatedResponse,
  toStudySubject
} from '../../types/libreclinica-models';

// Request type for creating a subject
export interface SubjectCreateRequest {
  studyId: number;
  studySubjectId: string;  // Label
  secondaryId?: string;
  enrollmentDate?: string;
  gender?: string;
  dateOfBirth?: string;
  // Person ID - unique identifier for cross-study linking (unique_identifier in subject table)
  personId?: string;
  // Group assignments for randomization
  groupAssignments?: { studyGroupClassId: number; studyGroupId: number; notes?: string }[];
  // Optional first event scheduling
  scheduleEvent?: {
    studyEventDefinitionId: number;
    location?: string;
    startDate?: string;
  };
}

/**
 * Create subject via SOAP or direct database (depending on config)
 */
export const createSubject = async (
  request: SubjectCreateRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating subject (hybrid)', { request, userId, soapEnabled: config.libreclinica.soapEnabled });

  // If SOAP is disabled, use direct database creation
  if (!config.libreclinica.soapEnabled) {
    return createSubjectDirect(request, userId, username);
  }

  // Use SOAP service for GxP-compliant creation
  const result = await subjectSoap.createSubject(request, userId, username);

  if (!result.success) {
    // Fallback to direct database if SOAP fails
    logger.warn('SOAP creation failed, attempting direct database creation');
    return createSubjectDirect(request, userId, username);
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
 * Create subject directly in database (for local development or SOAP fallback)
 */
const createSubjectDirect = async (
  request: SubjectCreateRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating subject directly in database', { request, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create subject record first
    const subjectQuery = `
      INSERT INTO subject (
        date_of_birth, gender, unique_identifier, date_created, date_updated, 
        owner_id, update_id, dob_collected, status_id
      ) VALUES (
        $1, $2, $3, NOW(), NOW(), $4, $4, $5, 1
      )
      RETURNING subject_id
    `;
    
    const gender = request.gender === 'Male' || request.gender === 'm' ? 'm' : 
                   request.gender === 'Female' || request.gender === 'f' ? 'f' : '';
    const dobCollected = request.dateOfBirth ? true : false;
    // Use personId if provided, otherwise use studySubjectId as unique identifier
    const uniqueIdentifier = request.personId || request.studySubjectId;
    
    const subjectResult = await client.query(subjectQuery, [
      request.dateOfBirth || null,
      gender,
      uniqueIdentifier,
      userId,
      dobCollected
    ]);

    const subjectId = subjectResult.rows[0].subject_id;

    // 2. Create study_subject record
    const studySubjectQuery = `
      INSERT INTO study_subject (
        label, secondary_label, subject_id, study_id, status_id, 
        enrollment_date, date_created, date_updated, owner_id, oc_oid
      ) VALUES (
        $1, $2, $3, $4, 1, $5, NOW(), NOW(), $6, $7
      )
      RETURNING study_subject_id
    `;

    // Generate OC OID
    const ocOid = `SS_${request.studySubjectId.replace(/[^a-zA-Z0-9]/g, '')}`.substring(0, 40);

    const studySubjectResult = await client.query(studySubjectQuery, [
      request.studySubjectId,
      request.secondaryId || '',
      subjectId,
      request.studyId,
      request.enrollmentDate || new Date().toISOString().split('T')[0],
      userId,
      ocOid
    ]);

    const studySubjectId = studySubjectResult.rows[0].study_subject_id;

    // 3. Create audit log entry
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Create%' OR name LIKE '%Insert%' LIMIT 1)
      )
    `, [userId, studySubjectId]);

    // 4. Assign to study groups if provided (for randomization)
    if (request.groupAssignments && request.groupAssignments.length > 0) {
      for (const assignment of request.groupAssignments) {
        if (assignment.studyGroupId > 0) {
          await client.query(`
            INSERT INTO subject_group_map (
              study_group_class_id, study_subject_id, study_group_id,
              status_id, owner_id, date_created, notes
            ) VALUES ($1, $2, $3, 1, $4, NOW(), $5)
          `, [
            assignment.studyGroupClassId,
            studySubjectId,
            assignment.studyGroupId,
            userId,
            assignment.notes || ''
          ]);
        }
      }
      logger.info('Subject group assignments created', { 
        studySubjectId, 
        assignmentCount: request.groupAssignments.length 
      });
    }

    // 5. Schedule first study event if requested
    let studyEventId = null;
    if (request.scheduleEvent && request.scheduleEvent.studyEventDefinitionId > 0) {
      const eventOid = `SE_${studySubjectId}_${request.scheduleEvent.studyEventDefinitionId}`;
      const startDate = request.scheduleEvent.startDate || request.enrollmentDate || new Date().toISOString().split('T')[0];
      
      const eventResult = await client.query(`
        INSERT INTO study_event (
          study_event_definition_id, study_subject_id, location,
          sample_ordinal, date_started, date_ended,
          owner_id, status_id, subject_event_status_id, date_created
        ) VALUES (
          $1, $2, $3, 1, $4, $4, $5, 1, 
          (SELECT subject_event_status_id FROM subject_event_status WHERE name = 'scheduled' LIMIT 1),
          NOW()
        )
        RETURNING study_event_id
      `, [
        request.scheduleEvent.studyEventDefinitionId,
        studySubjectId,
        request.scheduleEvent.location || '',
        startDate,
        userId
      ]);
      
      studyEventId = eventResult.rows[0]?.study_event_id;
      logger.info('First study event scheduled', { studySubjectId, studyEventId });
    }

    await client.query('COMMIT');

    logger.info('Subject created successfully via direct database', { 
      subjectId, 
      studySubjectId, 
      label: request.studySubjectId 
    });

    return {
      success: true,
      message: 'Subject created successfully',
      data: {
        subjectId,
        studySubjectId,
        label: request.studySubjectId,
        studyId: request.studyId,
        enrollmentDate: request.enrollmentDate,
        personId: uniqueIdentifier,
        ocOid,
        groupAssignments: request.groupAssignments || [],
        studyEventId: studyEventId
      }
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Direct subject creation failed', { error: error.message });
    
    // Check for duplicate
    if (error.code === '23505') { // Unique violation
      return {
        success: false,
        message: 'Subject with this ID already exists in this study or another study'
      };
    }

    return {
      success: false,
      message: 'Failed to create subject: ' + error.message
    };
  } finally {
    client.release();
  }
};

/**
 * Get subject list - SOAP PRIMARY, DB for stats enrichment
 * 
 * Strategy:
 * 1. Try SOAP studySubject/listAllByStudy first (Part 11 compliant)
 * 2. Enrich with DB stats (progress, events)
 * 3. Fallback to pure DB if SOAP unavailable
 */
export const getSubjectList = async (
  studyId: number,
  filters: {
    status?: string;
    page?: number;
    limit?: number;
  },
  userId?: number,
  username?: string
): Promise<PaginatedResponse<any>> => {
  logger.info('Getting subject list (SOAP primary)', { studyId, filters, soapEnabled: config.libreclinica.soapEnabled });

  try {
    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    // Try SOAP first for Part 11 compliance
    if (config.libreclinica.soapEnabled && userId && username) {
      try {
        // Get study OID first
        const studyOidQuery = `SELECT oc_oid FROM study WHERE study_id = $1`;
        const oidResult = await pool.query(studyOidQuery, [studyId]);
        const studyOid = oidResult.rows[0]?.oc_oid || `S_${studyId}`;

        const soapResult = await subjectSoap.listSubjects(studyOid, userId, username);
        
        if (soapResult.success && soapResult.data) {
          logger.info('✅ Subjects retrieved via SOAP', { studyId });
          
          // Enrich with DB stats
          const enrichedSubjects = await enrichSubjectsWithStats(soapResult.data, studyId);
          
          // Apply status filter if specified
          let filteredSubjects = enrichedSubjects;
          if (status) {
            filteredSubjects = enrichedSubjects.filter((s: any) => 
              s.status?.toLowerCase() === status.toLowerCase()
            );
          }
          
          // Apply pagination
          const paginatedSubjects = filteredSubjects.slice(offset, offset + limit);
          
          return {
            success: true,
            data: paginatedSubjects.map((s: any) => ({ ...s, source: 'SOAP' })),
            pagination: {
              page,
              limit,
              total: filteredSubjects.length,
              totalPages: Math.ceil(filteredSubjects.length / limit)
            }
          };
        }
      } catch (soapError: any) {
        logger.warn('SOAP subject list failed, falling back to DB', { error: soapError.message });
      }
    }

    // Fallback to database
    logger.info('📋 Using database fallback for subject list');
    
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
        ) as completed_forms,
        'DATABASE' as source
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
export const getSubjectById = async (subjectId: number): Promise<StudySubjectWithDetails | null> => {
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

    // Convert to LibreClinica StudySubject format
    const studySubject = toStudySubject(subject);
    
    const details: StudySubjectWithDetails = {
      ...studySubject,
      subject: {
        subjectId: subject.subject_id,
        uniqueIdentifier: subject.label,
        gender: subject.gender || '',
        dateOfBirth: subject.date_of_birth,
        dobCollected: !!subject.date_of_birth,
        statusId: subject.status_id,
        ownerId: subject.owner_id,
        dateCreated: subject.date_created,
        dateUpdated: subject.date_updated,
        updateId: subject.update_id
      },
      study: {
        studyId: subject.study_id,
        name: '',  // Would need to join study table
        identifier: '',
        type: 'nongenetic',
        statusId: 1,
        ownerId: subject.owner_id,
        dateCreated: subject.date_created
      },
      events: eventsResult.rows.map((e: any) => ({
        studyEventId: e.study_event_id,
        studyEventDefinitionId: e.study_event_definition_id,
        studySubjectId: subjectId,
        location: e.location,
        sampleOrdinal: e.sample_ordinal || 1,
        dateStarted: e.date_start,
        dateEnded: e.date_end,
        subjectEventStatus: e.status_name || 'scheduled',
        statusId: e.status_id,
        ownerId: e.owner_id,
        dateCreated: e.date_created,
        dateUpdated: e.date_updated
      })),
      progress: {
        totalEvents: eventsResult.rows.length,
        completedEvents: eventsResult.rows.filter((e: any) => 
          ['completed', 'stopped'].includes(e.status_name?.toLowerCase())
        ).length,
        totalForms: totalForms,
        completedForms: completedForms,
        percentComplete: completionPercentage
      }
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
export const getSubjectProgress = async (subjectId: number): Promise<SubjectProgress | null> => {
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

    const totalEvents = parseInt(stats.total_events) || 0;
    const completedEvents = parseInt(stats.completed_events) || 0;
    const totalForms = parseInt(stats.total_forms) || 0;
    const completedForms = parseInt(stats.completed_forms) || 0;
    
    return {
      totalEvents,
      completedEvents,
      totalForms,
      completedForms,
      percentComplete: totalForms > 0
        ? Math.round((completedForms / totalForms) * 100)
        : 0
    };
  } catch (error: any) {
    logger.error('Get subject progress error', { error: error.message });
    throw error;
  }
};

/**
 * Helper: Enrich SOAP subject list with database statistics
 */
async function enrichSubjectsWithStats(soapSubjects: any, studyId: number): Promise<any[]> {
  // Parse SOAP response - could be ODM XML or object array
  let subjects: any[] = [];
  
  if (typeof soapSubjects === 'string') {
    // Parse ODM XML
    subjects = subjectSoap.parseSubjectListOdm(soapSubjects);
  } else if (Array.isArray(soapSubjects)) {
    subjects = soapSubjects;
  } else if (soapSubjects.subjects) {
    subjects = Array.isArray(soapSubjects.subjects) ? soapSubjects.subjects : [soapSubjects.subjects];
  }

  if (subjects.length === 0) {
    return [];
  }

  try {
    // Get stats for all subjects
    const labels = subjects.map(s => s.studySubjectId || s.label || s.subjectKey).filter(Boolean);
    
    if (labels.length === 0) {
      return subjects;
    }

    const statsQuery = `
      SELECT 
        ss.study_subject_id,
        ss.label,
        ss.secondary_label,
        ss.enrollment_date,
        st.name as status,
        s.gender,
        s.date_of_birth,
        ss.date_created,
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
      WHERE ss.study_id = $1 AND ss.label = ANY($2)
    `;

    const statsResult = await pool.query(statsQuery, [studyId, labels]);
    
    // Create lookup map
    const statsMap = new Map();
    for (const row of statsResult.rows) {
      statsMap.set(row.label, row);
    }

    // Merge SOAP data with DB stats
    return subjects.map(soapSubject => {
      const label = soapSubject.studySubjectId || soapSubject.label || soapSubject.subjectKey;
      const stats = statsMap.get(label) || {};
      return {
        ...stats,
        ...soapSubject,
        label: label,
        study_subject_id: stats.study_subject_id,
        total_events: parseInt(stats.total_events) || 0,
        completed_forms: parseInt(stats.completed_forms) || 0
      };
    });
  } catch (error: any) {
    logger.warn('Failed to enrich subjects with stats', { error: error.message });
    return subjects;
  }
}

export default {
  createSubject,
  getSubjectList,
  getSubjectById,
  getSubjectProgress
};

