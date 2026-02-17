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
import { CreateStudyRequest, UpdateStudyRequest } from '../../types/study.dto';

// Study metadata interface — typed references to study configuration
export interface StudyMetadata {
  study: Record<string, unknown>;
  events: Record<string, unknown>[];
  crfs: Record<string, unknown>[];
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

    // NOTE: Disabled SOAP for study listing because SOAP returns studies that may not exist
    // in the local database, causing update operations to fail silently.
    // For proper CRUD operations, we always use the database directly.
    // SOAP study listing is inconsistent with database state in development environments.
    // 
    // Original code (kept for reference):
    // if (config.libreclinica.soapEnabled && username) {
    //   try {
    //     const soapResult = await studySoap.listStudies(userId, username);
    //     if (soapResult.success && soapResult.data) {
    //       logger.info('✅ Studies retrieved via SOAP', { count: soapResult.data.length });
    //       const enrichedStudies = await enrichStudiesWithStats(soapResult.data, userId);
    //       const paginatedStudies = enrichedStudies.slice(offset, offset + limit);
    //       return {
    //         success: true,
    //         data: paginatedStudies,
    //         pagination: { page, limit, total: enrichedStudies.length, totalPages: Math.ceil(enrichedStudies.length / limit) }
    //       };
    //     }
    //   } catch (soapError: any) {
    //     logger.warn('SOAP study list failed, falling back to DB', { error: soapError.message });
    //   }
    // }

    // Always use database for study listing to ensure CRUD consistency
    logger.info('📋 Using database fallback for study list');

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    // Check if user is admin AND whether they belong to an organization
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

    // Check organization membership to scope studies
    const orgCheck = await pool.query(
      `SELECT organization_id, role FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
    const belongsToOrg = userOrgIds.length > 0;
    const isOrgAdmin = orgCheck.rows.some((r: any) => r.role === 'admin');

    logger.info('📋 Study access check', { userId, isAdmin, belongsToOrg, isOrgAdmin, orgIds: userOrgIds });

    if (belongsToOrg) {
      // User belongs to an organization — scope studies to their org members
      if (isOrgAdmin || isAdmin) {
        // Org admin: see studies owned by ANY member of their organization(s)
        // plus studies they are directly assigned to via study_user_role
        conditions.push(`(
          s.owner_id IN (
            SELECT m.user_id FROM acc_organization_member m
            WHERE m.organization_id = ANY($${paramIndex++}::int[])
              AND m.status = 'active'
          )
          OR EXISTS (
            SELECT 1 FROM study_user_role sur
            WHERE sur.study_id = s.study_id
              AND sur.user_name = (SELECT user_name FROM user_account WHERE user_id = $${paramIndex++})
              AND sur.status_id = 1
          )
        )`);
        params.push(userOrgIds, userId);
      } else {
        // Regular org member: see only studies they own or are assigned to
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
    } else if (!isAdmin) {
      // No org membership and not a system admin: filter by own/assigned studies
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
    // else: system admin with no org membership — sees all studies (root admin)

    // Only show parent studies (not sites which have parent_study_id set)
    conditions.push(`s.parent_study_id IS NULL`);

    if (status) {
      conditions.push(`st.name = $${paramIndex++}`);
      params.push(status);
    } else {
      // By default, exclude archived/removed studies (status_id = 5 and 7)
      // Users must explicitly request status='removed' to see archived studies
      conditions.push(`s.status_id NOT IN (5, 7)`);
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
        (SELECT COUNT(DISTINCT c.crf_id) FROM crf c WHERE c.source_study_id = s.study_id AND c.status_id NOT IN (5, 6, 7)) as total_forms,
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
 * Get study by ID with ALL fields including nested data
 * Returns: study data, event definitions, group classes, sites, and parameters
 */
export const getStudyById = async (studyId: number, userId: number): Promise<any> => {
  logger.info('Getting study details with full data', { studyId, userId });

  try {
    // Org-scoping: if caller belongs to an org, verify the study is accessible
    const orgCheck = await pool.query(
      `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);
    if (userOrgIds.length > 0) {
      const studyOwnerCheck = await pool.query(
        `SELECT s.owner_id FROM study s WHERE s.study_id = $1`, [studyId]
      );
      if (studyOwnerCheck.rows.length > 0) {
        const studyOwnerId = studyOwnerCheck.rows[0].owner_id;
        // Check if study owner is in the same org(s) OR if caller is directly assigned
        const ownerInOrg = await pool.query(
          `SELECT 1 FROM acc_organization_member WHERE user_id = $1 AND organization_id = ANY($2::int[]) AND status = 'active' LIMIT 1`,
          [studyOwnerId, userOrgIds]
        );
        if (ownerInOrg.rows.length === 0) {
          // Also check if user is directly assigned via study_user_role
          const directAssign = await pool.query(
            `SELECT 1 FROM study_user_role sur INNER JOIN user_account u ON sur.user_name = u.user_name WHERE u.user_id = $1 AND sur.study_id = $2 AND sur.status_id = 1 LIMIT 1`,
            [userId, studyId]
          );
          if (directAssign.rows.length === 0) {
            logger.warn('getStudyById org-scoping denied', { studyId, userId, userOrgIds });
            return null;
          }
        }
      }
    }

