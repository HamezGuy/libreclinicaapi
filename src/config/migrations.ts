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
 * ISSUE-414: returns true if the given column is referenced by a view or
 * rule. ALTER TABLE ... ALTER COLUMN TYPE will fail with "cannot alter type
 * of a column used by a view or rule" in that case, so callers should skip
 * the alter rather than attempt-and-fail (which logs at ERROR level via
 * the database wrapper).
 *
 * Returns true if blocked. Returns false on the (rare) case the dependency
 * probe itself errors, so the caller still attempts the alter and
 * preserves prior behavior.
 */
async function columnHasDependentViewOrRule(
  pool: any,
  table: string,
  column: string
): Promise<boolean> {
  try {
    const res = await pool.query(
      `SELECT 1
         FROM pg_depend d
         JOIN pg_attribute a
           ON d.refobjid = a.attrelid AND d.refobjsubid = a.attnum
         JOIN pg_class c
           ON d.refobjid = c.oid
         JOIN pg_namespace n
           ON c.relnamespace = n.oid
        WHERE n.nspname = current_schema()
          AND c.relname = $1
          AND a.attname = $2
          AND d.classid = 'pg_rewrite'::regclass
          AND d.deptype <> 'i'
        LIMIT 1`,
      [table, column]
    );
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

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
    { name: 'econsent_nullable_version', fn: makeVersionIdNullable },
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
    { name: 'query_generation_type_column', fn: createQueryGenerationTypeColumn },
    { name: 'unlock_requests', fn: createUnlockRequestTable },
    { name: 'econsent_extended_columns', fn: addEconsentExtendedColumns },
    { name: 'patient_event_form_query_counts', fn: addPatientEventFormQueryCounts },
    { name: 'fix_null_phi_required_columns', fn: fixNullPhiRequiredColumns },
    { name: 'visit_date_reference_columns', fn: addVisitDateReferenceColumns },
    { name: 'query_pending_correction_columns', fn: createQueryPendingCorrectionColumns },
    { name: 'form_folder_org_scoping', fn: addFormFolderOrgScoping },
    { name: 'audit_immutability_triggers', fn: createAuditImmutabilityTriggers },
    { name: 'audit_hash_chain_columns', fn: addAuditHashChainColumns },
    { name: 'interop_audit_log', fn: createInteropAuditLogTable },
    { name: 'crf_fork_provenance', fn: createCrfForkProvenanceColumns },
    { name: 'study_subject_label_unique', fn: addStudySubjectLabelUniqueIndex },
    { name: 'pef_query_count_trigger', fn: createPefQueryCountTrigger },
    { name: 'repair_patients_without_events', fn: repairPatientsWithoutEvents },
    { name: 'query_cell_target_columns', fn: addQueryCellTargetColumns },
    { name: 'password_history', fn: createPasswordHistoryTable },
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

  // Seed email templates — only query-related templates are active.
  // Other templates are kept as inactive seeds so they're ready if needed later.
  const templates = [
    {
      name: 'query_opened',
      subject: 'New Query Assigned — {{studyName}}',
      html: `<h2>New Query Assigned</h2><p>A query has been assigned to you in <strong>{{studyName}}</strong>.</p><p><strong>Subject:</strong> {{subjectLabel}}<br/><strong>Created by:</strong> {{createdByName}}</p><blockquote>{{queryText}}</blockquote><p><a href="{{dashboardUrl}}">View in Dashboard</a></p>`,
      text: 'New Query Assigned\n\nA query has been assigned to you in {{studyName}}.\nSubject: {{subjectLabel}}\nCreated by: {{createdByName}}\n\n{{queryText}}\n\nView in Dashboard: {{dashboardUrl}}',
      desc: 'Sent when a query is assigned to a user',
    },
    {
      name: 'query_response',
      subject: 'Query Response — {{studyName}}',
      html: `<h2>Query Response Received</h2><p><strong>{{respondedByName}}</strong> responded to a query in <strong>{{studyName}}</strong>.</p><blockquote>{{responseText}}</blockquote><p><a href="{{dashboardUrl}}">View in Dashboard</a></p>`,
      text: 'Query Response Received\n\n{{respondedByName}} responded to a query in {{studyName}}.\n\n{{responseText}}\n\nView: {{dashboardUrl}}',
      desc: 'Sent when a query receives a response',
    },
    {
      name: 'query_closed',
      subject: 'Query Closed — {{studyName}}',
      html: `<h2>Query Closed</h2><p>A query in <strong>{{studyName}}</strong> has been closed by <strong>{{closedByName}}</strong>.</p><p><a href="{{dashboardUrl}}">View in Dashboard</a></p>`,
      text: 'Query Closed\n\nA query in {{studyName}} has been closed by {{closedByName}}.\n\nView: {{dashboardUrl}}',
      desc: 'Sent when a query is closed',
    },
  ];

  for (const t of templates) {
    await pool.query(`
      INSERT INTO acc_email_template (name, subject, html_body, text_body, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (name) DO NOTHING
    `, [t.name, t.subject, t.html, t.text, t.desc]);
  }

  logger.info('Email notification tables and templates verified');
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
// eConsent — Make version_id nullable (for late consent entry without document)
// ============================================================================
async function makeVersionIdNullable(pool: any): Promise<void> {
  await pool.query(`
    ALTER TABLE acc_subject_consent ALTER COLUMN version_id DROP NOT NULL
  `).catch(() => {});
  logger.info('eConsent version_id nullable migration applied');
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
// DEPRECATED: The acc_wound_capture table below is superseded by the
// wound_sessions / wound_images / wound_measurements schema, which is the
// active implementation used by all services.  This CREATE TABLE statement is
// retained solely for backward compatibility with existing databases that
// already contain the table.  Do NOT add new functionality against this table.
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

  // Backfill NULL schedule_day to 0 (Day 0) so that enrollment can always
  // create study_event + event_crf + patient_event_form records.
  // Without this, createSubjectDirect skips phases with NULL schedule_day,
  // leaving patients with zero forms.
  const backfilled = await pool.query(`
    UPDATE study_event_definition
    SET schedule_day = 0
    WHERE schedule_day IS NULL AND type != 'unscheduled'
  `);
  if (backfilled.rowCount > 0) {
    logger.info(`Backfilled schedule_day=0 on ${backfilled.rowCount} event definitions`);
  }

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
    // Literal compare value for consistency rules and value_match triggers
    { name: 'compare_value', type: 'TEXT' },
    // Cell-level targeting for table/question_table column-specific rules
    { name: 'table_cell_target', type: 'JSONB' },
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

  let widened = 0;
  let skippedViewLocked = 0;

  for (const { table, column } of columns) {
    try {
      const check = await pool.query(`
        SELECT data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [table, column]);
      if (check.rows.length === 0) continue;
      if (!check.rows[0].characterMaximumLength) continue;

      // ISSUE-414: skip silently when a view/rule depends on the column.
      // The ALTER would otherwise fail with "cannot alter type of a
      // column used by a view or rule", logging an ERROR every boot.
      if (await columnHasDependentViewOrRule(pool, table, column)) {
        skippedViewLocked++;
        continue;
      }

      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT`);
      logger.info(`Widened ${table}.${column} from varchar(${check.rows[0].characterMaximumLength}) to TEXT`);
      widened++;
    } catch (e: any) {
      // Column may not exist or already be TEXT
    }
  }

  logger.info('Description column widening verified', {
    widened,
    skippedViewLocked,
  });
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
      const data = row.formData;
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
          [JSON.stringify(cleaned), row.patientEventFormId]
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
            [parsed, row.itemDataId]
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
  let skippedViewLocked = 0;

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
      if (row.dataType === 'text' && isText) continue;
      if (row.characterMaximumLength && targetLen && row.characterMaximumLength >= targetLen) continue;

      // ISSUE-414: skip silently when a view/rule depends on the column.
      // The ALTER would otherwise fail with "cannot alter type of a
      // column used by a view or rule", logging an ERROR every boot.
      if (await columnHasDependentViewOrRule(pool, table, column)) {
        skippedViewLocked++;
        continue;
      }

      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${type}`);
      changed++;
    } catch (err: any) {
      logger.warn(`Could not widen ${table}.${column} to ${type}: ${err.message}`);
    }
  }
  logger.info(`Study columns widened: ${changed} column(s) updated`, {
    skippedViewLocked,
  });
}

async function createQuerySeverityColumn(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'minor'`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS due_date DATE`);
  logger.info('severity and due_date columns verified on discrepancy_note');
}

async function createQueryGenerationTypeColumn(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS generation_type VARCHAR(20) DEFAULT 'manual'`);
  // Backfill: mark existing Failed Validation Check queries (type_id=1) as automatic
  await pool.query(`
    UPDATE discrepancy_note SET generation_type = 'automatic'
    WHERE discrepancy_note_type_id = 1 AND (generation_type IS NULL OR generation_type = 'manual')
  `);
  logger.info('generation_type column verified on discrepancy_note');
}

async function createQueryPendingCorrectionColumns(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS pending_correction_value TEXT`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS pending_correction_reason TEXT`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS pending_correction_user_id INTEGER`);
  logger.info('pending_correction columns verified on discrepancy_note');
}

// ============================================================================
// Unlock Request Workflow (acc_unlock_request)
// ============================================================================
async function createUnlockRequestTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_unlock_request (
      unlock_request_id   SERIAL PRIMARY KEY,
      event_crf_id        INTEGER NOT NULL REFERENCES event_crf(event_crf_id) ON DELETE CASCADE,
      study_subject_id    INTEGER REFERENCES study_subject(study_subject_id) ON DELETE SET NULL,
      study_id            INTEGER REFERENCES study(study_id) ON DELETE SET NULL,
      requested_by_id     INTEGER NOT NULL REFERENCES user_account(user_id),
      requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason              TEXT NOT NULL,
      priority            VARCHAR(20) NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      reviewed_by_id      INTEGER REFERENCES user_account(user_id),
      reviewed_at         TIMESTAMPTZ,
      review_notes        TEXT
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unlock_request_event_crf ON acc_unlock_request(event_crf_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unlock_request_status ON acc_unlock_request(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unlock_request_study ON acc_unlock_request(study_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_unlock_request_requested_by ON acc_unlock_request(requested_by_id)`);

  logger.info('Unlock request table verified');
}

