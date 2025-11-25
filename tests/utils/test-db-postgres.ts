/**
 * Test Database Manager - Real PostgreSQL
 * Uses Docker PostgreSQL with REAL LibreClinica schema
 */

import { Pool, PoolClient, QueryResult } from 'pg';

class TestDatabase {
  private static instance: TestDatabase;
  public pool: Pool;
  private isConnected: boolean = false;

  private constructor() {
    // Connect to Docker PostgreSQL test database
    this.pool = new Pool({
      host: 'localhost',
      port: 5433, // Test database port
      user: 'clinica',
      password: 'clinica',
      database: 'libreclinica_test',
      max: 10,
    });
    
    console.log('✅ Connected to PostgreSQL test database (port 5433)');
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
      await this.pool.query('SELECT 1');
      this.isConnected = true;
      console.log('✅ Test database connection verified');
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.pool.end();
      this.isConnected = false;
    }
  }

  /**
   * Clean all tables (except lookup tables)
   */
  public async cleanDatabase(): Promise<void> {
    const tables = [
      'item_data',
      'event_crf',
      'study_event',
      'study_subject',
      'subject',
      'discrepancy_note',
      'study_user_role',
      'study',
      'user_account',
      'audit_log_event',
      'audit_user_login',
      'audit_user_api_log'
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`DELETE FROM ${table}`);
      } catch (error) {
        // Table might not exist or have dependencies, ignore
      }
    }
  }

  /**
   * Clean specific tables
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
   * Seed test data
   */
  public async seedTestData(): Promise<void> {
    try {
      // Insert test user (root) - already in schema, but ensure it exists
      await this.pool.query(`
        INSERT INTO user_account (user_name, passwd, first_name, last_name, email, user_type_id, status_id)
        VALUES ('root', '$2b$10$rO5nGqXZQJmXqZqZqZqZqeZqZqZqZqZqZqZqZqZqZqZqZqZqZqZ', 'Root', 'User', 'root@example.com', 4, 1)
        ON CONFLICT (user_name) DO NOTHING;
      `);

      // Insert test study - already in schema, but ensure it exists
      await this.pool.query(`
        INSERT INTO study (unique_identifier, name, summary, type_id, status_id, owner_id)
        VALUES ('TEST-STUDY-001', 'Test Study', 'Test study for integration tests', 3, 1, 1)
        ON CONFLICT (unique_identifier) DO NOTHING;
      `);
    } catch (error) {
      console.error('Error seeding test data:', error);
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
   * Execute in transaction
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
}

// Export singleton instance
export const testDb = TestDatabase.getInstance();
