-- =============================================================================
-- Backup Retention & Catalog System
-- 21 CFR Part 11 & HIPAA Compliant
-- 
-- HIPAA §164.308(a)(7)(ii)(A): Data backup plan
-- HIPAA §164.312(a)(2)(iv): Encryption and decryption  
-- 21 CFR Part 11 §11.10(c): Protection of records
-- =============================================================================

-- Create backup_jobs table to track all backup operations
CREATE TABLE IF NOT EXISTS backup_jobs (
    id SERIAL PRIMARY KEY,
    backup_id VARCHAR(100) NOT NULL UNIQUE,
    backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('full', 'incremental', 'transaction_log')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'verified')),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    total_size_bytes BIGINT DEFAULT 0,
    databases_backed_up TEXT[], -- Array of database names
    encryption_enabled BOOLEAN DEFAULT false,
    encryption_key_id VARCHAR(100),
    cloud_upload_enabled BOOLEAN DEFAULT false,
    cloud_upload_status VARCHAR(20),
    initiated_by INTEGER REFERENCES user_account(user_id),
    initiated_by_username VARCHAR(100),
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_backup_jobs_backup_id ON backup_jobs(backup_id);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_status ON backup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_type ON backup_jobs(backup_type);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_started_at ON backup_jobs(started_at);