// ============================================================================
// eConsent — Extended columns for Part 11 metadata, scanned consent, signatures
// ============================================================================
async function addEconsentExtendedColumns(pool: any): Promise<void> {
  const columns = [
    { col: 'scanned_consent_file_ids', type: 'JSONB' },
    { col: 'is_scanned_consent', type: 'BOOLEAN DEFAULT false' },
    { col: 'subject_signature_id', type: 'INTEGER' },
    { col: 'witness_signature_id', type: 'INTEGER' },
    { col: 'lar_signature_id', type: 'INTEGER' },
    { col: 'investigator_signature_id', type: 'INTEGER' },
    { col: 'content_hash', type: 'VARCHAR(128)' },
    { col: 'device_info', type: 'JSONB' },
    { col: 'page_view_records', type: 'JSONB' },
    { col: 'consent_form_data', type: 'JSONB' },
    { col: 'template_id', type: 'VARCHAR(255)' },
  ];

  for (const { col, type } of columns) {
    await pool.query(
      `ALTER TABLE acc_subject_consent ADD COLUMN IF NOT EXISTS ${col} ${type}`
    ).catch(() => {});
  }

  logger.info('eConsent extended columns verified');
}

// ============================================================================
// patient_event_form — denormalized query counts for fast patient list loading
// ============================================================================
async function addPatientEventFormQueryCounts(pool: any): Promise<void> {
  const columns = [
    { col: 'open_query_count', type: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'overdue_query_count', type: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'closed_query_count', type: 'INTEGER NOT NULL DEFAULT 0' },
  ];

  for (const { col, type } of columns) {
    await pool.query(
      `ALTER TABLE patient_event_form ADD COLUMN IF NOT EXISTS ${col} ${type}`
    ).catch(() => {});
  }

  // Backfill from discrepancy_note via dn_item_data_map + dn_event_crf_map
  try {
    await pool.query(`
      UPDATE patient_event_form pef
      SET
        open_query_count = COALESCE(sub.open_count, 0),
        overdue_query_count = COALESCE(sub.overdue_count, 0),
        closed_query_count = COALESCE(sub.closed_count, 0)
      FROM (
        SELECT
          ec_id AS event_crf_id,
          COUNT(*) FILTER (WHERE resolution_status_id NOT IN (4, 5)) AS open_count,
          COUNT(*) FILTER (WHERE resolution_status_id NOT IN (4, 5) AND due_date IS NOT NULL AND due_date < NOW()) AS overdue_count,
          COUNT(*) FILTER (WHERE resolution_status_id IN (4, 5)) AS closed_count
        FROM (
          SELECT DISTINCT dn.discrepancy_note_id, dn.resolution_status_id, dn.due_date, id.event_crf_id AS ec_id
          FROM discrepancy_note dn
          INNER JOIN dn_item_data_map didm ON dn.discrepancy_note_id = didm.discrepancy_note_id
          INNER JOIN item_data id ON didm.item_data_id = id.item_data_id
          WHERE dn.parent_dn_id IS NULL
          UNION
          SELECT DISTINCT dn.discrepancy_note_id, dn.resolution_status_id, dn.due_date, decm.event_crf_id AS ec_id
          FROM discrepancy_note dn
          INNER JOIN dn_event_crf_map decm ON dn.discrepancy_note_id = decm.discrepancy_note_id
          WHERE dn.parent_dn_id IS NULL
        ) all_notes
        GROUP BY ec_id
      ) sub
      WHERE pef.event_crf_id = sub.event_crf_id
    `);
    logger.info('patient_event_form query counts backfilled');
  } catch (e: any) {
    logger.warn('patient_event_form query counts backfill skipped:', e.message);
  }

  logger.info('patient_event_form query count columns verified');
}

