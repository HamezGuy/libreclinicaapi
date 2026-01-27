-- =============================================================================
-- Device Fingerprinting and Trusted Device Registry
-- 21 CFR Part 11 §11.10(d) - Device Checks
-- =============================================================================

-- Trusted devices registry
CREATE TABLE IF NOT EXISTS trusted_devices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES user_account(user_id),
    fingerprint_id VARCHAR(64) NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    browser_name VARCHAR(50),
    browser_version VARCHAR(20),
    os_name VARCHAR(50),
    os_version VARCHAR(20),
    screen_resolution VARCHAR(20),
    timezone VARCHAR(100),
    platform VARCHAR(50),
    webgl_renderer VARCHAR(255),
    is_trusted BOOLEAN DEFAULT true,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by INTEGER REFERENCES user_account(user_id),
    revocation_reason TEXT,
    metadata JSONB,
    
    UNIQUE(user_id, fingerprint_id)
);

-- Device access log for audit trail
CREATE TABLE IF NOT EXISTS device_access_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES user_account(user_id),
    fingerprint_id VARCHAR(64) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'login', 'signature', 'data_entry', 'export', etc.
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info JSONB,
    is_trusted_device BOOLEAN DEFAULT false,
    access_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_id VARCHAR(255),
    study_id INTEGER,
    entity_type VARCHAR(50),
    entity_id INTEGER
);

-- Document approval workflow table
CREATE TABLE IF NOT EXISTS document_approval_workflow (
    id SERIAL PRIMARY KEY,
    document_type VARCHAR(50) NOT NULL, -- 'protocol', 'sop', 'crf', 'consent_form', 'report'
    document_name VARCHAR(255) NOT NULL,
    document_version VARCHAR(20) NOT NULL,
    document_path VARCHAR(500),
    document_hash VARCHAR(64), -- SHA-256 hash for integrity
    study_id INTEGER REFERENCES study(study_id),
    status VARCHAR(30) DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_review', 'in_review', 'pending_approval', 'approved', 'rejected', 'superseded', 'archived')),
    created_by INTEGER NOT NULL REFERENCES user_account(user_id),
    created_by_username VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_for_review_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    effective_date DATE,
    expiration_date DATE,
    description TEXT,
    change_summary TEXT,
    metadata JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Approval workflow steps (ordered approvers)
CREATE TABLE IF NOT EXISTS document_approval_steps (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER NOT NULL REFERENCES document_approval_workflow(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    approver_role VARCHAR(50), -- 'investigator', 'medical_monitor', 'sponsor', 'irb'
    approver_user_id INTEGER REFERENCES user_account(user_id),
    approval_type VARCHAR(30) DEFAULT 'required'
        CHECK (approval_type IN ('required', 'optional', 'fyi')),
    status VARCHAR(30) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'skipped', 'delegated')),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by INTEGER REFERENCES user_account(user_id),
    signature_meaning VARCHAR(50), -- 'approval', 'review', 'acknowledgment'
    comments TEXT,
    delegation_to INTEGER REFERENCES user_account(user_id),
    delegation_reason TEXT,
    reminder_sent_at TIMESTAMP WITH TIME ZONE,
    escalated BOOLEAN DEFAULT false,
    escalated_at TIMESTAMP WITH TIME ZONE
);

-- Approval action log (audit trail)
CREATE TABLE IF NOT EXISTS document_approval_audit (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER NOT NULL REFERENCES document_approval_workflow(id),
    step_id INTEGER REFERENCES document_approval_steps(id),
    action VARCHAR(50) NOT NULL, -- 'created', 'submitted', 'reviewed', 'approved', 'rejected', 'delegated', 'escalated'
    action_by INTEGER NOT NULL REFERENCES user_account(user_id),
    action_by_username VARCHAR(100),
    action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    previous_status VARCHAR(30),
    new_status VARCHAR(30),
    comments TEXT,
    signature_id INTEGER, -- Link to e-signature if applicable
    ip_address VARCHAR(45),
    device_fingerprint VARCHAR(64)
);

