/**
 * Notification Triggers
 * 
 * Handles automatic email notifications triggered by system events.
 * Checks user preferences before sending notifications.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { queueEmail, shouldSendEmail, shouldIncludeInDigest } from './email.service';
import { NotificationType } from './email.types';

interface TriggerContext {
  studyId: number;
  siteId?: number;
  subjectId?: number;
  formId?: number;
  queryId?: number;
  userId?: number;
}

/**
 * Get user email by ID
 */
async function getUserEmail(userId: number): Promise<string | null> {
  try {
    const result = await pool.query(
      'SELECT email FROM user_account WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.email || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get user name by ID
 */
async function getUserName(userId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT first_name, last_name FROM user_account WHERE user_id = $1',
      [userId]
    );
    if (result.rows[0]) {
      return `${result.rows[0].first_name} ${result.rows[0].last_name}`;
    }
    return 'Unknown User';
  } catch (error) {
    return 'Unknown User';
  }
}

/**
 * Get study name by ID
 */
async function getStudyName(studyId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT name FROM study WHERE study_id = $1',
      [studyId]
    );
    return result.rows[0]?.name || 'Unknown Study';
  } catch (error) {
    return 'Unknown Study';
  }
}

/**
 * Get subject label by ID
 */
async function getSubjectLabel(subjectId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT label FROM study_subject WHERE study_subject_id = $1',
      [subjectId]
    );
    return result.rows[0]?.label || 'Unknown Subject';
  } catch (error) {
    return 'Unknown Subject';
  }
}

/**
 * Get site name by ID
 */
async function getSiteName(siteId: number): Promise<string> {
  try {
    const result = await pool.query(
      'SELECT name FROM study WHERE study_id = $1',
      [siteId]
    );
    return result.rows[0]?.name || 'Unknown Site';
  } catch (error) {
    return 'Unknown Site';
  }
}

/**
 * Get users assigned to a study with a specific role
 * Note: study_user_role uses role_name (string) and user_name (string),
 * not role_id or user_id. We join to user_account to get user_id.
 */
async function getStudyUsersByRole(studyId: number, roleId: number): Promise<number[]> {
  try {
    // Map roleId to role_name(s) using LibreClinica role constants
    const roleNameMap: Record<number, string[]> = {
      1: ['admin', 'System_Administrator'],
      2: ['coordinator', 'Study_Coordinator', 'site_Study_Coordinator'],
      3: ['director', 'Study_Director', 'site_Study_Director'],
      4: ['Investigator', 'site_investigator'],
      5: ['ra', 'Data_Entry_Person', 'site_Data_Entry_Person'],
      6: ['monitor', 'Monitor', 'site_monitor'],
      7: ['ra2', 'site_Data_Entry_Person2']
    };
    const roleNames = roleNameMap[roleId] || [];
    if (roleNames.length === 0) return [];

    const result = await pool.query(`
      SELECT DISTINCT ua.user_id
      FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE sur.study_id = $1 AND sur.role_name = ANY($2) AND sur.status_id = 1
    `, [studyId, roleNames]);
    
    return result.rows.map(r => r.user_id);
  } catch (error) {
    return [];
  }
}

/**
 * Get users assigned to a site
 * Note: study_user_role uses user_name, not user_id. Join to user_account.
 */
