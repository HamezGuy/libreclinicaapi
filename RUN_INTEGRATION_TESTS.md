# Running the Integration Tests

## Prerequisites

Before running the tests, ensure the following are running:

1. **LibreClinica Docker containers** (uses memory: [[memory:11706419]])
   ```bash
   cd libreclinica-api
   docker-compose -f docker-compose.libreclinica.yml up -d
   ```

2. **API Server**
   ```bash
   cd libreclinica-api
   npm run dev
   ```

## Test Commands

### Individual Test Suites

```bash
# Patient Management E2E Tests
npm run test:patient:e2e

# Randomization E2E Tests
npm run test:randomization:e2e

# Workflow/Tasks E2E Tests
npm run test:workflow:e2e

# Frontend-to-Database Comprehensive Tests
npm run test:frontend-to-db
```

### Full Integration Test Suite

```bash
# Run all integration tests
npm run test:full-integration
```

## Test Coverage

### Randomization Tests (`randomization-e2e.integration.test.ts`)
- RAND-001: Get Randomization List
- RAND-002: Get Treatment Groups
- RAND-003: Get Randomization Statistics
- RAND-004: Check Randomization Eligibility
- RAND-005: Create Randomization
- RAND-006: Get Subject Randomization Info
- RAND-007: Unblinding Events
- RAND-008: Unblind Subject
- RAND-009: Remove Randomization
- RAND-010: Database Integrity
- RAND-011: Response Format Compatibility

### Workflow Tests (`workflow-e2e.integration.test.ts`)
- WF-001: Get All Workflows
- WF-002: Get User Workflows
- WF-003: Get User Task Summary
- WF-004: Create Workflow
- WF-005: Update Workflow Status
- WF-006: Complete Workflow
- WF-007: Approve Workflow
- WF-008: Reject Workflow
- WF-009: Handoff Workflow
- WF-010: Database Integrity
- WF-011: Response Format Compatibility

### Frontend-to-DB Tests (`frontend-to-db.integration.test.ts`)
- FULL-001: Complete Randomization Workflow
- FULL-002: Complete Tasks/Workflow Management
- FULL-003: Complete Patient Enrollment Workflow
- FULL-004: Data Integrity & Audit Trail
- FULL-005: Error Handling & Edge Cases
- FULL-006: Performance Baseline

## Frontend Changes Made

### Randomization Dashboard (`randomization-dashboard.component.ts`)
- Added study selection dropdown (auto-loads available studies)
- Added eligible subjects loader for randomization
- Added randomization form to enroll subjects in treatment groups
- Improved error handling and loading states
- Fixed hardcoded `currentStudyId = 1` to use dynamic selection

### My Tasks Component (`my-tasks.component.ts`)
- Updated to work with new `TaskSummaryWithTasks` interface
- Added proper task organization (overdue, dueToday, inProgress, pending)
- Improved error handling and empty state management
- Added refresh functionality

### Workflow Service (`libreclinica-workflow.service.ts`)
- Added `TaskSummaryWithTasks` interface for organized task arrays
- Updated response mapping for proper frontend compatibility

## Backend Changes Made

### Workflow Controller (`workflow.controller.ts`)
- Updated `getUserTaskSummary` to return organized task arrays
- Added due date calculation based on creation date
- Added priority calculation based on due date
- Added `completedToday` and `completedThisWeek` statistics
- Returns tasks organized by: overdue, dueToday, inProgress, pending

## Database Tables Used

- `study_subject` - Patient records
- `subject` - Subject demographic info
- `subject_group_map` - Randomization assignments
- `study_group` - Treatment groups
- `study_group_class` - Treatment group classifications
- `discrepancy_note` - Workflow tasks (queries)
- `resolution_status` - Workflow status types
- `discrepancy_note_type` - Workflow task types
- `audit_log_event` - Audit trail (Part 11 compliance)

## Troubleshooting

### Tests Fail with Authentication Error
- Ensure LibreClinica Docker containers are running
- Default credentials: `root` / `12345678`
- API must be running on port 3001

### No Treatment Groups Found
- Create treatment groups in LibreClinica admin UI
- Study must have `study_group_class` with `study_group` entries

### No Eligible Subjects
- Create subjects via API or LibreClinica UI
- Subjects must have `status_id = 1` (available)
- Subjects must not be already randomized

