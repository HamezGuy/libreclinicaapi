-- Migration: Double Data Entry (DDE)
-- Created: December 15, 2024
-- Description: Create tables for double data entry workflow

-- Up Migration
BEGIN;

-- DDE entry records (stores second entry for comparison)
CREATE TABLE IF NOT EXISTS acc_dde_entry (
  dde_entry_id SERIAL PRIMARY KEY,
  event_crf_id INTEGER REFERENCES event_crf(event_crf_id) NOT NULL,
  item_id INTEGER REFERENCES item(item_id) NOT NULL,
  item_data_id INTEGER REFERENCES item_data(item_data_id), -- Links to first entry
  second_entry_value TEXT,
  entered_by INTEGER REFERENCES user_account(user_id) NOT NULL,
  entered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  matches_first BOOLEAN, -- Computed after comparison
  UNIQUE(event_crf_id, item_id) -- One DDE entry per item
);

-- DDE discrepancies
CREATE TABLE IF NOT EXISTS acc_dde_discrepancy (
  discrepancy_id SERIAL PRIMARY KEY,
  event_crf_id INTEGER REFERENCES event_crf(event_crf_id) NOT NULL,
  item_id INTEGER REFERENCES item(item_id) NOT NULL,
  dde_entry_id INTEGER REFERENCES acc_dde_entry(dde_entry_id),
  first_value TEXT,
  second_value TEXT,
  resolution_status VARCHAR(20) DEFAULT 'open', -- open, first_correct, second_correct, new_value, adjudicated
  resolved_value TEXT,
  resolved_by INTEGER REFERENCES user_account(user_id),
  resolved_at TIMESTAMP,
  adjudicated_by INTEGER REFERENCES user_account(user_id),
  adjudication_notes TEXT,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_crf_id, item_id) -- One discrepancy per item per form
);

-- DDE status tracking per event_crf
CREATE TABLE IF NOT EXISTS acc_dde_status (
  status_id SERIAL PRIMARY KEY,
  event_crf_id INTEGER REFERENCES event_crf(event_crf_id) NOT NULL UNIQUE,
  crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
  first_entry_status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, complete
  first_entry_by INTEGER REFERENCES user_account(user_id),
  first_entry_at TIMESTAMP,
  second_entry_status VARCHAR(20) DEFAULT 'pending',
  second_entry_by INTEGER REFERENCES user_account(user_id),
  second_entry_at TIMESTAMP,
  comparison_status VARCHAR(20) DEFAULT 'pending', -- pending, matched, discrepancies, resolved
  total_items INTEGER DEFAULT 0,
  matched_items INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  resolved_count INTEGER DEFAULT 0,
  dde_complete BOOLEAN DEFAULT false,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dde_entry_crf ON acc_dde_entry(event_crf_id);
CREATE INDEX IF NOT EXISTS idx_dde_entry_item ON acc_dde_entry(item_id);
CREATE INDEX IF NOT EXISTS idx_dde_disc_crf ON acc_dde_discrepancy(event_crf_id);
CREATE INDEX IF NOT EXISTS idx_dde_disc_status ON acc_dde_discrepancy(resolution_status);
CREATE INDEX IF NOT EXISTS idx_dde_status_crf ON acc_dde_status(event_crf_id);
CREATE INDEX IF NOT EXISTS idx_dde_status_complete ON acc_dde_status(dde_complete);

-- Add email templates for DDE notifications
INSERT INTO acc_email_template (name, subject, html_body, text_body, description, variables)
VALUES 
(
  'dde_second_entry_required',
  'Second Entry Required - {{studyName}}',
  '<h2>Second Data Entry Required</h2><p>Hi {{userName}},</p><p>A form requires second data entry:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Event:</strong></td><td>{{eventName}}</td></tr><tr><td><strong>First Entry By:</strong></td><td>{{firstEntryByName}}</td></tr></table><p><a href="{{formUrl}}">Perform Second Entry</a></p>',
  'Second Data Entry Required\n\nHi {{userName}},\n\nA form requires second data entry:\n\nSubject: {{subjectLabel}}\nForm: {{formName}}\nEvent: {{eventName}}\nFirst Entry By: {{firstEntryByName}}\n\nPerform Second Entry: {{formUrl}}',
  'Notification when DDE second entry is required',
  '["userName", "studyName", "subjectLabel", "formName", "eventName", "firstEntryByName", "formUrl"]'::jsonb
),
(
  'dde_discrepancy_detected',
  'DDE Discrepancies Found - {{studyName}}',
  '<h2>Data Entry Discrepancies Detected</h2><p>Hi {{userName}},</p><p>Discrepancies were found between first and second entries:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Discrepancies:</strong></td><td>{{discrepancyCount}} items</td></tr></table><p>Please review and resolve these discrepancies.</p><p><a href="{{comparisonUrl}}">Review Discrepancies</a></p>',
  'Data Entry Discrepancies Detected\n\nHi {{userName}},\n\nDiscrepancies were found between first and second entries:\n\nSubject: {{subjectLabel}}\nForm: {{formName}}\nDiscrepancies: {{discrepancyCount}} items\n\nPlease review and resolve these discrepancies.\n\nReview Discrepancies: {{comparisonUrl}}',
  'Notification when DDE discrepancies are detected',
  '["userName", "studyName", "subjectLabel", "formName", "discrepancyCount", "comparisonUrl"]'::jsonb
),
(
  'dde_complete',
  'DDE Complete - {{studyName}}',
  '<h2>Double Data Entry Complete</h2><p>Hi {{userName}},</p><p>Double data entry has been completed and all discrepancies resolved:</p><table><tr><td><strong>Subject:</strong></td><td>{{subjectLabel}}</td></tr><tr><td><strong>Form:</strong></td><td>{{formName}}</td></tr><tr><td><strong>Total Items:</strong></td><td>{{totalItems}}</td></tr><tr><td><strong>Match Rate:</strong></td><td>{{matchRate}}%</td></tr></table><p>The data has been finalized.</p>',
  'Double Data Entry Complete\n\nHi {{userName}},\n\nDouble data entry has been completed and all discrepancies resolved:\n\nSubject: {{subjectLabel}}\nForm: {{formName}}\nTotal Items: {{totalItems}}\nMatch Rate: {{matchRate}}%\n\nThe data has been finalized.',
  'Notification when DDE is complete',
  '["userName", "studyName", "subjectLabel", "formName", "totalItems", "matchRate"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_dde_discrepancy;
-- DROP TABLE IF EXISTS acc_dde_entry;
-- DROP TABLE IF EXISTS acc_dde_status;

