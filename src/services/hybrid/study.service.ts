/**
 * Study Service (Hybrid)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * LibreClinica Integration Architecture
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service integrates with LibreClinica using established channels:
 * 
 * SOAP API (PRIMARY for clinical operations - Part 11 Compliant):
 * ─────────────────────────────────────────────────────────────────
 *   ✓ listStudies()       - Get study list via SOAP study/listAll
 *   ✓ getStudyMetadata()  - Get ODM metadata via SOAP study/getMetadata
 *   
 *   LibreClinica SOAP endpoints:
 *   - studySubject: create, isStudySubject, listAllByStudy
 *   - event: schedule, create  
 *   - data: import (ODM-XML format)
 *   - study: listAll, getMetadata
 *   - crf: listAll
 * 
 * DIRECT DATABASE (for admin operations NOT exposed via SOAP):
 * ─────────────────────────────────────────────────────────────────
 *   ✓ createStudy()       - Study creation (not available in SOAP API)
 *   ✓ updateStudy()       - Study updates (not available in SOAP API)
 *   ✓ getStudyStats()     - Enrollment stats, query counts
 *   ✓ getStudyUsers()     - User role assignments
 *   ✓ Audit logging       - audit_log_event table
 * 
 * NOTE: LibreClinica's SOAP API is designed for clinical data operations
 * (subjects, events, CRF data). Administrative operations like study
 * creation/modification are done via the LibreClinica web UI or database.
 * 
 * DATABASE: We connect to the SAME PostgreSQL database that LibreClinica uses.
 * Port 5434 = LibreClinica's production database (libreclinica-postgres)
 * Port 5433 = Unit test database only (api-test-db) - NOT for production
 * ═══════════════════════════════════════════════════════════════════════════════
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
    WHERE source_study_id = $1
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
/**
 * Create study - supports ALL LibreClinica database fields
 * 
 * Database columns in study table:
 * - Identification: name, unique_identifier, secondary_identifier, official_title, oc_oid
 * - Description: summary, protocol_description
 * - Timeline: date_planned_start, date_planned_end, date_created, date_updated
 * - Classification: protocol_type, phase, type_id
 * - Enrollment: expected_total_enrollment
 * - Team: principal_investigator, sponsor, collaborators
 * - Facility: facility_name, facility_city, facility_state, facility_zip, facility_country,
 *             facility_recruitment_status, facility_contact_name, facility_contact_degree,
 *             facility_contact_phone, facility_contact_email
 * - Protocol: protocol_date_verification, medline_identifier, url, url_description, results_reference
 * - Eligibility: conditions, keywords, eligibility, gender, age_min, age_max, healthy_volunteer_accepted
 * - Design: purpose, allocation, masking, control, assignment, endpoint, interventions, duration, selection, timing
 */
