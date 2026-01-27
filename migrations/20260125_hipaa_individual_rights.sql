-- =============================================================================
-- HIPAA Individual Rights Tracking
-- 
-- HIPAA Privacy Rule - Individual Rights:
-- - Right to access PHI
-- - Right to request amendments
-- - Right to accounting of disclosures
-- - Right to request restrictions
-- =============================================================================

-- PHI Access/Amendment Requests
CREATE TABLE IF NOT EXISTS phi_access_requests (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(30) NOT NULL 
        CHECK (request_type IN ('access', 'amendment', 'restriction', 'disclosure_accounting', 'data_portability')),
    requestor_name VARCHAR(200) NOT NULL,
    requestor_email VARCHAR(200),
    requestor_phone VARCHAR(50),
    requestor_relationship VARCHAR(100), -- 'self', 'legal_guardian', 'authorized_representative'
    subject_id INTEGER, -- Link to study_subject if known
    subject_identifier VARCHAR(100), -- External patient ID or name
    request_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    request_details TEXT NOT NULL,
    data_requested TEXT, -- Specific data elements requested
    date_range_start DATE, -- For disclosure accounting
    date_range_end DATE,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'denied', 'withdrawn')),
    response_due_date TIMESTAMP WITH TIME ZONE, -- 30 days for access, 60 days for amendment
    response_date TIMESTAMP WITH TIME ZONE,
    response_details TEXT,
    denial_reason TEXT,
    fee_amount DECIMAL(10,2), -- If applicable
    fee_paid BOOLEAN DEFAULT false,
    handled_by INTEGER REFERENCES user_account(user_id),
    handled_by_username VARCHAR(100),
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PHI Disclosure Log (Accounting of Disclosures)
CREATE TABLE IF NOT EXISTS phi_disclosure_log (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER, -- Link to study_subject
    subject_identifier VARCHAR(100), -- External patient ID
    disclosure_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    disclosed_to_name VARCHAR(200) NOT NULL, -- Person or organization name
    disclosed_to_organization VARCHAR(200),
    disclosed_to_address TEXT,
    disclosure_purpose TEXT NOT NULL, -- Why the disclosure was made
    phi_disclosed TEXT NOT NULL, -- Description of what was disclosed
    legal_basis VARCHAR(100) NOT NULL, -- 'authorization', 'TPO', 'required_by_law', 'public_health', etc.
    authorization_id INTEGER, -- Link to consent/authorization if applicable
    authorization_date DATE,
    disclosure_method VARCHAR(50), -- 'electronic', 'paper', 'verbal'
    disclosed_by INTEGER REFERENCES user_account(user_id),
    disclosed_by_username VARCHAR(100),
    study_id INTEGER,
    study_name VARCHAR(200),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PHI Amendment Tracking
CREATE TABLE IF NOT EXISTS phi_amendments (
    id SERIAL PRIMARY KEY,
    request_id INTEGER REFERENCES phi_access_requests(id),
    subject_id INTEGER,
    subject_identifier VARCHAR(100),
    original_data TEXT NOT NULL, -- What the original record said
    requested_amendment TEXT NOT NULL, -- What change was requested
    amendment_status VARCHAR(20) DEFAULT 'pending'
        CHECK (amendment_status IN ('pending', 'approved', 'denied', 'partial')),
    denial_reason TEXT,
    amended_data TEXT, -- Final amended text if approved
    amended_in_record VARCHAR(200), -- Which record/table was amended
    amended_record_id INTEGER,
    amendment_statement TEXT, -- Statement of disagreement if denied
    amended_by INTEGER REFERENCES user_account(user_id),
    amended_by_username VARCHAR(100),
    amended_at TIMESTAMP WITH TIME ZONE,
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_phi_access_requests_status ON phi_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_phi_access_requests_type ON phi_access_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_phi_access_requests_subject ON phi_access_requests(subject_id);
CREATE INDEX IF NOT EXISTS idx_phi_access_requests_date ON phi_access_requests(request_date);
CREATE INDEX IF NOT EXISTS idx_phi_disclosure_log_subject ON phi_disclosure_log(subject_id);
CREATE INDEX IF NOT EXISTS idx_phi_disclosure_log_date ON phi_disclosure_log(disclosure_date);
CREATE INDEX IF NOT EXISTS idx_phi_disclosure_log_basis ON phi_disclosure_log(legal_basis);
CREATE INDEX IF NOT EXISTS idx_phi_amendments_request ON phi_amendments(request_id);
CREATE INDEX IF NOT EXISTS idx_phi_amendments_subject ON phi_amendments(subject_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_phi_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_phi_access_requests_updated ON phi_access_requests;
CREATE TRIGGER trigger_phi_access_requests_updated
    BEFORE UPDATE ON phi_access_requests
    FOR EACH ROW EXECUTE FUNCTION update_phi_updated_at();

DROP TRIGGER IF EXISTS trigger_phi_amendments_updated ON phi_amendments;
CREATE TRIGGER trigger_phi_amendments_updated
    BEFORE UPDATE ON phi_amendments
    FOR EACH ROW EXECUTE FUNCTION update_phi_updated_at();

-- Comments
COMMENT ON TABLE phi_access_requests IS 'HIPAA individual rights requests - access, amendment, disclosure accounting';
COMMENT ON TABLE phi_disclosure_log IS 'Accounting of all PHI disclosures as required by HIPAA';
COMMENT ON TABLE phi_amendments IS 'Tracking of PHI amendment requests and resolutions';

