/**
 * Global Teardown for Real Integration Tests
 * 
 * This runs once after all integration tests.
 * - Cleans up test fixtures
 * - Optionally stops Docker containers
 */

import {
  teardownIntegrationTestFixtures,
  closeLibreClinicaDb,
  DEFAULT_CONFIG
} from './libreclinica-setup';

export default async function globalTeardown() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🧹 LibreClinica Integration Test Teardown');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n');

  try {
    // Clean up test fixtures
    await teardownIntegrationTestFixtures(DEFAULT_CONFIG);
    console.log('✅ Test fixtures cleaned up\n');
  } catch (error: any) {
    console.error('⚠️ Cleanup warning:', error.message);
  }

  try {
    // Close database connections
    await closeLibreClinicaDb();
    console.log('✅ Database connections closed\n');
  } catch (error: any) {
    console.error('⚠️ DB cleanup warning:', error.message);
  }

  // Note: We don't stop Docker containers by default
  // This allows quick re-runs without waiting for startup
  // Use `npm run libreclinica:stop` to stop containers manually

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Integration Tests Complete');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n');
  
  console.log('ℹ️ LibreClinica containers are still running.');
  console.log('   To stop: npm run libreclinica:stop\n');
}

