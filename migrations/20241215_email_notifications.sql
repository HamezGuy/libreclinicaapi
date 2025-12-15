-- Migration: Email Notifications
-- Created: December 15, 2024
-- Description: Create tables for email notification system

-- Up Migration
BEGIN;

-- Email templates
CREATE TABLE IF NOT EXISTS acc_email_template (
  template_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  subject VARCHAR(255) NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  description TEXT,
  variables JSONB, -- Available template variables
  version INTEGER DEFAULT 1,
  status_id INTEGER DEFAULT 1,
  owner_id INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email queue
CREATE TABLE IF NOT EXISTS acc_email_queue (
  queue_id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES acc_email_template(template_id),
  recipient_email VARCHAR(255) NOT NULL,
  recipient_user_id INTEGER REFERENCES user_account(user_id),
  subject VARCHAR(255) NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  variables JSONB, -- Template variables used
  priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, failed, cancelled
  attempts INTEGER DEFAULT 0,
  last_attempt TIMESTAMP,
  sent_at TIMESTAMP,
  error_message TEXT,
  study_id INTEGER REFERENCES study(study_id),
  entity_type VARCHAR(50), -- query, form, subject, etc.
  entity_id INTEGER,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMP -- For digest/delayed emails
);

-- User notification preferences
CREATE TABLE IF NOT EXISTS acc_notification_preference (
  preference_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES user_account(user_id) NOT NULL,
  study_id INTEGER REFERENCES study(study_id), -- NULL = all studies
  notification_type VARCHAR(50) NOT NULL,
  email_enabled BOOLEAN DEFAULT true,
  digest_enabled BOOLEAN DEFAULT false, -- Include in daily digest
  in_app_enabled BOOLEAN DEFAULT true,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, study_id, notification_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON acc_email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON acc_email_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notification_pref_user ON acc_notification_preference(user_id);

-- Insert default email templates
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'query_created',
  'New Query Assigned - {{studyName}}',
  '<h2>New Query Assigned</h2><p>Hi {{userName}},</p><p>A new query has been assigned to you:</p><table><tr><td><strong>Study:</strong></td><td>{{studyName}}</td></tr><tr><td><strong>Patient:</strong></td><td>{{patientId}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Query:</strong></td><td>{{queryText}}</td></tr></table><p><a href="{{queryUrl}}">View Query</a></p>',
  'New Query Assigned\n\nHi {{userName}},\n\nA new query has been assigned to you:\n\nStudy: {{studyName}}\nPatient: {{patientId}}\nForm: {{formName}}\nQuery: {{queryText}}\n\nView Query: {{queryUrl}}',
  'Notification when a new query is created and assigned to a user',
  '["userName", "studyName", "patientId", "formName", "queryText", "queryUrl"]'::jsonb
),
(
  'query_response',
  'Query Response Received - {{studyName}}',
  '<h2>Query Response Received</h2><p>Hi {{userName}},</p><p>A response has been received for your query:</p><table><tr><td><strong>Patient:</strong></td><td>{{patientId}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Response:</strong></td><td>{{responseText}}</td></tr></table><p><a href="{{queryUrl}}">View Query</a></p>',
  'Query Response Received\n\nHi {{userName}},\n\nA response has been received for your query:\n\nPatient: {{patientId}}\nForm: {{formName}}\nResponse: {{responseText}}\n\nView Query: {{queryUrl}}',
  'Notification when a query receives a response',
  '["userName", "studyName", "patientId", "formName", "responseText", "queryUrl"]'::jsonb
),
(
  'form_overdue',
  'Overdue Form Reminder - {{studyName}}',
  '<h2>Form Overdue</h2><p>Hi {{userName}},</p><p>The following form is overdue:</p><table><tr><td><strong>Patient:</strong></td><td>{{patientId}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Event:</strong></td><td>{{eventName}}</td></tr><tr><td><strong>Due Date:</strong></td><td>{{dueDate}}</td></tr></table><p><a href="{{formUrl}}">Complete Form</a></p>',
  'Form Overdue\n\nHi {{userName}},\n\nThe following form is overdue:\n\nPatient: {{patientId}}\nForm: {{formName}}\nEvent: {{eventName}}\nDue Date: {{dueDate}}\n\nComplete Form: {{formUrl}}',
  'Reminder when a form is overdue',
  '["userName", "studyName", "patientId", "formName", "eventName", "dueDate", "formUrl"]'::jsonb
),
(
  'signature_required',
  'Signature Required - {{studyName}}',
  '<h2>Signature Required</h2><p>Hi {{userName}},</p><p>Your electronic signature is required for:</p><table><tr><td><strong>Patient:</strong></td><td>{{patientId}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Event:</strong></td><td>{{eventName}}</td></tr></table><p><a href="{{signatureUrl}}">Sign Form</a></p>',
  'Signature Required\n\nHi {{userName}},\n\nYour electronic signature is required for:\n\nPatient: {{patientId}}\nForm: {{formName}}\nEvent: {{eventName}}\n\nSign Form: {{signatureUrl}}',
  'Notification when a signature is required',
  '["userName", "studyName", "patientId", "formName", "eventName", "signatureUrl"]'::jsonb
),
(
  'sdv_required',
  'SDV Required - {{studyName}}',
  '<h2>Source Data Verification Required</h2><p>Hi {{userName}},</p><p>SDV is required for the following form:</p><table><tr><td><strong>Patient:</strong></td><td>{{patientId}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Site:</strong></td><td>{{siteName}}</td></tr></table><p><a href="{{sdvUrl}}">Perform SDV</a></p>',
  'Source Data Verification Required\n\nHi {{userName}},\n\nSDV is required for the following form:\n\nPatient: {{patientId}}\nForm: {{formName}}\nSite: {{siteName}}\n\nPerform SDV: {{sdvUrl}}',
  'Notification when SDV is required',
  '["userName", "studyName", "patientId", "formName", "siteName", "sdvUrl"]'::jsonb
),
(
  'subject_enrolled',
  'New Subject Enrolled - {{studyName}}',
  '<h2>New Subject Enrolled</h2><p>Hi {{userName}},</p><p>A new subject has been enrolled:</p><table><tr><td><strong>Subject ID:</strong></td><td>{{subjectId}}</td></tr><tr><td><strong>Study:</strong></td><td>{{studyName}}</td></tr><tr><td><strong>Site:</strong></td><td>{{siteName}}</td></tr><tr><td><strong>Enrollment Date:</strong></td><td>{{enrollmentDate}}</td></tr></table><p><a href="{{subjectUrl}}">View Subject</a></p>',
  'New Subject Enrolled\n\nHi {{userName}},\n\nA new subject has been enrolled:\n\nSubject ID: {{subjectId}}\nStudy: {{studyName}}\nSite: {{siteName}}\nEnrollment Date: {{enrollmentDate}}\n\nView Subject: {{subjectUrl}}',
  'Notification when a new subject is enrolled',
  '["userName", "studyName", "subjectId", "siteName", "enrollmentDate", "subjectUrl"]'::jsonb
),
(
  'daily_digest',
  'Daily Summary - {{date}}',
  '<h2>Daily Summary</h2><p>Hi {{userName}},</p><p>Here is your daily summary:</p><h3>Open Queries: {{openQueryCount}}</h3><ul>{{queryList}}</ul><h3>Pending Signatures: {{pendingSignatureCount}}</h3><ul>{{signatureList}}</ul><h3>Overdue Forms: {{overdueFormCount}}</h3><ul>{{overdueList}}</ul><p><a href="{{dashboardUrl}}">View Dashboard</a></p>',
  'Daily Summary\n\nHi {{userName}},\n\nHere is your daily summary:\n\nOpen Queries: {{openQueryCount}}\n{{queryList}}\n\nPending Signatures: {{pendingSignatureCount}}\n{{signatureList}}\n\nOverdue Forms: {{overdueFormCount}}\n{{overdueList}}\n\nView Dashboard: {{dashboardUrl}}',
  'Daily digest email with summary of pending items',
  '["userName", "date", "openQueryCount", "queryList", "pendingSignatureCount", "signatureList", "overdueFormCount", "overdueList", "dashboardUrl"]'::jsonb
),
(
  'welcome',
  'Welcome to {{studyName}}',
  '<h2>Welcome!</h2><p>Hi {{userName}},</p><p>Your account has been created for the study:</p><p><strong>{{studyName}}</strong></p><p>You can now access the EDC system using your credentials.</p><p><a href="{{loginUrl}}">Login to EDC</a></p><p>If you have any questions, please contact your study coordinator.</p>',
  'Welcome!\n\nHi {{userName}},\n\nYour account has been created for the study:\n\n{{studyName}}\n\nYou can now access the EDC system using your credentials.\n\nLogin: {{loginUrl}}\n\nIf you have any questions, please contact your study coordinator.',
  'Welcome email for new users',
  '["userName", "studyName", "loginUrl"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_notification_preference;
-- DROP TABLE IF EXISTS acc_email_queue;
-- DROP TABLE IF EXISTS acc_email_template;

