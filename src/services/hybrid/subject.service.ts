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
import { randomUUID } from 'crypto';
import * as subjectSoap from '../soap/subjectSoap.service';
import { logAuditEvent, AuditEventType } from '../../middleware/audit.middleware';
import { 
  StudySubject, 
  StudySubjectWithDetails,
  SubjectProgress,
  ApiResponse, 
  PaginatedResponse
} from '../../types/libreclinica-models';
import type { CreateSubjectRequest } from '@accura-trial/shared-types';
import * as workflowService from '../database/workflow.service';
import { formatDate as formatIsoDate, today as todayIso, toISOTimestamp, parseDateLocal } from '../../utils/date.util';
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
  throw new Error('insertWithRetry: exhausted retries without returning');
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
export interface SubjectCreateRequest extends CreateSubjectRequest {
  // === FAMILY/GENETIC STUDY FIELDS (subject table) ===
  fatherId?: number;
  motherId?: number;
  
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
    ON CONFLICT (event_crf_id) WHERE event_crf_id IS NOT NULL DO NOTHING
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

  const subjectLabel = request.label?.trim() || '';
  if (!subjectLabel) {
    return { success: false, message: 'Subject ID (label) is required.' };
  }

  try {
    await client.query('BEGIN');

    // Acquire an advisory lock scoped to this study so that concurrent
    // enrollments in the same study are serialized.  The lock is tied to
    // the transaction and released automatically on COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock($1)', [request.studyId]);

    // 0. Pre-check: Verify subject label doesn't already exist in this study.
    // FOR UPDATE locks matching rows so a concurrent txn that somehow slips
    // past the advisory lock still blocks until we commit.
    // Exclude archived statuses: 5=Removed, 6=Auto-Deleted, 7=Withdrawn
    const duplicateCheckQuery = `
      SELECT study_subject_id, label FROM study_subject 
      WHERE study_id = $1 AND label = $2 AND status_id NOT IN (5, 6, 7)
      FOR UPDATE
    `;
    const duplicateCheck = await client.query(duplicateCheckQuery, [
      request.studyId, 
      subjectLabel
    ]);
    
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      logger.warn('Subject label already exists in study', { 
        label: subjectLabel, 
        studyId: request.studyId,
        existingId: duplicateCheck.rows[0].studySubjectId
      });
      return {
        success: false,
        message: `Subject with ID "${subjectLabel}" already exists in this study. Please use a different Subject ID.`
      };
    }

    // 1. Create subject record first (demographics table)
    // Normalize gender value
    const gender = request.gender === 'Male' || request.gender === 'm' ? 'm' : 
                   request.gender === 'Female' || request.gender === 'f' ? 'f' : '';
    
    // unique_identifier uses a UUID to guarantee no cross-study collisions.
    // The personId (if provided) is stored for display but the internal
    // identifier is always a globally unique value per enrollment.
    const personIdRaw = request.personId?.trim() || '';
    const uniqueIdentifier = randomUUID();
    
    // Cross-study linking is NOT performed automatically.
    // Each study enrollment always creates its own subject row so that
    // patients from different organizations/studies cannot interfere.
    
    // Handle family links (for genetic studies)
    const fatherId = request.fatherId && request.fatherId > 0 ? request.fatherId : null;
    const motherId = request.motherId && request.motherId > 0 ? request.motherId : null;
    
    let subjectId: number;
    
