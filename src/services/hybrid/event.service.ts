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
import { ApiResponse, PaginatedResponse } from '../../types';

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
        s.name as status_name,
        sed.oc_oid,
        (SELECT COUNT(*) FROM study_event se WHERE se.study_event_definition_id = sed.study_event_definition_id) as usage_count,
        (SELECT COUNT(*) FROM event_definition_crf edc WHERE edc.study_event_definition_id = sed.study_event_definition_id) as crf_count
      FROM study_event_definition sed
      INNER JOIN status s ON sed.status_id = s.status_id
      WHERE sed.study_id = $1
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
 * Schedule subject event (via SOAP for GxP compliance, with direct SQL fallback)
 */
export const scheduleSubjectEvent = async (
  data: {
    studySubjectId: number;
    studyEventDefinitionId: number;
    startDate?: string;
    endDate?: string;
    location?: string;
    scheduledDate?: string;
    isUnscheduled?: boolean;
  },
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
        // Get the latest CRF version if no default is set
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
            logger.warn('No CRF version found for CRF', { 
              crfId: crf.crf_id, 
              crfName: crf.crf_name 
            });
          }
        }

        if (crfVersionId) {
          // CRITICAL: Include study_subject_id for proper foreign key reference
          const insertEventCrfQuery = `
            INSERT INTO event_crf (
              study_event_id, crf_version_id, study_subject_id,
              status_id, owner_id, date_created, completion_status_id, sdv_status
            ) VALUES (
              $1, $2, $3, 1, $4, NOW(), 1, false
            )
          `;
          await client.query(insertEventCrfQuery, [
            studyEventId, 
            crfVersionId, 
            data.studySubjectId,  // Added: study_subject_id
            userId
          ]);
          createdCrfCount++;
          logger.debug('Created event_crf for patient phase', {
            studyEventId,
            crfId: crf.crf_id,
            crfName: crf.crf_name,
            studySubjectId: data.studySubjectId
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
  data: {
    studyId: number;
    name: string;
    description?: string;
    ordinal: number;
    type?: string;
    repeating?: boolean;
    category?: string;
  },
  userId: number
): Promise<{ success: boolean; eventDefinitionId?: number; message?: string }> => {
  logger.info('Creating study event', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate OC OID
    const ocOid = `SE_${data.studyId}_${data.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Insert study event definition
    const insertQuery = `
      INSERT INTO study_event_definition (
        study_id, name, description, ordinal, type, repeating, category,
        status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), $9
      )
      RETURNING study_event_definition_id
    `;

    const insertResult = await client.query(insertQuery, [
      data.studyId,
      data.name,
      data.description || '',
      data.ordinal,
      data.type || 'scheduled',
      data.repeating || false,
      data.category || 'Study Event',
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
  data: {
    name?: string;
    description?: string;
    ordinal?: number;
    type?: string;
    repeating?: boolean;
    category?: string;
  },
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
 * Get all CRFs available to assign to an event (for a study)
 */
export const getAvailableCrfsForEvent = async (
  studyId: number,
  eventDefinitionId: number
): Promise<any[]> => {
  logger.info('Getting available CRFs for event', { studyId, eventDefinitionId });

  try {
    // Get CRFs not already assigned to this event
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        c.status_id,
        s.name as status_name,
        cv.crf_version_id as latest_version_id,
        cv.name as latest_version_name,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN (
        SELECT DISTINCT ON (crf_id) crf_id, crf_version_id, name
        FROM crf_version
        ORDER BY crf_id, crf_version_id DESC
      ) cv ON c.crf_id = cv.crf_id
      WHERE c.status_id = 1
        AND c.crf_id NOT IN (
          SELECT crf_id FROM event_definition_crf 
          WHERE study_event_definition_id = $1 AND status_id = 1
        )
      ORDER BY c.name
    `;

    const result = await pool.query(query, [eventDefinitionId]);
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
  data: {
    studyEventDefinitionId: number;
    crfId: number;
    crfVersionId?: number;
    required?: boolean;
    doubleEntry?: boolean;
    hideCrf?: boolean;
    ordinal?: number;
    electronicSignature?: boolean;
  },
  userId: number
): Promise<{ success: boolean; eventDefinitionCrfId?: number; message?: string }> => {
  logger.info('Assigning CRF to event', { data, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if already assigned
    const existingQuery = `
      SELECT event_definition_crf_id FROM event_definition_crf 
      WHERE study_event_definition_id = $1 AND crf_id = $2 AND status_id = 1
    `;
    const existing = await client.query(existingQuery, [data.studyEventDefinitionId, data.crfId]);
    
    if (existing.rows.length > 0) {
      return {
        success: false,
        message: 'CRF is already assigned to this event'
      };
    }

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

export default {
  getStudyEvents,
  getStudyEventById,
  getSubjectEvents,
  getEventCRFs,
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
  bulkAssignCrfsToEvent
};