export const createStudy = async (
  data: {
    // Required
    name: string;
    uniqueIdentifier: string;
    
    // Identification
    secondaryIdentifier?: string;
    officialTitle?: string;
    summary?: string;
    
    // Team
    principalInvestigator?: string;
    sponsor?: string;
    collaborators?: string;
    
    // Classification
    phase?: string;
    protocolType?: string;
    expectedTotalEnrollment?: number;
    datePlannedStart?: string;
    datePlannedEnd?: string;
    parentStudyId?: number;
    
    // Facility
    facilityName?: string;
    facilityCity?: string;
    facilityState?: string;
    facilityZip?: string;
    facilityCountry?: string;
    facilityRecruitmentStatus?: string;
    facilityContactName?: string;
    facilityContactDegree?: string;
    facilityContactPhone?: string;
    facilityContactEmail?: string;
    
    // Protocol
    protocolDescription?: string;
    protocolDateVerification?: string;
    medlineIdentifier?: string;
    url?: string;
    urlDescription?: string;
    resultsReference?: boolean;
    conditions?: string;
    keywords?: string;
    interventions?: string;
    
    // Eligibility
    eligibility?: string;
    gender?: string;
    ageMin?: string;
    ageMax?: string;
    healthyVolunteerAccepted?: boolean;
    
    // Study Design
    purpose?: string;
    allocation?: string;
    masking?: string;
    control?: string;
    assignment?: string;
    endpoint?: string;
    duration?: string;
    selection?: string;
    timing?: string;
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

    // Insert study with ALL database fields that exist in the LibreClinica schema
    // Verified against study table schema (libreclinica-full-schema.sql lines 3477-3544)
    const insertQuery = `
      INSERT INTO study (
        parent_study_id, unique_identifier, secondary_identifier, name,
        official_title, summary, protocol_description, protocol_date_verification,
        date_planned_start, date_planned_end,
        expected_total_enrollment, status_id, owner_id, date_created,
        protocol_type, phase, sponsor, collaborators,
        principal_investigator,
        facility_name, facility_city, facility_state, facility_zip, facility_country,
        facility_recruitment_status, facility_contact_name, facility_contact_degree,
        facility_contact_phone, facility_contact_email,
        medline_identifier, url, url_description, results_reference,
        conditions, keywords, eligibility, gender, age_min, age_max, healthy_volunteer_accepted,
        purpose, allocation, masking, control, assignment, endpoint, interventions, duration, selection, timing,
        oc_oid
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, NOW(),
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31,
        $32, $33, $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44, $45, $46, $47, $48,
        $49
      )
      RETURNING study_id
    `;

    const insertResult = await client.query(insertQuery, [
      // Identification
      data.parentStudyId || null,                                    // $1  parent_study_id
      data.uniqueIdentifier,                                          // $2  unique_identifier
      data.secondaryIdentifier || null,                               // $3  secondary_identifier
      data.name,                                                       // $4  name
      data.officialTitle || null,                                     // $5  official_title
      data.summary || '',                                              // $6  summary
      data.protocolDescription || null,                               // $7  protocol_description
      data.protocolDateVerification || null,                          // $8  protocol_date_verification
      
      // Timeline
      data.datePlannedStart || null,                                  // $9  date_planned_start
      data.datePlannedEnd || null,                                    // $10 date_planned_end
      data.expectedTotalEnrollment || 0,                              // $11 expected_total_enrollment
      userId,                                                          // $12 owner_id
      
      // Classification
      data.protocolType || 'interventional',                          // $13 protocol_type
      data.phase || null,                                              // $14 phase
      data.sponsor || '',                                              // $15 sponsor
      data.collaborators || null,                                     // $16 collaborators
      data.principalInvestigator || null,                             // $17 principal_investigator
      
      // Facility
      data.facilityName || null,                                      // $18 facility_name
      data.facilityCity || null,                                      // $19 facility_city
      data.facilityState || null,                                     // $20 facility_state
      data.facilityZip || null,                                       // $21 facility_zip
      data.facilityCountry || null,                                   // $22 facility_country
      data.facilityRecruitmentStatus || null,                         // $23 facility_recruitment_status
      data.facilityContactName || null,                               // $24 facility_contact_name
      data.facilityContactDegree || null,                             // $25 facility_contact_degree
      data.facilityContactPhone || null,                              // $26 facility_contact_phone
      data.facilityContactEmail || null,                              // $27 facility_contact_email
      
      // Protocol
      data.medlineIdentifier || null,                                 // $28 medline_identifier
      data.url || null,                                                // $29 url
      data.urlDescription || null,                                    // $30 url_description
      data.resultsReference || null,                                  // $31 results_reference
      
      // Eligibility
      data.conditions || null,                                        // $32 conditions
      data.keywords || null,                                          // $33 keywords
      data.eligibility || null,                                       // $34 eligibility
      data.gender || null,                                             // $35 gender
      data.ageMin || null,                                             // $36 age_min
      data.ageMax || null,                                             // $37 age_max
      data.healthyVolunteerAccepted || null,                          // $38 healthy_volunteer_accepted
      
      // Study Design
      data.purpose || null,                                            // $39 purpose
      data.allocation || null,                                        // $40 allocation
      data.masking || null,                                           // $41 masking
      data.control || null,                                            // $42 control
      data.assignment || null,                                        // $43 assignment
      data.endpoint || null,                                          // $44 endpoint
      data.interventions || null,                                     // $45 interventions
      data.duration || null,                                          // $46 duration
      data.selection || null,                                         // $47 selection
      data.timing || null,                                            // $48 timing
      
      // OID
      ocOid                                                           // $49 oc_oid
    ]);

    const studyId = insertResult.rows[0].study_id;

    // Assign creator to study with admin role (using SAVEPOINT for Part 11 compliance)
    // SAVEPOINT allows this optional operation to fail without aborting the main transaction
    try {
      await client.query('SAVEPOINT assign_role');
      const username = await client.query(`SELECT user_name FROM user_account WHERE user_id = $1`, [userId]);
      
      if (username.rows.length > 0) {
        await client.query(`
          INSERT INTO study_user_role (
            role_name, study_id, status_id, owner_id, date_created, user_name
          ) VALUES ('admin', $1, 1, $2, NOW(), $3)
        `, [studyId, userId, username.rows[0].user_name]);
      }
      await client.query('RELEASE SAVEPOINT assign_role');
    } catch (roleError: any) {
      await client.query('ROLLBACK TO SAVEPOINT assign_role');
      logger.warn('Study role assignment warning', { error: roleError.message });
    }

    // Log audit event for Part 11 compliance (21 CFR Part 11 requires audit trail)
    try {
      await client.query('SAVEPOINT audit_log');
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
      await client.query('RELEASE SAVEPOINT audit_log');
    } catch (auditError: any) {
      await client.query('ROLLBACK TO SAVEPOINT audit_log');
      logger.warn('Audit logging failed for study creation', { error: auditError.message });
    }

    // Initialize default study parameters (optional - uses SAVEPOINT)
    try {
      await client.query('SAVEPOINT init_params');
      const defaultParams = [
        { handle: 'collectDob', value: '1' },
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
      await client.query('RELEASE SAVEPOINT init_params');
      logger.info('Study parameters initialized', { studyId, paramCount: defaultParams.length });
    } catch (paramError: any) {
      await client.query('ROLLBACK TO SAVEPOINT init_params');
      logger.warn('Study parameter initialization warning', { error: paramError.message });
    }

    // Create event definitions (phases) if provided
    if ((data as any).eventDefinitions && Array.isArray((data as any).eventDefinitions)) {
      const eventDefs = (data as any).eventDefinitions;
      logger.info('Creating study event definitions', { studyId, count: eventDefs.length });
      
      for (const eventDef of eventDefs) {
        if (!eventDef.name) continue;
        
        // Generate OC OID for event
        const eventOid = `SE_${studyId}_${eventDef.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`;
        
        // Insert study_event_definition
        const eventResult = await client.query(`
          INSERT INTO study_event_definition (
            study_id, name, description, ordinal, type, repeating, category,
            status_id, owner_id, date_created, oc_oid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9)
          RETURNING study_event_definition_id
        `, [
          studyId,
          eventDef.name,
          eventDef.description || '',
          eventDef.ordinal || 1,
          eventDef.type || 'scheduled',
          eventDef.repeating || false,
          eventDef.category || 'Study Event',
          userId,
          eventOid
        ]);
        
        const eventDefId = eventResult.rows[0].study_event_definition_id;
        logger.info('Created study event definition', { eventDefId, name: eventDef.name });
        
        // Assign CRFs to this event if provided
        if (eventDef.crfAssignments && Array.isArray(eventDef.crfAssignments)) {
          for (const crfAssign of eventDef.crfAssignments) {
            if (!crfAssign.crfId) continue;
            
            // Get default version if not specified
            let defaultVersionId = crfAssign.crfVersionId;
            if (!defaultVersionId) {
              const versionResult = await client.query(`
                SELECT crf_version_id FROM crf_version
                WHERE crf_id = $1 AND status_id = 1
                ORDER BY crf_version_id DESC LIMIT 1
              `, [crfAssign.crfId]);
              if (versionResult.rows.length > 0) {
                defaultVersionId = versionResult.rows[0].crf_version_id;
              }
            }
            
            // Insert event_definition_crf
            await client.query(`
              INSERT INTO event_definition_crf (
                study_event_definition_id, study_id, crf_id, required_crf,
                double_entry, hide_crf, ordinal, status_id, owner_id,
                date_created, default_version_id, electronic_signature
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9, $10)
            `, [
              eventDefId,
              studyId,
              crfAssign.crfId,
              crfAssign.required ?? false,
              crfAssign.doubleDataEntry ?? false,
              crfAssign.hideCrf ?? false,
              crfAssign.ordinal || 1,
              userId,
              defaultVersionId,
              crfAssign.electronicSignature ?? false
            ]);
            
            logger.info('Assigned CRF to event', { eventDefId, crfId: crfAssign.crfId });
          }
        }
      }
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
 * Update study - supports ALL LibreClinica database fields
 */
export const updateStudy = async (
  studyId: number,
  data: {
    // Basic Info
    name?: string;
    officialTitle?: string;
    secondaryIdentifier?: string;
    summary?: string;
    description?: string;
    
    // Team
    principalInvestigator?: string;
    sponsor?: string;
    collaborators?: string;
    
    // Timeline
    phase?: string;
    protocolType?: string;
    expectedTotalEnrollment?: number;
    datePlannedStart?: string;
    datePlannedEnd?: string;
    
    // Facility
    facilityName?: string;
    facilityCity?: string;
    facilityState?: string;
    facilityZip?: string;
    facilityCountry?: string;
    facilityRecruitmentStatus?: string;
    facilityContactName?: string;
    facilityContactDegree?: string;
    facilityContactPhone?: string;
    facilityContactEmail?: string;
    
    // Protocol
    protocolDescription?: string;
    protocolDateVerification?: string;
    medlineIdentifier?: string;
    url?: string;
    urlDescription?: string;
    resultsReference?: boolean;
    conditions?: string;
    keywords?: string;
    interventions?: string;
    
    // Eligibility
    eligibility?: string;
    gender?: string;
    ageMin?: string;
    ageMax?: string;
    healthyVolunteerAccepted?: boolean;
    
    // Design
    purpose?: string;
    allocation?: string;
    masking?: string;
    control?: string;
    assignment?: string;
    endpoint?: string;
    duration?: string;
    selection?: string;
    timing?: string;
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating study', { studyId, userId, fields: Object.keys(data) });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Field mapping: frontend name -> database column
    // This mapping covers ALL columns in the LibreClinica study table (see libreclinica-full-schema.sql)
    const fieldMapping: Record<string, string> = {
      // Basic identification
      name: 'name',
      officialTitle: 'official_title',
      secondaryIdentifier: 'secondary_identifier',
      summary: 'summary',
      description: 'summary',  // Map description to summary column (alias)
      
      // Team
      principalInvestigator: 'principal_investigator',
      sponsor: 'sponsor',
      collaborators: 'collaborators',
      
      // Classification & Timeline
      phase: 'phase',
      protocolType: 'protocol_type',
      expectedTotalEnrollment: 'expected_total_enrollment',
      datePlannedStart: 'date_planned_start',
      datePlannedEnd: 'date_planned_end',
      
      // Facility
      facilityName: 'facility_name',
      facilityCity: 'facility_city',
      facilityState: 'facility_state',
      facilityZip: 'facility_zip',
      facilityCountry: 'facility_country',
      facilityRecruitmentStatus: 'facility_recruitment_status',
      facilityContactName: 'facility_contact_name',
      facilityContactDegree: 'facility_contact_degree',
      facilityContactPhone: 'facility_contact_phone',
      facilityContactEmail: 'facility_contact_email',
      
      // Protocol details
      protocolDescription: 'protocol_description',
      protocolDateVerification: 'protocol_date_verification',
      medlineIdentifier: 'medline_identifier',
      url: 'url',
      urlDescription: 'url_description',
      resultsReference: 'results_reference',
      conditions: 'conditions',
      keywords: 'keywords',
      interventions: 'interventions',
      
      // Eligibility
      eligibility: 'eligibility',
      gender: 'gender',
      ageMin: 'age_min',
      ageMax: 'age_max',
      healthyVolunteerAccepted: 'healthy_volunteer_accepted',
      
      // Study Design
      purpose: 'purpose',
      allocation: 'allocation',
      masking: 'masking',
      control: 'control',
      assignment: 'assignment',
      endpoint: 'endpoint',
      duration: 'duration',
      selection: 'selection',
      timing: 'timing'
    };

    // Build update query dynamically
    for (const [frontendField, dbColumn] of Object.entries(fieldMapping)) {
      const value = (data as any)[frontendField];
      if (value !== undefined && value !== null) {
        updates.push(`${dbColumn} = $${paramIndex++}`);
        params.push(value);
      }
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

    logger.info('Executing update query', { updateCount: updates.length, studyId });
    await client.query(updateQuery, params);

    // Log audit event (optional - don't fail if audit table doesn't exist)
    try {
      await client.query('SAVEPOINT audit_log');
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name,
          audit_log_event_type_id
        ) VALUES (
          NOW(), 'study', $1, $2, 'Study',
          COALESCE(
            (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE '%update%' LIMIT 1),
            1
          )
        )
      `, [userId, studyId]);
      await client.query('RELEASE SAVEPOINT audit_log');
    } catch (auditError: any) {
      await client.query('ROLLBACK TO SAVEPOINT audit_log');
      logger.warn('Audit logging failed for study update', { error: auditError.message });
    }

    await client.query('COMMIT');

    logger.info('Study updated successfully', { studyId, fieldsUpdated: updates.length });

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

