/**
 * SOAP Test Setup
 * 
 * Configures the test environment for SOAP testing:
 * - Sets up mock SOAP server if needed
 * - Configures environment variables
 * - Provides helper functions for tests
 */

import { MockSoapServer } from '../mocks/soap-mock-server';
import { MockSoapClient } from '../mocks/soap-mock-client';

// =============================================================================
// Configuration
// =============================================================================

export const MOCK_SOAP_PORT = parseInt(process.env.MOCK_SOAP_PORT || '8089');
export const USE_MOCK_SERVER = process.env.USE_MOCK_SOAP !== 'false';

// =============================================================================
// Singleton Instances
// =============================================================================

let mockServer: MockSoapServer | null = null;
let mockClient: MockSoapClient | null = null;

// =============================================================================
// Server Management
// =============================================================================

/**
 * Start mock SOAP server for integration tests
 */
export async function startMockSoapServer(): Promise<MockSoapServer> {
  if (mockServer) {
    return mockServer;
  }

  mockServer = new MockSoapServer(MOCK_SOAP_PORT);
  await mockServer.start();
  
  // Update environment to point to mock server
  process.env.LIBRECLINICA_SOAP_URL = `http://localhost:${MOCK_SOAP_PORT}/ws`;
  
  return mockServer;
}

/**
 * Stop mock SOAP server
 */
export async function stopMockSoapServer(): Promise<void> {
  if (mockServer) {
    await mockServer.stop();
    mockServer = null;
  }
}

/**
 * Get mock SOAP server instance
 */
export function getMockSoapServer(): MockSoapServer | null {
  return mockServer;
}

/**
 * Reset mock server data
 */
export function resetMockSoapServer(): void {
  if (mockServer) {
    mockServer.reset();
  }
}

// =============================================================================
// Client Management
// =============================================================================

/**
 * Get mock SOAP client for unit tests
 */
export function getMockSoapClient(): MockSoapClient {
  if (!mockClient) {
    mockClient = new MockSoapClient();
  }
  return mockClient;
}

/**
 * Reset mock client state
 */
export function resetMockSoapClient(): void {
  if (mockClient) {
    mockClient.clearOverrides();
  }
}

// =============================================================================
// Jest Global Setup/Teardown
// =============================================================================

/**
 * Global setup for SOAP tests
 * Call this in beforeAll() of your test file
 */
export async function setupSoapTests(): Promise<void> {
  if (USE_MOCK_SERVER) {
    await startMockSoapServer();
  }
}

/**
 * Global teardown for SOAP tests
 * Call this in afterAll() of your test file
 */
export async function teardownSoapTests(): Promise<void> {
  if (mockServer) {
    await stopMockSoapServer();
  }
}

/**
 * Reset between tests
 * Call this in beforeEach() of your test file
 */
export function resetSoapTestState(): void {
  resetMockSoapServer();
  resetMockSoapClient();
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Wait for mock server to be ready
 */
export async function waitForMockServer(
  maxWait: number = 5000,
  interval: number = 100
): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    if (mockServer) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false;
}

/**
 * Check if mock server is running
 */
export function isMockServerRunning(): boolean {
  return mockServer !== null;
}

/**
 * Add test data to mock server
 */
export function addMockStudy(oid: string, name: string): void {
  if (mockServer) {
    mockServer.addStudy({
      oid,
      identifier: oid.replace('S_', 'STUDY-'),
      name,
      description: `Test study: ${name}`,
      status: 'available'
    });
  }
}

/**
 * Add test subject to mock server
 */
export function addMockSubject(
  studyOid: string,
  subjectKey: string,
  subjectId: string
): void {
  if (mockServer) {
    mockServer.addSubject({
      subjectKey,
      studySubjectId: subjectId,
      studyOid,
      enrollmentDate: new Date().toISOString().split('T')[0]
    });
  }
}

// =============================================================================
// Environment Helpers
// =============================================================================

/**
 * Get SOAP URL (mock or real)
 */
export function getSoapUrl(): string {
  if (USE_MOCK_SERVER) {
    return `http://localhost:${MOCK_SOAP_PORT}/ws`;
  }
  return process.env.LIBRECLINICA_SOAP_URL || 'http://localhost:8080/LibreClinica/ws';
}

/**
 * Check if using mock server
 */
export function isUsingMockServer(): boolean {
  return USE_MOCK_SERVER;
}

// =============================================================================
// Export Utilities
// =============================================================================

export { MockSoapServer } from '../mocks/soap-mock-server';
export { MockSoapClient } from '../mocks/soap-mock-client';

export default {
  startMockSoapServer,
  stopMockSoapServer,
  getMockSoapServer,
  getMockSoapClient,
  resetMockSoapServer,
  resetMockSoapClient,
  setupSoapTests,
  teardownSoapTests,
  resetSoapTestState,
  addMockStudy,
  addMockSubject,
  getSoapUrl,
  isUsingMockServer
};

