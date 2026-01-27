-- ============================================
-- LibreClinica API Demo Database Setup Script
-- ============================================
-- This script creates all required reference data for the API to function properly.
-- Run this against a fresh or existing LibreClinica database.

-- ============================================
-- 1. STATUS TABLE (if not already populated)
-- ============================================
INSERT INTO status (status_id, name, description) VALUES
  (1, 'available', 'Active/Available'),
  (2, 'unavailable', 'Unavailable'),
  (3, 'private', 'Private'),
  (4, 'pending', 'Pending'),
  (5, 'removed', 'Removed/Deleted'),
  (6, 'locked', 'Locked'),
  (7, 'auto-removed', 'Auto-removed'),
  (8, 'signed', 'Signed'),
  (9, 'frozen', 'Frozen'),
  (10, 'source_data_verified', 'Source Data Verified'),
  (11, 'deleted', 'Deleted')
ON CONFLICT (status_id) DO NOTHING;

-- ============================================
-- 2. ITEM DATA TYPES (Critical for form fields)
-- ============================================
INSERT INTO item_data_type (item_data_type_id, code, name, definition, reference) VALUES
  (1, 'BL', 'Boolean', 'Boolean value (true/false)', 'HL7'),
  (2, 'BN', 'Boolean with Null', 'Boolean that allows null', 'HL7'),
  (3, 'ED', 'Encapsulated Data', 'Binary data', 'HL7'),
  (4, 'TEL', 'Telephone', 'Telephone number', 'HL7'),
  (5, 'ST', 'Character String', 'Text string', 'HL7'),
  (6, 'INT', 'Integer', 'Whole number', 'HL7'),
  (7, 'REAL', 'Floating', 'Decimal number', 'HL7'),
  (8, 'SET', 'Set', 'Set of values', 'HL7'),
  (9, 'DATE', 'Date', 'Calendar date (YYYY-MM-DD)', 'ISO'),
  (10, 'PDATE', 'Partial Date', 'Partial date (allows unknown day/month)', 'ISO'),
  (11, 'FILE', 'File', 'File attachment', 'Custom')
ON CONFLICT (item_data_type_id) DO NOTHING;

-- ============================================
-- 3. ITEM REFERENCE TYPES
-- ============================================
INSERT INTO item_reference_type (item_reference_type_id, name, description) VALUES
  (1, 'literal', 'Literal value'),
  (2, 'external', 'External reference'),
  (3, 'calculated', 'Calculated field')
ON CONFLICT (item_reference_type_id) DO NOTHING;

-- ============================================
-- 4. RESPONSE TYPES (for form field display)
-- ============================================
INSERT INTO response_type (response_type_id, name, description) VALUES
  (1, 'text', 'Free text input'),
  (2, 'textarea', 'Multi-line text input'),
  (3, 'radio', 'Radio buttons (single select)'),
  (4, 'checkbox', 'Checkboxes (multi-select)'),
  (5, 'single-select', 'Dropdown single select'),
  (6, 'multi-select', 'Dropdown multi-select'),
  (7, 'calculation', 'Calculated field'),
  (8, 'file', 'File upload'),
  (9, 'instant-calculation', 'Instant calculation')
ON CONFLICT (response_type_id) DO NOTHING;

-- ============================================
-- 5. NULL VALUE TYPES
-- ============================================
INSERT INTO null_value_type (null_value_type_id, code, name, definition, reference) VALUES
  (1, 'NI', 'No Information', 'No information available', 'HL7'),
  (2, 'NA', 'Not Applicable', 'Not applicable', 'HL7'),
  (3, 'UNK', 'Unknown', 'Unknown value', 'HL7'),
  (4, 'NASK', 'Not Asked', 'Not asked', 'HL7'),
  (5, 'ASKU', 'Asked but Unknown', 'Asked but unknown', 'HL7'),
  (6, 'NAV', 'Not Available', 'Temporarily not available', 'HL7'),
  (7, 'OTH', 'Other', 'Other reason', 'HL7'),
  (8, 'PINF', 'Positive Infinity', 'Positive infinity', 'HL7'),
  (9, 'NINF', 'Negative Infinity', 'Negative infinity', 'HL7'),
  (10, 'MSK', 'Masked', 'Masked/hidden', 'HL7'),
  (11, 'NP', 'Not Present', 'Not present', 'HL7')
