/**
 * Database Integration Tests - Direct PostgreSQL Verification
 * 
 * These tests verify that data correctly flows from the application layer
 * to the PostgreSQL database and can be retrieved with integrity.
 * 
 * Tests:
 * 1. CRUD operations for all 7 new feature tables
 * 2. Foreign key relationships
 * 3. Transaction integrity
 * 4. Data type validation
 * 5. Constraint enforcement
 */

import { Pool, PoolClient } from 'pg';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5434'),
  database: process.env.DB_NAME || 'libreclinica',
  user: process.env.DB_USER || 'libreclinica',
  password: process.env.DB_PASSWORD || 'libreclinica',
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

// Track created records for cleanup
const cleanupIds: { [table: string]: number[] } = {};

function trackRecord(table: string, id: number) {
  if (!cleanupIds[table]) {
    cleanupIds[table] = [];
  }
  cleanupIds[table].push(id);
}

describe('Database Integration Tests', () => {
  let client: PoolClient;

  beforeAll(async () => {
    try {
      client = await pool.connect();
      // Verify connection
      const result = await client.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Cleanup all created test records
    try {
      await client.query('BEGIN');

      // Delete in reverse dependency order
      const tablesToCleanup = [
        'acc_temperature_log',
        'acc_kit_shipment_item',
        'acc_kit_shipment',
        'acc_kit',
        'acc_kit_type',
        'acc_pro_response',
        'acc_pro_assignment',
        'acc_pro_instrument',
        'acc_patient_account',
        'acc_subject_consent',
        'acc_reconsent_request',
        'acc_consent_version',
        'acc_consent_document',
        'acc_dde_discrepancy',
        'acc_dde_entry',
        'acc_dde_status',
        'acc_transfer_log',
        'acc_email_queue',
        'acc_notification_preference'
      ];

      for (const table of tablesToCleanup) {
        const ids = cleanupIds[table];
        if (ids && ids.length > 0) {
          try {
            const pkColumn = getPrimaryKeyColumn(table);
            await client.query(
              `DELETE FROM ${table} WHERE ${pkColumn} = ANY($1)`,
              [ids]
            );
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    }

    client.release();
    await pool.end();
  });

  function getPrimaryKeyColumn(table: string): string {
    const pkMap: { [key: string]: string } = {
      'acc_email_template': 'template_id',
      'acc_email_queue': 'queue_id',
      'acc_notification_preference': 'preference_id',
      'acc_transfer_log': 'transfer_id',
      'acc_dde_status': 'status_id',
      'acc_dde_entry': 'entry_id',
      'acc_dde_discrepancy': 'discrepancy_id',
      'acc_consent_document': 'document_id',
      'acc_consent_version': 'version_id',
      'acc_subject_consent': 'consent_id',
      'acc_reconsent_request': 'request_id',
      'acc_pro_instrument': 'instrument_id',
      'acc_pro_assignment': 'assignment_id',
      'acc_pro_response': 'response_id',
      'acc_patient_account': 'patient_account_id',
      'acc_kit_type': 'kit_type_id',
      'acc_kit': 'kit_id',
      'acc_kit_shipment': 'shipment_id',
      'acc_kit_shipment_item': 'item_id',
      'acc_temperature_log': 'log_id'
    };
    return pkMap[table] || 'id';
  }

  // ============================================================================
  // TABLE EXISTENCE VERIFICATION
  // ============================================================================
  describe('Table Structure Verification', () => {
    const requiredTables = [
      'acc_email_template',
      'acc_email_queue',
      'acc_notification_preference',
      'acc_transfer_log',
      'acc_dde_status',
      'acc_dde_entry',
      'acc_dde_discrepancy',
      'acc_consent_document',
      'acc_consent_version',
      'acc_subject_consent',
      'acc_reconsent_request',
      'acc_pro_instrument',
      'acc_pro_assignment',
      'acc_pro_response',
      'acc_patient_account',
      'acc_kit_type',
      'acc_kit',
      'acc_kit_shipment',
      'acc_kit_shipment_item',
      'acc_temperature_log'
    ];

    test.each(requiredTables)('table %s should exist', async (tableName) => {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists
      `, [tableName]);
      
      expect(result.rows[0].exists).toBe(true);
    });
  });

  // ============================================================================
  // EMAIL NOTIFICATIONS - CRUD Tests
  // ============================================================================
  describe('Email Notifications - Database CRUD', () => {
    
    describe('acc_email_template', () => {
      it('should have default templates inserted from migrations', async () => {
        const result = await client.query(
          `SELECT COUNT(*) as count FROM acc_email_template`
        );
        
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      });

      it('should retrieve template by name', async () => {
        const result = await client.query(`
          SELECT * FROM acc_email_template WHERE name = 'query_created'
        `);
        
        if (result.rows.length > 0) {
          expect(result.rows[0].name).toBe('query_created');
          expect(result.rows[0].subject).toBeDefined();
          expect(result.rows[0].html_body).toBeDefined();
        }
      });
    });

    describe('acc_email_queue', () => {
      it('should insert email to queue and retrieve it', async () => {
        // Get a template ID
        const templateResult = await client.query(
          `SELECT template_id FROM acc_email_template LIMIT 1`
        );
        
        if (templateResult.rows.length === 0) {
          console.log('Skipping: No templates available');
          return;
        }

        const templateId = templateResult.rows[0].template_id;
        const testEmail = `db-test-${Date.now()}@test.example.com`;

        // INSERT
        const insertResult = await client.query(`
          INSERT INTO acc_email_queue (
            template_id, recipient_email, recipient_user_id,
            study_id, rendered_subject, rendered_html, rendered_text,
            variables, status, priority, date_created, scheduled_for
          ) VALUES ($1, $2, 1, 1, 'Test Subject', '<p>Test</p>', 'Test', 
            '{"test": true}', 'pending', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING queue_id
        `, [templateId, testEmail]);

        const queueId = insertResult.rows[0].queue_id;
        trackRecord('acc_email_queue', queueId);

        // RETRIEVE
        const selectResult = await client.query(
          `SELECT * FROM acc_email_queue WHERE queue_id = $1`,
          [queueId]
        );

        expect(selectResult.rows.length).toBe(1);
        expect(selectResult.rows[0].recipient_email).toBe(testEmail);
        expect(selectResult.rows[0].status).toBe('pending');

        // UPDATE
        await client.query(`
          UPDATE acc_email_queue SET status = 'sent', date_sent = CURRENT_TIMESTAMP
          WHERE queue_id = $1
        `, [queueId]);

        const updatedResult = await client.query(
          `SELECT status, date_sent FROM acc_email_queue WHERE queue_id = $1`,
          [queueId]
        );

        expect(updatedResult.rows[0].status).toBe('sent');
        expect(updatedResult.rows[0].date_sent).not.toBeNull();
      });
    });

    describe('acc_notification_preference', () => {
      it('should insert and update notification preference', async () => {
        // Get a user ID
        const userResult = await client.query(
          `SELECT user_id FROM user_account LIMIT 1`
        );
        
        if (userResult.rows.length === 0) {
          console.log('Skipping: No users available');
          return;
        }

        const userId = userResult.rows[0].user_id;

        // INSERT with ON CONFLICT
        const insertResult = await client.query(`
          INSERT INTO acc_notification_preference (
            user_id, notification_type, email_enabled, digest_enabled, in_app_enabled,
            date_created, date_updated
          ) VALUES ($1, 'db_test_notification', true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, notification_type) WHERE study_id IS NULL 
          DO UPDATE SET email_enabled = EXCLUDED.email_enabled, date_updated = CURRENT_TIMESTAMP
          RETURNING preference_id
        `, [userId]);

        const prefId = insertResult.rows[0].preference_id;
        trackRecord('acc_notification_preference', prefId);

        // RETRIEVE
        const selectResult = await client.query(
          `SELECT * FROM acc_notification_preference WHERE preference_id = $1`,
          [prefId]
        );

        expect(selectResult.rows[0].email_enabled).toBe(true);
        expect(selectResult.rows[0].digest_enabled).toBe(false);
      });
    });
  });

  // ============================================================================
  // SUBJECT TRANSFER - CRUD Tests
  // ============================================================================
  describe('Subject Transfer - Database CRUD', () => {
    
    describe('acc_transfer_log', () => {
      it('should create and retrieve transfer record', async () => {
        // Get test subject and sites
        const subjectResult = await client.query(`
          SELECT ss.study_subject_id, s.study_id, s.parent_study_id
          FROM study_subject ss
          JOIN study s ON ss.study_id = s.study_id
          LIMIT 1
        `);

        if (subjectResult.rows.length === 0) {
          console.log('Skipping: No subjects available');
          return;
        }

        const { study_subject_id, study_id } = subjectResult.rows[0];

        // INSERT
        const insertResult = await client.query(`
          INSERT INTO acc_transfer_log (
            study_subject_id, study_id, source_site_id, destination_site_id,
            reason_for_transfer, transfer_status, requires_approvals,
            initiated_by, initiated_at, date_created, date_updated
          ) VALUES ($1, $2, $2, $2, 'DB Integration Test', 'pending', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING transfer_id
        `, [study_subject_id, study_id]);

        const transferId = insertResult.rows[0].transfer_id;
        trackRecord('acc_transfer_log', transferId);

        // RETRIEVE
        const selectResult = await client.query(
          `SELECT * FROM acc_transfer_log WHERE transfer_id = $1`,
          [transferId]
        );

        expect(selectResult.rows[0].study_subject_id).toBe(study_subject_id);
        expect(selectResult.rows[0].transfer_status).toBe('pending');
        expect(selectResult.rows[0].reason_for_transfer).toBe('DB Integration Test');

        // UPDATE - Approve
        await client.query(`
          UPDATE acc_transfer_log 
          SET transfer_status = 'approved', source_approved_by = 1, source_approved_at = CURRENT_TIMESTAMP
          WHERE transfer_id = $1
        `, [transferId]);

        const approvedResult = await client.query(
          `SELECT transfer_status, source_approved_at FROM acc_transfer_log WHERE transfer_id = $1`,
          [transferId]
        );

        expect(approvedResult.rows[0].transfer_status).toBe('approved');
      });
    });
  });

  // ============================================================================
  // DOUBLE DATA ENTRY - CRUD Tests
  // ============================================================================
  describe('Double Data Entry - Database CRUD', () => {
    
    let testStatusId: number;

    describe('acc_dde_status', () => {
      it('should create DDE status record', async () => {
        const insertResult = await client.query(`
          INSERT INTO acc_dde_status (
            event_crf_id, first_entry_status, second_entry_status,
            comparison_status, total_items, matched_items, discrepancy_count,
            resolved_count, dde_complete, date_created, date_updated
          ) VALUES (9999, 'pending', 'pending', 'pending', 10, 0, 0, 0, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING status_id
        `);

        testStatusId = insertResult.rows[0].status_id;
        trackRecord('acc_dde_status', testStatusId);

        // RETRIEVE
        const selectResult = await client.query(
          `SELECT * FROM acc_dde_status WHERE status_id = $1`,
          [testStatusId]
        );

        expect(selectResult.rows[0].first_entry_status).toBe('pending');
        expect(selectResult.rows[0].dde_complete).toBe(false);
      });
    });

    describe('acc_dde_entry', () => {
      it('should create DDE entry linked to status', async () => {
        if (!testStatusId) {
          console.log('Skipping: No DDE status created');
          return;
        }

        const insertResult = await client.query(`
          INSERT INTO acc_dde_entry (
            status_id, item_id, entry_number, value, entered_by, entered_at
          ) VALUES ($1, 1, 1, '75', 1, CURRENT_TIMESTAMP)
          RETURNING entry_id
        `, [testStatusId]);

        const entryId = insertResult.rows[0].entry_id;
        trackRecord('acc_dde_entry', entryId);

        // Verify foreign key relationship
        const joinResult = await client.query(`
          SELECT e.*, s.event_crf_id
          FROM acc_dde_entry e
          JOIN acc_dde_status s ON e.status_id = s.status_id
          WHERE e.entry_id = $1
        `, [entryId]);

        expect(joinResult.rows[0].status_id).toBe(testStatusId);
        expect(joinResult.rows[0].value).toBe('75');
      });
    });

    describe('acc_dde_discrepancy', () => {
      it('should create and resolve discrepancy', async () => {
        if (!testStatusId) {
          console.log('Skipping: No DDE status created');
          return;
        }

        // INSERT discrepancy
        const insertResult = await client.query(`
          INSERT INTO acc_dde_discrepancy (
            status_id, item_id, first_value, second_value,
            resolution_status, date_created, date_updated
          ) VALUES ($1, 1, '75', '76', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING discrepancy_id
        `, [testStatusId]);

        const discrepancyId = insertResult.rows[0].discrepancy_id;
        trackRecord('acc_dde_discrepancy', discrepancyId);

        // Resolve discrepancy
        await client.query(`
          UPDATE acc_dde_discrepancy 
          SET resolution_status = 'first_correct', resolved_value = '75',
              resolved_by = 1, resolved_at = CURRENT_TIMESTAMP, resolution_comment = 'First entry verified'
          WHERE discrepancy_id = $1
        `, [discrepancyId]);

        const resolvedResult = await client.query(
          `SELECT * FROM acc_dde_discrepancy WHERE discrepancy_id = $1`,
          [discrepancyId]
        );

        expect(resolvedResult.rows[0].resolution_status).toBe('first_correct');
        expect(resolvedResult.rows[0].resolved_value).toBe('75');
      });
    });
  });

  // ============================================================================
  // eCONSENT - CRUD Tests
  // ============================================================================
  describe('eConsent - Database CRUD', () => {
    
    let testDocumentId: number;
    let testVersionId: number;

    describe('acc_consent_document', () => {
      it('should create consent document', async () => {
        const insertResult = await client.query(`
          INSERT INTO acc_consent_document (
            study_id, name, description, document_type, language_code,
            status, requires_witness, requires_lar, age_of_majority,
            min_reading_time, owner_id, date_created, date_updated
          ) VALUES (1, 'DB Test Consent', 'Created by database test', 'main', 'en',
            'draft', false, false, 18, 60, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING document_id
        `);

        testDocumentId = insertResult.rows[0].document_id;
        trackRecord('acc_consent_document', testDocumentId);

        const selectResult = await client.query(
          `SELECT * FROM acc_consent_document WHERE document_id = $1`,
          [testDocumentId]
        );

        expect(selectResult.rows[0].name).toBe('DB Test Consent');
        expect(selectResult.rows[0].status).toBe('draft');
      });
    });

    describe('acc_consent_version', () => {
      it('should create version linked to document', async () => {
        if (!testDocumentId) {
          console.log('Skipping: No document created');
          return;
        }

        const insertResult = await client.query(`
          INSERT INTO acc_consent_version (
            document_id, version_number, content, effective_date,
            status, created_by, date_created, date_updated
          ) VALUES ($1, '1.0', $2, CURRENT_DATE, 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING version_id
        `, [testDocumentId, JSON.stringify({ pages: [], acknowledgments: [] })]);

        testVersionId = insertResult.rows[0].version_id;
        trackRecord('acc_consent_version', testVersionId);

        // Verify relationship
        const joinResult = await client.query(`
          SELECT v.*, d.name as document_name
          FROM acc_consent_version v
          JOIN acc_consent_document d ON v.document_id = d.document_id
          WHERE v.version_id = $1
        `, [testVersionId]);

        expect(joinResult.rows[0].document_name).toBe('DB Test Consent');
      });
    });

    describe('acc_subject_consent', () => {
      it('should record subject consent', async () => {
        if (!testVersionId) {
          console.log('Skipping: No version created');
          return;
        }

        // Get a subject
        const subjectResult = await client.query(
          `SELECT study_subject_id FROM study_subject LIMIT 1`
        );

        if (subjectResult.rows.length === 0) {
          console.log('Skipping: No subjects available');
          return;
        }

        const subjectId = subjectResult.rows[0].study_subject_id;

        const insertResult = await client.query(`
          INSERT INTO acc_subject_consent (
            study_subject_id, version_id, consent_type, consent_status,
            subject_name, subject_signature_data, subject_signed_at,
            ip_address, user_agent, time_spent_reading, pages_viewed,
            acknowledgements_checked, created_by, date_created
          ) VALUES ($1, $2, 'subject', 'consented', 'DB Test Subject', '{"type":"drawn"}',
            CURRENT_TIMESTAMP, '127.0.0.1', 'DB Test', 180, '{}', '{}', 1, CURRENT_TIMESTAMP)
          RETURNING consent_id
        `, [subjectId, testVersionId]);

        const consentId = insertResult.rows[0].consent_id;
        trackRecord('acc_subject_consent', consentId);

        // Verify full relationship chain
        const fullResult = await client.query(`
          SELECT c.*, v.version_number, d.name as document_name
          FROM acc_subject_consent c
          JOIN acc_consent_version v ON c.version_id = v.version_id
          JOIN acc_consent_document d ON v.document_id = d.document_id
          WHERE c.consent_id = $1
        `, [consentId]);

        expect(fullResult.rows[0].consent_status).toBe('consented');
        expect(fullResult.rows[0].document_name).toBe('DB Test Consent');
      });
    });
  });

  // ============================================================================
  // ePRO - CRUD Tests
  // ============================================================================
  describe('ePRO - Database CRUD', () => {
    
    let testInstrumentId: number;
    let testAssignmentId: number;

    describe('acc_pro_instrument', () => {
      it('should create PRO instrument', async () => {
        const insertResult = await client.query(`
          INSERT INTO acc_pro_instrument (
            study_id, short_name, name, description, estimated_time_minutes,
            content, frequency, status, created_by, date_created, date_updated
          ) VALUES (1, 'DB-TEST', 'DB Test Questionnaire', 'Created by database test',
            5, $1, 'weekly', 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING instrument_id
        `, [JSON.stringify({ questions: [{ id: 1, text: 'Test question?' }] })]);

        testInstrumentId = insertResult.rows[0].instrument_id;
        trackRecord('acc_pro_instrument', testInstrumentId);

        const selectResult = await client.query(
          `SELECT * FROM acc_pro_instrument WHERE instrument_id = $1`,
          [testInstrumentId]
        );

        expect(selectResult.rows[0].short_name).toBe('DB-TEST');
        expect(selectResult.rows[0].status).toBe('active');
      });
    });

    describe('acc_pro_assignment', () => {
      it('should create assignment and submit response', async () => {
        if (!testInstrumentId) {
          console.log('Skipping: No instrument created');
          return;
        }

        // Get a subject
        const subjectResult = await client.query(
          `SELECT study_subject_id FROM study_subject LIMIT 1`
        );

        if (subjectResult.rows.length === 0) {
          console.log('Skipping: No subjects available');
          return;
        }

        const subjectId = subjectResult.rows[0].study_subject_id;

        // Create assignment
        const assignmentResult = await client.query(`
          INSERT INTO acc_pro_assignment (
            study_subject_id, instrument_id, study_id, status,
            scheduled_date, due_date, window_start, window_end,
            reminders_sent, assigned_by, date_created, date_updated
          ) VALUES ($1, $2, 1, 'pending', CURRENT_DATE, CURRENT_DATE + 7,
            CURRENT_DATE, CURRENT_DATE + 7, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING assignment_id
        `, [subjectId, testInstrumentId]);

        testAssignmentId = assignmentResult.rows[0].assignment_id;
        trackRecord('acc_pro_assignment', testAssignmentId);

        // Submit response
        const responseResult = await client.query(`
          INSERT INTO acc_pro_response (
            assignment_id, responses, raw_score, interpretation,
            started_at, completed_at, time_spent_seconds, device_info, date_created
          ) VALUES ($1, $2, 7, 'Normal', CURRENT_TIMESTAMP - INTERVAL '3 minutes',
            CURRENT_TIMESTAMP, 180, '{"platform":"DB Test"}', CURRENT_TIMESTAMP)
          RETURNING response_id
        `, [testAssignmentId, JSON.stringify({ q1: 7 })]);

        trackRecord('acc_pro_response', responseResult.rows[0].response_id);

        // Update assignment status
        await client.query(`
          UPDATE acc_pro_assignment SET status = 'completed', completed_at = CURRENT_TIMESTAMP
          WHERE assignment_id = $1
        `, [testAssignmentId]);

        // Verify complete flow
        const verifyResult = await client.query(`
          SELECT a.status, r.raw_score, i.short_name
          FROM acc_pro_assignment a
          JOIN acc_pro_response r ON a.assignment_id = r.assignment_id
          JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
          WHERE a.assignment_id = $1
        `, [testAssignmentId]);

        expect(verifyResult.rows[0].status).toBe('completed');
        expect(verifyResult.rows[0].raw_score).toBe(7);
        expect(verifyResult.rows[0].short_name).toBe('DB-TEST');
      });
    });
  });

  // ============================================================================
  // RTSM/IRT - CRUD Tests
  // ============================================================================
  describe('RTSM/IRT - Database CRUD', () => {
    
    let testKitTypeId: number;
    let testKitId: number;
    let testShipmentId: number;

    describe('acc_kit_type', () => {
      it('should create kit type', async () => {
        const insertResult = await client.query(`
          INSERT INTO acc_kit_type (
            study_id, name, description, storage_conditions,
            min_temperature, max_temperature, shelf_life_days,
            units_per_kit, is_blinded, status, created_by, date_created, date_updated
          ) VALUES (1, 'DB Test Treatment', 'Created by database test', 'Room Temperature',
            15.0, 25.0, 365, 30, true, 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING kit_type_id
        `);

        testKitTypeId = insertResult.rows[0].kit_type_id;
        trackRecord('acc_kit_type', testKitTypeId);

        const selectResult = await client.query(
          `SELECT * FROM acc_kit_type WHERE kit_type_id = $1`,
          [testKitTypeId]
        );

        expect(selectResult.rows[0].name).toBe('DB Test Treatment');
        expect(selectResult.rows[0].is_blinded).toBe(true);
      });
    });

    describe('acc_kit', () => {
      it('should register kit and track through lifecycle', async () => {
        if (!testKitTypeId) {
          console.log('Skipping: No kit type created');
          return;
        }

        // Register kit
        const insertResult = await client.query(`
          INSERT INTO acc_kit (
            kit_type_id, study_id, kit_number, batch_number, lot_number,
            expiration_date, status, registered_by, date_created, date_updated
          ) VALUES ($1, 1, 'DB-KIT-001', 'BATCH-DB', 'LOT-DB',
            CURRENT_DATE + INTERVAL '180 days', 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING kit_id
        `, [testKitTypeId]);

        testKitId = insertResult.rows[0].kit_id;
        trackRecord('acc_kit', testKitId);

        // Reserve kit
        await client.query(`
          UPDATE acc_kit SET status = 'reserved' WHERE kit_id = $1
        `, [testKitId]);

        let kitResult = await client.query(
          `SELECT status FROM acc_kit WHERE kit_id = $1`,
          [testKitId]
        );
        expect(kitResult.rows[0].status).toBe('reserved');

        // Dispense kit
        const subjectResult = await client.query(
          `SELECT study_subject_id FROM study_subject LIMIT 1`
        );
        
        if (subjectResult.rows.length > 0) {
          await client.query(`
            UPDATE acc_kit 
            SET status = 'dispensed', dispensed_to_subject_id = $1, dispensed_by = 1, dispensed_at = CURRENT_TIMESTAMP
            WHERE kit_id = $2
          `, [subjectResult.rows[0].study_subject_id, testKitId]);

          kitResult = await client.query(
            `SELECT * FROM acc_kit WHERE kit_id = $1`,
            [testKitId]
          );
          expect(kitResult.rows[0].status).toBe('dispensed');
          expect(kitResult.rows[0].dispensed_to_subject_id).toBe(subjectResult.rows[0].study_subject_id);
        }
      });
    });

    describe('acc_kit_shipment', () => {
      it('should create shipment and track delivery', async () => {
        // Create another kit for shipment
        if (!testKitTypeId) return;

        const kitResult = await client.query(`
          INSERT INTO acc_kit (
            kit_type_id, study_id, kit_number, batch_number, lot_number,
            expiration_date, status, registered_by, date_created, date_updated
          ) VALUES ($1, 1, 'DB-SHIP-KIT', 'BATCH-SHIP', 'LOT-SHIP',
            CURRENT_DATE + 90, 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING kit_id
        `, [testKitTypeId]);

        const shipKitId = kitResult.rows[0].kit_id;
        trackRecord('acc_kit', shipKitId);

        // Create shipment
        const shipmentResult = await client.query(`
          INSERT INTO acc_kit_shipment (
            study_id, destination_site_id, shipment_number, status,
            carrier, created_by, date_created, date_updated
          ) VALUES (1, 1, 'DB-SHIP-001', 'pending', 'FedEx', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING shipment_id
        `);

        testShipmentId = shipmentResult.rows[0].shipment_id;
        trackRecord('acc_kit_shipment', testShipmentId);

        // Add kit to shipment
        await client.query(`
          INSERT INTO acc_kit_shipment_item (shipment_id, kit_id, date_added)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
        `, [testShipmentId, shipKitId]);

        // Ship it
        await client.query(`
          UPDATE acc_kit_shipment 
          SET status = 'in_transit', tracking_number = 'TRACK-DB-123', shipped_at = CURRENT_TIMESTAMP
          WHERE shipment_id = $1
        `, [testShipmentId]);

        // Verify
        const verifyResult = await client.query(`
          SELECT s.*, COUNT(i.kit_id) as kit_count
          FROM acc_kit_shipment s
          LEFT JOIN acc_kit_shipment_item i ON s.shipment_id = i.shipment_id
          WHERE s.shipment_id = $1
          GROUP BY s.shipment_id
        `, [testShipmentId]);

        expect(verifyResult.rows[0].status).toBe('in_transit');
        expect(parseInt(verifyResult.rows[0].kit_count)).toBe(1);
      });
    });

    describe('acc_temperature_log', () => {
      it('should log temperature and detect excursions', async () => {
        // Normal reading
        const normalResult = await client.query(`
          INSERT INTO acc_temperature_log (
            entity_type, entity_id, study_id, temperature, humidity,
            min_threshold, max_threshold, is_excursion, recorded_by, reading_time, date_created
          ) VALUES ('site_storage', 1, 1, 5.5, 45, 2.0, 8.0, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING log_id
        `);

        trackRecord('acc_temperature_log', normalResult.rows[0].log_id);

        // Excursion reading
        const excursionResult = await client.query(`
          INSERT INTO acc_temperature_log (
            entity_type, entity_id, study_id, temperature, humidity,
            min_threshold, max_threshold, is_excursion, recorded_by, reading_time, date_created
          ) VALUES ('site_storage', 1, 1, 12.0, 50, 2.0, 8.0, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING log_id
        `);

        trackRecord('acc_temperature_log', excursionResult.rows[0].log_id);

        // Verify excursion count
        const excursionCount = await client.query(`
          SELECT COUNT(*) as count FROM acc_temperature_log
          WHERE study_id = 1 AND is_excursion = true
          AND log_id = ANY($1)
        `, [[normalResult.rows[0].log_id, excursionResult.rows[0].log_id]]);

        expect(parseInt(excursionCount.rows[0].count)).toBe(1);
      });
    });
  });

  // ============================================================================
  // TRANSACTION INTEGRITY TESTS
  // ============================================================================
  describe('Transaction Integrity', () => {
    
    it('should rollback on error within transaction', async () => {
      let insertedId: number | null = null;
      
      try {
        await client.query('BEGIN');
        
        const result = await client.query(`
          INSERT INTO acc_email_queue (
            template_id, recipient_email, status, priority, date_created, scheduled_for
          ) VALUES (1, 'transaction-test@test.com', 'pending', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING queue_id
        `);
        
        insertedId = result.rows[0].queue_id;
        
        // Force an error
        await client.query('SELECT * FROM nonexistent_table');
        
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
      }

      // Verify the insert was rolled back
      if (insertedId) {
        const verifyResult = await client.query(
          `SELECT COUNT(*) as count FROM acc_email_queue WHERE queue_id = $1`,
          [insertedId]
        );
        
        // Should be 0 because transaction was rolled back
        expect(parseInt(verifyResult.rows[0].count)).toBe(0);
      }
    });

    it('should maintain referential integrity', async () => {
      // Try to insert a consent version with invalid document_id
      let errorCaught = false;
      
      try {
        await client.query(`
          INSERT INTO acc_consent_version (
            document_id, version_number, content, effective_date, status, created_by, date_created, date_updated
          ) VALUES (999999, '1.0', '{}', CURRENT_DATE, 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);
      } catch (e: any) {
        errorCaught = true;
        // Should fail due to foreign key constraint
        expect(e.message).toContain('violates foreign key constraint');
      }

      expect(errorCaught).toBe(true);
    });
  });
});

