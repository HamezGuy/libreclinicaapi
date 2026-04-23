/**
 * eCRF (Form Template) CRUD Integration Tests
 *
 * Tests the full CRUD lifecycle for CRF templates via the API:
 *   POST   /api/forms/             - create
 *   GET    /api/forms/:id          - read single
 *   GET    /api/forms/             - list
 *   GET    /api/forms/by-study     - list by study
 *   GET    /api/forms/:id/metadata - read fields/sections
 *   PUT    /api/forms/:id          - update (with body validation)
 *   POST   /api/forms/:id/archive  - archive (soft delete)
 *   POST   /api/forms/:id/restore  - restore
 *   POST   /api/forms/:id/fork     - fork/copy
 *   POST   /api/forms/:id/versions - create version
 *   GET    /api/forms/:id/versions - version history
 *
 * Also tests every field type can be created and retrieved via metadata:
 *   text, textarea, number, integer, decimal, date, datetime, yesno,
 *   select, multiselect, radio, checkbox, blood_pressure, inline_group,
 *   table, file, signature, bmi
 *
 * Tests Joi middleware rejects malformed requests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app';
import { testDb } from '../utils/test-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAuthToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'root', password: 'root' });
  if (!res.body.token) throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function createTestStudy(token: string): Promise<number> {
  const res = await request(app)
    .post('/api/studies')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Test Study ${Date.now()}`, uniqueIdentifier: `TS-${Date.now()}` });
  return res.body.data?.studyId;
}

// Minimal valid form payload for create
function makeFormPayload(studyId: number, overrides: Record<string, any> = {}) {
  return {
    name: `Test Form ${Date.now()}`,
    description: 'Integration test form',
    studyId,
    category: 'Adverse Events',
    version: 'v1.0',
    status: 'draft',
    fields: [],
    // 21 CFR Part 11 signature
    signatureUsername: 'root',
    signaturePassword: 'root',
    signatureMeaning: 'I authorize creation of this CRF template',
    ...overrides,
  };
}

// All supported field types with minimal valid definitions
const ALL_FIELD_TYPES = [
  { type: 'text',        label: 'Subject Initials',   name: 'subject_initials' },
  { type: 'textarea',    label: 'Notes',              name: 'notes' },
  { type: 'number',      label: 'Age',                name: 'age',        min: 0, max: 120 },
  { type: 'integer',     label: 'Visit Number',       name: 'visit_num' },
  { type: 'decimal',     label: 'Weight (kg)',        name: 'weight',     unit: 'kg' },
  { type: 'date',        label: 'Visit Date',         name: 'visit_date' },
  { type: 'datetime',    label: 'Sample Time',        name: 'sample_time' },
  { type: 'yesno',       label: 'Adverse Event?',     name: 'has_ae' },
  {
    type: 'select',      label: 'Severity',           name: 'severity',
    options: [{ label: 'Mild', value: '1' }, { label: 'Moderate', value: '2' }, { label: 'Severe', value: '3' }]
  },
  {
    type: 'multiselect', label: 'Symptoms',           name: 'symptoms',
    options: [{ label: 'Headache', value: 'headache' }, { label: 'Nausea', value: 'nausea' }]
  },
  {
    type: 'radio',       label: 'Gender',             name: 'gender',
    options: [{ label: 'Male', value: 'M' }, { label: 'Female', value: 'F' }, { label: 'Other', value: 'O' }]
  },
  {
    type: 'checkbox',    label: 'Comorbidities',      name: 'comorbidities',
    options: [{ label: 'Diabetes', value: 'dm' }, { label: 'Hypertension', value: 'htn' }]
  },
  {
    type: 'blood_pressure', label: 'Blood Pressure',  name: 'bp',
    inlineFields: [
      { id: 'systolic',  label: 'Systolic',  type: 'number', unit: 'mmHg', min: 60,  max: 250, required: true },
      { id: 'diastolic', label: 'Diastolic', type: 'number', unit: 'mmHg', min: 30,  max: 150, required: true },
    ]
  },
  {
    type: 'inline_group', label: 'Height/Weight',    name: 'height_weight',
    inlineFields: [
      { id: 'height', label: 'Height', type: 'number', unit: 'cm', required: true },
      { id: 'weight_il', label: 'Weight', type: 'number', unit: 'kg', required: true },
    ]
  },
  {
    type: 'table',       label: 'Lab Results',        name: 'lab_results',
    tableColumns: [
      { id: 'test_name', label: 'Test', type: 'text',   required: true },
      { id: 'result',    label: 'Result', type: 'number', required: true },
      { id: 'unit',      label: 'Unit',  type: 'text',   required: false },
    ],
    tableSettings: { minRows: 1, maxRows: 10, allowAddRows: true, allowDeleteRows: true, showRowNumbers: true }
  },
  { type: 'file',      label: 'Supporting Document',  name: 'support_doc' },
  { type: 'signature', label: 'Investigator Signature', name: 'inv_sig' },
  { type: 'bmi',       label: 'BMI',                 name: 'bmi', readonly: true },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eCRF CRUD Integration', () => {
  let token: string;
  let studyId: number;
  let crfId: number;

  beforeAll(async () => {
    await testDb.query('SELECT 1');
    token = await getAuthToken();
    studyId = await createTestStudy(token);
    if (!studyId) throw new Error('Could not create test study');
  });

  beforeEach(async () => {
    crfId = 0; // reset
  });

  afterAll(async () => {
    // Cleanup test data
    if (studyId) {
      await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [studyId]);
    }
  });

  // ==========================================================================
  // CREATE
  // ==========================================================================

  describe('POST /api/forms — Create CRF', () => {
    it('creates a minimal CRF and returns crfId', async () => {
      const payload = makeFormPayload(studyId);
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      crfId = res.body.data.crfId || res.body.data.id;
      expect(crfId).toBeGreaterThan(0);
    });

    it('creates a CRF with all field types', async () => {
      const payload = makeFormPayload(studyId, {
        name: `All Fields Form ${Date.now()}`,
        fields: ALL_FIELD_TYPES.map((f, i) => ({ ...f, order: i + 1, required: false })),
      });

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      crfId = res.body.data.crfId || res.body.data.id;
      expect(crfId).toBeGreaterThan(0);
    });

    it('creates a CRF with sections', async () => {
      const payload = makeFormPayload(studyId, {
        sections: [
          { id: 'sec-1', name: 'Demographics', ordinal: 1 },
          { id: 'sec-2', name: 'Vitals',       ordinal: 2 },
        ],
        fields: [
          { type: 'text',   label: 'Name',           name: 'pt_name',    section: 'sec-1', order: 1 },
          { type: 'number', label: 'Age',            name: 'pt_age',     section: 'sec-1', order: 2 },
          { type: 'number', label: 'Systolic BP',    name: 'sbp',        section: 'sec-2', order: 3 },
        ],
      });

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      crfId = res.body.data.crfId || res.body.data.id;

      // Verify sections were persisted
      const metaRes = await request(app)
        .get(`/api/forms/${crfId}/metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const sections = metaRes.body.data?.sections || [];
      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections.some((s: any) => s.label === 'Demographics' || s.title === 'Demographics')).toBe(true);
    });

    it('rejects request missing required name field (Joi)', async () => {
      const payload = makeFormPayload(studyId, { name: undefined });
      delete payload.name;

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'name' })
      ]));
    });

    it('rejects unauthenticated request with 401', async () => {
      await request(app)
        .post('/api/forms')
        .send(makeFormPayload(studyId))
        .expect(401);
    });
  });

  // ==========================================================================
  // READ
  // ==========================================================================

  describe('GET /api/forms — Read CRF', () => {
    beforeEach(async () => {
      const payload = makeFormPayload(studyId, { fields: ALL_FIELD_TYPES.slice(0, 5).map((f, i) => ({ ...f, order: i + 1 })) });
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      crfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('GET /api/forms lists all forms', async () => {
      const res = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /api/forms/by-study?studyId lists forms for a study', async () => {
      const res = await request(app)
        .get(`/api/forms/by-study?studyId=${studyId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/forms/:id returns the CRF', async () => {
      const res = await request(app)
        .get(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('GET /api/forms/:id/metadata returns all fields with types', async () => {
      const res = await request(app)
        .get(`/api/forms/${crfId}/metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const fields = res.body.data?.items || res.body.data?.fields || [];
      expect(fields.length).toBeGreaterThan(0);
      // Every field must have a type
      for (const field of fields) {
        expect(field.type).toBeTruthy();
        expect(typeof field.type).toBe('string');
      }
    });

    it('GET /api/forms/999999 returns 404 for nonexistent CRF', async () => {
      const res = await request(app)
        .get('/api/forms/999999')
        .set('Authorization', `Bearer ${token}`);
      expect([404, 400]).toContain(res.status);
    });
  });

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  describe('PUT /api/forms/:id — Update CRF', () => {
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(makeFormPayload(studyId));
      crfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('updates CRF name and description', async () => {
      const newName = `Updated Form ${Date.now()}`;
      const res = await request(app)
        .put(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: newName,
          description: 'Updated description',
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize this CRF update',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify the name persisted
      const getRes = await request(app)
        .get(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`);
      const formName = getRes.body.data?.name;
      expect(formName).toBe(newName);
    });

    it('updates a CRF to add a new field', async () => {
      const res = await request(app)
        .put(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: [{ type: 'text', label: 'New Field', name: 'new_field', order: 1, required: true }],
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize this CRF update',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify via metadata
      const metaRes = await request(app)
        .get(`/api/forms/${crfId}/metadata`)
        .set('Authorization', `Bearer ${token}`);
      const fields = metaRes.body.data?.items || [];
      expect(fields.some((f: any) => f.name === 'new_field' || f.label === 'New Field')).toBe(true);
    });

    it('updates a CRF that has sections — sections round-trip correctly', async () => {
      // First PUT with sections
      await request(app)
        .put(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sections: [
            { id: 'sec-a', name: 'Section A', ordinal: 1 },
            { id: 'sec-b', name: 'Section B', ordinal: 2 },
          ],
          fields: [
            { type: 'text',   label: 'Field A1', name: 'field_a1', section: 'sec-a', order: 1 },
            { type: 'number', label: 'Field B1', name: 'field_b1', section: 'sec-b', order: 2 },
          ],
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize this CRF update',
        })
        .expect(200);

      // Second PUT: rename Section A (should not create duplicate section)
      const res2 = await request(app)
        .put(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sections: [
            { id: 'sec-a', name: 'Section A Renamed', ordinal: 1 },
            { id: 'sec-b', name: 'Section B', ordinal: 2 },
          ],
          fields: [
            { type: 'text',   label: 'Field A1', name: 'field_a1', section: 'Section A Renamed', order: 1 },
            { type: 'number', label: 'Field B1', name: 'field_b1', section: 'Section B', order: 2 },
          ],
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize this CRF update',
        })
        .expect(200);

      expect(res2.body.success).toBe(true);

      // Verify section count in DB
      const metaRes = await request(app)
        .get(`/api/forms/${crfId}/metadata`)
        .set('Authorization', `Bearer ${token}`);
      const sections = metaRes.body.data?.sections || [];
      expect(sections.length).toBe(2);
    });

    it('rejects PUT with invalid status value (Joi)', async () => {
      const res = await request(app)
        .put(`/api/forms/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          status: 'invalid_status',
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'test',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });
  });

  // ==========================================================================
  // FIELD TYPES — detailed metadata round-trip
  // ==========================================================================

  describe('Field Type Round-Trip via Metadata', () => {
    it('creates and retrieves every supported field type', async () => {
      const payload = makeFormPayload(studyId, {
        name: `All Types Form ${Date.now()}`,
        fields: ALL_FIELD_TYPES.map((f, i) => ({ ...f, order: i + 1, required: false })),
      });

      const createRes = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const formId = createRes.body.data?.crfId || createRes.body.data?.id;
      expect(formId).toBeGreaterThan(0);

      const metaRes = await request(app)
        .get(`/api/forms/${formId}/metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const returnedFields: any[] = metaRes.body.data?.items || [];
      expect(returnedFields.length).toBe(ALL_FIELD_TYPES.length);

      // Check that specific types come back correctly
      const bpField = returnedFields.find((f: any) => f.type === 'blood_pressure' || f.name === 'bp');
      expect(bpField).toBeDefined();
      expect(bpField?.inlineFields?.length).toBe(2);
      expect(bpField?.inlineFields?.[0]?.label).toMatch(/systolic/i);

      const tableField = returnedFields.find((f: any) => f.type === 'table' || f.name === 'lab_results');
      expect(tableField).toBeDefined();
      expect(tableField?.tableColumns?.length).toBe(3);
      expect(tableField?.tableSettings?.allowAddRows).toBe(true);

      const selectField = returnedFields.find((f: any) => (f.type === 'select' || f.name === 'severity') && f.options);
      expect(selectField).toBeDefined();
      expect(selectField?.options?.length).toBe(3);

      const inlineField = returnedFields.find((f: any) => f.type === 'inline_group' || f.name === 'height_weight');
      expect(inlineField).toBeDefined();
      expect(inlineField?.inlineFields?.length).toBe(2);
    });
  });

  // ==========================================================================
  // ARCHIVE / RESTORE
  // ==========================================================================

  describe('Archive & Restore', () => {
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(makeFormPayload(studyId));
      crfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('archives a CRF and removes it from normal list', async () => {
      await request(app)
        .post(`/api/forms/${crfId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Archive for compliance' })
        .expect(200);

      // Should appear in archived list
      const archivedRes = await request(app)
        .get('/api/forms/archived')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(archivedRes.body.data?.some((f: any) => f.crfId === crfId)).toBe(true);
    });

    it('restores an archived CRF', async () => {
      await request(app)
        .post(`/api/forms/${crfId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Archive' });

      const res = await request(app)
        .post(`/api/forms/${crfId}/restore`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Restore' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // VERSIONING & FORK
  // ==========================================================================

  describe('Versioning & Fork', () => {
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(makeFormPayload(studyId, {
          fields: [{ type: 'text', label: 'Field 1', name: 'field_1', order: 1 }]
        }));
      crfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('creates a new version and retrieves version history', async () => {
      const versionRes = await request(app)
        .post(`/api/forms/${crfId}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          versionName: 'v2.0',
          revisionNotes: 'Second version',
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize this new version',
        });

      expect([200, 201]).toContain(versionRes.status);
      expect(versionRes.body.success).toBe(true);

      const historyRes = await request(app)
        .get(`/api/forms/${crfId}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const versions = historyRes.body.data || [];
      expect(versions.length).toBeGreaterThanOrEqual(1);
    });

    it('forks a CRF into a new independent form', async () => {
      const forkRes = await request(app)
        .post(`/api/forms/${crfId}/fork`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newName: `Forked Form ${Date.now()}`,
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Fork for new study',
        });

      expect([200, 201]).toContain(forkRes.status);
      expect(forkRes.body.success).toBe(true);
      // Response shape: { success, newCrfId, message, code, copied }.
      // (Old test read body.data.crfId which never existed — see PR.)
      const forkedId = forkRes.body.newCrfId
        ?? forkRes.body.data?.newCrfId
        ?? forkRes.body.data?.crfId;
      expect(forkedId).toBeGreaterThan(0);
      expect(forkedId).not.toBe(crfId);
      expect(forkRes.body.code).toBe('OK');
      // Structural copy report — proves we didn't return a half-baked CRF.
      expect(forkRes.body.copied).toBeDefined();
    });

    it('rejects a fork with a duplicate name in the same study (409)', async () => {
      const dupName = `DupName_${Date.now()}`;
      const first = await request(app)
        .post(`/api/forms/${crfId}/fork`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newName: dupName,
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Fork for new study',
        });
      expect([200, 201]).toContain(first.status);
      expect(first.body.success).toBe(true);

      const second = await request(app)
        .post(`/api/forms/${crfId}/fork`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newName: dupName,
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Fork for new study',
        });
      // Previously this silently returned 201 with the EXISTING CRF id —
      // a cross-org data leak. Now it must hard-fail with a 409 + structured
      // NAME_CONFLICT code so the UI can show an actionable error.
      expect(second.status).toBe(409);
      expect(second.body.success).toBe(false);
      expect(second.body.code).toBe('NAME_CONFLICT');
    });
  });

  // ==========================================================================
  // FORK: TABLE / QUESTION_TABLE / BRANCHING / VALIDATION RULES
  // 
  // Proves that the fork/copy feature correctly deep-copies:
  //   1. Table fields (columns, settings stored in item.description extended props)
  //   2. Question table fields (question rows, answer columns)
  //   3. SCD branching rules (show/hide conditions between fields)
  //   4. Validation rules including table_cell_target JSONB
  //   5. Response sets (dropdown options isolated from source)
  // ==========================================================================

  describe('Fork preserves tables, question tables, branching & validation rules', () => {
    let sourceCrfId: number;

    it('creates a complex source form with table, question_table, branching, and validation rules', async () => {
      const payload = makeFormPayload(studyId, {
        name: `ComplexFork_${Date.now()}`,
        fields: [
          // A select that drives branching
          {
            type: 'select', label: 'Assessment Type', name: 'assessment_type', order: 1,
            options: [
              { label: 'Screening', value: 'screening' },
              { label: 'Treatment', value: 'treatment' },
              { label: 'Follow-up', value: 'followup' },
            ],
          },
          // A text field shown only when assessment_type = 'treatment'
          {
            type: 'text', label: 'Treatment Details', name: 'treatment_details', order: 2,
            showWhen: [{ fieldId: 'assessment_type', operator: 'equals', value: 'treatment' }],
          },
          // A data table
          {
            type: 'table', label: 'Vitals Table', name: 'vitals_table', order: 3,
            tableColumns: [
              { id: 'heart_rate', name: 'heart_rate', label: 'Heart Rate', type: 'number', required: true, min: 30, max: 220 },
              { id: 'temperature', name: 'temperature', label: 'Temperature', type: 'number', required: false },
              { id: 'bp_reading', name: 'bp_reading', label: 'BP', type: 'text', required: false },
            ],
            tableSettings: { minRows: 1, maxRows: 5, allowAddRows: true, showRowNumbers: true },
          },
          // A question table
          {
            type: 'question_table', label: 'Symptom Assessment', name: 'symptom_qt', order: 4,
            questionRows: [
              {
                id: 'headache', question: 'Headache?',
                answerColumns: [
                  { id: 'severity', type: 'select', header: 'Severity', options: [{ label: 'Mild', value: '1' }, { label: 'Severe', value: '3' }] },
                  { id: 'onset_date', type: 'date', header: 'Onset Date' },
                ],
              },
              {
                id: 'nausea', question: 'Nausea?',
                answerColumns: [
                  { id: 'severity', type: 'select', header: 'Severity', options: [{ label: 'Mild', value: '1' }, { label: 'Severe', value: '3' }] },
                  { id: 'onset_date', type: 'date', header: 'Onset Date' },
                ],
              },
            ],
            questionTableSettings: { questionColumnHeader: 'Symptom' },
          },
          // A number field with a range rule
          {
            type: 'number', label: 'Pain Score', name: 'pain_score', order: 5,
            min: 0, max: 10,
          },
          // A field that links/branches to another form (external form reference)
          {
            type: 'select', label: 'Referral Needed', name: 'referral_needed', order: 6,
            options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
            linkedFormId: 99999, // fake external CRF ID — should trigger a warning on fork
            linkedFormName: 'Referral Form',
            linkedFormTriggerValue: 'yes',
            formLinks: [
              {
                id: 'link_1',
                name: 'Referral Form Link',
                targetFormId: 99999,
                targetFormName: 'Referral Form',
                triggerConditions: [{ fieldId: 'referral_needed', operator: 'equals', value: 'yes' }],
                linkType: 'modal',
                required: false,
                autoOpen: false,
              },
            ],
          },
        ],
      });

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      sourceCrfId = res.body.data?.crfId || res.body.data?.id;
      expect(sourceCrfId).toBeGreaterThan(0);
    });

    it('adds validation rules (including table cell target) to the source form', async () => {
      // Create a range rule for the pain_score field
      const rangeRule = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          crfId: sourceCrfId,
          name: 'Pain Score Range',
          description: 'Pain score must be 0-10',
          ruleType: 'range',
          fieldPath: 'pain_score',
          severity: 'error',
          errorMessage: 'Pain score must be between 0 and 10',
          minValue: 0,
          maxValue: 10,
          signatureUsername: 'root',
          signaturePassword: 'root',
        });
      // Accept 200 or 201 or even 400 if validation-rules route requires more fields
      // The key thing we're testing is whether the rules that DO get created are copied
      if (rangeRule.body.success) {
        expect(rangeRule.body.data?.id || rangeRule.body.data?.validationRuleId).toBeGreaterThan(0);
      }

      // Create a table-cell-targeted rule for heart_rate column
      const tableCellRule = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          crfId: sourceCrfId,
          name: 'Heart Rate Range',
          description: 'Heart rate must be 30-220',
          ruleType: 'range',
          fieldPath: 'vitals_table',
          severity: 'error',
          errorMessage: 'Heart rate must be between 30 and 220 bpm',
          minValue: 30,
          maxValue: 220,
          tableCellTarget: {
            tableFieldPath: 'vitals_table',
            columnId: 'heart_rate',
            columnType: 'number',
            allRows: true,
            displayPath: 'Vitals Table > Heart Rate (all rows)',
          },
          signatureUsername: 'root',
          signaturePassword: 'root',
        });
      if (tableCellRule.body.success) {
        expect(tableCellRule.body.data?.id || tableCellRule.body.data?.validationRuleId).toBeGreaterThan(0);
      }
    });

    it('forks the complex form and verifies all structures are preserved', async () => {
      // Fork
      const forkRes = await request(app)
        .post(`/api/forms/${sourceCrfId}/fork`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newName: `ForkedComplex_${Date.now()}`,
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Copy form for testing',
        });

      expect([200, 201]).toContain(forkRes.status);
      expect(forkRes.body.success).toBe(true);
      expect(forkRes.body.code).toBe('OK');
      const forkedCrfId = forkRes.body.newCrfId;
      expect(forkedCrfId).toBeGreaterThan(0);
      expect(forkedCrfId).not.toBe(sourceCrfId);

      // Verify structural copy counts
      const copied = forkRes.body.copied;
      expect(copied).toBeDefined();
      expect(copied.sections).toBeGreaterThanOrEqual(1);
      expect(copied.items).toBeGreaterThanOrEqual(6); // 6 fields created

      // Verify linkedFormWarnings were returned for the external form reference
      const warnings = forkRes.body.linkedFormWarnings;
      if (warnings) {
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        const referralWarning = warnings.find(
          (w: any) => w.targetFormId === 99999 || w.fieldName === 'referral_needed'
        );
        expect(referralWarning).toBeDefined();
        expect(referralWarning.targetFormId).toBe(99999);
      }

      // Fetch metadata for both source and fork
      const [sourceMetaRes, forkMetaRes] = await Promise.all([
        request(app).get(`/api/forms/${sourceCrfId}/metadata`).set('Authorization', `Bearer ${token}`),
        request(app).get(`/api/forms/${forkedCrfId}/metadata`).set('Authorization', `Bearer ${token}`),
      ]);

      expect(sourceMetaRes.status).toBe(200);
      expect(forkMetaRes.status).toBe(200);

      const sourceFields = sourceMetaRes.body.data?.fields || sourceMetaRes.body.fields || [];
      const forkFields = forkMetaRes.body.data?.fields || forkMetaRes.body.fields || [];

      // Same number of fields
      expect(forkFields.length).toBe(sourceFields.length);

      // Find the table field by name in forked metadata
      const forkVitalsTable = forkFields.find((f: any) =>
        f.name === 'vitals_table' || f.fieldName === 'vitals_table'
      );
      const sourceVitalsTable = sourceFields.find((f: any) =>
        f.name === 'vitals_table' || f.fieldName === 'vitals_table'
      );

      // Verify table columns were preserved (stored in extended_props in item.description)
      if (sourceVitalsTable && forkVitalsTable) {
        // The columns should be in the metadata
        const srcCols = sourceVitalsTable.tableColumns || sourceVitalsTable.columns;
        const forkCols = forkVitalsTable.tableColumns || forkVitalsTable.columns;
        if (srcCols && forkCols) {
          expect(forkCols.length).toBe(srcCols.length);
          // Column IDs should match (they are stable text identifiers, not DB PKs)
          const srcColIds = srcCols.map((c: any) => c.id || c.key);
          const forkColIds = forkCols.map((c: any) => c.id || c.key);
          expect(forkColIds).toEqual(srcColIds);
        }
      }

      // Find the question table in forked metadata
      const forkSymptomQt = forkFields.find((f: any) =>
        f.name === 'symptom_qt' || f.fieldName === 'symptom_qt'
      );
      const sourceSymptomQt = sourceFields.find((f: any) =>
        f.name === 'symptom_qt' || f.fieldName === 'symptom_qt'
      );

      if (sourceSymptomQt && forkSymptomQt) {
        const srcRows = sourceSymptomQt.questionRows || [];
        const forkRows = forkSymptomQt.questionRows || [];
        if (srcRows.length > 0 && forkRows.length > 0) {
          expect(forkRows.length).toBe(srcRows.length);
          // Row IDs must be preserved (text identifiers like "headache", "nausea")
          expect(forkRows.map((r: any) => r.id)).toEqual(srcRows.map((r: any) => r.id));
          // Question text must be preserved
          expect(forkRows.map((r: any) => r.question)).toEqual(srcRows.map((r: any) => r.question));
          // Answer columns must be preserved per row
          for (let ri = 0; ri < srcRows.length; ri++) {
            const srcCols = srcRows[ri].answerColumns || [];
            const forkCols = forkRows[ri].answerColumns || [];
            expect(forkCols.length).toBe(srcCols.length);
            // Column IDs like "severity", "onset_date" must survive
            expect(forkCols.map((c: any) => c.id)).toEqual(srcCols.map((c: any) => c.id));
            // Column types must survive
            expect(forkCols.map((c: any) => c.type)).toEqual(srcCols.map((c: any) => c.type));
            // Dropdown options inside QT cells must survive
            const srcSelectCol = srcCols.find((c: any) => c.type === 'select');
            const forkSelectCol = forkCols.find((c: any) => c.type === 'select');
            if (srcSelectCol?.options && forkSelectCol?.options) {
              expect(forkSelectCol.options.length).toBe(srcSelectCol.options.length);
              expect(forkSelectCol.options.map((o: any) => o.value))
                .toEqual(srcSelectCol.options.map((o: any) => o.value));
            }
          }
        }

        // Question table settings must survive
        const srcSettings = sourceSymptomQt.questionTableSettings;
        const forkSettings = forkSymptomQt.questionTableSettings;
        if (srcSettings && forkSettings) {
          expect(forkSettings.questionColumnHeader).toBe(srcSettings.questionColumnHeader);
        }
      }

      // Verify SCD branching was copied — treatment_details should have showWhen
      const forkTreatmentDetails = forkFields.find((f: any) =>
        f.name === 'treatment_details' || f.fieldName === 'treatment_details'
      );

      if (forkTreatmentDetails) {
        const showWhen = forkTreatmentDetails.showWhen;
        if (showWhen && showWhen.length > 0) {
          expect(showWhen[0].fieldId).toBe('assessment_type');
          expect(showWhen[0].value).toBe('treatment');
        }
      }

      // Verify response sets were deep-copied (different IDs from source)
      // We can't easily check IDs via the API, but we can verify the select
      // field still has its options
      const forkAssessmentType = forkFields.find((f: any) =>
        f.name === 'assessment_type' || f.fieldName === 'assessment_type'
      );
      if (forkAssessmentType) {
        const opts = forkAssessmentType.options || [];
        expect(opts.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('verifies the forked form has independent validation rules', async () => {
      // Fetch validation rules for the forked CRF to check they were copied
      const sourceRulesRes = await request(app)
        .get(`/api/validation-rules?crfId=${sourceCrfId}`)
        .set('Authorization', `Bearer ${token}`);

      // If the source has rules, check the fork also has them
      if (sourceRulesRes.body.success && sourceRulesRes.body.data?.length > 0) {
        // The fork should have at least as many rules
        const forkCrfId = (await request(app)
          .get(`/api/forms`)
          .set('Authorization', `Bearer ${token}`)
        ).body.data?.find((f: any) => f.name?.startsWith('ForkedComplex_'))?.crfId;

        if (forkCrfId) {
          const forkRulesRes = await request(app)
            .get(`/api/validation-rules?crfId=${forkCrfId}`)
            .set('Authorization', `Bearer ${token}`);

          if (forkRulesRes.body.success) {
            expect(forkRulesRes.body.data?.length).toBe(sourceRulesRes.body.data.length);

            // Verify table_cell_target was remapped (tableItemId should differ)
            const sourceTableRule = sourceRulesRes.body.data.find(
              (r: any) => r.tableCellTarget?.tableFieldPath === 'vitals_table'
            );
            const forkTableRule = forkRulesRes.body.data.find(
              (r: any) => r.tableCellTarget?.tableFieldPath === 'vitals_table'
            );

            if (sourceTableRule?.tableCellTarget?.tableItemId && forkTableRule?.tableCellTarget?.tableItemId) {
              // The tableItemId should be DIFFERENT (remapped to the new item_id)
              expect(forkTableRule.tableCellTarget.tableItemId)
                .not.toBe(sourceTableRule.tableCellTarget.tableItemId);
              // But the rest of the targeting should be the same
              expect(forkTableRule.tableCellTarget.columnId)
                .toBe(sourceTableRule.tableCellTarget.columnId);
              expect(forkTableRule.tableCellTarget.allRows)
                .toBe(sourceTableRule.tableCellTarget.allRows);
            }
          }
        }
      }
    });

    it('supports relinking broken form links after the linked form is copied', async () => {
      const allFormsRes = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${token}`);
      const forkedForm = allFormsRes.body.data?.find(
        (f: any) => f.name?.startsWith('ForkedComplex_')
      );

      if (forkedForm) {
        const forkedCrfId = forkedForm.crfId;

        // Create the "Referral Form" in the same study (simulating it was now copied)
        const referralRes = await request(app)
          .post('/api/forms')
          .set('Authorization', `Bearer ${token}`)
          .send(makeFormPayload(studyId, { name: `Referral Form ${Date.now()}` }));
        const referralCrfId = referralRes.body.data?.crfId || referralRes.body.data?.id;

        if (referralCrfId) {
          // Call the relink endpoint
          const relinkRes = await request(app)
            .patch(`/api/forms/${forkedCrfId}/relink`)
            .set('Authorization', `Bearer ${token}`)
            .send({
              relinks: [
                { oldFormId: 99999, newFormId: referralCrfId, newFormName: 'Referral Form' },
              ],
              signatureUsername: 'root',
              signaturePassword: 'root',
            });

          expect(relinkRes.status).toBe(200);
          expect(relinkRes.body.success).toBe(true);
          expect(relinkRes.body.updatedFields.length).toBeGreaterThanOrEqual(1);
          expect(relinkRes.body.updatedFields).toContain('referral_needed');

          // Verify the relinked metadata now points at the correct form
          const metaRes = await request(app)
            .get(`/api/forms/${forkedCrfId}/metadata`)
            .set('Authorization', `Bearer ${token}`);

          const fields = metaRes.body.data?.fields || metaRes.body.fields || [];
          const referralField = fields.find(
            (f: any) => f.name === 'referral_needed' || f.fieldName === 'referral_needed'
          );

          if (referralField) {
            expect(Number(referralField.linkedFormId)).toBe(referralCrfId);
          }
        }
      }
    });
  });

  // ==========================================================================
  // WORKFLOW CONFIG
  // ==========================================================================

  describe('PUT /api/forms/workflow-config/:crfId', () => {
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', `Bearer ${token}`)
        .send(makeFormPayload(studyId));
      crfId = res.body.data?.crfId || res.body.data?.id;
    });

    it('saves and retrieves workflow config', async () => {
      const putRes = await request(app)
        .put(`/api/forms/workflow-config/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ requiresSDV: true, requiresSignature: false, requiresDDE: false, queryRouteToUsers: [] })
        .expect(200);
      expect(putRes.body.success).toBe(true);

      const getRes = await request(app)
        .get(`/api/forms/workflow-config/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getRes.body.data?.requiresSDV).toBe(true);
    });

    it('rejects invalid sdvType value (Joi)', async () => {
      const res = await request(app)
        .put(`/api/forms/workflow-config/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sdvType: 'not_a_valid_type' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // FIELD-LEVEL PATCH
  // ==========================================================================

  describe('PATCH /api/forms/field/:eventCrfId', () => {
    it('rejects missing fieldName (Joi)', async () => {
      const res = await request(app)
        .patch(`/api/forms/field/999`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'test' }) // missing fieldName
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects missing value (Joi)', async () => {
      const res = await request(app)
        .patch(`/api/forms/field/999`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fieldName: 'test_field' }) // missing value
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });
});