// ============================================================================
// Fix NULL phi_status and required columns
//
// The original LibreClinica schema defines item.phi_status as BOOLEAN (no
// DEFAULT) and item_form_metadata.required as BOOLEAN (no DEFAULT). Items
// created through legacy or edge-case code paths can have NULL in these
// columns. When the || OR-chaining in getFormMetadata evaluates NULL, the
// flag silently falls to false. This migration:
//   1. Backfills NULL → false for both columns
//   2. Adds DEFAULT false so future inserts never produce NULL
// ============================================================================
async function fixNullPhiRequiredColumns(pool: any): Promise<void> {
  try {
    const phiResult = await pool.query(
      `UPDATE item SET phi_status = false WHERE phi_status IS NULL`
    );
    if (phiResult.rowCount > 0) {
      logger.info(`Backfilled ${phiResult.rowCount} item rows with NULL phi_status → false`);
    }
  } catch (e: any) {
    logger.warn('phi_status backfill skipped:', e.message);
  }

  try {
    const reqResult = await pool.query(
      `UPDATE item_form_metadata SET required = false WHERE required IS NULL`
    );
    if (reqResult.rowCount > 0) {
      logger.info(`Backfilled ${reqResult.rowCount} item_form_metadata rows with NULL required → false`);
    }
  } catch (e: any) {
    logger.warn('required backfill skipped:', e.message);
  }

  try {
    await pool.query(`ALTER TABLE item ALTER COLUMN phi_status SET DEFAULT false`);
  } catch (e: any) {
    logger.warn('Could not set DEFAULT on item.phi_status:', e.message);
  }

  try {
    await pool.query(`ALTER TABLE item_form_metadata ALTER COLUMN required SET DEFAULT false`);
  } catch (e: any) {
    logger.warn('Could not set DEFAULT on item_form_metadata.required:', e.message);
  }

  logger.info('NULL phi_status / required column fix verified');
}

