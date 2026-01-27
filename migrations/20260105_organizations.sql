-- Migration: Organizations and Registration System
-- Created: January 5, 2026
-- Description: Create tables for organization management, invite codes, and access requests

-- Up Migration
BEGIN;

-- Organizations table - stores organization/sponsor/CRO details
CREATE TABLE IF NOT EXISTS acc_organization (
  organization_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- hospital, clinic, research_institution, pharmaceutical, cro, university, government, other
  status VARCHAR(20) DEFAULT 'pending', -- pending, active, suspended, inactive
  
  -- Contact information
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  website VARCHAR(255),
  
  -- Address
  street VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  
  -- Audit fields
  owner_id INTEGER REFERENCES user_account(user_id),
  approved_by INTEGER REFERENCES user_account(user_id),
  approved_at TIMESTAMP,
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique constraints
  CONSTRAINT unique_org_name UNIQUE (name),
  CONSTRAINT unique_org_email UNIQUE (email)
);

-- Organization membership - links users to organizations with roles
CREATE TABLE IF NOT EXISTS acc_organization_membership (
  membership_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- owner, admin, member
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, pending
  
  -- Audit fields
  invited_by INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Each user can only be in an organization once
  CONSTRAINT unique_user_org UNIQUE (user_id, organization_id)
);

-- Organization invite codes - for inviting users to join an organization
CREATE TABLE IF NOT EXISTS acc_organization_code (
  code_id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  organization_id INTEGER NOT NULL REFERENCES acc_organization(organization_id) ON DELETE CASCADE,
  
  -- Usage limits
  max_uses INTEGER, -- NULL = unlimited
  current_uses INTEGER DEFAULT 0,
  expires_at TIMESTAMP,
  
  -- Role assigned when code is used
  default_role VARCHAR(50) DEFAULT 'member',
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_by INTEGER REFERENCES user_account(user_id),
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Code usage log - tracks who used which code
CREATE TABLE IF NOT EXISTS acc_organization_code_usage (
  usage_id SERIAL PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES acc_organization_code(code_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(50)
);

-- Access requests - for users requesting to join an organization
CREATE TABLE IF NOT EXISTS acc_access_request (
  request_id SERIAL PRIMARY KEY,
  
  -- Requester info (may not have user account yet)
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  organization_name VARCHAR(255), -- If requesting to join existing or new
  
  -- Professional info
  professional_title VARCHAR(100),
  credentials VARCHAR(100),
  reason TEXT, -- Why they need access
  
  -- Target organization (if known)
  organization_id INTEGER REFERENCES acc_organization(organization_id),
  requested_role VARCHAR(50) DEFAULT 'member',
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by INTEGER REFERENCES user_account(user_id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  
  -- If approved, link to created user
  user_id INTEGER REFERENCES user_account(user_id),
  
  -- Audit
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User invitations - direct email invitations to users
CREATE TABLE IF NOT EXISTS acc_user_invitation (
  invitation_id SERIAL PRIMARY KEY,
  
  -- Invitation details
  email VARCHAR(255) NOT NULL,
  token VARCHAR(100) NOT NULL UNIQUE,
  
  -- Target organization and role
  organization_id INTEGER REFERENCES acc_organization(organization_id),
  study_id INTEGER REFERENCES study(study_id),
  role VARCHAR(50) DEFAULT 'member',
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, expired, cancelled
  expires_at TIMESTAMP NOT NULL,
  
  -- Inviter info
  invited_by INTEGER REFERENCES user_account(user_id),
  message TEXT, -- Personal message from inviter
  
  -- If accepted, link to user
  accepted_by INTEGER REFERENCES user_account(user_id),
  accepted_at TIMESTAMP,
  
  -- Audit
  date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_status ON acc_organization(status);
CREATE INDEX IF NOT EXISTS idx_org_type ON acc_organization(type);
CREATE INDEX IF NOT EXISTS idx_org_membership_user ON acc_organization_membership(user_id);
CREATE INDEX IF NOT EXISTS idx_org_membership_org ON acc_organization_membership(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_code_org ON acc_organization_code(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_code_active ON acc_organization_code(is_active);
CREATE INDEX IF NOT EXISTS idx_access_request_status ON acc_access_request(status);
CREATE INDEX IF NOT EXISTS idx_access_request_email ON acc_access_request(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token ON acc_user_invitation(token);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON acc_user_invitation(email);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON acc_user_invitation(status);

-- Insert default organization types (as reference data in code, not table)
-- Organization types: hospital, clinic, research_institution, pharmaceutical, cro, university, government, other

COMMIT;

-- Down Migration (for rollback)
-- DROP TABLE IF EXISTS acc_organization_code_usage;
-- DROP TABLE IF EXISTS acc_organization_code;
-- DROP TABLE IF EXISTS acc_user_invitation;
-- DROP TABLE IF EXISTS acc_access_request;
-- DROP TABLE IF EXISTS acc_organization_membership;
-- DROP TABLE IF EXISTS acc_organization;

