# LibreClinica API Testing Guide

## Overview

This guide covers the comprehensive testing infrastructure for the LibreClinica REST API, including unit tests, integration tests, and end-to-end tests that verify the complete flow from Angular UI to the database.

## Test Architecture

### Singleton Database Pattern

All tests use a **singleton test database** that is:
- Created once at the start of the test suite
- Shared across all tests
- Cleaned between test files to ensure isolation
- Preserved after tests for inspection

### Test Layers

1. **Unit Tests** - Test individual services and utilities
2. **Integration Tests** - Test API endpoints and database interactions
3. **E2E Tests** - Test complete UI → API → Database flow
4. **SOAP Tests** - Test SOAP web service integration

## Setup

### Prerequisites

```bash
# Ensure PostgreSQL is running
# Ensure LibreClinica database exists

# Install dependencies
npm install
```

### Environment Configuration

Create a `.env` file with test database configuration:

```env
# Test Database (will be suffixed with _test automatically)
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=clinica

# SOAP Configuration
LIBRECLINICA_SOAP_URL=http://localhost:8080/LibreClinica/ws
SOAP_USERNAME=root
SOAP_PASSWORD=root

# JWT Configuration
JWT_SECRET=test-secret-key
JWT_EXPIRES_IN=1h
```

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests (UI → API → DB)
npm run test:e2e

# SOAP integration tests
npm run test:soap

# API endpoint tests
npm run test:api

# All tests with verbose output
npm run test:all

# CI/CD mode
npm run test:ci
```

### Watch Mode

```bash
npm run test:watch
```

## Test Structure

### Directory Layout

```
tests/
├── setup/
│   ├── global-setup.ts       # Creates test database
│   ├── global-teardown.ts    # Cleans up after all tests
│   └── setup-after-env.ts    # Per-test-file setup
├── utils/
│   └── test-db.ts            # Singleton database manager
├── mocks/                    # Mock data and services
├── api.test.ts               # API endpoint tests
├── integration.test.ts       # API-to-DB integration tests
├── e2e-integration.test.ts   # UI-to-DB end-to-end tests
├── soap-integration.test.ts  # SOAP service tests
├── *.service.test.ts         # Service unit tests
└── setup.ts                  # Legacy setup (deprecated)
```

## Test Database

### Automatic Setup

The test database is automatically:
1. Created with `_test` suffix (e.g., `libreclinica_test`)
2. Schema is initialized with required tables
3. Seeded with test data (root user, test study)
4. Cleaned between test files

### Manual Database Operations

```bash
# Drop test database manually
psql -U clinica -c "DROP DATABASE libreclinica_test;"

# Recreate test database
npm test  # Will recreate automatically
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import { UserService } from '../src/services/user.service';

describe('UserService', () => {
  it('should validate user data', () => {
    const service = new UserService();
    const result = service.validateUser({ username: 'test' });
    expect(result.isValid).toBe(true);
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('User API Integration', () => {
  let authToken: string;

  beforeAll(async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'root', password: 'root' });
    authToken = response.body.accessToken;
  });

  it('should create user and verify in database', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password123!@#'
      });

    expect(response.status).toBe(201);

    // Verify in database
    const dbResult = await testDb.query(
      'SELECT * FROM user_account WHERE user_name = $1',
      ['testuser']
    );

    expect(dbResult.rows.length).toBe(1);
  });
});
```

### E2E Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../src/app';
import { testDb } from './utils/test-db';

describe('E2E: UI to Database', () => {
  it('should reflect UI changes in database', async () => {
    // Simulate Angular UI action
    const response = await request(app)
      .post('/api/subjects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studyId: 1,
        label: 'SUBJ-001',
        enrollmentDate: new Date().toISOString()
      });

    expect(response.status).toBe(201);

    // Verify in database
    const dbResult = await testDb.query(
      'SELECT * FROM study_subject WHERE label = $1',
      ['SUBJ-001']
    );

    expect(dbResult.rows.length).toBe(1);

    // Verify audit trail
    const auditResult = await testDb.query(
      'SELECT * FROM audit_log_event WHERE entity_id = $1',
      [response.body.subjectId]
    );

    expect(auditResult.rows.length).toBeGreaterThan(0);
  });
});
```

## Coverage Requirements

### Thresholds

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

### Viewing Coverage

```bash
# Run tests with coverage
npm test

# Open HTML coverage report
# coverage/index.html
```

## Test Data Management

### Singleton Database Manager

```typescript
import { testDb } from './utils/test-db';

// Clean all tables
await testDb.cleanDatabase();

// Clean specific tables
await testDb.cleanTables(['user_account', 'study']);

// Seed test data
await testDb.seedTestData();

// Execute query
const result = await testDb.query('SELECT * FROM user_account');

// Use transaction
await testDb.transaction(async (client) => {
  await client.query('INSERT INTO ...');
  await client.query('UPDATE ...');
});
```

## Custom Matchers

### toBeValidJWT

```typescript
expect(token).toBeValidJWT();
```

### toBeValidUUID

```typescript
expect(id).toBeValidUUID();
```

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
pg_isready

# Check database exists
psql -U clinica -l | grep libreclinica

# Check connection
psql -U clinica -d libreclinica_test -c "SELECT 1"
```

### Test Failures

```bash
# Run with verbose output
npm run test:all

# Run specific test file
npx jest tests/api.test.ts --verbose

# Run with debugging
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Clean Test Database

```bash
# Drop and recreate
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"
npm test  # Will recreate
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_USER: clinica
          POSTGRES_PASSWORD: clinica
          POSTGRES_DB: libreclinica
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:ci
      - uses: codecov/codecov-action@v2
        with:
          files: ./coverage/lcov.info
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean database between tests
3. **Assertions**: Use specific assertions, not just truthy checks
4. **Async**: Always await async operations
5. **Error Handling**: Test both success and failure cases
6. **Documentation**: Comment complex test scenarios
7. **Performance**: Keep tests fast (< 30s timeout)

## Test Scenarios Covered

### Authentication
- ✅ Login with valid credentials
- ✅ Login with invalid credentials
- ✅ JWT token generation and validation
- ✅ Session management
- ✅ SOAP authentication integration

### User Management
- ✅ Create user via API
- ✅ Update user data
- ✅ Verify database persistence
- ✅ Audit trail logging
- ✅ Concurrent user operations

### Study Management
- ✅ Create study
- ✅ Update study status
- ✅ Fetch study metadata via SOAP
- ✅ Study-user role assignments

### Subject Enrollment
- ✅ Enroll subject
- ✅ Update subject data
- ✅ Verify enrollment in database
- ✅ Audit trail for enrollments

### Form Data Entry
- ✅ Submit form data
- ✅ Validate data persistence
- ✅ SOAP data submission
- ✅ Audit trail for data changes

### SOAP Integration
- ✅ SOAP authentication
- ✅ Study operations via SOAP
- ✅ Subject operations via SOAP
- ✅ Form data via SOAP
- ✅ Error handling
- ✅ Data synchronization

### End-to-End Flows
- ✅ UI → API → Database verification
- ✅ Concurrent operations
- ✅ Data consistency across layers
- ✅ Complete audit trail

## Support

For issues or questions:
1. Check test output for specific errors
2. Review test database state
3. Check SOAP service availability
4. Verify environment configuration
5. Review this documentation

## Changelog

### v1.0.0
- Initial test infrastructure
- Singleton database pattern
- Comprehensive integration tests
- E2E test coverage
- SOAP integration tests
- CI/CD ready configuration