/**
 * Add visit_date_reference and visit_date_custom columns to study_subject
 * to allow per-patient visit timing to be based on scheduling date,
 * enrollment date, or a user-chosen custom date.
 */
async function addVisitDateReferenceColumns(pool: any): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE study_subject
      ADD COLUMN IF NOT EXISTS visit_date_reference VARCHAR(20) DEFAULT 'scheduling_date',
      ADD COLUMN IF NOT EXISTS visit_date_custom DATE
    `);
    logger.info('visit_date_reference columns ensured on study_subject');
  } catch (e: any) {
    // Columns may already exist
    if (e.code === '42701') {
      logger.info('visit_date_reference columns already exist');
    } else {
      logger.warn('visit_date_reference migration skipped:', e.message);
    }
  }
}

/**
 * Add organization_id to acc_form_folder for multi-tenant isolation.
 * Backfills existing folders from their owner's active organization membership.
 */
async function addFormFolderOrgScoping(pool: any): Promise<void> {
  await pool.query(`
    ALTER TABLE acc_form_folder
    ADD COLUMN IF NOT EXISTS organization_id INTEGER
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_form_folder_org ON acc_form_folder(organization_id)
  `);

  // Backfill: set organization_id from the folder owner's org membership
  const backfilled = await pool.query(`
    UPDATE acc_form_folder f
    SET organization_id = sub.organization_id
    FROM (
      SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id
      FROM acc_organization_member m
      WHERE m.status = 'active'
      ORDER BY m.user_id, m.date_joined DESC
    ) sub
    WHERE f.owner_id = sub.user_id AND f.organization_id IS NULL
  `);
  if (backfilled.rowCount > 0) {
    logger.info(`Backfilled organization_id on ${backfilled.rowCount} form folders`);
  }

  logger.info('organization_id column and index verified on acc_form_folder');
}

/**
 * 21 CFR Part 11 §11.10(e) — Audit trail immutability.
 * Creates DB-level triggers that prevent DELETE on audit tables.
 * This makes tampering impossible even with direct database access.
 */
async function createAuditImmutabilityTriggers(pool: any): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION prevent_audit_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '21 CFR Part 11: Audit records cannot be deleted (table: %)', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql
  `);

  const auditTables = [
    'audit_log_event',
    'audit_user_login',
    'audit_user_api_log',
  ];

  for (const table of auditTables) {
    const triggerName = `no_delete_${table}`;
    try {
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE trigger_name = '${triggerName}' AND event_object_table = '${table}'
          ) THEN
            CREATE TRIGGER ${triggerName}
              BEFORE DELETE ON ${table}
              FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();
          END IF;
        END $$
      `);
    } catch {
      // Table may not exist yet — skip silently
    }
  }

  logger.info('Audit immutability triggers verified on audit tables');
}

/**
 * 21 CFR Part 11 §11.10(e) — Audit trail integrity.
 * Adds hash chain columns to audit_log_event for tamper detection.
 * Each record stores its own SHA-256 hash and the hash of the previous record,
 * creating a blockchain-style chain.
 */
async function addAuditHashChainColumns(pool: any): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE audit_log_event
      ADD COLUMN IF NOT EXISTS record_hash VARCHAR(128),
      ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(128)
    `);
  } catch {
    // Columns may already exist or table not ready
  }

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_event_record_hash
      ON audit_log_event(record_hash)
    `);
  } catch {
    // Index may already exist
  }

  logger.info('Hash chain columns verified on audit_log_event');
}

/**
 * 21 CFR Part 11 §11.10(c, e) — Transport-layer audit log for the
 * interop-middleware bridge.
 *
 * RATIONALE (no parallel audit chain):
 *   The libreclinicaapi `audit_log_event` table records EDC business
 *   events (subject created, form data saved, form locked, etc.). The
 *   interop bridge needs an additional, distinct record of TRANSPORT
 *   events that occur outside the EDC's purview:
 *     - Authenticating to an EHR (Epic / Oracle Health) token endpoint
 *     - Fetching FHIR demographics / vitals from the EHR
 *     - Submitting an import payload to the EDC
 *   These are not "EDC events"; they are bridge events. Conflating them
 *   into `audit_log_event` would force every column to become nullable
 *   and break the existing FK-style relationships in that table.
 *
 *   To keep ONE verifiable chain end-to-end:
 *     - `interop_audit_log` uses the SAME SHA-256 hash format as
 *       `audit_log_event` (see `recordPart11Audit` in
 *       `middleware/part11.middleware.ts`)
 *     - `edc_audit_id_refs` is an integer array of `audit_log_event.audit_id`
 *       values that this transport event triggered. A single sync's full
 *       chain is reconstructed by walking both tables once.
 *   The `prevent_audit_delete()` trigger is reused via
 *   `createAuditImmutabilityTriggers`, so no parallel tamper rules.
 */
async function createInteropAuditLogTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interop_audit_log (
      audit_id            UUID         PRIMARY KEY,
      transaction_id      UUID         NOT NULL,
      utc_timestamp       TIMESTAMPTZ  NOT NULL,
      persisted_at_utc    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      source_system       VARCHAR(64)  NOT NULL,
      site_id             VARCHAR(128) NOT NULL,
      clinician_id        VARCHAR(255) NOT NULL,
      operation_type      VARCHAR(64)  NOT NULL
        CHECK (operation_type IN (
          'TOKEN_OBTAINED',
          'DEMOGRAPHICS_FETCH',
          'VITALS_FETCH',
          'EDC_PUSH_BEGIN',
          'EDC_PUSH_COMPLETE',
          'FULL_SYNC',
          'SIGNATURE_APPLIED'
        )),
      hash_algorithm      VARCHAR(32)  NOT NULL DEFAULT 'sha-256',
      raw_payload_hash    VARCHAR(128) NOT NULL,
      record_count        INTEGER      NOT NULL CHECK (record_count >= 0),
      payload_summary     TEXT,
      record_hash         VARCHAR(128),
      previous_hash       VARCHAR(128),
      application_version VARCHAR(64),
      signer_certificate_fingerprint VARCHAR(255),
      edc_audit_id_refs   INTEGER[]    NOT NULL DEFAULT '{}'
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interop_audit_log_txn
      ON interop_audit_log (transaction_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interop_audit_log_site_time
      ON interop_audit_log (site_id, utc_timestamp)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interop_audit_log_record_hash
      ON interop_audit_log (record_hash)
  `);

  // Apply the SAME prevent-delete trigger used by `audit_log_event` so
  // tampering rules are unified (no parallel rule definitions).
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.triggers
          WHERE trigger_name = 'trg_prevent_delete_interop_audit_log'
            AND event_object_table = 'interop_audit_log'
        ) THEN
          CREATE TRIGGER trg_prevent_delete_interop_audit_log
            BEFORE DELETE ON interop_audit_log
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();
        END IF;
      END $$
    `);
  } catch (err) {
    logger.warn('Could not attach delete trigger to interop_audit_log', {
      error: (err as Error).message,
    });
  }

  // Prevent UPDATE as well — Part 11 audit records are append-only.
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION prevent_interop_audit_update()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION '21 CFR Part 11: interop_audit_log records are append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.triggers
          WHERE trigger_name = 'trg_prevent_update_interop_audit_log'
            AND event_object_table = 'interop_audit_log'
        ) THEN
          CREATE TRIGGER trg_prevent_update_interop_audit_log
            BEFORE UPDATE ON interop_audit_log
            FOR EACH ROW EXECUTE FUNCTION prevent_interop_audit_update();
        END IF;
      END $$
    `);
  } catch (err) {
    logger.warn('Could not attach update trigger to interop_audit_log', {
      error: (err as Error).message,
    });
  }

  logger.info('interop_audit_log table verified (append-only, hash-chained)');
}