    // Get all study columns explicitly
    const query = `
      SELECT 
        s.study_id,
        s.parent_study_id,
        s.unique_identifier,
        s.secondary_identifier,
        s.name,
        s.official_title,
        s.summary,
        s.protocol_description,
        s.protocol_date_verification,
        s.date_planned_start,
        s.date_planned_end,
        s.date_created,
        s.date_updated,
        s.expected_total_enrollment,
        s.status_id,
        s.owner_id,
        s.oc_oid,
        s.protocol_type,
        s.phase,
        s.sponsor,
        s.collaborators,
        s.principal_investigator,
        s.facility_name,
        s.facility_address,
        s.facility_city,
        s.facility_state,
        s.facility_zip,
        s.facility_country,
        s.facility_recruitment_status,
        s.facility_contact_name,
        s.facility_contact_degree,
        s.facility_contact_phone,
        s.facility_contact_email,
        s.medline_identifier,
        s.url,
        s.url_description,
        s.results_reference,
        s.conditions,
        s.keywords,
        s.eligibility,
        s.gender,
        s.age_min,
        s.age_max,
        s.healthy_volunteer_accepted,
        s.purpose,
        s.allocation,
        s.masking,
        s.control,
        s.assignment,
        s.endpoint,
        s.interventions,
        s.duration,
        s.selection,
        s.timing,
        s.study_acronym,
        s.protocol_version,
        s.protocol_amendment_number,
        s.therapeutic_area,
        s.indication,
        s.nct_number,
        s.irb_number,
        s.regulatory_authority,
        s.fpfv_date,
        s.lpfv_date,
        s.lplv_date,
        s.database_lock_date,
        s.sdv_requirement,
        st.name as status_name,
        s.protocol_type as type_name,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as total_subjects,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id AND status_id = 1) as active_subjects,
        (SELECT COUNT(*) FROM study_event_definition WHERE study_id = s.study_id) as total_events,
        (SELECT COUNT(*) FROM crf WHERE source_study_id = s.study_id AND status_id NOT IN (5, 6, 7)) as total_forms,
        (SELECT COUNT(*) FROM discrepancy_note WHERE study_id = s.study_id AND parent_dn_id IS NULL) as total_queries
      FROM study s
      INNER JOIN status st ON s.status_id = st.status_id
      WHERE s.study_id = $1
    `;

    const result = await pool.query(query, [studyId]);

    if (result.rows.length === 0) {
      return null;
    }

    const study = result.rows[0];

    // Get event definitions with CRF assignments
    const eventsQuery = `
      SELECT 
        sed.study_event_definition_id,
        sed.name,
        sed.description,
        sed.category,
        sed.type,
        sed.ordinal,
        sed.repeating,
        sed.oc_oid,
        sed.status_id,
        sed.schedule_day,
        sed.min_day,
        sed.max_day,
        sed.reference_event_id
      FROM study_event_definition sed
      WHERE sed.study_id = $1 AND sed.status_id = 1
      ORDER BY sed.ordinal
    `;
    const eventsResult = await pool.query(eventsQuery, [studyId]);
    
    // Get CRF assignments for each event
    const eventDefinitions = [];
    for (const event of eventsResult.rows) {
      const crfQuery = `
        SELECT 
          edc.crf_id,
          edc.required_crf as required,
          edc.double_entry as double_data_entry,
          COALESCE(awc.requires_signature, edc.electronic_signature, false) as electronic_signature,
          COALESCE(awc.requires_sdv, false) as requires_sdv,
          COALESCE(awc.requires_dde, false) as requires_dde,
          edc.hide_crf,
          edc.ordinal,
          c.name as crf_name
        FROM event_definition_crf edc
        INNER JOIN crf c ON edc.crf_id = c.crf_id
        LEFT JOIN acc_form_workflow_config awc ON (
          c.crf_id = awc.crf_id AND (awc.study_id IS NULL OR awc.study_id = edc.study_id)
        )
        WHERE edc.study_event_definition_id = $1 AND edc.status_id = 1
        ORDER BY edc.ordinal
      `;
      const crfResult = await pool.query(crfQuery, [event.study_event_definition_id]);
      
      eventDefinitions.push({
        studyEventDefinitionId: event.study_event_definition_id,
        name: event.name,
        description: event.description,
        category: event.category,
        type: event.type,
        ordinal: event.ordinal,
        repeating: event.repeating,
        oid: event.oc_oid,
        scheduleDay: event.schedule_day,
        minDay: event.min_day,
        maxDay: event.max_day,
        referenceEventId: event.reference_event_id,
        crfAssignments: crfResult.rows.map((crf: any) => ({
          crfId: crf.crf_id,
          crfName: crf.crf_name,
          required: crf.required,
          doubleDataEntry: crf.double_data_entry,
          electronicSignature: crf.electronic_signature,
          hideCrf: crf.hide_crf,
          ordinal: crf.ordinal
        }))
      });
    }

    // Get group classes with groups
    const groupClassesQuery = `
      SELECT 
        sgc.study_group_class_id,
        sgc.name,
        sgc.group_class_type_id,
        sgc.custom_type_name,
        sgc.subject_assignment,
        sgc.status_id
      FROM study_group_class sgc
      WHERE sgc.study_id = $1 AND sgc.status_id = 1
    `;
    const groupClassesResult = await pool.query(groupClassesQuery, [studyId]);
    
    const groupClasses = [];
    for (const gc of groupClassesResult.rows) {
      // Note: Real LibreClinica study_group table may not have status_id column
      let groupsResult;
      try {
        const groupsQuery = `
          SELECT 
            sg.study_group_id,
            sg.name,
            sg.description
          FROM study_group sg
          WHERE sg.study_group_class_id = $1 AND (sg.status_id = 1 OR sg.status_id IS NULL)
        `;
        groupsResult = await pool.query(groupsQuery, [gc.study_group_class_id]);
      } catch {
        // Fallback for minimal schema without status_id
        const groupsQueryMinimal = `
          SELECT 
            sg.study_group_id,
            sg.name,
            sg.description
          FROM study_group sg
          WHERE sg.study_group_class_id = $1
        `;
        groupsResult = await pool.query(groupsQueryMinimal, [gc.study_group_class_id]);
      }
      
      groupClasses.push({
        studyGroupClassId: gc.study_group_class_id,
        name: gc.name,
        groupClassTypeId: gc.group_class_type_id,
        customTypeName: gc.custom_type_name || undefined,
        subjectAssignment: gc.subject_assignment,
        groups: groupsResult.rows.map((g: any) => ({
          studyGroupId: g.study_group_id,
          name: g.name,
          description: g.description
        }))
      });
    }