ON CONFLICT (null_value_type_id) DO NOTHING;

-- ============================================
-- 6. USER TYPES
-- ============================================
INSERT INTO user_type (user_type_id, user_type) VALUES
  (1, 'admin'),
  (2, 'user'),
  (3, 'tech-admin')
ON CONFLICT (user_type_id) DO NOTHING;

-- ============================================
-- 7. STUDY TYPES
-- ============================================
INSERT INTO study_type (study_type_id, name, description) VALUES
  (1, 'interventional', 'Interventional clinical trial'),
  (2, 'observational', 'Observational study'),
  (3, 'expanded_access', 'Expanded access/compassionate use'),
  (4, 'registry', 'Patient registry')
ON CONFLICT (study_type_id) DO NOTHING;

-- ============================================
-- 8. DISCREPANCY NOTE TYPES (for queries)
-- ============================================
INSERT INTO discrepancy_note_type (discrepancy_note_type_id, name, description) VALUES
  (1, 'Failed Validation Check', 'Automatic validation failure'),
  (2, 'Incomplete Data', 'Missing required data'),
  (3, 'Unclear/Illegible', 'Data is unclear or illegible'),
  (4, 'Annotation', 'General annotation/comment'),
  (5, 'Query', 'Data query'),
  (6, 'Reason for Change', 'Reason for data change'),
  (7, 'Other', 'Other type')
ON CONFLICT (discrepancy_note_type_id) DO NOTHING;

-- ============================================
-- 9. RESOLUTION STATUS (for query workflow)
-- ============================================
INSERT INTO resolution_status (resolution_status_id, name, description) VALUES
  (1, 'Open', 'Query is open and needs attention'),
  (2, 'Updated', 'Query has been updated'),
  (3, 'Resolved', 'Query has been resolved'),
  (4, 'Closed', 'Query is closed'),
  (5, 'Not Applicable', 'Query is not applicable')
ON CONFLICT (resolution_status_id) DO NOTHING;

-- ============================================
-- 10. SUBJECT EVENT STATUS
-- ============================================
INSERT INTO subject_event_status (subject_event_status_id, name, description) VALUES
  (1, 'scheduled', 'Event is scheduled'),
  (2, 'data_entry_started', 'Data entry has started'),
  (3, 'completed', 'Event is completed'),
  (4, 'stopped', 'Event was stopped'),
  (5, 'skipped', 'Event was skipped'),
  (6, 'signed', 'Event is signed'),
  (7, 'locked', 'Event is locked'),
  (8, 'source_data_verified', 'Source data verified')
ON CONFLICT (subject_event_status_id) DO NOTHING;

-- ============================================
-- 11. COMPLETION STATUS (for CRF completion)
-- ============================================
INSERT INTO completion_status (completion_status_id, status_id, name, description) VALUES
  (1, 1, 'not_started', 'Not started'),
  (2, 1, 'initial_data_entry', 'Initial data entry'),
  (3, 1, 'data_entry_complete', 'Data entry complete'),
  (4, 1, 'complete', 'Complete')
ON CONFLICT (completion_status_id) DO NOTHING;

-- ============================================
-- 12. GROUP CLASS TYPES (for study groups)
-- ============================================
INSERT INTO group_class_types (group_class_type_id, name, description) VALUES
  (1, 'Arm', 'Treatment arm'),
  (2, 'Family/Pedigree', 'Family or pedigree group'),
  (3, 'Demographic', 'Demographic group'),
  (4, 'Other', 'Other group type')
ON CONFLICT (group_class_type_id) DO NOTHING;

-- ============================================
-- 13. AUDIT LOG EVENT TYPES
-- ============================================
INSERT INTO audit_log_event_type (audit_log_event_type_id, name) VALUES
  (1, 'item_data_value_updated'),
  (2, 'item_data_status_updated'),
  (3, 'study_subject_created'),
  (4, 'study_subject_updated'),
  (5, 'study_subject_status_changed'),
  (6, 'event_crf_created'),
  (7, 'event_crf_updated'),
  (8, 'event_crf_status_changed'),
  (9, 'event_crf_signed'),
  (10, 'event_crf_sdv_status_changed'),
  (11, 'study_event_created'),
  (12, 'study_event_updated'),
  (13, 'study_event_status_changed'),
  (14, 'study_event_signed'),
  (15, 'study_created'),
  (16, 'study_updated'),
  (17, 'study_status_changed'),
  (18, 'user_created'),
  (19, 'user_updated'),
  (20, 'user_status_changed'),
  (21, 'crf_created'),
  (22, 'crf_updated'),
  (23, 'crf_version_created'),
  (24, 'crf_version_updated'),
  (25, 'discrepancy_note_created'),
  (26, 'discrepancy_note_updated'),
  (27, 'discrepancy_note_closed'),
  (28, 'item_data_deleted'),
  (29, 'event_crf_deleted'),
  (30, 'study_event_deleted'),
  (31, 'study_subject_deleted'),
  (32, 'global_subject_created'),
  (33, 'global_subject_updated')
