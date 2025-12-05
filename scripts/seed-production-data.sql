-- ============================================================================
-- LibreClinica Production Data Seed Script
-- ============================================================================
-- This script populates the production database with comprehensive test data
-- including users, patients, events, forms, queries, and more.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADDITIONAL USERS (investigators, monitors, coordinators)
-- ============================================================================
-- Password hash for "Password123!" = MD5 = 482c811da5d5b4bc6d497ffa98491e38

INSERT INTO user_account (user_id, user_name, passwd, first_name, last_name, email, active_study, institutional_affiliation, status_id, owner_id, date_created, date_updated, phone, user_type_id, update_id)
VALUES 
  (2, 'investigator', '482c811da5d5b4bc6d497ffa98491e38', 'Dr. Sarah', 'Johnson', 'sarah.johnson@hospital.org', 1, 'General Hospital', 1, 1, NOW(), NOW(), '555-0101', 2, 1),
  (3, 'coordinator', '482c811da5d5b4bc6d497ffa98491e38', 'Michael', 'Chen', 'michael.chen@hospital.org', 1, 'General Hospital', 1, 1, NOW(), NOW(), '555-0102', 2, 1),
  (4, 'monitor', '482c811da5d5b4bc6d497ffa98491e38', 'Emily', 'Williams', 'emily.williams@cro.com', 1, 'CRO Partners Inc', 1, 1, NOW(), NOW(), '555-0103', 2, 1),
  (5, 'dataentry', '482c811da5d5b4bc6d497ffa98491e38', 'James', 'Brown', 'james.brown@hospital.org', 1, 'General Hospital', 1, 1, NOW(), NOW(), '555-0104', 2, 1)
ON CONFLICT (user_id) DO NOTHING;

-- Update sequence
SELECT setval('user_account_user_id_seq', (SELECT MAX(user_id) FROM user_account));

-- ============================================================================
-- 2. STUDY USER ROLES
-- ============================================================================

INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, date_created, date_updated, update_id, user_name)
VALUES
  ('investigator', 1, 1, 1, NOW(), NOW(), 1, 'investigator'),
  ('clinical_research_coordinator', 1, 1, 1, NOW(), NOW(), 1, 'coordinator'),
  ('monitor', 1, 1, 1, NOW(), NOW(), 1, 'monitor'),
  ('data_entry_person', 1, 1, 1, NOW(), NOW(), 1, 'dataentry'),
  ('study_director', 1, 1, 1, NOW(), NOW(), 1, 'root')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. UPDATE STUDY WITH BETTER INFO
-- ============================================================================

UPDATE study SET 
  name = 'AccuraTrials Clinical Study',
  official_title = 'A Phase III Randomized Controlled Trial for Drug Safety Evaluation',
  unique_identifier = 'AT-2024-001',
  secondary_identifier = 'ACCURA-001',
  summary = 'A comprehensive clinical trial to evaluate the safety and efficacy of the investigational drug in patients with chronic conditions.',
  protocol_description = 'This study is designed to assess the safety profile and therapeutic efficacy of the study drug compared to placebo over a 12-week treatment period.',
  date_planned_start = '2024-01-01',
  date_planned_end = '2025-12-31',
  principal_investigator = 'Dr. Sarah Johnson, MD, PhD',
  sponsor = 'AccuraTrials Research',
  facility_name = 'General Hospital Clinical Research Center',
  facility_city = 'Boston',
  facility_state = 'MA',
  facility_zip = '02115',
  facility_country = 'United States',
  expected_total_enrollment = 100,
  phase = 'Phase III',
  protocol_type = 'interventional',
  date_updated = NOW()
WHERE study_id = 1;

-- ============================================================================
-- 4. STUDY EVENT DEFINITIONS (Visits)
-- ============================================================================

INSERT INTO study_event_definition (study_event_definition_id, study_id, name, description, repeating, type, category, status_id, owner_id, date_created, oc_oid, ordinal)
VALUES
  (1, 1, 'Screening', 'Initial screening visit to assess eligibility', false, 'scheduled', 'Assessment', 1, 1, NOW(), 'SE_SCREENING', 1),
  (2, 1, 'Baseline', 'Baseline assessment before treatment', false, 'scheduled', 'Assessment', 1, 1, NOW(), 'SE_BASELINE', 2),
  (3, 1, 'Week 2', 'Follow-up visit at 2 weeks', false, 'scheduled', 'Treatment', 1, 1, NOW(), 'SE_WEEK2', 3),
  (4, 1, 'Week 4', 'Follow-up visit at 4 weeks', false, 'scheduled', 'Treatment', 1, 1, NOW(), 'SE_WEEK4', 4),
  (5, 1, 'Week 8', 'Follow-up visit at 8 weeks', false, 'scheduled', 'Treatment', 1, 1, NOW(), 'SE_WEEK8', 5),
  (6, 1, 'Week 12 / End of Study', 'Final study visit at 12 weeks', false, 'scheduled', 'End of Study', 1, 1, NOW(), 'SE_WEEK12', 6),
  (7, 1, 'Unscheduled Visit', 'Unscheduled visit for adverse events or other reasons', true, 'unscheduled', 'Safety', 1, 1, NOW(), 'SE_UNSCHED', 7)
ON CONFLICT (study_event_definition_id) DO NOTHING;

SELECT setval('study_event_definition_study_event_definition_id_seq', 7);

-- ============================================================================
-- 5. CRFs (Case Report Forms)
-- ============================================================================

