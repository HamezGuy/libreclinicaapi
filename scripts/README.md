# LibreClinica API - Demo & Testing Scripts

This folder contains scripts for setting up and testing the LibreClinica API demo environment.

## Prerequisites

1. **Docker** - Required for running the PostgreSQL database
2. **Node.js** - Required for running the API server
3. **PowerShell** - Required for running the test scripts (Windows)

## Quick Start

### 1. Start the Database

```bash
# From the libreclinica-api directory
docker-compose -f docker-compose.test.yml up -d
```

### 2. Setup Demo Database

The demo database needs reference data (item types, status codes, etc.) to function properly:

```powershell
# Run the setup script
Get-Content scripts/setup-demo-database.sql | docker exec -i api-test-db psql -U clinica -d libreclinica_test
```

### 3. Start the API Server

```powershell
# Set environment variables
$env:LIBRECLINICA_DB_HOST = "localhost"
$env:LIBRECLINICA_DB_PORT = "5433"
$env:LIBRECLINICA_DB_NAME = "libreclinica_test"
$env:LIBRECLINICA_DB_USER = "clinica"
$env:LIBRECLINICA_DB_PASSWORD = "clinica"
$env:DISABLE_SOAP = "true"
$env:DEMO_MODE = "true"
$env:PORT = "3001"

# Start the server
npm run dev
```

### 4. Run the Integration Test

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-complete-workflow.ps1
```

Or use the all-in-one runner:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-demo-test.ps1
```

## Scripts

### `setup-demo-database.sql`

SQL script that populates all required reference tables:
- `status` - Entity status codes
- `item_data_type` - Form field data types (text, integer, date, etc.)
- `response_type` - Form field response types (text input, radio, checkbox, etc.)
- `discrepancy_note_type` - Query/discrepancy types
- `resolution_status` - Query resolution status codes
- `subject_event_status` - Event status codes
- `completion_status` - CRF completion status codes
- `user_account` - Demo users (root, coordinator, investigator, etc.)
- `user_role` - User role definitions

### `test-complete-workflow.ps1`

Comprehensive integration test that validates the entire EDC workflow:

1. **Authentication** - Login as root admin
2. **Study Creation** - Create a new clinical study
3. **Form Creation** - Create form templates with fields and validation rules
4. **Phase Creation** - Create study phases (events)
5. **Form Assignment** - Assign forms to phases
6. **Patient Creation** - Create a subject and assign to study
7. **Event Verification** - Verify patient has scheduled events
8. **Validation Rules** - Create custom validation rules
9. **Form Submission** - Submit form data (with validation errors)
10. **Query Generation** - Verify queries are created from validation failures
11. **Query Resolution** - Respond to and resolve queries
12. **Valid Data Submission** - Submit valid form data

### `run-demo-test.ps1`

All-in-one script that:
1. Checks Docker database container
2. Sets up demo database
3. Starts API server (if not running)
4. Runs integration tests

## Test Parameters

The test script accepts the following parameters:

```powershell
.\test-complete-workflow.ps1 -BaseUrl "http://localhost:3001/api" -Verbose
```

- `-BaseUrl` - API base URL (default: `http://localhost:3001/api`)
- `-Verbose` - Show detailed API call information

## Expected Output

A successful test run will show:

```
============================================
  TEST SUMMARY
============================================

  Created Resources:
    Study ID:            9
    Screening Form ID:   13
    Vital Signs Form ID: 14
    Screening Phase ID:  11
    Treatment Phase ID:  12
    Subject ID:          6
    Subject Label:       SUBJ-20251216143812

  Workflow Status:
    All core components created successfully!
```

## Troubleshooting

### Rate Limiting

If you see "Too many login attempts", wait 15 minutes or restart the API server.

### Database Connection

Ensure the Docker container is running:
```bash
docker ps --filter "name=api-test-db"
```

### Missing Reference Data

Re-run the setup script:
```powershell
Get-Content scripts/setup-demo-database.sql | docker exec -i api-test-db psql -U clinica -d libreclinica_test
```

## API Endpoints Tested

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | User authentication |
| `/studies` | POST | Create study |
| `/forms` | POST | Create form template |
| `/events` | POST | Create study phase |
| `/events/:id/crfs` | POST | Assign form to phase |
| `/subjects` | POST | Create patient |
| `/subjects/:id/events` | GET | Get patient events |
| `/validation-rules` | POST | Create validation rule |
| `/forms/save` | POST | Submit form data |
| `/queries` | GET | List queries |
| `/queries/:id/respond` | POST | Add query response |
| `/queries/:id/status` | PUT | Update query status |

