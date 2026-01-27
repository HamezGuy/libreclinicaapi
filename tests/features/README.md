# LibreClinica Features Tests

This directory contains comprehensive tests for all LibreClinica features that have been integrated into the EDC system.

## Test Files

| File | Description | Type |
|------|-------------|------|
| `libreclinica-features.integration.test.ts` | Full integration tests for all features | Integration |
| `skip-logic.service.test.ts` | Unit tests for skip logic (scd_item_metadata) | Unit |
| `validation-rules.service.test.ts` | Unit tests for rules engine | Unit |
| `export.service.test.ts` | Unit tests for CDISC/ODM export | Unit |
| `e2e-full-flow.integration.test.ts` | E2E tests for complete workflow | E2E |

## Features Tested

### 1. Response Types (1-10)

All LibreClinica response types are tested:

| ID | Type | Description |
|----|------|-------------|
| 1 | Text | Basic text input |
| 2 | Textarea | Multi-line text |
| 3 | Checkbox | Boolean checkbox |
| 4 | File Upload | Document/image upload |
| 5 | Radio | Single selection (radio buttons) |
| 6 | Single-Select | Dropdown selection |
| 7 | Multi-Select | Multiple selection |
| 8 | Calculation | Auto-calculated field (BMI, age, etc.) |
| 9 | Group Calculation | Calculation across repeating groups |
| 10 | Barcode/Instant | Barcode/QR code scanner |

### 2. Skip Logic (scd_item_metadata)

Tests for conditional display logic using LibreClinica's native tables:
- `scd_item_metadata` - Stores skip logic conditions
- `dyn_item_form_metadata` - Runtime visibility state

**Test Cases:**
- Create form with skip logic conditions
- Store conditions in scd_item_metadata
- Retrieve and parse conditions correctly
- Support multiple conditions per field

### 3. Rules Engine (rule, rule_expression, rule_action)

Tests for validation rules using LibreClinica's native rule tables:
- `rule` - Rule definitions
- `rule_expression` - Rule expressions/formulas
- `rule_action` - Actions to take when rule triggers
- `rule_set` / `rule_set_rule` - Rule grouping

**Test Cases:**
- Combine custom rules with native LibreClinica rules
- Validate form data against all rule types
- Support different severity levels (error/warning)
- CRUD operations for validation rules

### 4. File Uploads (crf_version_media)

Tests for file upload integration:
- `crf_version_media` - File metadata storage
- Response type 4 mapping

**Test Cases:**
- Insert file metadata correctly
- Retrieve file information
- Validate file types and sizes

### 5. Forking/Branching (decision_condition)

Tests for form branching using:
- `decision_condition` - Branch definitions
- `dc_primitive` - Condition primitives
- `dc_event` - Branch events
- `dc_section_event` - Section visibility
- `dc_computed_event` - Computed values
- `dc_substitution_event` - Value substitution

### 6. CDISC/ODM Export (dataset_* tables)

Tests for data export using:
- `dataset` - Export configuration
- `dataset_crf_version_map` - CRF selection
- `archived_dataset_file` - Export history

**Test Cases:**
- Create dataset configurations
- Generate ODM XML export
- Generate CSV export
- Archive exported files

## Running Tests

### Run all feature tests:
```bash
npm run test:features
```

### Run specific test suites:
```bash
# Integration tests
npm run test:features:integration

# Skip logic tests
npm run test:features:skip-logic

# Validation rules tests
npm run test:features:validation

# Export tests
npm run test:features:export

# E2E flow tests
npm run test:features:e2e

# All with coverage
npm run test:libreclinica:all
```

## Prerequisites

1. **Database**: PostgreSQL with LibreClinica schema
2. **Environment**: Set `DATABASE_URL` or use default connection
3. **LibreClinica**: Running instance (for real integration tests)

## Environment Variables

```env
# Database connection
DATABASE_URL=postgresql://libreclinica:libreclinica@localhost:5434/libreclinica

# Test configuration
TEST_TIMEOUT=60000
```

## Test Data Cleanup

Tests automatically clean up created data in `afterAll` hooks. If tests fail, you may need to manually clean up:

```sql
-- Clean up test CRFs
DELETE FROM crf WHERE name LIKE 'E2E Test%';
DELETE FROM crf WHERE name LIKE 'Test Form%';
```

## Coverage

Tests aim for coverage of:
- ✅ All 10 response types
- ✅ Skip logic creation and retrieval
- ✅ Validation rule execution
- ✅ File upload metadata storage
- ✅ Export in multiple formats
- ✅ Full CRUD lifecycle

## Frontend Tests

Frontend tests are in:
`ElectronicDataCaptureReal/src/app/components/template-creation-modal/template-creation-modal.component.spec.ts`

Run with Angular CLI:
```bash
cd ElectronicDataCaptureReal
ng test --include='**/template-creation-modal.component.spec.ts'
```

