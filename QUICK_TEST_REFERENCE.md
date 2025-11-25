# Quick Test Reference

## Run Tests

```bash
# All tests with coverage
npm test

# Specific test suites
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e          # End-to-end tests (UI → API → DB)
npm run test:soap         # SOAP integration tests
npm run test:api          # API endpoint tests

# Watch mode
npm run test:watch

# Or use batch file
RUN_TESTS.bat             # All tests
RUN_TESTS.bat e2e         # E2E tests only
RUN_TESTS.bat soap        # SOAP tests only
```

## Test Database

```bash
# Test database is automatically created as: libreclinica_test

# Connect to test database
psql -U clinica -d libreclinica_test

# View test data
SELECT * FROM user_account;
SELECT * FROM study;
SELECT * FROM study_subject;
SELECT * FROM audit_log_event ORDER BY audit_date DESC LIMIT 10;

# Drop test database (will be recreated on next test run)
psql -U clinica -c "DROP DATABASE libreclinica_test;"
```

## Test Structure

```
tests/
├── setup/
│   ├── global-setup.ts          # Creates test DB (runs once)
│   ├── global-teardown.ts       # Cleanup (runs once)
│   └── setup-after-env.ts       # Per-file setup
├── utils/
│   └── test-db.ts               # Singleton DB manager
├── api.test.ts                  # API endpoint tests
├── integration.test.ts          # API-to-DB tests
├── e2e-integration.test.ts      # UI-to-DB tests ⭐
├── soap-integration.test.ts     # SOAP tests ⭐
└── *.service.test.ts            # Service unit tests
```

## Key Test Files

### E2E Tests (UI → API → Database)
**File:** `tests/e2e-integration.test.ts`

Tests complete flow from Angular UI to database:
- User management (create, update)
- Study management (create, update status)
- Subject enrollment
- Form data entry
- Concurrent operations
- Audit trail verification

### SOAP Integration Tests
**File:** `tests/soap-integration.test.ts`

Tests SOAP web service integration:
- SOAP authentication
- Study operations via SOAP
- Subject operations via SOAP
- Form data via SOAP
- Error handling
- Data synchronization

## Common Test Patterns

### Test with Database Verification

```typescript
it('should create user and verify in database', async () => {
  // Make API call
  const response = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ username: 'test', email: 'test@example.com' });

  expect(response.status).toBe(201);

  // Verify in database
  const dbResult = await testDb.query(
    'SELECT * FROM user_account WHERE user_name = $1',
    ['test']
  );

  expect(dbResult.rows.length).toBe(1);
  expect(dbResult.rows[0].email).toBe('test@example.com');
});
```

### Test with Audit Trail Verification

```typescript
it('should log changes in audit trail', async () => {
  // Make API call
  const response = await request(app)
    .post('/api/subjects')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ studyId: 1, label: 'SUBJ-001' });

  const subjectId = response.body.subjectId;

  // Verify audit trail
  const auditResult = await testDb.query(
    'SELECT * FROM audit_log_event WHERE entity_id = $1',
    [subjectId]
  );

  expect(auditResult.rows.length).toBeGreaterThan(0);
  expect(auditResult.rows[0].action_message).toContain('enrolled');
});
```

## Troubleshooting

### Tests Failing?

```bash
# 1. Check PostgreSQL is running
pg_isready

# 2. Check database exists
psql -U clinica -l | grep libreclinica

# 3. Run with verbose output
npm run test:all

# 4. Run single test
npx jest tests/e2e-integration.test.ts -t "should create user"

# 5. Check test database state
psql -U clinica -d libreclinica_test
\dt  # List tables
SELECT * FROM user_account;
```

### Database Connection Issues?

```bash
# Check connection string in .env
LIBRECLINICA_DB_HOST=localhost
LIBRECLINICA_DB_PORT=5432
LIBRECLINICA_DB_NAME=libreclinica
LIBRECLINICA_DB_USER=clinica
LIBRECLINICA_DB_PASSWORD=clinica

# Test connection
psql -U clinica -d libreclinica -c "SELECT 1"
```

### SOAP Service Issues?

```bash
# Check SOAP URL in .env
LIBRECLINICA_SOAP_URL=http://localhost:8080/LibreClinica/ws

# Check LibreClinica is running
curl http://localhost:8080/LibreClinica/
```

## Coverage Reports

```bash
# After running tests, view coverage:
# Open: coverage/index.html

# Coverage thresholds (70% minimum):
- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%
```

## Test Data

### Default Test User
```
Username: root
Password: root
```

### Test Database Tables
- `user_account` - Users
- `study` - Studies
- `study_subject` - Enrolled subjects
- `audit_log_event` - Audit trail
- `study_user_role` - User-study assignments

## Quick Commands

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run E2E tests (most important)
npm run test:e2e

# Run SOAP tests
npm run test:soap

# Watch mode for development
npm run test:watch

# Clean and run tests
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"
npm test

# View coverage
start coverage/index.html  # Windows
open coverage/index.html   # Mac
```

## What Gets Tested

✅ **User Management**
- Create user from UI → API → Database
- Update user data
- Password hashing
- Audit trail

✅ **Study Management**
- Create study from UI → API → Database
- Update study status
- Metadata via SOAP
- Database persistence

✅ **Subject Enrollment**
- Enroll subject from UI → API → Database
- Update subject data
- Enrollment tracking
- Audit trail

✅ **Form Data Entry**
- Submit form data from UI → API → Database
- Data validation
- SOAP submission
- Audit logging

✅ **SOAP Integration**
- Authentication via SOAP
- Study operations via SOAP
- Subject operations via SOAP
- Form data via SOAP
- Error handling

✅ **Concurrent Operations**
- Multiple simultaneous requests
- Data consistency
- No race conditions

## Documentation

- **TESTING_GUIDE.md** - Comprehensive testing guide
- **TEST_IMPLEMENTATION_SUMMARY.md** - Implementation details
- **QUICK_TEST_REFERENCE.md** - This file (quick reference)

## Support

For detailed information, see:
- `TESTING_GUIDE.md` - Full testing documentation
- `TEST_IMPLEMENTATION_SUMMARY.md` - Implementation details
- Test files in `tests/` directory for examples
