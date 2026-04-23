/**
 * Email Service
 * 
 * Email notification system with:
 * - Template-based email sending
 * - Queue-based delivery for reliability
 * - SMTP integration
 * - User preference management
 * - 21 CFR Part 11 audit logging
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  EmailTemplate,
  EmailQueueEntry,
  EmailRequest,
  DirectEmailRequest,
  NotificationPreference,
  UpdatePreferenceRequest,
  NotificationType,
  EmailSendResult,
  QueueProcessResult,
  DigestData
} from './email.types';

// SMTP configuration from environment
const smtpConfig = {
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.SMTP_FROM_NAME || 'AccuraTrials EDC',
  fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@accuratrials.com'
};

const EMAIL_QUEUE_ENABLED = process.env.EMAIL_QUEUE_ENABLED !== 'false';
const MAX_RETRY_ATTEMPTS = 3;

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  if (!smtpConfig.host || !smtpConfig.user) {
    logger.warn('SMTP not fully configured — emails will be logged but not sent');
  }

  _transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return _transporter;
}

/**
 * Get email template by name
 */
export async function getTemplate(templateName: string): Promise<EmailTemplate | null> {
  try {
    const query = `
      SELECT 
        template_id, name, subject, html_body, text_body,
        description, variables, version, status_id, owner_id,
        date_created, date_updated
      FROM acc_email_template
      WHERE name = $1 AND status_id = 1
    `;
    
    const result = await pool.query(query, [templateName]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      templateId: row.templateId,
      name: row.name,
      subject: row.subject,
      htmlBody: row.htmlBody,
      textBody: row.textBody,
      description: row.description,
      variables: row.variables,
      version: row.version,
      statusId: row.statusId,
      ownerId: row.ownerId,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated
    };
  } catch (error: any) {
    logger.error('Error getting email template', { error: error.message, templateName });
    return null;
  }
}

/**
 * List all email templates
 */
export async function listTemplates(): Promise<EmailTemplate[]> {
  try {
    const query = `
      SELECT 
        template_id, name, subject, html_body, text_body,
        description, variables, version, status_id, owner_id,
        date_created, date_updated
      FROM acc_email_template
      WHERE status_id = 1
      ORDER BY name
    `;
    
    const result = await pool.query(query);
    
    return result.rows.map(row => ({
      templateId: row.templateId,
      name: row.name,
      subject: row.subject,
      htmlBody: row.htmlBody,
      textBody: row.textBody,
      description: row.description,
      variables: row.variables,
      version: row.version,
      statusId: row.statusId,
      ownerId: row.ownerId,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated
    }));
  } catch (error: any) {
    logger.error('Error listing email templates', { error: error.message });
    return [];
  }
}

/**
 * Render template with variables
 */
function renderTemplate(template: string, variables: Record<string, any>): string {
  let rendered = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, String(value ?? ''));
  }
  
  return rendered;
}

/**
 * Queue an email for sending
 */
export async function queueEmail(request: EmailRequest): Promise<number | null> {
  logger.info('Queueing email', { 
    templateName: request.templateName, 
    recipientEmail: request.recipientEmail 
  });

  try {
    // Get template
    const template = await getTemplate(request.templateName);
    if (!template) {
      logger.error('Email template not found', { templateName: request.templateName });
      return null;
    }

    // Render template
    const subject = renderTemplate(template.subject, request.variables);
    const htmlBody = renderTemplate(template.htmlBody, request.variables);
    const textBody = template.textBody ? renderTemplate(template.textBody, request.variables) : null;

    // Insert into queue
    const query = `
      INSERT INTO acc_email_queue (
        template_id, recipient_email, recipient_user_id,
        subject, html_body, text_body, variables,
        priority, status, study_id, entity_type, entity_id,
        scheduled_for, date_created
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, CURRENT_TIMESTAMP
      )
      RETURNING queue_id
    `;

    const result = await pool.query(query, [
      template.templateId,
      request.recipientEmail,
      request.recipientUserId || null,
      subject,
      htmlBody,
      textBody,
      JSON.stringify(request.variables),
      request.priority || 5,
      request.studyId || null,
      request.entityType || null,
      request.entityId || null,
      request.scheduledFor || null
    ]);

    const queueId = result.rows[0].queueId;
    logger.info('Email queued', { queueId, recipientEmail: request.recipientEmail });

    return queueId;
  } catch (error: any) {
    logger.error('Error queueing email', { error: error.message });
    return null;
  }
}

/**
 * Queue a direct email (without template)
 */
