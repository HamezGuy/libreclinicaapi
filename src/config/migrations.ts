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
    { name: 'visit_windows', fn: createVisitWindowColumns },
    { name: 'task_status_tracking', fn: createTaskStatusTrackingTable },
    { name: 'validation_rules', fn: createValidationRulesTable },
    { name: 'user_custom_permissions', fn: createUserCustomPermissionsTable },
    { name: 'user_account_extended', fn: createUserAccountExtendedTable },
    { name: 'file_uploads', fn: createFileUploadsTable },
    { name: 'audit_user_api_log', fn: createAuditUserApiLogTable },
    { name: 'study_extended_columns', fn: createStudyExtendedColumns },
    { name: 'study_group_class_extended', fn: createStudyGroupClassExtendedColumns },
    { name: 'event_crf_extended', fn: createEventCrfExtendedColumns },
    { name: 'patient_event_form_table', fn: createPatientEventFormTable },
    { name: 'patient_event_form_unique_constraint', fn: addPatientEventFormUniqueConstraint },
    { name: 'unscheduled_visit_isolation', fn: createUnscheduledVisitIsolation },
    { name: 'widen_description_columns', fn: widenDescriptionColumns },
    { name: 'fix_double_encoded_json', fn: fixDoubleEncodedJson },
    { name: 'form_folders', fn: createFormFolderTables },
    { name: 'form_folders_nesting', fn: createFormFolderNesting },
    { name: 'screening_date_column', fn: createScreeningDateColumn },
    { name: 'widen_study_columns', fn: widenStudyColumns },
    { name: 'query_severity_column', fn: createQuerySeverityColumn },
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

  // Add scanned consent and Part 11 metadata columns if not present
  for (const col of [
    { name: 'scanned_consent_file_ids', type: 'JSONB' },
    { name: 'is_scanned_consent', type: 'BOOLEAN DEFAULT FALSE' },
    { name: 'subject_signature_id', type: 'INTEGER' },
    { name: 'witness_signature_id', type: 'INTEGER' },
    { name: 'lar_signature_id', type: 'INTEGER' },
    { name: 'investigator_signature_id', type: 'INTEGER' },
    { name: 'content_hash', type: 'VARCHAR(128)' },
    { name: 'device_info', type: 'JSONB' },
    { name: 'page_view_records', type: 'JSONB' },
    { name: 'consent_form_data', type: 'JSONB' },
    { name: 'template_id', type: 'VARCHAR(255)' },
  ]) {
    await pool.query(`
      ALTER TABLE acc_subject_consent ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
    `).catch(() => {});
  }

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

  // Backfill columns that may be missing if the table was created by the .sql migration
  for (const col of [
    { name: 'status', type: "VARCHAR(20) DEFAULT 'in_progress'" },
    { name: 'patient_account_id', type: 'INTEGER' },
    { name: 'completion_percentage', type: 'NUMERIC DEFAULT 0' },
    { name: 'severity_category', type: 'VARCHAR(50)' },
    { name: 'subscale_scores', type: 'JSONB' },
    { name: 'total_score', type: 'NUMERIC' },
    { name: 'date_updated', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ]) {
    await pool.query(`ALTER TABLE acc_pro_response ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`).catch(() => {});
  }

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
    // Core — always-visible base functionality
    { key: 'dashboard', name: 'Dashboard', desc: 'Main dashboard with study overview and patient management', category: 'core', roleLevel: 0 },
    { key: 'myTasks', name: 'My Tasks', desc: 'Personal task queue and workflow items', category: 'core', roleLevel: 0 },
    { key: 'notifications', name: 'Notifications', desc: 'In-app notifications and notification preferences', category: 'core', roleLevel: 0 },

    // Patient & Subject Management
    { key: 'patientManagement', name: 'Patient Management', desc: 'View, search, enroll, and edit patient/subject records', category: 'patients', roleLevel: 0 },
    { key: 'patientEnrollment', name: 'Patient Enrollment', desc: 'Enroll new patients into studies', category: 'patients', roleLevel: 20 },
    { key: 'patientPhi', name: 'Patient PHI Access', desc: 'View protected health information (SSN, DOB, contact info)', category: 'patients', roleLevel: 30 },

    // Data Entry & Forms
    { key: 'formDataEntry', name: 'Form Data Entry', desc: 'Fill in and edit eCRF form data for patients', category: 'data_entry', roleLevel: 0 },
    { key: 'formManagement', name: 'Form / Template Management', desc: 'Create, edit, publish, and archive CRF form templates', category: 'data_entry', roleLevel: 40 },
    { key: 'formLayout', name: 'Form Layout Editor', desc: 'Visual drag-and-drop form layout configuration', category: 'data_entry', roleLevel: 40 },
    { key: 'dde', name: 'Double Data Entry', desc: 'Dual data entry for transcription verification', category: 'data_entry', roleLevel: 30 },
    { key: 'dataImport', name: 'Data Import', desc: 'Import patient and form data from external sources', category: 'data_entry', roleLevel: 60 },
    { key: 'fileUploads', name: 'File Uploads', desc: 'Upload and attach files and images to form fields', category: 'data_entry', roleLevel: 0 },
    { key: 'ocrScanning', name: 'OCR Paper Form Scanning', desc: 'Scan and digitize paper CRFs using optical character recognition', category: 'data_entry', roleLevel: 30 },

    // Clinical Operations
    { key: 'econsent', name: 'eConsent', desc: 'Electronic informed consent creation, signing, and tracking', category: 'clinical', roleLevel: 0 },
    { key: 'epro', name: 'ePRO / Patient Portal', desc: 'Patient-reported outcomes instruments and patient portal', category: 'clinical', roleLevel: 30 },
    { key: 'rtsm', name: 'RTSM / IRT', desc: 'Randomization and trial supply management (kit tracking, dispensing)', category: 'clinical', roleLevel: 60 },
    { key: 'randomization', name: 'Randomization', desc: 'Subject randomization, unblinding, and stratification', category: 'clinical', roleLevel: 40 },
    { key: 'woundScanner', name: 'Wound Scanner', desc: 'iOS wound measurement, imaging, and healing trajectory tracking', category: 'clinical', roleLevel: 0 },
    { key: 'transfers', name: 'Subject Transfers', desc: 'Transfer subjects between clinical sites', category: 'clinical', roleLevel: 40 },
    { key: 'adverseEvents', name: 'Adverse Events', desc: 'Adverse event and serious AE reporting', category: 'clinical', roleLevel: 20 },
    { key: 'coding', name: 'Medical Coding', desc: 'MedDRA (conditions/AEs) and WHODrug (medications) coding', category: 'clinical', roleLevel: 40 },
    { key: 'studyVisits', name: 'Study Visits / Phases', desc: 'Manage study visit schedules, event definitions, and windows', category: 'clinical', roleLevel: 40 },

    // Data Quality & Queries
    { key: 'queries', name: 'Data Queries', desc: 'Create, respond to, escalate, and resolve data discrepancy queries', category: 'data_quality', roleLevel: 0 },
    { key: 'validationRules', name: 'Validation Rules', desc: 'Configure field-level, cross-field, and cross-form edit checks', category: 'data_quality', roleLevel: 60 },
    { key: 'branching', name: 'Branching / Skip Logic', desc: 'Configure conditional field visibility, form linking, and skip logic', category: 'data_quality', roleLevel: 60 },

    // Compliance & Signatures (21 CFR Part 11)
    { key: 'sdv', name: 'Source Data Verification', desc: 'SDV dashboard, field-level verification, and verification workflows', category: 'compliance', roleLevel: 30 },
    { key: 'eSignature', name: 'Electronic Signatures', desc: 'Apply 21 CFR Part 11 compliant electronic signatures to forms', category: 'compliance', roleLevel: 20 },
    { key: 'dataLock', name: 'Data Lock / Freeze', desc: 'Lock and freeze form data, database locks, and point-in-time snapshots', category: 'compliance', roleLevel: 60 },
    { key: 'audit', name: 'Audit Trail', desc: 'View and export 21 CFR Part 11 compliant audit logs', category: 'compliance', roleLevel: 40 },
    { key: 'training', name: 'Training & Certification', desc: 'GCP training modules, quizzes, certificates, and compliance tracking', category: 'compliance', roleLevel: 0 },
    { key: 'complianceDashboard', name: 'Compliance Dashboard', desc: 'Overall compliance status, missing signatures, overdue SDV, and 21 CFR Part 11 checks', category: 'compliance', roleLevel: 30 },

    // Reports & Exports
    { key: 'reporting', name: 'Reports & Analytics', desc: 'Study data reports, enrollment metrics, and compliance dashboards', category: 'reports', roleLevel: 30 },
    { key: 'dataExport', name: 'Data Export', desc: 'Export study data in ODM XML, CSV, SAS, and regulatory formats', category: 'reports', roleLevel: 30 },
    { key: 'printPdf', name: 'Print / PDF Generation', desc: 'Print blank and filled CRFs, generate audit-ready PDFs', category: 'reports', roleLevel: 0 },

    // Administration
    { key: 'userManagement', name: 'User Management', desc: 'Create, edit, deactivate user accounts; assign roles and permissions', category: 'admin', roleLevel: 70 },
    { key: 'studyManagement', name: 'Study Management', desc: 'Create and configure studies, protocols, and study parameters', category: 'admin', roleLevel: 70 },
    { key: 'siteManagement', name: 'Site Management', desc: 'Manage clinical trial site locations, PIs, and IRB info', category: 'admin', roleLevel: 60 },
    { key: 'workflows', name: 'Workflow Configuration', desc: 'Configure form lifecycles, SDV requirements, signature rules, and task routing', category: 'admin', roleLevel: 60 },
    { key: 'adminAnalytics', name: 'User Analytics', desc: 'User activity analytics, login history, and usage statistics', category: 'admin', roleLevel: 70 },
    { key: 'emailNotifications', name: 'Email Notifications', desc: 'Email templates, delivery queue, and notification management', category: 'admin', roleLevel: 60 },
    { key: 'backupRecovery', name: 'Backup & Recovery', desc: 'Database backups, restore points, and disaster recovery', category: 'admin', roleLevel: 100 },
    { key: 'systemMonitoring', name: 'System Monitoring', desc: 'Server health, API metrics, and performance monitoring', category: 'admin', roleLevel: 100 },

    // Tools & Utilities
    { key: 'aiAssistant', name: 'AI Assistant', desc: 'AI-powered protocol assistant, data analysis, and natural language queries', category: 'tools', roleLevel: 0 },
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
    'admin': [
      // Core
      'dashboard', 'myTasks', 'notifications',
      // Patient
      'patientManagement', 'patientEnrollment', 'patientPhi',
      // Data Entry
      'formDataEntry', 'formManagement', 'formLayout', 'dde', 'dataImport', 'fileUploads', 'ocrScanning',
      // Clinical
      'econsent', 'epro', 'rtsm', 'randomization', 'woundScanner', 'transfers',
      'adverseEvents', 'coding', 'studyVisits',
      // Data Quality
      'queries', 'validationRules', 'branching',
      // Compliance
      'sdv', 'eSignature', 'dataLock', 'audit', 'training', 'complianceDashboard',
      // Reports
      'reporting', 'dataExport', 'printPdf',
      // Admin
      'userManagement', 'studyManagement', 'siteManagement', 'workflows',
      'adminAnalytics', 'emailNotifications', 'backupRecovery', 'systemMonitoring',
      // Tools
      'aiAssistant',
    ],
    'data_manager': [
      'dashboard', 'myTasks', 'notifications',
      'patientManagement', 'patientEnrollment', 'patientPhi',
      'formDataEntry', 'formManagement', 'formLayout', 'dde', 'dataImport', 'fileUploads', 'ocrScanning',
      'econsent', 'epro', 'rtsm', 'randomization', 'woundScanner', 'transfers',
      'adverseEvents', 'coding', 'studyVisits',
      'queries', 'validationRules', 'branching',
      'sdv', 'eSignature', 'dataLock', 'audit', 'training', 'complianceDashboard',
      'reporting', 'dataExport', 'printPdf',
      'studyManagement', 'siteManagement', 'workflows',
      'aiAssistant',
    ],
    'investigator': [
      'dashboard', 'myTasks', 'notifications',
      'patientManagement', 'patientEnrollment', 'patientPhi',
      'formDataEntry', 'fileUploads',
      'econsent', 'epro', 'randomization', 'woundScanner', 'adverseEvents',
      'queries',
      'eSignature', 'audit', 'training',
      'reporting', 'dataExport', 'printPdf',
      'aiAssistant',
    ],
    'coordinator': [
      'dashboard', 'myTasks', 'notifications',
      'patientManagement', 'patientEnrollment', 'patientPhi',
      'formDataEntry', 'fileUploads', 'ocrScanning',
      'econsent', 'woundScanner', 'adverseEvents', 'transfers',
      'queries',
      'training',
      'printPdf',
      'aiAssistant',
    ],
    'monitor': [
      'dashboard', 'myTasks', 'notifications',
      'patientManagement', 'patientPhi',
      'econsent',
      'queries',
      'sdv', 'eSignature', 'audit', 'training', 'complianceDashboard',
      'reporting', 'dataExport', 'printPdf',
      'aiAssistant',
    ],
    'viewer': [
      'dashboard', 'myTasks', 'notifications',
      'patientManagement',
      'queries',
      'training',
      'reporting', 'printPdf',
    ],
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
      query_route_to_users TEXT DEFAULT '[]',
      updated_by      INTEGER,
      date_updated    TIMESTAMP DEFAULT NOW()
    )
  `);

  // Drop the old plain UNIQUE constraint if it exists
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'acc_form_workflow_config_crf_id_study_id_key'
          AND conrelid = 'acc_form_workflow_config'::regclass
      ) THEN
        ALTER TABLE acc_form_workflow_config
          DROP CONSTRAINT acc_form_workflow_config_crf_id_study_id_key;
      END IF;
    END $$
  `);

  // Clean up duplicate rows (keep only the latest per crf_id + COALESCE(study_id,0))
  await pool.query(`
    DELETE FROM acc_form_workflow_config a
    USING acc_form_workflow_config b
    WHERE a.crf_id = b.crf_id
      AND COALESCE(a.study_id, 0) = COALESCE(b.study_id, 0)
      AND a.config_id < b.config_id
  `);

  // Functional unique index: COALESCE(study_id, 0) maps NULL → 0
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_form_workflow_config_crf_study
    ON acc_form_workflow_config (crf_id, COALESCE(study_id, 0))
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

  // Migrate legacy single-user data into JSON array, then drop the old column
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'acc_form_workflow_config' AND column_name = 'query_route_to_user'
      ) THEN
        UPDATE acc_form_workflow_config
        SET query_route_to_users = '["' || query_route_to_user || '"]'
        WHERE query_route_to_user IS NOT NULL
          AND query_route_to_user != ''
          AND (query_route_to_users IS NULL OR query_route_to_users = '[]');

        ALTER TABLE acc_form_workflow_config DROP COLUMN query_route_to_user;
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

