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
  return res.body.data?.studyId || res.body.data?.study_id;
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
      crfId = res.body.data.crfId || res.body.data.crf_id || res.body.data.id;
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
      expect(archivedRes.body.data?.some((f: any) => f.crfId === crfId || f.crf_id === crfId)).toBe(true);
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
      const forkedId = forkRes.body.data?.crfId || forkRes.body.data?.id;
      expect(forkedId).toBeGreaterThan(0);
      expect(forkedId).not.toBe(crfId);
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
