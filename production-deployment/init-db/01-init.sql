-- =============================================================================
-- LibreClinica API - Database Initialization Script
-- =============================================================================
-- This script creates the minimal schema needed for the LibreClinica API
-- when running without the full LibreClinica Tomcat application.
--
-- Note: For a full LibreClinica installation, let Tomcat create the schema.
-- =============================================================================

-- Create additional API user
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinica') THEN
        CREATE USER clinica WITH PASSWORD 'clinica';
    END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE libreclinica TO clinica;
ALTER USER libreclinica WITH SUPERUSER;
ALTER USER clinica WITH SUPERUSER;

-- =============================================================================
-- Core Tables for API-Only Mode
-- =============================================================================

-- User accounts table (minimal version)
CREATE TABLE IF NOT EXISTS user_account (
    user_id SERIAL PRIMARY KEY,
    user_name VARCHAR(64) NOT NULL UNIQUE,
    passwd VARCHAR(255),
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    email VARCHAR(120),
    institutional_affiliation VARCHAR(255),
    active_study INTEGER,
    phone VARCHAR(50),
    enabled BOOLEAN DEFAULT true,
    account_non_locked BOOLEAN DEFAULT true,
    lock_counter INTEGER DEFAULT 0,
    passwd_timestamp TIMESTAMP,
    passwd_challenge_question VARCHAR(64),
    passwd_challenge_answer VARCHAR(255),
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_lastvisit TIMESTAMP,
    status_id INTEGER DEFAULT 1,
    update_id INTEGER,
    run_webservices BOOLEAN DEFAULT false
);

-- Study table
CREATE TABLE IF NOT EXISTS study (
    study_id SERIAL PRIMARY KEY,
    parent_study_id INTEGER,
    unique_identifier VARCHAR(30) NOT NULL UNIQUE,
    secondary_identifier VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    summary TEXT,
    date_planned_start DATE,
    date_planned_end DATE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    update_id INTEGER,
    type_id INTEGER DEFAULT 1,
    status_id INTEGER DEFAULT 1,
    principal_investigator VARCHAR(255),
    facility_name VARCHAR(255),
    facility_city VARCHAR(255),
    facility_state VARCHAR(20),
    facility_zip VARCHAR(64),
    facility_country VARCHAR(64),
    facility_recruitment_status VARCHAR(60),
    facility_contact_name VARCHAR(255),
    facility_contact_degree VARCHAR(255),
    facility_contact_phone VARCHAR(255),
    facility_contact_email VARCHAR(255),
    protocol_type VARCHAR(30),
    protocol_description VARCHAR(1000),
    protocol_date_verification DATE,
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
    age_max VARCHAR(3),
    age_min VARCHAR(3),
    healthy_volunteer_accepted BOOLEAN,
    purpose VARCHAR(64),
    allocation VARCHAR(64),
    masking VARCHAR(30),
    control VARCHAR(30),
    assignment VARCHAR(30),
    endpoint VARCHAR(64),
    interventions VARCHAR(1000),
    duration VARCHAR(30),
    selection VARCHAR(30),
    timing VARCHAR(30),
    official_title VARCHAR(255),
    brief_title VARCHAR(255),
    oc_oid VARCHAR(40),
    old_status_id INTEGER
);

-- User role table
CREATE TABLE IF NOT EXISTS study_user_role (
    role_name VARCHAR(40) NOT NULL,
    study_id INTEGER REFERENCES study(study_id),
    status_id INTEGER,
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    user_name VARCHAR(64)
);

