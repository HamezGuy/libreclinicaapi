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

// ════════════════════════════════════════════════════════════════════
// Row Key Camelization
// ════════════════════════════════════════════════════════════════════
// PostgreSQL columns are snake_case; TypeScript interfaces are camelCase.
// Rather than scattering toXxx() converters across every service, we
// transform row keys ONCE here at the infrastructure layer so every
// query result is camelCase by the time service code touches it.

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelizeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    out[snakeToCamel(key)] = row[key];
  }
  return out;
}

function camelizeRows(rows: any[]): any[] {
  return rows.map(camelizeRow);
}

/**
 * Wrap a raw PoolClient so that its query() method auto-camelizes
 * result row keys. BEGIN/COMMIT/ROLLBACK are sent via the raw client
 * (they return no meaningful rows). Everything the callback does
 * goes through the camelizing wrapper.
 */
function wrapClientWithCamelize(rawClient: PoolClient): PoolClient {
  const origQuery = rawClient.query.bind(rawClient);
  const wrapped = Object.create(rawClient);
  wrapped.query = async (...args: any[]) => {
    const result = await (origQuery as any)(...args);
    if (result?.rows) {
      result.rows = camelizeRows(result.rows);
    }
    return result;
  };
  return wrapped as PoolClient;
}

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
    
    // Test the connection asynchronously; failure is logged, not fatal.
    // In production the server starts listening before this completes
    // (see server.ts initializeDatabase), so a slow pool.connect won't
    // block Docker health checks.
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
      
      if (result.rows) {
        result.rows = camelizeRows(result.rows);
      }

      logger.debug('Database query executed', { 
        duration, 
        rows: result.rowCount,
        query: text.substring(0, 100)
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
    const raw = await this.pool.connect();
    return wrapClientWithCamelize(raw);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
  
  async getClient(): Promise<PoolClient> {
    const raw = await this.pool.connect();
    return wrapClientWithCamelize(raw);
  }
  
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const rawClient = await this.pool.connect();
    const origQuery = rawClient.query.bind(rawClient);
    const camelClient = wrapClientWithCamelize(rawClient);
    try {
      await (origQuery as any)('BEGIN');
      const result = await callback(camelClient);
      await (origQuery as any)('COMMIT');
      return result;
    } catch (error) {
      await (origQuery as any)('ROLLBACK');
      throw error;
    } finally {
      rawClient.release();
    }
  }
  
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }
}

export const db = new DatabaseConnection();
export const pool = db; // Alias db as pool since it has query/connect methods now


