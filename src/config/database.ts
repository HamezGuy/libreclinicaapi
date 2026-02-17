import { Pool, PoolClient, QueryResult, types } from 'pg';
import { config } from './environment';
import { logger } from './logger';

// ════════════════════════════════════════════════════════════════════
// PostgreSQL Type Parsers — ensure dates come back as ISO strings
// ════════════════════════════════════════════════════════════════════
// By default, pg returns DATE (1082) as a JavaScript Date object which
// gets UTC-shifted on serialization, causing off-by-one-day bugs.
// Override to return raw ISO strings (YYYY-MM-DD) for date-only columns.
// TIMESTAMP (1114) and TIMESTAMPTZ (1184) are left as Date objects.

// DATE type (OID 1082) — return as YYYY-MM-DD string
types.setTypeParser(1082, (val: string) => val); // Keep as-is, already YYYY-MM-DD from Postgres

class DatabaseConnection {
  public pool: Pool;
  
  constructor() {
    // Use test database in test environment
    if (process.env.NODE_ENV === 'test') {
      // Import test database pool
      try {
        const { testDb } = require('../../tests/utils/test-db');
        this.pool = testDb.pool;
        logger.info('Using in-memory test database');
        return;
      } catch (error) {
        logger.warn('Could not load test database, using regular pool');
      }
    }
    
    // Log the database configuration for debugging
    logger.info('Database configuration', {
      host: config.libreclinica.database.host,
      port: config.libreclinica.database.port,
      database: config.libreclinica.database.database,
      user: config.libreclinica.database.user,
      connectionTimeoutMillis: config.libreclinica.database.connectionTimeoutMillis
    });
    
    this.pool = new Pool(config.libreclinica.database);
    
    // Test connection on startup
    this.pool.on('connect', () => {
      logger.info('Database connection established');
    });
    
    this.pool.on('error', (err) => {
      logger.error('Unexpected database error', { error: err.message });
    });
    
    // Test the connection immediately
    this.testConnection();
  }
  
  private async testConnection(): Promise<void> {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      logger.info('Database connection test successful', { 
        serverTime: result.rows[0].now 
      });
      client.release();
    } catch (error) {
      logger.error('Database connection test failed', { 
        error: (error as Error).message 
      });
    }
  }
  
  async query(text: string, params?: any[]): Promise<QueryResult> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Database query executed', { 
        duration, 
        rows: result.rowCount,
        query: text.substring(0, 100) // Log first 100 chars
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Database query error', { 
        error: (error as Error).message,
        duration,
        query: text.substring(0, 100)
      });
      throw error;
    }
  }
  
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
  
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }
  
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
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
  
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }
}

export const db = new DatabaseConnection();
export const pool = db; // Alias db as pool since it has query/connect methods now