// ============================================================================
// Visit Windows (schedule_day, min_day, max_day on study_event_definition)
// ============================================================================
async function createVisitWindowColumns(pool: any): Promise<void> {
  // Add visit window columns to study_event_definition
  // schedule_day: target day relative to Day 0 (e.g., Day 7, Day 14, Day 28)
  // min_day: minimum acceptable day (schedule_day - tolerance)
  // max_day: maximum acceptable day (schedule_day + tolerance)
  await pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS schedule_day INTEGER`);
  await pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS min_day INTEGER`);
  await pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS max_day INTEGER`);
  await pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS reference_event_id INTEGER`);

  logger.info('Visit window columns verified on study_event_definition');
}

// ============================================================================
// Task Status Tracking (acc_task_status)
// Tracks manual task completions and dismissals (uncompletable)
// ============================================================================
async function createTaskStatusTrackingTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_task_status (
      task_status_id    SERIAL PRIMARY KEY,
      task_id           VARCHAR(100) NOT NULL UNIQUE,
      status            VARCHAR(30) NOT NULL DEFAULT 'completed',
      completed_by      INTEGER,
      completed_at      TIMESTAMP DEFAULT NOW(),
      reason            TEXT,
      organization_id   INTEGER,
      date_created      TIMESTAMP NOT NULL DEFAULT NOW(),
      date_updated      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acc_task_status_task_id ON acc_task_status(task_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acc_task_status_status ON acc_task_status(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acc_task_status_org ON acc_task_status(organization_id)`);

  logger.info('Task status tracking table verified');
}

/**
 * Validation Rules Table
 */
async function createValidationRulesTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS validation_rules (
      validation_rule_id SERIAL PRIMARY KEY,
      crf_id INTEGER,
      crf_version_id INTEGER,
      item_id INTEGER,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      rule_type VARCHAR(50) NOT NULL,
      field_path VARCHAR(255),
      severity VARCHAR(20) DEFAULT 'error',
      error_message TEXT NOT NULL,
      warning_message TEXT,
      active BOOLEAN DEFAULT true,
      min_value NUMERIC,
      max_value NUMERIC,
      pattern TEXT,
      format_type VARCHAR(50),
      operator VARCHAR(20),
      compare_field_path VARCHAR(255),
      custom_expression TEXT,
      -- Blood pressure per-component validation limits
      bp_systolic_min NUMERIC,
      bp_systolic_max NUMERIC,
      bp_diastolic_min NUMERIC,
      bp_diastolic_max NUMERIC,
      date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      date_updated TIMESTAMP,
      owner_id INTEGER,
      update_id INTEGER
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_validation_rules_crf ON validation_rules(crf_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_validation_rules_item ON validation_rules(item_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(active)`);

  // Add columns that may be missing if the table was created by an earlier migration
  const columnsToAdd = [
    { name: 'format_type', type: 'VARCHAR(50)' },
    { name: 'operator', type: 'VARCHAR(20)' },
    { name: 'compare_field_path', type: 'VARCHAR(255)' },
    { name: 'custom_expression', type: 'TEXT' },
    // Blood pressure per-component limits — added in a later migration, backfilled here
    { name: 'bp_systolic_min', type: 'NUMERIC' },
    { name: 'bp_systolic_max', type: 'NUMERIC' },
    { name: 'bp_diastolic_min', type: 'NUMERIC' },
    { name: 'bp_diastolic_max', type: 'NUMERIC' },
  ];
  for (const col of columnsToAdd) {
    try {
      await pool.query(`ALTER TABLE validation_rules ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    } catch (e: any) {
      // Column may already exist — safe to ignore
    }
  }

  logger.info('Validation rules table verified');
}

/**
 * User Custom Permissions Table
 */
async function createUserCustomPermissionsTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_custom_permissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
      permission_key VARCHAR(64) NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT true,
      granted_by INTEGER,
      date_created TIMESTAMP DEFAULT NOW(),
      date_updated TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, permission_key)
    )
  `);
  logger.info('User custom permissions table verified');
}

/**
 * User Account Extended Table (bcrypt password storage)
 */
async function createUserAccountExtendedTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_account_extended (
      user_id INTEGER PRIMARY KEY,
      bcrypt_passwd VARCHAR(255),
      passwd_upgraded_at TIMESTAMP DEFAULT NOW(),
      password_version INTEGER DEFAULT 2
    )
  `);
  // Add platform_role column if it doesn't exist (stores the user's role
  // independent of study_user_role, so users without study assignments
  // still have their correct permission level).
  await pool.query(`
    ALTER TABLE user_account_extended
    ADD COLUMN IF NOT EXISTS platform_role VARCHAR(40)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE user_account_extended
    ADD COLUMN IF NOT EXISTS secondary_role VARCHAR(100)
  `).catch(() => {});
  logger.info('User account extended table verified');
}

/**
 * File Uploads Table
 */
async function createFileUploadsTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_uploads (
      file_id VARCHAR(64) PRIMARY KEY,
      original_name VARCHAR(512) NOT NULL,
      stored_name VARCHAR(512) NOT NULL,
      file_path VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      file_size INTEGER NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      crf_version_id INTEGER,
      item_id INTEGER,
      crf_version_media_id INTEGER,
      event_crf_id INTEGER,
      study_subject_id INTEGER,
      consent_id INTEGER,
      uploaded_by INTEGER NOT NULL DEFAULT 1,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP,
      deleted_by INTEGER
    )
  `);
  // Add columns if table already exists without them
  for (const col of [
    { name: 'event_crf_id', type: 'INTEGER' },
    { name: 'study_subject_id', type: 'INTEGER' },
    { name: 'consent_id', type: 'INTEGER' },
  ]) {
    await pool.query(`
      ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
    `).catch(() => {});
  }
  logger.info('File uploads table verified');
}

/**
 * Audit User API Log Table
 */
async function createAuditUserApiLogTable(pool: any): Promise<void> {
  await pool.query(`
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
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_api_log_user ON audit_user_api_log(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_api_log_created ON audit_user_api_log(created_at)`);
  logger.info('Audit user API log table verified');
}

// ============================================================================
// Study Extended Columns
// Adds columns to the study table that may be missing on older DB schemas
// ============================================================================
async function createStudyExtendedColumns(pool: any): Promise<void> {
  const columnsToAdd = [
    { name: 'study_acronym', type: 'VARCHAR(64)' },
    { name: 'protocol_version', type: 'VARCHAR(30)' },
    { name: 'protocol_amendment_number', type: 'VARCHAR(30)' },
    { name: 'therapeutic_area', type: 'VARCHAR(255)' },
    { name: 'indication', type: 'VARCHAR(255)' },
    { name: 'nct_number', type: 'VARCHAR(30)' },
    { name: 'irb_number', type: 'VARCHAR(255)' },
    { name: 'regulatory_authority', type: 'VARCHAR(255)' },
    { name: 'fpfv_date', type: 'DATE' },
    { name: 'lpfv_date', type: 'DATE' },
    { name: 'lplv_date', type: 'DATE' },
    { name: 'database_lock_date', type: 'DATE' },
    { name: 'sdv_requirement', type: 'VARCHAR(64)' },
  ];

  for (const col of columnsToAdd) {
    try {
      await pool.query(`ALTER TABLE study ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    } catch (e: any) {
      // Column may already exist — safe to ignore
    }
  }

  logger.info('Study extended columns verified');
}

// ============================================================================
// Study Group Class Extended Columns
// Adds custom_type_name for flexible group class types
// ============================================================================
async function createStudyGroupClassExtendedColumns(pool: any): Promise<void> {
  try {
    await pool.query(`ALTER TABLE study_group_class ADD COLUMN IF NOT EXISTS custom_type_name VARCHAR(255)`);
  } catch (e: any) {
    // Column may already exist — safe to ignore
  }

  logger.info('Study group class extended columns verified');
}

// ============================================================================
// Event CRF Extended Columns
// The form.service.ts references 'frozen' and 'completion_status_id'
// which may not exist on older LibreClinica schemas.
// ============================================================================
async function createEventCrfExtendedColumns(pool: any): Promise<void> {
  // Add 'frozen' column for data freeze functionality
  try {
    await pool.query(`ALTER TABLE event_crf ADD COLUMN IF NOT EXISTS frozen BOOLEAN DEFAULT false`);
  } catch { /* already exists */ }

  // Add 'sdv_status' for source data verification tracking
  try {
    await pool.query(`ALTER TABLE event_crf ADD COLUMN IF NOT EXISTS sdv_status BOOLEAN DEFAULT false`);
  } catch { /* already exists */ }

  // Add 'electronic_signature_status' for e-sig tracking
  try {
    await pool.query(`ALTER TABLE event_crf ADD COLUMN IF NOT EXISTS electronic_signature_status BOOLEAN DEFAULT false`);
  } catch { /* already exists */ }

  // Ensure completion_status table has the required rows for form lifecycle.
  // The form save service uses: 1=initial, 2=data entry started, 4=complete.
  // LibreClinica Core only seeds ID 1; we need 2-6 for data entry tracking.
  try {
    const requiredRows = [
      { id: 2, name: 'data entry started', desc: 'Data Entry Started' },
      { id: 3, name: 'data entry complete', desc: 'Data Entry Complete' },
      { id: 4, name: 'complete', desc: 'Complete' },
      { id: 5, name: 'initial data entry complete', desc: 'Initial Data Entry Complete' },
      { id: 6, name: 'double data entry complete', desc: 'Double Data Entry Complete' },
    ];
    for (const row of requiredRows) {
      await pool.query(`
        INSERT INTO completion_status (completion_status_id, status_id, name, description)
        VALUES ($1, 1, $2, $3)
        ON CONFLICT (completion_status_id) DO NOTHING
      `, [row.id, row.name, row.desc]);
    }
  } catch (e: any) {
    // Table structure may differ — ignore
  }

  logger.info('Event CRF extended columns verified');
}

// ============================================================================
// Patient Event Form Table — frozen JSONB snapshots per patient per visit form.
// Must exist BEFORE any enrollment or event scheduling so snapshots can be created.
// ============================================================================
async function createPatientEventFormTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_event_form (
      patient_event_form_id SERIAL PRIMARY KEY,
      study_event_id INTEGER NOT NULL,
      event_crf_id INTEGER,
      crf_id INTEGER NOT NULL,
      crf_version_id INTEGER NOT NULL,
      study_subject_id INTEGER NOT NULL,
      form_name VARCHAR(255) NOT NULL,
      form_structure JSONB NOT NULL DEFAULT '{}',
      form_data JSONB NOT NULL DEFAULT '{}',
      completion_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
      is_locked BOOLEAN NOT NULL DEFAULT false,
      is_frozen BOOLEAN NOT NULL DEFAULT false,
      sdv_status BOOLEAN NOT NULL DEFAULT false,
      ordinal INTEGER DEFAULT 1,
      date_created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      date_updated TIMESTAMP WITH TIME ZONE,
      created_by INTEGER,
      updated_by INTEGER
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pef_study_event ON patient_event_form(study_event_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pef_subject ON patient_event_form(study_subject_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pef_event_crf ON patient_event_form(event_crf_id)`);

  logger.info('patient_event_form table verified');
}

// ============================================================================
// Patient Event Form — unique constraint on event_crf_id (needed for UPSERT)
// ============================================================================
async function addPatientEventFormUniqueConstraint(pool: any): Promise<void> {
  try {
    // Add unique index idempotently — CREATE UNIQUE INDEX IF NOT EXISTS is safe
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pef_event_crf_unique
      ON patient_event_form (event_crf_id)
      WHERE event_crf_id IS NOT NULL
    `);
    logger.info('patient_event_form unique index on event_crf_id verified');
  } catch (e: any) {
    // Index or table may not exist yet — non-fatal
    logger.warn('patient_event_form unique index migration warning:', e.message);
  }
}

// ============================================================================
// Unscheduled Visit Isolation
// Ensures is_unscheduled column on study_event, and adds an index on
// study_event_definition.category for filtering SubjectSpecific definitions.
// Also retroactively tags orphan custom unscheduled definitions as SubjectSpecific
// if they were created before this migration.
// ============================================================================
async function createUnscheduledVisitIsolation(pool: any): Promise<void> {
  // Ensure is_unscheduled column exists on study_event
  try {
    await pool.query(`ALTER TABLE study_event ADD COLUMN IF NOT EXISTS is_unscheduled BOOLEAN DEFAULT false`);
  } catch { /* already exists */ }

  // Index for fast filtering of SubjectSpecific event definitions
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sed_category_subject_specific
      ON study_event_definition (study_id, category)
      WHERE category LIKE '%SubjectSpecific%'
    `);
  } catch { /* index may already exist */ }

  // Retroactively tag any orphaned custom unscheduled definitions.
  // These are definitions created by the old code (category = 'Unscheduled')
  // that are NOT the premade unscheduled visit types (which typically have
  // ordinal <= the max scheduled ordinal) but are ad-hoc patient-created ones.
  // We identify them by: type = 'unscheduled', category = 'Unscheduled',
  // and oc_oid containing '_UNSCHED_' (the pattern used by createUnscheduledVisit).
  try {
    await pool.query(`
      UPDATE study_event_definition
      SET category = 'Unscheduled:SubjectSpecific'
      WHERE type = 'unscheduled'
        AND category = 'Unscheduled'
        AND oc_oid LIKE '%_UNSCHED_%'
    `);
  } catch { /* best effort */ }

  logger.info('Unscheduled visit isolation migration verified');
}

// ============================================================================
// Widen varchar(4000) columns to TEXT for extended properties / options
// The item.description column stores serialized JSON (extended props) that
// easily exceeds 4000 chars for complex fields (tables, criteria, branching).
// response_set.options_text/options_values can also overflow for many options.
// ============================================================================
async function widenDescriptionColumns(pool: any): Promise<void> {
  const columns = [
    { table: 'item', column: 'description' },
    { table: 'response_set', column: 'options_text' },
    { table: 'response_set', column: 'options_values' },
    { table: 'response_set', column: 'label' },
    { table: 'crf_version', column: 'description' },
    { table: 'item_data', column: 'value' },
    { table: 'discrepancy_note', column: 'description' },
    { table: 'discrepancy_note', column: 'detailed_notes' },
  ];

  for (const { table, column } of columns) {
    try {
      const check = await pool.query(`
        SELECT data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [table, column]);
      if (check.rows.length > 0 && check.rows[0].character_maximum_length) {
        await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT`);
        logger.info(`Widened ${table}.${column} from varchar(${check.rows[0].character_maximum_length}) to TEXT`);
      }
    } catch (e: any) {
      // Column may not exist or already be TEXT
    }
  }

  logger.info('Description column widening verified');
}

// ============================================================================
// Fix double-encoded JSON in patient_event_form.form_data and item_data.value
//
// Symptom: table field data stored as a JSON-encoded string inside JSONB,
//   e.g. form_data = {"field": "[{\"col\":\"val\"}]"}  (string, not array)
//   instead of {"field": [{"col":"val"}]}               (proper array)
//
// Also fixes item_data.value where table data was double-escaped,
//   e.g. value = '"[{\\"col\\":\\"val\\"}]"' instead of '[{"col":"val"}]'
// ============================================================================
async function fixDoubleEncodedJson(pool: any): Promise<void> {
  let fixed = 0;

  // Phase 1: Fix patient_event_form.form_data JSONB
  // Find rows where any value in the form_data object is a string that looks
  // like a JSON array/object (starts with [ or {). These are double-encoded.
  try {
    const rows = await pool.query(`
      SELECT patient_event_form_id, form_data
      FROM patient_event_form
      WHERE form_data IS NOT NULL
        AND form_data::text != '{}'
        AND form_data::text LIKE '%"[%'
    `);

    for (const row of rows.rows) {
      const data = row.form_data;
      if (!data || typeof data !== 'object') continue;

      let changed = false;
      const cleaned: Record<string, any> = {};

      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 1) {
          const trimmed = (value as string).trim();
          if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
              (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
              cleaned[key] = JSON.parse(trimmed);
              changed = true;
              continue;
            } catch { /* not valid JSON, keep as string */ }
          }
        }
        cleaned[key] = value;
      }

      if (changed) {
        await pool.query(
          `UPDATE patient_event_form SET form_data = $1::jsonb WHERE patient_event_form_id = $2`,
          [JSON.stringify(cleaned), row.patient_event_form_id]
        );
        fixed++;
      }
    }
    if (fixed > 0) {
      logger.info(`Fixed ${fixed} double-encoded form_data rows in patient_event_form`);
    }
  } catch (e: any) {
    logger.warn('Phase 1 (fix form_data JSONB) skipped:', e.message);
  }

  // Phase 2: Fix item_data.value for double-escaped JSON strings
  // These look like: '"[{\"col\":\"val\"}]"' (note leading/trailing quotes)
  let fixedItems = 0;
  try {
    const itemRows = await pool.query(`
      SELECT item_data_id, value
      FROM item_data
      WHERE deleted = false
        AND value IS NOT NULL
        AND LENGTH(value) > 4
        AND (value LIKE '"[%' OR value LIKE '"{%')
    `);

    for (const row of itemRows.rows) {
      const v = row.value;
      if (typeof v !== 'string') continue;
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed === 'string' && (parsed.startsWith('[') || parsed.startsWith('{'))) {
          JSON.parse(parsed);
          await pool.query(
            `UPDATE item_data SET value = $1 WHERE item_data_id = $2`,
            [parsed, row.item_data_id]
          );
          fixedItems++;
        }
      } catch { /* not double-encoded */ }
    }
    if (fixedItems > 0) {
      logger.info(`Fixed ${fixedItems} double-encoded item_data.value rows`);
    }
  } catch (e: any) {
    logger.warn('Phase 2 (fix item_data values) skipped:', e.message);
  }

  logger.info(`Double-encoded JSON fix complete: ${fixed} JSONB rows, ${fixedItems} item_data rows`);
}