INSERT INTO crf (crf_id, status_id, name, description, owner_id, date_created, date_updated, oc_oid)
VALUES
  (1, 1, 'Demographics', 'Subject demographics and baseline characteristics', 1, NOW(), NOW(), 'F_DEMOGRAPHICS'),
  (2, 1, 'Vital Signs', 'Vital signs measurements', 1, NOW(), NOW(), 'F_VITALS'),
  (3, 1, 'Medical History', 'Subject medical history', 1, NOW(), NOW(), 'F_MEDHIST'),
  (4, 1, 'Physical Examination', 'Physical examination findings', 1, NOW(), NOW(), 'F_PHYSEXAM'),
  (5, 1, 'Laboratory Results', 'Clinical laboratory results', 1, NOW(), NOW(), 'F_LABS'),
  (6, 1, 'Concomitant Medications', 'Concurrent medications', 1, NOW(), NOW(), 'F_CONMEDS'),
  (7, 1, 'Adverse Events', 'Adverse event reporting', 1, NOW(), NOW(), 'F_AE'),
  (8, 1, 'Study Drug Administration', 'Study drug dosing records', 1, NOW(), NOW(), 'F_STUDYDRUG'),
  (9, 1, 'Efficacy Assessment', 'Primary and secondary efficacy endpoints', 1, NOW(), NOW(), 'F_EFFICACY'),
  (10, 1, 'End of Study', 'Study completion/discontinuation form', 1, NOW(), NOW(), 'F_EOS')
ON CONFLICT (crf_id) DO NOTHING;

SELECT setval('crf_crf_id_seq', 10);

-- ============================================================================
-- 6. CRF VERSIONS
-- ============================================================================

