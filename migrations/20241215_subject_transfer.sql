-- Migration: Subject Transfer
-- Created: December 15, 2024
-- Description: Create tables for subject transfer between sites

-- Up Migration
BEGIN;

-- Transfer log table
CREATE TABLE IF NOT EXISTS acc_transfer_log (
  transfer_id SERIAL PRIMARY KEY,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  study_id INTEGER REFERENCES study(study_id) NOT NULL,
  source_site_id INTEGER REFERENCES study(study_id) NOT NULL, -- Site is child study
  destination_site_id INTEGER REFERENCES study(study_id) NOT NULL,
  reason_for_transfer TEXT NOT NULL,
  transfer_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, completed, cancelled
  requires_approvals BOOLEAN DEFAULT true, -- Whether e-signature approvals are needed
  initiated_by INTEGER REFERENCES user_account(user_id) NOT NULL,
  initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_approved_by INTEGER REFERENCES user_account(user_id),
  source_approved_at TIMESTAMP,
  source_signature_id INTEGER, -- Reference to e-signature if required
  destination_approved_by INTEGER REFERENCES user_account(user_id),
  destination_approved_at TIMESTAMP,
  destination_signature_id INTEGER, -- Reference to e-signature if required
  completed_by INTEGER REFERENCES user_account(user_id),
  completed_at TIMESTAMP,
  cancelled_by INTEGER REFERENCES user_account(user_id),
  cancelled_at TIMESTAMP,
  cancel_reason TEXT,
  notes TEXT,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transfer_subject ON acc_transfer_log(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_transfer_status ON acc_transfer_log(transfer_status);
CREATE INDEX IF NOT EXISTS idx_transfer_source ON acc_transfer_log(source_site_id);
CREATE INDEX IF NOT EXISTS idx_transfer_dest ON acc_transfer_log(destination_site_id);
CREATE INDEX IF NOT EXISTS idx_transfer_study ON acc_transfer_log(study_id);

-- Add email templates for transfers
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'transfer_initiated',
  'Subject Transfer Initiated - {{studyName}}',
  '<h2>Subject Transfer Initiated</h2><p>Hi {{userName}},</p><p>A subject transfer has been initiated:</p><table><tr><td><strong>Subject ID:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>From Site:</strong></td><td>{{sourceSiteName}}</td></tr><tr><td><strong>To Site:</strong></td><td>{{destinationSiteName}}</td></tr><tr><td><strong>Reason:</strong></td><td>{{reason}}</td></tr><tr><td><strong>Initiated By:</strong></td><td>{{initiatedByName}}</td></tr></table><p><a href="{{transferUrl}}">View Transfer Details</a></p>',
  'Subject Transfer Initiated\n\nHi {{userName}},\n\nA subject transfer has been initiated:\n\nSubject ID: {{subjectLabel}}\nFrom Site: {{sourceSiteName}}\nTo Site: {{destinationSiteName}}\nReason: {{reason}}\nInitiated By: {{initiatedByName}}\n\nView Transfer Details: {{transferUrl}}',
  'Notification when a subject transfer is initiated',
  '["userName", "studyName", "subjectLabel", "sourceSiteName", "destinationSiteName", "reason", "initiatedByName", "transferUrl"]'::jsonb
),
(
  'transfer_approval_required',
  'Transfer Approval Required - {{studyName}}',
  '<h2>Transfer Approval Required</h2><p>Hi {{userName}},</p><p>Your approval is required for a subject transfer:</p><table><tr><td><strong>Subject ID:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>From Site:</strong></td><td>{{sourceSiteName}}</td></tr><tr><td><strong>To Site:</strong></td><td>{{destinationSiteName}}</td></tr><tr><td><strong>Reason:</strong></td><td>{{reason}}</td></tr></table><p>Please review and provide your approval with electronic signature.</p><p><a href="{{approvalUrl}}">Review and Approve</a></p>',
  'Transfer Approval Required\n\nHi {{userName}},\n\nYour approval is required for a subject transfer:\n\nSubject ID: {{subjectLabel}}\nFrom Site: {{sourceSiteName}}\nTo Site: {{destinationSiteName}}\nReason: {{reason}}\n\nPlease review and provide your approval with electronic signature.\n\nReview and Approve: {{approvalUrl}}',
  'Notification when transfer approval is required',
  '["userName", "studyName", "subjectLabel", "sourceSiteName", "destinationSiteName", "reason", "approvalUrl"]'::jsonb
),
(
  'transfer_completed',
  'Subject Transfer Completed - {{studyName}}',
  '<h2>Subject Transfer Completed</h2><p>Hi {{userName}},</p><p>A subject transfer has been completed:</p><table><tr><td><strong>Subject ID:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>From Site:</strong></td><td>{{sourceSiteName}}</td></tr><tr><td><strong>To Site:</strong></td><td>{{destinationSiteName}}</td></tr><tr><td><strong>Completed By:</strong></td><td>{{completedByName}}</td></tr><tr><td><strong>Completed At:</strong></td><td>{{completedAt}}</td></tr></table><p>The subject is now assigned to the destination site and data entry can resume.</p><p><a href="{{subjectUrl}}">View Subject</a></p>',
  'Subject Transfer Completed\n\nHi {{userName}},\n\nA subject transfer has been completed:\n\nSubject ID: {{subjectLabel}}\nFrom Site: {{sourceSiteName}}\nTo Site: {{destinationSiteName}}\nCompleted By: {{completedByName}}\nCompleted At: {{completedAt}}\n\nThe subject is now assigned to the destination site and data entry can resume.\n\nView Subject: {{subjectUrl}}',
  'Notification when a transfer is completed',
  '["userName", "studyName", "subjectLabel", "sourceSiteName", "destinationSiteName", "completedByName", "completedAt", "subjectUrl"]'::jsonb
),
(
  'transfer_cancelled',
  'Subject Transfer Cancelled - {{studyName}}',
  '<h2>Subject Transfer Cancelled</h2><p>Hi {{userName}},</p><p>A subject transfer has been cancelled:</p><table><tr><td><strong>Subject ID:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Cancelled By:</strong></td><td>{{cancelledByName}}</td></tr><tr><td><strong>Reason:</strong></td><td>{{cancelReason}}</td></tr></table><p>The subject remains at the original site.</p>',
  'Subject Transfer Cancelled\n\nHi {{userName}},\n\nA subject transfer has been cancelled:\n\nSubject ID: {{subjectLabel}}\nCancelled By: {{cancelledByName}}\nReason: {{cancelReason}}\n\nThe subject remains at the original site.',
  'Notification when a transfer is cancelled',
  '["userName", "studyName", "subjectLabel", "cancelledByName", "cancelReason"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_transfer_log;

