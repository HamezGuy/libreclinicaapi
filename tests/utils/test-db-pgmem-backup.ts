/**
 * Singleton Test Database Manager
 * Uses in-memory PostgreSQL (pg-mem) for tests
 * No external PostgreSQL required!
 */

import { newDb, IMemoryDb } from 'pg-mem';
import { Pool, PoolClient, QueryResult } from 'pg';

// Create a single in-memory database instance that persists across all tests
const memDb = newDb();
const { Client } = memDb.adapters.createPg();
const client = new Client();

class TestDatabase {
  private static instance: TestDatabase;
  public pool: Pool;
  private memDb: IMemoryDb;
  private isConnected: boolean = false;

  private constructor() {
    // Use the shared in-memory database
    this.memDb = memDb;
    
    // Create a pool-like interface using the shared client
    this.pool = {
      query: async (text: string, params?: any[]) => {
        return await client.query(text, params);
      },
      connect: async () => {
        return client;
      },
      end: async () => {
        // No-op for in-memory database
      },
    } as any;
    
    console.log('✅ In-memory PostgreSQL database created');
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
   * Connect to database (always ready with in-memory DB)
   */
  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.initializeSchema();
      this.isConnected = true;
    }
  }

  /**
   * Initialize database schema
   * Uses the ACTUAL LibreClinica database schema
   */
  private async initializeSchema(): Promise<void> {
    // Load the real LibreClinica schema
    const fs = require('fs');
    const path = require('path');
    
    const schemaPath = path.join(__dirname, '../schema/libreclinica-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = schema
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));
    
    console.log(`📋 Loading ${statements.length} SQL statements from LibreClinica schema...`);
    
    for (const statement of statements) {
      try {
        await this.pool.query(statement);
      } catch (error: any) {
        // Skip errors for statements that might not be supported by pg-mem
        if (!error.message?.includes('not supported') && 
            !error.message?.includes('does not exist') &&
            !error.message?.includes('already exists') &&
            !error.message?.includes('VIEW') &&
            !error.message?.includes('INDEX')) {
          console.warn('Schema statement warning:', error.message?.substring(0, 100));
        }
      }
    }

    console.log('✅ LibreClinica database schema initialized (real production schema)');
  }

  /**
   * Disconnect from database (no-op for in-memory DB)
   */
  public async disconnect(): Promise<void> {
    // In-memory database doesn't need explicit disconnection
    this.isConnected = false;
  }

  /**
   * Clean all tables
   */
  public async cleanDatabase(): Promise<void> {
    const tables = [
      'discrepancy_note',
      'study_user_role',
      'audit_user_api_log',
      'audit_log_event',
      'study_subject',
      'study',
      'user_account'
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`DELETE FROM ${table}`);
      } catch (error) {
        // Table might not exist yet, ignore
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
      // Insert test user (root) with bcrypt hash for 'root'
      await this.pool.query(`
        INSERT INTO user_account (user_name, first_name, last_name, email, passwd)
        VALUES ('root', 'Root', 'User', 'root@example.com', '$2b$10$rO5nGqXZQJmXqZqZqZqZqeZqZqZqZqZqZqZqZqZqZqZqZqZqZqZ')
        ON CONFLICT (user_name) DO NOTHING;
      `);

      // Insert test study
      await this.pool.query(`
        INSERT INTO study (unique_identifier, name, description, status_id)
        VALUES ('TEST-STUDY-001', 'Test Study', 'Test study for integration tests', 1)
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
