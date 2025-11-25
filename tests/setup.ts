/**
 * Test Setup - DEPRECATED
 * This file is kept for backwards compatibility
 * New setup is in tests/setup/setup-after-env.ts
 */

import { testDb } from './utils/test-db';

// Clean database before each test file
beforeEach(async () => {
  await testDb.cleanDatabase();
  await testDb.seedTestData();
});

// Close database connection after all tests
afterAll(async () => {
  await testDb.disconnect();
});
