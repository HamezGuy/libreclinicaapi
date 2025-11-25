# LibreClinica API - Test Suite

## 🎯 Quick Start

```bash
# Run all tests
npm test

# Or use the batch file
RUN_TESTS.bat
```

## ✅ What's Been Fixed

All unit tests have been completely fixed and enhanced with:

1. **Singleton Test Database** - Single PostgreSQL instance for all tests
2. **End-to-End Tests** - Complete UI → API → Database verification
3. **SOAP Integration Tests** - Full SOAP web service testing
4. **Fixed Existing Tests** - All `pool` references replaced with `testDb`
5. **Comprehensive Documentation** - Multiple guides for different needs

## 📁 Test Files

### Core Test Infrastructure
- `tests/setup/global-setup.ts` - Creates test database once
- `tests/setup/global-teardown.ts` - Cleanup after all tests
- `tests/setup/setup-after-env.ts` - Per-test-file setup
- `tests/utils/test-db.ts` - Singleton database manager

### Test Suites
- `tests/api.test.ts` - API endpoint tests ✅ FIXED
- `tests/integration.test.ts` - API-to-Database tests ✅ FIXED
- `tests/e2e-integration.test.ts` - UI-to-Database tests ✅ NEW
- `tests/soap-integration.test.ts` - SOAP integration tests ✅ NEW
- `tests/*.service.test.ts` - Service unit tests

### Helper Scripts
- `RUN_TESTS.bat` - Easy test execution
- `TEST_RUNNER_VERIFICATION.bat` - Setup verification

## 📚 Documentation

- **TESTS_FIXED_SUMMARY.md** - Complete summary of all fixes
- **TESTING_GUIDE.md** - Comprehensive testing guide
- **QUICK_TEST_REFERENCE.md** - Quick reference
- **TROUBLESHOOTING_TESTS.md** - Troubleshooting guide
- **TEST_IMPLEMENTATION_SUMMARY.md** - Technical details

## 🚀 Running Tests

### All Tests
```bash
npm test
```

### Specific Suites
```bash
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e          # End-to-end tests
npm run test:soap         # SOAP tests
npm run test:api          # API tests
```

### Verification
```bash
TEST_RUNNER_VERIFICATION.bat
```

## 🔧 Prerequisites

1. **PostgreSQL** - Running on localhost:5432
2. **LibreClinica Database** - `libreclinica` database exists
3. **Node.js** - v18 or higher
4. **Dependencies** - Run `npm install`

## 📊 Test Coverage

Tests verify the complete flow:

```
Angular UI (ElectronicDataCaptureReal)
    ↓ HTTP Requests
REST API (libreclinica-api)
    ↓ SOAP Calls
LibreClinica SOAP Services
    ↓ Database Queries
PostgreSQL Database
    ↓ Verification
✅ Test Assertions
```

## 🎯 What Gets Tested

- ✅ User management (create, update, delete)
- ✅ Study management (create, update, status)
- ✅ Subject enrollment
- ✅ Form data entry
- ✅ SOAP authentication
- ✅ SOAP operations (studies, subjects, forms)
- ✅ Audit trail logging
- ✅ Data consistency
- ✅ Concurrent operations

## 🔍 Test Database

- **Name:** `libreclinica_test` (automatically created)
- **Cleanup:** Automatic between test files
- **Seeding:** Automatic with test data
- **Inspection:** `psql -U clinica -d libreclinica_test`

## 🆘 Troubleshooting

See `TROUBLESHOOTING_TESTS.md` for:
- Common issues and solutions
- Debugging tips
- Clean slate procedures

### Quick Fixes

```bash
# Database connection issues
pg_isready
psql -U clinica -d libreclinica -c "SELECT 1"

# Reset test database
psql -U clinica -c "DROP DATABASE IF EXISTS libreclinica_test;"
npm test

# Reinstall dependencies
rm -rf node_modules
npm install
```

## 📈 Coverage Thresholds

- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

## 🎉 Success Criteria

✅ Singleton database for all tests  
✅ UI → API → Database integration verified  
✅ SOAP web services tested  
✅ Audit trails validated  
✅ 70% code coverage  
✅ CI/CD ready  
✅ Comprehensive documentation  

## 📞 Support

For detailed information:
1. **TESTS_FIXED_SUMMARY.md** - Start here
2. **TESTING_GUIDE.md** - Comprehensive guide
3. **TROUBLESHOOTING_TESTS.md** - Problem solving
4. Test files themselves - Examples and patterns

---

**Ready to test?** Run `npm test` or `RUN_TESTS.bat`
