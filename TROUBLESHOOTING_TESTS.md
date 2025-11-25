# Test Troubleshooting Guide

## Quick Diagnosis

### Run Verification Script

```bash
TEST_RUNNER_VERIFICATION.bat
```

This will check:
1. Node.js installation
2. npm installation
3. PostgreSQL connection
4. Dependencies
5. Basic test functionality

## Common Issues and Solutions

### Issue 1: "Cannot find module" Errors

**Symptoms:**
```
Error: Cannot find module '../src/app'
Error: Cannot find module './utils/test-db'
```

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules
npm install

# Rebuild TypeScript
npm run build
```

### Issue 2: Database Connection Failures

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
Error: password authentication failed for user "clinica"
```

**Solution:**

1. **Check PostgreSQL is running:**
   ```bash
   # Windows
   sc query postgresql-x64-13
   
   # Or check if port is listening
   netstat -an | findstr :5432
   ```

2. **Verify connection manually:**
   ```bash
   psql -U clinica -d libreclinica -c "SELECT 1"
   ```

3. **Check .env file:**
   ```env
   LIBRECLINICA_DB_HOST=localhost
   LIBRECLINICA_DB_PORT=5432
   LIBRECLINICA_DB_NAME=libreclinica
   LIBRECLINICA_DB_USER=clinica
   LIBRECLINICA_DB_PASSWORD=clinica
   ```

4. **Create database if missing:**
   ```bash
   psql -U postgres
   CREATE DATABASE libreclinica;
   CREATE USER clinica WITH PASSWORD 'clinica';
   GRANT ALL PRIVILEGES ON DATABASE libreclinica TO clinica;
   \q
   ```

### Issue 3: Test Database Not Created

**Symptoms:**
```
Error: database "libreclinica_test" does not exist
```

**Solution:**

The test database is created automatically by global-setup.ts. If it fails:

```bash
# Create manually
psql -U clinica -d postgres
CREATE DATABASE libreclinica_test;
\q

# Or drop and let tests recreate
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"
npm test
```

### Issue 4: "pool is not defined" Errors

**Symptoms:**
```
ReferenceError: pool is not defined
```

**Solution:**

This means test files haven't been updated to use `testDb`. Check:

```typescript
// OLD (wrong):
import { pool } from '../src/config/database';
await pool.query('SELECT 1');

// NEW (correct):
import { testDb } from './utils/test-db';
await testDb.query('SELECT 1');
```

### Issue 5: Tests Timeout

**Symptoms:**
```
Timeout - Async callback was not invoked within the 30000 ms timeout
```

**Solution:**

1. **Increase timeout in jest.config.js:**
   ```javascript
   testTimeout: 60000, // 60 seconds
   ```

2. **Check for hanging database connections:**
   ```sql
   -- In PostgreSQL
   SELECT * FROM pg_stat_activity WHERE datname = 'libreclinica_test';
   
   -- Kill hanging connections
   SELECT pg_terminate_backend(pid) 
   FROM pg_stat_activity 
   WHERE datname = 'libreclinica_test' AND pid <> pg_backend_pid();
   ```

3. **Ensure proper cleanup:**
   ```typescript
   afterAll(async () => {
     // Don't call pool.end() or testDb.disconnect()
     // Global teardown handles this
   });
   ```

### Issue 6: SOAP Service Unavailable

**Symptoms:**
```
Error: SOAP service unavailable
Error: connect ECONNREFUSED 127.0.0.1:8080
```

**Solution:**

1. **Check LibreClinica is running:**
   ```bash
   curl http://localhost:8080/LibreClinica/
   ```

2. **Start LibreClinica:**
   ```bash
   # Navigate to LibreClinica directory
   cd D:\EDC-Projects\LibreClinica-Setup\LibreClinica
   
   # Start Tomcat
   .\apache-tomcat\bin\startup.bat
   ```

3. **Skip SOAP tests if LibreClinica not needed:**
   ```bash
   npm run test:unit  # Only unit tests
   npm run test:api   # API tests without SOAP
   ```

### Issue 7: Permission Denied Errors

**Symptoms:**
```
Error: permission denied for table user_account
```

**Solution:**

```sql
-- Grant permissions to test user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO clinica;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO clinica;

-- Or connect as superuser
ALTER USER clinica WITH SUPERUSER;
```

### Issue 8: Tests Pass Individually But Fail Together

**Symptoms:**
- Individual tests pass: `npx jest tests/api.test.ts` ✓
- Full suite fails: `npm test` ✗

**Solution:**

This is usually due to shared state. Ensure:

1. **Database cleanup between tests:**
   ```typescript
   beforeEach(async () => {
     await testDb.cleanDatabase();
     await testDb.seedTestData();
   });
   ```

