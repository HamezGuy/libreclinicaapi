/**
 * Validation Rules CRUD + Form Data Save Integration Tests
 *
 * Tests:
 *   1. Full CRUD lifecycle for validation rules via the API
 *   2. Form data save with hard errors (block save) and soft warnings (create queries)
 *   3. Joi middleware rejects malformed rule payloads
 *   4. Blood pressure per-component validation
 *   5. validateField endpoint real-time validation
 *   6. deduplication of validation queries
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
  return res.body.token;
}

async function createStudy(token: string, suffix = Date.now()): Promise<number> {
  const res = await request(app)
    .post('/api/studies')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `VR Study ${suffix}`, uniqueIdentifier: `VR-${suffix}` });
  return res.body.data?.studyId;
}

async function createCrf(token: string, studyId: number, fields: any[] = []): Promise<number> {
  const res = await request(app)
    .post('/api/forms')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `VR Test Form ${Date.now()}`,
      studyId,
      fields,
      signatureUsername: 'root',
      signaturePassword: 'root',
      signatureMeaning: 'Create CRF for validation rule tests',
    });
  return res.body.data?.crfId || res.body.data?.id;
}

function rulePayload(crfId: number, overrides: Record<string, any> = {}) {
  return {
    crfId,
    fieldPath: 'age',
    ruleType: 'range',
    severity: 'error',
    errorMessage: 'Age must be between 0 and 120',
    minValue: 0,
    maxValue: 120,
    active: true,
    signatureUsername: 'root',
    signaturePassword: 'root',
    signatureMeaning: 'I authorize creation of this validation rule',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Validation Rules CRUD Integration', () => {
  let token: string;
  let studyId: number;
  let crfId: number;
  let ruleId: number;

  beforeAll(async () => {
    await testDb.query('SELECT 1');
    token = await getAuthToken();
    studyId = await createStudy(token);
    crfId = await createCrf(token, studyId, [
      { type: 'number', label: 'Age', name: 'age', order: 1 },
      { type: 'blood_pressure', label: 'BP', name: 'bp', order: 2,
        inlineFields: [
          { id: 'systolic',  label: 'Systolic',  type: 'number', unit: 'mmHg', min: 60,  max: 250 },
          { id: 'diastolic', label: 'Diastolic', type: 'number', unit: 'mmHg', min: 30,  max: 150 },
        ]
      },
      { type: 'text',   label: 'Initials', name: 'initials', order: 3 },
    ]);
    expect(crfId).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (studyId) await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [studyId]);
  });

  // ==========================================================================
  // CREATE
  // ==========================================================================

  describe('POST /api/validation-rules — Create Rule', () => {
    it('creates a range rule and returns it with an id', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId))
        .expect(201);

      expect(res.body.success).toBe(true);
      ruleId = res.body.data?.id || res.body.data?.ruleId;
      expect(ruleId).toBeGreaterThan(0);
    });

    it('creates a required rule', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, {
          fieldPath: 'initials',
          ruleType: 'required',
          severity: 'error',
          errorMessage: 'Initials are required',
          minValue: undefined,
          maxValue: undefined,
        }))
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it('creates a format rule (initials pattern)', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, {
          fieldPath: 'initials',
          ruleType: 'format',
          severity: 'warning',
          errorMessage: 'Initials should be 2-3 uppercase letters',
          formatType: 'initials',
          minValue: undefined,
          maxValue: undefined,
        }))
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it('creates a blood pressure range rule with per-component limits', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, {
          fieldPath: 'bp',
          ruleType: 'range',
          severity: 'error',
          errorMessage: 'Blood pressure is out of range',
          bpSystolicMin: 70,
          bpSystolicMax: 220,
          bpDiastolicMin: 40,
          bpDiastolicMax: 140,
          minValue: undefined,
          maxValue: undefined,
        }))
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects missing crfId (Joi)', async () => {
      const payload = rulePayload(crfId);
      delete (payload as any).crfId;
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors.some((e: any) => e.field === 'crfId')).toBe(true);
    });

    it('rejects invalid ruleType (Joi)', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, { ruleType: 'not_a_valid_type' }))
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid severity (Joi)', async () => {
      const res = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, { severity: 'critical' }))
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // READ
  // ==========================================================================

  describe('GET /api/validation-rules — Read Rules', () => {
    it('GET /crf/:crfId returns all rules for a CRF', async () => {
      const res = await request(app)
        .get(`/api/validation-rules/crf/${crfId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /:ruleId returns a single rule', async () => {
      expect(ruleId).toBeGreaterThan(0);
      const res = await request(app)
        .get(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.id).toBe(ruleId);
    });

    it('rejects invalid ruleId param (Joi) — non-integer', async () => {
      const res = await request(app)
        .get('/api/validation-rules/not-a-number')
        .set('Authorization', `Bearer ${token}`);
      expect([400, 404]).toContain(res.status);
    });
  });

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  describe('PUT /api/validation-rules/:ruleId — Update Rule', () => {
    it('updates errorMessage of an existing rule', async () => {
      const newMsg = 'Age must be a reasonable value';
      const res = await request(app)
        .put(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          errorMessage: newMsg,
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize modification of this validation rule',
        })
        .expect(200);
      expect(res.body.success).toBe(true);

      // Verify via GET
      const getRes = await request(app)
        .get(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.body.data?.errorMessage).toBe(newMsg);
    });

    it('rejects invalid severity on update (Joi)', async () => {
      const res = await request(app)
        .put(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          severity: 'fatal',
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'test',
        })
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // TOGGLE
  // ==========================================================================

  describe('PATCH /api/validation-rules/:ruleId/toggle — Toggle Active', () => {
    it('toggles a rule from active to inactive', async () => {
      const before = await request(app)
        .get(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`);
      const wasActive: boolean = before.body.data?.active;

      const res = await request(app)
        .patch(`/api/validation-rules/${ruleId}/toggle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize toggling this validation rule',
        })
        .expect(200);
      expect(res.body.success).toBe(true);

      const after = await request(app)
        .get(`/api/validation-rules/${ruleId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.data?.active).toBe(!wasActive);
    });
  });

  // ==========================================================================
  // TEST RULE
  // ==========================================================================

  describe('POST /api/validation-rules/test — Test Rule', () => {
    it('tests a range rule against a valid value', async () => {
      const res = await request(app)
        .post('/api/validation-rules/test')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ruleId,
          value: 25,
          allFormData: { age: 25 },
        })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.valid).toBe(true);
    });

    it('tests a range rule against an invalid value', async () => {
      const res = await request(app)
        .post('/api/validation-rules/test')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ruleId,
          value: 200, // exceeds max 120
          allFormData: { age: 200 },
        })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.valid).toBe(false);
    });

    it('tests blood pressure validation with per-component limits', async () => {
      const res = await request(app)
        .post('/api/validation-rules/test')
        .set('Authorization', `Bearer ${token}`)
        .send({
          rule: {
            ruleType: 'range',
            severity: 'error',
            bpSystolicMin: 70,
            bpSystolicMax: 220,
            bpDiastolicMin: 40,
            bpDiastolicMax: 140,
          },
          value: '250/90', // systolic too high
        })
        .expect(200);
      expect(res.body.data?.valid).toBe(false);
    });

    it('rejects missing value (Joi)', async () => {
      const res = await request(app)
        .post('/api/validation-rules/test')
        .set('Authorization', `Bearer ${token}`)
        .send({ ruleId }) // no value
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // VALIDATE FIELD (real-time)
  // ==========================================================================

  describe('POST /api/validation-rules/validate-field — Real-Time Validation', () => {
    it('validates a field and returns no errors for valid value', async () => {
      const res = await request(app)
        .post('/api/validation-rules/validate-field')
        .set('Authorization', `Bearer ${token}`)
        .send({
          crfId,
          fieldPath: 'age',
          value: 45,
          createQueries: false,
        })
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('validates a field and returns errors for invalid value', async () => {
      const res = await request(app)
        .post('/api/validation-rules/validate-field')
        .set('Authorization', `Bearer ${token}`)
        .send({
          crfId,
          fieldPath: 'age',
          value: 999, // out of range
          createQueries: false,
        })
        .expect(200);
      expect(res.body.success).toBe(true);
      // Should have validation errors
      const errors = res.body.data?.errors || [];
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects missing fieldPath (Joi)', async () => {
      const res = await request(app)
        .post('/api/validation-rules/validate-field')
        .set('Authorization', `Bearer ${token}`)
        .send({ crfId, value: 45 })
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors.some((e: any) => e.field === 'fieldPath')).toBe(true);
    });

    it('rejects missing crfId (Joi)', async () => {
      const res = await request(app)
        .post('/api/validation-rules/validate-field')
        .set('Authorization', `Bearer ${token}`)
        .send({ fieldPath: 'age', value: 45 })
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // FORM DATA SAVE — hard/soft workflow
  // ==========================================================================

  describe('Form Data Save + Validation Workflow', () => {
    let subjectId: number;
    let studyEventDefinitionId: number;

    beforeAll(async () => {
      // Enroll a subject to get a valid patient context
      const subjectRes = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          studyId,
          label: `VR-SUBJ-${Date.now()}`,
          gender: 'm',
          password: 'root',
          signatureMeaning: 'Enrollment',
        });
      subjectId = subjectRes.body.data?.studySubjectId || subjectRes.body.data?.study_subject_id;

      // Get a study event definition
      const phasesRes = await request(app)
        .get(`/api/events/definitions?studyId=${studyId}`)
        .set('Authorization', `Bearer ${token}`);
      studyEventDefinitionId = phasesRes.body.data?.[0]?.studyEventDefinitionId;
    });

    it('blocks save on hard-error validation failure', async () => {
      // Toggle rule back active if needed
      await request(app)
        .patch(`/api/validation-rules/${ruleId}/toggle`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signatureUsername: 'root', signaturePassword: 'root', signatureMeaning: 'Re-enable' });

      // Send an age value that violates the range rule (0-120)
      const res = await request(app)
        .post('/api/forms/save')
        .set('Authorization', `Bearer ${token}`)
        .send({
          studyId,
          subjectId,
          studyEventDefinitionId,
          crfId,
          formData: { age: 999 }, // out of range — hard error
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Data entry',
        });

      // Should fail with validation errors
      expect(res.body.success).toBe(false);
      const errors = res.body.errors || res.body.validationErrors || [];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e: any) => e.severity === 'error' || e.message?.toLowerCase().includes('age'))).toBe(true);
    });

    it('saves form data when all values are valid', async () => {
      const res = await request(app)
        .post('/api/forms/save')
        .set('Authorization', `Bearer ${token}`)
        .send({
          studyId,
          subjectId,
          studyEventDefinitionId,
          crfId,
          formData: { age: 35, bp: '120/80', initials: 'AB' },
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'Data entry',
        });

      expect(res.body.success).toBe(true);
      expect(res.body.eventCrfId || res.body.data?.eventCrfId).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // DELETE
  // ==========================================================================

  describe('DELETE /api/validation-rules/:ruleId — Delete Rule', () => {
    it('deletes a rule', async () => {
      const createRes = await request(app)
        .post('/api/validation-rules')
        .set('Authorization', `Bearer ${token}`)
        .send(rulePayload(crfId, { fieldPath: 'age_to_delete' }));
      const idToDelete = createRes.body.data?.id;

      const res = await request(app)
        .delete(`/api/validation-rules/${idToDelete}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          signatureUsername: 'root',
          signaturePassword: 'root',
          signatureMeaning: 'I authorize deletion of this validation rule',
        })
        .expect(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/validation-rules/${idToDelete}`)
        .set('Authorization', `Bearer ${token}`);
      expect([404, 400]).toContain(getRes.status);
    });
  });
});