// ============================================================================
// CRF Fork / Cross-Org Copy Provenance Columns
//
// When a user copies (forks) an eCRF — especially across organizations — we
// MUST be able to trace the destination row back to its source for 21 CFR
// Part 11 §11.10(e) audit-trail integrity. Free-text "Forked from CRF X" in
// revision_notes is not query-able, so we add structured columns on the crf
// table itself. These columns are NULL for hand-built CRFs and populated for
// every forked CRF.
//
// `forked_from_org_id` records the SOURCE organization at the time of the
// copy. The destination org is implicit (the new study's org), but the source
// must be persisted explicitly because the source CRF could later move/be
// archived and we'd lose the link.
// ============================================================================
async function createCrfForkProvenanceColumns(pool: any): Promise<void> {
  const cols = [
    { name: 'forked_from_crf_id',     type: 'INTEGER' },
    { name: 'forked_from_version_id', type: 'INTEGER' },
    { name: 'forked_from_study_id',   type: 'INTEGER' },
    { name: 'forked_from_org_id',     type: 'INTEGER' },
    { name: 'forked_by_user_id',      type: 'INTEGER' },
    { name: 'forked_at',              type: 'TIMESTAMP' },
  ];
  for (const col of cols) {
    try {
      await pool.query(`ALTER TABLE crf ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    } catch (e: any) {
      logger.warn('Could not add crf provenance column', { col: col.name, error: e.message });
    }
  }
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_crf_forked_from ON crf(forked_from_crf_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_crf_forked_from_org ON crf(forked_from_org_id)`);
  } catch (e: any) {
    logger.warn('Could not index crf fork columns', { error: e.message });
  }
  logger.info('CRF fork provenance columns verified');
}

async function addStudySubjectLabelUniqueIndex(pool: any): Promise<void> {
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_study_subject_study_label_active
      ON study_subject (study_id, label)
      WHERE status_id NOT IN (5, 6, 7)
    `);
    logger.info('study_subject unique index on (study_id, label) for active rows verified');
  } catch (e: any) {
    logger.warn('study_subject label unique index migration warning:', e.message);
  }
}

// ============================================================================
// Patient Event Form Query Count Trigger
//
// Keeps patient_event_form.open_query_count and closed_query_count in sync
// whenever a discrepancy_note row is inserted, updated, or deleted.
// The trigger function resolves the event_crf_id via dn_event_crf_map, then
// recalculates counts from discrepancy_note and writes them back.
// ============================================================================
async function createPefQueryCountTrigger(pool: any): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION sync_pef_query_counts()
    RETURNS TRIGGER AS $$
    DECLARE
      v_dn_id   INTEGER;
      v_ec_id   INTEGER;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        v_dn_id := OLD.discrepancy_note_id;
      ELSE
        v_dn_id := NEW.discrepancy_note_id;
      END IF;

      SELECT event_crf_id INTO v_ec_id
        FROM dn_event_crf_map
       WHERE discrepancy_note_id = v_dn_id
       LIMIT 1;

      IF v_ec_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;

      UPDATE patient_event_form
         SET open_query_count = COALESCE(sub.open_cnt, 0),
             closed_query_count = COALESCE(sub.closed_cnt, 0)
        FROM (
          SELECT
            COUNT(*) FILTER (WHERE dn.resolution_status_id = 1)       AS open_cnt,
            COUNT(*) FILTER (WHERE dn.resolution_status_id IN (4, 5)) AS closed_cnt
          FROM discrepancy_note dn
          INNER JOIN dn_event_crf_map dm ON dn.discrepancy_note_id = dm.discrepancy_note_id
          WHERE dm.event_crf_id = v_ec_id
        ) sub
       WHERE patient_event_form.event_crf_id = v_ec_id;

      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END;
    $$ LANGUAGE plpgsql
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_sync_pef_query_counts_insert ON discrepancy_note;
    CREATE TRIGGER trg_sync_pef_query_counts_insert
      AFTER INSERT ON discrepancy_note
      FOR EACH ROW EXECUTE FUNCTION sync_pef_query_counts();

    DROP TRIGGER IF EXISTS trg_sync_pef_query_counts_update ON discrepancy_note;
    CREATE TRIGGER trg_sync_pef_query_counts_update
      AFTER UPDATE ON discrepancy_note
      FOR EACH ROW EXECUTE FUNCTION sync_pef_query_counts();

    DROP TRIGGER IF EXISTS trg_sync_pef_query_counts_delete ON discrepancy_note;
    CREATE TRIGGER trg_sync_pef_query_counts_delete
      AFTER DELETE ON discrepancy_note
      FOR EACH ROW EXECUTE FUNCTION sync_pef_query_counts();
  `);

  logger.info('patient_event_form query count trigger (sync_pef_query_counts) verified');
}

