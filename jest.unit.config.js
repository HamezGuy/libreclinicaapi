/** Jest config for pure unit tests — no DB, no global setup/teardown */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'file-upload\\.test\\.ts$',
    'bugfix-date-handling\\.unit\\.test\\.ts$',
  ],
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
  forceExit: true,
};