-- System validation schedule
CREATE TABLE IF NOT EXISTS validation_schedule (
    id SERIAL PRIMARY KEY,
    validation_type VARCHAR(50) NOT NULL, -- 'initial', 'periodic', 'change_control', 'annual_review'
    component_name VARCHAR(100) NOT NULL, -- 'EDC System', 'Database', 'Audit Trail', 'E-Signatures'
    last_validation_date DATE,
    next_validation_date DATE NOT NULL,
    validation_frequency_months INTEGER DEFAULT 12,
    assigned_to INTEGER REFERENCES user_account(user_id),
    status VARCHAR(30) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'overdue', 'waived')),
    validation_report_path VARCHAR(500),
    findings TEXT,
    corrective_actions TEXT,
    completed_by INTEGER REFERENCES user_account(user_id),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default validation schedule items
INSERT INTO validation_schedule (validation_type, component_name, next_validation_date, validation_frequency_months)
VALUES 
    ('annual_review', 'EDC System - Full Validation', CURRENT_DATE + INTERVAL '1 year', 12),
    ('annual_review', 'Audit Trail Integrity', CURRENT_DATE + INTERVAL '1 year', 12),
    ('annual_review', 'Electronic Signatures', CURRENT_DATE + INTERVAL '1 year', 12),
    ('annual_review', 'Access Controls', CURRENT_DATE + INTERVAL '1 year', 12),
    ('annual_review', 'Backup and Recovery', CURRENT_DATE + INTERVAL '6 months', 6),
    ('periodic', 'Security Penetration Testing', CURRENT_DATE + INTERVAL '1 year', 12),
    ('periodic', 'Disaster Recovery Test', CURRENT_DATE + INTERVAL '1 year', 12),
    ('periodic', 'User Access Review', CURRENT_DATE + INTERVAL '3 months', 3)
ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_fingerprint ON trusted_devices(fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_trusted ON trusted_devices(is_trusted) WHERE is_trusted = true;
CREATE INDEX IF NOT EXISTS idx_device_access_user ON device_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_device_access_fingerprint ON device_access_log(fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_device_access_timestamp ON device_access_log(access_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_device_access_action ON device_access_log(action);
CREATE INDEX IF NOT EXISTS idx_doc_workflow_study ON document_approval_workflow(study_id);
CREATE INDEX IF NOT EXISTS idx_doc_workflow_status ON document_approval_workflow(status);
CREATE INDEX IF NOT EXISTS idx_doc_workflow_type ON document_approval_workflow(document_type);
CREATE INDEX IF NOT EXISTS idx_doc_steps_workflow ON document_approval_steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_doc_steps_approver ON document_approval_steps(approver_user_id);
CREATE INDEX IF NOT EXISTS idx_doc_steps_status ON document_approval_steps(status);
CREATE INDEX IF NOT EXISTS idx_doc_audit_workflow ON document_approval_audit(workflow_id);
CREATE INDEX IF NOT EXISTS idx_validation_next_date ON validation_schedule(next_validation_date);
CREATE INDEX IF NOT EXISTS idx_validation_status ON validation_schedule(status);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_device_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_doc_workflow_updated ON document_approval_workflow;
CREATE TRIGGER trigger_doc_workflow_updated
    BEFORE UPDATE ON document_approval_workflow
    FOR EACH ROW EXECUTE FUNCTION update_device_updated_at();

DROP TRIGGER IF EXISTS trigger_validation_schedule_updated ON validation_schedule;
CREATE TRIGGER trigger_validation_schedule_updated
    BEFORE UPDATE ON validation_schedule
    FOR EACH ROW EXECUTE FUNCTION update_device_updated_at();

-- Comments
COMMENT ON TABLE trusted_devices IS 'Registry of trusted devices per user for 21 CFR Part 11 compliance';
COMMENT ON TABLE device_access_log IS 'Audit log of device access for e-signatures and sensitive operations';
COMMENT ON TABLE document_approval_workflow IS 'Formal document approval workflow tracking';
COMMENT ON TABLE document_approval_steps IS 'Individual approval steps in document workflow';
COMMENT ON TABLE document_approval_audit IS 'Complete audit trail of document approval actions';
COMMENT ON TABLE validation_schedule IS 'Periodic system re-validation schedule tracking';

