/**
 * Setup After Environment
 * Runs before each test file
 * Configures test environment and provides data isolation
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { beforeAll, afterEach, afterAll, expect } from '@jest/globals';
import { testDb } from '../utils/test-db';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.test') });

// Fallback to default test config
process.env['NODE_ENV'] = 'test';
process.env['DB_HOST'] = process.env['DB_HOST'] || 'localhost';
process.env['DB_PORT'] = process.env['DB_PORT'] || '5433';
process.env['DB_NAME'] = process.env['DB_NAME'] || 'libreclinica_test';
process.env['DB_USER'] = process.env['DB_USER'] || 'clinica';
process.env['DB_PASSWORD'] = process.env['DB_PASSWORD'] || 'clinica';

/**
 * Reset database before each test file
 * This ensures test isolation at the file level
 */
beforeAll(async () => {
  // Ensure connection is established
  await testDb.connect();
  
  // Reset database to clean state for this test file
  await testDb.resetDatabase();
});

/**
 * Clean up specific test data after each individual test
 * This is lighter than full reset but helps prevent test pollution
 */
afterEach(async () => {
  // Clean up any test-specific audit logs to prevent buildup
  try {
    await testDb.query(`
      DELETE FROM audit_log_event 
      WHERE audit_date > NOW() - INTERVAL '5 minutes'
        AND entity_name LIKE 'Test%'
    `);
  } catch (error) {
    // Ignore cleanup errors
  }
});

/**
 * Full cleanup after all tests in a file complete
 */
afterAll(async () => {
  // Clean database after test file completes
  await testDb.cleanDatabase();
});

// Custom matchers
expect.extend({
  toBeValidJWT(received: string) {
    const jwtRegex = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
    const pass = jwtRegex.test(received);

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid JWT`
          : `expected ${received} to be a valid JWT`,
    };
  },
  
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid UUID`
          : `expected ${received} to be a valid UUID`,
    };
  },

  toBeValidDate(received: any) {
    const date = new Date(received);
    const pass = !isNaN(date.getTime());

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid date`
          : `expected ${received} to be a valid date`,
    };
  },

  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor} - ${ceiling}`
          : `expected ${received} to be within range ${floor} - ${ceiling}`,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidJWT(): R;
      toBeValidUUID(): R;
      toBeValidDate(): R;
      toBeWithinRange(floor: number, ceiling: number): R;
    }
  }
}