// ============================================================================
// Repair patients enrolled with zero study_events
//
// Root cause: schedule_day was NULL on study_event_definition rows, which
// caused createSubjectDirect() to throw per-phase and roll back each phase
// via SAVEPOINT. The subject was committed but with zero study_events,
// zero event_crfs, and zero patient_event_form records.
//
// This migration creates study_event + event_crf rows for affected subjects.
// patient_event_form snapshots are NOT created here (they require complex
// form metadata parsing from the services layer). Use the
// POST /api/events/verify/subject/:id/repair endpoint per patient after this
// migration runs to create the full JSONB snapshots.
// ============================================================================
async function repairPatientsWithoutEvents(pool: any): Promise<void> {
  // Find subjects who are enrolled (status_id NOT IN 5,6,7) but have zero study_events
  const orphanedSubjects = await pool.query(`
    SELECT ss.study_subject_id, ss.study_id, ss.owner_id,
           COALESCE(s2.parent_study_id, ss.study_id) AS parent_study_id,
           ss.enrollment_date
    FROM study_subject ss
    LEFT JOIN study s2 ON ss.study_id = s2.study_id
    WHERE ss.status_id NOT IN (5, 6, 7)
      AND NOT EXISTS (
        SELECT 1 FROM study_event se WHERE se.study_subject_id = ss.study_subject_id
      )
  `);

  if (orphanedSubjects.rows.length === 0) {
    logger.info('No orphaned patients found — no repair needed');
    return;
  }

  logger.info(`Found ${orphanedSubjects.rows.length} patient(s) with zero study_events — repairing`);

  let totalEventsCreated = 0;
  let totalCrfsCreated = 0;

  for (const subj of orphanedSubjects.rows) {
    const parentStudyId = subj.parentStudyId || subj.studyId;
    const userId = subj.ownerId || 1;

    // Get event definitions for this study
    const eventDefs = await pool.query(`
      SELECT study_event_definition_id, name, ordinal, type, repeating,
             COALESCE(schedule_day, 0) AS schedule_day
      FROM study_event_definition
      WHERE study_id = $1 AND status_id = 1 AND type != 'unscheduled'
      ORDER BY ordinal
    `, [parentStudyId]);

    if (eventDefs.rows.length === 0) continue;

    const anchorDate = subj.enrollmentDate || new Date();

    for (const eventDef of eventDefs.rows) {
      try {
        const daysOffset = eventDef.scheduleDay;
        const eventDueDate = new Date(new Date(anchorDate).getTime());
        eventDueDate.setDate(eventDueDate.getDate() + daysOffset);

        // Resolve subject_event_status_id
        const sesResult = await pool.query(
          `SELECT subject_event_status_id FROM subject_event_status WHERE name = 'scheduled' LIMIT 1`
        );
        const sesId = sesResult.rows[0]?.subjectEventStatusId ?? 1;

        // Create study_event
        let eventResult;
        try {
          eventResult = await pool.query(`
            INSERT INTO study_event (
              study_event_definition_id, study_subject_id, location,
              sample_ordinal, date_start, date_end,
              owner_id, status_id, subject_event_status_id, date_created,
              scheduled_date, is_unscheduled
            ) VALUES ($1, $2, '', 1, $3::timestamp, $3::timestamp, $4, 1, $5, NOW(), $6::date, false)
            RETURNING study_event_id
          `, [
            eventDef.studyEventDefinitionId,
            subj.studySubjectId,
            new Date(anchorDate).toISOString(),
            userId,
            sesId,
            eventDueDate.toISOString().split('T')[0]
          ]);
        } catch {
          eventResult = await pool.query(`
            INSERT INTO study_event (
              study_event_definition_id, study_subject_id, location,
              sample_ordinal, date_start, date_end,
              owner_id, status_id, subject_event_status_id, date_created
            ) VALUES ($1, $2, '', 1, $3::timestamp, $3::timestamp, $4, 1, $5, NOW())
            RETURNING study_event_id
          `, [
            eventDef.studyEventDefinitionId,
            subj.studySubjectId,
            new Date(anchorDate).toISOString(),
            userId,
            sesId
          ]);
        }

        const studyEventId = eventResult.rows[0]?.studyEventId;
        if (!studyEventId) continue;
        totalEventsCreated++;

        // Get CRF assignments for this event definition
        const crfAssignments = await pool.query(`
          SELECT edc.crf_id, edc.default_version_id, c.name as crf_name
          FROM event_definition_crf edc
          INNER JOIN crf c ON edc.crf_id = c.crf_id
          WHERE edc.study_event_definition_id = $1
            AND edc.status_id = 1
            AND c.status_id NOT IN (5, 7)
          ORDER BY edc.ordinal
        `, [eventDef.studyEventDefinitionId]);

        for (const crfAssign of crfAssignments.rows) {
          let crfVersionId = crfAssign.defaultVersionId;
          if (!crfVersionId) {
            const vr = await pool.query(
              `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 AND status_id NOT IN (5, 7) ORDER BY crf_version_id DESC LIMIT 1`,
              [crfAssign.crfId]
            );
            if (vr.rows.length > 0) crfVersionId = vr.rows[0].crfVersionId;
            else continue;
          }

          try {
            await pool.query(`
              INSERT INTO event_crf (
                study_event_id, crf_version_id, study_subject_id,
                completion_status_id, status_id, owner_id, date_created
              ) VALUES ($1, $2, $3, 1, 1, $4, NOW())
            `, [studyEventId, crfVersionId, subj.studySubjectId, userId]);
            totalCrfsCreated++;
          } catch (crfErr: any) {
            logger.warn(`Repair: failed to create event_crf for subject ${subj.studySubjectId}`, {
              error: crfErr.message
            });
          }
        }
      } catch (err: any) {
        logger.warn(`Repair: failed to schedule event for subject ${subj.studySubjectId}`, {
          eventDef: eventDef.name,
          error: err.message
        });
      }
    }
  }

  logger.info(`Patient repair complete: ${totalEventsCreated} study_events and ${totalCrfsCreated} event_crfs created for ${orphanedSubjects.rows.length} patient(s)`);
}

