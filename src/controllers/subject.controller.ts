/**
 * Subject Controller
 * 
 * Handles all subject/patient-related API endpoints including:
 * - CRUD operations
 * - Progress tracking
 * - Events and forms
 * 
 * All operations are tracked in the audit trail.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as subjectService from '../services/hybrid/subject.service';
import { pool } from '../config/database';
import { logger } from '../config/logger';
import { trackUserAction } from '../services/database/audit.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status, page, limit, search } = req.query;
  const user = (req as any).user;

  // Validate studyId
  const parsedStudyId = parseInt(studyId as string);
  if (isNaN(parsedStudyId)) {
    logger.warn('Invalid or missing studyId', { studyId, userId: user?.userId });
    res.status(400).json({ 
      success: false, 
      message: 'Valid studyId is required',
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
    });
    return;
  }

  const result = await subjectService.getSubjectList(
    parsedStudyId,
    { 
      status: status as string, 
      page: parseInt(page as string) || 1, 
      limit: parseInt(limit as string) || 20
    },
    user?.userId,
    user?.username || user?.userName
  );

  // Track study access
  if (user?.userId && studyId) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'STUDY_ACCESSED',
      entityType: 'study',
      entityId: parsedStudyId,
      details: 'Viewed subject list'
    });
  }

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await subjectService.getSubjectById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Subject not found' });
    return;
  }

  // Track subject access
  if (user?.userId) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'SUBJECT_VIEWED',
      entityType: 'study_subject',
      entityId: parseInt(id),
      entityName: (result as any).label || (result as any).studySubjectId,
      details: `Viewed subject ${(result as any).label || id}`
    });
  }

  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  // Handle both username and userName from auth middleware
  const username = user?.username || user?.userName;
  
  if (!user?.userId || !username) {
    logger.error('Missing user info for subject creation', { 
      hasUserId: !!user?.userId, 
      hasUsername: !!username 
    });
    res.status(401).json({ 
      success: false, 
      message: 'User authentication required for subject creation' 
    });
    return;
  }
  
  logger.info('Creating subject', { 
    userId: user.userId, 
    username,
    studyId: req.body.studyId,
    studySubjectId: req.body.studySubjectId
  });
  
  const result = await subjectService.createSubject(req.body, user.userId, username);
  
  if (!result.success) {
    logger.warn('Subject creation failed', { 
      message: result.message,
      studyId: req.body.studyId,
      studySubjectId: req.body.studySubjectId
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

export const getProgress = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await subjectService.getSubjectProgress(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Subject not found' });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Update subject
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;
  const updates = req.body;
  
  logger.info('Updating subject', { subjectId: id, userId: user.userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Update study_subject fields
    if (updates.secondaryLabel !== undefined) {
      updateFields.push(`secondary_label = $${paramIndex++}`);
      params.push(updates.secondaryLabel);
    }

    if (updateFields.length > 0) {
      updateFields.push(`date_updated = NOW()`);
      updateFields.push(`update_id = $${paramIndex++}`);
      params.push(user.userId);
      params.push(parseInt(id));

      const updateQuery = `
        UPDATE study_subject
        SET ${updateFields.join(', ')}
        WHERE study_subject_id = $${paramIndex}
      `;

      await client.query(updateQuery, params);
    }

    // Update subject table if demographic info provided
    if (updates.dateOfBirth || updates.gender) {
      const subjectQuery = `SELECT subject_id FROM study_subject WHERE study_subject_id = $1`;
      const subjectResult = await client.query(subjectQuery, [parseInt(id)]);
      
      if (subjectResult.rows.length > 0) {
        const subjectId = subjectResult.rows[0].subject_id;
        const subjectUpdates: string[] = [];
        const subjectParams: any[] = [];
        let subjectParamIndex = 1;

        if (updates.dateOfBirth) {
          subjectUpdates.push(`date_of_birth = $${subjectParamIndex++}`);
          subjectParams.push(updates.dateOfBirth);
        }

        if (updates.gender) {
          subjectUpdates.push(`gender = $${subjectParamIndex++}`);
          subjectParams.push(updates.gender === 'male' ? 'm' : updates.gender === 'female' ? 'f' : '');
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

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Update%' LIMIT 1)
      )
    `, [user.userId, parseInt(id)]);

    await client.query('COMMIT');

    // Fetch updated subject
    const updatedSubject = await subjectService.getSubjectById(parseInt(id));

    res.json({ success: true, data: updatedSubject, message: 'Subject updated successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update subject error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * Update subject status
 */
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;
  const { statusId, reason } = req.body;

  logger.info('Updating subject status', { subjectId: id, statusId, userId: user.userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current status for audit
    const currentQuery = `SELECT status_id FROM study_subject WHERE study_subject_id = $1`;
    const currentResult = await client.query(currentQuery, [parseInt(id)]);

    if (currentResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Subject not found' });
      return;
    }

    const oldStatus = currentResult.rows[0].status_id;

    // Update status
    await client.query(`
      UPDATE study_subject
      SET status_id = $1, date_updated = NOW(), update_id = $2
      WHERE study_subject_id = $3
    `, [statusId, user.userId, parseInt(id)]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject', $3, $4, $5,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Status%' LIMIT 1)
      )
    `, [user.userId, parseInt(id), oldStatus.toString(), statusId.toString(), reason || 'Status change']);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Subject status updated successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Update subject status error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * Soft delete subject (set status to removed)
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  logger.info('Removing subject', { subjectId: id, userId: user.userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if subject exists
    const checkQuery = `SELECT study_subject_id FROM study_subject WHERE study_subject_id = $1`;
    const checkResult = await client.query(checkQuery, [parseInt(id)]);

    if (checkResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Subject not found' });
      return;
    }

    // Soft delete (set status to removed = 5)
    await client.query(`
      UPDATE study_subject
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE study_subject_id = $2
    `, [user.userId, parseInt(id)]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study_subject', $1, $2, 'Subject',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Remove%' OR name LIKE '%Delete%' LIMIT 1)
      )
    `, [user.userId, parseInt(id)]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Subject removed successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Remove subject error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

/**
 * Get subject events
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('Getting subject events', { subjectId: id });

  try {
    const query = `
      SELECT 
        se.study_event_id,
        se.study_subject_id,
        sed.study_event_definition_id,
        sed.name as event_name,
        sed.description as event_description,
        sed.type as event_type,
        sed.ordinal as event_order,
        se.sample_ordinal,
        se.date_start,
        se.date_end,
        se.location,
        se.scheduled_date,
        COALESCE(se.is_unscheduled, false) as is_unscheduled,
        sest.name as status,
        se.date_created,
        -- Total forms = count of forms assigned to the visit template
        GREATEST(
          (SELECT COUNT(*) FROM event_definition_crf edc 
           WHERE edc.study_event_definition_id = sed.study_event_definition_id AND edc.status_id = 1),
          (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id)
        ) as total_forms,
        (
          SELECT COUNT(*)
          FROM event_crf ec
          INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
          WHERE ec.study_event_id = se.study_event_id AND cs.name IN ('complete', 'signed')
        ) as completed_forms
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN subject_event_status sest ON se.subject_event_status_id = sest.subject_event_status_id
      WHERE se.study_subject_id = $1
      ORDER BY 
        COALESCE(se.scheduled_date, se.date_start, se.date_created) ASC,
        sed.ordinal ASC,
        se.sample_ordinal ASC
    `;

    const result = await pool.query(query, [parseInt(id)]);

    const events = result.rows.map(event => ({
      id: event.study_event_id.toString(),
      study_event_id: event.study_event_id,
      eventDefinitionId: event.study_event_definition_id.toString(),
      study_event_definition_id: event.study_event_definition_id,
      name: event.event_name,
      description: event.event_description || '',
      type: event.event_type || 'scheduled',
      event_type: event.event_type || 'scheduled',
      order: event.event_order,
      ordinal: event.event_order,
      occurrence: event.sample_ordinal,
      startDate: event.date_start,
      date_start: event.date_start,
      endDate: event.date_end,
      date_end: event.date_end,
      scheduledDate: event.scheduled_date,
      scheduled_date: event.scheduled_date,
      isUnscheduled: event.is_unscheduled,
      is_unscheduled: event.is_unscheduled,
      location: event.location || '',
      status: event.status,
      status_name: event.status,
      dateCreated: event.date_created,
      totalForms: parseInt(event.total_forms) || 0,
      total_forms: parseInt(event.total_forms) || 0,
      completedForms: parseInt(event.completed_forms) || 0,
      completed_forms: parseInt(event.completed_forms) || 0,
      crf_count: parseInt(event.total_forms) || 0,
      completed_crf_count: parseInt(event.completed_forms) || 0,
      completionPercentage: event.total_forms > 0 
        ? Math.round((event.completed_forms / event.total_forms) * 100) 
        : 0
    }));

    res.json({ success: true, data: events });
  } catch (error: any) {
    logger.error('Get subject events error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get subject forms/CRFs
 */
export const getForms = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('Getting subject forms', { subjectId: id });

  try {
    // Get forms WITH existing data (event_crf entries)
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
        ec.date_completed
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      INNER JOIN status st ON ec.status_id = st.status_id
      WHERE se.study_subject_id = $1
        AND ec.status_id NOT IN (5, 7)
      ORDER BY sed.ordinal, c.name
    `;

    const existingResult = await pool.query(existingFormsQuery, [parseInt(id)]);
    
    // Track which (study_event_id, crf_id) pairs already have event_crf entries
    const existingPairs = new Set(
      existingResult.rows.map((r: any) => `${r.study_event_id}_${r.crf_id}`)
    );

    // Get forms ASSIGNED to events but WITHOUT data yet (from event_definition_crf)
    // These are forms the patient should fill out but hasn't started
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

    const assignedResult = await pool.query(assignedFormsQuery, [parseInt(id)]);

    // Map existing forms (with data)
    const forms = existingResult.rows.map((form: any) => ({
      id: form.event_crf_id.toString(),
      eventId: form.study_event_id.toString(),
      eventName: form.event_name,
      formId: form.crf_id.toString(),
      formName: form.form_name,
      formDescription: form.form_description || '',
      versionId: form.crf_version_id?.toString() || '',
      versionName: form.version_name || '',
      interviewDate: form.date_interviewed,
      interviewer: form.interviewer_name || '',
      completionStatus: form.completion_status,
      status: form.status,
      dateCreated: form.date_created,
      dateUpdated: form.date_updated,
      dateCompleted: form.date_completed,
      dateValidated: form.date_validate,
      validatorId: form.validator_id
    }));

    // Add assigned but not-yet-started forms (no event_crf entry yet)
    for (const assigned of assignedResult.rows) {
      const pairKey = `${assigned.study_event_id}_${assigned.crf_id}`;
      if (!existingPairs.has(pairKey)) {
        forms.push({
          id: `pending_${assigned.study_event_id}_${assigned.crf_id}`,
          eventId: assigned.study_event_id.toString(),
          eventName: assigned.event_name,
          formId: assigned.crf_id.toString(),
          formName: assigned.form_name,
          formDescription: assigned.form_description || '',
          versionId: assigned.crf_version_id?.toString() || '',
          versionName: assigned.version_name || '',
          interviewDate: null,
          interviewer: '',
          completionStatus: 'not_started',
          status: 'available',
          dateCreated: null,
          dateUpdated: null,
          dateCompleted: null,
          dateValidated: null,
          validatorId: null
        });
        // Track this pair so we don't add duplicates
        existingPairs.add(pairKey);
      }
    }

    res.json({ success: true, data: forms });
  } catch (error: any) {
    logger.error('Get subject forms error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default { 
  list, 
  get, 
  create, 
  update, 
  updateStatus, 
  remove, 
  getProgress, 
  getEvents, 
  getForms 
};

