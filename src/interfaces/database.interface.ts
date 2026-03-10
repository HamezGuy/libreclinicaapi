/**
 * Database abstraction interface for dependency injection.
 *
 * Services that depend on the database should accept an `IDatabase` via
 * constructor injection rather than importing the global `pool` singleton.
 * This allows unit tests to inject a mock/in-memory implementation.
 *
 * The default production singleton is exported from `config/database.ts`.
 */

import { PoolClient, QueryResult } from 'pg';

export interface IDatabase {
  query(text: string, params?: any[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
}
