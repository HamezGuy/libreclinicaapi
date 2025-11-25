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
        sed.name as event_name,
        sed.ordinal,
        se.subject_event_status_id,
        ses.name as status_name,
        se.date_start,
        se.date_end,
        se.sample_ordinal,
        se.location,
        (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id) as crf_count,
        (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.completion_status_id = 2) as completed_crf_count
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
      WHERE se.study_subject_id = $1
      ORDER BY sed.ordinal, se.sample_ordinal
    `;

    const result = await pool.query(query, [studySubjectId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get subject events error', { error: error.message });
    throw error;
  }
};

/**
 * Get CRFs for a study event
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
 * Schedule subject event (via SOAP for GxP compliance)
 */
export const scheduleSubjectEvent = async (
  data: {
    studySubjectId: number;
    studyEventDefinitionId: number;
    startDate?: string;
    endDate?: string;
    location?: string;
  },
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Scheduling subject event', { data, userId });

  try {
    // Get study ID from subject
    const subjectQuery = `SELECT study_id FROM study_subject WHERE study_subject_id = $1`;
    const subjectResult = await pool.query(subjectQuery, [data.studySubjectId]);
    
    if (subjectResult.rows.length === 0) {
      return {
        success: false,
        message: 'Subject not found'
      };
    }

    const studyId = subjectResult.rows[0].study_id;

    // Use SOAP service for GxP-compliant event scheduling
    const result = await eventSoap.scheduleEvent({
      studyId,
      subjectId: data.studySubjectId,
      studyEventDefinitionId: data.studyEventDefinitionId,
      startDate: data.startDate,
      endDate: data.endDate,
      location: data.location
    }, userId, username);
    
    return result;
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

export default {
  getStudyEvents,
  getStudyEventById,
  getSubjectEvents,
  getEventCRFs,
  scheduleSubjectEvent,
  createStudyEvent,
  updateStudyEvent,
  deleteStudyEvent
};

