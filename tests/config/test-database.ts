/**
 * Test Database Configuration
 * 
 * This module provides a dedicated test database connection that is separate
 * from the production LibreClinica database.
 * 
 * For integration tests, we use the api-test-db container (port 5433)
 * For unit tests, we use mocks
 */

import { Pool, PoolConfig } from 'pg';

// Test database configuration - uses api-test-db container
export const TEST_DB_CONFIG: PoolConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5433'), // api-test-db port, NOT libreclinica-postgres
  database: process.env.TEST_DB_NAME || 'libreclinica_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

// Production/LibreClinica database (READ ONLY for verification)
export const LIBRECLINICA_DB_CONFIG: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5434'), // libreclinica-postgres port
  database: process.env.DB_NAME || 'libreclinica',
  user: process.env.DB_USER || 'libreclinica',
  password: process.env.DB_PASSWORD || 'libreclinica',
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

let testPool: Pool | null = null;
let lcPool: Pool | null = null;

/**
 * Get the test database pool
 */
export function getTestPool(): Pool {
  if (!testPool) {
    testPool = new Pool(TEST_DB_CONFIG);
  }
  return testPool;
}

/**
 * Get the LibreClinica database pool (for schema verification only)
 */
export function getLibreClinicaPool(): Pool {
  if (!lcPool) {
    lcPool = new Pool(LIBRECLINICA_DB_CONFIG);
  }
  return lcPool;
}

/**
 * Close all database connections
 */
export async function closeAllPools(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
  if (lcPool) {
    await lcPool.end();
    lcPool = null;
  }
}

/**
 * Initialize test database with required tables
 * Copies schema from LibreClinica but uses separate data
 */
export async function initializeTestDatabase(): Promise<void> {
  const pool = getTestPool();
  
  try {
    // Check if we can connect
    await pool.query('SELECT 1');
    console.log('✅ Test database connected successfully');
  } catch (error) {
    console.error('❌ Test database connection failed:', error);
    throw error;
  }
}

/**
 * Clean up test data after tests
 */
export async function cleanupTestData(): Promise<void> {
  const pool = getTestPool();
  
  try {
    await pool.query('BEGIN');
    
    // Delete test data in reverse dependency order
    const tables = [
      'acc_temperature_log',
      'acc_kit_dispensing',
      'acc_kit',
      'acc_shipment',
      'acc_kit_type',
      'acc_inventory_alert',
      'acc_pro_reminder',
      'acc_pro_response',
      'acc_pro_assignment',
      'acc_pro_instrument',
      'acc_patient_account',
      'acc_reconsent_request',
      'acc_subject_consent',
      'acc_consent_version',
      'acc_consent_document',
      'acc_dde_discrepancy',
      'acc_dde_entry',
      'acc_dde_status',
      'acc_transfer_log',
      'acc_email_queue',
      'acc_notification_preference'
    ];
    
    for (const table of tables) {
      try {
        await pool.query(`DELETE FROM ${table} WHERE date_created > NOW() - INTERVAL '1 hour'`);
      } catch (e) {
        // Table might not exist in test DB, that's ok
      }
    }
    
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Cleanup error:', error);
  }
}

/**
 * Schema definition for acc_* tables
 * This is the canonical schema that the services should use
 */
