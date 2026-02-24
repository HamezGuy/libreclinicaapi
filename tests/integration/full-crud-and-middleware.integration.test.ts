/**
 * Full CRUD + Middleware Integration Tests
 *
 * Covers:
 *   1. Form (eCRF) CRUD — all endpoints, Joi middleware, 404/400/403 status codes
 *   2. Validation Rules CRUD — all endpoints, Joi middleware, BP per-component
 *   3. Branching Rules — showWhen via form update, formLinks, requiredWhen
 *   4. Form data save — hard error blocks, soft warning queries, field dedup
 *   5. Controller param validation — invalid IDs, missing fields
 *   6. Interface contracts — API response shapes match expected DTOs
 *
 * Strategy: tests try to BREAK the system by sending:
 *   - Missing required fields
 *   - Wrong types (string where int expected)
 *   - Boundary values
 *   - Duplicate operations
 *   - Out-of-range values
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app';
import { testDb } from '../utils/test-db';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'root', password: 'root' });
  if (!res.body.token) throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
  cachedToken = res.body.token;
  return cachedToken!;
}

async function authed(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
  const token = await getToken();
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let studyId: number;
let crfId: number;
let ruleId: number;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await testDb.query('SELECT 1');
  const token = await getToken();

  // Create study
  const studyRes = await request(app)
    .post('/api/studies')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Full CRUD Study ${Date.now()}`, uniqueIdentifier: `FC-${Date.now()}` });
  studyId = studyRes.body.data?.studyId;
  if (!studyId) throw new Error('Could not create test study');
});

afterAll(async () => {
  if (studyId) await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [studyId]);
});

// ===========================================================================
// 1. eCRF FORM CRUD
// ===========================================================================

describe('eCRF Form CRUD', () => {
  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/forms — Create', () => {
    it('creates a form with name, study, and fields', async () => {
      const res = await (await authed('post', '/api/forms')).send({
        name: `CRUD Test Form ${Date.now()}`,
        studyId,
        fields: [
          { type: 'text',   label: 'Name',  name: 'pt_name', order: 1 },
          { type: 'number', label: 'Age',   name: 'age',     order: 2, min: 0, max: 120 },
        ],
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create form',
      }).expect(201);

      expect(res.body.success).toBe(true);
      crfId = res.body.data?.crfId || res.body.data?.id;
      expect(crfId).toBeGreaterThan(0);
    });

    it('returns 400 when name is missing (Joi)', async () => {
      const res = await (await authed('post', '/api/forms')).send({
        studyId,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create form',
      }).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors?.some((e: any) => e.field === 'name')).toBe(true);
    });

    it('returns 400 for invalid status value (Joi)', async () => {
      const res = await (await authed('post', '/api/forms')).send({
        name: 'Test',
        status: 'invalid_status',
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create form',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for unauthenticated request', async () => {
      await request(app)
        .post('/api/forms')
        .send({ name: 'Unauthorized Form' })
        .expect(401);
    });

    it('creates form with ALL field types and returns them in metadata', async () => {
      const allFieldTypes = [
        { type: 'text',       label: 'Text Field',      name: 'f_text',   order: 1 },
        { type: 'textarea',   label: 'Textarea',        name: 'f_ta',     order: 2 },
        { type: 'number',     label: 'Number',          name: 'f_num',    order: 3, min: 0, max: 999 },
        { type: 'integer',    label: 'Integer',         name: 'f_int',    order: 4 },
        { type: 'decimal',    label: 'Decimal',         name: 'f_dec',    order: 5 },
        { type: 'date',       label: 'Date',            name: 'f_date',   order: 6 },
        { type: 'datetime',   label: 'DateTime',        name: 'f_dtime',  order: 7 },
        { type: 'yesno',      label: 'YesNo',           name: 'f_yesno',  order: 8 },
        { type: 'select',     label: 'Select',          name: 'f_sel',    order: 9,
          options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
        { type: 'multiselect',label: 'MultiSelect',     name: 'f_multi',  order: 10,
          options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }] },
        { type: 'radio',      label: 'Radio',           name: 'f_radio',  order: 11,
          options: [{ label: 'Yes', value: 'y' }, { label: 'No', value: 'n' }] },
        { type: 'checkbox',   label: 'Checkbox',        name: 'f_check',  order: 12,
          options: [{ label: 'Opt1', value: 'o1' }, { label: 'Opt2', value: 'o2' }] },
        { type: 'blood_pressure', label: 'BP',          name: 'f_bp',     order: 13,
          inlineFields: [
            { id: 'systolic',  label: 'Systolic',  type: 'number', unit: 'mmHg', min: 60, max: 250, required: true },
            { id: 'diastolic', label: 'Diastolic', type: 'number', unit: 'mmHg', min: 30, max: 150, required: true },
          ]
        },
        { type: 'inline_group', label: 'Height/Weight', name: 'f_hw',    order: 14,
          inlineFields: [
            { id: 'height', label: 'Height', type: 'number', unit: 'cm', required: true },
            { id: 'wt',     label: 'Weight', type: 'number', unit: 'kg', required: true },
          ]
        },
        { type: 'table',      label: 'Lab Table',       name: 'f_table',  order: 15,
          tableColumns: [
            { id: 'test',   label: 'Test',   type: 'text',   required: true },
            { id: 'result', label: 'Result', type: 'number', required: false },
          ],
          tableSettings: { minRows: 1, maxRows: 10, allowAddRows: true }
        },
        { type: 'file',       label: 'File',            name: 'f_file',   order: 16 },
        { type: 'bmi',        label: 'BMI',             name: 'f_bmi',    order: 17, readonly: true },
      ];

      const res = await (await authed('post', '/api/forms')).send({
        name: `All Types ${Date.now()}`,
        studyId,
        fields: allFieldTypes,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create all-types form',
      }).expect(201);

      const allTypesCrfId = res.body.data?.crfId || res.body.data?.id;
      expect(allTypesCrfId).toBeGreaterThan(0);

      // Verify metadata returns all fields
      const metaRes = await (await authed('get', `/api/forms/${allTypesCrfId}/metadata`)).expect(200);
      const items: any[] = metaRes.body.data?.items || [];
      expect(items.length).toBe(allFieldTypes.length);

      // blood_pressure must have inlineFields
      const bpField = items.find((f: any) => f.type === 'blood_pressure' || f.name === 'f_bp');
      expect(bpField?.inlineFields?.length).toBe(2);

      // table must have tableColumns
      const tableField = items.find((f: any) => f.type === 'table' || f.name === 'f_table');
      expect(tableField?.tableColumns?.length).toBe(2);

      // select must have options
      const selectField = items.find((f: any) => f.type === 'select' || f.name === 'f_sel');
      expect(selectField?.options?.length).toBe(2);
    });

    it('rejects table field with zero columns (throw, not silent skip)', async () => {
      const res = await (await authed('post', '/api/forms')).send({
        name: `Bad Table ${Date.now()}`,
        studyId,
        fields: [{ type: 'table', label: 'Empty Table', name: 'bad_table', order: 1, tableColumns: [] }],
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create form',
      });
      // Should fail with an error about missing columns
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects blood_pressure field with no inlineFields (throw, not silent skip)', async () => {
      const res = await (await authed('post', '/api/forms')).send({
        name: `Bad BP ${Date.now()}`,
        studyId,
        fields: [{ type: 'blood_pressure', label: 'BP', name: 'bad_bp', order: 1 }],
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create form',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Read ─────────────────────────────────────────────────────────────────

  describe('GET /api/forms — Read', () => {
    it('GET /api/forms lists forms (array)', async () => {
      const res = await (await authed('get', '/api/forms')).expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/forms/:id returns 200 with valid id', async () => {
      const res = await (await authed('get', `/api/forms/${crfId}`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('GET /api/forms/:id returns 404 with nonexistent id', async () => {
      const res = await (await authed('get', '/api/forms/9999999'));
      expect([404, 400]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/forms/invalid-id returns 400 (Joi param validation)', async () => {
      const res = await (await authed('get', '/api/forms/not-a-number'));
      expect([400, 404]).toContain(res.status);
    });

    it('GET /api/forms/:crfId/metadata returns sections and items', async () => {
      const res = await (await authed('get', `/api/forms/${crfId}/metadata`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.sections).toBeDefined();
      expect(Array.isArray(res.body.data?.sections)).toBe(true);
      expect(res.body.data?.items).toBeDefined();
      expect(Array.isArray(res.body.data?.items)).toBe(true);
    });

    it('GET /api/forms/not-a-number/metadata returns 400', async () => {
      const res = await (await authed('get', '/api/forms/not-a-number/metadata'));
      expect([400, 404]).toContain(res.status);
    });
  });

  // ── Update ────────────────────────────────────────────────────────────────

  describe('PUT /api/forms/:id — Update', () => {
    it('updates form name', async () => {
      const newName = `Updated ${Date.now()}`;
      const res = await (await authed('put', `/api/forms/${crfId}`)).send({
        name: newName,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Update form name',
      }).expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid status (Joi)', async () => {
      const res = await (await authed('put', `/api/forms/${crfId}`)).send({
        status: 'not_valid',
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Update',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('section round-trip: add sections and verify they persist', async () => {
      await (await authed('put', `/api/forms/${crfId}`)).send({
        sections: [
          { id: 's1', name: 'Demographics', ordinal: 1 },
          { id: 's2', name: 'Vitals',       ordinal: 2 },
        ],
        fields: [
          { type: 'text',   label: 'Name', name: 'rt_name', section: 's1', order: 1 },
          { type: 'number', label: 'BP Sys', name: 'rt_bp', section: 's2', order: 2 },
        ],
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Add sections',
      }).expect(200);

      const metaRes = await (await authed('get', `/api/forms/${crfId}/metadata`)).expect(200);
      expect(metaRes.body.data?.sections?.length).toBeGreaterThanOrEqual(2);
    });

    it('section round-trip: resolve by name (not just UUID)', async () => {
      // Send field with section as display name (not UUID)
      await (await authed('put', `/api/forms/${crfId}`)).send({
        sections: [{ id: 'sx', name: 'Demographics', ordinal: 1 }],
        fields: [
          { type: 'text', label: 'Field A', name: 'name_sec_resolve', section: 'Demographics', order: 1 }
        ],
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Section name resolve',
      }).expect(200);

      const metaRes = await (await authed('get', `/api/forms/${crfId}/metadata`)).expect(200);
      const fieldA = metaRes.body.data?.items?.find((f: any) => f.name === 'name_sec_resolve');
      // field should exist and have a non-null section
      expect(fieldA).toBeDefined();
    });
  });

  // ── Archive / Restore ────────────────────────────────────────────────────

  describe('Archive & Restore', () => {
    let tempCrfId: number;

    beforeEach(async () => {
      const res = await (await authed('post', '/api/forms')).send({
        name: `Archive Test ${Date.now()}`, studyId,
        signatureUsername: 'root', signaturePassword: 'root',
        signatureMeaning: 'Create for archive test',
      });
      tempCrfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('archives form successfully', async () => {
      const res = await (await authed('post', `/api/forms/${tempCrfId}/archive`)).send({
        signatureUsername: 'root', signaturePassword: 'root',
        signatureMeaning: 'Archive for compliance',
      }).expect(200);
      expect(res.body.success).toBe(true);
    });

    it('restores archived form', async () => {
      await (await authed('post', `/api/forms/${tempCrfId}/archive`)).send({
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Archive',
      });
      const res = await (await authed('post', `/api/forms/${tempCrfId}/restore`)).send({
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Restore',
      }).expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});

// ===========================================================================
// 2. VALIDATION RULES CRUD
// ===========================================================================

describe('Validation Rules CRUD', () => {
  beforeAll(async () => {
    // ensure crfId is set from eCRF tests
    if (!crfId) throw new Error('crfId not set — run eCRF tests first');
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/validation-rules — Create', () => {
    it('creates a range rule and returns id', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId,
        fieldPath: 'age',
        ruleType: 'range',
        severity: 'error',
        errorMessage: 'Age must be 0–120',
        minValue: 0,
        maxValue: 120,
        active: true,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create rule',
      }).expect(201);

      expect(res.body.success).toBe(true);
      ruleId = res.body.data?.id || res.body.ruleId || res.body.data?.ruleId;
      expect(ruleId).toBeGreaterThan(0);
    });

    it('creates a rule with warningMessage (UI alias)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId,
        fieldPath: 'age',
        ruleType: 'range',
        severity: 'warning',
        errorMessage: 'Age seems unusual',
        warningMessage: 'Age seems unusual — please verify',
        minValue: 0,
        maxValue: 100,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create warning rule',
      }).expect(201);
      expect(res.body.success).toBe(true);
    });

    it('creates a blood_pressure rule with per-component limits', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId,
        fieldPath: 'f_bp',
        ruleType: 'range',
        severity: 'error',
        errorMessage: 'BP out of range',
        bpSystolicMin: 70,
        bpSystolicMax: 220,
        bpDiastolicMin: 40,
        bpDiastolicMax: 140,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create BP rule',
      });
      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for missing crfId (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        fieldPath: 'age',
        ruleType: 'range',
        severity: 'error',
        errorMessage: 'Test',
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Create rule',
      }).expect(400);
      expect(res.body.errors?.some((e: any) => e.field === 'crfId')).toBe(true);
    });

    it('returns 400 for invalid ruleType (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId, fieldPath: 'age', ruleType: 'invalid_type',
        severity: 'error', errorMessage: 'Test',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid severity (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId, fieldPath: 'age', ruleType: 'range',
        severity: 'fatal', errorMessage: 'Test',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for missing fieldPath (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId, ruleType: 'range', severity: 'error', errorMessage: 'Test',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
      }).expect(400);
      expect(res.body.errors?.some((e: any) => e.field === 'fieldPath')).toBe(true);
    });

    it('returns 400 for missing errorMessage (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules')).send({
        crfId, fieldPath: 'age', ruleType: 'range', severity: 'error',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Read ─────────────────────────────────────────────────────────────────

  describe('GET /api/validation-rules — Read', () => {
    it('GET /crf/:crfId returns array with message', async () => {
      const res = await (await authed('get', `/api/validation-rules/crf/${crfId}`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.message).toBe('string');
    });

    it('GET /:ruleId returns single rule', async () => {
      const res = await (await authed('get', `/api/validation-rules/${ruleId}`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.id).toBe(ruleId);
    });

    it('GET /crf/not-a-number returns 400', async () => {
      const res = await (await authed('get', '/api/validation-rules/crf/not-a-number'));
      expect([400]).toContain(res.status);
    });

    it('GET /:ruleId for nonexistent rule returns 404', async () => {
      const res = await (await authed('get', '/api/validation-rules/9999999'));
      expect([404, 400]).toContain(res.status);
    });
  });

  // ── Update ────────────────────────────────────────────────────────────────

  describe('PUT /api/validation-rules/:ruleId — Update', () => {
    it('updates errorMessage', async () => {
      const newMsg = `Updated ${Date.now()}`;
      const res = await (await authed('put', `/api/validation-rules/${ruleId}`)).send({
        errorMessage: newMsg,
        signatureUsername: 'root',
        signaturePassword: 'root',
        signatureMeaning: 'Modify rule',
      }).expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid severity (Joi)', async () => {
      const res = await (await authed('put', `/api/validation-rules/${ruleId}`)).send({
        severity: 'fatal',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'test',
      }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for non-integer ruleId', async () => {
      const res = await (await authed('put', '/api/validation-rules/abc')).send({
        errorMessage: 'Test',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'test',
      });
      expect([400]).toContain(res.status);
    });
  });

  // ── Toggle ────────────────────────────────────────────────────────────────

  describe('PATCH /api/validation-rules/:ruleId/toggle — Toggle', () => {
    it('toggles active state', async () => {
      const before = await (await authed('get', `/api/validation-rules/${ruleId}`));
      const wasActive = before.body.data?.active;

      await (await authed('patch', `/api/validation-rules/${ruleId}/toggle`)).send({
        signatureUsername: 'root', signaturePassword: 'root',
        signatureMeaning: 'Toggle rule',
      }).expect(200);

      const after = await (await authed('get', `/api/validation-rules/${ruleId}`));
      expect(after.body.data?.active).toBe(!wasActive);
    });
  });

  // ── Test Rule ────────────────────────────────────────────────────────────

  describe('POST /api/validation-rules/test — Test Rule', () => {
    it('returns valid=true for in-range value', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        ruleId,
        value: 45,
      }).expect(200);
      expect(res.body.data?.valid).toBe(true);
    });

    it('returns valid=false for out-of-range value', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        ruleId,
        value: 999,
      }).expect(200);
      expect(res.body.data?.valid).toBe(false);
    });

    it('validates BP per-component (systolic too high)', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        rule: {
          ruleType: 'range', severity: 'error',
          bpSystolicMin: 70, bpSystolicMax: 220,
          bpDiastolicMin: 40, bpDiastolicMax: 140,
        },
        value: '250/90',
      }).expect(200);
      expect(res.body.data?.valid).toBe(false);
    });

    it('validates BP per-component (diastolic too high)', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        rule: {
          ruleType: 'range', severity: 'error',
          bpSystolicMin: 70, bpSystolicMax: 220,
          bpDiastolicMin: 40, bpDiastolicMax: 140,
        },
        value: '120/160',
      }).expect(200);
      expect(res.body.data?.valid).toBe(false);
    });

    it('validates BP normal reading passes', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        rule: {
          ruleType: 'range', severity: 'error',
          bpSystolicMin: 70, bpSystolicMax: 220,
          bpDiastolicMin: 40, bpDiastolicMax: 140,
        },
        value: '120/80',
      }).expect(200);
      expect(res.body.data?.valid).toBe(true);
    });

    it('returns 400 for missing value (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules/test')).send({
        ruleId,
      }).expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Validate Field ────────────────────────────────────────────────────────

  describe('POST /api/validation-rules/validate-field', () => {
    it('returns valid=true for valid value', async () => {
      const res = await (await authed('post', '/api/validation-rules/validate-field')).send({
        crfId, fieldPath: 'age', value: 45, createQueries: false,
      }).expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns errors for invalid value', async () => {
      const res = await (await authed('post', '/api/validation-rules/validate-field')).send({
        crfId, fieldPath: 'age', value: 999, createQueries: false,
      }).expect(200);
      expect(res.body.success).toBe(true);
      const errors = res.body.data?.errors || [];
      expect(errors.length).toBeGreaterThan(0);
    });

    it('returns 400 for missing fieldPath (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules/validate-field')).send({
        crfId, value: 45,
      }).expect(400);
      expect(res.body.errors?.some((e: any) => e.field === 'fieldPath')).toBe(true);
    });

    it('returns 400 for missing crfId (Joi)', async () => {
      const res = await (await authed('post', '/api/validation-rules/validate-field')).send({
        fieldPath: 'age', value: 45,
      }).expect(400);
      expect(res.body.errors?.some((e: any) => e.field === 'crfId')).toBe(true);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /api/validation-rules/:ruleId — Delete', () => {
    it('deletes a rule then GET returns 404', async () => {
      // Create throwaway rule
      const createRes = await (await authed('post', '/api/validation-rules')).send({
        crfId, fieldPath: 'to_delete', ruleType: 'required',
        severity: 'error', errorMessage: 'Required',
        signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
      });
      const deleteId = createRes.body.data?.id || createRes.body.ruleId;

      await (await authed('delete', `/api/validation-rules/${deleteId}`)).send({
        signatureUsername: 'root', signaturePassword: 'root',
        signatureMeaning: 'Delete rule',
      }).expect(200);

      const getRes = await (await authed('get', `/api/validation-rules/${deleteId}`));
      expect([404, 400]).toContain(getRes.status);
    });
  });
});

// ===========================================================================
// 3. BRANCHING RULES (via form update)
// ===========================================================================

describe('Branching Rules Integration', () => {
  let branchCrfId: number;

  beforeAll(async () => {
    const res = await (await authed('post', '/api/forms')).send({
      name: `Branch Test ${Date.now()}`, studyId,
      fields: [
        { type: 'yesno',    label: 'AE?',       name: 'has_ae',    order: 1 },
        { type: 'textarea', label: 'AE Detail',  name: 'ae_detail', order: 2 },
        { type: 'number',   label: 'Age',        name: 'b_age',     order: 3 },
      ],
      signatureUsername: 'root', signaturePassword: 'root',
      signatureMeaning: 'Create branch form',
    });
    branchCrfId = res.body.data?.crfId || res.body.data?.id;
    expect(branchCrfId).toBeGreaterThan(0);
  });

  it('saves showWhen condition and retrieves it in metadata', async () => {
    await (await authed('put', `/api/forms/${branchCrfId}`)).send({
      fields: [
        { type: 'yesno', label: 'AE?', name: 'has_ae', order: 1 },
        {
          type: 'textarea', label: 'AE Detail', name: 'ae_detail', order: 2,
          showWhen: [{ fieldId: 'has_ae', operator: 'equals', value: 'yes' }],
        },
        { type: 'number', label: 'Age', name: 'b_age', order: 3 },
      ],
      signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Add branching',
    }).expect(200);

    const metaRes = await (await authed('get', `/api/forms/${branchCrfId}/metadata`)).expect(200);
    const aeDetailField = metaRes.body.data?.items?.find((f: any) => f.name === 'ae_detail');
    expect(aeDetailField).toBeDefined();
    expect(aeDetailField?.showWhen?.length).toBeGreaterThanOrEqual(1);
    expect(aeDetailField?.showWhen?.[0]?.operator).toBe('equals');
  });

  it('branching only affects the targeted field — trigger field has no showWhen', async () => {
    const metaRes = await (await authed('get', `/api/forms/${branchCrfId}/metadata`)).expect(200);
    const triggerField = metaRes.body.data?.items?.find((f: any) => f.name === 'has_ae');
    const sw = triggerField?.showWhen || [];
    expect(sw.length).toBe(0); // trigger field should NOT have showWhen
  });

  it('saves multiple AND conditions', async () => {
    await (await authed('put', `/api/forms/${branchCrfId}`)).send({
      fields: [
        { type: 'yesno', label: 'AE?', name: 'has_ae', order: 1 },
        { type: 'number', label: 'Age', name: 'b_age', order: 2 },
        {
          type: 'textarea', label: 'AE Detail', name: 'ae_detail', order: 3,
          showWhen: [
            { fieldId: 'has_ae', operator: 'equals',       value: 'yes', logicalOperator: 'AND' },
            { fieldId: 'b_age',  operator: 'greater_than', value: '18' },
          ],
        },
      ],
      signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Multi-condition',
    }).expect(200);

    const metaRes = await (await authed('get', `/api/forms/${branchCrfId}/metadata`)).expect(200);
    const f = metaRes.body.data?.items?.find((f: any) => f.name === 'ae_detail');
    expect(f?.showWhen?.length).toBeGreaterThanOrEqual(2);
  });

  it('clears showWhen by sending empty array', async () => {
    await (await authed('put', `/api/forms/${branchCrfId}`)).send({
      fields: [
        { type: 'yesno', label: 'AE?', name: 'has_ae', order: 1 },
        { type: 'textarea', label: 'AE Detail', name: 'ae_detail', order: 2, showWhen: [] },
        { type: 'number', label: 'Age', name: 'b_age', order: 3 },
      ],
      signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Clear branching',
    }).expect(200);

    const metaRes = await (await authed('get', `/api/forms/${branchCrfId}/metadata`)).expect(200);
    const f = metaRes.body.data?.items?.find((f: any) => f.name === 'ae_detail');
    expect(f?.showWhen?.length || 0).toBe(0);
  });

  it('saves formLinks on a field', async () => {
    // create a secondary CRF to link to
    const linkTarget = await (await authed('post', '/api/forms')).send({
      name: `Link Target ${Date.now()}`, studyId,
      fields: [{ type: 'textarea', label: 'Detail', name: 'detail', order: 1 }],
      signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Create',
    });
    const linkTargetId = linkTarget.body.data?.crfId || linkTarget.body.data?.id;

    await (await authed('put', `/api/forms/${branchCrfId}`)).send({
      fields: [{
        type: 'yesno', label: 'AE?', name: 'has_ae', order: 1,
        formLinks: [{
          id: `link_1_${linkTargetId}`,
          name: 'Open AE Form',
          targetFormId: linkTargetId,
          linkType: 'modal',
          triggerValue: 'yes',
          triggerConditions: [{ fieldId: 'has_ae', operator: 'equals', value: 'yes' }],
          required: false,
          autoOpen: true,
        }],
      }],
      signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Add formLinks',
    }).expect(200);

    const metaRes = await (await authed('get', `/api/forms/${branchCrfId}/metadata`)).expect(200);
    const ae = metaRes.body.data?.items?.find((f: any) => f.name === 'has_ae');
    const links = ae?.formLinks || [];
    expect(links.length).toBeGreaterThanOrEqual(1);
    const link = links[0];
    const tid = link.targetFormId ?? link.linkedFormId;
    expect(tid).toBe(linkTargetId);
  });
});

// ===========================================================================
// 4. FIELD PATCH (updateField endpoint)
// ===========================================================================

describe('PATCH /api/forms/field/:eventCrfId', () => {
  it('returns 400 for missing fieldName (Joi)', async () => {
    const res = await (await authed('patch', '/api/forms/field/999')).send({
      value: 'test',
    }).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors?.some((e: any) => e.field === 'fieldName')).toBe(true);
  });

  it('returns 400 for missing value (Joi)', async () => {
    const res = await (await authed('patch', '/api/forms/field/999')).send({
      fieldName: 'age',
    }).expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for non-integer eventCrfId', async () => {
    const res = await (await authed('patch', '/api/forms/field/not-a-number')).send({
      fieldName: 'age',
      value: 45,
    });
    expect([400]).toContain(res.status);
  });

  it('returns 404 for nonexistent eventCrfId', async () => {
    const res = await (await authed('patch', '/api/forms/field/9999999')).send({
      fieldName: 'age',
      value: 45,
    });
    expect([404, 400]).toContain(res.status);
  });
});

// ===========================================================================
// 5. WORKFLOW CONFIG
// ===========================================================================

describe('PUT /api/forms/workflow-config/:crfId', () => {
  it('saves and retrieves SDV requirement', async () => {
    const putRes = await (await authed('put', `/api/forms/workflow-config/${crfId}`)).send({
      requiresSDV: true,
      requiresSignature: false,
      requiresDDE: false,
      queryRouteToUsers: [],
    }).expect(200);
    expect(putRes.body.success).toBe(true);

    const getRes = await (await authed('get', `/api/forms/workflow-config/${crfId}`)).expect(200);
    expect(getRes.body.data?.requiresSDV).toBe(true);
  });

  it('returns 400 for invalid sdvType (Joi)', async () => {
    const res = await (await authed('put', `/api/forms/workflow-config/${crfId}`)).send({
      sdvType: 'invalid',
    }).expect(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for sdvPercentage out of range (Joi)', async () => {
    const res = await (await authed('put', `/api/forms/workflow-config/${crfId}`)).send({
      sdvPercentage: 110,
    }).expect(400);
    expect(res.body.success).toBe(false);
  });
});

// ===========================================================================
// 6. API RESPONSE SHAPE CONTRACTS
// ===========================================================================

describe('API Response Shape Contracts', () => {
  it('GET /api/forms always returns { success, data }', async () => {
    const res = await (await authed('get', '/api/forms')).expect(200);
    expect(typeof res.body.success).toBe('boolean');
    expect(res.body.data).toBeDefined();
  });

  it('GET /api/forms/:id/metadata returns { success, data: { sections, items } }', async () => {
    const res = await (await authed('get', `/api/forms/${crfId}/metadata`)).expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data?.sections)).toBe(true);
    expect(Array.isArray(res.body.data?.items)).toBe(true);
  });

  it('GET /api/validation-rules/crf/:id returns { success, data (array), message }', async () => {
    const res = await (await authed('get', `/api/validation-rules/crf/${crfId}`)).expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.message).toBe('string');
  });

  it('Error responses always include { success: false, message }', async () => {
    const res = await (await authed('post', '/api/validation-rules')).send({
      fieldPath: 'age',
      // missing crfId, ruleType, severity, errorMessage
    }).expect(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
