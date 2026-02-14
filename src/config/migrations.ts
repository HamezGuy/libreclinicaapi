/**
 * Database Migrations
 * 
 * Auto-creates supplementary acc_* tables on server startup.
 * These tables extend LibreClinica's schema with AccuraTrials features.
 * 
 * Tables are created WITHOUT foreign key constraints to the LibreClinica
 * core schema (user_account, study, study_subject, etc.) so the API
 * can start regardless of whether LibreClinica Core has finished
 * initializing its schema. The application code handles referential
 * integrity.
 * 
 * For full FK constraints, run the migration SQL files in /migrations/
 * after LibreClinica Core has completed its first startup.
 */

import { logger } from './logger';

/**
 * Run all startup migrations
 * Creates tables with IF NOT EXISTS so they're idempotent
 */
export async function runStartupMigrations(pool: any): Promise<void> {
  logger.info('Running startup migrations...');
  
  const migrations = [
    { name: 'email_notifications', fn: createEmailTables },
    { name: 'subject_transfers', fn: createTransferTables },
    { name: 'econsent', fn: createConsentTables },
    { name: 'epro_patient_portal', fn: createEproTables },
    { name: 'rtsm_irt', fn: createRtsmTables },
    { name: 'organizations', fn: createOrganizationTables },
    { name: 'organization_extras', fn: createOrganizationExtraTables },
    { name: 'wound_scanner', fn: createWoundTables },
    { name: 'wound_full_schema', fn: createWoundFullSchemaTables },
    { name: 'randomization_engine', fn: createRandomizationEngineTables },
    { name: 'user_feature_access', fn: createUserFeatureAccessTables },
    { name: 'form_workflow_config', fn: createFormWorkflowConfigTable },
    { name: 'workflow_tasks', fn: createWorkflowTasksTable },
    { name: 'notifications', fn: createNotificationsTable },
  ];

  let successCount = 0;
  let skipCount = 0;

  for (const migration of migrations) {
    try {
      await migration.fn(pool);
      successCount++;
    } catch (error: any) {
      // Table might already exist or have dependency issues - that's OK
      logger.warn(`Migration '${migration.name}' warning: ${error.message}`);
      skipCount++;
    }
  }

  logger.info(`Startup migrations complete: ${successCount} succeeded, ${skipCount} skipped/warned`);
}

