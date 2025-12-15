/**
 * Email Service Types
 * 
 * Types for email notifications and queue management
 */

/**
 * Notification types that can be sent
 */
export type NotificationType = 
  | 'query_created'
  | 'query_response'
  | 'query_closed'
  | 'form_overdue'
  | 'signature_required'
  | 'sdv_required'
  | 'subject_enrolled'
  | 'study_milestone'
  | 'password_reset'
  | 'account_created'
  | 'daily_digest'
  | 'welcome';

/**
 * Email queue status
 */
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

/**
 * Email priority (1 = highest, 10 = lowest)
 */
export type EmailPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Email template structure
 */
export interface EmailTemplate {
  templateId: number;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  description?: string;
  variables?: string[];
  version: number;
  statusId: number;
  ownerId?: number;
  dateCreated: Date;
  dateUpdated: Date;
}

/**
 * Email queue entry
 */
export interface EmailQueueEntry {
  queueId: number;
  templateId?: number;
  recipientEmail: string;
  recipientUserId?: number;
  subject: string;
  htmlBody: string;
  textBody?: string;
  variables?: Record<string, any>;
  priority: EmailPriority;
  status: EmailStatus;
  attempts: number;
  lastAttempt?: Date;
  sentAt?: Date;
  errorMessage?: string;
  studyId?: number;
  entityType?: string;
  entityId?: number;
  dateCreated: Date;
  scheduledFor?: Date;
}

/**
 * Email request for queueing
 */
export interface EmailRequest {
  recipientUserId?: number;
  recipientEmail: string;
  templateName: string;
  variables: Record<string, any>;
  priority?: EmailPriority;
  scheduledFor?: Date;
  studyId?: number;
  entityType?: string;
  entityId?: number;
}

/**
 * Direct email send request (without template)
 */
export interface DirectEmailRequest {
  recipientEmail: string;
  recipientUserId?: number;
  subject: string;
  htmlBody: string;
  textBody?: string;
  priority?: EmailPriority;
  studyId?: number;
  entityType?: string;
  entityId?: number;
}

/**
 * User notification preferences
 */
export interface NotificationPreference {
  preferenceId: number;
  userId: number;
  studyId?: number;
  notificationType: NotificationType;
  emailEnabled: boolean;
  digestEnabled: boolean;
  inAppEnabled: boolean;
  dateCreated: Date;
  dateUpdated: Date;
}

/**
 * Update notification preference request
 */
export interface UpdatePreferenceRequest {
  userId: number;
  studyId?: number;
  notificationType: NotificationType;
  emailEnabled?: boolean;
  digestEnabled?: boolean;
  inAppEnabled?: boolean;
}

/**
 * SMTP configuration
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Queue processing result
 */
export interface QueueProcessResult {
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Digest email data
 */
export interface DigestData {
  userId: number;
  userName: string;
  userEmail: string;
  openQueries: { patientId: string; formName: string; queryText: string }[];
  pendingSignatures: { patientId: string; formName: string }[];
  overdueForms: { patientId: string; formName: string; dueDate: string }[];
  pendingSdv: { patientId: string; formName: string }[];
}

// Types are exported inline above

