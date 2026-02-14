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

    return result.rows[0]?.notification_id || null;
  } catch (error: any) {
    logger.warn('Failed to create notification', { error: error.message, userId: input.userId });
    return null;
  }
};

/**
 * Create notifications for multiple users (e.g., multi-user query routing).
 */
export const notifyUsers = async (
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  options?: { entityType?: string; entityId?: number; studyId?: number; linkUrl?: string }
): Promise<number> => {
  let count = 0;
  for (const uid of userIds) {
    const id = await createNotification({
      userId: uid,
      type,
      title,
      message,
      ...options
    });
    if (id) count++;
  }
  return count;
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
  responderName: string
) => {
  await createNotification({
    userId: ownerUserId,
    type: 'query_response',
    title: `Query response from ${responderName}`,
    message: queryDescription.substring(0, 200),
    entityType: 'discrepancy_note',
    entityId: queryId
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

export default {
  createNotification,
  notifyUsers,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
  notifyQueryAssigned,
  notifyQueryResponse,
  notifyFormSDVRequired
};
