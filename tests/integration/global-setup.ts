/**
 * Global Setup for Real Integration Tests
 * 
 * This runs once before all integration tests.
 * - Checks if LibreClinica is available
 * - Starts Docker if needed
 * - Waits for services to be ready
 * - Creates test fixtures
 */

import {
  isLibreClinicaReady,
  waitForLibreClinica,
  startLibreClinica,
  isDockerRunning,
  setupIntegrationTestFixtures,
  DEFAULT_CONFIG
} from './libreclinica-setup';

export default async function globalSetup() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🧪 LibreClinica Real Integration Test Setup');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n');

  // Check if LibreClinica is already running
  let isReady = await isLibreClinicaReady(DEFAULT_CONFIG);

  if (!isReady) {
    console.log('LibreClinica is not running. Checking Docker...\n');

    // Check if Docker containers exist but are stopped
    const dockerRunning = isDockerRunning();

    if (!dockerRunning) {
      console.log('Starting LibreClinica Docker containers...\n');
      const started = await startLibreClinica();
      
      if (!started) {
        throw new Error('Failed to start LibreClinica Docker containers');
      }
    }

    // Wait for LibreClinica to be ready
    console.log('Waiting for LibreClinica to initialize...\n');
    isReady = await waitForLibreClinica(DEFAULT_CONFIG, 180000);

    if (!isReady) {
      throw new Error('LibreClinica did not become ready within timeout');
    }
  }

  console.log('✅ LibreClinica is ready!\n');

  // Set up test fixtures
  console.log('Setting up test fixtures...\n');
  
  try {
    const fixtures = await setupIntegrationTestFixtures(DEFAULT_CONFIG);
    
    // Store fixtures in global for tests to access
    (global as any).__LC_TEST_FIXTURES__ = fixtures;
    
    console.log('✅ Test fixtures ready\n');
    console.log(`   Test User: ${fixtures.testUser.username}`);
    console.log(`   Test Study: ${fixtures.testStudy.uniqueIdentifier}\n`);
  } catch (error: any) {
    console.error('❌ Failed to set up test fixtures:', error.message);
    throw error;
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Starting Integration Tests...');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n');
}

