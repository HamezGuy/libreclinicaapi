/**
 * Study Service (Hybrid)
 * 
 * RESPONSIBILITY SEPARATION:
 * ═══════════════════════════════════════════════════════════════
 * SOAP (Part 11 Compliant):
 *   - listStudies() - Get official study list from LibreClinica
 *   - getStudyMetadata() - Get ODM metadata
 * 
 * Database (Stats/Enrichment Only):
 *   - Add statistics (enrollment counts, completion rates)
 *   - User access filtering (study_user_role)
 *   - Pagination
 * ═══════════════════════════════════════════════════════════════
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import * as studySoap from '../soap/studySoap.service';
import { 
  Study, 
  StudyEventDefinition,
  CRF,
  PaginatedResponse,
  toStudy
} from '../../types/libreclinica-models';

// Study metadata interface - uses raw database rows for local fallback
export interface StudyMetadata {
  study: any;
  events: any[];
  crfs: any[];
}

/**
 * Get studies list - SOAP PRIMARY, DB for stats enrichment
 * 
 * Strategy:
 * 1. Get study list from SOAP (official source)
 * 2. Enrich with statistics from DB (enrollment, completion)
 * 3. Filter by user access from DB
 */
export const getStudies = async (
  userId: number,
  filters: {
    status?: string;
    page?: number;
    limit?: number;
  },
  username?: string
): Promise<PaginatedResponse<any>> => {
  logger.info('📋 Getting studies for user (SOAP primary)', { userId, filters, soapEnabled: config.libreclinica.soapEnabled });

  try {
    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    // Try SOAP first for Part 11 compliance
    if (config.libreclinica.soapEnabled && username) {
      try {
        const soapResult = await studySoap.listStudies(userId, username);
        if (soapResult.success && soapResult.data) {
          logger.info('✅ Studies retrieved via SOAP', { count: soapResult.data.length });
          
          // Enrich with DB stats
          const enrichedStudies = await enrichStudiesWithStats(soapResult.data, userId);
          
          // Apply pagination
          const paginatedStudies = enrichedStudies.slice(offset, offset + limit);
          
          return {
            success: true,
            data: paginatedStudies,
            pagination: {
              page,
              limit,
              total: enrichedStudies.length,
              totalPages: Math.ceil(enrichedStudies.length / limit)
            }
          };
        }
      } catch (soapError: any) {
        logger.warn('SOAP study list failed, falling back to DB', { error: soapError.message });
      }
    }

    // Fallback to database if SOAP unavailable
    logger.info('📋 Using database fallback for study list');

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    // Check if user is admin - admins can see all studies
    const adminCheckQuery = `
      SELECT u.user_type_id, ut.user_type 
      FROM user_account u 
      LEFT JOIN user_type ut ON u.user_type_id = ut.user_type_id
      WHERE u.user_id = $1
    `;
    const adminCheck = await pool.query(adminCheckQuery, [userId]);
    const isAdmin = adminCheck.rows[0]?.user_type_id === 1 || 
                   adminCheck.rows[0]?.user_type_id === 4 ||
                   adminCheck.rows[0]?.user_type === 'admin' ||
                   adminCheck.rows[0]?.user_type === 'sysadmin';

    // Only filter by user access for non-admin users
    if (!isAdmin) {
      // Filter by user access OR owner
      // User can see studies they own OR are assigned to
      conditions.push(`(
        s.owner_id = $${paramIndex++}
        OR EXISTS (
          SELECT 1 FROM study_user_role sur
          WHERE sur.study_id = s.study_id
            AND sur.user_name = (SELECT user_name FROM user_account WHERE user_id = $${paramIndex++})
            AND sur.status_id = 1
        )
      )`);
      params.push(userId, userId);
    }

    // Only show parent studies (not sites which have parent_study_id set)
    conditions.push(`s.parent_study_id IS NULL`);

    if (status) {
      conditions.push(`st.name = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    // Count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    logger.info('📊 Study count for user', { userId, total });

    // Get studies with stats
    const dataQuery = `
      SELECT 
        s.study_id,
        s.unique_identifier,
        s.name,
        s.summary,
        s.principal_investigator,
        s.sponsor,
        s.expected_total_enrollment,
        s.date_planned_start,
        s.date_planned_end,
        s.date_created,
        s.date_updated,
        s.status_id,
        s.owner_id,
        s.oc_oid,
        s.protocol_type,
        st.name as status,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as enrolled_subjects,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as active_subjects,
        (SELECT COUNT(DISTINCT sed.study_event_definition_id) FROM study_event_definition sed WHERE sed.study_id = s.study_id) as total_events,
        (SELECT COUNT(DISTINCT c.crf_id) FROM crf c WHERE c.source_study_id = s.study_id) as total_forms,
        (SELECT COUNT(DISTINCT s2.study_id) FROM study s2 WHERE s2.parent_study_id = s.study_id) as total_sites
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE ${whereClause}
      ORDER BY s.date_created DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

    logger.info('✅ Studies retrieved', { 
      userId, 
      count: dataResult.rows.length,
      total,
      page 
    });

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
    logger.error('❌ Get studies error', { error: error.message, userId });
    throw error;
  }
};

/**
 * Get study by ID with statistics
 */
export const getStudyById = async (studyId: number, userId: number): Promise<any> => {
  logger.info('Getting study details', { studyId, userId });

  try {
    // Note: study table does NOT have type_id column - it was removed/commented out in LibreClinica
    // protocol_type is used instead for study type classification
    const query = `
      SELECT 
        s.*,
        st.name as status_name,
        s.protocol_type as type_name,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as total_subjects,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as active_subjects,
        (SELECT COUNT(*) FROM study_event_definition WHERE study_id = s.study_id) as total_events,
        (SELECT COUNT(*) FROM crf WHERE source_study_id = s.study_id) as total_forms,
        (SELECT COUNT(*) FROM discrepancy_note WHERE study_id = s.study_id AND parent_dn_id IS NULL) as total_queries
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE s.study_id = $1
    `;

    const result = await pool.query(query, [studyId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get study details error', { error: error.message });
    throw error;
  }
};

/**
 * Get study metadata (combine SOAP + DB)
 */
export const getStudyMetadata = async (
  studyId: number,
  userId: number,
  username: string
): Promise<StudyMetadata | null> => {
  logger.info('Getting study metadata', { studyId, userId });

  try {
    // Get study OID
    const oidQuery = `SELECT oc_oid FROM study WHERE study_id = $1`;
    const oidResult = await pool.query(oidQuery, [studyId]);

    if (oidResult.rows.length === 0) {
      return null;
    }

    const studyOid = oidResult.rows[0].oc_oid || `S_${studyId}`;

    // Get metadata from SOAP
    const soapResult = await studySoap.getStudyMetadata(studyOid, userId, username);

    if (!soapResult.success || !soapResult.data) {
      // Fall back to database
      return await getStudyMetadataFromDb(studyId);
    }

    return soapResult.data;
  } catch (error: any) {
    logger.error('Get study metadata error', { error: error.message });
    // Fall back to database
    return await getStudyMetadataFromDb(studyId);
  }
};

/**
 * Get study metadata from database (fallback)
 */
async function getStudyMetadataFromDb(studyId: number): Promise<StudyMetadata> {
  const studyQuery = `SELECT * FROM study WHERE study_id = $1`;
  const studyResult = await pool.query(studyQuery, [studyId]);

  const eventsQuery = `
    SELECT * FROM study_event_definition
    WHERE study_id = $1
    ORDER BY ordinal
  `;
  const eventsResult = await pool.query(eventsQuery, [studyId]);

  const crfsQuery = `
    SELECT * FROM crf
    WHERE study_id = $1
    ORDER BY name
  `;
  const crfsResult = await pool.query(crfsQuery, [studyId]);

  return {
    study: studyResult.rows[0],
    events: eventsResult.rows,
    crfs: crfsResult.rows
  };
}

/**
 * Get study sites
 */
export const getStudySites = async (studyId: number): Promise<any[]> => {
  logger.info('Getting study sites', { studyId });

  try {
    const query = `
      SELECT DISTINCT
        s.study_id,
        s.unique_identifier,
        s.name,
        s.status_id,
        st.name as status_name
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE s.parent_study_id = $1 OR s.study_id = $1
      ORDER BY s.name
    `;

    const result = await pool.query(query, [studyId]);

    return result.rows;
  } catch (error: any) {
    logger.error('Get study sites error', { error: error.message });
    throw error;
  }
};

// NOTE: getStudyForms moved to form.service.ts to avoid duplication
// Import from form.service if needed: import { getStudyForms } from './form.service';

/**
 * Create new study
 */
export const createStudy = async (
  data: {
    name: string;
    uniqueIdentifier: string;
    description?: string;
    principalInvestigator?: string;
    sponsor?: string;
    phase?: string;
    expectedTotalEnrollment?: number;
    datePlannedStart?: string;
    datePlannedEnd?: string;
    parentStudyId?: number;
  },
  userId: number
): Promise<{ success: boolean; studyId?: number; message?: string }> => {
  logger.info('Creating study', { name: data.name, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if unique identifier exists
    const existsQuery = `SELECT study_id FROM study WHERE unique_identifier = $1`;
    const existsResult = await client.query(existsQuery, [data.uniqueIdentifier]);

    if (existsResult.rows.length > 0) {
      return {
        success: false,
        message: 'Study with this identifier already exists'
      };
    }

    // Generate OC OID
    const ocOid = `S_${data.uniqueIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Insert study
    // Note: study table does NOT have type_id column - using protocol_type instead
    const insertQuery = `
      INSERT INTO study (
        parent_study_id, unique_identifier, name, summary, principal_investigator,
        sponsor, protocol_description, date_planned_start, date_planned_end,
        expected_total_enrollment, status_id, owner_id, date_created,
        oc_oid, protocol_type
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, NOW(), $12, 'interventional'
      )
      RETURNING study_id
    `;

    const insertResult = await client.query(insertQuery, [
      data.parentStudyId || null,
      data.uniqueIdentifier,
      data.name,
      data.description || '',
      data.principalInvestigator || '',
      data.sponsor || '',
      data.description || '',
      data.datePlannedStart || null,
      data.datePlannedEnd || null,
      data.expectedTotalEnrollment || 0,
      userId,
      ocOid
    ]);

    const studyId = insertResult.rows[0].study_id;

    // Assign creator to study with admin role
    const username = await client.query(`SELECT user_name FROM user_account WHERE user_id = $1`, [userId]);
    
    if (username.rows.length > 0) {
      await client.query(`
        INSERT INTO study_user_role (
          role_name, study_id, status_id, owner_id, date_created, user_name
        ) VALUES ('admin', $1, 1, $2, NOW(), $3)
      `, [studyId, userId, username.rows[0].user_name]);
    }

    // Log audit event - audit_log_event does NOT have study_id column
    try {
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name, new_value,
          audit_log_event_type_id
        ) VALUES (
          NOW(), 'study', $1, $2, 'Study', $3,
          COALESCE(
            (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%create%' OR name ILIKE '%insert%' LIMIT 1),
            1
          )
        )
      `, [userId, studyId, data.name]);
    } catch (auditError: any) {
      // Don't fail study creation if audit logging fails
      logger.warn('Audit logging failed for study creation', { error: auditError.message });
    }

    // Initialize default study parameters
    try {
      const defaultParams = [
        { handle: 'collectDob', value: '1' },        // Full date required
        { handle: 'genderRequired', value: 'true' },
        { handle: 'subjectPersonIdRequired', value: 'optional' },
        { handle: 'subjectIdGeneration', value: 'manual' },
        { handle: 'subjectIdPrefixSuffix', value: '' },
        { handle: 'discrepancyManagement', value: 'true' },
        { handle: 'interviewerNameRequired', value: 'required' },
        { handle: 'interviewerNameDefault', value: 'blank' },
        { handle: 'interviewerNameEditable', value: 'true' },
        { handle: 'interviewDateRequired', value: 'required' },
        { handle: 'interviewDateDefault', value: 'eventDate' },
        { handle: 'interviewDateEditable', value: 'true' },
        { handle: 'personIdShownOnCRF', value: 'false' },
        { handle: 'secondaryLabelViewable', value: 'false' },
        { handle: 'adminForcedReasonForChange', value: 'true' },
        { handle: 'eventLocationRequired', value: 'not_used' },
        { handle: 'participantPortal', value: 'disabled' },
        { handle: 'randomization', value: 'disabled' }
      ];

      for (const param of defaultParams) {
        await client.query(`
          INSERT INTO study_parameter_value (study_id, parameter, value)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [studyId, param.handle, param.value]);
      }
      logger.info('Study parameters initialized', { studyId, paramCount: defaultParams.length });
    } catch (paramError: any) {
      // Don't fail study creation if parameter initialization fails
      logger.warn('Study parameter initialization warning', { error: paramError.message });
    }

    await client.query('COMMIT');

    logger.info('✅ Study created successfully', { studyId, name: data.name, userId });

    return {
      success: true,
      studyId,
      message: 'Study created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('❌ Create study error', { error: error.message, data });

    return {
      success: false,
      message: `Failed to create study: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update study
 */
export const updateStudy = async (
  studyId: number,
  data: {
    name?: string;
    description?: string;
    principalInvestigator?: string;
    sponsor?: string;
    phase?: string;
    expectedTotalEnrollment?: number;
    datePlannedStart?: string;
    datePlannedEnd?: string;
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating study', { studyId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }

    if (data.description !== undefined) {
      updates.push(`summary = $${paramIndex++}`);
      params.push(data.description);
    }

    if (data.principalInvestigator !== undefined) {
      updates.push(`principal_investigator = $${paramIndex++}`);
      params.push(data.principalInvestigator);
    }

    if (data.sponsor !== undefined) {
      updates.push(`sponsor = $${paramIndex++}`);
      params.push(data.sponsor);
    }

    if (data.expectedTotalEnrollment !== undefined) {
      updates.push(`expected_total_enrollment = $${paramIndex++}`);
      params.push(data.expectedTotalEnrollment);
    }

    if (data.datePlannedStart !== undefined) {
      updates.push(`date_planned_start = $${paramIndex++}`);
      params.push(data.datePlannedStart);
    }

    if (data.datePlannedEnd !== undefined) {
      updates.push(`date_planned_end = $${paramIndex++}`);
      params.push(data.datePlannedEnd);
    }

    if (updates.length === 0) {
      return {
        success: false,
        message: 'No fields to update'
      };
    }

    updates.push(`date_updated = NOW()`);
    updates.push(`update_id = $${paramIndex++}`);
    params.push(userId);

    params.push(studyId);

    const updateQuery = `
      UPDATE study
      SET ${updates.join(', ')}
      WHERE study_id = $${paramIndex}
    `;

    await client.query(updateQuery, params);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, 'Study',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Study Updated' LIMIT 1)
      )
    `, [userId, studyId]);

    await client.query('COMMIT');

    logger.info('Study updated successfully', { studyId });

    return {
      success: true,
      message: 'Study updated successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update study error', { error: error.message, studyId });

    return {
      success: false,
      message: `Failed to update study: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Delete study (set status to removed)
 */
export const deleteStudy = async (
  studyId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting study', { studyId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if study has subjects
    const subjectsQuery = `SELECT COUNT(*) as count FROM study_subject WHERE study_id = $1`;
    const subjectsResult = await client.query(subjectsQuery, [studyId]);

    if (parseInt(subjectsResult.rows[0].count) > 0) {
      return {
        success: false,
        message: 'Cannot delete study with enrolled subjects. Set status to locked or removed instead.'
      };
    }

    // Soft delete (set status to removed = 5)
    await client.query(`
      UPDATE study
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE study_id = $2
    `, [userId, studyId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, 'Study',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Study Updated' LIMIT 1)
      )
    `, [userId, studyId]);

    await client.query('COMMIT');

    logger.info('Study deleted successfully', { studyId });

    return {
      success: true,
      message: 'Study deleted successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Delete study error', { error: error.message, studyId });

    return {
      success: false,
      message: `Failed to delete study: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Helper: Enrich SOAP study list with database statistics
 * This adds enrollment counts, completion rates, etc. to SOAP-sourced studies
 */
async function enrichStudiesWithStats(soapStudies: any[], userId: number): Promise<any[]> {
  if (!soapStudies || soapStudies.length === 0) {
    return [];
  }

  try {
    // Get stats for all studies in one query
    const studyOids = soapStudies.map(s => s.oid || s.identifier).filter(Boolean);
    
    if (studyOids.length === 0) {
      return soapStudies;
    }

    const statsQuery = `
      SELECT 
        s.study_id,
        s.oc_oid,
        s.unique_identifier,
        st.name as status,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as enrolled_subjects,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as active_subjects,
        (SELECT COUNT(DISTINCT sed.study_event_definition_id) FROM study_event_definition sed WHERE sed.study_id = s.study_id) as total_events,
        (SELECT COUNT(DISTINCT c.crf_id) FROM crf c WHERE c.source_study_id = s.study_id) as total_forms
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE s.oc_oid = ANY($1) OR s.unique_identifier = ANY($1)
    `;

    const statsResult = await pool.query(statsQuery, [studyOids]);
    
    // Create a map for quick lookup
    const statsMap = new Map();
    for (const row of statsResult.rows) {
      statsMap.set(row.oc_oid, row);
      statsMap.set(row.unique_identifier, row);
    }

    // Merge SOAP data with DB stats
    return soapStudies.map(soapStudy => {
      const stats = statsMap.get(soapStudy.oid) || statsMap.get(soapStudy.identifier) || {};
      return {
        ...soapStudy,
        study_id: stats.study_id,
        status: soapStudy.status || stats.status,
        enrolled_subjects: parseInt(stats.enrolled_subjects) || 0,
        active_subjects: parseInt(stats.active_subjects) || 0,
        total_events: parseInt(stats.total_events) || 0,
        total_forms: parseInt(stats.total_forms) || 0,
        source: 'SOAP' // Mark as SOAP-sourced for Part 11 compliance
      };
    });
  } catch (error: any) {
    logger.warn('Failed to enrich studies with stats', { error: error.message });
    // Return SOAP studies without enrichment
    return soapStudies.map(s => ({ ...s, source: 'SOAP' }));
  }
}

// Re-export getStudyForms from form.service for backwards compatibility
export { getStudyForms } from './form.service';

export default {
  getStudies,
  getStudyById,
  getStudyMetadata,
  getStudySites,
  createStudy,
  updateStudy,
  deleteStudy
};