    // Get sites (child studies)
    const sitesQuery = `
      SELECT 
        s.study_id,
        s.unique_identifier,
        s.name,
        s.principal_investigator,
        s.expected_total_enrollment,
        s.facility_name,
        s.facility_address,
        s.facility_city,
        s.facility_state,
        s.facility_zip,
        s.facility_country,
        s.facility_recruitment_status,
        s.status_id,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as enrolled_subjects
      FROM study s
      WHERE s.parent_study_id = $1 AND s.status_id = 1
      ORDER BY s.name
    `;
    const sitesResult = await pool.query(sitesQuery, [studyId]);
    
    const sites = sitesResult.rows.map((site: any) => ({
      studyId: site.study_id,
      uniqueIdentifier: site.unique_identifier,
      name: site.name,
      principalInvestigator: site.principal_investigator,
      expectedTotalEnrollment: site.expected_total_enrollment,
      facilityName: site.facility_name,
      facilityAddress: site.facility_address,
      facilityCity: site.facility_city,
      facilityState: site.facility_state,
      facilityZip: site.facility_zip,
      facilityCountry: site.facility_country,
      facilityRecruitmentStatus: site.facility_recruitment_status,
      enrolledSubjects: parseInt(site.enrolled_subjects) || 0,
      isActive: site.status_id === 1
    }));

    // Get study parameters
    const paramsQuery = `
      SELECT parameter, value
      FROM study_parameter_value
      WHERE study_id = $1
    `;
    const paramsResult = await pool.query(paramsQuery, [studyId]);
    
    const studyParameters: Record<string, string> = {};
    for (const param of paramsResult.rows) {
      studyParameters[param.parameter] = param.value;
    }