    {
      // Always create a new subject row for each study enrollment.
      // This guarantees patients are isolated per-study.
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

      subjectId = subjectResult.rows[0].subjectId;
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

    // oc_oid uses a UUID — guaranteed globally unique, no collision risk.
    // Prefixed with SS_ to identify it as a StudySubject OID.
    const ocOid = `SS_${randomUUID()}`.substring(0, 40);
    
    // Handle timezone (defaults to empty string if not provided)
    const timeZone = request.timeZone || '';

    const effectiveEnrollmentDate = request.enrollmentDate || null;
    const effectiveScreeningDate = request.screeningDate || formatIsoDate(new Date());

    const studySubjectResult = await client.query(studySubjectQuery, [
      subjectLabel,
      request.secondaryLabel || '',
      subjectId,
      request.studyId,
      effectiveEnrollmentDate,
      effectiveScreeningDate,
      timeZone,
      userId,
      ocOid
    ]);

    const studySubjectId = studySubjectResult.rows[0].studySubjectId;

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
    logger.info('🗓️ Phase scheduling anchor date', {
      studySubjectId,
      requestEnrollmentDate: request.enrollmentDate ?? '(not provided)',
      requestScreeningDate: request.screeningDate ?? '(not provided)',
      resolvedAnchor: enrollmentDate
    });
    const phaseDetails: { name: string; eventId: number; formsCreated: number }[] = [];
    
    // Resolve to parent study for event definitions.
    // In multi-site studies, patients enroll at a SITE (child study) but event
    // definitions and CRF assignments live on the PARENT study.
    const parentStudyResult = await client.query(
      `SELECT COALESCE(parent_study_id, study_id) AS parent_study_id FROM study WHERE study_id = $1`,
      [request.studyId]
    );
    const parentStudyId = parentStudyResult.rows[0]?.parentStudyId || request.studyId;

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
        label: subjectLabel,
        phaseCount: eventDefsResult.rows.length,
        phases: eventDefsResult.rows.map((e: any) => e.name)
      });
      
      for (const eventDef of eventDefsResult.rows) {
        const spName = `phase_${eventDef.studyEventDefinitionId}`;
        try {
          // Wrap each phase in a SAVEPOINT so a failure in one phase
          // (e.g. missing CRF version, FK violation) doesn't abort the
          // entire transaction and cause the subject + earlier phases
          // to be rolled back.
          await client.query(`SAVEPOINT ${spName}`);

          // Use schedule_day from the event definition to compute the due date.
          // date_start = the anchor (enrollment/screening date) for all visits,
          // scheduled_date (due date) = anchor + schedule_day offset.
          // Default to 0 (Day 0 = enrollment day) when schedule_day is not set,
          // so that forms are still created for the patient even without visit
          // window configuration.
          const daysOffset = eventDef.scheduleDay ?? 0;
          if (eventDef.scheduleDay == null) {
            logger.warn(`Visit "${eventDef.name}" has no schedule_day — defaulting to Day 0`, {
              studyEventDefinitionId: eventDef.studyEventDefinitionId
            });
          }
          const anchorDate = parseDateLocal(enrollmentDate) || new Date();
          const eventDueDate = new Date(anchorDate.getTime());
          eventDueDate.setDate(eventDueDate.getDate() + daysOffset);
          
          // Resolve subject_event_status_id before the INSERT to avoid
          // a subquery failure inside the INSERT poisoning the transaction.
          const sesResult = await client.query(
            `SELECT subject_event_status_id FROM subject_event_status WHERE name = 'scheduled' LIMIT 1`
          );
          const sesId = sesResult.rows[0]?.subjectEventStatusId ?? 1;

          // Try full schema first; fall back to minimal schema if extra columns
          // (scheduled_date, is_unscheduled) don't exist in the production DB.
          let eventResult;
          await repairSequence(client, 'study_event_study_event_id_seq', 'study_event', 'study_event_id');
          await client.query(`SAVEPOINT event_insert_${eventDef.studyEventDefinitionId}`);
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
              eventDef.studyEventDefinitionId,
              studySubjectId,
              request.scheduleEvent?.location || '',
              formatIsoDate(anchorDate),
              formatIsoDate(anchorDate),
              userId,
              sesId,
              formatIsoDate(eventDueDate)
            ]);
            await client.query(`RELEASE SAVEPOINT event_insert_${eventDef.studyEventDefinitionId}`);
          } catch (insertErr: any) {
            await client.query(`ROLLBACK TO SAVEPOINT event_insert_${eventDef.studyEventDefinitionId}`);
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
                eventDef.studyEventDefinitionId,
                studySubjectId,
                request.scheduleEvent?.location || '',
                formatIsoDate(anchorDate),
                formatIsoDate(anchorDate),
                userId,
                sesId
              ]);
            } else {
              throw insertErr;
            }
          }
          
          if (eventResult.rows[0]?.studyEventId) {
            const studyEventId = eventResult.rows[0].studyEventId;
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
            `, [eventDef.studyEventDefinitionId]);
            
            if (crfAssignments.rows.length === 0) {
              logger.warn(`⚠️ Phase "${eventDef.name}" has no forms assigned`, {
                studyEventDefinitionId: eventDef.studyEventDefinitionId
              });
            }
            
            for (const crfAssign of crfAssignments.rows) {
              let crfVersionId = crfAssign.defaultVersionId;
              if (!crfVersionId) {
                const versionResult = await client.query(`
                  SELECT crf_version_id FROM crf_version 
                  WHERE crf_id = $1 AND status_id NOT IN (5, 7) 
                  ORDER BY crf_version_id DESC LIMIT 1
                `, [crfAssign.crfId]);
                if (versionResult.rows.length > 0) {
                  crfVersionId = versionResult.rows[0].crfVersionId;
                } else {
                  logger.warn(`Form "${crfAssign.crfName}" (CRF ${crfAssign.crfId}) has no active versions — skipping`);
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
              
              const eventCrfId = ecResult.rows[0].eventCrfId;
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
                  crfAssign.crfId, crfVersionId, studySubjectId,
                  crfAssign.crfName, crfAssign.edcOrdinal ?? phaseFormsCreated, userId
                );
                await client.query(`RELEASE SAVEPOINT ${snapSp}`);
              } catch (snapErr: any) {
                await client.query(`ROLLBACK TO SAVEPOINT ${snapSp}`);
                logger.error('❌ CRITICAL: Form snapshot creation failed during enrollment — patient will not be able to open this form', {
                  error: snapErr.message,
                  crfId: crfAssign.crfId,
                  crfName: crfAssign.crfName,
                  studyEventId,
                  eventCrfId
                });
              }
              
              logger.debug('📋 Created event_crf + snapshot for patient phase', {
                studyEventId, eventCrfId,
                crfId: crfAssign.crfId,
                crfName: crfAssign.crfName,
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
            eventDefId: eventDef.studyEventDefinitionId, 
            phaseName: eventDef.name,
            error: eventError.message 
          });
        }
      }
      
      logger.info('✅ Patient enrollment complete - phases and forms copied', { 
        studySubjectId,
        label: subjectLabel, 
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
          label: subjectLabel,
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
      label: subjectLabel 
    });

    // AUTO-TRIGGER WORKFLOW: Create enrollment verification workflow
    // This is a real EDC pattern - new enrollments need verification
    try {
      await workflowService.triggerSubjectEnrolledWorkflow(
        studySubjectId,
        request.studyId,
        subjectLabel,
        userId
      );
      logger.info('Auto-triggered enrollment verification workflow', { studySubjectId, label: subjectLabel });
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
        label: subjectLabel,
        secondaryLabel: request.secondaryLabel || '',
        studyId: request.studyId,
        enrollmentDate: effectiveEnrollmentDate,
        screeningDate: effectiveScreeningDate,
        timeZone: timeZone,
        ocOid,
        
        // Subject demographics
        personId: personIdRaw || uniqueIdentifier,
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
    if (error.code === '23505') {
      const constraint = error.constraint || '';
      if (constraint.includes('oc_oid') || constraint.includes('uniq_study_subject_oid')) {
        logger.warn('OC OID collision — this is a transient uniqueness conflict, not a real duplicate subject', { constraint });
        return {
          success: false,
          message: 'A temporary identifier conflict occurred. Please try again.'
        };
      }
      return {
        success: false,
        message: `Subject with ID "${subjectLabel}" already exists in this study. Please use a different Subject ID.`
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
    search?: string;
    siteId?: number;
    page?: number;
    limit?: number;
    includeArchived?: boolean;
  },
  userId?: number,
  username?: string
): Promise<PaginatedResponse<any>> => {
  logger.info('Getting subject list (SOAP primary)', { studyId, filters, soapEnabled: config.libreclinica.soapEnabled });

  try {
    const { status, search, siteId, page = 1, limit = 20, includeArchived = false } = filters;
    const offset = (page - 1) * limit;

    // Try SOAP first for Part 11 compliance
    if (config.libreclinica.soapEnabled && userId && username) {
      try {
        // Get study OID first
        const studyOidQuery = `SELECT oc_oid FROM study WHERE study_id = $1`;
        const oidResult = await pool.query(studyOidQuery, [studyId]);
        const studyOid = oidResult.rows[0]?.ocOid || `S_${studyId}`;

        const soapResult = await subjectSoap.listSubjects(studyOid, userId, username);
        
        if (soapResult.success && soapResult.data) {
          logger.info('✅ Subjects retrieved via SOAP', { studyId });
          
          // Enrich with DB stats
          const enrichedSubjects = await enrichSubjectsWithStats(soapResult.data, studyId);
          
          // Filter out archived subjects unless explicitly requested
          let filteredSubjects = enrichedSubjects;
          if (!includeArchived) {
            const archivedStatuses = new Set(['removed', 'auto-removed', 'auto-deleted', 'withdrawn']);
            const archivedStatusIds = new Set([5, 6, 7]);
            filteredSubjects = filteredSubjects.filter((s: any) => {
              if (s.statusId && archivedStatusIds.has(s.statusId)) return false;
              if (s.status && archivedStatuses.has(s.status.toLowerCase())) return false;
              return true;
            });
          }

          // Apply status filter if specified
          if (status) {
            filteredSubjects = filteredSubjects.filter((s: any) => 
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
    if (!includeArchived) {
      conditions.push('ss.status_id NOT IN (5, 6, 7)');
    }
    const params: any[] = [studyId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`st.name = $${paramIndex++}`);
      params.push(status);
    }

    if (search && search.trim()) {
      conditions.push(`(
        ss.label ILIKE $${paramIndex}
        OR ss.secondary_label ILIKE $${paramIndex}
        OR s.unique_identifier ILIKE $${paramIndex}
      )`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    if (siteId) {
      conditions.push(`ss.study_id = $${paramIndex++}`);
      params.push(siteId);
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
        ss.subject_id,
        ss.study_id,
        ss.label,
        ss.secondary_label,
        ss.enrollment_date,
        ss.screening_date,
        ss.status_id,
        ss.oc_oid,
        ss.owner_id,
        st.name as status,
        s.gender,
        s.date_of_birth,
        s.unique_identifier,
        ss.date_created,
        ss.date_updated,
        u.user_name as created_by,
        stdy.name as study_name,
        CASE WHEN stdy.parent_study_id IS NOT NULL THEN stdy.name ELSE NULL END as site_name,
        (
          SELECT COUNT(*)
          FROM study_event se
          WHERE se.study_subject_id = ss.study_subject_id
        ) as total_events,
        (
          SELECT COUNT(*)
          FROM study_event se_ce
          INNER JOIN subject_event_status sest ON se_ce.subject_event_status_id = sest.subject_event_status_id
          WHERE se_ce.study_subject_id = ss.study_subject_id
            AND sest.name IN ('completed', 'stopped')
        ) as completed_events,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id
            AND ec.status_id NOT IN (5, 7)
        ) + (
          SELECT COUNT(*)
          FROM study_event se_af
          INNER JOIN event_definition_crf edc_af ON edc_af.study_event_definition_id = se_af.study_event_definition_id AND edc_af.status_id = 1
          WHERE se_af.study_subject_id = ss.study_subject_id
            AND NOT EXISTS (
              SELECT 1 FROM event_crf ec_af
              INNER JOIN crf_version cv_af ON ec_af.crf_version_id = cv_af.crf_version_id
              WHERE ec_af.study_event_id = se_af.study_event_id
                AND cv_af.crf_id = edc_af.crf_id
                AND ec_af.status_id NOT IN (5, 7)
            )
        ) as total_forms,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = ss.study_subject_id
            AND ec.completion_status_id >= 4
            AND ec.status_id NOT IN (5, 7)
        ) as completed_forms,
        cur_visit.visit_name as current_visit_name,
        cur_visit.visit_event_id as current_visit_event_id,
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
        (
          SELECT COALESCE(json_agg(row_to_json(cvf) ORDER BY cvf."ordinal"), '[]'::json)
          FROM (
            -- Started forms (have event_crf row)
            SELECT
              c_cv.crf_id AS "crfId",
              c_cv.name AS "crfName",
              ec_cv.event_crf_id AS "eventCrfId",
              se_cv.study_event_id AS "studyEventId",
              COALESCE(cs_cv.name, 'not_started') AS "completionStatus",
              COALESCE(pef_cv.open_query_count, 0)::int AS "openQueryCount",
              COALESCE(pef_cv.closed_query_count, 0)::int AS "closedQueryCount",
              sed_cv.name AS "visitName",
              COALESCE(edc_cv.ordinal, 1) AS "ordinal",
              CASE
                WHEN se_cv.scheduled_date IS NOT NULL
                  AND se_cv.scheduled_date < CURRENT_DATE
                  AND COALESCE(ec_cv.completion_status_id, 0) < 4
                THEN true ELSE false
              END AS "isOverdue"
            FROM event_crf ec_cv
            INNER JOIN study_event se_cv ON ec_cv.study_event_id = se_cv.study_event_id
            INNER JOIN study_event_definition sed_cv ON se_cv.study_event_definition_id = sed_cv.study_event_definition_id
            INNER JOIN crf_version cv_cv ON ec_cv.crf_version_id = cv_cv.crf_version_id
            INNER JOIN crf c_cv ON cv_cv.crf_id = c_cv.crf_id
            LEFT JOIN completion_status cs_cv ON ec_cv.completion_status_id = cs_cv.completion_status_id
            LEFT JOIN event_definition_crf edc_cv ON edc_cv.study_event_definition_id = sed_cv.study_event_definition_id AND edc_cv.crf_id = c_cv.crf_id
            LEFT JOIN patient_event_form pef_cv ON pef_cv.event_crf_id = ec_cv.event_crf_id
            WHERE se_cv.study_subject_id = ss.study_subject_id
              AND ec_cv.status_id NOT IN (5, 7)
              AND se_cv.study_event_id = cur_visit.visit_event_id

            UNION ALL

            -- Not-yet-started forms (assigned via event_definition_crf but no event_crf yet)
            SELECT
              c_ns.crf_id AS "crfId",
              c_ns.name AS "crfName",
              NULL::int AS "eventCrfId",
              se_ns.study_event_id AS "studyEventId",
              'not_started' AS "completionStatus",
              0 AS "openQueryCount",
              0 AS "closedQueryCount",
              sed_ns.name AS "visitName",
              COALESCE(edc_ns.ordinal, 1) AS "ordinal",
              CASE
                WHEN se_ns.scheduled_date IS NOT NULL
                  AND se_ns.scheduled_date < CURRENT_DATE
                THEN true ELSE false
              END AS "isOverdue"
            FROM study_event se_ns
            INNER JOIN study_event_definition sed_ns ON se_ns.study_event_definition_id = sed_ns.study_event_definition_id
            INNER JOIN event_definition_crf edc_ns ON edc_ns.study_event_definition_id = sed_ns.study_event_definition_id AND edc_ns.status_id = 1
            INNER JOIN crf c_ns ON edc_ns.crf_id = c_ns.crf_id
            WHERE se_ns.study_subject_id = ss.study_subject_id
              AND se_ns.study_event_id = cur_visit.visit_event_id
              AND NOT EXISTS (
                SELECT 1 FROM event_crf ec_ns
                INNER JOIN crf_version cv_ns ON ec_ns.crf_version_id = cv_ns.crf_version_id
                WHERE ec_ns.study_event_id = se_ns.study_event_id
                  AND cv_ns.crf_id = edc_ns.crf_id
                  AND ec_ns.status_id NOT IN (5, 7)
              )
          ) cvf
        ) as current_visit_forms,
        'DATABASE' as source
      FROM study_subject ss
      INNER JOIN subject s ON ss.subject_id = s.subject_id
      INNER JOIN status st ON ss.status_id = st.status_id
      LEFT JOIN user_account u ON ss.owner_id = u.user_id
      LEFT JOIN study stdy ON ss.study_id = stdy.study_id
      LEFT JOIN LATERAL (
        SELECT
          sed_lv.name AS visit_name,
          se_lv.study_event_id AS visit_event_id
        FROM study_event se_lv
        INNER JOIN study_event_definition sed_lv ON se_lv.study_event_definition_id = sed_lv.study_event_definition_id
        WHERE se_lv.study_subject_id = ss.study_subject_id
          AND NOT EXISTS (
            SELECT 1 FROM event_crf ec_lv
            INNER JOIN study_event se_lv2 ON ec_lv.study_event_id = se_lv2.study_event_id
            WHERE se_lv2.study_event_id = se_lv.study_event_id
              AND ec_lv.completion_status_id >= 4
              AND ec_lv.status_id NOT IN (5, 7)
            HAVING COUNT(*) >= (
              SELECT COUNT(*) FROM event_definition_crf edc_lv
              WHERE edc_lv.study_event_definition_id = sed_lv.study_event_definition_id
                AND edc_lv.status_id = 1
            )
          )
        ORDER BY sed_lv.ordinal ASC, COALESCE(se_lv.scheduled_date, se_lv.date_start, se_lv.date_created) ASC
        LIMIT 1
      ) cur_visit ON true
      WHERE ${whereClause}
      ORDER BY ss.enrollment_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);

    const mappedData = dataResult.rows.map((row: any) => ({
      ...row,
      openQueryCount: parseInt(row.openQueryCount) || 0,
      overdueQueryCount: parseInt(row.overdueQueryCount) || 0,
      closedQueryCount: parseInt(row.closedQueryCount) || 0,
      currentVisitEventId: row.currentVisitEventId ? parseInt(row.currentVisitEventId) : null,
      currentVisitForms: Array.isArray(row.currentVisitForms) ? row.currentVisitForms : (row.currentVisitForms || []),
      allFormsWithOpenQueries: Array.isArray(row.allFormsWithOpenQueries) ? row.allFormsWithOpenQueries : (row.allFormsWithOpenQueries || []),
    }));

    return {
      success: true,
      data: mappedData,
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
        sed.schedule_day,
        sed.min_day,
        sed.max_day,
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
    const totalForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.totalForms), 0);
    const completedForms = eventsResult.rows.reduce((sum, e) => sum + parseInt(e.completedForms), 0);
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
    let lastActivity = subject.dateUpdated || subject.dateCreated;
    try {
      const activityResult = await pool.query(lastActivityQuery, [subjectId]);
      if (activityResult.rows.length > 0 && activityResult.rows[0].lastActivityDate) {
        const actDate = new Date(activityResult.rows[0].lastActivityDate);
        if (actDate.getFullYear() > 1970) {
          lastActivity = activityResult.rows[0].lastActivityDate;
        }
      }
    } catch (err) {
      logger.warn('Failed to get last activity date', { error: (err as any).message });
    }

    // Row is already camelCase from the database layer
    const studySubject = subject;
    
    const details: StudySubjectWithDetails = {
      ...studySubject,
      subject: {
        subjectId: subject.subjectId,
        uniqueIdentifier: subject.uniqueIdentifier,
        gender: subject.gender || '',
        dateOfBirth: subject.dateOfBirth,
        dobCollected: !!subject.dateOfBirth,
        statusId: subject.statusId,
        ownerId: subject.ownerId,
        dateCreated: subject.dateCreated,
        dateUpdated: subject.dateUpdated,
        updateId: subject.updateId
      },
      study: {
        studyId: subject.studyId,
        name: subject.parentStudyName || subject.studyName || '',
        identifier: '',
        type: 'nongenetic',
        statusId: 1,
        ownerId: subject.ownerId,
        dateCreated: subject.dateCreated
      },
      events: eventsResult.rows.map((e: any) => ({
        studyEventId: e.studyEventId,
        studyEventDefinitionId: e.studyEventDefinitionId,
        studySubjectId: subjectId,
        location: e.location,
        sampleOrdinal: e.sampleOrdinal || 1,
        dateStarted: e.dateStart,
        dateEnded: e.dateEnd,
        scheduledDate: e.scheduledDate,
        isUnscheduled: e.isUnscheduled || false,
        type: e.eventType || 'scheduled',
        name: e.eventName,
        subjectEventStatus: e.statusName || 'scheduled',
        statusId: e.statusId,
        ownerId: e.ownerId,
        dateCreated: e.dateCreated,
        dateUpdated: e.dateUpdated,
        scheduleDay: e.scheduleDay,
        minDay: e.minDay,
        maxDay: e.maxDay
      })),
      progress: {
        totalEvents: eventsResult.rows.length,
        completedEvents: eventsResult.rows.filter((e: any) => 
          ['completed', 'stopped'].includes(e.statusName?.toLowerCase())
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
 * Uses denormalized query counts from patient_event_form for speed.
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
        COALESCE((
          SELECT SUM(pef.open_query_count)
          FROM patient_event_form pef
          WHERE pef.study_subject_id = $1
        ), 0)::int as open_queries
      FROM study_subject ss
      LEFT JOIN study_event se ON ss.study_subject_id = se.study_subject_id
      LEFT JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      LEFT JOIN event_crf ec ON se.study_event_id = ec.study_event_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE ss.study_subject_id = $1
      GROUP BY ss.study_subject_id
    `;

    const result = await pool.query(query, [subjectId]);

    if (result.rows.length === 0) {
      return null;
    }

    const stats = result.rows[0];

    const totalEvents = parseInt(stats.totalEvents) || 0;
    const completedEvents = parseInt(stats.completedEvents) || 0;
    const totalForms = parseInt(stats.totalForms) || 0;
    const completedForms = parseInt(stats.completedForms) || 0;
    const openQueries = parseInt(stats.openQueries) || 0;
    
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
        studySubjectId: stats.studySubjectId,
        totalEvents: parseInt(stats.totalEvents) || 0,
        completedForms: parseInt(stats.completedForms) || 0
      };
    });
  } catch (error: any) {
    logger.warn('Failed to enrich subjects with stats', { error: error.message });
    return subjects;
  }
}

