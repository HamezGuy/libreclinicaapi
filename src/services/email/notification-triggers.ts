/**
 * Email Notification Triggers — QUERY-ONLY
 *
 * Emails are triggered exclusively for query lifecycle events:
 *  - Query opened / assigned
 *  - Query response received
 *  - Query closed
 *
 * All other system events (form submissions, SDV, enrollment, etc.)
 * use in-app notifications only — no emails.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { queueEmail, shouldSendEmail } from './email.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUserEmail(userId: number): Promise<string | null> {
  try {
    const result = await pool.query(
      'SELECT email FROM user_account WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.email || null;
  } catch { return null; }
}

async function getUserName(userId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT first_name, last_name FROM user_account WHERE user_id = $1',
      [userId]
    );
    if (result.rows[0]) {
      return `${result.rows[0].first_name} ${result.rows[0].last_name}`.trim();
    }
    return 'Unknown User';
  } catch { return 'Unknown User'; }
}

async function getStudyName(studyId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT name FROM study WHERE study_id = $1',
      [studyId]
    );
    return result.rows[0]?.name || 'Unknown Study';
  } catch { return 'Unknown Study'; }
}

async function getSubjectLabel(subjectId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT label FROM study_subject WHERE study_subject_id = $1',
      [subjectId]
    );
    return result.rows[0]?.label || 'Unknown Subject';
  } catch { return 'Unknown Subject'; }
}

// ─── Query Opened ───────────────────────────────────────────────────────────

export async function triggerQueryOpened(
  queryId: number,
  studyId: number,
  siteId: number,
  subjectId: number,
  createdByUserId: number,
  assignedToUserId: number,
  queryText: string
): Promise<void> {
  logger.info('Triggering query opened email', { queryId, assignedToUserId });

  try {
    const shouldSend = await shouldSendEmail(assignedToUserId, 'query_created', studyId);
    if (!shouldSend) {
      logger.info('User opted out of query opened emails', { userId: assignedToUserId });
      return;
    }

    const email = await getUserEmail(assignedToUserId);
    if (!email) {
      logger.warn('No email found for user', { userId: assignedToUserId });
      return;
    }

    const [createdByName, studyName, subjectLabel] = await Promise.all([
      getUserName(createdByUserId),
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    await queueEmail({
      templateName: 'query_opened',
      recipientEmail: email,
      recipientUserId: assignedToUserId,
      studyId,
      entityType: 'query',
      entityId: queryId,
      priority: 3,
      variables: {
        queryId,
        queryText,
        subjectLabel,
        studyName,
        createdByName,
        dashboardUrl: `${process.env.FRONTEND_URL}/study/${studyId}/queries`
      }
    });
  } catch (error: any) {
    logger.error('Error triggering query opened email', { error: error.message });
  }
}

// ─── Query Response ─────────────────────────────────────────────────────────

export async function triggerQueryResponse(
  queryId: number,
  studyId: number,
  respondedByUserId: number,
  originalCreatorUserId: number,
  responseText: string
): Promise<void> {
  logger.info('Triggering query response email', { queryId });

  try {
    const shouldSend = await shouldSendEmail(originalCreatorUserId, 'query_response', studyId);
    if (!shouldSend) return;

    const email = await getUserEmail(originalCreatorUserId);
    if (!email) return;

    const [respondedByName, studyName] = await Promise.all([
      getUserName(respondedByUserId),
      getStudyName(studyId)
    ]);

    await queueEmail({
      templateName: 'query_response',
      recipientEmail: email,
      recipientUserId: originalCreatorUserId,
      studyId,
      entityType: 'query',
      entityId: queryId,
      priority: 3,
      variables: {
        queryId,
        responseText,
        studyName,
        respondedByName,
        dashboardUrl: `${process.env.FRONTEND_URL}/study/${studyId}/queries/${queryId}`
      }
    });
  } catch (error: any) {
    logger.error('Error triggering query response email', { error: error.message });
  }
}

// ─── Query Closed ───────────────────────────────────────────────────────────

export async function triggerQueryClosed(
  queryId: number,
  studyId: number,
  closedByUserId: number,
  notifyUserIds: number[]
): Promise<void> {
  logger.info('Triggering query closed email', { queryId });

  try {
    const [closedByName, studyName] = await Promise.all([
      getUserName(closedByUserId),
      getStudyName(studyId)
    ]);

    for (const userId of notifyUserIds) {
      if (userId === closedByUserId) continue;

      const shouldSend = await shouldSendEmail(userId, 'query_closed', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: 'query_closed',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'query',
        entityId: queryId,
        priority: 5,
        variables: {
          queryId,
          studyName,
          closedByName,
          dashboardUrl: `${process.env.FRONTEND_URL}/study/${studyId}/queries`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering query closed email', { error: error.message });
  }
}

export default {
  triggerQueryOpened,
  triggerQueryResponse,
  triggerQueryClosed
};