// ============================================================================
// Query Cell Target JSONB Columns
//
// Adds structured cell_target JSONB columns to dn_item_data_map and
// dn_event_crf_map for table/question_table cell-level queries.
// Without these columns, GET /api/queries/form/:id will 500.
// ============================================================================
async function addQueryCellTargetColumns(pool: any): Promise<void> {
  await pool.query(`ALTER TABLE dn_item_data_map ADD COLUMN IF NOT EXISTS cell_target JSONB`);
  await pool.query(`ALTER TABLE dn_item_data_map ADD COLUMN IF NOT EXISTS column_name VARCHAR(500)`);
  await pool.query(`ALTER TABLE dn_event_crf_map ADD COLUMN IF NOT EXISTS cell_target JSONB`);
  await pool.query(`ALTER TABLE dn_event_crf_map ADD COLUMN IF NOT EXISTS column_name VARCHAR(500)`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER`);
  await pool.query(`ALTER TABLE discrepancy_note ADD COLUMN IF NOT EXISTS study_id INTEGER`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dn_study_subject_map (
      dn_study_subject_map_id SERIAL PRIMARY KEY,
      discrepancy_note_id INTEGER NOT NULL,
      study_subject_id INTEGER NOT NULL,
      column_name VARCHAR(500)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dn_ssm_dn ON dn_study_subject_map(discrepancy_note_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dn_ssm_ss ON dn_study_subject_map(study_subject_id)`);
  logger.info('cell_target, column_name, entity_type, assigned_user_id, study_id columns and dn_study_subject_map verified');
}

async function createPasswordHistoryTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acc_password_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user_account(user_id),
      password_hash VARCHAR(255) NOT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pwd_history_user ON acc_password_history(user_id, changed_at DESC)`);
  logger.info('acc_password_history table verified');
}
