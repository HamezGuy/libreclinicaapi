-- ============================================================================
-- LibreClinica Test Database Schema
-- COMPLETE schema matching the actual LibreClinica PostgreSQL database
-- This is used for ISOLATED testing - separate from production database
-- ============================================================================

-- Drop existing tables to ensure clean state
DROP TABLE IF EXISTS dn_item_data_map CASCADE;
DROP TABLE IF EXISTS dn_event_crf_map CASCADE;
DROP TABLE IF EXISTS dn_study_subject_map CASCADE;
DROP TABLE IF EXISTS dn_study_event_map CASCADE;
DROP TABLE IF EXISTS item_data CASCADE;
DROP TABLE IF EXISTS event_crf CASCADE;
DROP TABLE IF EXISTS study_event CASCADE;
DROP TABLE IF EXISTS subject_group_map CASCADE;
DROP TABLE IF EXISTS discrepancy_note CASCADE;
DROP TABLE IF EXISTS study_subject CASCADE;
DROP TABLE IF EXISTS subject CASCADE;
DROP TABLE IF EXISTS crf_version CASCADE;
DROP TABLE IF EXISTS crf CASCADE;
DROP TABLE IF EXISTS item CASCADE;
DROP TABLE IF EXISTS event_definition_crf CASCADE;
DROP TABLE IF EXISTS study_event_definition CASCADE;
DROP TABLE IF EXISTS study_group CASCADE;
DROP TABLE IF EXISTS study_group_class CASCADE;
DROP TABLE IF EXISTS study_user_role CASCADE;
DROP TABLE IF EXISTS study CASCADE;
DROP TABLE IF EXISTS audit_log_event CASCADE;
DROP TABLE IF EXISTS audit_user_login CASCADE;
DROP TABLE IF EXISTS audit_user_api_log CASCADE;
DROP TABLE IF EXISTS user_account CASCADE;

-- Drop lookup tables
DROP TABLE IF EXISTS completion_status CASCADE;
DROP TABLE IF EXISTS subject_event_status CASCADE;
DROP TABLE IF EXISTS audit_log_event_type CASCADE;
DROP TABLE IF EXISTS resolution_status CASCADE;
DROP TABLE IF EXISTS discrepancy_note_type CASCADE;
DROP TABLE IF EXISTS study_type CASCADE;
DROP TABLE IF EXISTS user_type CASCADE;
DROP TABLE IF EXISTS status CASCADE;

-- ============================================================================
-- LOOKUP TABLES (Reference Data)
-- ============================================================================

CREATE TABLE status (
    status_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

-- Status values match LibreClinica Status.java EXACTLY:
-- INVALID=0, AVAILABLE=1, UNAVAILABLE=2, PRIVATE=3, PENDING=4,
-- DELETED=5, LOCKED=6, AUTO_DELETED=7, SIGNED=8, FROZEN=9,
-- SOURCE_DATA_VERIFICATION=10, RESET=11
INSERT INTO status (status_id, name, description) VALUES
(0, 'invalid', 'Invalid'),
(1, 'available', 'Available'),
(2, 'unavailable', 'Unavailable'),
(3, 'private', 'Private'),
(4, 'pending', 'Pending'),
(5, 'removed', 'Removed/Deleted'),
(6, 'locked', 'Locked'),
(7, 'auto-removed', 'Auto-removed/Auto-deleted'),
(8, 'signed', 'Signed'),
(9, 'frozen', 'Frozen'),
(10, 'source_data_verification', 'Source Data Verification'),
(11, 'reset', 'Reset');

CREATE TABLE study_type (
    study_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

INSERT INTO study_type (study_type_id, name, description) VALUES
(1, 'genetic', 'Genetic Study'),
(2, 'observational', 'Observational Study'),
(3, 'interventional', 'Interventional Study'),
(4, 'other', 'Other');

CREATE TABLE user_type (
    user_type_id SERIAL PRIMARY KEY,
    user_type VARCHAR(50) NOT NULL
);

INSERT INTO user_type (user_type_id, user_type) VALUES
(1, 'admin'),
(2, 'user'),
(3, 'tech-admin'),
(4, 'sysadmin');

CREATE TABLE discrepancy_note_type (
    discrepancy_note_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255)
);

-- Matches real LibreClinica DiscrepancyNoteType.java:
-- 1=Failed Validation Check, 2=Annotation, 3=Query, 4=Reason for Change
INSERT INTO discrepancy_note_type (discrepancy_note_type_id, name, description) VALUES
(1, 'Failed Validation Check', 'Automatic validation check failure'),
(2, 'Annotation', 'Manual annotation by user'),
(3, 'Query', 'Data query raised by reviewer/monitor'),
(4, 'Reason for Change', 'Reason for data modification');

CREATE TABLE resolution_status (
    resolution_status_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255)
);

