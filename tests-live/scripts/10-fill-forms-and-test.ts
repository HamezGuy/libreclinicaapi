/**
 * Script 10 — Fill Forms and Test Validation / Workflow Triggers
 *
 * For each visit:
 *   1. Schedule remaining visits (Baseline, Follow-Up) for the patient
 *   2. Fill all 6 eCRFs with VALID data — expect success
 *   3. Attempt INVALID data on validation + workflow eCRFs — log validation errors
 *   4. Check if workflow queries were auto-generated
 *   5. Try edge cases: empty form, wrong types, duplicate submission
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logWarn, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '10-fill-forms-and-test';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Valid form data for the "General Assessment" type eCRFs ─────────────────

const VALID_GENERAL_DATA: Record<string, any> = {
  assessment_date: todayStr(),
  pain_level: '5',
  has_allergies: 'yes',
  reported_symptoms: ['headache', 'fatigue'],
  heart_rate: 72,
  blood_pressure: '120/80',
  temperature: 36.6,
  treatment_response: 'SD',
  clinical_notes: 'Patient presents with stable vitals. No significant adverse events reported during this visit.',
  next_visit_date: futureDate(14),
};

// ─── Valid form data for the "Lab Results" type eCRFs ────────────────────────

const VALID_LAB_DATA: Record<string, any> = {
  patient_height: 175,
  patient_weight: 78,
  // bmi_calculated omitted — it's a calculation field, value is computed server-side
  lab_results_table: JSON.stringify([
    { test_name: 'WBC', result_value: 7.2, unit: 'k_ul', ref_range: '4.5-11.0', flag: 'normal', comments: '' },
    { test_name: 'Hemoglobin', result_value: 14.1, unit: 'g_dl', ref_range: '13.5-17.5', flag: 'normal', comments: '' },
    { test_name: 'Platelet Count', result_value: 250, unit: 'k_ul', ref_range: '150-400', flag: 'normal', comments: '' },
    { test_name: 'ALT', result_value: 22, unit: 'u_l', ref_range: '7-56', flag: 'normal', comments: 'Within limits' },
    { test_name: 'Creatinine', result_value: 1.0, unit: 'mg_dl', ref_range: '0.7-1.3', flag: 'normal', comments: '' },
  ]),
  inclusion_criteria: JSON.stringify({
    age_eligible: true,
    consent_signed: true,
    diagnosis_confirmed: true,
    organ_function: true,
    ecog_status: true,
    no_prior_treatment: true,
  }),
  ae_assessment: JSON.stringify({
    nausea_vomiting: 'none',
    diarrhea: 'none',
    fatigue: 'grade1',
    rash: 'none',
    neutropenia: 'none',
    neuropathy: 'none',
    hepatotoxicity: 'none',
  }),
  concomitant_meds: JSON.stringify([
    { med_name: 'Acetaminophen', dose: '500 mg', route: 'oral', frequency: 'prn', start_date: todayStr(), ongoing: true },
  ]),
  specimen_notes: 'Blood samples collected per protocol. Centrifuged within 30 min. Stored at -80C.',
};

// ─── Invalid data to trigger validation rules ───────────────────────────────

const INVALID_GENERAL_DATA: Record<string, any> = {
  assessment_date: '',           // Required — should trigger error
  pain_level: '15',              // Out of 1-10 range — should trigger warning
  has_allergies: 'yes',
  reported_symptoms: '',
  heart_rate: 999,               // Out of 40-200 range — should trigger error
  blood_pressure: '120/80',
  temperature: 36.6,
  treatment_response: 'SD',
  clinical_notes: 'Short',       // Less than 10 chars — should trigger warning
  next_visit_date: '',
};

const INVALID_LAB_DATA: Record<string, any> = {
  patient_height: 300,           // Out of 50-250 range — should trigger error
  patient_weight: 300,           // Out of 20-250 range — should trigger error
  // bmi_calculated omitted — calculation field, server-computed
  lab_results_table: JSON.stringify([
    { test_name: '', result_value: 5000, unit: 'mg_dl', ref_range: '', flag: 'critical', comments: '' },
    // test_name empty → required error; result_value 5000 → range error (0-1000)
  ]),
  inclusion_criteria: JSON.stringify({}),
  ae_assessment: JSON.stringify({}),
  specimen_notes: '',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function isGeneralCrf(crfId: number | undefined, state: any): boolean {
  return crfId === state.baseCrf1Id
    || crfId === state.validationCrf1Id
    || crfId === state.workflowCrf1Id;
}

async function scheduleVisit(
  subjectId: number,
  eventDefId: number,
  startDate: string,
  label: string,
): Promise<number | null> {
  const res = await apiCall({
    method: 'POST',
    url: '/events/schedule',
    script: SCRIPT,
    step: `Schedule ${label}`,
    data: {
      studySubjectId: subjectId,
      studyEventDefinitionId: eventDefId,
      startDate,
      location: 'Boston General Hospital',
    },
  });

  if (res.ok) {
    const d = res.data as any;
    const seId = d.data?.studyEventId ?? d.studyEventId ?? d.data?.study_event_id;
    logPass(SCRIPT, `${label} scheduled (study_event ID: ${seId})`);
    return seId;
  }
  return null;
}

async function fillForm(
  studyId: number,
  subjectId: number,
  eventDefId: number,
  crfId: number,
  formData: Record<string, any>,
  label: string,
  expectSuccess: boolean,
): Promise<{ ok: boolean; data: any }> {
  const res = await apiCall({
    method: 'POST',
    url: '/forms/save',
    script: SCRIPT,
    step: label,
    data: {
      studyId,
      subjectId,
      studyEventDefinitionId: eventDefId,
      crfId,
      formData,
    },
  });

  if (res.ok && expectSuccess) {
    const d = res.data as any;
    logPass(SCRIPT, `${label} — saved (eventCrfId: ${d.eventCrfId ?? d.data?.eventCrfId ?? '?'})`);
  } else if (!res.ok && !expectSuccess) {
    logPass(SCRIPT, `${label} — correctly rejected (${res.status}): ${typeof res.data === 'object' ? (res.data as any).message : res.data}`);
  } else if (res.ok && !expectSuccess) {
    logFail(SCRIPT, label, `POST /forms/save (crfId: ${crfId})`, res.status,
      'Expected rejection but request SUCCEEDED — validation rules did NOT trigger');
  }
  // if !res.ok && expectSuccess, logFail was already called by apiCall

  return { ok: res.ok, data: res.data };
}

async function checkQueries(studyId: number): Promise<void> {
  logInfo('Checking for auto-generated queries...');

  const res = await apiCall({
    method: 'GET',
    url: '/queries',
    script: SCRIPT,
    step: 'Fetch queries for study',
    params: { studyId, limit: 50 },
  });

  if (!res.ok) return;

  const d = res.data as any;
  const queries = d.data ?? d.queries ?? [];
  const queryList = Array.isArray(queries) ? queries : (queries.items ?? []);

  if (queryList.length === 0) {
    logInfo('No queries found for this study (workflow may not auto-generate on save)');
    return;
  }

  logPass(SCRIPT, `Found ${queryList.length} query/queries for the study`);
  for (const q of queryList.slice(0, 10)) {
    const assignee = q.assignedUsername ?? q.assigned_user ?? q.assignedTo ?? 'unassigned';
    const status = q.statusName ?? q.resolution_status ?? q.status ?? '?';
    logPass(SCRIPT, `  Query #${q.id ?? q.discrepancy_note_id}: "${q.description?.substring(0, 60)}" [${status}] → ${assignee}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<boolean> {
  logHeader('10 — Fill Forms and Test');

  const state = loadState();

  if (!state.studyId || !state.subjectId) {
    logFail(SCRIPT, 'Check prerequisites', 'state', 0,
      `Missing studyId (${state.studyId}) or subjectId (${state.subjectId}) — scripts 06 and 09 must pass first`);
    return false;
  }

  const eventDefIds = state.eventDefinitionIds ?? [];
  if (eventDefIds.length === 0) {
    logFail(SCRIPT, 'Check event definitions', 'state', 0,
      'No eventDefinitionIds in state — script 06 must populate these from GET /studies/:id');
    return false;
  }
  if (eventDefIds.length < 3) {
    logWarn(SCRIPT, 'Event definitions', `Only ${eventDefIds.length} found, expected 3 — some tests will be limited`);
  }

  const allCrfIds = [
    state.baseCrf1Id, state.baseCrf2Id,
    state.validationCrf1Id, state.validationCrf2Id,
    state.workflowCrf1Id, state.workflowCrf2Id,
  ].filter(Boolean) as number[];

  // ── Step 1: Check existing visits (script 09 already schedules all 3) ─────

  let existingEventIds = [...(state.studyEventIds ?? [])];

  if (existingEventIds.length >= 3) {
    logPass(SCRIPT, `Patient already has ${existingEventIds.length} visits scheduled — using those`);
  } else {
    // Try to schedule any missing visits
    if (eventDefIds.length >= 2 && existingEventIds.length < 2) {
      const id = await scheduleVisit(state.subjectId, eventDefIds[1], futureDate(7), 'Baseline Visit');
      if (id) existingEventIds.push(id);
    }
    if (eventDefIds.length >= 3 && existingEventIds.length < 3) {
      const id = await scheduleVisit(state.subjectId, eventDefIds[2], futureDate(30), 'Follow-Up Visit');
      if (id) existingEventIds.push(id);
    }
    updateState({ studyEventIds: existingEventIds });
  }

  // ── Step 2: Fill forms with VALID data for the first visit (Screening) ────

  logInfo('--- Phase 2: Fill all 6 eCRFs with VALID data (Screening Visit) ---');

  const screeningEventDefId = eventDefIds[0];
  if (!screeningEventDefId) {
    logFail(SCRIPT, 'Get screening event definition', 'state.eventDefinitionIds[0]', 0,
      'First event definition ID is missing — cannot fill forms without a screening visit');
    return false;
  }

  const eventCrfIds: number[] = [];

  for (const crfId of allCrfIds) {
    const isGeneral = isGeneralCrf(crfId, state);
    const formData = isGeneral ? VALID_GENERAL_DATA : VALID_LAB_DATA;
    const typeName = isGeneral ? 'General' : 'Lab';

    const result = await fillForm(
      state.studyId,
      state.subjectId,
      screeningEventDefId,
      crfId,
      formData,
      `[VALID] Fill CRF ${crfId} (${typeName}) — Screening`,
      true,
    );

    if (result.ok) {
      const ecId = (result.data as any)?.eventCrfId ?? (result.data as any)?.data?.eventCrfId;
      if (ecId) eventCrfIds.push(ecId);
    }
  }

  updateState({ eventCrfIds });

  // ── Step 3: Try INVALID data on validation + workflow eCRFs ───────────────

  logInfo('--- Phase 3: Submit INVALID data to trigger validation rules ---');

  const validationAndWorkflowCrfs = [
    { id: state.validationCrf1Id, type: 'general', label: 'Validation eCRF 1' },
    { id: state.validationCrf2Id, type: 'lab', label: 'Validation eCRF 2' },
    { id: state.workflowCrf1Id, type: 'general', label: 'Workflow eCRF 1' },
    { id: state.workflowCrf2Id, type: 'lab', label: 'Workflow eCRF 2' },
  ];

  // Use the Baseline visit for invalid data tests
  const baselineEventDefId = eventDefIds[1] ?? screeningEventDefId;

  for (const crf of validationAndWorkflowCrfs) {
    if (!crf.id) continue;
    const formData = crf.type === 'general' ? INVALID_GENERAL_DATA : INVALID_LAB_DATA;

    await fillForm(
      state.studyId,
      state.subjectId,
      baselineEventDefId,
      crf.id,
      formData,
      `[INVALID] ${crf.label} (CRF ${crf.id}) — expect validation errors`,
      false, // We expect this to fail or return warnings
    );
  }

  // ── Step 4: Edge cases ────────────────────────────────────────────────────

  logInfo('--- Phase 4: Edge cases ---');

  // Edge case 1: Submit completely empty form
  if (allCrfIds[0]) {
    await fillForm(
      state.studyId,
      state.subjectId,
      baselineEventDefId,
      allCrfIds[0],
      {},
      '[EDGE] Empty form data (no fields)',
      false,
    );
  }

  // Edge case 2: Submit with wrong data types
  if (state.baseCrf1Id) {
    await fillForm(
      state.studyId,
      state.subjectId,
      baselineEventDefId,
      state.baseCrf1Id,
      {
        heart_rate: 'not_a_number',
        assessment_date: 12345,
        pain_level: { invalid: true },
      },
      '[EDGE] Wrong data types (string for number, number for date, object for radio)',
      false,
    );
  }

  // Edge case 3: Duplicate submission (same CRF again for same visit)
  if (allCrfIds[0]) {
    const dupeData = isGeneralCrf(allCrfIds[0], state) ? VALID_GENERAL_DATA : VALID_LAB_DATA;
    await fillForm(
      state.studyId,
      state.subjectId,
      screeningEventDefId,
      allCrfIds[0],
      dupeData,
      '[EDGE] Duplicate submission (same CRF + visit)',
      true, // May succeed as an update, or may fail as duplicate
    );
  }

  // ── Step 5: Check for auto-generated queries ─────────────────────────────

  logInfo('--- Phase 5: Check queries ---');
  await checkQueries(state.studyId);

  // Also check my-assigned for the monitor
  if (state.member2UserId) {
    const myRes = await apiCall({
      method: 'GET',
      url: `/workflows/user/${state.member2UserId}`,
      script: SCRIPT,
      step: 'Check monitor workflow tasks',
    });
    if (myRes.ok) {
      const tasks = (myRes.data as any).data ?? myRes.data;
      const taskList = Array.isArray(tasks) ? tasks : [];
      logPass(SCRIPT, `Monitor user has ${taskList.length} workflow task(s)`);
    }
  }

  logPass(SCRIPT, 'Form filling and testing complete');
  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
