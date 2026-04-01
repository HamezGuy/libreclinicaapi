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
import { logAuditEvent, AuditEventType } from '../../middleware/audit.middleware';
import { 
  StudySubject, 
  StudySubjectWithDetails,
  SubjectProgress,
  ApiResponse, 
  PaginatedResponse,
  toStudySubject
} from '../../types/libreclinica-models';
import * as workflowService from '../database/workflow.service';
import { formatDate as formatIsoDate, today as todayIso, toISOTimestamp } from '../../utils/date.util';
import { getFormMetadata } from './form.service';

async function repairSequence(
  client: any,
  sequenceName: string,
  tableName: string,
  pkColumn: string
): Promise<void> {
  try {
    await client.query(`
      SELECT setval($1::regclass,
        GREATEST(
          (SELECT COALESCE(MAX(${pkColumn}), 0) FROM ${tableName}),
          (SELECT last_value FROM ${sequenceName})
        )
      )
    `, [sequenceName]);
  } catch (err: any) {
    logger.warn(`repairSequence: could not sync ${sequenceName}`, { error: err.message });
  }
}

async function insertWithRetry(
  client: any,
  query: string,
  params: any[],
  sequenceName: string,
  tableName: string,
  pkColumn: string,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.query(query, params);
    } catch (err: any) {
      if (err.code === '23505' && attempt < maxRetries) {
        await repairSequence(client, sequenceName, tableName, pkColumn);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Request type for creating a subject
 * 
 * Database Schema Reference:
 * ═══════════════════════════════════════════════════════════════════
 * SUBJECT TABLE (12 columns):
 *   - subject_id (PK), father_id (FK), mother_id (FK), status_id
 *   - date_of_birth, gender (char 1: 'm', 'f', '')
 *   - unique_identifier (varchar 255) - Person ID for cross-study linking
 *   - date_created, owner_id, date_updated, update_id, dob_collected
 * 
 * STUDY_SUBJECT TABLE (13 columns):
 *   - study_subject_id (PK), label (varchar 30), secondary_label (varchar 30)
 *   - subject_id (FK), study_id (FK), status_id, enrollment_date
 *   - date_created, date_updated, owner_id, update_id
 *   - oc_oid (varchar 40), time_zone (varchar 255)
 * ═══════════════════════════════════════════════════════════════════
 */
export interface SubjectCreateRequest {
  // === STUDY_SUBJECT TABLE FIELDS ===
  studyId: number;
  studySubjectId: string;             // label column (varchar 30)
  secondaryId?: string;               // secondary_label column (varchar 30)
  enrollmentDate?: string;            // enrollment_date column
  screeningDate?: string;             // screening enrollment date (app-level, not in LC schema)
  timeZone?: string;                  // time_zone column (varchar 255)
  
  // === SUBJECT TABLE FIELDS (demographics) ===
  gender?: string;                    // gender column (char 1: 'm', 'f', '')
  dateOfBirth?: string;               // date_of_birth column
  personId?: string;                  // unique_identifier column (varchar 255)
  
  // === FAMILY/GENETIC STUDY FIELDS (subject table) ===
  fatherId?: number;                  // father_id column (FK to subject)
  motherId?: number;                  // mother_id column (FK to subject)
  
  // === GROUP ASSIGNMENTS (subject_group_map table) ===
  groupAssignments?: { studyGroupClassId: number; studyGroupId: number; notes?: string }[];
  
  // === OPTIONAL FIRST EVENT SCHEDULING ===
  scheduleEvent?: {
    studyEventDefinitionId: number;
    location?: string;
    startDate?: string;
  };
}

/**
 * Create a patient form snapshot during enrollment.
 * Uses getFormMetadata() as the SINGLE SOURCE OF TRUTH so the snapshot stores
 * the exact same parsed field DTOs that the /api/forms/:id/metadata endpoint
 * returns — with type, fieldName, label, options, showWhen, etc. all parsed
 * from the ---EXTENDED_PROPS--- embedded in item descriptions.
 */
const createPatientFormSnapshotForEnrollment = async (
  client: any, studyEventId: number, eventCrfId: number,
  crfId: number, crfVersionId: number, studySubjectId: number,
  formName: string, ordinal: number, userId: number
): Promise<void> => {
  const metadata = await getFormMetadata(crfId);
  const fields = metadata?.items || [];

  if (fields.length === 0) {
    logger.warn('getFormMetadata returned no items for enrollment snapshot', { crfId, crfVersionId });
  }

  const structure = {
    crfId,
    crfVersionId,
    name: formName,
    snapshotDate: new Date().toISOString(),
    fieldCount: fields.length,
    fields
  };

  await client.query(`
    INSERT INTO patient_event_form (
      study_event_id, event_crf_id, crf_id, crf_version_id,
      study_subject_id, form_name, form_structure, form_data,
      completion_status, ordinal, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, '{}'::jsonb, 'not_started', $8, $9)
  `, [studyEventId, eventCrfId, crfId, crfVersionId, studySubjectId, formName, JSON.stringify(structure), ordinal, userId]);
};

/**
 * Create subject via SOAP or direct database (depending on config)
 */
export const createSubject = async (
  request: SubjectCreateRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating subject (hybrid)', { request, userId, soapEnabled: config.libreclinica.soapEnabled });

  // Always use direct database creation for reliability.
  // The SOAP path through LibreClinica's Java web service can leave the
  // study_subject row in an inconsistent state (created via SOAP but not
  // visible to direct DB queries, or cleaned up by a background sync).
  // Direct DB creation ensures the row, events, and event_crfs all exist
  // in the same transaction and are immediately queryable.
  return createSubjectDirect(request, userId, username);
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

    // 0. Pre-check: Verify subject label doesn't already exist in this study
    const duplicateCheckQuery = `
      SELECT study_subject_id, label FROM study_subject 
      WHERE study_id = $1 AND label = $2 AND status_id != 5
    `;
    const duplicateCheck = await client.query(duplicateCheckQuery, [
      request.studyId, 
      request.studySubjectId
    ]);
    
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      logger.warn('Subject label already exists in study', { 
        label: request.studySubjectId, 
        studyId: request.studyId,
        existingId: duplicateCheck.rows[0].study_subject_id
      });
      return {
        success: false,
        message: `Subject with ID "${request.studySubjectId}" already exists in this study. Please use a different Subject ID.`
      };
    }

    // 1. Create subject record first (demographics table)
    // Normalize gender value
    const gender = request.gender === 'Male' || request.gender === 'm' ? 'm' : 
                   request.gender === 'Female' || request.gender === 'f' ? 'f' : '';
    
    // Use personId if provided for cross-study linking
    // If not provided, generate a study-specific unique identifier to avoid conflicts
    // The unique_identifier is used for cross-study patient linking in LibreClinica
    let uniqueIdentifier: string;
    if (request.personId && request.personId.trim()) {
      uniqueIdentifier = request.personId.trim();
    } else {
      // Generate a unique identifier that includes studyId to prevent conflicts
      // Format: studySubjectId-studyId (ensures uniqueness across studies)
      uniqueIdentifier = `${request.studySubjectId}-S${request.studyId}`;
    }
    
    // Check if subject with this unique_identifier already exists
    // This handles cross-study linking when personId is provided
    let existingSubjectId: number | null = null;
    if (request.personId && request.personId.trim()) {
      const existingSubjectQuery = `
        SELECT subject_id FROM subject 
        WHERE unique_identifier = $1 AND status_id = 1
      `;
      const existingResult = await client.query(existingSubjectQuery, [uniqueIdentifier]);
      if (existingResult.rows.length > 0) {
        existingSubjectId = existingResult.rows[0].subject_id;
        logger.info('Found existing subject for cross-study linking', { 
          uniqueIdentifier, 
          subjectId: existingSubjectId 
        });
      }
    }
    
    // Handle family links (for genetic studies)
    const fatherId = request.fatherId && request.fatherId > 0 ? request.fatherId : null;
    const motherId = request.motherId && request.motherId > 0 ? request.motherId : null;
    
    let subjectId: number;
    
    // Use existing subject if found (cross-study linking)
    if (existingSubjectId) {
      subjectId = existingSubjectId;
      logger.info('Using existing subject for new study enrollment', { subjectId, uniqueIdentifier });
    } else {
      // Create new subject record
      // Try full schema first, fall back to minimal schema if columns don't exist
      // Use SAVEPOINT to handle schema differences without aborting the transaction
      await repairSequence(client, 'subject_subject_id_seq', 'subject', 'subject_id');
      let subjectResult;
      await client.query('SAVEPOINT subject_insert');
      try {
        const subjectQuery = `
          INSERT INTO subject (
            date_of_birth, gender, unique_identifier, 
            father_id, mother_id,
            date_created, date_updated, 
            owner_id, update_id, dob_collected, status_id
          ) VALUES (
            $1, $2, $3, $4, $5, NOW(), NOW(), $6, $6, $7, 1
          )
          RETURNING subject_id
        `;
        const dobCollected = request.dateOfBirth ? true : false;
        subjectResult = await client.query(subjectQuery, [
          request.dateOfBirth || null,
          gender,
          uniqueIdentifier,
          fatherId,
          motherId,
          userId,
          dobCollected
        ]);
        await client.query('RELEASE SAVEPOINT subject_insert');
      } catch (schemaError: any) {
        // Roll back to savepoint and try minimal schema
        await client.query('ROLLBACK TO SAVEPOINT subject_insert');
        
        if (schemaError.message.includes('dob_collected')) {
          logger.info('Using minimal subject schema (dob_collected not available)');
          const minimalSubjectQuery = `
            INSERT INTO subject (
              date_of_birth, gender, unique_identifier, 
              father_id, mother_id,
              date_created, date_updated, 
              owner_id, update_id, status_id
            ) VALUES (
              $1, $2, $3, $4, $5, NOW(), NOW(), $6, $6, 1
            )
            RETURNING subject_id
          `;
          subjectResult = await client.query(minimalSubjectQuery, [
            request.dateOfBirth || null,
            gender,
            uniqueIdentifier,
            fatherId,
            motherId,
            userId
          ]);
        } else {
          throw schemaError;
        }
      }

      subjectId = subjectResult.rows[0].subject_id;
    }

    // 2. Create study_subject record (enrollment table)
    // Includes: label, secondary_label, enrollment_date, time_zone, oc_oid
    await repairSequence(client, 'study_subject_study_subject_id_seq', 'study_subject', 'study_subject_id');
    const studySubjectQuery = `
      INSERT INTO study_subject (
        label, secondary_label, subject_id, study_id, status_id, 
        enrollment_date, screening_date, time_zone, date_created, date_updated, owner_id, oc_oid
      ) VALUES (
        $1, $2, $3, $4, 1, $5, $6, $7, NOW(), NOW(), $8, $9
      )
      RETURNING study_subject_id
    `;

    // Generate OC OID (OpenClinica Object ID)
    // Include studyId and timestamp to ensure uniqueness across studies
    const timestamp = Date.now().toString(36); // Base36 for compact representation
    const cleanLabel = request.studySubjectId.replace(/[^a-zA-Z0-9]/g, '');
    const ocOid = `SS_${request.studyId}_${cleanLabel}_${timestamp}`.substring(0, 40);
    
    // Handle timezone (defaults to empty string if not provided)
    const timeZone = request.timeZone || '';

    const effectiveEnrollmentDate = request.enrollmentDate || null;
    const effectiveScreeningDate = request.screeningDate || formatIsoDate(new Date());

    const studySubjectResult = await client.query(studySubjectQuery, [
      request.studySubjectId,
      request.secondaryId || '',
      subjectId,
      request.studyId,
      effectiveEnrollmentDate,
      effectiveScreeningDate,
      timeZone,
      userId,
      ocOid
    ]);

    const studySubjectId = studySubjectResult.rows[0].study_subject_id;

    // 3. Create audit log entry
    // Use COALESCE to ensure we get a valid audit event type ID
    // Priority: 'Entity Created' (1) > first available
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        COALESCE(
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1),
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE audit_log_event_type_id = 1 LIMIT 1),
          1
        )
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

    // 5. Schedule ALL study events for this subject (auto-schedule all phases)
    // This implements the COPY PHASES TO PATIENT requirement
    let scheduledEventIds: number[] = [];
    let totalFormsCreated = 0;
    const enrollmentDate = request.enrollmentDate || request.screeningDate || formatIsoDate(new Date());
    const phaseDetails: { name: string; eventId: number; formsCreated: number }[] = [];
    
    // Resolve to parent study for event definitions.
    // In multi-site studies, patients enroll at a SITE (child study) but event
    // definitions and CRF assignments live on the PARENT study.
    const parentStudyResult = await client.query(
      `SELECT COALESCE(parent_study_id, study_id) AS parent_study_id FROM study WHERE study_id = $1`,
      [request.studyId]
    );
    const parentStudyId = parentStudyResult.rows[0]?.parent_study_id || request.studyId;

    // Get all scheduled/common event definitions for this study (using parent study).
    // Unscheduled event definitions are NOT auto-scheduled during enrollment —
    // they are only used when a user manually adds an unscheduled visit later.
    const eventDefsResult = await client.query(`
      SELECT study_event_definition_id, name, ordinal, type, repeating, schedule_day
      FROM study_event_definition
      WHERE study_id = $1 AND status_id = 1 AND type != 'unscheduled'
      ORDER BY ordinal
    `, [parentStudyId]);
    
    if (eventDefsResult.rows.length > 0) {
      logger.info('🗓️ Auto-scheduling study phases for patient enrollment', { 
        studySubjectId, 
        label: request.studySubjectId,
        phaseCount: eventDefsResult.rows.length,
        phases: eventDefsResult.rows.map((e: any) => e.name)
      });
      
      for (const eventDef of eventDefsResult.rows) {
        const spName = `phase_${eventDef.study_event_definition_id}`;
        try {
          // Wrap each phase in a SAVEPOINT so a failure in one phase
          // (e.g. missing CRF version, FK violation) doesn't abort the
          // entire transaction and cause the subject + earlier phases
          // to be rolled back.
          await client.query(`SAVEPOINT ${spName}`);

          // Use schedule_day from the event definition if configured,
          // otherwise fall back to ordinal-based 7-day spacing
          const daysOffset = eventDef.schedule_day != null
            ? eventDef.schedule_day
            : (eventDef.ordinal - 1) * 7;
          const eventStartDate = new Date(enrollmentDate);
          eventStartDate.setDate(eventStartDate.getDate() + daysOffset);
          
          // Resolve subject_event_status_id before the INSERT to avoid
          // a subquery failure inside the INSERT poisoning the transaction.
          const sesResult = await client.query(
            `SELECT subject_event_status_id FROM subject_event_status WHERE name = 'scheduled' LIMIT 1`
          );
          const sesId = sesResult.rows[0]?.subject_event_status_id ?? 1;

          // Try full schema first; fall back to minimal schema if extra columns
          // (scheduled_date, is_unscheduled) don't exist in the production DB.
          let eventResult;
          await repairSequence(client, 'study_event_study_event_id_seq', 'study_event', 'study_event_id');
          await client.query(`SAVEPOINT event_insert_${eventDef.study_event_definition_id}`);
          try {
            eventResult = await client.query(`
              INSERT INTO study_event (
                study_event_definition_id, study_subject_id, location,
                sample_ordinal, date_start, date_end,
                owner_id, status_id, subject_event_status_id, date_created,
                scheduled_date, is_unscheduled
              ) VALUES (
                $1, $2, $3, 1, $4::timestamp, $5::timestamp, $6, 1, $7,
                NOW(), $8::date, false
              )
              RETURNING study_event_id
            `, [
              eventDef.study_event_definition_id,
              studySubjectId,
              request.scheduleEvent?.location || '',
              formatIsoDate(eventStartDate),
              formatIsoDate(eventStartDate),
              userId,
              sesId,
              formatIsoDate(eventStartDate)
            ]);
            await client.query(`RELEASE SAVEPOINT event_insert_${eventDef.study_event_definition_id}`);
          } catch (insertErr: any) {
            await client.query(`ROLLBACK TO SAVEPOINT event_insert_${eventDef.study_event_definition_id}`);
            if (insertErr.message?.includes('scheduled_date') || insertErr.message?.includes('is_unscheduled')) {
              logger.info('Using minimal study_event schema (no scheduled_date/is_unscheduled)');
              eventResult = await client.query(`
                INSERT INTO study_event (
                  study_event_definition_id, study_subject_id, location,
                  sample_ordinal, date_start, date_end,
                  owner_id, status_id, subject_event_status_id, date_created
                ) VALUES (
                  $1, $2, $3, 1, $4::timestamp, $5::timestamp, $6, 1, $7, NOW()
                )
                RETURNING study_event_id
              `, [
                eventDef.study_event_definition_id,
                studySubjectId,
                request.scheduleEvent?.location || '',
                formatIsoDate(eventStartDate),
                formatIsoDate(eventStartDate),
                userId,
                sesId
              ]);
            } else {
              throw insertErr;
            }
          }
          
          if (eventResult.rows[0]?.study_event_id) {
            const studyEventId = eventResult.rows[0].study_event_id;
            scheduledEventIds.push(studyEventId);
            let phaseFormsCreated = 0;
            
            // Create event_crf records for all CRFs assigned to this phase
            const crfAssignments = await client.query(`
              SELECT edc.crf_id, edc.default_version_id, c.name as crf_name,
                     edc.ordinal as edc_ordinal
              FROM event_definition_crf edc
              INNER JOIN crf c ON edc.crf_id = c.crf_id
              WHERE edc.study_event_definition_id = $1
                AND edc.status_id = 1
                AND c.status_id NOT IN (5, 7)
              ORDER BY edc.ordinal
            `, [eventDef.study_event_definition_id]);
            
            if (crfAssignments.rows.length === 0) {
              logger.warn(`⚠️ Phase "${eventDef.name}" has no forms assigned`, {
                studyEventDefinitionId: eventDef.study_event_definition_id
              });
            }
            
            for (const crfAssign of crfAssignments.rows) {
              let crfVersionId = crfAssign.default_version_id;
              if (!crfVersionId) {
                const versionResult = await client.query(`
                  SELECT crf_version_id FROM crf_version 
                  WHERE crf_id = $1 AND status_id NOT IN (5, 7) 
                  ORDER BY crf_version_id DESC LIMIT 1
                `, [crfAssign.crf_id]);
                if (versionResult.rows.length > 0) {
                  crfVersionId = versionResult.rows[0].crf_version_id;
                } else {
                  logger.warn(`Form "${crfAssign.crf_name}" (CRF ${crfAssign.crf_id}) has no active versions — skipping`);
                  continue;
                }
              }
              
              // Create event_crf - the editable copy of the template for this patient
              await repairSequence(client, 'event_crf_event_crf_id_seq', 'event_crf', 'event_crf_id');
              const ecResult = await insertWithRetry(client, `
                INSERT INTO event_crf (
                  study_event_id, crf_version_id, study_subject_id,
                  completion_status_id, status_id, owner_id, date_created
                ) VALUES ($1, $2, $3, 1, 1, $4, NOW())
                RETURNING event_crf_id
              `, [studyEventId, crfVersionId, studySubjectId, userId],
              'event_crf_event_crf_id_seq', 'event_crf', 'event_crf_id');
              
              const eventCrfId = ecResult.rows[0].event_crf_id;
              phaseFormsCreated++;
              totalFormsCreated++;
              
              // Create patient_event_form snapshot (frozen copy of form structure at enrollment)
              // This is CRITICAL — without it the patient cannot open or edit the form.
              // Re-create using SAVEPOINT so a single snapshot failure doesn't abort the
              // entire enrollment, but DO log prominently so issues are visible.
              const snapSp = `snap_${eventCrfId}`;
              try {
                await client.query(`SAVEPOINT ${snapSp}`);
                await createPatientFormSnapshotForEnrollment(
                  client, studyEventId, eventCrfId,
                  crfAssign.crf_id, crfVersionId, studySubjectId,
                  crfAssign.crf_name, crfAssign.edc_ordinal ?? phaseFormsCreated, userId
                );
                await client.query(`RELEASE SAVEPOINT ${snapSp}`);
              } catch (snapErr: any) {
                await client.query(`ROLLBACK TO SAVEPOINT ${snapSp}`);
                logger.error('❌ CRITICAL: Form snapshot creation failed during enrollment — patient will not be able to open this form', {
                  error: snapErr.message,
                  crfId: crfAssign.crf_id,
                  crfName: crfAssign.crf_name,
                  studyEventId,
                  eventCrfId
                });
              }
              
              logger.debug('📋 Created event_crf + snapshot for patient phase', {
                studyEventId, eventCrfId,
                crfId: crfAssign.crf_id,
                crfName: crfAssign.crf_name,
                studySubjectId
              });
            }
            
            phaseDetails.push({
              name: eventDef.name,
              eventId: studyEventId,
              formsCreated: phaseFormsCreated
            });
          }

          await client.query(`RELEASE SAVEPOINT ${spName}`);
        } catch (eventError: any) {
          // Roll back only THIS phase — earlier phases and the subject record survive
          await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
          logger.warn('❌ Failed to schedule phase (rolled back phase only)', { 
            eventDefId: eventDef.study_event_definition_id, 
            phaseName: eventDef.name,
            error: eventError.message 
          });
        }
      }
      
      logger.info('✅ Patient enrollment complete - phases and forms copied', { 
        studySubjectId,
        label: request.studySubjectId, 
        phasesScheduled: scheduledEventIds.length,
        totalFormsCreated,
        phaseDetails
      });
    } else {
      logger.warn('⚠️ No study phases defined - patient enrolled without phases', { 
        studyId: request.studyId 
      });
    }

    await client.query('COMMIT');

    // Log Part 11 compliant audit event
    await logAuditEvent(
      AuditEventType.SUBJECT_CREATED,
      userId,
      username,
      {
        entityName: 'study_subject',
        entityId: studySubjectId,
        newValue: JSON.stringify({
          label: request.studySubjectId,
          studyId: request.studyId,
          enrollmentDate: request.enrollmentDate || null,
          gender: request.gender,
          dateOfBirth: request.dateOfBirth
        }),
        reasonForChange: 'Subject enrolled via API (direct database)',
        studyEventId: scheduledEventIds.length > 0 ? scheduledEventIds[0] : undefined
      }
    );

    logger.info('Subject created successfully via direct database', { 
      subjectId, 
      studySubjectId, 
      label: request.studySubjectId 
    });

    // AUTO-TRIGGER WORKFLOW: Create enrollment verification workflow
    // This is a real EDC pattern - new enrollments need verification
    try {
      await workflowService.triggerSubjectEnrolledWorkflow(
        studySubjectId,
        request.studyId,
        request.studySubjectId,
        userId
      );
      logger.info('Auto-triggered enrollment verification workflow', { studySubjectId, label: request.studySubjectId });
    } catch (workflowError: any) {
      // Don't fail enrollment if workflow creation fails
      logger.warn('Failed to auto-create enrollment workflow', { error: workflowError.message });
    }

    return {
      success: true,
      message: 'Subject created successfully',
      data: {
        // Primary IDs
        subjectId,
        studySubjectId,
        
        // Study Subject fields
        label: request.studySubjectId,
        secondaryLabel: request.secondaryId || '',
        studyId: request.studyId,
        enrollmentDate: effectiveEnrollmentDate,
        screeningDate: effectiveScreeningDate,
        timeZone: timeZone,
        ocOid,
        
        // Subject demographics
        personId: uniqueIdentifier,
        gender: gender,
        dateOfBirth: request.dateOfBirth || null,
        
        // Family links (genetic studies)
        fatherId: fatherId,
        motherId: motherId,
        
        // Group assignments
        groupAssignments: request.groupAssignments || [],
        
        // Scheduled phases and forms (CRITICAL for phase/form copy verification)
        scheduledPhases: {
          count: scheduledEventIds.length,
          eventIds: scheduledEventIds,
          details: phaseDetails  // { name, eventId, formsCreated }[]
        },
        totalFormsCreated,
        
        // Legacy fields for backward compatibility
        studyEventIds: scheduledEventIds,
        studyEventId: scheduledEventIds.length > 0 ? scheduledEventIds[0] : null
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
    // Include subjects enrolled in child studies (sites) where parent_study_id matches
    logger.info('📋 Using database fallback for subject list');
    
    const conditions: string[] = [
      '(ss.study_id = $1 OR ss.study_id IN (SELECT study_id FROM study WHERE parent_study_id = $1))'
    ];
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
        ss.study_id,
        ss.label,
        ss.secondary_label,
        ss.enrollment_date,
        ss.screening_date,
        ss.status_id,
        st.name as status,
        s.gender,
        s.date_of_birth,
        ss.date_created,
        ss.date_updated,
        u.user_name as created_by,
        (
          SELECT COUNT(*)
          FROM study_event se
          WHERE se.study_subject_id = ss.study_subject_id
        ) as total_events,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id
            AND ec.status_id NOT IN (5, 7)
        ) as total_forms,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id
            AND ec.completion_status_id >= 4
            AND ec.status_id NOT IN (5, 7)
        ) as completed_forms,
        (
          SELECT sed_cur.name
          FROM study_event se_cur
          INNER JOIN study_event_definition sed_cur ON se_cur.study_event_definition_id = sed_cur.study_event_definition_id
          WHERE se_cur.study_subject_id = ss.study_subject_id
            AND NOT EXISTS (
              SELECT 1 FROM event_crf ec_check 
              INNER JOIN study_event se_check ON ec_check.study_event_id = se_check.study_event_id
              WHERE se_check.study_event_id = se_cur.study_event_id
                AND ec_check.completion_status_id >= 4
                AND ec_check.status_id NOT IN (5, 7)
              HAVING COUNT(*) >= (
                SELECT COUNT(*) FROM event_definition_crf edc_check 
                WHERE edc_check.study_event_definition_id = sed_cur.study_event_definition_id
                  AND edc_check.status_id = 1
              )
            )
          ORDER BY COALESCE(se_cur.scheduled_date, se_cur.date_start, se_cur.date_created) ASC, sed_cur.ordinal ASC
          LIMIT 1
        ) as current_visit_name,
        (
          SELECT COUNT(*)
          FROM study_event se_od
          INNER JOIN study_event_definition sed_od ON se_od.study_event_definition_id = sed_od.study_event_definition_id
          INNER JOIN event_definition_crf edc_od ON edc_od.study_event_definition_id = sed_od.study_event_definition_id AND edc_od.status_id = 1
          WHERE se_od.study_subject_id = ss.study_subject_id
            AND se_od.scheduled_date IS NOT NULL
            AND se_od.scheduled_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM event_crf ec_od
              WHERE ec_od.study_event_id = se_od.study_event_id
                AND ec_od.status_id NOT IN (5, 7)
                AND ec_od.completion_status_id >= 4
                AND ec_od.crf_version_id IN (
                  SELECT cv_od.crf_version_id FROM crf_version cv_od WHERE cv_od.crf_id = edc_od.crf_id
                )
            )
        ) as overdue_forms,
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
    // Get subject basic info (including study/site name via study table)
    const subjectQuery = `
      SELECT 
        ss.*,
        s.gender,
        s.date_of_birth,
        st.name as status_name,
        u.user_name as created_by,
        stdy.name as study_name,
        stdy.parent_study_id,
        CASE
          WHEN stdy.parent_study_id IS NOT NULL THEN stdy.name
          ELSE NULL
        END as site_name,
        COALESCE(parent_stdy.name, stdy.name) as parent_study_name
      FROM study_subject ss
      INNER JOIN subject s ON ss.subject_id = s.subject_id
      INNER JOIN status st ON ss.status_id = st.status_id
      LEFT JOIN user_account u ON ss.owner_id = u.user_id
      LEFT JOIN study stdy ON ss.study_id = stdy.study_id
      LEFT JOIN study parent_stdy ON stdy.parent_study_id = parent_stdy.study_id
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
        sed.type as event_type,
        sed.ordinal as event_ordinal,
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
      ORDER BY
        COALESCE(se.scheduled_date, se.date_start, se.date_created) ASC,
        sed.ordinal ASC,
        se.sample_ordinal ASC
    `;

    const eventsResult = await pool.query(eventsQuery, [subjectId]);

    // Calculate completion percentage
    const totalForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.total_forms), 0);
    const completedForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.completed_forms), 0);
    const completionPercentage = totalForms > 0 ? Math.round((completedForms / totalForms) * 100) : 0;

    // Get last activity from form data (most recent event_crf change)
    const lastActivityQuery = `
      SELECT GREATEST(
        COALESCE((SELECT MAX(ec.date_updated) FROM event_crf ec 
          INNER JOIN study_event se2 ON ec.study_event_id = se2.study_event_id
          WHERE se2.study_subject_id = $1 AND ec.date_updated IS NOT NULL), '1970-01-01'),
        COALESCE((SELECT MAX(ec.date_created) FROM event_crf ec 
          INNER JOIN study_event se2 ON ec.study_event_id = se2.study_event_id
          WHERE se2.study_subject_id = $1 AND ec.date_created IS NOT NULL), '1970-01-01'),
        COALESCE(ss2.date_updated, ss2.date_created)
      ) as last_activity_date
      FROM study_subject ss2
      WHERE ss2.study_subject_id = $1
    `;
    let lastActivity = subject.date_updated || subject.date_created;
    try {
      const activityResult = await pool.query(lastActivityQuery, [subjectId]);
      if (activityResult.rows.length > 0 && activityResult.rows[0].last_activity_date) {
        const actDate = new Date(activityResult.rows[0].last_activity_date);
        if (actDate.getFullYear() > 1970) {
          lastActivity = activityResult.rows[0].last_activity_date;
        }
      }
    } catch (err) {
      logger.warn('Failed to get last activity date', { error: (err as any).message });
    }

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
        name: subject.parent_study_name || subject.study_name || '',
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
        scheduledDate: e.scheduled_date,
        isUnscheduled: e.is_unscheduled || false,
        type: e.event_type || 'scheduled',
        name: e.event_name,
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
      },
      lastActivityDate: lastActivity
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
    const openQueries = parseInt(stats.open_queries) || 0;
    
    // Calculate completion percentages
    const eventCompletionPercentage = totalEvents > 0
      ? Math.round((completedEvents / totalEvents) * 100)
      : 0;
    
    const formCompletionPercentage = totalForms > 0
      ? Math.round((completedForms / totalForms) * 100)
      : 0;
    
    return {
      totalEvents,
      completedEvents,
      eventCompletionPercentage,
      totalForms,
      completedForms,
      formCompletionPercentage,
      openQueries,
      percentComplete: formCompletionPercentage // Use form completion as overall percentage
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
        ss.study_id,
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

