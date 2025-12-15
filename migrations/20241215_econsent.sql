-- Migration: eConsent Module
-- Created: December 15, 2024
-- Description: Create tables for electronic consent management

-- Up Migration
BEGIN;

-- Consent document templates
CREATE TABLE IF NOT EXISTS acc_consent_document (
  document_id SERIAL PRIMARY KEY,
  study_id INTEGER REFERENCES study(study_id) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  document_type VARCHAR(50) DEFAULT 'main', -- main, assent, lar, optional, addendum
  language_code VARCHAR(10) DEFAULT 'en',
  status VARCHAR(20) DEFAULT 'draft', -- draft, active, retired
  requires_witness BOOLEAN DEFAULT false,
  requires_lar BOOLEAN DEFAULT false,
  age_of_majority INTEGER DEFAULT 18, -- For assent determination
  min_reading_time INTEGER DEFAULT 60, -- Minimum seconds required to read
  owner_id INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(study_id, name, language_code)
);

-- Consent document versions
CREATE TABLE IF NOT EXISTS acc_consent_version (
  version_id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES acc_consent_document(document_id) NOT NULL,
  version_number VARCHAR(20) NOT NULL,
  version_name VARCHAR(100),
  content JSONB NOT NULL, -- Structured content (sections, pages, acknowledgments)
  pdf_template TEXT, -- HTML template for PDF generation
  effective_date DATE NOT NULL,
  expiration_date DATE,
  irb_approval_date DATE,
  irb_approval_number VARCHAR(100),
  change_summary TEXT, -- What changed from previous version
  status VARCHAR(20) DEFAULT 'draft', -- draft, approved, active, superseded
  approved_by INTEGER REFERENCES user_account(user_id),
  approved_at TIMESTAMP,
  created_by INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subject consent records
CREATE TABLE IF NOT EXISTS acc_subject_consent (
  consent_id SERIAL PRIMARY KEY,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  version_id INTEGER REFERENCES acc_consent_version(version_id) NOT NULL,
  consent_type VARCHAR(50) DEFAULT 'subject', -- subject, witness, lar, reconsent
  consent_status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, consented, declined, withdrawn, expired
  
  -- Subject signature
  subject_name VARCHAR(255),
  subject_signature_data JSONB, -- Signature image/data
  subject_signed_at TIMESTAMP,
  subject_ip_address VARCHAR(50),
  subject_user_agent TEXT,
  
  -- Witness signature (if required)
  witness_name VARCHAR(255),
  witness_relationship VARCHAR(100),
  witness_signature_data JSONB,
  witness_signed_at TIMESTAMP,
  
  -- LAR signature (if applicable)
  lar_name VARCHAR(255),
  lar_relationship VARCHAR(100),
  lar_signature_data JSONB,
  lar_signed_at TIMESTAMP,
  lar_reason TEXT, -- Why LAR is consenting (minor, incapacitated, etc.)
  
  -- Consent process tracking
  presented_at TIMESTAMP, -- When consent form was shown
  time_spent_reading INTEGER, -- Total seconds spent on form
  pages_viewed JSONB, -- Track which pages were viewed and for how long
  acknowledgments_checked JSONB, -- Which acknowledgments were checked
  questions_asked TEXT, -- Record of questions during consent
  
  -- Copy provided
  copy_emailed_to VARCHAR(255),
  copy_emailed_at TIMESTAMP,
  pdf_file_path VARCHAR(500),
  
  -- Withdrawal
  withdrawn_at TIMESTAMP,
  withdrawal_reason TEXT,
  withdrawn_by INTEGER REFERENCES user_account(user_id),
  
  -- Audit
  consented_by INTEGER REFERENCES user_account(user_id), -- Staff who obtained consent
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Re-consent tracking
CREATE TABLE IF NOT EXISTS acc_reconsent_request (
  request_id SERIAL PRIMARY KEY,
  version_id INTEGER REFERENCES acc_consent_version(version_id) NOT NULL,
  study_subject_id INTEGER REFERENCES study_subject(study_subject_id) NOT NULL,
  previous_consent_id INTEGER REFERENCES acc_subject_consent(consent_id),
  reason TEXT NOT NULL, -- Protocol amendment, version update, etc.
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  requested_by INTEGER REFERENCES user_account(user_id),
  due_date DATE, -- When re-consent should be completed by
  completed_consent_id INTEGER REFERENCES acc_subject_consent(consent_id),
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, declined, waived
  waived_by INTEGER REFERENCES user_account(user_id),
  waived_reason TEXT,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consent_doc_study ON acc_consent_document(study_id);
CREATE INDEX IF NOT EXISTS idx_consent_doc_status ON acc_consent_document(status);
CREATE INDEX IF NOT EXISTS idx_consent_ver_doc ON acc_consent_version(document_id);
CREATE INDEX IF NOT EXISTS idx_consent_ver_status ON acc_consent_version(status);
CREATE INDEX IF NOT EXISTS idx_consent_ver_effective ON acc_consent_version(effective_date);
CREATE INDEX IF NOT EXISTS idx_subject_consent_subject ON acc_subject_consent(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_consent_status ON acc_subject_consent(consent_status);
CREATE INDEX IF NOT EXISTS idx_subject_consent_version ON acc_subject_consent(version_id);
CREATE INDEX IF NOT EXISTS idx_reconsent_subject ON acc_reconsent_request(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_reconsent_status ON acc_reconsent_request(status);

-- Add email templates for consent
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'consent_copy',
  'Your Signed Consent Form - {{studyName}}',
  '<h2>Consent Form Copy</h2><p>Dear {{subjectName}},</p><p>Thank you for providing your informed consent to participate in the study:</p><p><strong>{{studyName}}</strong></p><p>Attached is a copy of your signed consent form for your records.</p><p>If you have any questions about the study or your participation, please contact the study team.</p><p>Date of consent: {{consentDate}}</p><p>Version: {{versionNumber}}</p><hr><p>This is an automated message from AccuraTrials EDC.</p>',
  'Consent Form Copy\n\nDear {{subjectName}},\n\nThank you for providing your informed consent to participate in the study:\n\n{{studyName}}\n\nAttached is a copy of your signed consent form for your records.\n\nIf you have any questions about the study or your participation, please contact the study team.\n\nDate of consent: {{consentDate}}\nVersion: {{versionNumber}}',
  'Email sent to subject with copy of signed consent',
  '["subjectName", "studyName", "consentDate", "versionNumber"]'::jsonb
),
(
  'reconsent_required',
  'Re-consent Required - {{studyName}}',
  '<h2>Re-consent Required</h2><p>Hi {{userName}},</p><p>A subject requires re-consent due to a protocol update:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Previous Version:</strong></td><td>{{previousVersion}}</td></tr><tr><td><strong>New Version:</strong></td><td>{{newVersion}}</td></tr><tr><td><strong>Reason:</strong></td><td>{{reason}}</td></tr><tr><td><strong>Due Date:</strong></td><td>{{dueDate}}</td></tr></table><p><a href="{{consentUrl}}">Initiate Re-consent</a></p>',
  'Re-consent Required\n\nHi {{userName}},\n\nA subject requires re-consent due to a protocol update:\n\nSubject: {{subjectLabel}}\nPrevious Version: {{previousVersion}}\nNew Version: {{newVersion}}\nReason: {{reason}}\nDue Date: {{dueDate}}\n\nInitiate Re-consent: {{consentUrl}}',
  'Notification when subject requires re-consent',
  '["userName", "studyName", "subjectLabel", "previousVersion", "newVersion", "reason", "dueDate", "consentUrl"]'::jsonb
),
(
  'consent_withdrawn',
  'Consent Withdrawn - {{studyName}}',
  '<h2>Consent Withdrawn</h2><p>Hi {{userName}},</p><p>A subject has withdrawn their consent:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Withdrawn By:</strong></td><td>{{withdrawnByName}}</td></tr><tr><td><strong>Date:</strong></td><td>{{withdrawnDate}}</td></tr><tr><td><strong>Reason:</strong></td><td>{{reason}}</td></tr></table><p>The subject''s data entry has been blocked.</p>',
  'Consent Withdrawn\n\nHi {{userName}},\n\nA subject has withdrawn their consent:\n\nSubject: {{subjectLabel}}\nWithdrawn By: {{withdrawnByName}}\nDate: {{withdrawnDate}}\nReason: {{reason}}\n\nThe subject''s data entry has been blocked.',
  'Notification when subject withdraws consent',
  '["userName", "studyName", "subjectLabel", "withdrawnByName", "withdrawnDate", "reason"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_reconsent_request;
-- DROP TABLE IF EXISTS acc_subject_consent;
-- DROP TABLE IF EXISTS acc_consent_version;
-- DROP TABLE IF EXISTS acc_consent_document;

