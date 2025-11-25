/**
 * Jest Configuration for Real Integration Tests
 * 
 * Use this config when running tests against real LibreClinica:
 *   jest --config jest.integration.config.js
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.integration.test.ts'],
  verbose: true,
  testTimeout: 300000, // 5 minutes - LibreClinica can be slow
  maxWorkers: 1, // Run serially
  forceExit: true,
  detectOpenHandles: true,
  // No coverage for integration tests - they're for validation
  collectCoverage: false,
  // Custom setup/teardown for LibreClinica
  globalSetup: '<rootDir>/tests/integration/global-setup.ts',
  globalTeardown: '<rootDir>/tests/integration/global-teardown.ts',
};