/**
 * Get aggregated query counts for a batch of subjects (by studySubjectIds).
 * Single efficient query - designed to be called per-page.
 */
export const getQueryCountsForSubjects = async (studySubjectIds: number[]): Promise<Record<number, { openQueryCount: number; overdueQueryCount: number; closedQueryCount: number }>> => {
  if (!studySubjectIds.length) return {};
  
  const result = await pool.query(`
    SELECT
      pef.study_subject_id,
      COALESCE(SUM(pef.open_query_count), 0)::int AS open_query_count,
      COALESCE(SUM(pef.overdue_query_count), 0)::int AS overdue_query_count,
      COALESCE(SUM(pef.closed_query_count), 0)::int AS closed_query_count
    FROM patient_event_form pef
    WHERE pef.study_subject_id = ANY($1)
    GROUP BY pef.study_subject_id
  `, [studySubjectIds]);

  const counts: Record<number, { openQueryCount: number; overdueQueryCount: number; closedQueryCount: number }> = {};
  for (const row of result.rows) {
    counts[row.studySubjectId] = {
      openQueryCount: row.openQueryCount,
      overdueQueryCount: row.overdueQueryCount,
      closedQueryCount: row.closedQueryCount
    };
  }
  return counts;
};

/**
 * Get all forms with queries for a batch of subjects.
 * Returns forms across ALL visits that have any query activity.
 * Single efficient query - designed to be called per-page.
 */