-- Matches real LibreClinica resolution status IDs
INSERT INTO resolution_status (resolution_status_id, name, description) VALUES
(1, 'New', 'New query/note'),
(2, 'Updated', 'Updated with response'),
(3, 'Resolution Proposed', 'Resolution has been proposed'),
(4, 'Closed', 'Closed/resolved'),
(5, 'Not Applicable', 'Not applicable');

CREATE TABLE audit_log_event_type (
    audit_log_event_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

INSERT INTO audit_log_event_type (audit_log_event_type_id, name) VALUES
(1, 'Entity Created'),
(2, 'Entity Updated'),
(3, 'Entity Deleted'),
(4, 'User Login'),
(5, 'Failed Login Attempt'),
(6, 'Query Created'),
(7, 'Query Updated'),
(8, 'SDV Verified'),
(9, 'Data Locked'),
(10, 'Data Unlocked');

CREATE TABLE subject_event_status (
    subject_event_status_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL
);

-- Matches SubjectEventStatus.java EXACTLY:
-- 1=scheduled, 2=not_scheduled, 3=data_entry_started, 4=completed,
-- 5=stopped, 6=skipped, 7=locked, 8=signed
INSERT INTO subject_event_status (subject_event_status_id, name) VALUES
(1, 'scheduled'),
(2, 'not_scheduled'),
(3, 'data_entry_started'),
(4, 'completed'),
(5, 'stopped'),
(6, 'skipped'),
(7, 'locked'),
(8, 'signed');

CREATE TABLE completion_status (
    completion_status_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL
);

INSERT INTO completion_status (completion_status_id, name) VALUES
(1, 'not_started'),
(2, 'initial_data_entry'),
(3, 'data_entry_started'),
(4, 'complete'),
(5, 'signed');

-- ============================================================================
-- USER MANAGEMENT
-- ============================================================================

CREATE TABLE user_account (
    user_id SERIAL PRIMARY KEY,
    user_name VARCHAR(255) UNIQUE NOT NULL,
    passwd VARCHAR(255) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    email VARCHAR(255) UNIQUE NOT NULL,
    institutional_affiliation VARCHAR(255),
    active_study INTEGER,
    user_type_id INTEGER DEFAULT 2 REFERENCES user_type(user_type_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER DEFAULT 1,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_lastvisit TIMESTAMP,
    passwd_timestamp TIMESTAMP,
    passwd_challenge_question VARCHAR(64),
    passwd_challenge_answer VARCHAR(255),
    phone VARCHAR(64),
    enabled BOOLEAN DEFAULT true,
    account_non_locked BOOLEAN DEFAULT true,
    lock_counter INTEGER DEFAULT 0,
    lockout_time TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    run_webservices BOOLEAN DEFAULT false,
    update_id INTEGER DEFAULT 1,
    enable_api_key BOOLEAN DEFAULT false,
    api_key VARCHAR(255),
    access_code VARCHAR(64),
    authtype VARCHAR(64) DEFAULT 'STANDARD',
    authsecret VARCHAR(255),
    time_zone VARCHAR(255)  -- matches toUserAccount() converter: row.time_zone
);

-- ============================================================================
-- STUDY MANAGEMENT
-- ============================================================================

CREATE TABLE study (
    study_id SERIAL PRIMARY KEY,
    parent_study_id INTEGER,
    unique_identifier VARCHAR(255) UNIQUE NOT NULL,
    secondary_identifier VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    summary TEXT,
    date_planned_start DATE,
    date_planned_end DATE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    type_id INTEGER REFERENCES study_type(study_type_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    protocol_type VARCHAR(30),
    protocol_description VARCHAR(1000),
    protocol_date_verification DATE,  -- Added to match real LibreClinica schema
    phase VARCHAR(30),
    expected_total_enrollment INTEGER,
    sponsor VARCHAR(255),
    collaborators VARCHAR(1000),
    medline_identifier VARCHAR(255),
    url VARCHAR(255),
    url_description VARCHAR(255),
    conditions VARCHAR(500),
    keywords VARCHAR(255),
    eligibility TEXT,
    gender VARCHAR(30),
    age_max VARCHAR(30),
    age_min VARCHAR(30),
    healthy_volunteer_accepted BOOLEAN,
    purpose VARCHAR(64),
    allocation VARCHAR(64),
    masking VARCHAR(30),  -- Added to match real LibreClinica schema
    control VARCHAR(64),
    assignment VARCHAR(64),
    endpoint VARCHAR(64),
    interventions TEXT,
    duration VARCHAR(30),
    selection VARCHAR(30),
    timing VARCHAR(30),
    official_title TEXT,
    results_reference VARCHAR(255),
    facility_name VARCHAR(255),
    facility_city VARCHAR(255),
    facility_address VARCHAR(1000),
    facility_state VARCHAR(20),
    facility_zip VARCHAR(64),
    facility_country VARCHAR(64),
    facility_recruitment_status VARCHAR(60),
    facility_contact_name VARCHAR(255),
    facility_contact_degree VARCHAR(255),
    facility_contact_phone VARCHAR(255),
    facility_contact_email VARCHAR(255),
    principal_investigator VARCHAR(255),
    oc_oid VARCHAR(255)
);

CREATE TABLE study_user_role (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(40) NOT NULL,
    study_id INTEGER NOT NULL REFERENCES study(study_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    user_name VARCHAR(255) NOT NULL
);

-- ============================================================================
-- SUBJECT MANAGEMENT
-- ============================================================================

CREATE TABLE subject (
    subject_id SERIAL PRIMARY KEY,
    father_id INTEGER,
    mother_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    gender CHAR(1),
    unique_identifier VARCHAR(255),
    date_of_birth DATE,
    dob_collected BOOLEAN DEFAULT false
);

CREATE TABLE study_subject (
    study_subject_id SERIAL PRIMARY KEY,
    label VARCHAR(255) NOT NULL,
    secondary_label VARCHAR(255),
    subject_id INTEGER REFERENCES subject(subject_id),
    study_id INTEGER NOT NULL REFERENCES study(study_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    enrollment_date DATE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    oc_oid VARCHAR(255),
    time_zone VARCHAR(100) DEFAULT ''
);

-- ============================================================================
-- STUDY GROUP / RANDOMIZATION
-- ============================================================================

CREATE TABLE study_group_class (
    study_group_class_id SERIAL PRIMARY KEY,
    study_id INTEGER REFERENCES study(study_id),
    name VARCHAR(255),
    type VARCHAR(255),
    group_class_type_id INTEGER DEFAULT 1,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    subject_assignment VARCHAR(255)
);

CREATE TABLE study_group (
    study_group_id SERIAL PRIMARY KEY,
    study_group_class_id INTEGER REFERENCES study_group_class(study_group_class_id),
    name VARCHAR(255),
    description VARCHAR(1000),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER
);

CREATE TABLE subject_group_map (
    subject_group_map_id SERIAL PRIMARY KEY,
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    study_group_id INTEGER REFERENCES study_group(study_group_id),
    study_group_class_id INTEGER REFERENCES study_group_class(study_group_class_id),
    notes VARCHAR(255),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER
);

-- ============================================================================
-- EVENT/VISIT MANAGEMENT
-- ============================================================================

CREATE TABLE study_event_definition (
    study_event_definition_id SERIAL PRIMARY KEY,
    study_id INTEGER NOT NULL REFERENCES study(study_id),
    name VARCHAR(2000) NOT NULL,
    description VARCHAR(2000),
    repeating BOOLEAN DEFAULT false,
    type VARCHAR(20),
    category VARCHAR(2000),
    ordinal INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    oc_oid VARCHAR(255)
);

CREATE TABLE study_event (
    study_event_id SERIAL PRIMARY KEY,
    study_event_definition_id INTEGER NOT NULL REFERENCES study_event_definition(study_event_definition_id),
    study_subject_id INTEGER NOT NULL REFERENCES study_subject(study_subject_id),
    location VARCHAR(2000),
    sample_ordinal INTEGER,
    date_start DATE,
    date_end DATE,
    owner_id INTEGER REFERENCES user_account(user_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    subject_event_status_id INTEGER REFERENCES subject_event_status(subject_event_status_id),
    start_time_flag BOOLEAN DEFAULT false,
    end_time_flag BOOLEAN DEFAULT false,
    reference_visit_id INTEGER,
    scheduled_date TIMESTAMP WITH TIME ZONE,
    is_unscheduled BOOLEAN DEFAULT false
);

-- ============================================================================
-- CRF/FORM MANAGEMENT
-- ============================================================================

CREATE TABLE crf (
    crf_id SERIAL PRIMARY KEY,
    study_id INTEGER REFERENCES study(study_id),
    name VARCHAR(255) NOT NULL,
    description VARCHAR(2000),
    category VARCHAR(100) DEFAULT 'other',
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    oc_oid VARCHAR(255),
    source_study_id INTEGER
);

CREATE TABLE crf_version (
    crf_version_id SERIAL PRIMARY KEY,
    crf_id INTEGER NOT NULL REFERENCES crf(crf_id),
    name VARCHAR(255),
    description VARCHAR(4000),
    revision_notes VARCHAR(255),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    oc_oid VARCHAR(255),
    xform TEXT,
    xform_name VARCHAR(255)
);

CREATE TABLE event_definition_crf (
    event_definition_crf_id SERIAL PRIMARY KEY,
    study_event_definition_id INTEGER REFERENCES study_event_definition(study_event_definition_id),
    study_id INTEGER REFERENCES study(study_id),
    crf_id INTEGER REFERENCES crf(crf_id),
    required_crf BOOLEAN DEFAULT false,
    double_entry BOOLEAN DEFAULT false,
    require_all_text_validation BOOLEAN DEFAULT false,
    decision_condition BOOLEAN DEFAULT false,
    null_values BOOLEAN DEFAULT false,
    default_version_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    ordinal INTEGER,
    electronic_signature BOOLEAN DEFAULT false,
    hide_crf BOOLEAN DEFAULT false,
    source_data_verification_code INTEGER,
    selected_version_ids VARCHAR(255),
    parent_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER
);

CREATE TABLE event_crf (
    event_crf_id SERIAL PRIMARY KEY,
    study_event_id INTEGER NOT NULL REFERENCES study_event(study_event_id),
    crf_version_id INTEGER NOT NULL REFERENCES crf_version(crf_version_id),
    date_interviewed DATE,
    interviewer_name VARCHAR(255),
    completion_status_id INTEGER REFERENCES completion_status(completion_status_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    annotations TEXT,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    validate_string VARCHAR(256),
    validator_annotations TEXT,
    validator_id INTEGER,
    date_validate TIMESTAMP,
    date_validate_completed TIMESTAMP,
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    date_completed TIMESTAMP,
    electronic_signature_status BOOLEAN DEFAULT false,
    sdv_status BOOLEAN DEFAULT false,
    sdv_update_id INTEGER,
    old_status_id INTEGER
);

-- ============================================================================
-- RESPONSE SETS (for select/radio/checkbox options)
-- ============================================================================

CREATE TABLE response_type (
    response_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description VARCHAR(1000)
);

INSERT INTO response_type (response_type_id, name, description) VALUES
(1, 'text', 'Free text input'),
(2, 'textarea', 'Multi-line text input'),
(3, 'checkbox', 'Checkbox input'),
(4, 'file', 'File upload'),
(5, 'radio', 'Radio button selection'),
(6, 'single-select', 'Single select dropdown'),
(7, 'multi-select', 'Multi-select dropdown'),
(8, 'calculation', 'Calculated field'),
(9, 'group-calculation', 'Group calculation'),
(10, 'instant-calculation', 'Instant calculation');

CREATE TABLE response_set (
    response_set_id SERIAL PRIMARY KEY,
    response_type_id INTEGER REFERENCES response_type(response_type_id),
    label VARCHAR(255),
    options_text TEXT,
    options_values TEXT,
    version_id INTEGER
);

CREATE TABLE item_data_type (
    item_data_type_id SERIAL PRIMARY KEY,
    code VARCHAR(20),
    name VARCHAR(255),
    description VARCHAR(1000)
);

INSERT INTO item_data_type (item_data_type_id, code, name, description) VALUES
(1, 'ST', 'String', 'Character string'),
(2, 'INT', 'Integer', 'Integer number'),
(3, 'REAL', 'Real', 'Real number'),
(4, 'DATE', 'Date', 'Date value'),
(5, 'PDATE', 'Partial Date', 'Partial date'),
(6, 'FILE', 'File', 'File attachment'),
(7, 'BL', 'Boolean', 'Boolean value'),
(8, 'CODE', 'Code', 'Coded value'),
(9, 'SET', 'Set', 'Set of values');

-- ============================================================================
-- ITEM/QUESTION MANAGEMENT
-- ============================================================================

CREATE TABLE item (
    item_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(4000),
    units VARCHAR(64),
    phi_status BOOLEAN DEFAULT false,
    item_data_type_id INTEGER,
    item_reference_type_id INTEGER,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    oc_oid VARCHAR(255)
);

CREATE TABLE item_data (
    item_data_id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES item(item_id),
    event_crf_id INTEGER NOT NULL REFERENCES event_crf(event_crf_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    value TEXT,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER REFERENCES user_account(user_id),
    update_id INTEGER,
    ordinal INTEGER,
    deleted BOOLEAN DEFAULT false,
    old_status_id INTEGER
);

-- ============================================================================
-- DISCREPANCY NOTES (QUERIES)
-- ============================================================================

CREATE TABLE discrepancy_note (
    discrepancy_note_id SERIAL PRIMARY KEY,
    description VARCHAR(255),
    discrepancy_note_type_id INTEGER REFERENCES discrepancy_note_type(discrepancy_note_type_id),
    resolution_status_id INTEGER DEFAULT 1 REFERENCES resolution_status(resolution_status_id),
    detailed_notes TEXT,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    owner_id INTEGER REFERENCES user_account(user_id),
    parent_dn_id INTEGER REFERENCES discrepancy_note(discrepancy_note_id),
    entity_id INTEGER,
    entity_type VARCHAR(30),
    study_id INTEGER REFERENCES study(study_id),
    assigned_user_id INTEGER REFERENCES user_account(user_id),
    thread_number INTEGER,
    thread_uuid VARCHAR(255)
);

-- Mapping tables for discrepancy notes
CREATE TABLE dn_item_data_map (
    discrepancy_note_id INTEGER REFERENCES discrepancy_note(discrepancy_note_id),
    item_data_id INTEGER REFERENCES item_data(item_data_id),
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    column_name VARCHAR(255),
    PRIMARY KEY (discrepancy_note_id, item_data_id)
);

CREATE TABLE dn_event_crf_map (
    discrepancy_note_id INTEGER REFERENCES discrepancy_note(discrepancy_note_id),
    event_crf_id INTEGER REFERENCES event_crf(event_crf_id),
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    column_name VARCHAR(255),
    PRIMARY KEY (discrepancy_note_id, event_crf_id)
);

CREATE TABLE dn_study_subject_map (
    discrepancy_note_id INTEGER REFERENCES discrepancy_note(discrepancy_note_id),
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    column_name VARCHAR(255),
    PRIMARY KEY (discrepancy_note_id, study_subject_id)
);

CREATE TABLE dn_study_event_map (
    discrepancy_note_id INTEGER REFERENCES discrepancy_note(discrepancy_note_id),
    study_event_id INTEGER REFERENCES study_event(study_event_id),
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    column_name VARCHAR(255),
    PRIMARY KEY (discrepancy_note_id, study_event_id)
);

-- ============================================================================
-- AUDIT TRAIL
-- ============================================================================

CREATE TABLE audit_log_event (
    audit_id SERIAL PRIMARY KEY,
    audit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    audit_table VARCHAR(500),
    user_id INTEGER,
    entity_id INTEGER,
    entity_name VARCHAR(500),
    old_value TEXT,
    new_value TEXT,
    event_type_id INTEGER,
    reason_for_change VARCHAR(1000),
    audit_log_event_type_id INTEGER REFERENCES audit_log_event_type(audit_log_event_type_id),
    change_details TEXT,
    user_account_id INTEGER,
    study_id INTEGER,
    event_crf_id INTEGER,
    study_event_id INTEGER,
    event_crf_version_id INTEGER
);

CREATE TABLE audit_user_login (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(255),
    user_account_id INTEGER,
    login_attempt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    login_status_code INTEGER,  -- 0=failed, 1=success, 2=logout (matches backend auth.service.ts)
    details VARCHAR(255),
    version INTEGER
);

CREATE TABLE audit_user_api_log (
    id SERIAL PRIMARY KEY,
    audit_id VARCHAR(255),
    user_id INTEGER,
    username VARCHAR(255),
    user_role VARCHAR(50),
    endpoint_path VARCHAR(500),
    http_method VARCHAR(10),
    query_params TEXT,
    request_body TEXT,
    response_status INTEGER,
    ip_address VARCHAR(50),
    user_agent TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- STUDY PARAMETERS
-- ============================================================================

CREATE TABLE study_parameter_value (
    study_parameter_value_id SERIAL PRIMARY KEY,
    study_id INTEGER NOT NULL REFERENCES study(study_id),
    parameter VARCHAR(255) NOT NULL,
    value VARCHAR(255),
    UNIQUE(study_id, parameter)
);

-- ============================================================================
-- CRF SECTIONS AND ITEMS
-- ============================================================================

CREATE TABLE section (
    section_id SERIAL PRIMARY KEY,
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    label VARCHAR(2000),
    title VARCHAR(2000),
    subtitle VARCHAR(2000),
    instructions TEXT,
    page_number_label VARCHAR(5),
    ordinal INTEGER,
    parent_id INTEGER,
    borders INTEGER DEFAULT 0,
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER
);

CREATE TABLE item_group (
    item_group_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    crf_id INTEGER REFERENCES crf(crf_id),
    status_id INTEGER DEFAULT 1 REFERENCES status(status_id),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    oc_oid VARCHAR(255)
);

CREATE TABLE item_group_metadata (
    item_group_metadata_id SERIAL PRIMARY KEY,
    item_group_id INTEGER REFERENCES item_group(item_group_id),
    header VARCHAR(2000),
    subheader VARCHAR(2000),
    layout VARCHAR(100),
    repeat_number INTEGER DEFAULT 1,
    repeat_max INTEGER DEFAULT 40,
    repeat_array VARCHAR(255),
    row_start_number INTEGER,
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    item_id INTEGER REFERENCES item(item_id),
    ordinal INTEGER,
    borders INTEGER DEFAULT 0,
    show_group BOOLEAN DEFAULT true,
    repeating_group BOOLEAN DEFAULT false,
    section_id INTEGER REFERENCES section(section_id)
);

CREATE TABLE item_form_metadata (
    item_form_metadata_id SERIAL PRIMARY KEY,
    item_id INTEGER REFERENCES item(item_id),
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    header VARCHAR(2000),
    subheader VARCHAR(2000),
    parent_id INTEGER,
    parent_label VARCHAR(120),
    column_number INTEGER,
    page_number_label VARCHAR(5),
    question_number_label VARCHAR(20),
    left_item_text VARCHAR(4000),
    right_item_text VARCHAR(2000),
    section_id INTEGER REFERENCES section(section_id),
    response_set_id INTEGER,
    regexp VARCHAR(1000),
    regexp_error_msg VARCHAR(255),
    ordinal INTEGER,
    required BOOLEAN DEFAULT false,
    default_value VARCHAR(4000),
    response_layout VARCHAR(255),
    width_decimal VARCHAR(10),
    show_item BOOLEAN DEFAULT true
);

-- ============================================================================
-- SKIP LOGIC (SCD - Simple Conditional Display)
-- ============================================================================

CREATE TABLE scd_item_metadata (
    id SERIAL PRIMARY KEY,
    scd_item_form_metadata_id INTEGER REFERENCES item_form_metadata(item_form_metadata_id),
    control_item_form_metadata_id INTEGER REFERENCES item_form_metadata(item_form_metadata_id),
    control_item_name VARCHAR(255),
    option_value VARCHAR(255),
    message VARCHAR(255),
    version INTEGER DEFAULT 1
);

-- ============================================================================
-- VALIDATION RULES
-- ============================================================================

CREATE TABLE acc_validation_rule (
    id SERIAL PRIMARY KEY,
    crf_id INTEGER REFERENCES crf(crf_id),
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    item_id INTEGER REFERENCES item(item_id),
    field_name VARCHAR(255),
    rule_type VARCHAR(50) NOT NULL,
    expression TEXT,
    error_message VARCHAR(1000),
    severity VARCHAR(20) DEFAULT 'error',
    enabled BOOLEAN DEFAULT true,
    min_value NUMERIC,
    max_value NUMERIC,
    allowed_values TEXT,
    regex_pattern VARCHAR(500),
    comparison_field VARCHAR(255),
    comparison_operator VARCHAR(20),
    owner_id INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX idx_user_account_username ON user_account(user_name);
CREATE INDEX idx_user_account_email ON user_account(email);
CREATE INDEX idx_study_identifier ON study(unique_identifier);
CREATE INDEX idx_study_status ON study(status_id);
CREATE INDEX idx_study_subject_study ON study_subject(study_id);
CREATE INDEX idx_study_subject_label ON study_subject(label);
CREATE INDEX idx_study_user_role_study ON study_user_role(study_id);
CREATE INDEX idx_study_user_role_user ON study_user_role(user_name);
CREATE INDEX idx_study_event_subject ON study_event(study_subject_id);
CREATE INDEX idx_event_crf_event ON event_crf(study_event_id);
CREATE INDEX idx_item_data_item ON item_data(item_id);
CREATE INDEX idx_item_data_event_crf ON item_data(event_crf_id);
CREATE INDEX idx_audit_log_table ON audit_log_event(audit_table);
CREATE INDEX idx_audit_log_entity ON audit_log_event(entity_id);
CREATE INDEX idx_discrepancy_note_entity ON discrepancy_note(entity_id, entity_type);
CREATE INDEX idx_discrepancy_note_study ON discrepancy_note(study_id);

-- ============================================================================
-- SEED DEFAULT TEST DATA
-- ============================================================================

-- Create root user with MD5 password 'root' = 63a9f0ea7bb98050796b649e85481845
INSERT INTO user_account (
    user_id, user_name, passwd, first_name, last_name, email, 
    user_type_id, status_id, enabled, account_non_locked, owner_id, date_created
) VALUES (
    1, 'root', '63a9f0ea7bb98050796b649e85481845', 'Root', 'User', 
    'root@example.com', 4, 1, true, true, 1, NOW()
);

-- Reset user_id sequence
ALTER SEQUENCE user_account_user_id_seq RESTART WITH 2;

-- Create default test study
INSERT INTO study (
    study_id, unique_identifier, name, summary, type_id, status_id, 
    owner_id, date_created, oc_oid
) VALUES (
    1, 'TEST-STUDY-001', 'Test Study', 'Test study for automated tests',
    3, 1, 1, NOW(), 'S_TEST001'
);

-- Reset study_id sequence
ALTER SEQUENCE study_study_id_seq RESTART WITH 2;

-- Assign root user as admin to test study
INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
VALUES ('admin', 1, 1, 1, 'root', NOW());

-- ============================================================================
-- RANDOMIZATION ENGINE (acc_randomization_*)
-- ============================================================================

CREATE TABLE IF NOT EXISTS acc_randomization_config (
    config_id SERIAL PRIMARY KEY,
    study_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    randomization_type VARCHAR(50) NOT NULL DEFAULT 'block',
    blinding_level VARCHAR(50) NOT NULL DEFAULT 'double_blind',
    block_size INTEGER DEFAULT 4,
    block_size_varied BOOLEAN DEFAULT false,
    block_sizes_list TEXT,
    allocation_ratios JSONB NOT NULL DEFAULT '{}',
    stratification_factors JSONB,
    study_group_class_id INTEGER,
    seed VARCHAR(128),
    total_slots INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    drug_kit_management BOOLEAN DEFAULT false,
    drug_kit_prefix VARCHAR(50),
    site_specific BOOLEAN DEFAULT false,
    created_by INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acc_randomization_list (
    list_entry_id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL,
    sequence_number INTEGER NOT NULL,
    study_group_id INTEGER NOT NULL,
    stratum_key VARCHAR(255) DEFAULT 'default',
    site_id INTEGER,
    block_number INTEGER DEFAULT 0,
    is_used BOOLEAN DEFAULT false,
    used_by_subject_id INTEGER,
    used_at TIMESTAMP,
    used_by_user_id INTEGER,
    randomization_number VARCHAR(50),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rand_config_study ON acc_randomization_config(study_id);
CREATE INDEX IF NOT EXISTS idx_rand_config_active ON acc_randomization_config(study_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rand_list_config ON acc_randomization_list(config_id);
CREATE INDEX IF NOT EXISTS idx_rand_list_available ON acc_randomization_list(config_id, stratum_key, is_used, sequence_number);
CREATE INDEX IF NOT EXISTS idx_rand_list_subject ON acc_randomization_list(used_by_subject_id);

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

COMMENT ON DATABASE libreclinica_test IS 'LibreClinica Test Database - ISOLATED from production';
