/**
 * Notification Service
 * 
 * In-app notification system for EDC workflow events.
 * Notifications are created automatically when:
 * - A query is assigned to a user
 * - A query response is added
 * - A form is ready for review/SDV/signature
 * - A form is locked/unlocked
 * - A workflow task is assigned
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export type NotificationType =
  | 'query_assigned'
  | 'query_response'
  | 'query_closed'
  | 'query_reopened'
  | 'form_ready_for_review'
  | 'form_sdv_required'
  | 'form_signature_required'
  | 'form_locked'
  | 'form_unlocked'
  | 'form_frozen'
  | 'task_assigned'
  | 'task_completed'
  | 'general';

interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: number;
  studyId?: number;
  linkUrl?: string;
}

/**
 * Create a single notification for a user.
 */
export const createNotification = async (input: CreateNotificationInput): Promise<number | null> => {
  try {
    // Check table exists
    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_notifications') as exists`
    );
    if (!tableCheck.rows[0].exists) return null;

    const result = await pool.query(`
      INSERT INTO acc_notifications (user_id, notification_type, title, message, entity_type, entity_id, study_id, link_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING notification_id
    `, [input.userId, input.type, input.title, input.message, input.entityType || null, input.entityId || null, input.studyId || null, input.linkUrl || null]);

    return result.rows[0]?.notificationId || null;
  } catch (error: any) {
    logger.warn('Failed to create notification', { error: error.message, userId: input.userId });
    return null;
  }
};

/**
 * Create notifications for multiple users (e.g., multi-user query routing).
 * Uses a single bulk INSERT instead of per-user queries.
 */
export const notifyUsers = async (
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  options?: { entityType?: string; entityId?: number; studyId?: number; linkUrl?: string }
): Promise<number> => {
  if (userIds.length === 0) return 0;

  try {
    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_notifications') as exists`
    );
    if (!tableCheck.rows[0].exists) return 0;

    const entityType = options?.entityType || null;
    const entityId = options?.entityId || null;
    const studyId = options?.studyId || null;
    const linkUrl = options?.linkUrl || null;

    const result = await pool.query(`
      INSERT INTO acc_notifications (user_id, notification_type, title, message, entity_type, entity_id, study_id, link_url)
      SELECT uid, $2, $3, $4, $5, $6, $7, $8
      FROM unnest($1::int[]) AS uid
      RETURNING notification_id
    `, [userIds, type, title, message, entityType, entityId, studyId, linkUrl]);

    return result.rowCount || 0;
  } catch (error: any) {
    logger.warn('Failed to bulk create notifications', { error: error.message, userIds });
    return 0;
  }
};

/**
 * Get unread notifications for a user.
 */
export const getUnreadNotifications = async (
  userId: number,
  limit = 50
): Promise<{ data: any[]; unreadCount: number }> => {
  try {
    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_notifications') as exists`
    );
    if (!tableCheck.rows[0].exists) return { data: [], unreadCount: 0 };

    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM acc_notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    const unreadCount = parseInt(countResult.rows[0]?.cnt || '0');

    const result = await pool.query(`
      SELECT * FROM acc_notifications
      WHERE user_id = $1
      ORDER BY date_created DESC
      LIMIT $2
    `, [userId, limit]);

    return { data: result.rows, unreadCount };
  } catch (error: any) {
    logger.error('Failed to get notifications', { error: error.message, userId });
    return { data: [], unreadCount: 0 };
  }
};

/**
 * Mark a notification as read.
 */
