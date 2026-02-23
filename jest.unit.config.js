/**
 * Jest configuration for pure unit tests that require no database.
 * Usage: npx jest --config jest.unit.config.js
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.unit.test.ts'],
  verbose: true,
  testTimeout: 10000,
  // No globalSetup / globalTeardown — these tests are DB-free
  forceExit: true,
};