export const ACC_TABLE_SCHEMA = {
  // Email Notifications
  acc_email_template: [
    'template_id', 'name', 'subject', 'html_body', 'text_body', 
    'description', 'variables', 'version', 'status_id', 'owner_id',
    'date_created', 'date_updated'
  ],
  acc_email_queue: [
    'queue_id', 'template_id', 'recipient_email', 'recipient_user_id',
    'subject', 'html_body', 'text_body', 'variables', 'priority', 'status',
    'attempts', 'last_attempt', 'sent_at', 'error_message', 'study_id',
    'entity_type', 'entity_id', 'date_created', 'scheduled_for'
  ],
  acc_notification_preference: [
    'preference_id', 'user_id', 'study_id', 'notification_type',
    'email_enabled', 'digest_enabled', 'in_app_enabled', 'date_created', 'date_updated'
  ],
  
  // Subject Transfer
  acc_transfer_log: [
    'transfer_id', 'study_subject_id', 'study_id', 'source_site_id', 'destination_site_id',
    'reason_for_transfer', 'transfer_status', 'requires_approvals', 'initiated_by', 'initiated_at',
    'source_approved_by', 'source_approved_at', 'source_signature_id',
    'destination_approved_by', 'destination_approved_at', 'destination_signature_id',
    'completed_by', 'completed_at', 'cancelled_by', 'cancelled_at', 'cancel_reason',
    'notes', 'date_created', 'date_updated'
  ],
  
  // Double Data Entry
  acc_dde_status: [
    'status_id', 'event_crf_id', 'crf_version_id', 'first_entry_status', 'first_entry_by', 'first_entry_at',
    'second_entry_status', 'second_entry_by', 'second_entry_at', 'comparison_status',
    'total_items', 'matched_items', 'discrepancy_count', 'resolved_count', 'dde_complete',
    'date_created', 'date_updated'
  ],
  acc_dde_entry: [
    'dde_entry_id', 'event_crf_id', 'item_id', 'item_data_id', 'second_entry_value',
    'entered_by', 'entered_at', 'matches_first'
  ],
  acc_dde_discrepancy: [
    'discrepancy_id', 'event_crf_id', 'item_id', 'dde_entry_id', 'first_value', 'second_value',
    'resolution_status', 'resolved_value', 'resolved_by', 'resolved_at',
    'adjudicated_by', 'adjudication_notes', 'date_created', 'date_updated'
  ],
  
  // eConsent
  acc_consent_document: [
    'document_id', 'study_id', 'name', 'description', 'document_type', 'language_code',
    'status', 'requires_witness', 'requires_lar', 'age_of_majority', 'min_reading_time',
    'owner_id', 'date_created', 'date_updated'
  ],
  acc_consent_version: [
    'version_id', 'document_id', 'version_number', 'version_name', 'content', 'pdf_template',
    'effective_date', 'expiration_date', 'irb_approval_date', 'irb_approval_number',
    'change_summary', 'status', 'approved_by', 'approved_at', 'created_by',
    'date_created', 'date_updated'
  ],
  acc_subject_consent: [
    'consent_id', 'study_subject_id', 'version_id', 'consent_type', 'consent_status',
    'subject_name', 'subject_signature_data', 'subject_signed_at', 'subject_ip_address', 'subject_user_agent',
    'witness_name', 'witness_relationship', 'witness_signature_data', 'witness_signed_at',
    'lar_name', 'lar_relationship', 'lar_signature_data', 'lar_signed_at', 'lar_reason',
    'presented_at', 'time_spent_reading', 'pages_viewed', 'acknowledgments_checked', // Note: acknowledgments not acknowledgements
    'questions_asked', 'copy_emailed_to', 'copy_emailed_at', 'pdf_file_path',
    'withdrawn_at', 'withdrawal_reason', 'withdrawn_by', 'consented_by', 'date_created', 'date_updated'
  ],
  acc_reconsent_request: [
    'request_id', 'version_id', 'study_subject_id', 'previous_consent_id', 'reason',
    'requested_at', 'requested_by', 'due_date', 'completed_consent_id', 'status',
    'waived_by', 'waived_reason', 'date_updated'
  ],
  
  // ePRO
  acc_pro_instrument: [
    'instrument_id', 'name', 'short_name', 'description', 'version', 'category',
    'scoring_algorithm', 'content', 'reference_url', 'license_type', 'language_code',
    'estimated_minutes', 'status_id', 'date_created'
    // Note: NO study_id column - instruments are global
  ],
  acc_pro_assignment: [
    'assignment_id', 'study_subject_id', 'study_event_id', 'instrument_id', 'crf_version_id',
    'assignment_type', 'scheduled_date', 'scheduled_time', 'window_before_days', 'window_after_days',
    'recurrence_pattern', 'recurrence_end_date', 'recurrence_days', 'status',
    'available_from', 'expires_at', 'started_at', 'completed_at', 'response_id',
    'assigned_by', 'assigned_at', 'notes', 'date_created', 'date_updated'
  ],
  acc_pro_response: [
    'response_id', 'assignment_id', 'study_subject_id', 'instrument_id', 'answers', // Note: answers not responses
    'raw_score', 'scaled_score', 'score_interpretation', 'started_at', 'completed_at',
    'time_spent_seconds', 'device_type', 'user_agent', 'ip_address', 'timezone', 'local_timestamp',
    'reviewed_by', 'reviewed_at', 'review_notes', 'flagged', 'flag_reason', 'date_created'
  ],
  acc_patient_account: [
    'patient_account_id', 'study_subject_id', 'email', 'phone', 'pin_hash',
    'magic_link_token', 'magic_link_expires', 'preferred_language', 'timezone',
    'notification_preferences', 'last_login', 'login_attempts', 'locked_until',
    'status', 'date_created', 'date_updated'
  ],
  
  // RTSM
  acc_kit_type: [
    'kit_type_id', 'study_id', 'name', 'description', 'product_code', 'treatment_arm',
    'storage_conditions', 'min_storage_temp', 'max_storage_temp', // Note: min_storage_temp not min_temperature
    'shelf_life_days', 'units_per_kit', 'kit_image_path', 'is_placebo', 'is_blinded',
    'reorder_threshold', 'status', 'date_created', 'date_updated'
  ],
  acc_kit: [
    'kit_id', 'kit_type_id', 'kit_number', 'batch_number', 'lot_number',
    'manufacture_date', 'expiration_date', 'received_date', 'status',
    'current_site_id', 'current_shipment_id', 'dispensed_to_subject_id',
    'dispensed_at', 'dispensed_by', 'dispensing_visit',
    'returned_at', 'returned_by', 'return_reason', 'return_condition',
    'destroyed_at', 'destroyed_by', 'destruction_reason', 'destruction_witness',
    'created_by', 'date_created', 'date_updated'
    // Note: NO study_id column - kit gets study from kit_type
  ],
  acc_shipment: [
    'shipment_id', 'study_id', 'shipment_number', 'shipment_type',
    'source_type', 'source_id', 'source_name',
    'destination_type', 'destination_id', 'destination_name',
    'carrier', 'tracking_number', 'shipping_conditions', 'package_count', 'status',
    'requested_at', 'requested_by', 'shipped_at', 'shipped_by', 'expected_delivery',
    'delivered_at', 'received_by', 'shipping_notes', 'receipt_notes',
    'has_temperature_excursion', 'date_created', 'date_updated'
  ],
  acc_kit_dispensing: [
    'dispensing_id', 'kit_id', 'study_subject_id', 'study_event_id',
    'dispensed_at', 'dispensed_by', 'kit_number_verified', 'subject_id_verified',
    'expiration_verified', 'dosing_instructions', 'quantity_dispensed',
    'signature_id', 'notes', 'date_created'
  ],
  acc_temperature_log: [
    'log_id', 'entity_type', 'entity_id', 'recorded_at', 'temperature', 'humidity',
    'is_excursion', 'excursion_duration_minutes', 'recorded_by', 'device_id',
    'notes', 'date_created'
    // Note: NO study_id column
  ]
};