// ============================================================================
// Email Notifications (acc_email_*)
// ============================================================================
async function createEmailTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_email_template (
      template_id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      subject VARCHAR(255) NOT NULL,
      html_body TEXT NOT NULL,
      text_body TEXT,
      description TEXT,
      variables JSONB,
      version INTEGER DEFAULT 1,
      status_id INTEGER DEFAULT 1,
      owner_id INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_email_queue (
      queue_id SERIAL PRIMARY KEY,
      template_id INTEGER,
      recipient_email VARCHAR(255) NOT NULL,
      recipient_user_id INTEGER,
      subject VARCHAR(255) NOT NULL,
      html_body TEXT NOT NULL,
      text_body TEXT,
      variables JSONB,
      priority INTEGER DEFAULT 5,
      status VARCHAR(20) DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt TIMESTAMP,
      sent_at TIMESTAMP,
      error_message TEXT,
      study_id INTEGER,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      scheduled_for TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_notification_preference (
      preference_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      study_id INTEGER,
      notification_type VARCHAR(50) NOT NULL,
      email_enabled BOOLEAN DEFAULT true,
      digest_enabled BOOLEAN DEFAULT false,
      in_app_enabled BOOLEAN DEFAULT true,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, study_id, notification_type)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_status ON acc_email_queue(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON acc_email_queue(scheduled_for)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_pref_user ON acc_notification_preference(user_id)`);

  logger.info('Email notification tables verified');
}

// ============================================================================
// Subject Transfers (acc_transfer_log)
// ============================================================================
async function createTransferTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_transfer_log (
      transfer_id SERIAL PRIMARY KEY,
      study_subject_id INTEGER NOT NULL,
      study_id INTEGER NOT NULL,
      source_site_id INTEGER NOT NULL,
      destination_site_id INTEGER NOT NULL,
      reason_for_transfer TEXT NOT NULL,
      transfer_status VARCHAR(20) DEFAULT 'pending',
      requires_approvals BOOLEAN DEFAULT true,
      initiated_by INTEGER NOT NULL,
      initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source_approved_by INTEGER,
      source_approved_at TIMESTAMP,
      source_signature_id INTEGER,
      destination_approved_by INTEGER,
      destination_approved_at TIMESTAMP,
      destination_signature_id INTEGER,
      completed_by INTEGER,
      completed_at TIMESTAMP,
      cancelled_by INTEGER,
      cancelled_at TIMESTAMP,
      cancel_reason TEXT,
      notes TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_subject ON acc_transfer_log(study_subject_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_status ON acc_transfer_log(transfer_status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_study ON acc_transfer_log(study_id)`);

  logger.info('Subject transfer tables verified');
}

// ============================================================================
// eConsent (acc_consent_*)
// ============================================================================
async function createConsentTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_consent_document (
      document_id SERIAL PRIMARY KEY,
      study_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      document_type VARCHAR(50) DEFAULT 'main',
      language_code VARCHAR(10) DEFAULT 'en',
      status VARCHAR(20) DEFAULT 'draft',
      requires_witness BOOLEAN DEFAULT false,
      requires_lar BOOLEAN DEFAULT false,
      age_of_majority INTEGER DEFAULT 18,
      min_reading_time INTEGER DEFAULT 60,
      owner_id INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_consent_version (
      version_id SERIAL PRIMARY KEY,
      document_id INTEGER,
      version_number VARCHAR(20) NOT NULL,
      version_name VARCHAR(100),
      content JSONB NOT NULL,
      pdf_template TEXT,
      effective_date DATE NOT NULL,
      expiration_date DATE,
      irb_approval_date DATE,
      irb_approval_number VARCHAR(100),
      change_summary TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      approved_by INTEGER,
      approved_at TIMESTAMP,
      created_by INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_subject_consent (
      consent_id SERIAL PRIMARY KEY,
      study_subject_id INTEGER NOT NULL,
      version_id INTEGER,
      consent_type VARCHAR(50) DEFAULT 'subject',
      consent_status VARCHAR(20) DEFAULT 'pending',
      subject_name VARCHAR(255),
      subject_signature_data JSONB,
      subject_signed_at TIMESTAMP,
      subject_ip_address VARCHAR(50),
      subject_user_agent TEXT,
      witness_name VARCHAR(255),
      witness_relationship VARCHAR(100),
      witness_signature_data JSONB,
      witness_signed_at TIMESTAMP,
      lar_name VARCHAR(255),
      lar_relationship VARCHAR(100),
      lar_signature_data JSONB,
      lar_signed_at TIMESTAMP,
      lar_reason TEXT,
      presented_at TIMESTAMP,
      time_spent_reading INTEGER,
      pages_viewed JSONB,
      acknowledgments_checked JSONB,
      questions_asked TEXT,
      copy_emailed_to VARCHAR(255),
      copy_emailed_at TIMESTAMP,
      pdf_file_path VARCHAR(500),
      withdrawn_at TIMESTAMP,
      withdrawal_reason TEXT,
      withdrawn_by INTEGER,
      consented_by INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_reconsent_request (
      request_id SERIAL PRIMARY KEY,
      version_id INTEGER,
      study_subject_id INTEGER NOT NULL,
      previous_consent_id INTEGER,
      reason TEXT NOT NULL,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      requested_by INTEGER,
      due_date DATE,
      completed_consent_id INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      waived_by INTEGER,
      waived_reason TEXT,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consent_doc_study ON acc_consent_document(study_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subject_consent_subject ON acc_subject_consent(study_subject_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subject_consent_status ON acc_subject_consent(consent_status)`);

  logger.info('eConsent tables verified');
}

// ============================================================================
// ePRO/Patient Portal (acc_patient_account, acc_pro_*)
// ============================================================================
async function createEproTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_patient_account (
      patient_account_id SERIAL PRIMARY KEY,
      study_subject_id INTEGER UNIQUE NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50),
      pin_hash VARCHAR(255),
      magic_link_token VARCHAR(255),
      magic_link_expires TIMESTAMP,
      preferred_language VARCHAR(10) DEFAULT 'en',
      timezone VARCHAR(50) DEFAULT 'UTC',
      notification_preferences JSONB DEFAULT '{"email": true, "sms": false, "push": true}',
      last_login TIMESTAMP,
      login_attempts INTEGER DEFAULT 0,
      locked_until TIMESTAMP,
      status VARCHAR(20) DEFAULT 'active',
      device_tokens JSONB,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_pro_instrument (
      instrument_id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      short_name VARCHAR(50),
      description TEXT,
      category VARCHAR(50),
      version VARCHAR(20) DEFAULT '1.0',
      scoring_method JSONB,
      items JSONB NOT NULL,
      estimated_time INTEGER DEFAULT 5,
      language VARCHAR(10) DEFAULT 'en',
      is_validated BOOLEAN DEFAULT false,
      source VARCHAR(255),
      license_info TEXT,
      status VARCHAR(20) DEFAULT 'active',
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_pro_assignment (
      assignment_id SERIAL PRIMARY KEY,
      study_id INTEGER NOT NULL,
      instrument_id INTEGER,
      event_definition_id INTEGER,
      crf_id INTEGER,
      frequency VARCHAR(50) DEFAULT 'per_visit',
      custom_schedule JSONB,
      reminder_hours INTEGER DEFAULT 24,
      max_reminders INTEGER DEFAULT 3,
      window_before_days INTEGER DEFAULT 0,
      window_after_days INTEGER DEFAULT 7,
      is_required BOOLEAN DEFAULT true,
      status VARCHAR(20) DEFAULT 'active',
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_pro_response (
      response_id SERIAL PRIMARY KEY,
      assignment_id INTEGER,
      study_subject_id INTEGER NOT NULL,
      patient_account_id INTEGER,
      study_event_id INTEGER,
      start_time TIMESTAMP,
      end_time TIMESTAMP,
      responses JSONB NOT NULL,
      total_score NUMERIC,
      subscale_scores JSONB,
      severity_category VARCHAR(50),
      completion_percentage NUMERIC DEFAULT 0,
      status VARCHAR(20) DEFAULT 'in_progress',
      submitted_at TIMESTAMP,
      ip_address VARCHAR(50),
      user_agent TEXT,
      device_type VARCHAR(50),
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pro_response_subject ON acc_pro_response(study_subject_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pro_response_status ON acc_pro_response(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_patient_account_subject ON acc_patient_account(study_subject_id)`);

  logger.info('ePRO/Patient Portal tables verified');
}

// ============================================================================
// RTSM/IRT (acc_kit_*)
// ============================================================================
async function createRtsmTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_kit_type (
      kit_type_id SERIAL PRIMARY KEY,
      study_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      product_code VARCHAR(100),
      treatment_arm VARCHAR(100),
      storage_conditions VARCHAR(255),
      min_storage_temp NUMERIC,
      max_storage_temp NUMERIC,
      shelf_life_days INTEGER,
      units_per_kit INTEGER DEFAULT 1,
      kit_image_path VARCHAR(500),
      is_placebo BOOLEAN DEFAULT false,
      is_blinded BOOLEAN DEFAULT true,
      reorder_threshold INTEGER,
      status VARCHAR(20) DEFAULT 'active',
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_kit_inventory (
      kit_id SERIAL PRIMARY KEY,
      kit_type_id INTEGER,
      kit_number VARCHAR(100) NOT NULL UNIQUE,
      batch_number VARCHAR(100),
      lot_number VARCHAR(100),
      site_id INTEGER,
      study_id INTEGER NOT NULL,
      manufacture_date DATE,
      expiration_date DATE,
      received_date DATE,
      status VARCHAR(30) DEFAULT 'available',
      assigned_subject_id INTEGER,
      assigned_at TIMESTAMP,
      dispensed_at TIMESTAMP,
      dispensed_by INTEGER,
      returned_at TIMESTAMP,
      return_condition VARCHAR(50),
      destroyed_at TIMESTAMP,
      destroyed_by INTEGER,
      destruction_witness INTEGER,
      temperature_log JSONB,
      notes TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_kit_shipment (
      shipment_id SERIAL PRIMARY KEY,
      study_id INTEGER NOT NULL,
      from_site_id INTEGER,
      to_site_id INTEGER NOT NULL,
      tracking_number VARCHAR(100),
      carrier VARCHAR(100),
      shipped_date DATE,
      expected_arrival DATE,
      actual_arrival DATE,
      temperature_range VARCHAR(50),
      status VARCHAR(30) DEFAULT 'preparing',
      shipped_by INTEGER,
      received_by INTEGER,
      condition_on_receipt VARCHAR(50),
      notes TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_inventory_status ON acc_kit_inventory(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_inventory_site ON acc_kit_inventory(site_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_shipment_study ON acc_kit_shipment(study_id)`);

  logger.info('RTSM/IRT tables verified');
}

// ============================================================================
// Organizations (acc_organization*)
// ============================================================================
async function createOrganizationTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_organization (
      organization_id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'sponsor',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(64),
      website VARCHAR(255),
      street VARCHAR(255),
      city VARCHAR(255),
      state VARCHAR(100),
      postal_code VARCHAR(20),
      country VARCHAR(100),
      owner_id INTEGER,
      approved_by INTEGER,
      approved_at TIMESTAMP,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_organization_member (
      member_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(organization_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_organization_code (
      code_id SERIAL PRIMARY KEY,
      code VARCHAR(20) NOT NULL UNIQUE,
      organization_id INTEGER NOT NULL,
      max_uses INTEGER,
      current_uses INTEGER DEFAULT 0,
      expires_at TIMESTAMP,
      default_role VARCHAR(50) DEFAULT 'data_entry',
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
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
      organization_id INTEGER,
      requested_role VARCHAR(50) DEFAULT 'data_entry',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      user_id INTEGER,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Upgrade existing tables that were created with the old minimal schema
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS first_name VARCHAR(50)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS last_name VARCHAR(50)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS phone VARCHAR(64)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS professional_title VARCHAR(100)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS credentials VARCHAR(255)`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS reason TEXT`);
  await pool.query(`ALTER TABLE acc_access_request ADD COLUMN IF NOT EXISTS review_notes TEXT`);
  await pool.query(`ALTER TABLE acc_access_request ALTER COLUMN organization_id DROP NOT NULL`);
  await pool.query(`ALTER TABLE acc_access_request ALTER COLUMN user_id DROP NOT NULL`);

  // Rename reviewer_notes → review_notes if old column exists
  try {
    const colCheck = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='acc_access_request' AND column_name='reviewer_notes'`);
    if (colCheck.rows.length > 0) {
      await pool.query(`ALTER TABLE acc_access_request RENAME COLUMN reviewer_notes TO review_notes`);
    }
  } catch (e: any) { /* column may not exist or already renamed */ }

  // Ensure user_account has a unique index on user_name to prevent duplicate users
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_account_user_name_unique ON user_account(user_name)`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_member_org ON acc_organization_member(organization_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_member_user ON acc_organization_member(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_code_code ON acc_organization_code(code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_request_org ON acc_access_request(organization_id)`);

  logger.info('Organization tables verified');
}

// ============================================================================
// Wound Scanner (acc_wound_*)
// ============================================================================
async function createWoundTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_wound_capture (
      capture_id SERIAL PRIMARY KEY,
      study_subject_id INTEGER NOT NULL,
      study_event_id INTEGER,
      event_crf_id INTEGER,
      item_id INTEGER,
      capture_token VARCHAR(255) UNIQUE,
      capture_status VARCHAR(30) DEFAULT 'pending',
      image_path VARCHAR(500),
      thumbnail_path VARCHAR(500),
      s3_key VARCHAR(500),
      wound_type VARCHAR(100),
      wound_location VARCHAR(255),
      measurements JSONB,
      ai_analysis JSONB,
      captured_at TIMESTAMP,
      captured_by INTEGER,
      device_info JSONB,
      integrity_hash VARCHAR(128),
      audit_chain JSONB,
      notes TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_subject ON acc_wound_capture(study_subject_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_token ON acc_wound_capture(capture_token)`);

  logger.info('Wound Scanner tables verified');
}

// ============================================================================
// Organization Extras (acc_role_permission, acc_user_invitation)
// ============================================================================
async function createOrganizationExtraTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_role_permission (
      role_permission_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      role_name VARCHAR(50) NOT NULL,
      permission_key VARCHAR(100) NOT NULL,
      allowed BOOLEAN DEFAULT false,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(organization_id, role_name, permission_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_user_invitation (
      invitation_id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      organization_id INTEGER,
      study_id INTEGER,
      role VARCHAR(50) DEFAULT 'data_entry',
      expires_at TIMESTAMP NOT NULL,
      invited_by INTEGER,
      message TEXT,
      status VARCHAR(30) DEFAULT 'pending',
      accepted_by INTEGER,
      accepted_at TIMESTAMP,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_role_perm_org ON acc_role_permission(organization_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_inv_token ON acc_user_invitation(token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_inv_email ON acc_user_invitation(email)`);

  logger.info('Organization extra tables verified');
}

// ============================================================================
// Wound Full Schema (wound_sessions, wound_images, wound_measurements,
//                    electronic_signatures, audit_trail)
// These tables are used by the wound.service.ts hybrid service
// ============================================================================
async function createWoundFullSchemaTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wound_sessions (
      id VARCHAR(64) PRIMARY KEY,
      patient_id VARCHAR(64) NOT NULL,
      template_id VARCHAR(255),
      study_id INTEGER,
      study_event_id INTEGER,
      site_id INTEGER,
      device_id VARCHAR(255),
      source VARCHAR(50) DEFAULT 'ios_app',
      status VARCHAR(30) DEFAULT 'draft',
      created_by_user_id VARCHAR(64),
      created_by_user_name VARCHAR(255),
      captured_at TIMESTAMP,
      signed_at TIMESTAMP,
      submitted_at TIMESTAMP,
      libreclinica_id VARCHAR(255),
      submitted_by_user_id VARCHAR(64),
      submitted_by_user_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wound_images (
      id VARCHAR(64) PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL,
      filename VARCHAR(512),
      content_type VARCHAR(100),
      size_bytes INTEGER,
      storage_path VARCHAR(500),
      storage_type VARCHAR(20) DEFAULT 's3',
      hash VARCHAR(128),
      hash_verified BOOLEAN DEFAULT false,
      captured_at TIMESTAMP,
      upload_completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wound_measurements (
      id VARCHAR(64) PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL,
      image_id VARCHAR(64),
      area_cm2 NUMERIC,
      perimeter_cm NUMERIC,
      max_length_cm NUMERIC,
      max_width_cm NUMERIC,
      max_depth_cm NUMERIC,
      volume_cm3 NUMERIC,
      boundary_points JSONB,
      point_count INTEGER,
      calibration_method VARCHAR(50),
      pixels_per_cm NUMERIC,
      data_hash VARCHAR(128),
      notes TEXT,
      measured_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS electronic_signatures (
      id VARCHAR(64) PRIMARY KEY,
      session_id VARCHAR(64),
      user_id VARCHAR(64),
      user_name VARCHAR(255),
      user_role VARCHAR(100),
      meaning VARCHAR(255),
      manifestation TEXT,
      data_hash VARCHAR(128),
      signature_value TEXT,
      auth_method VARCHAR(50),
      device_id VARCHAR(255),
      signed_at TIMESTAMP,
      is_valid BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      id VARCHAR(64) PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      category VARCHAR(50),
      severity VARCHAR(20),
      user_id VARCHAR(64),
      user_name VARCHAR(255),
      device_id VARCHAR(255),
      patient_id VARCHAR(64),
      session_id VARCHAR(64),
      details JSONB,
      checksum VARCHAR(128),
      previous_checksum VARCHAR(128),
      event_timestamp TIMESTAMP,
      source VARCHAR(50),
      ip_address VARCHAR(50),
      received_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_sess_patient ON wound_sessions(patient_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_sess_status ON wound_sessions(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_img_session ON wound_images(session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wound_meas_session ON wound_measurements(session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_esig_session ON electronic_signatures(session_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail(action)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_trail_session ON audit_trail(session_id)`);

  logger.info('Wound full schema tables verified');
}

// ============================================================================
// Randomization Engine (acc_randomization_*)
// ============================================================================
async function createRandomizationEngineTables(pool: any): Promise<void> {
  // Randomization scheme configuration
  await pool.query(`
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
    )
  `);

  // Pre-generated sealed randomization list ("sealed envelopes")
  await pool.query(`
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
    )
  `);

  // Indexes for performance
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rand_config_study ON acc_randomization_config(study_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rand_config_active ON acc_randomization_config(study_id, is_active)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rand_list_config ON acc_randomization_list(config_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rand_list_available ON acc_randomization_list(config_id, stratum_key, is_used, sequence_number)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rand_list_subject ON acc_randomization_list(used_by_subject_id)`);

  logger.info('Randomization engine tables verified');
}

// ============================================================================
// User Feature Access (acc_user_feature_access)
// Controls which application features each user can access.
// Features: training, econsent, epro, rtsm, woundScanner, aiAssistant,
//           randomization, dataLock, userManagement, reporting
// ============================================================================
async function createUserFeatureAccessTables(pool: any): Promise<void> {
  // Master feature registry - defines all available features in the system
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_feature (
      feature_id SERIAL PRIMARY KEY,
      feature_key VARCHAR(50) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      description TEXT,
      category VARCHAR(50) DEFAULT 'general',
      is_active BOOLEAN DEFAULT true,
      requires_role_level INTEGER DEFAULT 0,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-user feature access - which features each user can access
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_user_feature_access (
      access_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      feature_key VARCHAR(50) NOT NULL,
      is_enabled BOOLEAN DEFAULT true,
      granted_by INTEGER,
      granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_by INTEGER,
      revoked_at TIMESTAMP,
      notes TEXT,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, feature_key)
    )
  `);

  // Default feature access by role - what features each role gets by default
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_role_default_features (
      id SERIAL PRIMARY KEY,
      role_name VARCHAR(50) NOT NULL,
      feature_key VARCHAR(50) NOT NULL,
      is_enabled BOOLEAN DEFAULT true,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(role_name, feature_key)
    )
  `);

  // Indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_feature_user ON acc_user_feature_access(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_feature_key ON acc_user_feature_access(feature_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_feature_enabled ON acc_user_feature_access(user_id, is_enabled)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_role_default_features_role ON acc_role_default_features(role_name)`);

  // Seed the feature registry with all application features
  const features = [
    { key: 'dashboard', name: 'Dashboard', desc: 'Main dashboard with study overview', category: 'core', roleLevel: 0 },
    { key: 'training', name: 'Training Module', desc: 'GCP training and certification management', category: 'compliance', roleLevel: 0 },
    { key: 'econsent', name: 'eConsent', desc: 'Electronic informed consent management', category: 'clinical', roleLevel: 0 },
    { key: 'epro', name: 'ePRO/Patient Portal', desc: 'Patient-reported outcomes and portal access', category: 'clinical', roleLevel: 30 },
    { key: 'rtsm', name: 'RTSM/IRT', desc: 'Randomization and trial supply management', category: 'clinical', roleLevel: 60 },
    { key: 'randomization', name: 'Randomization', desc: 'Subject randomization and unblinding', category: 'clinical', roleLevel: 40 },
    { key: 'woundScanner', name: 'Wound Scanner', desc: 'iOS wound measurement and imaging', category: 'clinical', roleLevel: 0 },
    { key: 'aiAssistant', name: 'AI Assistant', desc: 'AI-powered protocol and data assistant', category: 'tools', roleLevel: 0 },
    { key: 'dataLock', name: 'Data Lock Management', desc: 'Database lock and freeze controls', category: 'data', roleLevel: 60 },
    { key: 'userManagement', name: 'User Management', desc: 'Create, edit, and manage user accounts', category: 'admin', roleLevel: 70 },
    { key: 'reporting', name: 'Reports & Exports', desc: 'Study data exports and compliance reports', category: 'data', roleLevel: 30 },
    { key: 'siteManagement', name: 'Site Management', desc: 'Manage clinical trial sites', category: 'admin', roleLevel: 60 },
    { key: 'studyManagement', name: 'Study Management', desc: 'Create and configure studies', category: 'admin', roleLevel: 70 },
    { key: 'emailNotifications', name: 'Email Notifications', desc: 'Email notification management', category: 'tools', roleLevel: 60 },
  ];

  for (const f of features) {
    await pool.query(`
      INSERT INTO acc_feature (feature_key, display_name, description, category, requires_role_level)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (feature_key) DO UPDATE SET
        display_name = $2, description = $3, category = $4, requires_role_level = $5, date_updated = NOW()
    `, [f.key, f.name, f.desc, f.category, f.roleLevel]);
  }

  // Seed default role-feature mappings (6 industry-standard EDC roles)
  const roleDefaults: Record<string, string[]> = {
    'admin':        ['dashboard', 'training', 'econsent', 'epro', 'rtsm', 'randomization', 'woundScanner', 'aiAssistant', 'dataLock', 'userManagement', 'reporting', 'siteManagement', 'studyManagement', 'emailNotifications'],
    'data_manager': ['dashboard', 'training', 'econsent', 'epro', 'rtsm', 'randomization', 'woundScanner', 'aiAssistant', 'dataLock', 'reporting', 'siteManagement', 'studyManagement'],
    'investigator': ['dashboard', 'training', 'econsent', 'epro', 'randomization', 'woundScanner', 'aiAssistant', 'reporting'],
    'coordinator':  ['dashboard', 'training', 'econsent', 'woundScanner', 'aiAssistant'],
    'monitor':      ['dashboard', 'training', 'econsent', 'reporting', 'aiAssistant'],
    'viewer':       ['dashboard', 'training', 'reporting'],
  };

  for (const [roleName, featureKeys] of Object.entries(roleDefaults)) {
    for (const featureKey of featureKeys) {
      await pool.query(`
        INSERT INTO acc_role_default_features (role_name, feature_key, is_enabled)
        VALUES ($1, $2, true)
        ON CONFLICT (role_name, feature_key) DO NOTHING
      `, [roleName, featureKey]);
    }
  }

  logger.info('User feature access tables verified and seeded');
}

/**
 * Form Workflow Configuration
 * 
 * Per-CRF lifecycle settings: SDV, PI signature, DDE, query routing.
 * These configure which steps a form must pass through before lock.
 */
async function createFormWorkflowConfigTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_form_workflow_config (
      config_id       SERIAL PRIMARY KEY,
      crf_id          INTEGER NOT NULL,
      study_id        INTEGER,
      requires_sdv        BOOLEAN NOT NULL DEFAULT false,
      requires_signature  BOOLEAN NOT NULL DEFAULT false,
      requires_dde        BOOLEAN NOT NULL DEFAULT false,
      query_route_to_user  VARCHAR(255),
      query_route_to_users TEXT DEFAULT '[]',
      updated_by      INTEGER,
      date_updated    TIMESTAMP DEFAULT NOW(),
      UNIQUE(crf_id, study_id)
    )
  `);

  // Migration: add query_route_to_users column if it doesn't exist (for existing installs)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'acc_form_workflow_config' AND column_name = 'query_route_to_users'
      ) THEN
        ALTER TABLE acc_form_workflow_config ADD COLUMN query_route_to_users TEXT DEFAULT '[]';
      END IF;
    END $$
  `);

  logger.info('Form workflow config table verified');
}

/**
 * Workflow Tasks Table
 * 
 * Dedicated table for workflow task management, replacing the pattern of
 * storing tasks in audit_log_event.  Supports multi-user assignment via
 * INTEGER[] column and proper status tracking with timestamps.
 */
async function createWorkflowTasksTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_workflow_tasks (
      task_id           SERIAL PRIMARY KEY,
      task_type         VARCHAR(50) NOT NULL,
      title             VARCHAR(255) NOT NULL,
      description       TEXT,
      status            VARCHAR(30) NOT NULL DEFAULT 'pending',
      priority          VARCHAR(20) NOT NULL DEFAULT 'medium',
      entity_type       VARCHAR(50),
      entity_id         INTEGER,
      event_crf_id      INTEGER,
      study_id          INTEGER,
      assigned_to_user_ids INTEGER[] DEFAULT '{}',
      created_by        INTEGER NOT NULL,
      completed_by      INTEGER,
      date_created      TIMESTAMP NOT NULL DEFAULT NOW(),
      date_updated      TIMESTAMP NOT NULL DEFAULT NOW(),
      date_completed    TIMESTAMP,
      due_date          TIMESTAMP,
      metadata          JSONB DEFAULT '{}'
    )
  `);

  // Indexes for common lookups
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_tasks_status ON acc_workflow_tasks(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_tasks_study ON acc_workflow_tasks(study_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wf_tasks_event_crf ON acc_workflow_tasks(event_crf_id)`);

  logger.info('Workflow tasks table verified');
}

/**
 * In-App Notifications Table
 * 
 * Stores per-user notifications for query assignments, form review requests,
 * workflow transitions, and other EDC events.
 */
async function createNotificationsTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_notifications (
      notification_id   SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL,
      notification_type VARCHAR(50) NOT NULL,
      title             VARCHAR(255) NOT NULL,
      message           TEXT NOT NULL,
      is_read           BOOLEAN NOT NULL DEFAULT false,
      entity_type       VARCHAR(50),
      entity_id         INTEGER,
      study_id          INTEGER,
      link_url          VARCHAR(500),
      date_created      TIMESTAMP NOT NULL DEFAULT NOW(),
      date_read         TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON acc_notifications(user_id, is_read) WHERE is_read = false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_user_date ON acc_notifications(user_id, date_created DESC)`);

  logger.info('Notifications table verified');
}