export const getFormsWithQueriesForSubjects = async (studySubjectIds: number[]): Promise<Record<number, any[]>> => {
  if (!studySubjectIds.length) return {};

  const result = await pool.query(`
    SELECT
      pef.study_subject_id,
      json_agg(json_build_object(
        'crfId', pef.crf_id,
        'crfName', pef.form_name,
        'eventCrfId', pef.event_crf_id,
        'studyEventId', pef.study_event_id,
        'completionStatus', pef.completion_status,
        'openQueryCount', COALESCE(pef.open_query_count, 0),
        'overdueQueryCount', COALESCE(pef.overdue_query_count, 0),
        'closedQueryCount', COALESCE(pef.closed_query_count, 0),
        'visitName', sed.name
      ) ORDER BY sed.ordinal, pef.ordinal) AS forms
    FROM patient_event_form pef
    INNER JOIN study_event se ON pef.study_event_id = se.study_event_id
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    WHERE pef.study_subject_id = ANY($1)
      AND (pef.open_query_count > 0 OR pef.overdue_query_count > 0 OR pef.closed_query_count > 0)
    GROUP BY pef.study_subject_id
  `, [studySubjectIds]);

  const formsMap: Record<number, any[]> = {};
  for (const row of result.rows) {
    formsMap[row.studySubjectId] = row.forms || [];
  }
  return formsMap;
};