-- Audit tables for 21 CFR Part 11 compliance
CREATE TABLE IF NOT EXISTS audit_user_login (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(255),
    user_account_id INTEGER,
    login_attempt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    login_status_code INTEGER,
    details VARCHAR(500),
    version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_user_login_date ON audit_user_login(login_attempt_date);
CREATE INDEX IF NOT EXISTS idx_audit_user_login_user ON audit_user_login(user_account_id);

-- API audit log
CREATE TABLE IF NOT EXISTS audit_user_api_log (
    id SERIAL PRIMARY KEY,
    audit_id VARCHAR(36) NOT NULL UNIQUE,
    user_id INTEGER,
    username VARCHAR(255) NOT NULL,
    user_role VARCHAR(50),
    http_method VARCHAR(10) NOT NULL,
    endpoint_path VARCHAR(500) NOT NULL,
    query_params TEXT,
    request_body TEXT,
    response_status INTEGER,
    ip_address VARCHAR(45),
    user_agent TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Status reference table
CREATE TABLE IF NOT EXISTS status (
    status_id INTEGER PRIMARY KEY,
    name VARCHAR(255),
    description VARCHAR(1000)
);

INSERT INTO status (status_id, name, description) VALUES
(1, 'available', 'Available'),
(2, 'unavailable', 'Unavailable'),
(3, 'pending', 'Pending'),
(4, 'private', 'Private'),
(5, 'removed', 'Removed'),
(6, 'locked', 'Locked'),
(7, 'auto-removed', 'Auto-Removed')
ON CONFLICT (status_id) DO NOTHING;

-- Create default admin user (password: admin123)
-- MD5 hash: 0192023a7bbd73250516f069df18b500
INSERT INTO user_account (user_name, passwd, first_name, last_name, email, enabled, account_non_locked, status_id)
VALUES ('admin', '0192023a7bbd73250516f069df18b500', 'Admin', 'User', 'admin@localhost', true, true, 1)
ON CONFLICT (user_name) DO NOTHING;

-- Create default root user for SOAP (password: 12345678)
-- MD5 hash: 25d55ad283aa400af464c76d713c07ad
INSERT INTO user_account (user_name, passwd, first_name, last_name, email, enabled, account_non_locked, status_id, run_webservices)
VALUES ('root', '25d55ad283aa400af464c76d713c07ad', 'Root', 'User', 'root@localhost', true, true, 1, true)
ON CONFLICT (user_name) DO NOTHING;

-- Create demo study
INSERT INTO study (unique_identifier, name, summary, status_id, owner_id, sponsor)
VALUES ('DEMO-001', 'Demo Clinical Trial', 'A demonstration clinical trial for testing purposes', 1, 1, 'AccuraTrials')
ON CONFLICT (unique_identifier) DO NOTHING;

-- =============================================================================
-- Additional tables for extended features
-- =============================================================================

-- CRF (Case Report Form) table
CREATE TABLE IF NOT EXISTS crf (
    crf_id SERIAL PRIMARY KEY,
    status_id INTEGER,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(2048),
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    oc_oid VARCHAR(40) UNIQUE,
    source_study_id INTEGER REFERENCES study(study_id)
);

-- CRF Version table
CREATE TABLE IF NOT EXISTS crf_version (
    crf_version_id SERIAL PRIMARY KEY,
    crf_id INTEGER REFERENCES crf(crf_id),
    name VARCHAR(255),
    description VARCHAR(4000),
    revision_notes VARCHAR(255),
    status_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    update_id INTEGER,
    oc_oid VARCHAR(40) UNIQUE
);

-- Study Event Definition
CREATE TABLE IF NOT EXISTS study_event_definition (
    study_event_definition_id SERIAL PRIMARY KEY,
    study_id INTEGER REFERENCES study(study_id),
    name VARCHAR(2000),
    description VARCHAR(2048),
    repeating BOOLEAN DEFAULT false,
    type VARCHAR(20),
    category VARCHAR(2048),
    status_id INTEGER,
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    ordinal INTEGER,
    oc_oid VARCHAR(40) UNIQUE
);

-- Study Subject table
CREATE TABLE IF NOT EXISTS study_subject (
    study_subject_id SERIAL PRIMARY KEY,
    label VARCHAR(30),
    secondary_label VARCHAR(30),
    subject_id INTEGER,
    study_id INTEGER REFERENCES study(study_id),
    status_id INTEGER,
    enrollment_date DATE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    update_id INTEGER,
    oc_oid VARCHAR(40) UNIQUE,
    time_zone VARCHAR(100)
);

-- Subject table
CREATE TABLE IF NOT EXISTS subject (
    subject_id SERIAL PRIMARY KEY,
    father_id INTEGER,
    mother_id INTEGER,
    status_id INTEGER,
    date_of_birth DATE,
    gender VARCHAR(1),
    unique_identifier VARCHAR(255) UNIQUE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    update_id INTEGER,
    dob_collected BOOLEAN DEFAULT true
);

-- Study Event table
CREATE TABLE IF NOT EXISTS study_event (
    study_event_id SERIAL PRIMARY KEY,
    study_event_definition_id INTEGER REFERENCES study_event_definition(study_event_definition_id),
    study_subject_id INTEGER REFERENCES study_subject(study_subject_id),
    location VARCHAR(2000),
    sample_ordinal INTEGER,
    date_start TIMESTAMP,
    date_end TIMESTAMP,
    owner_id INTEGER,
    status_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    subject_event_status_id INTEGER,
    start_time_flag BOOLEAN,
    end_time_flag BOOLEAN
);

-- Event CRF table
CREATE TABLE IF NOT EXISTS event_crf (
    event_crf_id SERIAL PRIMARY KEY,
    study_event_id INTEGER REFERENCES study_event(study_event_id),
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    date_interviewed DATE,
    interviewer_name VARCHAR(255),
    completion_status_id INTEGER,
    status_id INTEGER,
    annotations TEXT,
    date_completed TIMESTAMP,
    validator_id INTEGER,
    date_validate TIMESTAMP,
    date_validate_completed TIMESTAMP,
    validator_annotations TEXT,
    validate_string VARCHAR(256),
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    sdv_status_id INTEGER,
    old_status_id INTEGER,
    sdv_update_id INTEGER,
    electronic_signature_status BOOLEAN DEFAULT false,
    study_subject_id INTEGER
);

-- Item table
CREATE TABLE IF NOT EXISTS item (
    item_id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description VARCHAR(4000),
    units VARCHAR(64),
    phi_status BOOLEAN DEFAULT false,
    item_data_type_id INTEGER,
    item_reference_type_id INTEGER,
    status_id INTEGER,
    owner_id INTEGER,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_id INTEGER,
    oc_oid VARCHAR(40) UNIQUE,
    brief_description VARCHAR(2000),
    sas_name VARCHAR(12)
);

-- Item Data table
CREATE TABLE IF NOT EXISTS item_data (
    item_data_id SERIAL PRIMARY KEY,
    item_id INTEGER REFERENCES item(item_id),
    event_crf_id INTEGER REFERENCES event_crf(event_crf_id),
    status_id INTEGER,
    value VARCHAR(4000),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER,
    update_id INTEGER,
    ordinal INTEGER,
    old_status_id INTEGER
);

-- =============================================================================
-- Indexes for performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_study_subject_study ON study_subject(study_id);
CREATE INDEX IF NOT EXISTS idx_study_subject_label ON study_subject(label);
CREATE INDEX IF NOT EXISTS idx_study_event_subject ON study_event(study_subject_id);
CREATE INDEX IF NOT EXISTS idx_event_crf_study_event ON event_crf(study_event_id);
CREATE INDEX IF NOT EXISTS idx_item_data_event_crf ON item_data(event_crf_id);
CREATE INDEX IF NOT EXISTS idx_item_data_item ON item_data(item_id);

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO libreclinica;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO clinica;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO libreclinica;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO clinica;