    // Return complete study data with all nested structures
    return {
      ...study,
      eventDefinitions,
      groupClasses,
      sites,
      studyParameters
    };
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
  data: CreateStudyRequest,
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
    const insertQuery = `
      INSERT INTO study (
        parent_study_id, unique_identifier, secondary_identifier, name,
        official_title, summary, protocol_description, protocol_date_verification,
        date_planned_start, date_planned_end,
        expected_total_enrollment, status_id, owner_id, date_created,
        protocol_type, phase, sponsor, collaborators,
        principal_investigator,
        facility_name, facility_address, facility_city, facility_state, facility_zip, facility_country,
        facility_recruitment_status, facility_contact_name, facility_contact_degree,
        facility_contact_phone, facility_contact_email,
        medline_identifier, url, url_description, results_reference,
        conditions, keywords, eligibility, gender, age_min, age_max, healthy_volunteer_accepted,
        purpose, allocation, masking, control, assignment, endpoint, interventions, duration, selection, timing,
        oc_oid,
        study_acronym, protocol_version, protocol_amendment_number,
        therapeutic_area, indication, nct_number, irb_number, regulatory_authority,
        fpfv_date, lpfv_date, lplv_date, database_lock_date,
        sdv_requirement
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, NOW(),
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34, $35, $36, $37, $38, $39,
        $40, $41, $42, $43, $44, $45, $46, $47, $48, $49,
        $50,
        $51, $52, $53,
        $54, $55, $56, $57, $58,
        $59, $60, $61, $62,
        $63
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
      data.summary || null,                                             // $6  summary
      data.protocolDescription || null,                               // $7  protocol_description
      data.protocolDateVerification || null,                          // $8  protocol_date_verification
      
      // Timeline
      data.datePlannedStart || null,                                  // $9  date_planned_start
      data.datePlannedEnd || null,                                    // $10 date_planned_end
      data.expectedTotalEnrollment ?? null,                            // $11 expected_total_enrollment
      userId,                                                          // $12 owner_id
      
      // Classification
      data.protocolType || 'interventional',                          // $13 protocol_type
      data.phase || null,                                              // $14 phase
      data.sponsor || null,                                            // $15 sponsor
      data.collaborators || null,                                     // $16 collaborators
      data.principalInvestigator || null,                             // $17 principal_investigator
      
      // Facility
      data.facilityName || null,                                      // $18 facility_name
      data.facilityAddress || null,                                     // $19 facility_address
      data.facilityCity || null,                                      // $20 facility_city
      data.facilityState || null,                                     // $21 facility_state
      data.facilityZip || null,                                       // $22 facility_zip
      data.facilityCountry || null,                                   // $23 facility_country
      data.facilityRecruitmentStatus || null,                         // $24 facility_recruitment_status
      data.facilityContactName || null,                               // $25 facility_contact_name
      data.facilityContactDegree || null,                             // $26 facility_contact_degree
      data.facilityContactPhone || null,                              // $27 facility_contact_phone
      data.facilityContactEmail || null,                              // $28 facility_contact_email
      
      // Protocol
      data.medlineIdentifier || null,                                 // $29 medline_identifier
      data.url || null,                                                // $30 url
      data.urlDescription || null,                                    // $31 url_description
      data.resultsReference ?? null,                                   // $32 results_reference
      
      // Eligibility
      data.conditions || null,                                        // $33 conditions
      data.keywords || null,                                          // $34 keywords
      data.eligibility || null,                                       // $35 eligibility
      data.gender || null,                                             // $36 gender
      data.ageMin || null,                                             // $37 age_min
      data.ageMax || null,                                             // $38 age_max
      data.healthyVolunteerAccepted ?? null,                           // $39 healthy_volunteer_accepted
      
      // Study Design
      data.purpose || null,                                            // $40 purpose
      data.allocation || null,                                        // $41 allocation
      data.masking || null,                                           // $42 masking
      data.control || null,                                            // $43 control
      data.assignment || null,                                        // $44 assignment
      data.endpoint || null,                                          // $45 endpoint
      data.interventions || null,                                     // $46 interventions
      data.duration || null,                                          // $47 duration
      data.selection || null,                                         // $48 selection
      data.timing || null,                                            // $49 timing
      
      // OID
      ocOid,                                                          // $50 oc_oid
      
      // New fields: Identification
      data.studyAcronym || null,                                      // $51 study_acronym
      data.protocolVersion || null,                                   // $52 protocol_version
      data.protocolAmendmentNumber || null,                           // $53 protocol_amendment_number
      
      // New fields: Regulatory
      data.therapeuticArea || null,                                    // $54 therapeutic_area
      data.indication || null,                                        // $55 indication
      data.nctNumber || null,                                         // $56 nct_number
      data.irbNumber || null,                                         // $57 irb_number
      data.regulatoryAuthority || null,                               // $58 regulatory_authority
      
      // New fields: Timeline milestones
      data.fpfvDate || null,                                          // $59 fpfv_date
      data.lpfvDate || null,                                          // $60 lpfv_date
      data.lplvDate || null,                                          // $61 lplv_date
      data.databaseLockDate || null,                                  // $62 database_lock_date
      
      // New fields: Operational
      data.sdvRequirement || null                                     // $63 sdv_requirement
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

    // Initialize study parameters - uses user-provided values or defaults
    try {
      await client.query('SAVEPOINT init_params');
      const userParams = (data as any).studyParameters || {};
      
      // Define default parameters with user overrides
      // Accept both individual keys (legacy) and combined/DB-matching keys (new frontend)
      
      // Resolve subjectIdPrefixSuffix: accept combined key OR individual prefix/suffix keys
      const resolvedPrefixSuffix = userParams.subjectIdPrefixSuffix 
        || (userParams.subjectIdPrefix || userParams.subjectIdSuffix 
            ? `${userParams.subjectIdPrefix || ''}|${userParams.subjectIdSuffix || ''}` 
            : '');
      
      // Resolve personIdShownOnCRF: accept DB key (uppercase CRF) OR legacy key (lowercase)
      const resolvedPersonIdOnCrf = userParams.personIdShownOnCRF || userParams.personIdShownOnCrf || 'false';
      
      // Resolve eventLocationRequired: accept string values ('required'/'not_used') OR boolean
      const resolvedEventLocation = 
        userParams.eventLocationRequired === 'required' ? 'required' :
        userParams.eventLocationRequired === 'not_used' ? 'not_used' :
        userParams.eventLocationRequired === true ? 'required' : 'not_used';
      
      const defaultParams = [
        { handle: 'collectDob', value: userParams.collectDob || '1' },
        { handle: 'genderRequired', value: userParams.genderRequired || 'true' },
        { handle: 'subjectPersonIdRequired', value: userParams.subjectPersonIdRequired || 'optional' },
        { handle: 'subjectIdGeneration', value: userParams.subjectIdGeneration || 'manual' },
        { handle: 'subjectIdPrefixSuffix', value: resolvedPrefixSuffix },
        { handle: 'studySubjectIdLabel', value: userParams.studySubjectIdLabel || 'Subject ID' },
        { handle: 'secondaryIdLabel', value: userParams.secondaryIdLabel || 'Secondary ID' },
        { handle: 'discrepancyManagement', value: userParams.discrepancyManagement !== undefined ? 
            String(userParams.discrepancyManagement) : 'true' },
        { handle: 'interviewerNameRequired', value: 'required' },
        { handle: 'interviewerNameDefault', value: 'blank' },
        { handle: 'interviewerNameEditable', value: 'true' },
        { handle: 'interviewDateRequired', value: 'required' },
        { handle: 'interviewDateDefault', value: 'eventDate' },
        { handle: 'interviewDateEditable', value: 'true' },
        { handle: 'personIdShownOnCRF', value: resolvedPersonIdOnCrf },
        { handle: 'secondaryLabelViewable', value: userParams.secondaryLabelViewable !== undefined ?
            String(userParams.secondaryLabelViewable) : 'false' },
        { handle: 'adminForcedReasonForChange', value: 'true' },
        { handle: 'eventLocationRequired', value: resolvedEventLocation },
        { handle: 'dateOfEnrollmentForStudyRequired', value: userParams.dateOfEnrollmentForStudyRequired || 'true' },
        { handle: 'allowAdministrativeEditing', value: userParams.allowAdministrativeEditing !== undefined ?
            String(userParams.allowAdministrativeEditing) : 'true' },
        { handle: 'participantPortal', value: 'disabled' },
        { handle: 'randomization', value: 'disabled' },
        { handle: 'mailNotification', value: userParams.mailNotification || '' },
        { handle: 'contactEmail', value: userParams.contactEmail || '' }
      ];

      for (const param of defaultParams) {
        await client.query(`
          INSERT INTO study_parameter_value (study_id, parameter, value)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [studyId, param.handle, param.value]);
      }
      await client.query('RELEASE SAVEPOINT init_params');
      logger.info('Study parameters initialized', { studyId, paramCount: defaultParams.length, hasUserParams: Object.keys(userParams).length > 0 });
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
        
        // Insert study_event_definition (with visit window fields)
        const eventResult = await client.query(`
          INSERT INTO study_event_definition (
            study_id, name, description, ordinal, type, repeating, category,
            schedule_day, min_day, max_day, reference_event_id,
            status_id, owner_id, date_created, oc_oid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, NOW(), $13)
          RETURNING study_event_definition_id
        `, [
          studyId,
          eventDef.name,
          eventDef.description || '',
          eventDef.ordinal || 1,
          eventDef.type || 'scheduled',
          eventDef.repeating || false,
          eventDef.category || 'Study Event',
          eventDef.scheduleDay ?? null,
          eventDef.minDay ?? null,
          eventDef.maxDay ?? null,
          eventDef.referenceEventId ?? null,
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

    // Create group classes and groups if provided
    if ((data as any).groupClasses && Array.isArray((data as any).groupClasses)) {
      const groupClasses = (data as any).groupClasses;
      logger.info('Creating study group classes', { studyId, count: groupClasses.length });
      
      for (const groupClass of groupClasses) {
        if (!groupClass.name) continue;
        
        try {
          await client.query('SAVEPOINT create_group_class');
          
          // Insert study_group_class
          const groupClassResult = await client.query(`
            INSERT INTO study_group_class (
              study_id, name, group_class_type_id, custom_type_name, subject_assignment,
              status_id, owner_id, date_created
            ) VALUES ($1, $2, $3, $4, $5, 1, $6, NOW())
            RETURNING study_group_class_id
          `, [
            studyId,
            groupClass.name,
            groupClass.groupClassTypeId || 1,
            groupClass.customTypeName || null,
            groupClass.subjectAssignment || 'optional',
            userId
          ]);
          
          const groupClassId = groupClassResult.rows[0].study_group_class_id;
          logger.info('Created study group class', { groupClassId, name: groupClass.name });
          
            // Insert groups within this class
            // Note: Real LibreClinica study_group table is minimal (no status_id, owner_id columns)
            if (groupClass.groups && Array.isArray(groupClass.groups)) {
              for (const group of groupClass.groups) {
                if (!group.name) continue;
                
                try {
                  // Try with minimal columns first (real LibreClinica schema)
                  await client.query(`
                    INSERT INTO study_group (
                      study_group_class_id, name, description
                    ) VALUES ($1, $2, $3)
                  `, [
                    groupClassId,
                    group.name,
                    group.description || ''
                  ]);
                } catch (minimalError: any) {
                  // If that fails, try with extended columns (test schema)
                  await client.query(`
                    INSERT INTO study_group (
                      study_group_class_id, name, description,
                      status_id, owner_id, date_created
                    ) VALUES ($1, $2, $3, 1, $4, NOW())
                  `, [
                    groupClassId,
                    group.name,
                    group.description || '',
                    userId
                  ]);
                }
                
                logger.info('Created study group', { groupClassId, name: group.name });
              }
            }
          
          await client.query('RELEASE SAVEPOINT create_group_class');
        } catch (groupError: any) {
          await client.query('ROLLBACK TO SAVEPOINT create_group_class');
          logger.warn('Study group class creation warning', { error: groupError.message, groupClass: groupClass.name });
        }
      }
    }

    // Create sites (child studies) if provided
    if ((data as any).sites && Array.isArray((data as any).sites)) {
      const sites = (data as any).sites;
      logger.info('Creating study sites', { studyId, count: sites.length });
      
      for (const site of sites) {
        if (!site.name || !site.uniqueIdentifier) continue;
        
        try {
          await client.query('SAVEPOINT create_site');
          
          // Generate OC OID for site
          const siteOid = `S_${site.uniqueIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}`;
          
          // Insert site as child study
          await client.query(`
            INSERT INTO study (
              parent_study_id, unique_identifier, name, summary,
              principal_investigator, expected_total_enrollment,
              facility_name, facility_address, facility_city, facility_state, facility_zip, facility_country,
              facility_recruitment_status,
              status_id, owner_id, date_created, oc_oid
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14, NOW(), $15)
          `, [
            studyId,                                      // $1  parent_study_id
            site.uniqueIdentifier,                        // $2  unique_identifier
            site.name,                                    // $3  name
            site.summary || '',                           // $4  summary
            site.principalInvestigator || null,           // $5  principal_investigator
            site.expectedTotalEnrollment || 0,            // $6  expected_total_enrollment
            site.facilityName || null,                    // $7  facility_name
            site.facilityAddress || null,                 // $8  facility_address
            site.facilityCity || null,                    // $9  facility_city
            site.facilityState || null,                   // $10 facility_state
            site.facilityZip || null,                     // $11 facility_zip
            site.facilityCountry || null,                 // $12 facility_country
            site.facilityRecruitmentStatus || 'Not yet recruiting', // $13 facility_recruitment_status
            userId,                                       // $14 owner_id
            siteOid                                       // $15 oc_oid
          ]);
          
          logger.info('Created study site', { parentStudyId: studyId, siteName: site.name });
          
          await client.query('RELEASE SAVEPOINT create_site');
        } catch (siteError: any) {
          await client.query('ROLLBACK TO SAVEPOINT create_site');
          logger.warn('Study site creation warning', { error: siteError.message, site: site.name });
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
 * Update study - supports ALL LibreClinica database fields AND nested data
 * Handles: main study fields, event definitions, group classes, sites, and parameters
 */
export const updateStudy = async (
  studyId: number,
  data: UpdateStudyRequest,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating study with full data', { studyId, userId, fields: Object.keys(data) });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check study exists before updating
    const existsResult = await client.query('SELECT study_id FROM study WHERE study_id = $1', [studyId]);
    if (existsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study not found' };
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Field mapping: frontend name -> database column
    const fieldMapping: Record<string, string> = {
      name: 'name',
      officialTitle: 'official_title',
      secondaryIdentifier: 'secondary_identifier',
      summary: 'summary',
      description: 'summary',
      principalInvestigator: 'principal_investigator',
      sponsor: 'sponsor',
      collaborators: 'collaborators',
      phase: 'phase',
      protocolType: 'protocol_type',
      expectedTotalEnrollment: 'expected_total_enrollment',
      datePlannedStart: 'date_planned_start',
      datePlannedEnd: 'date_planned_end',
      facilityName: 'facility_name',
      facilityAddress: 'facility_address',
      facilityCity: 'facility_city',
      facilityState: 'facility_state',
      facilityZip: 'facility_zip',
      facilityCountry: 'facility_country',
      facilityRecruitmentStatus: 'facility_recruitment_status',
      facilityContactName: 'facility_contact_name',
      facilityContactDegree: 'facility_contact_degree',
      facilityContactPhone: 'facility_contact_phone',
      facilityContactEmail: 'facility_contact_email',
      protocolDescription: 'protocol_description',
      protocolDateVerification: 'protocol_date_verification',
      medlineIdentifier: 'medline_identifier',
      url: 'url',
      urlDescription: 'url_description',
      resultsReference: 'results_reference',
      conditions: 'conditions',
      keywords: 'keywords',
      interventions: 'interventions',
      eligibility: 'eligibility',
      gender: 'gender',
      ageMin: 'age_min',
      ageMax: 'age_max',
      healthyVolunteerAccepted: 'healthy_volunteer_accepted',
      purpose: 'purpose',
      allocation: 'allocation',
      masking: 'masking',
      control: 'control',
      assignment: 'assignment',
      endpoint: 'endpoint',
      duration: 'duration',
      selection: 'selection',
      timing: 'timing',
      // New fields: identification & operational
      studyAcronym: 'study_acronym',
      // Protocol versioning
      protocolVersion: 'protocol_version',
      protocolAmendmentNumber: 'protocol_amendment_number',
      // Regulatory
      therapeuticArea: 'therapeutic_area',
      indication: 'indication',
      nctNumber: 'nct_number',
      irbNumber: 'irb_number',
      regulatoryAuthority: 'regulatory_authority',
      // Timeline milestones
      fpfvDate: 'fpfv_date',
      lpfvDate: 'lpfv_date',
      lplvDate: 'lplv_date',
      databaseLockDate: 'database_lock_date',
      // Operational
      sdvRequirement: 'sdv_requirement'
    };

    // Build update query dynamically for main study fields
    for (const [frontendField, dbColumn] of Object.entries(fieldMapping)) {
      const value = (data as any)[frontendField];
      if (value !== undefined && value !== null) {
        updates.push(`${dbColumn} = $${paramIndex++}`);
        params.push(value);
      }
    }

    // Update main study table if there are fields to update
    if (updates.length > 0) {
      updates.push(`date_updated = NOW()`);
      updates.push(`update_id = $${paramIndex++}`);
      params.push(userId);
      params.push(studyId);

      const updateQuery = `
        UPDATE study
        SET ${updates.join(', ')}
        WHERE study_id = $${paramIndex}
      `;

      logger.info('Executing study update query', { updateCount: updates.length, studyId });
      await client.query(updateQuery, params);
    }

    // Update event definitions if provided
    if (data.eventDefinitions && Array.isArray(data.eventDefinitions)) {
      logger.info('Updating event definitions', { studyId, count: data.eventDefinitions.length });
      
      for (const eventDef of data.eventDefinitions) {
        if (!eventDef.name) continue;
        
        try {
          await client.query('SAVEPOINT update_event');
          
          if (eventDef.studyEventDefinitionId) {
            // Update existing event (including visit window fields)
            await client.query(`
              UPDATE study_event_definition
              SET name = $1, description = $2, category = $3, type = $4, 
                  ordinal = $5, repeating = $6, 
                  schedule_day = $7, min_day = $8, max_day = $9, reference_event_id = $10,
                  date_updated = NOW(), update_id = $11
              WHERE study_event_definition_id = $12
            `, [
              eventDef.name,
              eventDef.description || '',
              eventDef.category || 'Study Event',
              eventDef.type || 'scheduled',
              eventDef.ordinal || 1,
              eventDef.repeating || false,
              eventDef.scheduleDay ?? null,
              eventDef.minDay ?? null,
              eventDef.maxDay ?? null,
              eventDef.referenceEventId ?? null,
              userId,
              eventDef.studyEventDefinitionId
            ]);
            
            // Update CRF assignments - delete existing and recreate
            if (eventDef.crfAssignments && Array.isArray(eventDef.crfAssignments)) {
              await client.query(`
                UPDATE event_definition_crf SET status_id = 5
                WHERE study_event_definition_id = $1
              `, [eventDef.studyEventDefinitionId]);
              
              for (const crfAssign of eventDef.crfAssignments) {
                if (!crfAssign.crfId) continue;
                
                await client.query(`
                  INSERT INTO event_definition_crf (
                    study_event_definition_id, study_id, crf_id, required_crf,
                    double_entry, hide_crf, ordinal, status_id, owner_id, date_created,
                    electronic_signature
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9)
                `, [
                  eventDef.studyEventDefinitionId,
                  studyId,
                  crfAssign.crfId,
                  crfAssign.required ?? false,
                  crfAssign.doubleDataEntry ?? false,
                  crfAssign.hideCrf ?? false,
                  crfAssign.ordinal || 1,
                  userId,
                  crfAssign.electronicSignature ?? false
                ]);
              }
            }
          } else {
            // Create new event (with visit window fields)
            const eventOid = `SE_${studyId}_${eventDef.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`;
            
            const eventResult = await client.query(`
              INSERT INTO study_event_definition (
                study_id, name, description, ordinal, type, repeating, category,
                schedule_day, min_day, max_day, reference_event_id,
                status_id, owner_id, date_created, oc_oid
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, NOW(), $13)
              RETURNING study_event_definition_id
            `, [
              studyId,
              eventDef.name,
              eventDef.description || '',
              eventDef.ordinal || 1,
              eventDef.type || 'scheduled',
              eventDef.repeating || false,
              eventDef.category || 'Study Event',
              eventDef.scheduleDay ?? null,
              eventDef.minDay ?? null,
              eventDef.maxDay ?? null,
              eventDef.referenceEventId ?? null,
              userId,
              eventOid
            ]);
            
            const newEventDefId = eventResult.rows[0].study_event_definition_id;
            
            // Add CRF assignments
            if (eventDef.crfAssignments && Array.isArray(eventDef.crfAssignments)) {
              for (const crfAssign of eventDef.crfAssignments) {
                if (!crfAssign.crfId) continue;
                
                await client.query(`
                  INSERT INTO event_definition_crf (
                    study_event_definition_id, study_id, crf_id, required_crf,
                    double_entry, hide_crf, ordinal, status_id, owner_id, date_created,
                    electronic_signature
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9)
                `, [
                  newEventDefId,
                  studyId,
                  crfAssign.crfId,
                  crfAssign.required ?? false,
                  crfAssign.doubleDataEntry ?? false,
                  crfAssign.hideCrf ?? false,
                  crfAssign.ordinal || 1,
                  userId,
                  crfAssign.electronicSignature ?? false
                ]);
              }
            }
          }
          
          await client.query('RELEASE SAVEPOINT update_event');
        } catch (eventError: any) {
          await client.query('ROLLBACK TO SAVEPOINT update_event');
          logger.warn('Event definition update warning', { error: eventError.message, event: eventDef.name });
        }
      }
    }

    // Update group classes if provided
    if (data.groupClasses && Array.isArray(data.groupClasses)) {
      logger.info('Updating group classes', { studyId, count: data.groupClasses.length });
      
      for (const groupClass of data.groupClasses) {
        if (!groupClass.name) continue;
        
        try {
          await client.query('SAVEPOINT update_group_class');
          
          if (groupClass.studyGroupClassId) {
            // Update existing group class
            await client.query(`
              UPDATE study_group_class
              SET name = $1, group_class_type_id = $2, custom_type_name = $3, subject_assignment = $4,
                  date_updated = NOW(), update_id = $5
              WHERE study_group_class_id = $6
            `, [
              groupClass.name,
              groupClass.groupClassTypeId || 1,
              groupClass.customTypeName || null,
              groupClass.subjectAssignment || 'optional',
              userId,
              groupClass.studyGroupClassId
            ]);
            
            // Update groups within class
            if (groupClass.groups && Array.isArray(groupClass.groups)) {
              for (const group of groupClass.groups) {
                if (!group.name) continue;
                
                if (group.studyGroupId) {
                  // Update existing - try minimal columns first
                  try {
                    await client.query(`
                      UPDATE study_group
                      SET name = $1, description = $2
                      WHERE study_group_id = $3
                    `, [group.name, group.description || '', group.studyGroupId]);
                  } catch {
                    await client.query(`
                      UPDATE study_group
                      SET name = $1, description = $2, date_updated = NOW(), update_id = $3
                      WHERE study_group_id = $4
                    `, [group.name, group.description || '', userId, group.studyGroupId]);
                  }
                } else {
                  // Insert new - try minimal columns first (real LibreClinica schema)
                  try {
                    await client.query(`
                      INSERT INTO study_group (
                        study_group_class_id, name, description
                      ) VALUES ($1, $2, $3)
                    `, [groupClass.studyGroupClassId, group.name, group.description || '']);
                  } catch {
                    await client.query(`
                      INSERT INTO study_group (
                        study_group_class_id, name, description,
                        status_id, owner_id, date_created
                      ) VALUES ($1, $2, $3, 1, $4, NOW())
                    `, [groupClass.studyGroupClassId, group.name, group.description || '', userId]);
                  }
                }
              }
            }
          } else {
            // Create new group class
            const gcResult = await client.query(`
              INSERT INTO study_group_class (
                study_id, name, group_class_type_id, custom_type_name, subject_assignment,
                status_id, owner_id, date_created
              ) VALUES ($1, $2, $3, $4, $5, 1, $6, NOW())
              RETURNING study_group_class_id
            `, [
              studyId,
              groupClass.name,
              groupClass.groupClassTypeId || 1,
              groupClass.customTypeName || null,
              groupClass.subjectAssignment || 'optional',
              userId
            ]);
            
            const newGroupClassId = gcResult.rows[0].study_group_class_id;
            
            if (groupClass.groups && Array.isArray(groupClass.groups)) {
              for (const group of groupClass.groups) {
                if (!group.name) continue;
                
                // Try minimal columns first (real LibreClinica schema)
                try {
                  await client.query(`
                    INSERT INTO study_group (
                      study_group_class_id, name, description
                    ) VALUES ($1, $2, $3)
                  `, [newGroupClassId, group.name, group.description || '']);
                } catch {
                  await client.query(`
                    INSERT INTO study_group (
                      study_group_class_id, name, description,
                      status_id, owner_id, date_created
                    ) VALUES ($1, $2, $3, 1, $4, NOW())
                  `, [newGroupClassId, group.name, group.description || '', userId]);
                }
              }
            }
          }
          
          await client.query('RELEASE SAVEPOINT update_group_class');
        } catch (gcError: any) {
          await client.query('ROLLBACK TO SAVEPOINT update_group_class');
          logger.warn('Group class update warning', { error: gcError.message, groupClass: groupClass.name });
        }
      }
    }

    // Update sites if provided
    if (data.sites && Array.isArray(data.sites)) {
      logger.info('Updating sites', { studyId, count: data.sites.length });
      
      for (const site of data.sites) {
        if (!site.name || !site.uniqueIdentifier) continue;
        
        try {
          await client.query('SAVEPOINT update_site');
          
          if (site.studyId) {
            // Update existing site
            await client.query(`
              UPDATE study
              SET name = $1, principal_investigator = $2, expected_total_enrollment = $3,
                  facility_name = $4, facility_address = $5, facility_city = $6, facility_state = $7,
                  facility_country = $8, facility_recruitment_status = $9,
                  date_updated = NOW(), update_id = $10
              WHERE study_id = $11 AND parent_study_id = $12
            `, [
              site.name,
              site.principalInvestigator || null,
              site.expectedTotalEnrollment || 0,
              site.facilityName || null,
              site.facilityAddress || null,
              site.facilityCity || null,
              site.facilityState || null,
              site.facilityCountry || null,
              site.facilityRecruitmentStatus || 'Not yet recruiting',
              userId,
              site.studyId,
              studyId
            ]);
          } else {
            // Create new site
            const siteOid = `S_${site.uniqueIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}`;
            
            await client.query(`
              INSERT INTO study (
                parent_study_id, unique_identifier, name, summary,
                principal_investigator, expected_total_enrollment,
                facility_name, facility_address, facility_city, facility_state, facility_country,
                facility_recruitment_status,
                status_id, owner_id, date_created, oc_oid
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, NOW(), $14)
            `, [
              studyId,
              site.uniqueIdentifier,
              site.name,
              site.summary || '',
              site.principalInvestigator || null,
              site.expectedTotalEnrollment || 0,
              site.facilityName || null,
              site.facilityAddress || null,
              site.facilityCity || null,
              site.facilityState || null,
              site.facilityCountry || null,
              site.facilityRecruitmentStatus || 'Not yet recruiting',
              userId,
              siteOid
            ]);
          }
          
          await client.query('RELEASE SAVEPOINT update_site');
        } catch (siteError: any) {
          await client.query('ROLLBACK TO SAVEPOINT update_site');
          logger.warn('Site update warning', { error: siteError.message, site: site.name });
        }
      }
    }

    // Update study parameters if provided
    if (data.studyParameters && typeof data.studyParameters === 'object') {
      logger.info('Updating study parameters', { studyId, paramCount: Object.keys(data.studyParameters).length });
      
      try {
        await client.query('SAVEPOINT update_params');
        
        for (const [param, value] of Object.entries(data.studyParameters)) {
          if (value === undefined || value === null) continue;
          
          const stringValue = String(value);
          
          // Check if parameter exists (no UNIQUE constraint in real LC)
          const existsCheck = await client.query(`
            SELECT study_parameter_value_id FROM study_parameter_value
            WHERE study_id = $1 AND parameter = $2
          `, [studyId, param]);
          
          if (existsCheck.rows.length > 0) {
            // Update existing
            await client.query(`
              UPDATE study_parameter_value SET value = $1
              WHERE study_id = $2 AND parameter = $3
            `, [stringValue, studyId, param]);
          } else {
            // Insert new
            await client.query(`
              INSERT INTO study_parameter_value (study_id, parameter, value)
              VALUES ($1, $2, $3)
            `, [studyId, param, stringValue]);
          }
        }
        
        await client.query('RELEASE SAVEPOINT update_params');
      } catch (paramError: any) {
        await client.query('ROLLBACK TO SAVEPOINT update_params');
        logger.warn('Study parameter update warning', { error: paramError.message });
      }
    }

    // Log audit event
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

    logger.info('Study updated successfully with all nested data', { studyId, fieldsUpdated: updates.length });

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
/**
 * Archive a study (soft delete).
 * Sets status to 'removed' (status_id = 5) which hides it from normal listings.
 * Works even if the study has enrolled subjects — data is preserved, just hidden.
 * This is the standard EDC approach: studies are never hard-deleted.
 */
export const archiveStudy = async (
  studyId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Archiving study', { studyId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify the study exists and get current status
    const studyCheck = await client.query(
      'SELECT study_id, name, status_id FROM study WHERE study_id = $1',
      [studyId]
    );

    if (studyCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study not found' };
    }

    const study = studyCheck.rows[0];

    if (study.status_id === 5) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study is already archived' };
    }

    // Archive the study (set status to removed = 5)
    await client.query(`
      UPDATE study
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE study_id = $2
    `, [userId, studyId]);

    // Also archive any child sites (studies with parent_study_id = this study)
    await client.query(`
      UPDATE study
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE parent_study_id = $2
    `, [userId, studyId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, $3,
        'status_id: ' || $4::text, 'status_id: 5 (archived)',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Study Updated' LIMIT 1)
      )
    `, [userId, studyId, study.name, study.status_id]);

    await client.query('COMMIT');

    logger.info('Study archived successfully', { studyId, studyName: study.name });

    return {
      success: true,
      message: `Study "${study.name}" has been archived and will no longer appear in study listings`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Archive study error', { error: error.message, studyId });

    return {
      success: false,
      message: `Failed to archive study: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Restore an archived study (unarchive).
 * Sets status back to 'available' (status_id = 1).
 */
export const restoreStudy = async (
  studyId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Restoring study', { studyId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const studyCheck = await client.query(
      'SELECT study_id, name, status_id FROM study WHERE study_id = $1',
      [studyId]
    );

    if (studyCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study not found' };
    }

    const study = studyCheck.rows[0];

    if (study.status_id !== 5) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study is not archived' };
    }

    // Restore the study
    await client.query(`
      UPDATE study
      SET status_id = 1, date_updated = NOW(), update_id = $1
      WHERE study_id = $2
    `, [userId, studyId]);

    // Restore child sites
    await client.query(`
      UPDATE study
      SET status_id = 1, date_updated = NOW(), update_id = $1
      WHERE parent_study_id = $2 AND status_id = 5
    `, [userId, studyId]);

    // Audit
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, $3,
        'status_id: 5 (archived)', 'status_id: 1 (available)',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Study Updated' LIMIT 1)
      )
    `, [userId, studyId, study.name]);

    await client.query('COMMIT');

    logger.info('Study restored successfully', { studyId });

    return {
      success: true,
      message: `Study "${study.name}" has been restored`
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Restore study error', { error: error.message, studyId });
    return { success: false, message: `Failed to restore study: ${error.message}` };
  } finally {
    client.release();
  }
};

/**
 * Get archived studies for a user
 */
export const getArchivedStudies = async (
  userId: number
): Promise<{ success: boolean; data: any[] }> => {
  try {
    // Check organization membership to scope archived studies
    const orgCheck = await pool.query(
      `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

    let orgFilter = '';
    const params: any[] = [];

    if (userOrgIds.length > 0) {
      params.push(userOrgIds);
      orgFilter = `AND s.owner_id IN (
        SELECT m.user_id FROM acc_organization_member m
        WHERE m.organization_id = ANY($1::int[]) AND m.status = 'active'
      )`;
    }

    const query = `
      SELECT 
        s.study_id, s.name, s.unique_identifier, s.summary,
        s.date_created, s.date_updated,
        (SELECT COUNT(*) FROM study_subject WHERE study_id = s.study_id) as subject_count,
        (SELECT COUNT(DISTINCT s2.study_id) FROM study s2 WHERE s2.parent_study_id = s.study_id) as site_count
      FROM study s
      WHERE s.status_id = 5
        AND s.parent_study_id IS NULL
        ${orgFilter}
      ORDER BY s.date_updated DESC
    `;

    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(row => ({
        studyId: row.study_id,
        name: row.name,
        identifier: row.unique_identifier,
        summary: row.summary,
        dateCreated: row.date_created,
        dateArchived: row.date_updated,
        subjectCount: parseInt(row.subject_count) || 0,
        siteCount: parseInt(row.site_count) || 0
      }))
    };
  } catch (error: any) {
    logger.error('Get archived studies error', { error: error.message });
    return { success: true, data: [] };
  }
};

/**
 * Delete study (backward compatible — calls archiveStudy).
 * @deprecated Use archiveStudy() instead
 */
export const deleteStudy = async (
  studyId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  return archiveStudy(studyId, userId);
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
        (SELECT COUNT(DISTINCT c.crf_id) FROM crf c WHERE c.source_study_id = s.study_id AND c.status_id NOT IN (5, 6, 7)) as total_forms
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