/**
 * Get events for a subject with form completion stats.
 * Returns raw rows — the controller handles DTO mapping.
 */
export const getSubjectEvents = async (studySubjectId: number) => {
  const query = `
    SELECT 
      se.study_event_id,
      se.study_subject_id,
      sed.study_event_definition_id,
      sed.name as event_name,
      sed.description as event_description,
      sed.type as event_type,
      sed.ordinal as event_order,
      sed.schedule_day,
      sed.min_day,
      sed.max_day,
      se.sample_ordinal,
      se.date_start,
      se.date_end,
      se.location,
      se.scheduled_date,
      COALESCE(se.is_unscheduled, false) as is_unscheduled,
      se.date_created,
      GREATEST(
        (SELECT COUNT(*) FROM event_definition_crf edc2
         INNER JOIN crf c2 ON edc2.crf_id = c2.crf_id
         WHERE edc2.study_event_definition_id = sed.study_event_definition_id
           AND edc2.status_id = 1 AND c2.status_id NOT IN (5, 6, 7)),
        (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.status_id NOT IN (5, 7))
      ) as total_forms,
      (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.completion_status_id >= 4 AND ec.status_id NOT IN (5, 7)) as completed_forms,
      (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.completion_status_id >= 2 AND ec.status_id NOT IN (5, 7)) as started_forms,
      (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.status_id = 6) as locked_forms
    FROM study_event se
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    WHERE se.study_subject_id = $1
    ORDER BY 
      COALESCE(se.scheduled_date, se.date_start, se.date_created) ASC,
      sed.ordinal ASC,
      se.sample_ordinal ASC
  `;

  const result = await pool.query(query, [studySubjectId]);
  return result.rows;
};