2. **No global variables:**
   ```typescript
   // BAD
   let authToken = 'xyz';
   
   // GOOD
   let authToken: string;
   beforeAll(async () => {
     const response = await login();
     authToken = response.body.accessToken;
   });
   ```

3. **Run tests serially:**
   ```bash
   npm test -- --runInBand
   ```

### Issue 9: Coverage Reports Not Generated

**Symptoms:**
```
No coverage directory created
Coverage report empty
```

**Solution:**

1. **Ensure jest.config.js has coverage settings:**
   ```javascript
   collectCoverageFrom: [
     'src/**/*.ts',
     '!src/**/*.d.ts',
     '!src/types/**',
   ],
   coverageDirectory: 'coverage',
   ```

2. **Run with coverage flag:**
   ```bash
   npm test -- --coverage
   ```

3. **Check file permissions:**
   ```bash
   # Ensure coverage directory is writable
   mkdir coverage
   ```

### Issue 10: Authentication Fails in Tests

**Symptoms:**
```
Error: Invalid credentials
Error: User not found
```

**Solution:**

1. **Ensure test database is seeded:**
   ```typescript
   // In global-setup.ts
   await testPool.query(`
     INSERT INTO user_account (user_name, passwd, email)
     VALUES ('root', '$2b$10$...', 'root@example.com')
     ON CONFLICT (user_name) DO NOTHING;
   `);
   ```

2. **Check password hashing:**
   ```javascript
   const bcrypt = require('bcrypt');
   const hash = await bcrypt.hash('root', 10);
   console.log('Password hash:', hash);
   ```

3. **Verify login endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"root","password":"root"}'
   ```

## Debugging Tips

### Enable Verbose Logging

```bash
# Run with verbose output
npm test -- --verbose

# Run specific test with debugging
npx jest tests/api.test.ts -t "should login" --verbose
```

### Inspect Test Database

```bash
# Connect to test database
psql -U clinica -d libreclinica_test

# List tables
\dt

# Check data
SELECT * FROM user_account;
SELECT * FROM study;
SELECT * FROM audit_log_event ORDER BY audit_date DESC LIMIT 10;

# Exit
\q
```

### Check Environment Variables

```javascript
// Add to test file
console.log('DB Name:', process.env.LIBRECLINICA_DB_NAME);
console.log('DB Host:', process.env.LIBRECLINICA_DB_HOST);
console.log('NODE_ENV:', process.env.NODE_ENV);
```

### Run Single Test

```bash
# Run one test file
npx jest tests/api.test.ts

# Run one test suite
npx jest tests/api.test.ts -t "Health Check"

# Run one specific test
npx jest tests/api.test.ts -t "should return healthy status"
```

### Check for Port Conflicts

```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000

# Check if port 5432 is in use
netstat -ano | findstr :5432

# Kill process if needed
taskkill /PID <pid> /F
```

## Clean Slate

If all else fails, start fresh:

```bash
# 1. Drop test database
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"

# 2. Remove node_modules
rm -rf node_modules
rm package-lock.json

# 3. Reinstall
npm install

# 4. Run tests
npm test
```

## Getting Help

### Collect Diagnostic Information

```bash
# Node version
node --version

# npm version
npm --version

# PostgreSQL version
psql --version

# Check database
psql -U clinica -d libreclinica -c "SELECT version();"

# List databases
psql -U clinica -l

# Environment
echo %NODE_ENV%
```

### Test Output

Save test output for review:

```bash
npm test > test-output.txt 2>&1
```

### Database State

Export database state:

```bash
pg_dump -U clinica libreclinica_test > test-db-dump.sql
```

## Prevention

### Before Running Tests

1. ✅ PostgreSQL is running
2. ✅ LibreClinica database exists
3. ✅ .env file is configured
4. ✅ Dependencies are installed
5. ✅ No other tests are running

### Best Practices

1. **Always run tests serially** (`--runInBand`)
2. **Clean database between tests** (`beforeEach`)
3. **Don't close connections in tests** (global teardown handles it)
4. **Use testDb, not pool** in test files
5. **Await all async operations**
6. **Check test output carefully**

## Quick Reference

```bash
# Verify setup
TEST_RUNNER_VERIFICATION.bat

# Run all tests
npm test

# Run specific suite
npm run test:e2e
npm run test:soap
npm run test:integration

# Debug single test
npx jest tests/api.test.ts -t "Health Check" --verbose

# Check database
psql -U clinica -d libreclinica_test

# Clean start
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"
npm test
```

## Still Having Issues?

1. Review `TESTING_GUIDE.md` for detailed documentation
2. Check `TEST_IMPLEMENTATION_SUMMARY.md` for architecture details
3. Examine test files for examples
4. Verify environment configuration in `.env`
5. Check PostgreSQL logs for database errors
6. Review LibreClinica logs for SOAP errors
