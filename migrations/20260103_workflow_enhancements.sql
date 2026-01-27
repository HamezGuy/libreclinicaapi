-- Migration: Workflow Enhancements for Real EDC Patterns
-- Created: January 3, 2026
-- Description: Ensures workflow-related tables exist for auto-triggered workflows
-- 
-- This migration supports the real EDC workflow patterns:
-- - Form submission → SDV Required workflow
-- - Subject enrollment → Enrollment Verification workflow
-- - SDV completion → Auto-close related workflows
-- - E-signature → Auto-close signature workflows

BEGIN;

-- Ensure dn_event_crf_map exists (links discrepancy notes to event_crf records)
-- This table is needed to track which workflows relate to which forms
CREATE TABLE IF NOT EXISTS dn_event_crf_map (
  discrepancy_note_id INTEGER NOT NULL REFERENCES discrepancy_note(discrepancy_note_id) ON DELETE CASCADE,
  event_crf_id INTEGER NOT NULL REFERENCES event_crf(event_crf_id) ON DELETE CASCADE,
  column_name VARCHAR(255),
  PRIMARY KEY (discrepancy_note_id, event_crf_id)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_dn_event_crf_dn ON dn_event_crf_map(discrepancy_note_id);
CREATE INDEX IF NOT EXISTS idx_dn_event_crf_ec ON dn_event_crf_map(event_crf_id);

-- Ensure dn_item_data_map exists (links discrepancy notes to item_data records)
CREATE TABLE IF NOT EXISTS dn_item_data_map (
  discrepancy_note_id INTEGER NOT NULL REFERENCES discrepancy_note(discrepancy_note_id) ON DELETE CASCADE,
  item_data_id INTEGER NOT NULL REFERENCES item_data(item_data_id) ON DELETE CASCADE,
  column_name VARCHAR(255),
  PRIMARY KEY (discrepancy_note_id, item_data_id)
);

CREATE INDEX IF NOT EXISTS idx_dn_item_data_dn ON dn_item_data_map(discrepancy_note_id);
CREATE INDEX IF NOT EXISTS idx_dn_item_data_id ON dn_item_data_map(item_data_id);

-- Add date_updated column to discrepancy_note if it doesn't exist
-- This is needed for tracking workflow status changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'discrepancy_note' AND column_name = 'date_updated'
  ) THEN
    ALTER TABLE discrepancy_note ADD COLUMN date_updated TIMESTAMP;
  END IF;
END $$;

-- Create index on discrepancy_note for workflow queries
CREATE INDEX IF NOT EXISTS idx_dn_assigned_user ON discrepancy_note(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_dn_owner ON discrepancy_note(owner_id);
CREATE INDEX IF NOT EXISTS idx_dn_study ON discrepancy_note(study_id);
CREATE INDEX IF NOT EXISTS idx_dn_status ON discrepancy_note(resolution_status_id);
CREATE INDEX IF NOT EXISTS idx_dn_created ON discrepancy_note(date_created);

-- Add email templates for workflow notifications
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'workflow_assigned',
  'New Task Assigned: {{taskTitle}} - {{studyName}}',
  '<h2>You have been assigned a new task</h2><p>Hi {{userName}},</p><p><strong>Task:</strong> {{taskTitle}}</p><p><strong>Description:</strong> {{taskDescription}}</p><p><strong>Priority:</strong> {{priority}}</p><p><strong>Due Date:</strong> {{dueDate}}</p><p>Please log in to the EDC system to view and complete this task.</p><p><a href="{{dashboardUrl}}">View Task</a></p>',
  'New Task Assigned: {{taskTitle}}\n\nHi {{userName}},\n\nTask: {{taskTitle}}\nDescription: {{taskDescription}}\nPriority: {{priority}}\nDue Date: {{dueDate}}\n\nView task: {{dashboardUrl}}',
  'Notification when a workflow task is assigned to a user',
  '["userName", "studyName", "taskTitle", "taskDescription", "priority", "dueDate", "dashboardUrl"]'::jsonb
),
(
  'workflow_completed',
  'Task Completed: {{taskTitle}} - {{studyName}}',
  '<h2>Task Completed</h2><p>Hi {{userName}},</p><p>The following task has been completed:</p><p><strong>Task:</strong> {{taskTitle}}</p><p><strong>Completed By:</strong> {{completedByName}}</p><p><strong>Completed At:</strong> {{completedAt}}</p>',
  'Task Completed: {{taskTitle}}\n\nHi {{userName}},\n\nTask: {{taskTitle}}\nCompleted By: {{completedByName}}\nCompleted At: {{completedAt}}',
  'Notification when a workflow task is completed',
  '["userName", "studyName", "taskTitle", "completedByName", "completedAt"]'::jsonb
),
(
  'sdv_required',
  'SDV Required: {{formName}} - {{studyName}}',
  '<h2>Source Data Verification Required</h2><p>Hi {{userName}},</p><p>A form requires SDV:</p><table><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Submitted By:</strong></td><td>{{submittedByName}}</td></tr></table><p><a href="{{sdvUrl}}">Perform SDV</a></p>',
  'SDV Required: {{formName}}\n\nHi {{userName}},\n\nForm: {{formName}}\nSubject: {{subjectLabel}}\nSubmitted By: {{submittedByName}}\n\nPerform SDV: {{sdvUrl}}',
  'Notification when SDV is required for a form',
  '["userName", "studyName", "formName", "subjectLabel", "submittedByName", "sdvUrl"]'::jsonb
),
(
  'enrollment_verification',
  'Enrollment Verification Required: {{subjectLabel}} - {{studyName}}',
  '<h2>Enrollment Verification Required</h2><p>Hi {{userName}},</p><p>A new subject enrollment requires verification:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Enrolled By:</strong></td><td>{{enrolledByName}}</td></tr><tr><td><strong>Enrollment Date:</strong></td><td>{{enrollmentDate}}</td></tr></table><p><a href="{{subjectUrl}}">Verify Enrollment</a></p>',
  'Enrollment Verification Required: {{subjectLabel}}\n\nHi {{userName}},\n\nSubject: {{subjectLabel}}\nEnrolled By: {{enrolledByName}}\nEnrollment Date: {{enrollmentDate}}\n\nVerify: {{subjectUrl}}',
  'Notification when subject enrollment needs verification',
  '["userName", "studyName", "subjectLabel", "enrolledByName", "enrollmentDate", "subjectUrl"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP INDEX IF EXISTS idx_dn_event_crf_dn;
-- DROP INDEX IF EXISTS idx_dn_event_crf_ec;
-- DROP TABLE IF EXISTS dn_event_crf_map;
-- DROP INDEX IF EXISTS idx_dn_item_data_dn;
-- DROP INDEX IF EXISTS idx_dn_item_data_id;
-- DROP TABLE IF EXISTS dn_item_data_map;