/**
 * Get forms/CRFs for a subject: both existing (with data) and assigned-but-not-started.
 * Returns { existingRows, assignedRows } — the controller merges and maps to DTOs.
 */
export const getSubjectForms = async (studySubjectId: number) => {
  const existingFormsQuery = `
    SELECT 
      ec.event_crf_id,
      ec.study_event_id,
      se.study_subject_id,
      sed.name as event_name,
      sed.study_event_definition_id,
      c.crf_id,
      c.name as form_name,
      c.description as form_description,
      cv.crf_version_id,
      cv.name as version_name,
      ec.date_interviewed,
      ec.interviewer_name,
      COALESCE(cs.name, 'initial_data_entry') as completion_status,
      st.name as status,
      ec.date_created,
      ec.date_updated,
      ec.validator_id,
      ec.date_validate,
      ec.date_completed,
      COALESCE(edc.required_crf, false) as required_crf
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    INNER JOIN crf c ON cv.crf_id = c.crf_id
    LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
    INNER JOIN status st ON ec.status_id = st.status_id
    LEFT JOIN event_definition_crf edc ON edc.study_event_definition_id = sed.study_event_definition_id AND edc.crf_id = c.crf_id
    WHERE se.study_subject_id = $1
      AND ec.status_id NOT IN (5, 7)
    ORDER BY sed.ordinal, c.name
  `;

  const assignedFormsQuery = `
    SELECT 
      se.study_event_id,
      se.study_subject_id,
      sed.name as event_name,
      sed.study_event_definition_id,
      edc.crf_id,
      c.name as form_name,
      c.description as form_description,
      (SELECT cv2.crf_version_id FROM crf_version cv2 
       WHERE cv2.crf_id = edc.crf_id AND cv2.status_id NOT IN (5, 7) 
       ORDER BY cv2.crf_version_id DESC LIMIT 1) as crf_version_id,
      (SELECT cv2.name FROM crf_version cv2 
       WHERE cv2.crf_id = edc.crf_id AND cv2.status_id NOT IN (5, 7) 
       ORDER BY cv2.crf_version_id DESC LIMIT 1) as version_name,
      edc.required_crf,
      edc.ordinal as crf_ordinal
    FROM study_event se
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN event_definition_crf edc ON edc.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN crf c ON edc.crf_id = c.crf_id
    WHERE se.study_subject_id = $1
      AND se.status_id NOT IN (5, 7)
      AND edc.status_id NOT IN (5, 7)
      AND c.status_id NOT IN (5, 7)
    ORDER BY sed.ordinal, edc.ordinal, c.name
  `;

  const [existingResult, assignedResult] = await Promise.all([
    pool.query(existingFormsQuery, [studySubjectId]),
    pool.query(assignedFormsQuery, [studySubjectId]),
  ]);

  return { existingRows: existingResult.rows, assignedRows: assignedResult.rows };
};

