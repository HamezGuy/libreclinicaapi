-- Migration: ePRO/Patient Portal
-- Created: December 15, 2024
-- Description: Create tables for patient self-reporting and PRO instruments

-- Up Migration
BEGIN;

-- Patient accounts (separate from user_account for subject authentication)
CREATE TABLE IF NOT EXISTS acc_patient_account (
  patient_account_id SERIAL PRIMARY KEY,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) UNIQUE NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  pin_hash VARCHAR(255), -- Hashed PIN for login
  magic_link_token VARCHAR(255),
  magic_link_expires TIMESTAMP,
  preferred_language VARCHAR(10) DEFAULT 'en',
  timezone VARCHAR(50) DEFAULT 'UTC',
  notification_preferences JSONB DEFAULT '{"email": true, "sms": false, "push": true}',
  last_login TIMESTAMP,
  login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, locked
  device_tokens JSONB, -- Push notification tokens
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PRO instrument library (standard questionnaires like PHQ-9, GAD-7, etc.)
CREATE TABLE IF NOT EXISTS acc_pro_instrument (
  instrument_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(50) NOT NULL UNIQUE, -- PHQ-9, GAD-7, SF-36, etc.
  description TEXT,
  version VARCHAR(20),
  category VARCHAR(100), -- depression, anxiety, quality_of_life, pain, etc.
  scoring_algorithm JSONB, -- How to calculate scores
  content JSONB NOT NULL, -- Questions and response options
  reference_url VARCHAR(500),
  license_type VARCHAR(100), -- open, licensed
  language_code VARCHAR(10) DEFAULT 'en',
  estimated_minutes INTEGER,
  status_id INTEGER DEFAULT 1,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Questionnaire assignments to subjects
CREATE TABLE IF NOT EXISTS acc_pro_assignment (
  assignment_id SERIAL PRIMARY KEY,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  study_event_id INTEGER REFERENCES study_event(study_event_id), -- Optional link to visit
  instrument_id INTEGER REFERENCES acc_pro_instrument(instrument_id),
  crf_version_id INTEGER REFERENCES crf_version(crf_version_id), -- Or custom form
  assignment_type VARCHAR(50) DEFAULT 'scheduled', -- scheduled, recurring, ad_hoc
  
  -- Scheduling
  scheduled_date DATE,
  scheduled_time TIME,
  window_before_days INTEGER DEFAULT 0,
  window_after_days INTEGER DEFAULT 3,
  
  -- Recurrence (for daily diaries, etc.)
  recurrence_pattern VARCHAR(50), -- daily, weekly, monthly
  recurrence_end_date DATE,
  recurrence_days JSONB, -- [1,3,5] for Mon/Wed/Fri
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, available, in_progress, completed, expired, cancelled
  available_from TIMESTAMP,
  expires_at TIMESTAMP,
  
  -- Completion tracking
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  response_id INTEGER, -- Links to acc_pro_response when complete
  
  -- Assignment metadata
  assigned_by INTEGER REFERENCES user_account(user_id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PRO responses (submitted questionnaires)
CREATE TABLE IF NOT EXISTS acc_pro_response (
  response_id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES acc_pro_assignment(assignment_id) NOT NULL,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  instrument_id INTEGER REFERENCES acc_pro_instrument(instrument_id),
  
  -- Response data
  answers JSONB NOT NULL, -- Individual answers
  raw_score NUMERIC, -- Calculated raw score
  scaled_score NUMERIC, -- Scaled/normalized score
  score_interpretation VARCHAR(100), -- minimal, mild, moderate, severe
  
  -- Timing
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  time_spent_seconds INTEGER,
  
  -- Device/context info
  device_type VARCHAR(50), -- mobile, tablet, desktop
  user_agent TEXT,
  ip_address VARCHAR(50),
  timezone VARCHAR(50),
  local_timestamp TIMESTAMP, -- Subject's local time
  
  -- Review status
  reviewed_by INTEGER REFERENCES user_account(user_id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PRO reminders
CREATE TABLE IF NOT EXISTS acc_pro_reminder (
  reminder_id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES acc_pro_assignment(assignment_id) NOT NULL,
  patient_account_id INTEGER REFERENCES acc_patient_account(patient_account_id) NOT NULL,
  
  reminder_type VARCHAR(50) NOT NULL, -- email, sms, push
  scheduled_for TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, failed, cancelled
  
  message_subject VARCHAR(255),
  message_body TEXT,
  error_message TEXT,
  
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patient_account_subject ON acc_patient_account(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_patient_account_email ON acc_patient_account(email);
CREATE INDEX IF NOT EXISTS idx_pro_assignment_subject ON acc_pro_assignment(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_pro_assignment_status ON acc_pro_assignment(status);
CREATE INDEX IF NOT EXISTS idx_pro_assignment_date ON acc_pro_assignment(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_pro_response_subject ON acc_pro_response(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_pro_response_assignment ON acc_pro_response(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pro_reminder_scheduled ON acc_pro_reminder(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_pro_reminder_status ON acc_pro_reminder(status);

-- Insert standard PRO instruments
INSERT INTO acc_pro_instrument (short_name, name, description, category, estimated_minutes, scoring_algorithm, content)
VALUES 
(
  'PHQ-9',
  'Patient Health Questionnaire-9',
  'A brief depression severity measure used to screen, diagnose, monitor and measure the severity of depression.',
  'depression',
  5,
  '{"method": "sum", "ranges": [{"min": 0, "max": 4, "label": "Minimal"}, {"min": 5, "max": 9, "label": "Mild"}, {"min": 10, "max": 14, "label": "Moderate"}, {"min": 15, "max": 19, "label": "Moderately Severe"}, {"min": 20, "max": 27, "label": "Severe"}]}'::jsonb,
  '{"questions": [{"id": "phq1", "text": "Little interest or pleasure in doing things", "type": "likert", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"id": "phq2", "text": "Feeling down, depressed, or hopeless", "type": "likert", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}]}'::jsonb
),
(
  'GAD-7',
  'Generalized Anxiety Disorder 7-item',
  'A seven-item instrument used to screen for generalized anxiety disorder.',
  'anxiety',
  3,
  '{"method": "sum", "ranges": [{"min": 0, "max": 4, "label": "Minimal"}, {"min": 5, "max": 9, "label": "Mild"}, {"min": 10, "max": 14, "label": "Moderate"}, {"min": 15, "max": 21, "label": "Severe"}]}'::jsonb,
  '{"questions": [{"id": "gad1", "text": "Feeling nervous, anxious, or on edge", "type": "likert", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}, {"id": "gad2", "text": "Not being able to stop or control worrying", "type": "likert", "options": [{"value": 0, "label": "Not at all"}, {"value": 1, "label": "Several days"}, {"value": 2, "label": "More than half the days"}, {"value": 3, "label": "Nearly every day"}]}]}'::jsonb
),
(
  'VAS-PAIN',
  'Visual Analog Scale - Pain',
  'A simple pain intensity scale from 0 to 10.',
  'pain',
  1,
  '{"method": "direct", "ranges": [{"min": 0, "max": 0, "label": "No Pain"}, {"min": 1, "max": 3, "label": "Mild"}, {"min": 4, "max": 6, "label": "Moderate"}, {"min": 7, "max": 10, "label": "Severe"}]}'::jsonb,
  '{"questions": [{"id": "vas1", "text": "Rate your pain on a scale of 0-10 (0 = no pain, 10 = worst pain imaginable)", "type": "slider", "min": 0, "max": 10, "step": 1}]}'::jsonb
)
ON CONFLICT (short_name) DO NOTHING;

-- Add email templates for ePRO
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'pro_questionnaire_available',
  'Questionnaire Ready - {{studyName}}',
  '<h2>Questionnaire Available</h2><p>Dear Participant,</p><p>A new questionnaire is ready for you to complete:</p><p><strong>{{questionnaireName}}</strong></p><p>Please complete this by {{dueDate}}.</p><p><a href="{{portalUrl}}">Go to Patient Portal</a></p><p>If you have any questions, please contact your study team.</p>',
  'Questionnaire Available\n\nDear Participant,\n\nA new questionnaire is ready for you to complete:\n\n{{questionnaireName}}\n\nPlease complete this by {{dueDate}}.\n\nGo to Patient Portal: {{portalUrl}}\n\nIf you have any questions, please contact your study team.',
  'Notification when a new PRO questionnaire is available',
  '["studyName", "questionnaireName", "dueDate", "portalUrl"]'::jsonb
),
(
  'pro_reminder',
  'Reminder: Questionnaire Due - {{studyName}}',
  '<h2>Reminder</h2><p>Dear Participant,</p><p>This is a reminder that your questionnaire is due:</p><p><strong>{{questionnaireName}}</strong></p><p>Due Date: {{dueDate}}</p><p><a href="{{portalUrl}}">Complete Questionnaire</a></p>',
  'Reminder\n\nDear Participant,\n\nThis is a reminder that your questionnaire is due:\n\n{{questionnaireName}}\n\nDue Date: {{dueDate}}\n\nComplete Questionnaire: {{portalUrl}}',
  'Reminder for pending PRO questionnaire',
  '["studyName", "questionnaireName", "dueDate", "portalUrl"]'::jsonb
),
(
  'pro_magic_link',
  'Your Login Link - {{studyName}}',
  '<h2>Login to Patient Portal</h2><p>Dear Participant,</p><p>Click the link below to access your Patient Portal:</p><p><a href="{{magicLink}}">Access Patient Portal</a></p><p>This link will expire in 15 minutes.</p><p>If you did not request this link, please ignore this email.</p>',
  'Login to Patient Portal\n\nDear Participant,\n\nClick the link below to access your Patient Portal:\n\n{{magicLink}}\n\nThis link will expire in 15 minutes.\n\nIf you did not request this link, please ignore this email.',
  'Magic link for patient portal login',
  '["studyName", "magicLink"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_pro_reminder;
-- DROP TABLE IF EXISTS acc_pro_response;
-- DROP TABLE IF EXISTS acc_pro_assignment;
-- DROP TABLE IF EXISTS acc_pro_instrument;
-- DROP TABLE IF EXISTS acc_patient_account;

