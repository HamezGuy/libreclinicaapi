-- Fix Schema for LibreClinica Tests
-- This script adds missing columns and fixes schema issues

-- Fix audit_user_api_log table (already done, but ensure it's correct)
DROP TABLE IF EXISTS audit_user_api_log CASCADE;
CREATE TABLE audit_user_api_log (
    id SERIAL PRIMARY KEY,
    audit_id VARCHAR(255),
    user_id INTEGER,
    username VARCHAR(255),
    endpoint_path VARCHAR(500),
    http_method VARCHAR(10),
    request_body TEXT,
    response_status INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(50),
    user_agent TEXT,
    duration INTEGER
);

-- Add missing columns to study_user_role if they don't exist
ALTER TABLE study_user_role ADD COLUMN IF NOT EXISTS user_id INTEGER;

-- Add missing columns to study if they don't exist
ALTER TABLE study ADD COLUMN IF NOT EXISTS oc_oid VARCHAR(255);
ALTER TABLE study ADD COLUMN IF NOT EXISTS principal_investigator VARCHAR(255);
ALTER TABLE study ADD COLUMN IF NOT EXISTS description TEXT;

-- Ensure audit_log_event_type table exists
CREATE TABLE IF NOT EXISTS audit_log_event_type (
    audit_log_event_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

INSERT INTO audit_log_event_type (audit_log_event_type_id, name) VALUES
(1, 'Create'),
(2, 'Update'),
(3, 'Delete'),
(4, 'View')
ON CONFLICT (audit_log_event_type_id) DO NOTHING;

-- Ensure event_definition_crf table exists
CREATE TABLE IF NOT EXISTS event_definition_crf (
    event_definition_crf_id SERIAL PRIMARY KEY,
    study_event_definition_id INTEGER REFERENCES study_event_definition(study_event_definition_id),
    crf_id INTEGER REFERENCES crf(crf_id),
    required_crf BOOLEAN DEFAULT false,
    double_entry BOOLEAN DEFAULT false,
    hide_crf BOOLEAN DEFAULT false,
    source_data_verification_code INTEGER,
    default_version_id INTEGER,
    ordinal INTEGER,
    status_id INTEGER DEFAULT 1
);

-- Ensure item_group table exists
CREATE TABLE IF NOT EXISTS item_group (
    item_group_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    crf_id INTEGER REFERENCES crf(crf_id),
    oc_oid VARCHAR(255),
    status_id INTEGER DEFAULT 1
);

-- Add item_group_metadata table for form metadata
CREATE TABLE IF NOT EXISTS item_group_metadata (
    item_group_metadata_id SERIAL PRIMARY KEY,
    item_group_id INTEGER REFERENCES item_group(item_group_id),
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    header VARCHAR(255),
    subheader VARCHAR(255),
    layout VARCHAR(50),
    repeating_group BOOLEAN DEFAULT false,
    repeat_number INTEGER,
    repeat_max INTEGER,
    show_group BOOLEAN DEFAULT true
);

-- Add item to item_group relationship
CREATE TABLE IF NOT EXISTS item_form_metadata (
    item_form_metadata_id SERIAL PRIMARY KEY,
    item_id INTEGER REFERENCES item(item_id),
    crf_version_id INTEGER REFERENCES crf_version(crf_version_id),
    item_group_id INTEGER REFERENCES item_group(item_group_id),
    header VARCHAR(255),
    subheader VARCHAR(255),
    parent_id INTEGER,
    parent_label VARCHAR(255),
    column_number INTEGER,
    page_number_label VARCHAR(5),
    question_number_label VARCHAR(20),
    left_item_text TEXT,
    right_item_text TEXT,
    section_label VARCHAR(2000),
    regexp VARCHAR(1000),
    regexp_error_msg VARCHAR(255),
    required BOOLEAN DEFAULT false,
    default_value VARCHAR(255),
    response_layout VARCHAR(20),
    width_decimal VARCHAR(10),
    show_item BOOLEAN DEFAULT true,
    ordinal INTEGER
);

-- Ensure all necessary indexes exist
CREATE INDEX IF NOT EXISTS idx_audit_user_api_log_user ON audit_user_api_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_api_log_audit ON audit_user_api_log(audit_id);
CREATE INDEX IF NOT EXISTS idx_event_definition_crf_event ON event_definition_crf(study_event_definition_id);
CREATE INDEX IF NOT EXISTS idx_event_definition_crf_crf ON event_definition_crf(crf_id);
CREATE INDEX IF NOT EXISTS idx_item_group_crf ON item_group(crf_id);

COMMENT ON TABLE audit_user_api_log IS 'Tracks all API requests for audit compliance (21 CFR Part 11)';
COMMENT ON TABLE event_definition_crf IS 'Links CRFs to study event definitions';
COMMENT ON TABLE item_group IS 'Groups items/questions within a CRF';
