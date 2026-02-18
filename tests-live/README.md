# EDC Live Server Test Suite

End-to-end test scripts that run against a **live** EDC server to verify the full clinical trial workflow — from organization registration through patient data entry and query generation.

---

## Quick Start

```bash
cd tests-live
npm install

# (Optional) Edit .env to change the target server URL
# Default: https://api.accuratrials.com/api

# Run the full test suite
npx ts-node scripts/run-all.ts

# Or run an individual script
npx ts-node scripts/03-create-base-ecrfs.ts
```

---

## Where Errors Are Logged

| Location | Contents |
|---|---|
| **`tests-live/logs/test-errors.json`** | Every API failure is appended here as a JSON line with timestamp, script name, endpoint, status code, request body, and response body. **This is the primary error log.** |
| **Console output** | Color-coded `[PASS]` / `[FAIL]` / `[WARN]` indicators printed to stdout during execution. |
| **`tests-live/state/state.json`** | Persisted IDs (org, users, CRFs, study, patient) so scripts can be re-run individually. |

### Error Log Format

Each line in `logs/test-errors.json` is a JSON object:

```json
{
  "timestamp": "2026-02-17T14:30:00.000Z",
  "script": "03-create-base-ecrfs",
  "step": "Create eCRF 1 - General Assessment Form",
  "endpoint": "POST /api/forms",
  "status": 400,
  "error": "Validation failed: name is required",
  "requestBody": { "..." },
  "responseBody": { "..." }
}
```

---

## Scripts (Execution Order)

| # | Script | Purpose |
|---|---|---|
| 00 | `00-register-organization.ts` | Register a new organization + admin user. Tries `jamesgui111@gmail.com`, then 222, 333. |
| 01 | `01-create-members.ts` | Create 2 org members: a **coordinator** and a **monitor** with different permissions. |
| 02 | `02-login-admin.ts` | Login as the admin user, refresh JWT token in state. |
| 03 | `03-create-base-ecrfs.ts` | Create 2 base eCRF templates: one with normal fields (radio, yes/no, multiselect) and one with advanced fields (tables, criteria lists, calculations). |
| 04 | `04-fork-ecrfs-validation.ts` | Fork both base eCRFs with "- Validation" suffix (for validation rule testing). |
| 05 | `05-fork-ecrfs-workflow.ts` | Fork both base eCRFs with "- Workflow" suffix (for workflow/query testing). |
| 06 | `06-create-study.ts` | Create a fully populated study with 2 sites, 3 visits (Screening/Baseline/Follow-Up), all 6 eCRFs assigned to every visit. |
| 07 | `07-create-validation-rules.ts` | Add validation rules (range, required, format) to the 4 validation + workflow eCRFs. |
| 08 | `08-setup-workflows.ts` | Configure SDV, signatures, DDE, and query routing on the 2 workflow eCRFs. |
| 09 | `09-create-patient.ts` | Enroll a patient (SUBJ-001) with full demographics, schedule the Screening Visit. |
| 10 | `10-fill-forms-and-test.ts` | Fill forms with valid data, then invalid data; check for validation errors and workflow queries. |
| 11 | `11-branching-ecrf-test.ts` | Create a form with extensive skip-logic (branching by study type, nested AE/SAE, pregnancy screening, conditional lab tables). Fork it and verify SCD records are preserved. Test data entry with 3 different answer paths. |

---

## What Gets Created

After a full run, the following entities exist on the server:

- **1 Organization** (AccuraTrial Test Org)
- **3 Users**: 1 admin, 1 coordinator, 1 monitor
- **6 eCRF Templates**:
  - General Assessment Form (base)
  - Lab Results & Procedures Form (base)
  - General Assessment Form - Validation
  - Lab Results & Procedures Form - Validation
  - General Assessment Form - Workflow
  - Lab Results & Procedures Form - Workflow
- **1 Study** with 2 sites and 3 visits
- **14 Validation Rules** across the validation + workflow eCRFs
- **Workflow Config** on the 2 workflow eCRFs (SDV, signatures, query routing)
- **1 Patient** enrolled with scheduled visits
- **Form Data** submitted for all 6 eCRFs (valid + invalid attempts)
- **1 Branching eCRF** with 22 fields (17 with showWhen skip-logic conditions across 4 branching trees)

---

## Configuration

Edit `.env` to customize:

```env
BASE_URL=https://api.accuratrials.com/api
ADMIN_EMAIL=jamesgui111@gmail.com
ADMIN_PASSWORD=Leagueoflegends111@
ADMIN_EMAIL_2=jamesgui222@gmail.com
ADMIN_EMAIL_3=jamesgui333@gmail.com
```

---

## Re-running Scripts

Scripts are idempotent where possible:
- **Registration** (00) will skip to the next email if the current one already exists.
- **Login** (02) can be re-run anytime to refresh the token.
- **All other scripts** depend on state from previous scripts. Run `run-all.ts` for a clean pass, or delete `state/state.json` to start fresh.

---

## Known Server-Side Issues Discovered by This Suite

These bugs were found and documented during test execution. Fixes have been applied to the codebase but require deployment to the Lightsail server.

| Issue | Affected Scripts | Root Cause | Fix Applied |
|---|---|---|---|
| **Fork fails: `item_group.crf_id` NOT NULL** | 04, 05, 11 | `forkForm()` in `form.service.ts` didn't include `crf_id` in the `item_group` INSERT | `form.service.ts`: added `crf_id` to INSERT in both `forkForm()` and `createFormVersion()` |
| **Fork doesn't copy skip logic (SCD records)** | 11 | `forkForm()` was missing the step to copy `scd_item_metadata` records | `form.service.ts`: added Step 9 to copy SCD records with proper `item_form_metadata_id` remapping |
| **Study creation: `study_acronym` column missing** | 06 | The `study` table on the server predates the column being added. `CREATE TABLE IF NOT EXISTS` won't add new columns. | `migrations.ts`: added `createStudyExtendedColumns` migration with ALTER TABLE for 13 columns |
| **Validation rules: `format_type` column missing** | 07 | Same issue — table was created before the column was added | `migrations.ts` + `validation-rules.service.ts`: added ALTER TABLE IF NOT EXISTS in both migration and initialization |
| **No middleware validation for form creation** | (all form creates) | `POST /api/forms` had no Joi schema validation | `validation.middleware.ts`: added `formSchemas.create`; `form.routes.ts`: wired it into the route |

Scripts 04/05 include an automatic fallback: if fork fails, they create the form from scratch with the same field definitions.

---

## Credentials

| User | Username | Password | Role |
|---|---|---|---|
| Admin | `jamesgui111` (or 222/333) | `Leagueoflegends111@` | admin |
| Coordinator | `testcoordinator1` | `CoordinatorPass1@` | coordinator |
| Monitor | `testmonitor1` | `MonitorPass1@@@` | monitor |
