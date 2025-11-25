/**
 * Global Test Setup
 * Runs once before all test suites
 * Initializes the in-memory singleton test database
 * Starts mock SOAP server for integration tests
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { testDb } from '../utils/test-db';
import { MockSoapServer } from '../mocks/soap-mock-server';

// Store mock server instance globally for cleanup
declare global {
  var __MOCK_SOAP_SERVER__: MockSoapServer | undefined;
}

export default async function globalSetup() {
  console.log('\n🚀 Starting global test setup for LibreClinica API...\n');

  // Load environment variables
  dotenv.config({ path: path.join(__dirname, '../../.env') });

  // Set test environment
  process.env['NODE_ENV'] = 'test';
  
  // Configure SOAP to use mock server
  const mockSoapPort = process.env.MOCK_SOAP_PORT || '8089';
  process.env['LIBRECLINICA_SOAP_URL'] = `http://localhost:${mockSoapPort}/ws`;

  console.log('📦 Using REAL PostgreSQL database (Docker)');
  console.log('📦 Real LibreClinica schema loaded');
  console.log('📦 Test database: localhost:5433/libreclinica_test\n');

  try {
    // Connect to PostgreSQL test database
    await testDb.connect();
    
    // Verify schema exists
    const tables = await testDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`📋 Tables available: ${tables.rows.length} tables`);
    console.log('   Including: user_account, study, study_subject, crf, item_data, audit_log_event, etc.');
    
    // Clean any existing test data
    await testDb.cleanDatabase();
    
    // Seed initial test data
    await testDb.seedTestData();
    
    // Verify data was seeded
    const userCount = await testDb.query('SELECT COUNT(*) as count FROM user_account');
    const studyCount = await testDb.query('SELECT COUNT(*) as count FROM study');
    console.log(`👤 Test data ready: ${userCount.rows[0].count} users, ${studyCount.rows[0].count} studies`);
    
    // Start mock SOAP server for integration tests
    if (process.env.USE_MOCK_SOAP !== 'false') {
      try {
        const mockServer = new MockSoapServer(parseInt(mockSoapPort));
        await mockServer.start();
        global.__MOCK_SOAP_SERVER__ = mockServer;
        console.log(`🧼 Mock SOAP server started on port ${mockSoapPort}`);
      } catch (soapError: any) {
        console.warn(`⚠️ Could not start mock SOAP server: ${soapError.message}`);
        console.warn('   SOAP integration tests may fail');
      }
    }
    
    console.log('✅ Global test setup completed successfully!\n');
  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    throw error;
  }
}