/**
 * Update a subject inside a single transaction.
 * Handles study_subject fields, visit rescheduling, demographics, and audit logging.
 * Returns the committed result; throws on failure (caller should catch).
 */
export const updateSubject = async (
  studySubjectId: number,
  updates: {
    secondaryLabel?: string;
    enrollmentDate?: string;
    screeningDate?: string;
    enrollmentStatus?: string;
    visitDateReference?: string;
    visitDateCustom?: string;
    dateOfBirth?: string;
    gender?: string;
    personId?: string;
  },
  userId: number
): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.secondaryLabel !== undefined) {
      updateFields.push(`secondary_label = $${paramIndex++}`);
      params.push(updates.secondaryLabel);
    }

    if (updates.enrollmentDate !== undefined) {
      updateFields.push(`enrollment_date = $${paramIndex++}`);
      params.push(updates.enrollmentDate || null);
    }

    if (updates.screeningDate !== undefined) {
      updateFields.push(`screening_date = $${paramIndex++}`);
      params.push(updates.screeningDate || null);
    }

    if (updates.enrollmentStatus !== undefined) {
      const statusMap: Record<string, number> = {
        'enrolled': 1,
        'screening': 4,
        'screen_failure': 5,
      };
      const statusId = statusMap[updates.enrollmentStatus];
      if (statusId !== undefined) {
        updateFields.push(`status_id = $${paramIndex++}`);
        params.push(statusId);
      }
    }

    if (updates.visitDateReference !== undefined) {
      updateFields.push(`visit_date_reference = $${paramIndex++}`);
      params.push(updates.visitDateReference);
    }

    if (updates.visitDateCustom !== undefined) {
      updateFields.push(`visit_date_custom = $${paramIndex++}`);
      params.push(updates.visitDateCustom || null);
    }

    if (updateFields.length > 0) {
      updateFields.push(`date_updated = NOW()`);
      updateFields.push(`update_id = $${paramIndex++}`);
      params.push(userId);
      params.push(studySubjectId);

      const updateQuery = `
        UPDATE study_subject
        SET ${updateFields.join(', ')}
        WHERE study_subject_id = $${paramIndex}
      `;

      await client.query(updateQuery, params);
    }

    // Reschedule visit due dates when any anchor-relevant field changes.
    const anchorFieldChanged =
      updates.enrollmentDate !== undefined ||
      updates.screeningDate !== undefined ||
      updates.visitDateReference !== undefined ||
      updates.visitDateCustom !== undefined ||
      updates.enrollmentStatus !== undefined;

    if (anchorFieldChanged) {
      const subjectRow = await client.query(
        `SELECT ss.enrollment_date, ss.screening_date,
                ss.visit_date_reference, ss.visit_date_custom,
                COALESCE(s.parent_study_id, ss.study_id) AS parent_study_id
         FROM study_subject ss
         JOIN study s ON ss.study_id = s.study_id
         WHERE ss.study_subject_id = $1`,
        [studySubjectId]
      );
      const subj = subjectRow.rows[0];

      if (subj) {
        const ref = updates.visitDateReference ?? subj.visitDateReference ?? 'scheduling_date';
        let anchorStr: string | null = null;

        if (ref === 'enrollment_date') {
          anchorStr = updates.enrollmentDate ?? subj.enrollmentDate;
        } else if (ref === 'custom_date') {
          anchorStr = updates.visitDateCustom ?? subj.visitDateCustom;
        } else {
          anchorStr = updates.screeningDate ?? subj.screeningDate ?? updates.enrollmentDate ?? subj.enrollmentDate;
        }

        const anchor = anchorStr ? parseDateLocal(anchorStr) : null;

        if (anchor && subj.parentStudyId) {
          const visitRows = await client.query(`
            SELECT se.study_event_id, sed.ordinal, sed.schedule_day
            FROM study_event se
            JOIN study_event_definition sed
              ON se.study_event_definition_id = sed.study_event_definition_id
            WHERE se.study_subject_id = $1
              AND sed.study_id = $2
              AND COALESCE(se.is_unscheduled, false) = false
            ORDER BY sed.ordinal
          `, [studySubjectId, subj.parentStudyId]);

          for (const row of visitRows.rows) {
            if (row.scheduleDay == null) {
              logger.warn('Skipping reschedule for visit without schedule_day', {
                studyEventId: row.studyEventId,
                ordinal: row.ordinal
              });
              continue;
            }
            const daysOffset = row.scheduleDay;
            const visitDate = new Date(anchor.getTime());
            visitDate.setDate(visitDate.getDate() + daysOffset);
            const isoDate = formatIsoDate(visitDate);

            await client.query(`
              UPDATE study_event
              SET scheduled_date = $1::date
              WHERE study_event_id = $2
            `, [isoDate, row.studyEventId]);
          }

          logger.info('Rescheduled visit due dates', {
            studySubjectId,
            reference: ref,
            anchorDate: anchorStr,
            visitsUpdated: visitRows.rows.length
          });
        }
      }
    }

    // Update subject table if demographic info or personId provided
    if (updates.dateOfBirth || updates.gender || updates.personId !== undefined) {
      const subjectQuery = `SELECT ss.subject_id FROM study_subject ss WHERE ss.study_subject_id = $1`;
      const subjectResult = await client.query(subjectQuery, [studySubjectId]);
      
      if (subjectResult.rows.length > 0) {
        const subjectId = subjectResult.rows[0].subjectId;
        const subjectUpdates: string[] = [];
        const subjectParams: any[] = [];
        let subjectParamIndex = 1;

        if (updates.dateOfBirth) {
          subjectUpdates.push(`date_of_birth = $${subjectParamIndex++}`);
          subjectParams.push(updates.dateOfBirth);
        }

        if (updates.gender) {
          subjectUpdates.push(`gender = $${subjectParamIndex++}`);
          subjectParams.push(updates.gender === 'male' ? 'm' : updates.gender === 'female' ? 'f' : updates.gender);
        }

        if (updates.personId !== undefined) {
          logger.info('personId update requested (display-only, does not change internal UUID)', {
            studySubjectId, personId: updates.personId
          });
        }

        if (subjectUpdates.length > 0) {
          subjectParams.push(subjectId);
          const subjectUpdateQuery = `
            UPDATE subject
            SET ${subjectUpdates.join(', ')}
            WHERE subject_id = $${subjectParamIndex}
          `;
          await client.query(subjectUpdateQuery, subjectParams);
        }
      }
    }

    // Audit log
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Update%' LIMIT 1)
      )
    `, [userId, studySubjectId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Update a subject's status inside a transaction.
 * Returns the old status id; throws on failure.
 */
export const updateSubjectStatus = async (
  studySubjectId: number,
  statusId: number,
  userId: number,
  reason?: string
): Promise<{ oldStatusId: number }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT status_id FROM study_subject WHERE study_subject_id = $1`,
      [studySubjectId]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Subject not found'), { statusCode: 404 });
    }

    const oldStatusId = currentResult.rows[0].statusId;

    await client.query(`
      UPDATE study_subject
      SET status_id = $1, date_updated = NOW(), update_id = $2
      WHERE study_subject_id = $3
    `, [statusId, userId, studySubjectId]);

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject', $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Status%' LIMIT 1)
      )
    `, [userId, studySubjectId, oldStatusId.toString(), statusId.toString(), reason || 'Status change']);

    await client.query('COMMIT');
    return { oldStatusId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Soft-delete a subject (set status to removed) inside a transaction.
 * Throws with statusCode 404 if subject not found.
 */
export const removeSubject = async (
  studySubjectId: number,
  userId: number
): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const checkResult = await client.query(
      `SELECT study_subject_id FROM study_subject WHERE study_subject_id = $1`,
      [studySubjectId]
    );

    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Subject not found'), { statusCode: 404 });
    }

    await client.query(`
      UPDATE study_subject
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE study_subject_id = $2
    `, [userId, studySubjectId]);

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Remove%' OR name LIKE '%Delete%' LIMIT 1)
      )
    `, [userId, studySubjectId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Check whether a subject label already exists in a study (including child studies).
 * Excludes removed/auto-removed/invalid statuses (5, 6, 7).
 */
export const checkLabelExists = async (studyId: number, label: string): Promise<boolean> => {
  const result = await pool.query(`
    SELECT study_subject_id FROM study_subject 
    WHERE (study_id = $1 OR study_id IN (
      SELECT study_id FROM study WHERE parent_study_id = $1
    ))
    AND label = $2 AND status_id NOT IN (5, 6, 7)
    LIMIT 1
  `, [studyId, label]);
  return result.rows.length > 0;
};

export default {
  createSubject,
  getSubjectList,
  getSubjectById,
  getSubjectProgress,
  getSubjectEvents,
  getSubjectForms,
  updateSubject,
  updateSubjectStatus,
  removeSubject,
  checkLabelExists
};

