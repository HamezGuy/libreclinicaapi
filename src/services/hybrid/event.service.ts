/**
 * Study Event Service (Hybrid)
 * 
 * Study Event (Phase) management combining SOAP and Database
 * - Use Database for reading events
 * - Use SOAP for scheduling events (GxP compliant)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as eventSoap from '../soap/eventSoap.service';
import { getFormMetadata } from './form.service';
import { ApiResponse, PaginatedResponse } from '../../types';
import {
  CreateEventRequest,
  UpdateEventRequest,
  ScheduleEventRequest,
  CreateUnscheduledVisitRequest,
  AssignCrfToEventRequest,
  AssignFormToPatientVisitRequest
} from '../../types/event.dto';

/**
 * Get all study events (phases) for a study
 */
export const getStudyEvents = async (studyId: number): Promise<any[]> => {
  logger.info('Getting study events', { studyId });

  try {
    const query = `
      SELECT 
        sed.study_event_definition_id,
        sed.study_id,
        sed.name,
        sed.description,
        sed.ordinal,
        sed.type,
        sed.repeating,
        sed.category,
        sed.schedule_day,
        sed.min_day,
        sed.max_day,
        sed.reference_event_id,
        s.name as status_name,
        sed.oc_oid,
        (SELECT COUNT(*) FROM study_event se WHERE se.study_event_definition_id = sed.study_event_definition_id AND se.status_id NOT IN (5, 7)) as usage_count,
        (SELECT COUNT(*) FROM event_definition_crf edc WHERE edc.study_event_definition_id = sed.study_event_definition_id AND edc.status_id NOT IN (5, 7)) as crf_count
      FROM study_event_definition sed
      INNER JOIN status s ON sed.status_id = s.status_id
      WHERE sed.study_id = $1 AND sed.status_id NOT IN (5, 7)
      ORDER BY sed.ordinal
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get study events error', { error: error.message });
    throw error;
  }
};

/**
 * Get study event by ID
 */
export const getStudyEventById = async (eventDefinitionId: number): Promise<any> => {
  logger.info('Getting study event by ID', { eventDefinitionId });

  try {
    const query = `
      SELECT 
        sed.*,
        s.name as status_name,
        st.name as study_name
      FROM study_event_definition sed
      INNER JOIN status s ON sed.status_id = s.status_id
      INNER JOIN study st ON sed.study_id = st.study_id
      WHERE sed.study_event_definition_id = $1
    `;

    const result = await pool.query(query, [eventDefinitionId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get study event by ID error', { error: error.message });
    throw error;
  }
};

/**
 * Get subject events (patient's scheduled events)
 */
export const getSubjectEvents = async (studySubjectId: number): Promise<any[]> => {
  logger.info('Getting subject events', { studySubjectId });

  try {
    const query = `
      SELECT 
        se.study_event_id,
        se.study_event_definition_id,
        se.study_subject_id,
        sed.name as event_name,
        sed.ordinal,
        sed.type as event_type,
        se.subject_event_status_id,
        se.subject_event_status_id as status_id,
        ses.name as status_name,
        se.date_start,
        se.date_end,
        se.sample_ordinal,
        se.location,
        se.scheduled_date,
        COALESCE(se.is_unscheduled, false) as is_unscheduled,
        (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id) as crf_count,
        (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.completion_status_id = 2) as completed_crf_count
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
      WHERE se.study_subject_id = $1
      ORDER BY 
        COALESCE(se.scheduled_date, se.date_start, se.date_created) ASC,
        sed.ordinal ASC,
        se.sample_ordinal ASC
    `;

    const result = await pool.query(query, [studySubjectId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get subject events error', { error: error.message });
    throw error;
  }
};

/**
 * Get CRFs for a study event definition (template level)
 */
export const getEventCRFs = async (eventDefinitionId: number): Promise<any[]> => {
  logger.info('Getting event CRFs', { eventDefinitionId });

  try {
    const query = `
      SELECT 
        edc.event_definition_crf_id,
        edc.study_event_definition_id,
        edc.crf_id,
        c.name as crf_name,
        c.description as crf_description,
        edc.required_crf,
        edc.double_entry,
        edc.hide_crf,
        edc.ordinal,
        edc.default_version_id,
        cv.name as default_version_name
      FROM event_definition_crf edc
      INNER JOIN crf c ON edc.crf_id = c.crf_id
      LEFT JOIN crf_version cv ON edc.default_version_id = cv.crf_version_id
      WHERE edc.study_event_definition_id = $1
        AND edc.status_id = 1
        AND c.status_id NOT IN (5, 6, 7)
      ORDER BY edc.ordinal
    `;

    const result = await pool.query(query, [eventDefinitionId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get event CRFs error', { error: error.message });
    throw error;
  }
};

/**
 * Get patient's event_crfs for a specific study_event (instance level)
 * These are the editable copies of templates for this patient's phase
 */
export const getPatientEventCRFs = async (studyEventId: number): Promise<any[]> => {
  logger.info('Getting patient event CRFs', { studyEventId });

  try {
    const query = `
      SELECT 
        ec.event_crf_id,
        ec.study_event_id,
        ec.crf_version_id,
        ec.study_subject_id,
        cv.crf_id,
        c.name as crf_name,
        c.description as crf_description,
        cv.name as version_name,
        ec.completion_status_id,
        cs.name as completion_status,
        ec.status_id,
        s.name as status_name,
        ec.date_created,
        ec.date_updated,
        ec.date_completed,
        ec.date_validate,
        ec.sdv_status,
        u.user_name as owner_name,
        -- Count of filled fields
        (SELECT COUNT(*) FROM item_data id WHERE id.event_crf_id = ec.event_crf_id AND id.deleted = false) as filled_fields,
        -- Total fields in this CRF version
        (SELECT COUNT(DISTINCT i.item_id) 
         FROM item i 
         INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id 
         WHERE igm.crf_version_id = ec.crf_version_id) as total_fields
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      INNER JOIN status s ON ec.status_id = s.status_id
      LEFT JOIN user_account u ON ec.owner_id = u.user_id
      WHERE ec.study_event_id = $1
      ORDER BY c.name
    `;

    const result = await pool.query(query, [studyEventId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get patient event CRFs error', { error: error.message });
    throw error;
  }
};

/**
 * Get ALL forms for a patient's visit — the single source of truth for the visit detail UI.
 * 
 * Combines:
 *   1. Template-level forms (event_definition_crf) — which forms SHOULD exist for this visit type
 *   2. Patient-level form instances (event_crf) — which forms the patient has started/completed
 * 
 * Returns one row per form. If the patient has an event_crf for that form, it includes
 * status/progress. If not, status = 'not_started'.
 */
export const getVisitForms = async (studyEventId: number): Promise<any[]> => {
  logger.info('Getting visit forms', { studyEventId });

  try {
    const query = `
      WITH visit_info AS (
        SELECT study_event_definition_id, study_subject_id
        FROM study_event
        WHERE study_event_id = $1
      )
      SELECT
        edc.event_definition_crf_id,
        edc.crf_id,
        c.name             AS crf_name,
        c.description      AS crf_description,
        edc.required_crf,
        edc.double_entry,
        edc.ordinal,
        edc.electronic_signature,
        edc.default_version_id,
        cv_def.name        AS default_version_name,
        -- Patient-specific instance (may be NULL if form not yet started)
        ec.event_crf_id,
        ec.crf_version_id  AS patient_version_id,
        COALESCE(cs.name, 'not_started') AS completion_status,
        ec.completion_status_id,
        ec.date_created    AS started_at,
        ec.date_completed  AS completed_at,
        COALESCE(
          (SELECT COUNT(*) FROM item_data id2
           WHERE id2.event_crf_id = ec.event_crf_id AND id2.deleted = false), 0
        ) AS filled_fields,
        COALESCE(
          (SELECT COUNT(DISTINCT i.item_id)
           FROM item i
           INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
           WHERE igm.crf_version_id = COALESCE(ec.crf_version_id, edc.default_version_id)), 0
        ) AS total_fields
      FROM event_definition_crf edc
      INNER JOIN crf c ON edc.crf_id = c.crf_id
      LEFT JOIN crf_version cv_def ON edc.default_version_id = cv_def.crf_version_id
      -- Join patient's form instances for THIS visit
      LEFT JOIN event_crf ec
        ON ec.study_event_id = $1
        AND ec.crf_version_id IN (
          SELECT cv2.crf_version_id FROM crf_version cv2 WHERE cv2.crf_id = edc.crf_id
        )
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      WHERE edc.study_event_definition_id = (SELECT study_event_definition_id FROM visit_info)
        AND edc.status_id = 1
        AND c.status_id NOT IN (5, 6, 7)
      ORDER BY edc.ordinal, c.name
    `;

    const result = await pool.query(query, [studyEventId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get visit forms error', { error: error.message, studyEventId });
    throw error;
  }
};

/**
 * Schedule subject event (via SOAP for GxP compliance, with direct SQL fallback)
 */
export const scheduleSubjectEvent = async (
  data: ScheduleEventRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Scheduling subject event', { data, userId });

  try {
    // Get study ID from subject
    const subjectQuery = `SELECT study_id, oc_oid as subject_oid FROM study_subject WHERE study_subject_id = $1`;
    const subjectResult = await pool.query(subjectQuery, [data.studySubjectId]);
    
    if (subjectResult.rows.length === 0) {
      return {
        success: false,
        message: 'Subject not found'
      };
    }

    const studyId = subjectResult.rows[0].study_id;

    // Try SOAP service first for GxP-compliant event scheduling
    try {
      const result = await eventSoap.scheduleEvent({
        studyId,
        subjectId: data.studySubjectId,
        studyEventDefinitionId: data.studyEventDefinitionId,
        startDate: data.startDate,
        endDate: data.endDate,
        location: data.location
      }, userId, username);
      
      if (result.success) {
        return result;
      }
      logger.warn('SOAP scheduling failed, falling back to direct SQL', { error: result.message });
    } catch (soapError: any) {
      logger.warn('SOAP service unavailable, using direct SQL fallback', { error: soapError.message });
    }

    // Direct SQL fallback for development/testing when SOAP is not available
    logger.info('Using direct SQL to schedule event');
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if event definition exists and get study_id
      const eventDefQuery = `SELECT study_event_definition_id, study_id, oc_oid, repeating FROM study_event_definition WHERE study_event_definition_id = $1`;
      const eventDefResult = await client.query(eventDefQuery, [data.studyEventDefinitionId]);
      
      if (eventDefResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: 'Event definition not found'
        };
      }

      const eventDef = eventDefResult.rows[0];

      // Get the next sample_ordinal for repeating events
      let sampleOrdinal = 1;
      if (eventDef.repeating) {
        const ordinalQuery = `
          SELECT COALESCE(MAX(sample_ordinal), 0) + 1 as next_ordinal
          FROM study_event
          WHERE study_subject_id = $1 AND study_event_definition_id = $2
        `;
        const ordinalResult = await client.query(ordinalQuery, [data.studySubjectId, data.studyEventDefinitionId]);
        sampleOrdinal = ordinalResult.rows[0].next_ordinal;
      }

      // Insert study_event record
      const insertQuery = `
        INSERT INTO study_event (
          study_subject_id, study_event_definition_id, location,
          sample_ordinal, date_start, date_end, owner_id, status_id,
          date_created, subject_event_status_id, start_time_flag,
          end_time_flag, scheduled_date, is_unscheduled
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 1, NOW(), $8, false, false, $9, $10
        )
        RETURNING study_event_id
      `;

      const startDate = data.startDate ? new Date(data.startDate) : new Date();
      const endDate = data.endDate ? new Date(data.endDate) : null;
      const scheduledDate = data.scheduledDate ? new Date(data.scheduledDate) : (data.isUnscheduled ? startDate : null);
      const isUnscheduled = data.isUnscheduled || false;
      // Unscheduled visits start as 'not_scheduled' (2) until data entry begins
      const subjectEventStatusId = isUnscheduled ? 2 : 1;

      const insertResult = await client.query(insertQuery, [
        data.studySubjectId,
        data.studyEventDefinitionId,
        data.location || '',
        sampleOrdinal,
        startDate,
        endDate,
        userId,
        subjectEventStatusId,
        scheduledDate,
        isUnscheduled
      ]);

      const studyEventId = insertResult.rows[0].study_event_id;

      // Create event_crf records for all CRFs assigned to this event definition
      // These are the editable copies of form templates for this patient's phase
      const crfAssignmentQuery = `
        SELECT edc.crf_id, edc.default_version_id, cv.crf_version_id, c.name as crf_name
        FROM event_definition_crf edc
        LEFT JOIN crf_version cv ON cv.crf_version_id = edc.default_version_id
        LEFT JOIN crf c ON edc.crf_id = c.crf_id
        WHERE edc.study_event_definition_id = $1 AND edc.status_id = 1
        ORDER BY edc.ordinal
      `;
      const crfAssignments = await client.query(crfAssignmentQuery, [data.studyEventDefinitionId]);

      if (crfAssignments.rows.length === 0) {
        logger.warn('No CRFs assigned to this event definition', { 
          studyEventDefinitionId: data.studyEventDefinitionId 
        });
      }

      let createdCrfCount = 0;
      for (const crf of crfAssignments.rows) {
        let crfVersionId = crf.crf_version_id || crf.default_version_id;
        if (!crfVersionId) {
          const latestVersionQuery = `
            SELECT crf_version_id FROM crf_version
            WHERE crf_id = $1 AND status_id = 1
            ORDER BY crf_version_id DESC LIMIT 1
          `;
          const latestVersion = await client.query(latestVersionQuery, [crf.crf_id]);
          if (latestVersion.rows.length > 0) {
            crfVersionId = latestVersion.rows[0].crf_version_id;
          } else {
            logger.warn('No CRF version found for CRF', { crfId: crf.crf_id, crfName: crf.crf_name });
          }
        }

        if (crfVersionId) {
          const insertEventCrfQuery = `
            INSERT INTO event_crf (
              study_event_id, crf_version_id, study_subject_id,
              status_id, owner_id, date_created, completion_status_id, sdv_status
            ) VALUES ($1, $2, $3, 1, $4, NOW(), 1, false)
            RETURNING event_crf_id
          `;
          const ecResult = await client.query(insertEventCrfQuery, [
            studyEventId, crfVersionId, data.studySubjectId, userId
          ]);
          const eventCrfId = ecResult.rows[0].event_crf_id;
          createdCrfCount++;

          // Create patient_event_form snapshot (frozen copy of form structure).
          // This is MANDATORY — every patient must have their own copy of each
          // form. If snapshot creation fails the entire event scheduling must
          // roll back so we never end up with event_crf records that have no
          // corresponding patient_event_form snapshot.
          await createPatientFormSnapshot(
            client, studyEventId, eventCrfId, crf.crf_id, crfVersionId,
            data.studySubjectId, crf.crf_name, createdCrfCount, userId
          );

          logger.debug('Created event_crf + snapshot for patient phase', {
            studyEventId, crfId: crf.crf_id, crfName: crf.crf_name,
            eventCrfId, studySubjectId: data.studySubjectId
          });
        }
      }
      
      logger.info('Event CRFs created for scheduled event', {
        studyEventId,
        studySubjectId: data.studySubjectId,
        crfAssignmentsFound: crfAssignments.rows.length,
        crfsCreated: createdCrfCount
      });

      // Log audit trail
      await client.query(`
        INSERT INTO audit_log_event (
          audit_id, audit_log_event_type_id, audit_date, user_id,
          audit_table, entity_id, entity_name, old_value, new_value
        ) VALUES (
          nextval('audit_log_event_audit_id_seq'), 31, NOW(), $1,
          'study_event', $2, 'Event Scheduled', NULL, $3
        )
      `, [userId, studyEventId, `Scheduled event ${eventDef.oc_oid} for subject`]);

      await client.query('COMMIT');

      logger.info('Event scheduled successfully via direct SQL', { studyEventId });

      return {
        success: true,
        data: {
          studyEventId,
          study_event_id: studyEventId,
          studySubjectId: data.studySubjectId,
          studyEventDefinitionId: data.studyEventDefinitionId,
          startDate: startDate.toISOString(),
          date_start: startDate.toISOString(),
          scheduled_date: scheduledDate ? scheduledDate.toISOString() : null,
          is_unscheduled: isUnscheduled,
          location: data.location
        },
        message: 'Event scheduled successfully'
      };
    } catch (dbError: any) {
      await client.query('ROLLBACK');
      logger.error('Direct SQL event scheduling failed', { error: dbError.message });
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error: any) {
    logger.error('Schedule subject event error', { error: error.message });
    return {
      success: false,
      message: `Failed to schedule event: ${error.message}`
    };
  }
};

/**
 * Create study event definition
 */
export const createStudyEvent = async (
  data: CreateEventRequest,
  userId: number
): Promise<{ success: boolean; eventDefinitionId?: number; message?: string }> => {
  logger.info('Creating study event', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Auto-calculate ordinal if not provided
    let ordinal = data.ordinal;
    if (!ordinal) {
      const maxOrdinalResult = await client.query(
        `SELECT COALESCE(MAX(ordinal), 0) + 1 as next_ordinal 
         FROM study_event_definition WHERE study_id = $1`,
        [data.studyId]
      );
      ordinal = maxOrdinalResult.rows[0]?.next_ordinal || 1;
    }

    // Generate OC OID
    const ocOid = `SE_${data.studyId}_${data.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Insert study event definition with visit window fields
    const insertQuery = `
      INSERT INTO study_event_definition (
        study_id, name, description, ordinal, type, repeating, category,
        schedule_day, min_day, max_day, reference_event_id,
        status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, NOW(), $13
      )
      RETURNING study_event_definition_id
    `;

    const insertResult = await client.query(insertQuery, [
      data.studyId,
      data.name,
      data.description || '',
      ordinal,
      data.type || 'scheduled',
      data.repeating || false,
      data.category || 'Study Event',
      data.scheduleDay ?? null,
      data.minDay ?? null,
      data.maxDay ?? null,
      data.referenceEventId ?? null,
      userId,
      ocOid
    ]);

    const eventDefinitionId = insertResult.rows[0].study_event_definition_id;

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_event_definition', $1, $2, 'Study Event', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1)
      )
    `, [userId, eventDefinitionId, data.name]);

    await client.query('COMMIT');

    logger.info('Study event created successfully', { eventDefinitionId, name: data.name });

    return {
      success: true,
      eventDefinitionId,
      message: 'Study event created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create study event error', { error: error.message, data });

    return {
      success: false,
      message: `Failed to create study event: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update study event definition
 */
export const updateStudyEvent = async (
  eventDefinitionId: number,
  data: UpdateEventRequest,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating study event', { eventDefinitionId, userId });

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
      updates.push(`description = $${paramIndex++}`);
      params.push(data.description);
    }

    if (data.ordinal !== undefined) {
      updates.push(`ordinal = $${paramIndex++}`);
      params.push(data.ordinal);
    }

    if (data.type !== undefined) {
      updates.push(`type = $${paramIndex++}`);
      params.push(data.type);
    }

    if (data.repeating !== undefined) {
      updates.push(`repeating = $${paramIndex++}`);
      params.push(data.repeating);
    }

    if (data.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      params.push(data.category);
    }

    if (data.scheduleDay !== undefined) {
      updates.push(`schedule_day = $${paramIndex++}`);
      params.push(data.scheduleDay);
    }

    if (data.minDay !== undefined) {
      updates.push(`min_day = $${paramIndex++}`);
      params.push(data.minDay);
    }

    if (data.maxDay !== undefined) {
      updates.push(`max_day = $${paramIndex++}`);
      params.push(data.maxDay);
    }

    if (data.referenceEventId !== undefined) {
      updates.push(`reference_event_id = $${paramIndex++}`);
      params.push(data.referenceEventId);
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

    params.push(eventDefinitionId);

    const updateQuery = `
      UPDATE study_event_definition
      SET ${updates.join(', ')}
      WHERE study_event_definition_id = $${paramIndex}
    `;

    await client.query(updateQuery, params);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_event_definition', $1, $2, 'Study Event',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, eventDefinitionId]);

    await client.query('COMMIT');

    logger.info('Study event updated successfully', { eventDefinitionId });

    return {
      success: true,
      message: 'Study event updated successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update study event error', { error: error.message, eventDefinitionId });

    return {
      success: false,
      message: `Failed to update study event: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Delete study event definition (set status to removed)
 */
export const deleteStudyEvent = async (
  eventDefinitionId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting study event', { eventDefinitionId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if event has scheduled instances
    const instancesQuery = `SELECT COUNT(*) as count FROM study_event WHERE study_event_definition_id = $1`;
    const instancesResult = await client.query(instancesQuery, [eventDefinitionId]);

    if (parseInt(instancesResult.rows[0].count) > 0) {
      return {
        success: false,
        message: 'Cannot delete event with scheduled instances. Set status to removed instead.'
      };
    }

    // Soft delete (set status to removed = 5)
    await client.query(`
      UPDATE study_event_definition
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE study_event_definition_id = $2
    `, [userId, eventDefinitionId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_event_definition', $1, $2, 'Study Event',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, eventDefinitionId]);

    await client.query('COMMIT');

    logger.info('Study event deleted successfully', { eventDefinitionId });

    return {
      success: true,
      message: 'Study event deleted successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Delete study event error', { error: error.message, eventDefinitionId });

    return {
      success: false,
      message: `Failed to delete study event: ${error.message}`
    };
  } finally {
    client.release();
  }
};

// ============================================
// EVENT CRF ASSIGNMENT (event_definition_crf)
// ============================================

/**
 * Get CRFs available to assign to an event, filtered by study and organization.
 * Only returns forms belonging to the specified study (via source_study_id)
 * that are not already assigned to this event definition, not archived/removed,
 * and owned by members of the caller's organization.
 */
export const getAvailableCrfsForEvent = async (
  studyId: number,
  eventDefinitionId: number,
  callerUserId?: number
): Promise<any[]> => {
  logger.info('Getting available CRFs for event', { studyId, eventDefinitionId, callerUserId });

  try {
    // Build visibility filter: show CRFs the user should have access to
    // A CRF is visible if ANY of:
    //   a) source_study_id matches the current study
    //   b) source_study_id is NULL (shared/unlinked CRF)
    //   c) CRF is owned by someone in the user's organization
    let visibilityFilter = `(c.source_study_id = $1 OR c.source_study_id IS NULL)`;
    const params: any[] = [studyId];
    let paramIndex = 2;

    if (callerUserId) {
      const orgCheck = await pool.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active'`,
        [callerUserId]
      );
      const userOrgIds = orgCheck.rows.map((r: any) => r.organization_id);

      if (userOrgIds.length > 0) {
        params.push(userOrgIds);
        // Add org ownership as a THIRD option in the OR chain
        visibilityFilter = `(
          c.source_study_id = $1 
          OR c.source_study_id IS NULL 
          OR c.owner_id IN (
            SELECT m.user_id FROM acc_organization_member m
            WHERE m.organization_id = ANY($${paramIndex++}::int[]) AND m.status = 'active'
          )
        )`;
      }
    }

    // Find CRFs that can be assigned to this event:
    // 1. CRF is active (not deleted)
    // 2. CRF is visible to the user (study match, or shared, or org member owns it)
    // 3. CRF is not already assigned to this event
    // 4. CRF has at least one active version
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        c.status_id,
        s.name as status_name,
        c.source_study_id,
        cv.crf_version_id as latest_version_id,
        cv.name as latest_version_name,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id AND status_id NOT IN (5, 7)) as version_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN (
        SELECT DISTINCT ON (crf_id) crf_id, crf_version_id, name
        FROM crf_version
        WHERE status_id NOT IN (5, 7)
        ORDER BY crf_id, crf_version_id DESC
      ) cv ON c.crf_id = cv.crf_id
      WHERE c.status_id IN (1, 2)
        AND ${visibilityFilter}
        AND EXISTS (SELECT 1 FROM crf_version v WHERE v.crf_id = c.crf_id AND v.status_id NOT IN (5, 7))
      ORDER BY c.name
    `;

    const result = await pool.query(query, params);
    logger.info('Available CRFs for event', { 
      studyId, eventDefinitionId, count: result.rows.length,
      crfNames: result.rows.map((r: any) => r.name)
    });
    return result.rows;
  } catch (error: any) {
    logger.error('Get available CRFs error', { error: error.message });
    throw error;
  }
};

/**
 * Assign a CRF (template) to a study event (phase)
 */
export const assignCrfToEvent = async (
  data: AssignCrfToEventRequest & { studyEventDefinitionId: number },
  userId: number
): Promise<{ success: boolean; eventDefinitionCrfId?: number; message?: string }> => {
  logger.info('Assigning CRF to event', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Allow the same CRF to be assigned multiple times to the same event
    // (each assignment gets its own event_definition_crf_id and ordinal)

    // Get study ID from event definition
    const studyQuery = `SELECT study_id FROM study_event_definition WHERE study_event_definition_id = $1`;
    const studyResult = await client.query(studyQuery, [data.studyEventDefinitionId]);
    
    if (studyResult.rows.length === 0) {
      return {
        success: false,
        message: 'Study event definition not found'
      };
    }
    const studyId = studyResult.rows[0].study_id;

    // Get default version if not specified
    let defaultVersionId = data.crfVersionId;
    if (!defaultVersionId) {
      const versionQuery = `
        SELECT crf_version_id FROM crf_version 
        WHERE crf_id = $1 AND status_id = 1 
        ORDER BY crf_version_id DESC LIMIT 1
      `;
      const versionResult = await client.query(versionQuery, [data.crfId]);
      if (versionResult.rows.length > 0) {
        defaultVersionId = versionResult.rows[0].crf_version_id;
      }
    }

    // Calculate ordinal if not provided
    let ordinal = data.ordinal;
    if (ordinal === undefined) {
      const maxOrdinalQuery = `
        SELECT COALESCE(MAX(ordinal), 0) + 1 as next_ordinal 
        FROM event_definition_crf 
        WHERE study_event_definition_id = $1 AND status_id = 1
      `;
      const maxResult = await client.query(maxOrdinalQuery, [data.studyEventDefinitionId]);
      ordinal = maxResult.rows[0].next_ordinal;
    }

    // Insert event_definition_crf
    const insertQuery = `
      INSERT INTO event_definition_crf (
        study_event_definition_id, study_id, crf_id, required_crf, 
        double_entry, hide_crf, ordinal, status_id, owner_id, 
        date_created, default_version_id, electronic_signature
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9, $10
      )
      RETURNING event_definition_crf_id
    `;

    const insertResult = await client.query(insertQuery, [
      data.studyEventDefinitionId,
      studyId,
      data.crfId,
      data.required ?? false,
      data.doubleEntry ?? false,
      data.hideCrf ?? false,
      ordinal,
      userId,
      defaultVersionId,
      data.electronicSignature ?? false
    ]);

    const eventDefinitionCrfId = insertResult.rows[0].event_definition_crf_id;

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'event_definition_crf', $1, $2, 'Event CRF Assignment', 
        $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1)
      )
    `, [userId, eventDefinitionCrfId, `CRF ${data.crfId} assigned to event ${data.studyEventDefinitionId}`]);

    await client.query('COMMIT');

    logger.info('CRF assigned to event successfully', { eventDefinitionCrfId });

    return {
      success: true,
      eventDefinitionCrfId,
      message: 'CRF assigned to event successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Assign CRF to event error', { error: error.message, data });

    return {
      success: false,
      message: `Failed to assign CRF to event: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update CRF settings for an event
 */
export const updateEventCrf = async (
  eventDefinitionCrfId: number,
  data: {
    required?: boolean;
    doubleEntry?: boolean;
    hideCrf?: boolean;
    ordinal?: number;
    defaultVersionId?: number;
    electronicSignature?: boolean;
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating event CRF', { eventDefinitionCrfId, data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.required !== undefined) {
      updates.push(`required_crf = $${paramIndex++}`);
      params.push(data.required);
    }

    if (data.doubleEntry !== undefined) {
      updates.push(`double_entry = $${paramIndex++}`);
      params.push(data.doubleEntry);
    }

    if (data.hideCrf !== undefined) {
      updates.push(`hide_crf = $${paramIndex++}`);
      params.push(data.hideCrf);
    }

    if (data.ordinal !== undefined) {
      updates.push(`ordinal = $${paramIndex++}`);
      params.push(data.ordinal);
    }

    if (data.defaultVersionId !== undefined) {
      updates.push(`default_version_id = $${paramIndex++}`);
      params.push(data.defaultVersionId);
    }

    if (data.electronicSignature !== undefined) {
      updates.push(`electronic_signature = $${paramIndex++}`);
      params.push(data.electronicSignature);
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

    params.push(eventDefinitionCrfId);

    const updateQuery = `
      UPDATE event_definition_crf
      SET ${updates.join(', ')}
      WHERE event_definition_crf_id = $${paramIndex}
    `;

    await client.query(updateQuery, params);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'event_definition_crf', $1, $2, 'Event CRF Assignment',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, eventDefinitionCrfId]);

    await client.query('COMMIT');

    logger.info('Event CRF updated successfully', { eventDefinitionCrfId });

    return {
      success: true,
      message: 'Event CRF updated successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update event CRF error', { error: error.message, eventDefinitionCrfId });

    return {
      success: false,
      message: `Failed to update event CRF: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Remove CRF from event (soft delete)
 */
export const removeCrfFromEvent = async (
  eventDefinitionCrfId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Removing CRF from event', { eventDefinitionCrfId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if there are any event_crf records using this
    const usageQuery = `
      SELECT COUNT(*) as count 
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN event_definition_crf edc ON cv.crf_id = edc.crf_id 
        AND edc.event_definition_crf_id = $1
    `;
    const usageResult = await client.query(usageQuery, [eventDefinitionCrfId]);

    if (parseInt(usageResult.rows[0].count) > 0) {
      // Soft delete (set status to removed = 5)
      await client.query(`
        UPDATE event_definition_crf
        SET status_id = 5, date_updated = NOW(), update_id = $1
        WHERE event_definition_crf_id = $2
      `, [userId, eventDefinitionCrfId]);

      logger.info('Event CRF soft deleted (has usage)', { eventDefinitionCrfId });
    } else {
      // Hard delete if no usage
      await client.query(`
        DELETE FROM event_definition_crf WHERE event_definition_crf_id = $1
      `, [eventDefinitionCrfId]);

      logger.info('Event CRF hard deleted (no usage)', { eventDefinitionCrfId });
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'event_definition_crf', $1, $2, 'Event CRF Assignment',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Deleted' LIMIT 1)
      )
    `, [userId, eventDefinitionCrfId]);

    await client.query('COMMIT');

    return {
      success: true,
      message: 'CRF removed from event successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Remove CRF from event error', { error: error.message, eventDefinitionCrfId });

    return {
      success: false,
      message: `Failed to remove CRF from event: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Reorder CRFs within an event
 */
export const reorderEventCrfs = async (
  studyEventDefinitionId: number,
  orderedCrfIds: number[],
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Reordering event CRFs', { studyEventDefinitionId, orderedCrfIds, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update ordinal for each CRF
    for (let i = 0; i < orderedCrfIds.length; i++) {
      await client.query(`
        UPDATE event_definition_crf
        SET ordinal = $1, date_updated = NOW(), update_id = $2
        WHERE event_definition_crf_id = $3
      `, [i + 1, userId, orderedCrfIds[i]]);
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'event_definition_crf', $1, $2, 'Event CRF Reorder',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [userId, studyEventDefinitionId]);

    await client.query('COMMIT');

    logger.info('Event CRFs reordered successfully', { studyEventDefinitionId });

    return {
      success: true,
      message: 'CRFs reordered successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Reorder event CRFs error', { error: error.message, studyEventDefinitionId });

    return {
      success: false,
      message: `Failed to reorder CRFs: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Bulk assign multiple CRFs to an event
 */
export const bulkAssignCrfsToEvent = async (
  studyEventDefinitionId: number,
  crfAssignments: Array<{
    crfId: number;
    required?: boolean;
    ordinal?: number;
  }>,
  userId: number
): Promise<{ success: boolean; assignedCount?: number; message?: string }> => {
  logger.info('Bulk assigning CRFs to event', { studyEventDefinitionId, count: crfAssignments.length, userId });

  let assignedCount = 0;

  for (const assignment of crfAssignments) {
    const result = await assignCrfToEvent(
      {
        studyEventDefinitionId,
        crfId: assignment.crfId,
        required: assignment.required,
        ordinal: assignment.ordinal
      },
      userId
    );

    if (result.success) {
      assignedCount++;
    }
  }

  return {
    success: assignedCount > 0,
    assignedCount,
    message: `${assignedCount} of ${crfAssignments.length} CRFs assigned successfully`
  };
};

/**
 * Create a frozen JSONB snapshot of a form's structure for a patient visit.
 *
 * Uses getFormMetadata() as the SINGLE SOURCE OF TRUTH so the snapshot stores
 * the exact same field objects that the /api/forms/:id/metadata endpoint returns.
 * This ensures the frontend FormField DTOs work identically whether a form is
 * loaded from a shared template or from a patient-specific snapshot.
 */
const createPatientFormSnapshot = async (
  client: any,
  studyEventId: number,
  eventCrfId: number,
  crfId: number,
  crfVersionId: number,
  studySubjectId: number,
  formName: string,
  ordinal: number,
  userId: number
): Promise<number> => {
  // Reuse getFormMetadata — the same function the /api/forms/:id/metadata
  // endpoint calls. This returns items in the full DTO format (60+ properties)
  // including type, showWhen, tableColumns, calculationFormula, unit, etc.
  const metadata = await getFormMetadata(crfId);

  if (!metadata || !metadata.items || metadata.items.length === 0) {
    logger.warn('getFormMetadata returned no items for snapshot', { crfId, crfVersionId });
  }

  const fields = metadata?.items || [];

  const formStructure = {
    crfId,
    crfVersionId,
    name: formName,
    snapshotDate: new Date().toISOString(),
    fieldCount: fields.length,
    fields
  };

  const insertQuery = `
    INSERT INTO patient_event_form (
      study_event_id, event_crf_id, crf_id, crf_version_id,
      study_subject_id, form_name, form_structure, form_data,
      completion_status, ordinal, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, '{}'::jsonb, 'not_started', $8, $9)
    RETURNING patient_event_form_id
  `;
  const result = await client.query(insertQuery, [
    studyEventId, eventCrfId, crfId, crfVersionId,
    studySubjectId, formName, JSON.stringify(formStructure),
    ordinal, userId
  ]);

  logger.info('Patient form snapshot created', {
    patientEventFormId: result.rows[0].patient_event_form_id,
    studyEventId, crfId, fieldCount: fields.length
  });

  return result.rows[0].patient_event_form_id;
};

/**
 * Assign a form to a specific patient visit instance (not the template).
 * Creates event_crf + patient_event_form for that patient's visit.
 */
export const assignFormToPatientVisit = async (
  studyEventId: number,
  crfId: number,
  studySubjectId: number,
  userId: number
): Promise<{ success: boolean; eventCrfId?: number; patientEventFormId?: number; message?: string }> => {
  logger.info('Assigning form to patient visit', { studyEventId, crfId, studySubjectId });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get latest CRF version
    const versionQuery = `
      SELECT cv.crf_version_id, c.name as crf_name
      FROM crf_version cv
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      WHERE cv.crf_id = $1 AND cv.status_id IN (1, 2)
      ORDER BY cv.crf_version_id DESC LIMIT 1
    `;
    const versionResult = await client.query(versionQuery, [crfId]);
    if (versionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'No active version found for this form' };
    }
    const crfVersionId = versionResult.rows[0].crf_version_id;
    const crfName = versionResult.rows[0].crf_name;

    // Check if this form is already assigned to this patient's visit
    const existsCheck = await client.query(
      `SELECT event_crf_id FROM event_crf WHERE study_event_id = $1 AND crf_version_id = $2 AND study_subject_id = $3`,
      [studyEventId, crfVersionId, studySubjectId]
    );
    if (existsCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: `Form "${crfName}" is already assigned to this visit` };
    }

    // Create event_crf record
    const insertEventCrf = `
      INSERT INTO event_crf (
        study_event_id, crf_version_id, study_subject_id,
        status_id, owner_id, date_created, completion_status_id, sdv_status
      ) VALUES ($1, $2, $3, 1, $4, NOW(), 1, false)
      RETURNING event_crf_id
    `;
    const ecResult = await client.query(insertEventCrf, [studyEventId, crfVersionId, studySubjectId, userId]);
    const eventCrfId = ecResult.rows[0].event_crf_id;

    // Get ordinal
    const ordResult = await client.query(
      `SELECT COALESCE(MAX(ordinal), 0) + 1 as next FROM patient_event_form WHERE study_event_id = $1`,
      [studyEventId]
    );
    const ordinal = ordResult.rows[0].next;

    // Create snapshot — MANDATORY. Every patient form must have its own
    // frozen copy. If this fails the transaction rolls back entirely.
    const patientEventFormId = await createPatientFormSnapshot(
      client, studyEventId, eventCrfId, crfId, crfVersionId,
      studySubjectId, crfName, ordinal, userId
    );

    await client.query('COMMIT');

    return { success: true, eventCrfId, patientEventFormId, message: 'Form assigned to patient visit' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Assign form to patient visit error', { error: error.message });
    return { success: false, message: `Failed: ${error.message}` };
  } finally {
    client.release();
  }
};

/**
 * Create an unscheduled visit on the fly for a patient.
 * Creates a study_event_definition (if name doesn't exist) + study_event + event_crfs.
 */
export const createUnscheduledVisit = async (
  data: CreateUnscheduledVisitRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating unscheduled visit', { data, userId });

  const visitName = data.name || 'Unscheduled Visit';

  try {
    // Validate study exists
    const studyCheck = await pool.query(`SELECT study_id FROM study WHERE study_id = $1`, [data.studyId]);
    if (studyCheck.rows.length === 0) {
      return { success: false, message: `Study ${data.studyId} not found` };
    }

    // Validate subject exists and belongs to study
    const subjectCheck = await pool.query(
      `SELECT study_subject_id FROM study_subject WHERE study_subject_id = $1 AND study_id = $2`,
      [data.studySubjectId, data.studyId]
    );
    if (subjectCheck.rows.length === 0) {
      return { success: false, message: `Subject ${data.studySubjectId} not found in study ${data.studyId}` };
    }

    // Ensure required status records exist (seed data)
    await pool.query(`
      INSERT INTO subject_event_status (subject_event_status_id, name, description)
      VALUES (1, 'scheduled', 'Event is scheduled'),
             (2, 'not_scheduled', 'Event is not yet scheduled'),
             (3, 'data_entry_started', 'Data entry has started'),
             (4, 'completed', 'Event is completed')
      ON CONFLICT (subject_event_status_id) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO completion_status (completion_status_id, status_id, name)
      VALUES (1, 1, 'not_started')
      ON CONFLICT (completion_status_id) DO NOTHING
    `);

    // Check if an unscheduled event definition with this name already exists
    let eventDefId: number;
    const existsResult = await pool.query(`
      SELECT study_event_definition_id FROM study_event_definition
      WHERE study_id = $1 AND name = $2 AND type = 'unscheduled' AND status_id = 1
    `, [data.studyId, visitName]);

    if (existsResult.rows.length > 0) {
      eventDefId = existsResult.rows[0].study_event_definition_id;
    } else {
      // Create the event definition and assign CRFs in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const maxOrd = await client.query(
          `SELECT COALESCE(MAX(ordinal), 0) + 1 as next FROM study_event_definition WHERE study_id = $1`,
          [data.studyId]
        );
        const ocOid = `SE_${data.studyId}_UNSCHED_${Date.now()}`;
        const insertDef = await client.query(`
          INSERT INTO study_event_definition (
            study_id, name, description, ordinal, type, repeating, category,
            status_id, owner_id, date_created, oc_oid
          ) VALUES ($1, $2, $3, $4, 'unscheduled', true, 'Unscheduled', 1, $5, NOW(), $6)
          RETURNING study_event_definition_id
        `, [data.studyId, visitName, data.description || '', maxOrd.rows[0].next, userId, ocOid]);
        eventDefId = insertDef.rows[0].study_event_definition_id;

        // Assign selected CRFs to the definition
        if (data.crfIds && data.crfIds.length > 0) {
          for (let i = 0; i < data.crfIds.length; i++) {
            const crfId = data.crfIds[i];
            // Validate CRF exists
            const crfCheck = await client.query(`SELECT crf_id FROM crf WHERE crf_id = $1 AND status_id NOT IN (5,7)`, [crfId]);
            if (crfCheck.rows.length === 0) {
              throw new Error(`CRF ${crfId} not found or is inactive`);
            }
            const versionQ = await client.query(
              `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 AND status_id = 1 ORDER BY crf_version_id DESC LIMIT 1`,
              [crfId]
            );
            const defVersionId = versionQ.rows[0]?.crf_version_id || null;
            await client.query(`
              INSERT INTO event_definition_crf (
                study_event_definition_id, study_id, crf_id, required_crf,
                double_entry, hide_crf, ordinal, status_id, owner_id, date_created, default_version_id
              ) VALUES ($1, $2, $3, false, false, false, $4, 1, $5, NOW(), $6)
            `, [eventDefId, data.studyId, crfId, i + 1, userId, defVersionId]);
          }
        }

        await client.query('COMMIT');
      } catch (txErr: any) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    // Schedule the event for the patient (separate transaction inside scheduleSubjectEvent)
    const scheduleResult = await scheduleSubjectEvent({
      studySubjectId: data.studySubjectId,
      studyEventDefinitionId: eventDefId,
      startDate: data.startDate || new Date().toISOString(),
      endDate: data.endDate,
      isUnscheduled: true,
      scheduledDate: data.startDate || new Date().toISOString()
    }, userId, username);

    return scheduleResult;
  } catch (error: any) {
    logger.error('Create unscheduled visit error', { error: error.message });
    return { success: false, message: `Failed to create unscheduled visit: ${error.message}` };
  }
};

/**
 * Get patient_event_form records for a specific study_event (visit instance).
 * Returns the frozen form snapshots with patient data.
 */
export const getPatientFormSnapshots = async (studyEventId: number): Promise<any[]> => {
  try {
    const query = `
      SELECT 
        pef.patient_event_form_id,
        pef.study_event_id,
        pef.event_crf_id,
        pef.crf_id,
        pef.crf_version_id,
        pef.study_subject_id,
        pef.form_name,
        pef.form_structure,
        pef.form_data,
        pef.completion_status,
        pef.is_locked,
        pef.is_frozen,
        pef.sdv_status,
        pef.ordinal,
        pef.date_created,
        pef.date_updated
      FROM patient_event_form pef
      WHERE pef.study_event_id = $1
      ORDER BY pef.ordinal, pef.date_created
    `;
    const result = await pool.query(query, [studyEventId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get patient form snapshots error', { error: error.message });
    return [];
  }
};

/**
 * Save patient form data to the patient_event_form snapshot.
 */
export const savePatientFormData = async (
  patientEventFormId: number,
  formData: Record<string, any>,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    await pool.query(`
      UPDATE patient_event_form
      SET form_data = $1::jsonb,
          completion_status = CASE WHEN $1::jsonb = '{}'::jsonb THEN 'not_started' ELSE 'in_progress' END,
          date_updated = NOW(),
          updated_by = $2
      WHERE patient_event_form_id = $3
    `, [JSON.stringify(formData), userId, patientEventFormId]);

    return { success: true, message: 'Form data saved' };
  } catch (error: any) {
    logger.error('Save patient form data error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Verification / Test Queries
// ============================================================================

/**
 * Compare study source-of-truth (event_definition_crf) with patient copies
 * (event_crf + patient_event_form) for a given subject.
 *
 * Returns:
 *  - sourceOfTruth: forms defined at the study level
 *  - patientCopies: per-patient event_crf + snapshot records
 *  - mismatches: any missing snapshots or orphan records
 */
export const verifyPatientFormIntegrity = async (
  studySubjectId: number
): Promise<any> => {
  logger.info('Running patient form integrity check', { studySubjectId });

  try {
    // 1. Study Source of Truth: event definitions → assigned CRFs
    const sourceQuery = `
      SELECT
        sed.study_event_definition_id,
        sed.name        AS event_name,
        sed.ordinal     AS event_ordinal,
        edc.event_definition_crf_id,
        edc.crf_id,
        c.name          AS crf_name,
        edc.required_crf,
        edc.ordinal     AS crf_ordinal,
        edc.default_version_id,
        cv.name         AS default_version_name,
        (SELECT COUNT(*) FROM item i
         INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
         WHERE igm.crf_version_id = COALESCE(edc.default_version_id,
           (SELECT crf_version_id FROM crf_version WHERE crf_id = edc.crf_id
            ORDER BY crf_version_id DESC LIMIT 1))
        ) AS field_count
      FROM study_event_definition sed
      INNER JOIN event_definition_crf edc ON edc.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN crf c ON edc.crf_id = c.crf_id
      LEFT JOIN crf_version cv ON edc.default_version_id = cv.crf_version_id
      WHERE sed.study_id = (SELECT study_id FROM study_subject WHERE study_subject_id = $1)
        AND edc.status_id NOT IN (5, 7)
        AND c.status_id  NOT IN (5, 7)
      ORDER BY sed.ordinal, edc.ordinal
    `;
    const sourceResult = await pool.query(sourceQuery, [studySubjectId]);

    // 2. Patient copies: study_event → event_crf → patient_event_form
    const patientQuery = `
      SELECT
        se.study_event_id,
        se.study_event_definition_id,
        sed.name        AS event_name,
        se.scheduled_date,
        sest.name       AS event_status,
        ec.event_crf_id,
        ec.crf_version_id,
        c.crf_id,
        c.name          AS crf_name,
        cv.name         AS version_name,
        COALESCE(cs.name, 'not_started') AS completion_status,
        pef.patient_event_form_id,
        pef.form_name   AS snapshot_name,
        pef.completion_status AS snapshot_status,
        CASE WHEN pef.form_structure IS NOT NULL
             THEN (pef.form_structure->>'fieldCount')::int
             ELSE NULL END AS snapshot_field_count,
        pef.date_created AS snapshot_created,
        (SELECT COUNT(*) FROM item_data id
         WHERE id.event_crf_id = ec.event_crf_id AND id.deleted = false
        ) AS data_items_entered
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      LEFT JOIN event_crf ec ON ec.study_event_id = se.study_event_id
      LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      LEFT JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN patient_event_form pef ON pef.event_crf_id = ec.event_crf_id
      WHERE se.study_subject_id = $1
      ORDER BY se.scheduled_date, sed.ordinal, ec.event_crf_id
    `;
    const patientResult = await pool.query(patientQuery, [studySubjectId]);

    // 3. Build mismatch report
    const mismatches: any[] = [];

    // Check event_crf records that lack a patient_event_form snapshot
    for (const row of patientResult.rows) {
      if (row.event_crf_id && !row.patient_event_form_id) {
        mismatches.push({
          type: 'missing_snapshot',
          eventCrfId: row.event_crf_id,
          crfName: row.crf_name,
          eventName: row.event_name,
          studyEventId: row.study_event_id,
          message: `event_crf ${row.event_crf_id} (${row.crf_name}) has no patient_event_form snapshot`
        });
      }
      if (row.patient_event_form_id && row.snapshot_field_count === 0) {
        mismatches.push({
          type: 'empty_snapshot',
          patientEventFormId: row.patient_event_form_id,
          crfName: row.crf_name,
          eventName: row.event_name,
          message: `Snapshot ${row.patient_event_form_id} for ${row.crf_name} has 0 fields`
        });
      }
    }

    // Check source forms that have no patient event_crf at all
    const patientEventDefIds = new Set(patientResult.rows.map((r: any) =>
      `${r.study_event_definition_id}_${r.crf_id}`
    ));
    // Build a set of event definitions the patient actually has events for
    const patientScheduledDefs = new Set(
      patientResult.rows.map((r: any) => r.study_event_definition_id)
    );
    for (const src of sourceResult.rows) {
      if (patientScheduledDefs.has(src.study_event_definition_id)
          && !patientEventDefIds.has(`${src.study_event_definition_id}_${src.crf_id}`)) {
        mismatches.push({
          type: 'missing_event_crf',
          eventName: src.event_name,
          crfName: src.crf_name,
          crfId: src.crf_id,
          message: `Study defines ${src.crf_name} for ${src.event_name} but patient has no event_crf record`
        });
      }
    }

    return {
      studySubjectId,
      sourceOfTruth: sourceResult.rows.map((r: any) => ({
        eventDefinitionId: r.study_event_definition_id,
        eventName: r.event_name,
        eventOrdinal: r.event_ordinal,
        crfId: r.crf_id,
        crfName: r.crf_name,
        required: r.required_crf,
        crfOrdinal: r.crf_ordinal,
        defaultVersionId: r.default_version_id,
        defaultVersionName: r.default_version_name,
        fieldCount: parseInt(r.field_count) || 0
      })),
      patientCopies: patientResult.rows.map((r: any) => ({
        studyEventId: r.study_event_id,
        eventDefinitionId: r.study_event_definition_id,
        eventName: r.event_name,
        scheduledDate: r.scheduled_date,
        eventStatus: r.event_status,
        eventCrfId: r.event_crf_id,
        crfId: r.crf_id,
        crfName: r.crf_name,
        versionName: r.version_name,
        completionStatus: r.completion_status,
        snapshotId: r.patient_event_form_id,
        snapshotName: r.snapshot_name,
        snapshotStatus: r.snapshot_status,
        snapshotFieldCount: r.snapshot_field_count,
        snapshotCreated: r.snapshot_created,
        dataItemsEntered: parseInt(r.data_items_entered) || 0
      })),
      mismatches,
      summary: {
        sourceFormAssignments: sourceResult.rows.length,
        patientFormCopies: patientResult.rows.filter((r: any) => r.event_crf_id).length,
        patientSnapshots: patientResult.rows.filter((r: any) => r.patient_event_form_id).length,
        mismatchCount: mismatches.length,
        healthy: mismatches.length === 0
      }
    };
  } catch (error: any) {
    logger.error('Form integrity check error', { error: error.message });
    throw error;
  }
};

/**
 * Repair missing patient_event_form snapshots.
 * For every event_crf that lacks a snapshot, creates one from the current template.
 */
export const repairMissingSnapshots = async (
  studySubjectId: number,
  userId: number
): Promise<{ repaired: number; errors: string[] }> => {
  logger.info('Repairing missing snapshots', { studySubjectId });

  const errors: string[] = [];
  let repaired = 0;

  try {
    // Find event_crf records without a patient_event_form
    const query = `
      SELECT
        ec.event_crf_id,
        ec.study_event_id,
        ec.crf_version_id,
        cv.crf_id,
        c.name AS crf_name,
        ec.study_subject_id
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN patient_event_form pef ON pef.event_crf_id = ec.event_crf_id
      WHERE se.study_subject_id = $1
        AND pef.patient_event_form_id IS NULL
        AND ec.status_id NOT IN (5, 7)
    `;
    const result = await pool.query(query, [studySubjectId]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let ordinal = 1;

      for (const row of result.rows) {
        try {
          await createPatientFormSnapshot(
            client,
            row.study_event_id,
            row.event_crf_id,
            row.crf_id,
            row.crf_version_id,
            row.study_subject_id,
            row.crf_name,
            ordinal++,
            userId
          );
          repaired++;
        } catch (snapErr: any) {
          errors.push(`Failed to create snapshot for event_crf ${row.event_crf_id}: ${snapErr.message}`);
        }
      }

      await client.query('COMMIT');
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    logger.info('Snapshot repair complete', { studySubjectId, repaired, errors: errors.length });
    return { repaired, errors };
  } catch (error: any) {
    logger.error('Snapshot repair error', { error: error.message });
    throw error;
  }
};

export default {
  getStudyEvents,
  getStudyEventById,
  getSubjectEvents,
  getEventCRFs,
  getPatientEventCRFs,
  getVisitForms,
  scheduleSubjectEvent,
  createStudyEvent,
  updateStudyEvent,
  deleteStudyEvent,
  // Event CRF assignment
  getAvailableCrfsForEvent,
  assignCrfToEvent,
  updateEventCrf,
  removeCrfFromEvent,
  reorderEventCrfs,
  bulkAssignCrfsToEvent,
  // Patient-specific visit/form operations
  assignFormToPatientVisit,
  createUnscheduledVisit,
  getPatientFormSnapshots,
  savePatientFormData,
  // Verification / repair
  verifyPatientFormIntegrity,
  repairMissingSnapshots
};