-- Create backup_files table to track individual backup files
CREATE TABLE IF NOT EXISTS backup_files (
    id SERIAL PRIMARY KEY,
    backup_job_id INTEGER REFERENCES backup_jobs(id) ON DELETE CASCADE,
    backup_id VARCHAR(100) NOT NULL,
    database_name VARCHAR(100) NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    checksum VARCHAR(64) NOT NULL, -- SHA-256
    checksum_algorithm VARCHAR(20) NOT NULL DEFAULT 'SHA-256',
    encrypted BOOLEAN DEFAULT false,
    encrypted_path TEXT,
    encrypted_checksum VARCHAR(64),
    encryption_iv TEXT,
    encryption_auth_tag TEXT,
    cloud_key TEXT,
    cloud_bucket VARCHAR(200),
    cloud_region VARCHAR(50),
    cloud_storage_class VARCHAR(50),
    cloud_version_id VARCHAR(100),
    cloud_etag VARCHAR(100),
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
    verified_at TIMESTAMP WITH TIME ZONE,
    retention_until TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_files_backup_id ON backup_files(backup_id);
CREATE INDEX IF NOT EXISTS idx_backup_files_database ON backup_files(database_name);
CREATE INDEX IF NOT EXISTS idx_backup_files_retention ON backup_files(retention_until);

-- Create retention_policies table
CREATE TABLE IF NOT EXISTS retention_policies (
    id SERIAL PRIMARY KEY,
    policy_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    record_type VARCHAR(50) NOT NULL, -- 'backup', 'audit_trail', 'clinical_data', 'regulatory_export'
    retention_days INTEGER NOT NULL,
    retention_permanent BOOLEAN DEFAULT false,
    storage_tier VARCHAR(50) DEFAULT 'STANDARD', -- STANDARD, STANDARD_IA, GLACIER, DEEP_ARCHIVE
    encryption_required BOOLEAN DEFAULT true,
    cloud_backup_required BOOLEAN DEFAULT false,
    cross_region_replication BOOLEAN DEFAULT false,
    regulatory_reference TEXT, -- e.g., '21 CFR 11.10(c)', 'HIPAA §164.530(j)'
    active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES user_account(user_id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Insert default retention policies
INSERT INTO retention_policies (policy_name, description, record_type, retention_days, retention_permanent, storage_tier, encryption_required, cloud_backup_required, regulatory_reference)
VALUES 
    ('default_full_backup', 'Default retention for full database backups', 'backup', 28, false, 'STANDARD', true, false, '21 CFR 11.10(c)'),
    ('default_incremental_backup', 'Default retention for incremental backups', 'backup', 7, false, 'STANDARD', true, false, '21 CFR 11.10(c)'),
    ('default_transaction_log', 'Default retention for transaction log backups', 'backup', 1, false, 'STANDARD', true, false, '21 CFR 11.10(c)'),
    ('audit_trail_permanent', 'Permanent retention for audit trail data', 'audit_trail', 0, true, 'STANDARD_IA', true, true, '21 CFR 11.10(e), HIPAA §164.312(b)'),
    ('clinical_data_long_term', 'Long-term retention for clinical trial data', 'clinical_data', 5475, false, 'STANDARD_IA', true, true, '21 CFR 11.10(c), ICH E6(R2)'), -- 15 years
    ('regulatory_export', 'Retention for regulatory export packages', 'regulatory_export', 2555, false, 'GLACIER', true, true, '21 CFR 11.10(c)') -- 7 years
ON CONFLICT (policy_name) DO NOTHING;

-- Create legal_holds table for litigation/regulatory holds
CREATE TABLE IF NOT EXISTS legal_holds (
    id SERIAL PRIMARY KEY,
    hold_name VARCHAR(200) NOT NULL,
    hold_reason TEXT NOT NULL,
    hold_type VARCHAR(50) NOT NULL CHECK (hold_type IN ('litigation', 'regulatory', 'audit', 'investigation', 'other')),
    study_id INTEGER,
    subject_id INTEGER,
    backup_id VARCHAR(100),
    record_type VARCHAR(50), -- 'all', 'audit_trail', 'clinical_data', 'backup'
    effective_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expiration_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES user_account(user_id),
    created_by_username VARCHAR(100),
    approved_by INTEGER REFERENCES user_account(user_id),
    approved_by_username VARCHAR(100),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_active ON legal_holds(is_active);
CREATE INDEX IF NOT EXISTS idx_legal_holds_study ON legal_holds(study_id);
CREATE INDEX IF NOT EXISTS idx_legal_holds_subject ON legal_holds(subject_id);
CREATE INDEX IF NOT EXISTS idx_legal_holds_backup ON legal_holds(backup_id);

-- Create regulatory_exports table to track export packages
CREATE TABLE IF NOT EXISTS regulatory_exports (
    id SERIAL PRIMARY KEY,
    export_id VARCHAR(100) NOT NULL UNIQUE,
    export_type VARCHAR(50) NOT NULL CHECK (export_type IN ('full_study', 'subject_data', 'audit_trail', 'forms', 'custom')),
    format VARCHAR(50) NOT NULL, -- 'odm_xml', 'pdf_a', 'csv', 'sas_transport', 'zip_package'
    study_id INTEGER,
    subject_ids INTEGER[],
    date_range_start TIMESTAMP WITH TIME ZONE,
    date_range_end TIMESTAMP WITH TIME ZONE,
    include_audit_trail BOOLEAN DEFAULT true,
    include_signatures BOOLEAN DEFAULT true,
    include_attachments BOOLEAN DEFAULT false,
    file_path TEXT,
    file_size_bytes BIGINT,
    checksum VARCHAR(64),
    encrypted BOOLEAN DEFAULT false,
    certification_statement TEXT,
    certified_by INTEGER REFERENCES user_account(user_id),
    certified_by_username VARCHAR(100),
    certified_at TIMESTAMP WITH TIME ZONE,
    electronic_signature_id INTEGER,
    requested_by INTEGER REFERENCES user_account(user_id),
    requested_by_username VARCHAR(100),
    reason_for_export TEXT,
    recipient_organization VARCHAR(200),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'delivered')),
    error_message TEXT,
    metadata JSONB,
    retention_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_regulatory_exports_export_id ON regulatory_exports(export_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_exports_study ON regulatory_exports(study_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_exports_status ON regulatory_exports(status);
CREATE INDEX IF NOT EXISTS idx_regulatory_exports_retention ON regulatory_exports(retention_until);

-- Create backup_verification_log for audit of verification attempts
CREATE TABLE IF NOT EXISTS backup_verification_log (
    id SERIAL PRIMARY KEY,
    backup_id VARCHAR(100) NOT NULL,
    verification_type VARCHAR(50) NOT NULL CHECK (verification_type IN ('checksum', 'restore_test', 'cloud_integrity', 'encryption')),
    verification_result VARCHAR(20) NOT NULL CHECK (verification_result IN ('passed', 'failed', 'warning')),
    original_checksum VARCHAR(64),
    verified_checksum VARCHAR(64),
    error_message TEXT,
    verified_by INTEGER REFERENCES user_account(user_id),
    verified_by_username VARCHAR(100),
    verification_duration_ms INTEGER,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_verification_backup_id ON backup_verification_log(backup_id);
CREATE INDEX IF NOT EXISTS idx_backup_verification_result ON backup_verification_log(verification_result);

-- Add trigger for updated_at on backup_jobs
CREATE OR REPLACE FUNCTION update_backup_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_backup_jobs_updated_at ON backup_jobs;
CREATE TRIGGER trigger_update_backup_jobs_updated_at
    BEFORE UPDATE ON backup_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_backup_jobs_updated_at();

-- Add trigger for updated_at on legal_holds
DROP TRIGGER IF EXISTS trigger_update_legal_holds_updated_at ON legal_holds;
CREATE TRIGGER trigger_update_legal_holds_updated_at
    BEFORE UPDATE ON legal_holds
    FOR EACH ROW
    EXECUTE FUNCTION update_backup_jobs_updated_at();

-- Add trigger for updated_at on retention_policies  
DROP TRIGGER IF EXISTS trigger_update_retention_policies_updated_at ON retention_policies;
CREATE TRIGGER trigger_update_retention_policies_updated_at
    BEFORE UPDATE ON retention_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_backup_jobs_updated_at();

-- Grant appropriate permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON backup_jobs TO api_user;
-- GRANT SELECT, INSERT, UPDATE ON backup_files TO api_user;
-- GRANT SELECT, INSERT, UPDATE ON retention_policies TO api_user;
-- GRANT SELECT, INSERT, UPDATE ON legal_holds TO api_user;
-- GRANT SELECT, INSERT, UPDATE ON regulatory_exports TO api_user;
-- GRANT SELECT, INSERT ON backup_verification_log TO api_user;

COMMENT ON TABLE backup_jobs IS 'Tracks all backup operations for 21 CFR Part 11 and HIPAA compliance';
COMMENT ON TABLE backup_files IS 'Tracks individual backup files with checksums and cloud storage details';
COMMENT ON TABLE retention_policies IS 'Configurable retention policies for different record types';
COMMENT ON TABLE legal_holds IS 'Legal and regulatory holds to prevent record deletion';
COMMENT ON TABLE regulatory_exports IS 'Tracks regulatory export packages for FDA/EMA submissions';
COMMENT ON TABLE backup_verification_log IS 'Audit log of all backup verification attempts';
