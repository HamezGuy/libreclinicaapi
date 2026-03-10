/**
 * Unlock Request Service
 *
 * Manages the workflow for requesting and reviewing unlocks of locked eCRF records.
 *
 * Workflow:
 *   1. Any study user submits a request via createUnlockRequest()
 *   2. Admin/DM retrieves pending requests via getUnlockRequests()
 *   3. Admin/DM approves or rejects via reviewUnlockRequest()
 *      - Approval unlocks the form inside the same transaction and writes a full audit trail
 *      - Rejection records the reason and notifies the requester
 *
 * 21 CFR Part 11 §11.10(e): all state changes are written to audit_log_event.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as notificationService from './notification.service';

export interface UnlockRequest {
  unlockRequestId: number;
  eventCrfId: number;
  studySubjectId?: number;
  studyId?: number;
  requestedById: number;
  requestedByName?: string;
  requestedAt: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedById?: number;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  // Joined fields for display
  subjectLabel?: string;
  crfName?: string;
  eventName?: string;
}

export interface CreateUnlockRequestData {
  eventCrfId: number;
  studySubjectId?: number;
  studyId?: number;
  reason: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * Create a new unlock request for a locked eCRF.
 */
export const createUnlockRequest = async (
  data: CreateUnlockRequestData,
  requestedByUserId: number
): Promise<{ success: boolean; requestId?: number; message: string }> => {
  logger.info('Creating unlock request', { data, requestedByUserId });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify the form is actually locked
    const ecResult = await client.query(
      `SELECT status_id FROM event_crf WHERE event_crf_id = $1`,
      [data.eventCrfId]
    );
    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form instance not found' };
    }
    if (ecResult.rows[0].status_id !== 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is not locked — no unlock request needed' };
    }

    // Check for an existing pending request for this form from this user
    const existingResult = await client.query(
      `SELECT unlock_request_id FROM acc_unlock_request
       WHERE event_crf_id = $1 AND requested_by_id = $2 AND status = 'pending'`,
      [data.eventCrfId, requestedByUserId]
    );
    if (existingResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'You already have a pending unlock request for this form',
        requestId: existingResult.rows[0].unlock_request_id
      };
    }

    // Insert the request
    const insertResult = await client.query(`
      INSERT INTO acc_unlock_request (
        event_crf_id, study_subject_id, study_id,
        requested_by_id, reason, priority, status, requested_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
      RETURNING unlock_request_id
    `, [
      data.eventCrfId,
      data.studySubjectId || null,
      data.studyId || null,
      requestedByUserId,
      data.reason,
      data.priority || 'medium'
    ]);

    const requestId = insertResult.rows[0].unlock_request_id;

    // Audit log
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'acc_unlock_request', $1, $2, 'Unlock Request Created', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [requestedByUserId, requestId, data.reason]);

    await client.query('COMMIT');

    // Notify admins/data managers (fire-and-forget)
    try {
      const adminResult = await pool.query(`
        SELECT DISTINCT ua.user_id
        FROM user_account ua
        INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
        WHERE sur.role_name IN ('admin', 'data_manager')
          AND ($1::int IS NULL OR sur.study_id = $1)
          AND sur.status_id = 1
        LIMIT 10
      `, [data.studyId || null]);

      for (const row of adminResult.rows) {
        await notificationService.createNotification({
          userId: row.user_id,
          type: 'form_unlocked',
          title: 'Unlock Request Submitted',
          message: `A new unlock request has been submitted for review (priority: ${data.priority || 'medium'})`,
          entityType: 'acc_unlock_request',
          entityId: requestId,
          studyId: data.studyId,
          linkUrl: '/data-lock-management'
        } as any);
      }
    } catch (notifErr: any) {
      logger.warn('Failed to send unlock request notifications', { error: notifErr.message });
    }

    logger.info('Unlock request created', { requestId, eventCrfId: data.eventCrfId });
    return { success: true, requestId, message: 'Unlock request submitted successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('createUnlockRequest error', { error: error.message, data });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get unlock requests with optional filters and pagination.
 */
export const getUnlockRequests = async (filters: {
  studyId?: number;
  status?: string;
  requestedById?: number;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  data: UnlockRequest[];
  pagination: { page: number; limit: number; total: number };
}> => {
  const { studyId, status, requestedById, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (studyId) { conditions.push(`ur.study_id = $${idx++}`); params.push(studyId); }
  if (status)  { conditions.push(`ur.status = $${idx++}`);   params.push(status); }
  if (requestedById) { conditions.push(`ur.requested_by_id = $${idx++}`); params.push(requestedById); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const dataQuery = `
    SELECT
      ur.unlock_request_id,
      ur.event_crf_id,
      ur.study_subject_id,
      ur.study_id,
      ur.requested_by_id,
      requester.first_name || ' ' || requester.last_name AS requested_by_name,
      ur.requested_at,
      ur.reason,
      ur.priority,
      ur.status,
      ur.reviewed_by_id,
      reviewer.first_name || ' ' || reviewer.last_name AS reviewed_by_name,
      ur.reviewed_at,
      ur.review_notes,
      ss.label AS subject_label,
      c.name AS crf_name,
      sed.name AS event_name
    FROM acc_unlock_request ur
    LEFT JOIN user_account requester ON ur.requested_by_id = requester.user_id
    LEFT JOIN user_account reviewer  ON ur.reviewed_by_id  = reviewer.user_id
    LEFT JOIN study_subject ss ON ur.study_subject_id = ss.study_subject_id
    LEFT JOIN event_crf ec ON ur.event_crf_id = ec.event_crf_id
    LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    LEFT JOIN crf c ON cv.crf_id = c.crf_id
    LEFT JOIN study_event se ON ec.study_event_id = se.study_event_id
    LEFT JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    ${where}
    ORDER BY
      CASE ur.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      ur.requested_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total FROM acc_unlock_request ur ${where}
  `;

  params.push(limit, offset);
  const countParams = params.slice(0, -2);

  try {
    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams)
    ]);

    const total = parseInt(countResult.rows[0]?.total || '0');

    return {
      success: true,
      data: dataResult.rows.map((r: any) => ({
        unlockRequestId: r.unlock_request_id,
        eventCrfId: r.event_crf_id,
        studySubjectId: r.study_subject_id,
        studyId: r.study_id,
        requestedById: r.requested_by_id,
        requestedByName: r.requested_by_name,
        requestedAt: r.requested_at,
        reason: r.reason,
        priority: r.priority,
        status: r.status,
        reviewedById: r.reviewed_by_id,
        reviewedByName: r.reviewed_by_name,
        reviewedAt: r.reviewed_at,
        reviewNotes: r.review_notes,
        subjectLabel: r.subject_label,
        crfName: r.crf_name,
        eventName: r.event_name
      })),
      pagination: { page, limit, total }
    };
  } catch (error: any) {
    logger.error('getUnlockRequests error', { error: error.message });
    throw error;
  }
};

/**
 * Review (approve or reject) an unlock request.
 * On approval, automatically unlocks the associated event_crf record.
 * 
 * CRITICAL: The unlock operation is performed INSIDE the same transaction
 * to ensure atomicity - if unlock fails, the approval is rolled back.
 */
export const reviewUnlockRequest = async (
  requestId: number,
  action: 'approve' | 'reject',
  reviewNotes: string,
  reviewerUserId: number
): Promise<{ success: boolean; message: string }> => {
  logger.info('Reviewing unlock request', { requestId, action, reviewerUserId });

  // Validate reviewNotes for rejections (21 CFR Part 11 audit trail)
  if (action === 'reject' && (!reviewNotes || reviewNotes.trim().length === 0)) {
    return { success: false, message: 'Review notes are required when rejecting an unlock request' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load the request with row lock
    const reqResult = await client.query(
      `SELECT * FROM acc_unlock_request WHERE unlock_request_id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Unlock request not found' };
    }

    const request = reqResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Unlock request has already been ${request.status} and cannot be reviewed again`
      };
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // On approval, unlock the form INSIDE the transaction
    if (action === 'approve') {
      // Lock the event_crf row and perform unlock
      const unlockResult = await client.query(`
        UPDATE event_crf
        SET status_id = 2, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
        WHERE event_crf_id = $1 AND status_id = 6
        RETURNING event_crf_id
      `, [request.event_crf_id, reviewerUserId]);

      if (unlockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Form not found or not locked - cannot approve unlock request' };
      }

      // Audit log for the unlock
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
        VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Unlocked via Unlock Request',
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [reviewerUserId, request.event_crf_id]);
    }

    // Update the request record
    await client.query(`
      UPDATE acc_unlock_request
      SET status = $1, reviewed_by_id = $2, reviewed_at = NOW(), review_notes = $3
      WHERE unlock_request_id = $4
    `, [newStatus, reviewerUserId, reviewNotes, requestId]);

    // Audit log for the review
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, new_value,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'acc_unlock_request', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [
      reviewerUserId, requestId,
      `Unlock Request ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
      reviewNotes
    ]);

    await client.query('COMMIT');

    // Notify the requester (fire-and-forget, outside transaction)
    try {
      const approvedMsg = action === 'approve'
        ? 'Your unlock request has been approved. The form is now editable.'
        : `Your unlock request has been rejected. Reason: ${reviewNotes || 'No reason provided'}`;

      await notificationService.createNotification({
        userId: request.requested_by_id,
        type: action === 'approve' ? 'form_unlocked' : 'general',
        title: `Unlock Request ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
        message: approvedMsg,
        entityType: 'acc_unlock_request',
        entityId: requestId,
        studyId: request.study_id,
        linkUrl: '/data-lock-management'
      } as any);
    } catch (notifErr: any) {
      logger.warn('Failed to send review notification', { error: notifErr.message });
    }

    logger.info('Unlock request reviewed', { requestId, action, reviewerUserId });
    return {
      success: true,
      message: action === 'approve'
        ? 'Unlock request approved. The form has been unlocked and is now editable.'
        : 'Unlock request rejected.'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('reviewUnlockRequest error', { requestId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel a pending unlock request (only the requester or admin can cancel).
 */
export const cancelUnlockRequest = async (
  requestId: number,
  callerUserId: number,
  callerRole?: string
): Promise<{ success: boolean; message: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT * FROM acc_unlock_request WHERE unlock_request_id = $1 FOR UPDATE`,
      [requestId]
    );
    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Unlock request not found' };
    }

    const request = reqResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return { success: false, message: 'Only pending requests can be cancelled' };
    }

    const isOwner = request.requested_by_id === callerUserId;
    const isAdmin = callerRole && ['admin', 'data_manager'].includes(callerRole.toLowerCase());

    if (!isOwner && !isAdmin) {
      await client.query('ROLLBACK');
      return { success: false, message: 'You can only cancel your own unlock requests' };
    }

    await client.query(
      `UPDATE acc_unlock_request SET status = 'cancelled', reviewed_by_id = $1, reviewed_at = NOW()
       WHERE unlock_request_id = $2`,
      [callerUserId, requestId]
    );

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id
      ) VALUES (
        NOW(), 'acc_unlock_request', $1, $2, 'Unlock Request Cancelled',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [callerUserId, requestId]);

    await client.query('COMMIT');
    return { success: true, message: 'Unlock request cancelled' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('cancelUnlockRequest error', { requestId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};