export const markAsRead = async (notificationId: number, userId: number): Promise<boolean> => {
  try {
    await pool.query(
      `UPDATE acc_notifications SET is_read = true, date_read = NOW() WHERE notification_id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    return true;
  } catch { return false; }
};

/**
 * Mark all notifications as read for a user.
 */
export const markAllAsRead = async (userId: number): Promise<number> => {
  try {
    const result = await pool.query(
      `UPDATE acc_notifications SET is_read = true, date_read = NOW() WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    return result.rowCount || 0;
  } catch { return 0; }
};

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE HELPERS — fire-and-forget notification creation
// ═══════════════════════════════════════════════════════════════════

/** Notify when a query is assigned. */
export const notifyQueryAssigned = async (
  assignedUserId: number,
  queryDescription: string,
  queryId: number,
  studyId?: number
) => {
  await createNotification({
    userId: assignedUserId,
    type: 'query_assigned',
    title: 'New query assigned to you',
    message: queryDescription.substring(0, 200),
    entityType: 'discrepancy_note',
    entityId: queryId,
    studyId
  });
};

/** Notify when a query response is added. */
export const notifyQueryResponse = async (
  ownerUserId: number,
  queryDescription: string,
  queryId: number,
  responderName: string,
  studyId?: number
) => {
  await createNotification({
    userId: ownerUserId,
    type: 'query_response',
    title: `Query response from ${responderName}`,
    message: queryDescription.substring(0, 200),
    entityType: 'discrepancy_note',
    entityId: queryId,
    studyId
  });
};

/** Notify the query owner/assignees when a query is closed. */
export const notifyQueryClosed = async (
  recipientUserId: number,
  queryDescription: string,
  queryId: number,
  closedByName: string,
  studyId?: number
) => {
  await createNotification({
    userId: recipientUserId,
    type: 'query_closed',
    title: `Query closed by ${closedByName}`,
    message: queryDescription.substring(0, 200),
    entityType: 'discrepancy_note',
    entityId: queryId,
    studyId
  });
};

/** Notify the query owner when a resolution is proposed. */
export const notifyResolutionProposed = async (
  ownerUserId: number,
  queryDescription: string,
  queryId: number,
  proposerName: string,
  studyId?: number
) => {
  await createNotification({
    userId: ownerUserId,
    type: 'query_response',
    title: `Resolution proposed by ${proposerName}`,
    message: queryDescription.substring(0, 200),
    entityType: 'discrepancy_note',
    entityId: queryId,
    studyId
  });
};

/** Notify the person who proposed resolution that it was rejected. */
export const notifyResolutionRejected = async (
  proposerUserId: number,
  queryDescription: string,
  queryId: number,
  rejectedByName: string,
  reason: string,
  studyId?: number
) => {
  await createNotification({
    userId: proposerUserId,
    type: 'query_response',
    title: `Resolution rejected by ${rejectedByName}`,
    message: `${queryDescription.substring(0, 150)} — Reason: ${reason.substring(0, 100)}`,
    entityType: 'discrepancy_note',
    entityId: queryId,
    studyId
  });
};

/** Notify when a form needs SDV. */
export const notifyFormSDVRequired = async (
  userIds: number[],
  formName: string,
  eventCrfId: number,
  studyId: number,
  subjectLabel: string
) => {
  await notifyUsers(userIds, 'form_sdv_required',
    `SDV required: ${formName}`,
    `Form "${formName}" for patient ${subjectLabel} is ready for source data verification.`,
    { entityType: 'event_crf', entityId: eventCrfId, studyId }
  );
};

/** Notify when a form is locked. */
export const notifyFormLocked = async (
  userIds: number[],
  formName: string,
  eventCrfId: number,
  studyId: number,
  subjectLabel: string,
  lockedByName: string
) => {
  await notifyUsers(userIds, 'form_locked',
    `Form locked: ${formName}`,
    `Form "${formName}" for patient ${subjectLabel} was locked by ${lockedByName}.`,
    { entityType: 'event_crf', entityId: eventCrfId, studyId }
  );
};

/** Notify when a form requires an electronic signature. */
export const notifyFormSignatureRequired = async (
  userIds: number[],
  formName: string,
  eventCrfId: number,
  studyId: number,
  subjectLabel: string
) => {
  await notifyUsers(userIds, 'form_signature_required',
    `Signature required: ${formName}`,
    `Form "${formName}" for patient ${subjectLabel} requires your electronic signature.`,
    { entityType: 'event_crf', entityId: eventCrfId, studyId }
  );
};

/** Notify about consent events (recording, withdrawal, re-consent). */
export const notifyConsentEvent = async (
  userIds: number[],
  action: 'recorded' | 'withdrawn' | 'reconsent_needed',
  subjectLabel: string,
  studyId: number,
  consentId?: number
) => {
  const titles: Record<string, string> = {
    recorded: `Consent recorded: ${subjectLabel}`,
    withdrawn: `Consent withdrawn: ${subjectLabel}`,
    reconsent_needed: `Re-consent required: ${subjectLabel}`,
  };
  const messages: Record<string, string> = {
    recorded: `Informed consent has been successfully recorded for patient ${subjectLabel}.`,
    withdrawn: `Informed consent has been withdrawn for patient ${subjectLabel}. Data entry may be restricted.`,
    reconsent_needed: `Patient ${subjectLabel} requires re-consent due to a protocol or document version change.`,
  };
  await notifyUsers(userIds, 'general',
    titles[action] || `Consent event: ${subjectLabel}`,
    messages[action] || `A consent event occurred for patient ${subjectLabel}.`,
    { entityType: 'acc_subject_consent', entityId: consentId, studyId }
  );
};

export default {
  createNotification,
  notifyUsers,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
  notifyQueryAssigned,
  notifyQueryResponse,
  notifyQueryClosed,
  notifyResolutionProposed,
  notifyResolutionRejected,
  notifyFormSDVRequired,
  notifyFormLocked,
  notifyFormSignatureRequired,
  notifyConsentEvent,
};