INSERT INTO crf_version (crf_version_id, crf_id, name, description, revision_notes, status_id, owner_id, date_created, date_updated, oc_oid)
VALUES
  (1, 1, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_DEMOGRAPHICS_V1'),
  (2, 2, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_VITALS_V1'),
  (3, 3, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_MEDHIST_V1'),
  (4, 4, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_PHYSEXAM_V1'),
  (5, 5, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_LABS_V1'),
  (6, 6, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_CONMEDS_V1'),
  (7, 7, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_AE_V1'),
  (8, 8, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_STUDYDRUG_V1'),
  (9, 9, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_EFFICACY_V1'),
  (10, 10, 'v1.0', 'Initial version', 'Initial release', 1, 1, NOW(), NOW(), 'F_EOS_V1')
ON CONFLICT (crf_version_id) DO NOTHING;

SELECT setval('crf_version_crf_version_id_seq', 10);

-- ============================================================================
-- 7. EVENT DEFINITION CRFs (Link forms to events)
-- ============================================================================

INSERT INTO event_definition_crf (event_definition_crf_id, study_event_definition_id, study_id, crf_id, required_crf, double_entry, require_all_text_filled, electronic_signature, hide_crf, source_data_verification_code, selected_version_ids, parent_id, ordinal, default_version_id, status_id, owner_id, date_created)
VALUES
  -- Screening: Demographics, Medical History, Vital Signs, Physical Exam, Labs
  (1, 1, 1, 1, true, false, false, false, false, 1, NULL, NULL, 1, 1, 1, 1, NOW()),
  (2, 1, 1, 3, true, false, false, false, false, 1, NULL, NULL, 2, 3, 1, 1, NOW()),
  (3, 1, 1, 2, true, false, false, false, false, 1, NULL, NULL, 3, 2, 1, 1, NOW()),
  (4, 1, 1, 4, true, false, false, false, false, 1, NULL, NULL, 4, 4, 1, 1, NOW()),
  (5, 1, 1, 5, true, false, false, false, false, 1, NULL, NULL, 5, 5, 1, 1, NOW()),
  -- Baseline: Vital Signs, Labs, Efficacy, Study Drug
  (6, 2, 1, 2, true, false, false, false, false, 1, NULL, NULL, 1, 2, 1, 1, NOW()),
  (7, 2, 1, 5, true, false, false, false, false, 1, NULL, NULL, 2, 5, 1, 1, NOW()),
  (8, 2, 1, 9, true, false, false, false, false, 1, NULL, NULL, 3, 9, 1, 1, NOW()),
  (9, 2, 1, 8, true, false, false, false, false, 1, NULL, NULL, 4, 8, 1, 1, NOW()),
  -- Week 2-12: Vital Signs, Conmeds, AE, Study Drug, Efficacy
  (10, 3, 1, 2, true, false, false, false, false, 1, NULL, NULL, 1, 2, 1, 1, NOW()),
  (11, 3, 1, 6, false, false, false, false, false, 1, NULL, NULL, 2, 6, 1, 1, NOW()),
  (12, 3, 1, 7, false, false, false, false, false, 1, NULL, NULL, 3, 7, 1, 1, NOW()),
  (13, 3, 1, 8, true, false, false, false, false, 1, NULL, NULL, 4, 8, 1, 1, NOW()),
  (14, 4, 1, 2, true, false, false, false, false, 1, NULL, NULL, 1, 2, 1, 1, NOW()),
  (15, 4, 1, 6, false, false, false, false, false, 1, NULL, NULL, 2, 6, 1, 1, NOW()),
  (16, 4, 1, 7, false, false, false, false, false, 1, NULL, NULL, 3, 7, 1, 1, NOW()),
  (17, 4, 1, 8, true, false, false, false, false, 1, NULL, NULL, 4, 8, 1, 1, NOW()),
  (18, 4, 1, 9, true, false, false, false, false, 1, NULL, NULL, 5, 9, 1, 1, NOW()),
  (19, 5, 1, 2, true, false, false, false, false, 1, NULL, NULL, 1, 2, 1, 1, NOW()),
  (20, 5, 1, 5, true, false, false, false, false, 1, NULL, NULL, 2, 5, 1, 1, NOW()),
  (21, 5, 1, 6, false, false, false, false, false, 1, NULL, NULL, 3, 6, 1, 1, NOW()),
  (22, 5, 1, 7, false, false, false, false, false, 1, NULL, NULL, 4, 7, 1, 1, NOW()),
  (23, 5, 1, 8, true, false, false, false, false, 1, NULL, NULL, 5, 8, 1, 1, NOW()),
  (24, 6, 1, 2, true, false, false, true, false, 1, NULL, NULL, 1, 2, 1, 1, NOW()),
  (25, 6, 1, 5, true, false, false, true, false, 1, NULL, NULL, 2, 5, 1, 1, NOW()),
  (26, 6, 1, 9, true, false, false, true, false, 1, NULL, NULL, 3, 9, 1, 1, NOW()),
  (27, 6, 1, 10, true, false, false, true, false, 1, NULL, NULL, 4, 10, 1, 1, NOW()),
  -- Unscheduled: AE only
  (28, 7, 1, 7, true, false, false, false, false, 1, NULL, NULL, 1, 7, 1, 1, NOW())
ON CONFLICT (event_definition_crf_id) DO NOTHING;

SELECT setval('event_definition_crf_event_definition_crf_id_seq', 28);

-- ============================================================================
-- 8. COMPLETION STATUS (add more statuses)
-- ============================================================================

INSERT INTO completion_status (completion_status_id, status_id, name, description)
VALUES
  (2, 1, 'not_started', 'Data entry has not started'),
  (3, 1, 'initial_data_entry', 'Initial data entry in progress'),
  (4, 1, 'complete', 'Data entry complete')
ON CONFLICT (completion_status_id) DO NOTHING;

SELECT setval('completion_status_completion_status_id_seq', 4);

-- ============================================================================
-- 9. ITEM GROUPS
-- ============================================================================

INSERT INTO item_group (item_group_id, name, crf_id, status_id, owner_id, date_created, oc_oid)
VALUES
  (1, 'Demographics', 1, 1, 1, NOW(), 'IG_DEMOGRAPHICS'),
  (2, 'Vital Signs', 2, 1, 1, NOW(), 'IG_VITALS'),
  (3, 'Medical History', 3, 1, 1, NOW(), 'IG_MEDHIST'),
  (4, 'Physical Exam', 4, 1, 1, NOW(), 'IG_PHYSEXAM'),
  (5, 'Laboratory', 5, 1, 1, NOW(), 'IG_LABS'),
  (6, 'Medications', 6, 1, 1, NOW(), 'IG_CONMEDS'),
  (7, 'Adverse Events', 7, 1, 1, NOW(), 'IG_AE'),
  (8, 'Study Drug', 8, 1, 1, NOW(), 'IG_STUDYDRUG'),
  (9, 'Efficacy', 9, 1, 1, NOW(), 'IG_EFFICACY'),
  (10, 'End of Study', 10, 1, 1, NOW(), 'IG_EOS')
ON CONFLICT (item_group_id) DO NOTHING;

SELECT setval('item_group_item_group_id_seq', 10);

-- ============================================================================
-- 10. ITEMS (Form Fields)
-- ============================================================================

INSERT INTO item (item_id, name, description, units, phi_status, item_data_type_id, item_reference_type_id, status_id, owner_id, date_created, oc_oid)
VALUES
  -- Demographics items
  (1, 'DOB', 'Date of Birth', NULL, true, 9, NULL, 1, 1, NOW(), 'I_DOB'),
  (2, 'GENDER', 'Gender', NULL, false, 5, NULL, 1, 1, NOW(), 'I_GENDER'),
  (3, 'RACE', 'Race', NULL, false, 5, NULL, 1, 1, NOW(), 'I_RACE'),
  (4, 'ETHNICITY', 'Ethnicity', NULL, false, 5, NULL, 1, 1, NOW(), 'I_ETHNICITY'),
  -- Vital Signs items
  (5, 'SYSBP', 'Systolic Blood Pressure', 'mmHg', false, 6, NULL, 1, 1, NOW(), 'I_SYSBP'),
  (6, 'DIABP', 'Diastolic Blood Pressure', 'mmHg', false, 6, NULL, 1, 1, NOW(), 'I_DIABP'),
  (7, 'PULSE', 'Pulse Rate', 'bpm', false, 6, NULL, 1, 1, NOW(), 'I_PULSE'),
  (8, 'TEMP', 'Temperature', '°C', false, 7, NULL, 1, 1, NOW(), 'I_TEMP'),
  (9, 'WEIGHT', 'Weight', 'kg', false, 7, NULL, 1, 1, NOW(), 'I_WEIGHT'),
  (10, 'HEIGHT', 'Height', 'cm', false, 7, NULL, 1, 1, NOW(), 'I_HEIGHT'),
  -- Labs
  (11, 'WBC', 'White Blood Cell Count', 'x10^9/L', false, 7, NULL, 1, 1, NOW(), 'I_WBC'),
  (12, 'RBC', 'Red Blood Cell Count', 'x10^12/L', false, 7, NULL, 1, 1, NOW(), 'I_RBC'),
  (13, 'HGB', 'Hemoglobin', 'g/dL', false, 7, NULL, 1, 1, NOW(), 'I_HGB'),
  (14, 'PLT', 'Platelet Count', 'x10^9/L', false, 6, NULL, 1, 1, NOW(), 'I_PLT'),
  (15, 'CREAT', 'Creatinine', 'mg/dL', false, 7, NULL, 1, 1, NOW(), 'I_CREAT'),
  (16, 'ALT', 'ALT (SGPT)', 'U/L', false, 6, NULL, 1, 1, NOW(), 'I_ALT'),
  (17, 'AST', 'AST (SGOT)', 'U/L', false, 6, NULL, 1, 1, NOW(), 'I_AST'),
  -- Efficacy
  (18, 'PAIN_SCORE', 'Pain Score (0-10)', NULL, false, 6, NULL, 1, 1, NOW(), 'I_PAIN'),
  (19, 'FUNCTION_SCORE', 'Functional Assessment Score', NULL, false, 6, NULL, 1, 1, NOW(), 'I_FUNCTION'),
  (20, 'QOL_SCORE', 'Quality of Life Score', NULL, false, 6, NULL, 1, 1, NOW(), 'I_QOL')
ON CONFLICT (item_id) DO NOTHING;

SELECT setval('item_item_id_seq', 20);

-- ============================================================================
-- 11. SUBJECTS (Demographics table - 15 patients)
-- ============================================================================

INSERT INTO subject (subject_id, status_id, date_of_birth, gender, unique_identifier, date_created, owner_id, dob_collected)
VALUES
  (1, 1, '1975-03-15', 'm', 'PID-001', NOW(), 1, true),
  (2, 1, '1982-07-22', 'f', 'PID-002', NOW(), 1, true),
  (3, 1, '1968-11-08', 'm', 'PID-003', NOW(), 1, true),
  (4, 1, '1990-01-30', 'f', 'PID-004', NOW(), 1, true),
  (5, 1, '1955-09-12', 'm', 'PID-005', NOW(), 1, true),
  (6, 1, '1978-04-25', 'f', 'PID-006', NOW(), 1, true),
  (7, 1, '1985-12-03', 'm', 'PID-007', NOW(), 1, true),
  (8, 1, '1962-06-18', 'f', 'PID-008', NOW(), 1, true),
  (9, 1, '1995-02-28', 'm', 'PID-009', NOW(), 1, true),
  (10, 1, '1970-08-14', 'f', 'PID-010', NOW(), 1, true),
  (11, 1, '1988-05-07', 'm', 'PID-011', NOW(), 1, true),
  (12, 1, '1973-10-21', 'f', 'PID-012', NOW(), 1, true),
  (13, 1, '1965-03-09', 'm', 'PID-013', NOW(), 1, true),
  (14, 1, '1992-11-16', 'f', 'PID-014', NOW(), 1, true),
  (15, 1, '1980-07-04', 'm', 'PID-015', NOW(), 1, true)
ON CONFLICT (subject_id) DO NOTHING;

SELECT setval('subject_subject_id_seq', 15);

-- ============================================================================
-- 12. STUDY SUBJECTS (Enrolled patients)
-- ============================================================================

INSERT INTO study_subject (study_subject_id, label, secondary_label, subject_id, study_id, status_id, enrollment_date, date_created, date_updated, owner_id, oc_oid)
VALUES
  (1, 'SS-001', 'John Smith', 1, 1, 1, '2024-01-15', NOW(), NOW(), 1, 'SS_SS001'),
  (2, 'SS-002', 'Jane Doe', 2, 1, 1, '2024-01-18', NOW(), NOW(), 1, 'SS_SS002'),
  (3, 'SS-003', 'Robert Johnson', 3, 1, 1, '2024-01-22', NOW(), NOW(), 1, 'SS_SS003'),
  (4, 'SS-004', 'Emily Davis', 4, 1, 1, '2024-01-25', NOW(), NOW(), 1, 'SS_SS004'),
  (5, 'SS-005', 'William Brown', 5, 1, 1, '2024-02-01', NOW(), NOW(), 1, 'SS_SS005'),
  (6, 'SS-006', 'Sarah Wilson', 6, 1, 1, '2024-02-05', NOW(), NOW(), 1, 'SS_SS006'),
  (7, 'SS-007', 'Michael Taylor', 7, 1, 1, '2024-02-10', NOW(), NOW(), 1, 'SS_SS007'),
  (8, 'SS-008', 'Jennifer Anderson', 8, 1, 1, '2024-02-15', NOW(), NOW(), 1, 'SS_SS008'),
  (9, 'SS-009', 'David Martinez', 9, 1, 1, '2024-02-20', NOW(), NOW(), 1, 'SS_SS009'),
  (10, 'SS-010', 'Lisa Thompson', 10, 1, 1, '2024-02-25', NOW(), NOW(), 1, 'SS_SS010'),
  (11, 'SS-011', 'James Garcia', 11, 1, 1, '2024-03-01', NOW(), NOW(), 1, 'SS_SS011'),
  (12, 'SS-012', 'Patricia Robinson', 12, 1, 1, '2024-03-05', NOW(), NOW(), 1, 'SS_SS012'),
  (13, 'SS-013', 'Richard Clark', 13, 1, 1, '2024-03-10', NOW(), NOW(), 1, 'SS_SS013'),
  (14, 'SS-014', 'Linda Lewis', 14, 1, 1, '2024-03-15', NOW(), NOW(), 1, 'SS_SS014'),
  (15, 'SS-015', 'Thomas Walker', 15, 1, 1, '2024-03-20', NOW(), NOW(), 1, 'SS_SS015')
ON CONFLICT (study_subject_id) DO NOTHING;

SELECT setval('study_subject_study_subject_id_seq', 15);

-- ============================================================================
-- 13. STUDY EVENTS (Visit instances for each patient)
-- ============================================================================

-- Generate study events for all subjects (each gets Screening through Week 12)
INSERT INTO study_event (study_event_id, study_event_definition_id, study_subject_id, location, sample_ordinal, date_start, date_end, owner_id, status_id, subject_event_status_id, date_created)
VALUES
  -- Subject 1: All events completed
  (1, 1, 1, 'Site 001', 1, '2024-01-15', '2024-01-15', 1, 1, 4, NOW()),
  (2, 2, 1, 'Site 001', 1, '2024-01-22', '2024-01-22', 1, 1, 4, NOW()),
  (3, 3, 1, 'Site 001', 1, '2024-02-05', '2024-02-05', 1, 1, 4, NOW()),
  (4, 4, 1, 'Site 001', 1, '2024-02-19', '2024-02-19', 1, 1, 4, NOW()),
  (5, 5, 1, 'Site 001', 1, '2024-03-18', '2024-03-18', 1, 1, 3, NOW()),
  (6, 6, 1, 'Site 001', 1, '2024-04-15', NULL, 1, 1, 1, NOW()),
  -- Subject 2: Through Week 4
  (7, 1, 2, 'Site 001', 1, '2024-01-18', '2024-01-18', 1, 1, 4, NOW()),
  (8, 2, 2, 'Site 001', 1, '2024-01-25', '2024-01-25', 1, 1, 4, NOW()),
  (9, 3, 2, 'Site 001', 1, '2024-02-08', '2024-02-08', 1, 1, 4, NOW()),
  (10, 4, 2, 'Site 001', 1, '2024-02-22', '2024-02-22', 1, 1, 3, NOW()),
  (11, 5, 2, 'Site 001', 1, '2024-03-21', NULL, 1, 1, 1, NOW()),
  (12, 6, 2, 'Site 001', 1, '2024-04-18', NULL, 1, 1, 1, NOW()),
  -- Subject 3: Through Week 2
  (13, 1, 3, 'Site 002', 1, '2024-01-22', '2024-01-22', 1, 1, 4, NOW()),
  (14, 2, 3, 'Site 002', 1, '2024-01-29', '2024-01-29', 1, 1, 4, NOW()),
  (15, 3, 3, 'Site 002', 1, '2024-02-12', '2024-02-12', 1, 1, 3, NOW()),
  (16, 4, 3, 'Site 002', 1, '2024-02-26', NULL, 1, 1, 1, NOW()),
  -- Subject 4: Screening and Baseline only
  (17, 1, 4, 'Site 001', 1, '2024-01-25', '2024-01-25', 1, 1, 4, NOW()),
  (18, 2, 4, 'Site 001', 1, '2024-02-01', '2024-02-01', 1, 1, 3, NOW()),
  (19, 3, 4, 'Site 001', 1, '2024-02-15', NULL, 1, 1, 1, NOW()),
  -- Subject 5-15: Screening done, some with Baseline
  (20, 1, 5, 'Site 003', 1, '2024-02-01', '2024-02-01', 1, 1, 4, NOW()),
  (21, 2, 5, 'Site 003', 1, '2024-02-08', '2024-02-08', 1, 1, 4, NOW()),
  (22, 1, 6, 'Site 001', 1, '2024-02-05', '2024-02-05', 1, 1, 4, NOW()),
  (23, 2, 6, 'Site 001', 1, '2024-02-12', NULL, 1, 1, 3, NOW()),
  (24, 1, 7, 'Site 002', 1, '2024-02-10', '2024-02-10', 1, 1, 4, NOW()),
  (25, 2, 7, 'Site 002', 1, '2024-02-17', NULL, 1, 1, 1, NOW()),
  (26, 1, 8, 'Site 001', 1, '2024-02-15', '2024-02-15', 1, 1, 4, NOW()),
  (27, 1, 9, 'Site 003', 1, '2024-02-20', '2024-02-20', 1, 1, 4, NOW()),
  (28, 1, 10, 'Site 001', 1, '2024-02-25', '2024-02-25', 1, 1, 4, NOW()),
  (29, 1, 11, 'Site 002', 1, '2024-03-01', '2024-03-01', 1, 1, 3, NOW()),
  (30, 1, 12, 'Site 001', 1, '2024-03-05', NULL, 1, 1, 1, NOW()),
  (31, 1, 13, 'Site 003', 1, '2024-03-10', NULL, 1, 1, 1, NOW()),
  (32, 1, 14, 'Site 001', 1, '2024-03-15', NULL, 1, 1, 1, NOW()),
  (33, 1, 15, 'Site 002', 1, '2024-03-20', NULL, 1, 1, 1, NOW())
ON CONFLICT (study_event_id) DO NOTHING;

SELECT setval('study_event_study_event_id_seq', 33);

-- ============================================================================
-- 14. EVENT CRFs (Form instances)
-- ============================================================================

INSERT INTO event_crf (event_crf_id, study_event_id, crf_version_id, study_subject_id, date_interviewed, interviewer_name, completion_status_id, status_id, owner_id, date_created, date_updated, annotations)
VALUES
  -- Subject 1 Screening: Demographics, Med History, Vitals, Physical, Labs
  (1, 1, 1, 1, '2024-01-15', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (2, 1, 3, 1, '2024-01-15', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (3, 1, 2, 1, '2024-01-15', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (4, 1, 4, 1, '2024-01-15', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (5, 1, 5, 1, '2024-01-15', 'Lab Tech', 4, 1, 5, NOW(), NOW(), NULL),
  -- Subject 1 Baseline
  (6, 2, 2, 1, '2024-01-22', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (7, 2, 5, 1, '2024-01-22', 'Lab Tech', 4, 1, 5, NOW(), NOW(), NULL),
  (8, 2, 9, 1, '2024-01-22', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (9, 2, 8, 1, '2024-01-22', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 1 Week 2
  (10, 3, 2, 1, '2024-02-05', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (11, 3, 8, 1, '2024-02-05', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 1 Week 4
  (12, 4, 2, 1, '2024-02-19', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (13, 4, 9, 1, '2024-02-19', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  -- Subject 1 Week 8 (in progress)
  (14, 5, 2, 1, '2024-03-18', 'M. Chen', 3, 1, 3, NOW(), NOW(), NULL),
  -- Subject 2 Screening
  (15, 7, 1, 2, '2024-01-18', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (16, 7, 3, 2, '2024-01-18', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (17, 7, 2, 2, '2024-01-18', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 2 Baseline
  (18, 8, 2, 2, '2024-01-25', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (19, 8, 5, 2, '2024-01-25', 'Lab Tech', 4, 1, 5, NOW(), NOW(), NULL),
  -- Subject 2 Week 2
  (20, 9, 2, 2, '2024-02-08', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 2 Week 4 (in progress)
  (21, 10, 2, 2, '2024-02-22', 'M. Chen', 3, 1, 3, NOW(), NOW(), NULL),
  -- Subject 3 Screening
  (22, 13, 1, 3, '2024-01-22', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (23, 13, 2, 3, '2024-01-22', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 3 Baseline
  (24, 14, 2, 3, '2024-01-29', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 3 Week 2 (in progress)
  (25, 15, 2, 3, '2024-02-12', 'M. Chen', 3, 1, 3, NOW(), NOW(), NULL),
  -- Subject 4 Screening
  (26, 17, 1, 4, '2024-01-25', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (27, 17, 2, 4, '2024-01-25', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  -- Subject 4 Baseline (in progress)
  (28, 18, 2, 4, '2024-02-01', 'M. Chen', 3, 1, 3, NOW(), NOW(), NULL),
  -- Subjects 5-10 Screening forms
  (29, 20, 1, 5, '2024-02-01', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (30, 20, 2, 5, '2024-02-01', 'M. Chen', 4, 1, 3, NOW(), NOW(), NULL),
  (31, 22, 1, 6, '2024-02-05', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (32, 24, 1, 7, '2024-02-10', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (33, 26, 1, 8, '2024-02-15', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (34, 27, 1, 9, '2024-02-20', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL),
  (35, 28, 1, 10, '2024-02-25', 'Dr. Johnson', 4, 1, 2, NOW(), NOW(), NULL)
ON CONFLICT (event_crf_id) DO NOTHING;

SELECT setval('event_crf_event_crf_id_seq', 35);

-- ============================================================================
-- 15. ITEM DATA (Form field values)
-- ============================================================================

INSERT INTO item_data (item_data_id, item_id, event_crf_id, status_id, value, date_created, date_updated, owner_id, ordinal)
VALUES
  -- Subject 1 Demographics (event_crf_id = 1)
  (1, 1, 1, 1, '1975-03-15', NOW(), NOW(), 2, 1),  -- DOB
  (2, 2, 1, 1, 'Male', NOW(), NOW(), 2, 1),  -- Gender
  (3, 3, 1, 1, 'White', NOW(), NOW(), 2, 1),  -- Race
  (4, 4, 1, 1, 'Not Hispanic', NOW(), NOW(), 2, 1),  -- Ethnicity
  -- Subject 1 Vitals Screening (event_crf_id = 3)
  (5, 5, 3, 1, '128', NOW(), NOW(), 3, 1),  -- Systolic BP
  (6, 6, 3, 1, '82', NOW(), NOW(), 3, 1),  -- Diastolic BP
  (7, 7, 3, 1, '72', NOW(), NOW(), 3, 1),  -- Pulse
  (8, 8, 3, 1, '36.8', NOW(), NOW(), 3, 1),  -- Temp
  (9, 9, 3, 1, '78.5', NOW(), NOW(), 3, 1),  -- Weight
  (10, 10, 3, 1, '175', NOW(), NOW(), 3, 1),  -- Height
  -- Subject 1 Labs Screening (event_crf_id = 5)
  (11, 11, 5, 1, '7.2', NOW(), NOW(), 5, 1),  -- WBC
  (12, 12, 5, 1, '4.8', NOW(), NOW(), 5, 1),  -- RBC
  (13, 13, 5, 1, '14.2', NOW(), NOW(), 5, 1),  -- HGB
  (14, 14, 5, 1, '245', NOW(), NOW(), 5, 1),  -- PLT
  (15, 15, 5, 1, '0.95', NOW(), NOW(), 5, 1),  -- Creatinine
  (16, 16, 5, 1, '28', NOW(), NOW(), 5, 1),  -- ALT
  (17, 17, 5, 1, '32', NOW(), NOW(), 5, 1),  -- AST
  -- Subject 1 Baseline Vitals (event_crf_id = 6)
  (18, 5, 6, 1, '124', NOW(), NOW(), 3, 1),
  (19, 6, 6, 1, '80', NOW(), NOW(), 3, 1),
  (20, 7, 6, 1, '70', NOW(), NOW(), 3, 1),
  (21, 8, 6, 1, '36.6', NOW(), NOW(), 3, 1),
  (22, 9, 6, 1, '78.2', NOW(), NOW(), 3, 1),
  (23, 10, 6, 1, '175', NOW(), NOW(), 3, 1),
  -- Subject 1 Baseline Efficacy (event_crf_id = 8)
  (24, 18, 8, 1, '6', NOW(), NOW(), 2, 1),  -- Pain Score
  (25, 19, 8, 1, '72', NOW(), NOW(), 2, 1),  -- Function Score
  (26, 20, 8, 1, '65', NOW(), NOW(), 2, 1),  -- QoL Score
  -- Subject 1 Week 2 Vitals (event_crf_id = 10)
  (27, 5, 10, 1, '122', NOW(), NOW(), 3, 1),
  (28, 6, 10, 1, '78', NOW(), NOW(), 3, 1),
  (29, 7, 10, 1, '68', NOW(), NOW(), 3, 1),
  -- Subject 1 Week 4 Vitals (event_crf_id = 12)
  (30, 5, 12, 1, '120', NOW(), NOW(), 3, 1),
  (31, 6, 12, 1, '76', NOW(), NOW(), 3, 1),
  (32, 7, 12, 1, '66', NOW(), NOW(), 3, 1),
  -- Subject 1 Week 4 Efficacy (event_crf_id = 13)
  (33, 18, 13, 1, '4', NOW(), NOW(), 2, 1),
  (34, 19, 13, 1, '80', NOW(), NOW(), 2, 1),
  (35, 20, 13, 1, '75', NOW(), NOW(), 2, 1),
  -- Subject 2 Demographics (event_crf_id = 15)
  (36, 1, 15, 1, '1982-07-22', NOW(), NOW(), 2, 1),
  (37, 2, 15, 1, 'Female', NOW(), NOW(), 2, 1),
  (38, 3, 15, 1, 'Asian', NOW(), NOW(), 2, 1),
  (39, 4, 15, 1, 'Not Hispanic', NOW(), NOW(), 2, 1),
  -- Subject 2 Vitals (event_crf_id = 17)
  (40, 5, 17, 1, '118', NOW(), NOW(), 3, 1),
  (41, 6, 17, 1, '74', NOW(), NOW(), 3, 1),
  (42, 7, 17, 1, '76', NOW(), NOW(), 3, 1),
  (43, 9, 17, 1, '62.3', NOW(), NOW(), 3, 1),
  (44, 10, 17, 1, '165', NOW(), NOW(), 3, 1),
  -- Subject 3 Demographics (event_crf_id = 22)
  (45, 1, 22, 1, '1968-11-08', NOW(), NOW(), 2, 1),
  (46, 2, 22, 1, 'Male', NOW(), NOW(), 2, 1),
  (47, 3, 22, 1, 'Black', NOW(), NOW(), 2, 1),
  -- More subjects demographics
  (48, 1, 26, 1, '1990-01-30', NOW(), NOW(), 2, 1),
  (49, 2, 26, 1, 'Female', NOW(), NOW(), 2, 1),
  (50, 1, 29, 1, '1955-09-12', NOW(), NOW(), 2, 1),
  (51, 2, 29, 1, 'Male', NOW(), NOW(), 2, 1),
  (52, 1, 31, 1, '1978-04-25', NOW(), NOW(), 2, 1),
  (53, 2, 31, 1, 'Female', NOW(), NOW(), 2, 1),
  (54, 1, 32, 1, '1985-12-03', NOW(), NOW(), 2, 1),
  (55, 2, 32, 1, 'Male', NOW(), NOW(), 2, 1),
  (56, 1, 33, 1, '1962-06-18', NOW(), NOW(), 2, 1),
  (57, 2, 33, 1, 'Female', NOW(), NOW(), 2, 1),
  (58, 1, 34, 1, '1995-02-28', NOW(), NOW(), 2, 1),
  (59, 2, 34, 1, 'Male', NOW(), NOW(), 2, 1),
  (60, 1, 35, 1, '1970-08-14', NOW(), NOW(), 2, 1),
  (61, 2, 35, 1, 'Female', NOW(), NOW(), 2, 1)
ON CONFLICT (item_data_id) DO NOTHING;

SELECT setval('item_data_item_data_id_seq', 61);

-- ============================================================================
-- 16. DISCREPANCY NOTES (Queries)
-- ============================================================================

INSERT INTO discrepancy_note (discrepancy_note_id, description, discrepancy_note_type_id, resolution_status_id, detailed_notes, date_created, owner_id, parent_dn_id, entity_type, study_id, assigned_user_id)
VALUES
  -- Open queries
  (1, 'Please verify blood pressure reading - appears elevated', 6, 1, 'Systolic BP of 128 mmHg is borderline. Please confirm this is correct.', NOW() - INTERVAL '5 days', 4, NULL, 'itemData', 1, 2),
  (2, 'Missing lab result for creatinine', 2, 1, 'Creatinine value is required per protocol. Please enter.', NOW() - INTERVAL '4 days', 4, NULL, 'itemData', 1, 5),
  (3, 'Date of birth inconsistent with age reported', 6, 1, 'Reported age does not match DOB. Please clarify.', NOW() - INTERVAL '3 days', 4, NULL, 'itemData', 1, 2),
  -- Updated queries (responses added)
  (4, 'Vital signs collection time not documented', 6, 2, 'Protocol requires vital signs to be collected at the same time each visit.', NOW() - INTERVAL '10 days', 4, NULL, 'itemData', 1, 3),
  (5, 'Response: Time was 10:30 AM', 6, 2, 'Confirmed vital signs were collected at 10:30 AM for all visits.', NOW() - INTERVAL '8 days', 3, 4, 'itemData', 1, 4),
  -- Resolved queries  
  (6, 'Incorrect medication dose recorded', 6, 3, 'Study drug dose appears to be doubled.', NOW() - INTERVAL '15 days', 4, NULL, 'itemData', 1, 3),
  (7, 'Response: Corrected to 100mg', 6, 3, 'Value has been corrected from 200mg to 100mg as per prescription.', NOW() - INTERVAL '14 days', 3, 6, 'itemData', 1, 4),
  (8, 'Verified and closed', 6, 4, 'Correction verified during monitoring visit.', NOW() - INTERVAL '12 days', 4, 6, 'itemData', 1, NULL),
  -- Closed queries
  (9, 'Subject eligibility question', 6, 4, 'Subject BMI of 32 - confirm eligibility per inclusion criteria.', NOW() - INTERVAL '20 days', 4, NULL, 'studySubject', 1, 2),
  (10, 'Confirmed eligible per PI review', 6, 4, 'PI confirmed subject meets all eligibility criteria. BMI cutoff is 35.', NOW() - INTERVAL '18 days', 2, 9, 'studySubject', 1, 4),
  -- More open queries
  (11, 'Adverse event follow-up required', 6, 1, 'Please provide outcome of reported headache AE', NOW() - INTERVAL '2 days', 4, NULL, 'eventCrf', 1, 2),
  (12, 'Protocol deviation documentation needed', 6, 1, 'Visit window exceeded by 3 days. Please document reason.', NOW() - INTERVAL '1 day', 4, NULL, 'studyEvent', 1, 3),
  (13, 'Query on concomitant medication', 6, 2, 'Is the reported ibuprofen use ongoing or completed?', NOW() - INTERVAL '6 days', 4, NULL, 'itemData', 1, 3),
  (14, 'Form incomplete - missing signature', 2, 1, 'Informed consent form requires investigator signature', NOW() - INTERVAL '7 days', 4, NULL, 'eventCrf', 1, 2),
  (15, 'Data clarification needed', 6, 1, 'Height measurement seems unusual (195cm). Please verify.', NOW() - INTERVAL '2 days', 4, NULL, 'itemData', 1, 5)
ON CONFLICT (discrepancy_note_id) DO NOTHING;

SELECT setval('discrepancy_note_discrepancy_note_id_seq', 15);

-- ============================================================================
-- 17. DISCREPANCY NOTE MAPPINGS
-- ============================================================================

-- Map queries to item data
INSERT INTO dn_item_data_map (discrepancy_note_id, item_data_id, column_name)
VALUES
  (1, 5, 'value'),  -- BP query -> BP value
  (2, 15, 'value'), -- Creatinine query
  (3, 1, 'value'),  -- DOB query
  (4, 5, 'value'),
  (6, 11, 'value'),
  (13, 40, 'value'),
  (15, 10, 'value')
ON CONFLICT DO NOTHING;

-- Map queries to study subjects
INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)
VALUES
  (9, 1, 'enrollment'),
  (10, 1, 'enrollment')
ON CONFLICT DO NOTHING;

-- Map queries to event crfs
INSERT INTO dn_event_crf_map (discrepancy_note_id, event_crf_id, column_name)
VALUES
  (11, 10, 'status'),
  (14, 1, 'signature')
ON CONFLICT DO NOTHING;

-- Map queries to study events
INSERT INTO dn_study_event_map (discrepancy_note_id, study_event_id, column_name)
VALUES
  (12, 5, 'date_start')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 18. STUDY GROUP CLASSES (for randomization)
-- ============================================================================

INSERT INTO study_group_class (study_group_class_id, name, study_id, owner_id, date_created, date_updated, status_id, subject_assignment, group_class_type_id)
VALUES
  (1, 'Treatment Arm', 1, 1, NOW(), NOW(), 1, 'Required', 1),
  (2, 'Site', 1, 1, NOW(), NOW(), 1, 'Optional', 2)
ON CONFLICT (study_group_class_id) DO NOTHING;

SELECT setval('study_group_class_study_group_class_id_seq', 2);

-- ============================================================================
-- 19. STUDY GROUPS
-- ============================================================================

INSERT INTO study_group (study_group_id, name, description, study_group_class_id)
VALUES
  (1, 'Active Treatment', 'Subjects receiving active study drug', 1),
  (2, 'Placebo', 'Subjects receiving placebo', 1),
  (3, 'Site 001 - Boston', 'Boston site subjects', 2),
  (4, 'Site 002 - Chicago', 'Chicago site subjects', 2),
  (5, 'Site 003 - LA', 'Los Angeles site subjects', 2)
ON CONFLICT (study_group_id) DO NOTHING;

SELECT setval('study_group_study_group_id_seq', 5);

-- ============================================================================
-- 20. SUBJECT GROUP MAPS (Randomization assignments)
-- ============================================================================

INSERT INTO subject_group_map (subject_group_map_id, study_group_class_id, study_subject_id, study_group_id, status_id, owner_id, date_created, notes)
VALUES
  -- Treatment assignments
  (1, 1, 1, 1, 1, 1, NOW(), 'Randomized to active'),
  (2, 1, 2, 2, 1, 1, NOW(), 'Randomized to placebo'),
  (3, 1, 3, 1, 1, 1, NOW(), 'Randomized to active'),
  (4, 1, 4, 2, 1, 1, NOW(), 'Randomized to placebo'),
  (5, 1, 5, 1, 1, 1, NOW(), 'Randomized to active'),
  (6, 1, 6, 2, 1, 1, NOW(), 'Randomized to placebo'),
  (7, 1, 7, 1, 1, 1, NOW(), 'Randomized to active'),
  (8, 1, 8, 2, 1, 1, NOW(), 'Randomized to placebo'),
  -- Site assignments
  (9, 2, 1, 3, 1, 1, NOW(), NULL),
  (10, 2, 2, 3, 1, 1, NOW(), NULL),
  (11, 2, 3, 4, 1, 1, NOW(), NULL),
  (12, 2, 4, 3, 1, 1, NOW(), NULL),
  (13, 2, 5, 5, 1, 1, NOW(), NULL),
  (14, 2, 6, 3, 1, 1, NOW(), NULL),
  (15, 2, 7, 4, 1, 1, NOW(), NULL),
  (16, 2, 8, 3, 1, 1, NOW(), NULL)
ON CONFLICT (subject_group_map_id) DO NOTHING;

SELECT setval('subject_group_map_subject_group_map_id_seq', 16);

-- ============================================================================
-- 21. AUDIT LOG EVENTS (Sample audit trail)
-- ============================================================================

INSERT INTO audit_log_event (audit_id, audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id, old_value, new_value)
VALUES
  (1, NOW() - INTERVAL '30 days', 'study_subject', 1, 1, 'SS-001', 'Subject enrolled', 2, NULL, 'SS-001'),
  (2, NOW() - INTERVAL '30 days', 'study_subject', 1, 2, 'SS-002', 'Subject enrolled', 2, NULL, 'SS-002'),
  (3, NOW() - INTERVAL '28 days', 'event_crf', 2, 1, 'Demographics', 'Form completed', 8, NULL, 'complete'),
  (4, NOW() - INTERVAL '25 days', 'item_data', 3, 5, 'SYSBP', 'Value updated', 1, '130', '128'),
  (5, NOW() - INTERVAL '20 days', 'study_subject', 1, 3, 'SS-003', 'Subject enrolled', 2, NULL, 'SS-003'),
  (6, NOW() - INTERVAL '15 days', 'event_crf', 3, 6, 'Vital Signs', 'Form completed', 8, NULL, 'complete'),
  (7, NOW() - INTERVAL '10 days', 'item_data', 2, 33, 'PAIN_SCORE', 'Value updated', 1, '5', '4')
ON CONFLICT (audit_id) DO NOTHING;

SELECT setval('audit_log_event_audit_id_seq', 7);

-- ============================================================================
-- 22. AUDIT USER LOGIN (Login history)
-- ============================================================================

INSERT INTO audit_user_login (id, user_name, user_account_id, login_attempt_date, login_status_code, details, version)
VALUES
  (1, 'root', 1, NOW() - INTERVAL '1 hour', 1, 'Successful login', 1),
  (2, 'investigator', 2, NOW() - INTERVAL '2 hours', 1, 'Successful login', 1),
  (3, 'coordinator', 3, NOW() - INTERVAL '3 hours', 1, 'Successful login', 1),
  (4, 'monitor', 4, NOW() - INTERVAL '4 hours', 1, 'Successful login', 1),
  (5, 'root', 1, NOW() - INTERVAL '1 day', 1, 'Successful login', 1),
  (6, 'investigator', 2, NOW() - INTERVAL '1 day', 1, 'Successful login', 1),
  (7, 'coordinator', 3, NOW() - INTERVAL '2 days', 1, 'Successful login', 1),
  (8, 'baduser', NULL, NOW() - INTERVAL '5 hours', 0, 'Failed login - invalid credentials', 1),
  (9, 'root', 1, NOW() - INTERVAL '3 days', 1, 'Successful login', 1),
  (10, 'monitor', 4, NOW() - INTERVAL '3 days', 1, 'Successful login', 1)
ON CONFLICT (id) DO NOTHING;

SELECT setval('audit_user_login_id_seq', 10);

-- ============================================================================
-- COMMIT TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- SUMMARY OF SEEDED DATA
-- ============================================================================
-- Users: 5 (root, investigator, coordinator, monitor, dataentry)
-- Study: 1 (AccuraTrials Clinical Study) 
-- Study Event Definitions: 7 (Screening through EOS + Unscheduled)
-- CRFs: 10 (Demographics, Vitals, Labs, etc.)
-- CRF Versions: 10
-- Event Definition CRFs: 28 (forms linked to visits)
-- Subjects: 15 patients
-- Study Subjects: 15 enrolled patients
-- Study Events: 33 scheduled visits
-- Event CRFs: 35 form instances
-- Item Data: 61 field values
-- Discrepancy Notes: 15 queries (mix of open, updated, resolved, closed)
-- Study Groups: 5 (treatment arms + sites)
-- Subject Group Maps: 16 (randomization assignments)
-- Audit Log Events: 7
-- Login History: 10
-- ============================================================================