// ============================================================================
// Form Folders (acc_form_folder, acc_form_folder_item)
// Visual-only folder organization for forms in the dashboard.
// Does not affect form behavior, assignments, or clinical data.
// ============================================================================
async function createFormFolderTables(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_form_folder (
      folder_id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      study_id INTEGER,
      owner_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      date_created TIMESTAMP DEFAULT NOW(),
      date_updated TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_form_folder_item (
      folder_item_id SERIAL PRIMARY KEY,
      folder_id INTEGER NOT NULL REFERENCES acc_form_folder(folder_id) ON DELETE CASCADE,
      crf_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      date_added TIMESTAMP DEFAULT NOW(),
      UNIQUE(folder_id, crf_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_study ON acc_form_folder(study_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_owner ON acc_form_folder(owner_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_item_folder ON acc_form_folder_item(folder_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_item_crf ON acc_form_folder_item(crf_id)
  `);
}

async function createFormFolderNesting(pool: any): Promise<void> {
  await pool.query(`
    ALTER TABLE acc_form_folder
    ADD COLUMN IF NOT EXISTS parent_folder_id INTEGER REFERENCES acc_form_folder(folder_id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_parent ON acc_form_folder(parent_folder_id)
  `);
  logger.info('parent_folder_id column verified on acc_form_folder');
}

async function createScreeningDateColumn(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE study_subject ADD COLUMN IF NOT EXISTS screening_date DATE`);
  logger.info('screening_date column verified on study_subject');
}

async function widenStudyColumns(pool: any): Promise<void> {
  const alterations = [
    { table: 'study', column: 'name', type: 'VARCHAR(500)' },
    { table: 'study', column: 'unique_identifier', type: 'VARCHAR(255)' },
    { table: 'study', column: 'summary', type: 'TEXT' },
    { table: 'study', column: 'principal_investigator', type: 'VARCHAR(500)' },
    { table: 'study', column: 'sponsor', type: 'VARCHAR(500)' },
    { table: 'study', column: 'collaborators', type: 'TEXT' },
    { table: 'study', column: 'url', type: 'VARCHAR(2000)' },
    { table: 'study', column: 'url_description', type: 'VARCHAR(1000)' },
    { table: 'study', column: 'conditions', type: 'TEXT' },
    { table: 'study', column: 'keywords', type: 'VARCHAR(2000)' },
    { table: 'study', column: 'eligibility', type: 'TEXT' },
    { table: 'study', column: 'protocol_description', type: 'TEXT' },
    { table: 'study', column: 'facility_name', type: 'VARCHAR(500)' },
    { table: 'study', column: 'facility_address', type: 'VARCHAR(2000)' },
    { table: 'study', column: 'facility_city', type: 'VARCHAR(500)' },
    { table: 'study', column: 'facility_state', type: 'VARCHAR(100)' },
    { table: 'study', column: 'facility_zip', type: 'VARCHAR(100)' },
    { table: 'study', column: 'facility_country', type: 'VARCHAR(100)' },
    { table: 'study', column: 'facility_recruitment_status', type: 'VARCHAR(100)' },
    { table: 'study', column: 'facility_contact_name', type: 'VARCHAR(500)' },
    { table: 'study', column: 'facility_contact_degree', type: 'VARCHAR(500)' },
    { table: 'study', column: 'facility_contact_phone', type: 'VARCHAR(500)' },
    { table: 'study', column: 'facility_contact_email', type: 'VARCHAR(500)' },
    { table: 'study', column: 'medline_identifier', type: 'VARCHAR(500)' },
    { table: 'study', column: 'protocol_version', type: 'VARCHAR(100)' },
    { table: 'study', column: 'protocol_type', type: 'VARCHAR(100)' },
    { table: 'study', column: 'purpose', type: 'VARCHAR(200)' },
    { table: 'study', column: 'allocation', type: 'VARCHAR(200)' },
    { table: 'study', column: 'masking', type: 'VARCHAR(100)' },
    { table: 'study', column: 'control', type: 'VARCHAR(100)' },
    { table: 'study', column: 'assignment', type: 'VARCHAR(100)' },
    { table: 'study', column: 'endpoint', type: 'VARCHAR(200)' },
    { table: 'study', column: 'duration', type: 'VARCHAR(100)' },
    { table: 'study', column: 'selection', type: 'VARCHAR(100)' },
    { table: 'study', column: 'timing', type: 'VARCHAR(100)' },
    { table: 'study', column: 'age_min', type: 'VARCHAR(30)' },
    { table: 'study', column: 'age_max', type: 'VARCHAR(30)' },
    { table: 'study', column: 'official_title', type: 'TEXT' },
    { table: 'study', column: 'secondary_identifier', type: 'VARCHAR(500)' },
    { table: 'study', column: 'interventions', type: 'TEXT' },
  ];

  let changed = 0;
  for (const { table, column, type } of alterations) {
    try {
      const check = await pool.query(
        `SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      if (check.rows.length === 0) continue;
      const row = check.rows[0];
      const isText = type === 'TEXT';
      const targetLen = isText ? null : parseInt(type.match(/\d+/)?.[0] || '0');
      if (row.data_type === 'text' && isText) continue;
      if (row.character_maximum_length && targetLen && row.character_maximum_length >= targetLen) continue;

      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${type}`);
      changed++;
    } catch (err: any) {
      logger.warn(`Could not widen ${table}.${column} to ${type}: ${err.message}`);
    }
  }
  logger.info(`Study columns widened: ${changed} column(s) updated`);
}

async function createQuerySeverityColumn(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'minor'`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS due_date DATE`);
  logger.info('severity and due_date columns verified on discrepancy_note');
}