ON CONFLICT (audit_log_event_type_id) DO NOTHING;

-- ============================================
-- 14. DEFAULT ADMIN USER (for demo/testing)
-- ============================================
INSERT INTO user_account (
  user_id, user_name, first_name, last_name, email, 
  passwd, passwd_timestamp, date_lastvisit, 
  owner_id, date_created, status_id, update_id, user_type_id,
  institutional_affiliation, phone, access_code, time_zone, enabled, account_non_locked
) VALUES (
  1, 'root', 'Root', 'Admin', 'root@demo.local',
  '', NOW(), NOW(),
  1, NOW(), 1, 1, 1,
  'Demo Institution', '', '', 'America/New_York', true, true
) ON CONFLICT (user_id) DO UPDATE SET
  user_name = EXCLUDED.user_name,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  email = EXCLUDED.email;

-- Create additional demo users
INSERT INTO user_account (
  user_id, user_name, first_name, last_name, email,
  passwd, passwd_timestamp, date_lastvisit,
  owner_id, date_created, status_id, update_id, user_type_id,
  institutional_affiliation, enabled, account_non_locked
) VALUES 
  (2, 'coordinator', 'Study', 'Coordinator', 'coordinator@demo.local',
   '', NOW(), NOW(), 1, NOW(), 1, 1, 2, 'Demo Institution', true, true),
  (3, 'investigator', 'Principal', 'Investigator', 'investigator@demo.local',
   '', NOW(), NOW(), 1, NOW(), 1, 1, 2, 'Demo Institution', true, true),
  (4, 'monitor', 'Clinical', 'Monitor', 'monitor@demo.local',
   '', NOW(), NOW(), 1, NOW(), 1, 1, 2, 'Demo Institution', true, true),
  (5, 'dataentry', 'Data', 'Entry', 'dataentry@demo.local',
   '', NOW(), NOW(), 1, NOW(), 1, 1, 2, 'Demo Institution', true, true)
ON CONFLICT (user_id) DO NOTHING;

-- Reset sequences to avoid conflicts
SELECT setval('user_account_user_id_seq', (SELECT COALESCE(MAX(user_id), 1) FROM user_account));

-- ============================================
-- 15. USER ROLES
-- ============================================
INSERT INTO user_role (role_id, role_name, parent_id, role_desc) VALUES
  (1, 'admin', NULL, 'System Administrator'),
  (2, 'coordinator', NULL, 'Study Coordinator'),
  (3, 'investigator', NULL, 'Principal Investigator'),
  (4, 'ra', NULL, 'Research Assistant'),
  (5, 'monitor', NULL, 'Clinical Monitor'),
  (6, 'director', NULL, 'Study Director')
ON CONFLICT (role_id) DO NOTHING;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM item_data_type;
  RAISE NOTICE 'item_data_type records: %', v_count;
  
  SELECT COUNT(*) INTO v_count FROM response_type;
  RAISE NOTICE 'response_type records: %', v_count;
  
  SELECT COUNT(*) INTO v_count FROM status;
  RAISE NOTICE 'status records: %', v_count;
  
  SELECT COUNT(*) INTO v_count FROM user_account;
  RAISE NOTICE 'user_account records: %', v_count;
  
  SELECT COUNT(*) INTO v_count FROM discrepancy_note_type;
  RAISE NOTICE 'discrepancy_note_type records: %', v_count;
  
  SELECT COUNT(*) INTO v_count FROM resolution_status;
  RAISE NOTICE 'resolution_status records: %', v_count;
  
  RAISE NOTICE '=== Demo database setup complete! ===';
END $$;