export async function queueDirectEmail(request: DirectEmailRequest): Promise<number | null> {
  logger.info('Queueing direct email', { recipientEmail: request.recipientEmail });

  try {
    const query = `
      INSERT INTO acc_email_queue (
        recipient_email, recipient_user_id,
        subject, html_body, text_body,
        priority, status, study_id, entity_type, entity_id,
        date_created
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, CURRENT_TIMESTAMP
      )
      RETURNING queue_id
    `;

    const result = await pool.query(query, [
      request.recipientEmail,
      request.recipientUserId || null,
      request.subject,
      request.htmlBody,
      request.textBody || null,
      request.priority || 5,
      request.studyId || null,
      request.entityType || null,
      request.entityId || null
    ]);

    return result.rows[0].queueId;
  } catch (error: any) {
    logger.error('Error queueing direct email', { error: error.message });
    return null;
  }
}

/**
 * Send email directly via SMTP
 */
export async function sendEmailDirect(
  to: string,
  subject: string,
  htmlBody: string,
  textBody?: string
): Promise<EmailSendResult> {
  logger.info('Sending email', { to, subject });

  try {
    const transporter = getTransporter();

    const info = await transporter.sendMail({
      from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      to,
      subject,
      text: textBody || undefined,
      html: htmlBody
    });

    logger.info('Email sent successfully', {
      to,
      subject,
      messageId: info.messageId
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    logger.error('Error sending email', { error: error.message, to, subject });
    return { success: false, error: error.message };
  }
}

/**
 * Process the email queue
 */
export async function processEmailQueue(batchSize: number = 10): Promise<QueueProcessResult> {
  logger.info('Processing email queue', { batchSize });

  const result: QueueProcessResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: []
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomically claim a batch — FOR UPDATE SKIP LOCKED prevents concurrent
    // workers from picking up the same rows and double-sending.
    const claimQuery = `
      UPDATE acc_email_queue
      SET status = 'processing'
      WHERE queue_id IN (
        SELECT queue_id FROM acc_email_queue
        WHERE status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= CURRENT_TIMESTAMP)
          AND attempts < $1
        ORDER BY priority ASC, date_created ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING queue_id, recipient_email, subject, html_body, text_body, attempts
    `;

    const claimed = await client.query(claimQuery, [MAX_RETRY_ATTEMPTS, batchSize]);
    await client.query('COMMIT');

    for (const email of claimed.rows) {
      result.processed++;

      const sendResult = await sendEmailDirect(
        email.recipientEmail,
        email.subject,
        email.htmlBody,
        email.textBody
      );

      if (sendResult.success) {
        await pool.query(`
          UPDATE acc_email_queue
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_attempt = CURRENT_TIMESTAMP
          WHERE queue_id = $1
        `, [email.queueId]);

        result.sent++;
      } else {
        const newAttempts = email.attempts + 1;
        const newStatus = newAttempts >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending';

        await pool.query(`
          UPDATE acc_email_queue
          SET status = $1, attempts = $2, last_attempt = CURRENT_TIMESTAMP, error_message = $3
          WHERE queue_id = $4
        `, [newStatus, newAttempts, sendResult.error, email.queueId]);

        if (newStatus === 'failed') {
          result.failed++;
          result.errors.push(`Email ${email.queueId}: ${sendResult.error}`);
        }
      }
    }

    logger.info('Email queue processed', result);
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error processing email queue', { error: error.message });
    result.errors.push(error.message);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Get user notification preferences
 */
export async function getUserPreferences(userId: number): Promise<NotificationPreference[]> {
  try {
    const query = `
      SELECT 
        preference_id, user_id, study_id, notification_type,
        email_enabled, digest_enabled, in_app_enabled,
        date_created, date_updated
      FROM acc_notification_preference
      WHERE user_id = $1
      ORDER BY notification_type, study_id
    `;

    const result = await pool.query(query, [userId]);

    return result.rows.map(row => ({
      preferenceId: row.preferenceId,
      userId: row.userId,
      studyId: row.studyId,
      notificationType: row.notificationType as NotificationType,
      emailEnabled: row.emailEnabled,
      digestEnabled: row.digestEnabled,
      inAppEnabled: row.inAppEnabled,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated
    }));
  } catch (error: any) {
    logger.error('Error getting user preferences', { error: error.message, userId });
    return [];
  }
}

/**
 * Get user preference for a specific notification type
 */
export async function getPreference(
  userId: number,
  notificationType: NotificationType,
  studyId?: number
): Promise<NotificationPreference | null> {
  try {
    const query = `
      SELECT 
        preference_id, user_id, study_id, notification_type,
        email_enabled, digest_enabled, in_app_enabled,
        date_created, date_updated
      FROM acc_notification_preference
      WHERE user_id = $1 
        AND notification_type = $2
        AND (study_id = $3 OR (study_id IS NULL AND $3 IS NULL))
    `;

    const result = await pool.query(query, [userId, notificationType, studyId || null]);

    if (result.rows.length === 0) {
      // Return default preferences (all enabled)
      return {
        preferenceId: 0,
        userId,
        studyId: studyId || undefined,
        notificationType,
        emailEnabled: true,
        digestEnabled: false,
        inAppEnabled: true,
        dateCreated: new Date(),
        dateUpdated: new Date()
      };
    }

    const row = result.rows[0];
    return {
      preferenceId: row.preferenceId,
      userId: row.userId,
      studyId: row.studyId,
      notificationType: row.notificationType as NotificationType,
      emailEnabled: row.emailEnabled,
      digestEnabled: row.digestEnabled,
      inAppEnabled: row.inAppEnabled,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated
    };
  } catch (error: any) {
    logger.error('Error getting user preference', { error: error.message, userId, notificationType });
    return null;
  }
}

/**
 * Update user notification preference
 */
export async function updatePreference(request: UpdatePreferenceRequest): Promise<boolean> {
  try {
    const query = `
      INSERT INTO acc_notification_preference (
        user_id, study_id, notification_type,
        email_enabled, digest_enabled, in_app_enabled,
        date_created, date_updated
      ) VALUES (
        $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_id, study_id, notification_type)
      DO UPDATE SET
        email_enabled = COALESCE($4, acc_notification_preference.email_enabled),
        digest_enabled = COALESCE($5, acc_notification_preference.digest_enabled),
        in_app_enabled = COALESCE($6, acc_notification_preference.in_app_enabled),
        date_updated = CURRENT_TIMESTAMP
    `;

    await pool.query(query, [
      request.userId,
      request.studyId || null,
      request.notificationType,
      request.emailEnabled ?? true,
      request.digestEnabled ?? false,
      request.inAppEnabled ?? true
    ]);

    return true;
  } catch (error: any) {
    logger.error('Error updating preference', { error: error.message });
    return false;
  }
}

/**
 * Check if user wants email for a notification type
 */
export async function shouldSendEmail(
  userId: number,
  notificationType: NotificationType,
  studyId?: number
): Promise<boolean> {
  const pref = await getPreference(userId, notificationType, studyId);
  return pref?.emailEnabled ?? true;
}

/**
 * Check if notification should be included in digest
 */
export async function shouldIncludeInDigest(
  userId: number,
  notificationType: NotificationType,
  studyId?: number
): Promise<boolean> {
  const pref = await getPreference(userId, notificationType, studyId);
  return pref?.digestEnabled ?? false;
}

/**
 * Get email queue status
 */
export async function getQueueStatus(): Promise<{
  pending: number;
  sent: number;
  failed: number;
  total: number;
}> {
  try {
    const query = `
      SELECT 
        status,
        COUNT(*) as count
      FROM acc_email_queue
      GROUP BY status
    `;

    const result = await pool.query(query);
    
    const counts: Record<string, number> = {};
    let total = 0;
    
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count);
      total += parseInt(row.count);
    }

    return {
      pending: counts['pending'] || 0,
      sent: counts['sent'] || 0,
      failed: counts['failed'] || 0,
      total
    };
  } catch (error: any) {
    logger.error('Error getting queue status', { error: error.message });
    return { pending: 0, sent: 0, failed: 0, total: 0 };
  }
}

/**
 * Cancel a queued email
 */
export async function cancelEmail(queueId: number): Promise<boolean> {
  try {
    const result = await pool.query(`
      UPDATE acc_email_queue
      SET status = 'cancelled'
      WHERE queue_id = $1 AND status = 'pending'
    `, [queueId]);

    return (result.rowCount ?? 0) > 0;
  } catch (error: any) {
    logger.error('Error cancelling email', { error: error.message, queueId });
    return false;
  }
}

/**
 * Retry a failed email
 */
export async function retryEmail(queueId: number): Promise<boolean> {
  try {
    const result = await pool.query(`
      UPDATE acc_email_queue
      SET status = 'pending', attempts = 0, error_message = NULL
      WHERE queue_id = $1 AND status = 'failed'
    `, [queueId]);

    return (result.rowCount ?? 0) > 0;
  } catch (error: any) {
    logger.error('Error retrying email', { error: error.message, queueId });
    return false;
  }
}

export default {
  getTemplate,
  listTemplates,
  queueEmail,
  queueDirectEmail,
  sendEmailDirect,
  processEmailQueue,
  getUserPreferences,
  getPreference,
  updatePreference,
  shouldSendEmail,
  shouldIncludeInDigest,
  getQueueStatus,
  cancelEmail,
  retryEmail
};

