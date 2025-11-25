/**
 * Global Test Teardown
 * Runs once after all test suites
 * Cleans up the in-memory database and mock SOAP server
 */

import { testDb } from '../utils/test-db';

// Access global mock server (type shared with global-setup.ts)
import { MockSoapServer } from '../mocks/soap-mock-server';

declare global {
  var __MOCK_SOAP_SERVER__: MockSoapServer | undefined;
}

export default async function globalTeardown() {
  console.log('\n🧹 Running global test teardown...\n');

  try {
    // Stop mock SOAP server if running
    if (global.__MOCK_SOAP_SERVER__) {
      await global.__MOCK_SOAP_SERVER__.stop();
      console.log('🧼 Mock SOAP server stopped');
      global.__MOCK_SOAP_SERVER__ = undefined;
    }

    // Disconnect from in-memory database
    await testDb.disconnect();
    
    console.log('✅ Global test teardown completed\n');
  } catch (error) {
    console.error('❌ Global test teardown failed:', error);
  }
}