async function getSiteUsers(siteId: number): Promise<number[]> {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ua.user_id
      FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE sur.study_id = $1 AND sur.status_id = 1
    `, [siteId]);
    
    return result.rows.map(r => r.user_id);
  } catch (error) {
    return [];
  }
}

/**
 * Trigger: New query opened
 */
export async function triggerQueryOpened(
  queryId: number,
  studyId: number,
  siteId: number,
  subjectId: number,
  createdByUserId: number,
  assignedToUserId: number,
  queryText: string
): Promise<void> {
  logger.info('Triggering query opened notification', { queryId });

  try {
    // Check if assigned user wants email notifications
    const shouldSend = await shouldSendEmail(
      assignedToUserId, 
      'query_created', 
      studyId
    );

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
      priority: 3, // Higher priority for queries
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
    logger.error('Error triggering query opened notification', { error: error.message });
  }
}

/**
 * Trigger: Query response received
 */
export async function triggerQueryResponse(
  queryId: number,
  studyId: number,
  respondedByUserId: number,
  originalCreatorUserId: number,
  responseText: string
): Promise<void> {
  logger.info('Triggering query response notification', { queryId });

  try {
    const shouldSend = await shouldSendEmail(
      originalCreatorUserId,
      'query_response',
      studyId
    );

    if (!shouldSend) {
      return;
    }

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
    logger.error('Error triggering query response notification', { error: error.message });
  }
}

/**
 * Trigger: Query closed
 */
export async function triggerQueryClosed(
  queryId: number,
  studyId: number,
  closedByUserId: number,
  notifyUserIds: number[]
): Promise<void> {
  logger.info('Triggering query closed notification', { queryId });

  try {
    const [closedByName, studyName] = await Promise.all([
      getUserName(closedByUserId),
      getStudyName(studyId)
    ]);

    for (const userId of notifyUserIds) {
      if (userId === closedByUserId) continue; // Don't notify the closer

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
    logger.error('Error triggering query closed notification', { error: error.message });
  }
}

/**
 * Trigger: Form requires signature
 */
export async function triggerSignatureRequired(
  eventCrfId: number,
  studyId: number,
  subjectId: number,
  formName: string,
  signerUserId: number
): Promise<void> {
  logger.info('Triggering signature required notification', { eventCrfId });

  try {
    const shouldSend = await shouldSendEmail(
      signerUserId,
      'signature_required',
      studyId
    );

    if (!shouldSend) return;

    const email = await getUserEmail(signerUserId);
    if (!email) return;

    const [studyName, subjectLabel] = await Promise.all([
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    await queueEmail({
      templateName: 'signature_required',
      recipientEmail: email,
      recipientUserId: signerUserId,
      studyId,
      entityType: 'event_crf',
      entityId: eventCrfId,
      priority: 2, // High priority
      variables: {
        formName,
        subjectLabel,
        studyName,
        signatureUrl: `${process.env.FRONTEND_URL}/study/${studyId}/subject/${subjectId}/form/${eventCrfId}`
      }
    });
  } catch (error: any) {
    logger.error('Error triggering signature required notification', { error: error.message });
  }
}

/**
 * Trigger: Form submitted
 */
export async function triggerFormSubmitted(
  eventCrfId: number,
  studyId: number,
  siteId: number,
  subjectId: number,
  formName: string,
  submittedByUserId: number
): Promise<void> {
  logger.info('Triggering form submitted notification', { eventCrfId });

  try {
    // Notify study monitors (role_id = 6 typically)
    const monitorIds = await getStudyUsersByRole(studyId, 6);

    const [submittedByName, studyName, subjectLabel] = await Promise.all([
      getUserName(submittedByUserId),
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    for (const userId of monitorIds) {
      const shouldSend = await shouldSendEmail(userId, 'form_overdue', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: 'form_submitted',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'event_crf',
        entityId: eventCrfId,
        priority: 7, // Lower priority
        variables: {
          formName,
          subjectLabel,
          studyName,
          submittedByName,
          reviewUrl: `${process.env.FRONTEND_URL}/study/${studyId}/subject/${subjectId}/form/${eventCrfId}`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering form submitted notification', { error: error.message });
  }
}

/**
 * Trigger: SDV status changed
 */
export async function triggerSDVStatusChange(
  eventCrfId: number,
  studyId: number,
  subjectId: number,
  formName: string,
  newStatus: 'verified' | 'not_verified',
  verifiedByUserId: number,
  dataEntryUserId: number
): Promise<void> {
  logger.info('Triggering SDV status change notification', { eventCrfId, newStatus });

  try {
    const shouldSend = await shouldSendEmail(
      dataEntryUserId,
      'sdv_required',
      studyId
    );

    if (!shouldSend || newStatus !== 'verified') return;

    const email = await getUserEmail(dataEntryUserId);
    if (!email) return;

    const [verifiedByName, studyName, subjectLabel] = await Promise.all([
      getUserName(verifiedByUserId),
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    await queueEmail({
      templateName: 'sdv_complete',
      recipientEmail: email,
      recipientUserId: dataEntryUserId,
      studyId,
      entityType: 'event_crf',
      entityId: eventCrfId,
      priority: 5,
      variables: {
        formName,
        subjectLabel,
        studyName,
        verifiedByName
      }
    });
  } catch (error: any) {
    logger.error('Error triggering SDV status change notification', { error: error.message });
  }
}

/**
 * Trigger: Subject enrolled
 */
export async function triggerSubjectEnrolled(
  subjectId: number,
  studyId: number,
  siteId: number,
  subjectLabel: string,
  enrolledByUserId: number
): Promise<void> {
  logger.info('Triggering subject enrolled notification', { subjectId });

  try {
    // Notify study coordinators and monitors
    const coordinatorIds = await getStudyUsersByRole(studyId, 4); // Coordinator role
    const monitorIds = await getStudyUsersByRole(studyId, 6); // Monitor role
    const notifyUserIds = [...new Set([...coordinatorIds, ...monitorIds])];

    const [enrolledByName, studyName, siteName] = await Promise.all([
      getUserName(enrolledByUserId),
      getStudyName(studyId),
      getSiteName(siteId)
    ]);

    for (const userId of notifyUserIds) {
      if (userId === enrolledByUserId) continue;

      const shouldSend = await shouldSendEmail(userId, 'subject_enrolled', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: 'subject_enrolled',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'study_subject',
        entityId: subjectId,
        priority: 5,
        variables: {
          subjectLabel,
          studyName,
          siteName,
          enrolledByName,
          subjectUrl: `${process.env.FRONTEND_URL}/study/${studyId}/subject/${subjectId}`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering subject enrolled notification', { error: error.message });
  }
}

/**
 * Trigger: Visit overdue
 */
export async function triggerVisitOverdue(
  studyEventId: number,
  studyId: number,
  siteId: number,
  subjectId: number,
  visitName: string,
  daysOverdue: number
): Promise<void> {
  logger.info('Triggering visit overdue notification', { studyEventId });

  try {
    // Get site coordinators
    const siteUsers = await getSiteUsers(siteId);

    const [studyName, subjectLabel] = await Promise.all([
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    for (const userId of siteUsers) {
      const shouldSend = await shouldSendEmail(userId, 'form_overdue', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: 'visit_overdue',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'study_event',
        entityId: studyEventId,
        priority: 2, // High priority
        variables: {
          visitName,
          subjectLabel,
          studyName,
          daysOverdue,
          subjectUrl: `${process.env.FRONTEND_URL}/study/${studyId}/subject/${subjectId}`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering visit overdue notification', { error: error.message });
  }
}

/**
 * Trigger: Protocol deviation detected
 */
export async function triggerProtocolDeviation(
  studyId: number,
  siteId: number,
  subjectId: number,
  deviationType: string,
  description: string,
  detectedByUserId: number
): Promise<void> {
  logger.info('Triggering protocol deviation notification', { subjectId, deviationType });

  try {
    // Notify PIs and study coordinators
    const piIds = await getStudyUsersByRole(studyId, 2); // PI role
    const coordinatorIds = await getStudyUsersByRole(studyId, 4);
    const notifyUserIds = [...new Set([...piIds, ...coordinatorIds])];

    const [detectedByName, studyName, subjectLabel] = await Promise.all([
      getUserName(detectedByUserId),
      getStudyName(studyId),
      getSubjectLabel(subjectId)
    ]);

    for (const userId of notifyUserIds) {
      const shouldSend = await shouldSendEmail(userId, 'study_milestone', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: 'protocol_deviation',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'study_subject',
        entityId: subjectId,
        priority: 1, // Highest priority
        variables: {
          deviationType,
          description,
          subjectLabel,
          studyName,
          detectedByName,
          subjectUrl: `${process.env.FRONTEND_URL}/study/${studyId}/subject/${subjectId}`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering protocol deviation notification', { error: error.message });
  }
}

/**
 * Trigger: Study lock/unlock
 */
export async function triggerStudyLockChange(
  studyId: number,
  isLocked: boolean,
  changedByUserId: number
): Promise<void> {
  logger.info('Triggering study lock change notification', { studyId, isLocked });

  try {
    // Notify all study users (join to user_account since study_user_role uses user_name, not user_id)
    const result = await pool.query(`
      SELECT DISTINCT ua.user_id FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE sur.study_id = $1 AND sur.status_id = 1
    `, [studyId]);

    const userIds = result.rows.map(r => r.user_id);
    const [changedByName, studyName] = await Promise.all([
      getUserName(changedByUserId),
      getStudyName(studyId)
    ]);

    for (const userId of userIds) {
      if (userId === changedByUserId) continue;

      const shouldSend = await shouldSendEmail(userId, 'study_milestone', studyId);
      if (!shouldSend) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      await queueEmail({
        templateName: isLocked ? 'study_locked' : 'study_unlocked',
        recipientEmail: email,
        recipientUserId: userId,
        studyId,
        entityType: 'study',
        entityId: studyId,
        priority: 2,
        variables: {
          studyName,
          changedByName,
          action: isLocked ? 'locked' : 'unlocked',
          studyUrl: `${process.env.FRONTEND_URL}/study/${studyId}`
        }
      });
    }
  } catch (error: any) {
    logger.error('Error triggering study lock change notification', { error: error.message });
  }
}

/**
 * Trigger: User role assigned
 */
export async function triggerRoleAssigned(
  userId: number,
  studyId: number,
  roleName: string,
  assignedByUserId: number
): Promise<void> {
  logger.info('Triggering role assigned notification', { userId, studyId, roleName });

  try {
    const email = await getUserEmail(userId);
    if (!email) return;

    const [assignedByName, studyName] = await Promise.all([
      getUserName(assignedByUserId),
      getStudyName(studyId)
    ]);

    await queueEmail({
      templateName: 'role_assigned',
      recipientEmail: email,
      recipientUserId: userId,
      studyId,
      entityType: 'user',
      entityId: userId,
      priority: 3,
      variables: {
        roleName,
        studyName,
        assignedByName,
        studyUrl: `${process.env.FRONTEND_URL}/study/${studyId}`
      }
    });
  } catch (error: any) {
    logger.error('Error triggering role assigned notification', { error: error.message });
  }
}

export default {
  triggerQueryOpened,
  triggerQueryResponse,
  triggerQueryClosed,
  triggerSignatureRequired,
  triggerFormSubmitted,
  triggerSDVStatusChange,
  triggerSubjectEnrolled,
  triggerVisitOverdue,
  triggerProtocolDeviation,
  triggerStudyLockChange,
  triggerRoleAssigned
};

