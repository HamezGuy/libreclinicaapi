/**
 * Test Database Manager - Real PostgreSQL
 * Uses Docker PostgreSQL with REAL LibreClinica schema
 * 
 * IMPORTANT: This database is SEPARATE from the main/production database!
 * - Test DB: localhost:5433/libreclinica_test
 * - Main DB: localhost:5432/libreclinica (or configured in .env)
 */

import { Pool, PoolClient, QueryResult } from 'pg';

class TestDatabase {
  private static instance: TestDatabase;
  public pool: Pool;
  private isConnected: boolean = false;

  private constructor() {
    // Connect to Docker PostgreSQL TEST database (port 5433 - SEPARATE from main!)
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433'), // TEST database port
      user: process.env.DB_USER || 'clinica',
      password: process.env.DB_PASSWORD || 'clinica',
      database: process.env.DB_NAME || 'libreclinica_test',
      max: 10,
    });
    
    console.log('✅ Test Database Pool Created');
    console.log('   Host: localhost');
    console.log('   Port: 5433 (TEST DATABASE - separate from production)');
    console.log('   Database: libreclinica_test');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TestDatabase {
    if (!TestDatabase.instance) {
      TestDatabase.instance = new TestDatabase();
    }
    return TestDatabase.instance;
  }

  /**
   * Connect to database
   */
  public async connect(): Promise<void> {
    if (!this.isConnected) {
      try {
        await this.pool.query('SELECT 1');
        this.isConnected = true;
        console.log('✅ Test database connection verified');
      } catch (error: any) {
        console.error('❌ Failed to connect to test database:', error.message);
        console.error('   Make sure the test database is running:');
        console.error('   docker-compose -f docker-compose.test.yml up -d');
        throw error;
      }
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.pool.end();
      this.isConnected = false;
      console.log('✅ Test database disconnected');
    }
  }

  /**
   * Reset database - Clean ALL data and reseed
   * Call this between tests for full isolation
   */
  public async resetDatabase(): Promise<void> {
    await this.cleanDatabase();
    await this.seedTestData();
  }

  /**
   * Clean all tables (respects foreign key constraints)
   * Uses TRUNCATE with CASCADE for complete cleanup
   */
  public async cleanDatabase(): Promise<void> {
    // Order matters due to foreign key constraints
    const tables = [
      // Randomization engine tables
      'acc_randomization_list',
      'acc_randomization_config',
      // Child tables first
      'dn_item_data_map',
      'dn_event_crf_map',
      'dn_study_subject_map',
      'dn_study_event_map',
      'item_data',
      'event_crf',
      'study_event',
      'subject_group_map',
      'discrepancy_note',
      'study_subject',
      'subject',
      'crf_version',
      'crf',
      'event_definition_crf',
      'study_event_definition',
      'study_group',
      'study_group_class',
      'study_user_role',
      'study',
      // User tables
      'audit_log_event',
      'audit_user_login',
      'audit_user_api_log',
      // Keep user_account last (for root user recreation)
      'user_account'
    ];

    for (const table of tables) {
      try {
        // Use DELETE to avoid CASCADE issues; TRUNCATE would be faster but riskier
        await this.pool.query(`DELETE FROM ${table}`);
      } catch (error: any) {
        // Table might not exist or have other dependencies - this is OK
        // console.warn(`Could not clean table ${table}: ${error.message}`);
      }
    }

    // Reset sequences for auto-increment IDs
    const sequences = [
      'user_account_user_id_seq',
      'study_study_id_seq',
      'study_subject_study_subject_id_seq',
      'discrepancy_note_discrepancy_note_id_seq',
      'audit_log_event_audit_id_seq',
      'crf_crf_id_seq',
      'crf_version_crf_version_id_seq',
      'study_event_definition_study_event_definition_id_seq',
      'study_event_study_event_id_seq',
      'event_crf_event_crf_id_seq',
      'item_data_item_data_id_seq',
      'acc_randomization_config_config_id_seq',
      'acc_randomization_list_list_entry_id_seq',
      'subject_subject_id_seq',
      'study_group_class_study_group_class_id_seq',
      'study_group_study_group_id_seq',
      'subject_group_map_subject_group_map_id_seq'
    ];

    for (const seq of sequences) {
      try {
        await this.pool.query(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
      } catch (error) {
        // Sequence might not exist
      }
    }
  }

  /**
   * Clean specific tables only
   */
  public async cleanTables(tableNames: string[]): Promise<void> {
    for (const tableName of tableNames) {
      try {
        await this.pool.query(`DELETE FROM ${tableName}`);
      } catch (error) {
        // Table might not exist, ignore
      }
    }
  }

  /**
   * Seed essential test data
   * Creates root user and basic lookup data
   */
  public async seedTestData(): Promise<void> {
    try {
      // 1. Ensure status lookup exists
      await this.pool.query(`
        INSERT INTO status (status_id, name, description) VALUES
          (1, 'available', 'Available'),
          (2, 'pending', 'Pending'),
          (3, 'unavailable', 'Unavailable'),
          (4, 'private', 'Private'),
          (5, 'removed', 'Removed'),
          (6, 'locked', 'Locked'),
          (7, 'auto-removed', 'Auto-removed'),
          (8, 'signed', 'Signed'),
          (9, 'frozen', 'Frozen')
        ON CONFLICT (status_id) DO NOTHING
      `);

      // 2. Ensure user_type lookup exists
      await this.pool.query(`
        INSERT INTO user_type (user_type_id, user_type) VALUES
          (1, 'admin'),
          (2, 'user'),
          (3, 'tech-admin'),
          (4, 'sysadmin')
        ON CONFLICT (user_type_id) DO NOTHING
      `);

      // 3. Ensure study_type lookup exists
      await this.pool.query(`
        INSERT INTO study_type (study_type_id, name, description) VALUES
          (1, 'genetic', 'Genetic Study'),
          (2, 'observational', 'Observational Study'),
          (3, 'interventional', 'Interventional Study'),
          (4, 'other', 'Other')
        ON CONFLICT (study_type_id) DO NOTHING
      `);

      // 4. Ensure discrepancy_note_type lookup exists
      await this.pool.query(`
        INSERT INTO discrepancy_note_type (discrepancy_note_type_id, name, description) VALUES
          (1, 'Failed Validation Check', 'Failed Validation Check'),
          (2, 'Annotation', 'Annotation'),
          (3, 'Query', 'Query'),
          (4, 'Reason for Change', 'Reason for Change')
        ON CONFLICT (discrepancy_note_type_id) DO NOTHING
      `);

      // 5. Ensure resolution_status lookup exists
      await this.pool.query(`
        INSERT INTO resolution_status (resolution_status_id, name, description) VALUES
          (1, 'New', 'New'),
          (2, 'Updated', 'Updated'),
          (3, 'Resolution Proposed', 'Resolution Proposed'),
          (4, 'Closed', 'Closed'),
          (5, 'Not Applicable', 'Not Applicable')
        ON CONFLICT (resolution_status_id) DO NOTHING
      `);

      // 6. Ensure audit_log_event_type lookup exists
      await this.pool.query(`
        INSERT INTO audit_log_event_type (audit_log_event_type_id, name) VALUES
          (1, 'Entity Created'),
          (2, 'Entity Updated'),
          (3, 'Entity Deleted'),
          (4, 'User Login'),
          (5, 'Failed Login Attempt'),
          (6, 'Query Created'),
          (7, 'Query Updated'),
          (8, 'SDV Verified'),
          (9, 'Data Locked'),
          (10, 'Data Unlocked'),
          (11, 'User Created'),
          (12, 'User Updated'),
          (13, 'User Deleted')
        ON CONFLICT (audit_log_event_type_id) DO NOTHING
      `);

      // 7. Ensure subject_event_status lookup exists
      await this.pool.query(`
        INSERT INTO subject_event_status (subject_event_status_id, name) VALUES
          (1, 'scheduled'),
          (2, 'not_scheduled'),
          (3, 'data_entry_started'),
          (4, 'completed'),
          (5, 'stopped'),
          (6, 'skipped'),
          (7, 'signed'),
          (8, 'locked')
        ON CONFLICT (subject_event_status_id) DO NOTHING
      `);

      // 8. Create root user with MD5 password 'root' = 63a9f0ea7bb98050796b649e85481845
      await this.pool.query(`
        INSERT INTO user_account (
          user_id, user_name, passwd, first_name, last_name, email, 
          user_type_id, status_id, enabled, account_non_locked, owner_id,
          date_created
        ) VALUES (
          1, 'root', '63a9f0ea7bb98050796b649e85481845', 'Root', 'User', 
          'root@example.com', 4, 1, true, true, 1, NOW()
        ) ON CONFLICT (user_id) DO NOTHING
      `);

      // Reset user_account sequence to start after root user
      await this.pool.query(`ALTER SEQUENCE user_account_user_id_seq RESTART WITH 2`);

      // 9. Create a default test study
      await this.pool.query(`
        INSERT INTO study (
          study_id, unique_identifier, name, summary, type_id, status_id, 
          owner_id, date_created, oc_oid
        ) VALUES (
          1, 'TEST-STUDY-001', 'Test Study', 'Test study for automated tests',
          3, 1, 1, NOW(), 'S_TEST001'
        ) ON CONFLICT (study_id) DO NOTHING
      `);

      // Reset study sequence to start after test study
      await this.pool.query(`ALTER SEQUENCE study_study_id_seq RESTART WITH 2`);

      // 10. Assign root user to test study
      await this.pool.query(`
        INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
        VALUES ('admin', 1, 1, 1, 'root', NOW())
        ON CONFLICT DO NOTHING
      `);

    } catch (error: any) {
      console.error('Error seeding test data:', error.message);
      throw error;
    }
  }

  /**
   * Execute query
   */
  public async query(text: string, params?: any[]): Promise<QueryResult> {
    return await this.pool.query(text, params);
  }

  /**
   * Get a client for transactions
   */
  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  /**
   * Execute in transaction with automatic rollback on error
   */
  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Run a test in a transaction that gets rolled back
   * This ensures test isolation without needing to clean the database
   */
  public async runInTestTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('ROLLBACK'); // Always rollback test transactions
      return result;
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export const testDb = TestDatabase.getInstance();
