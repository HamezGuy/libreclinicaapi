-- ============================================================================
-- Organization Management Tables
-- Extends LibreClinica with organization/tenant support
-- Prefix: acc_ (AccuraTrials custom tables)
-- ============================================================================

-- Organizations table
CREATE TABLE IF NOT EXISTS acc_organization (
    organization_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'sponsor',  -- sponsor, cro, site, academic, other
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending, active, suspended, inactive
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    website VARCHAR(255),
    street VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    owner_id INTEGER REFERENCES user_account(user_id),
    approved_by INTEGER REFERENCES user_account(user_id),
    approved_at TIMESTAMP,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Organization membership (links users to organizations with roles)
CREATE TABLE IF NOT EXISTS acc_organization_member (
    member_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id),
    user_id INTEGER NOT NULL REFERENCES user_account(user_id),
    role VARCHAR(50) NOT NULL DEFAULT 'member',  -- admin, investigator, coordinator, data_entry, monitor, member
    status VARCHAR(30) NOT NULL DEFAULT 'active', -- active, suspended, removed
    date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- Organization invite codes (for self-registration)
CREATE TABLE IF NOT EXISTS acc_organization_code (
    code_id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id),
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP,
    default_role VARCHAR(50) DEFAULT 'data_entry',
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES user_account(user_id),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Access requests (users requesting access without a code)
CREATE TABLE IF NOT EXISTS acc_access_request (
    request_id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    phone VARCHAR(64),
    organization_name VARCHAR(255),
    professional_title VARCHAR(100),
    credentials VARCHAR(255),
    reason TEXT,
    organization_id INTEGER REFERENCES acc_organization(organization_id),
    requested_role VARCHAR(50) DEFAULT 'data_entry',
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    reviewed_by INTEGER REFERENCES user_account(user_id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    user_id INTEGER REFERENCES user_account(user_id),  -- Set when approved and account created
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User invitations (direct invites by email)
CREATE TABLE IF NOT EXISTS acc_user_invitation (
    invitation_id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    organization_id INTEGER REFERENCES acc_organization(organization_id),
    study_id INTEGER REFERENCES study(study_id),
    role VARCHAR(50) DEFAULT 'data_entry',
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending, accepted, expired, cancelled
    expires_at TIMESTAMP NOT NULL,
    invited_by INTEGER REFERENCES user_account(user_id),
    message TEXT,
    accepted_by INTEGER REFERENCES user_account(user_id),
    accepted_at TIMESTAMP,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role permission overrides per organization
CREATE TABLE IF NOT EXISTS acc_role_permission (
    permission_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id),
    role_name VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL,
    allowed BOOLEAN DEFAULT true,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, role_name, permission_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_acc_org_member_org ON acc_organization_member(organization_id);
CREATE INDEX IF NOT EXISTS idx_acc_org_member_user ON acc_organization_member(user_id);
CREATE INDEX IF NOT EXISTS idx_acc_org_code_org ON acc_organization_code(organization_id);
CREATE INDEX IF NOT EXISTS idx_acc_org_code_code ON acc_organization_code(code);
CREATE INDEX IF NOT EXISTS idx_acc_access_request_status ON acc_access_request(status);
CREATE INDEX IF NOT EXISTS idx_acc_invitation_token ON acc_user_invitation(token);
CREATE INDEX IF NOT EXISTS idx_acc_invitation_email ON acc_user_invitation(email);
CREATE INDEX IF NOT EXISTS idx_acc_role_perm_org ON acc_role_permission(organization_id);
