/**
 * Script 12 — Diagnose Warning Query Generation
 *
 * Targeted test to verify that soft validation warnings (severity: 'warning')
 * properly generate discrepancy note queries. Tests three scenarios:
 *
 *   A. Warnings ONLY (no hard errors)  → should save + create queries
 *   B. Hard errors + warnings together  → should block save, no queries
 *   C. Re-submit (A) fixing warnings    → should save, no NEW queries
 *
 * Also dumps all queries linked to our study so we can inspect them.
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logWarn, logInfo } from '../lib/logger';
import { loadState } from '../lib/state';

const SCRIPT = '12-diagnose-warning-queries';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Data that triggers ONLY warnings — no hard errors
// (assessment_date is set, heart_rate in range → hard rules pass)
// (pain_level out of range → warning; clinical_notes short → warning)
const WARNINGS_ONLY_DATA: Record<string, any> = {
  assessment_date: todayStr(),
  pain_level: '15',               // Out of 1-10 → WARNING
  has_allergies: 'no',
  reported_symptoms: '',
  heart_rate: 80,                  // In range 40-200 → passes
  blood_pressure: '120/80',
  temperature: 36.6,
  treatment_response: 'SD',
  clinical_notes: 'Short',        // < 10 chars → WARNING
  next_visit_date: futureDate(14),
};

// Data that triggers both hard errors AND warnings
const ERRORS_AND_WARNINGS_DATA: Record<string, any> = {
  assessment_date: '',             // Required → ERROR
  pain_level: '15',               // Out of 1-10 → WARNING
  has_allergies: 'yes',
  reported_symptoms: '',
  heart_rate: 999,                 // Out of 40-200 → ERROR
  blood_pressure: '120/80',
  temperature: 36.6,
  treatment_response: 'SD',
  clinical_notes: 'Short',        // < 10 chars → WARNING
  next_visit_date: '',
};

// Lab data that triggers ONLY warnings (BMI out of range 10-60 → warning)
// lab_results_table fields have valid data so hard errors don't trigger
const LAB_WARNINGS_ONLY_DATA: Record<string, any> = {
  patient_height: 175,
  patient_weight: 300,           // Will make BMI ~98 → WARNING
  bmi_calculated: 97.9,
  lab_results_table: JSON.stringify([
    { test_name: 'WBC', result_value: 7.2, unit: 'k_ul', ref_range: '4.5-11.0', flag: 'normal', comments: '' },
  ]),
  inclusion_criteria: JSON.stringify({
    age_eligible: true, consent_signed: true, diagnosis_confirmed: true,
    organ_function: true, ecog_status: true, no_prior_treatment: true,
  }),
  ae_assessment: JSON.stringify({ nausea_vomiting: 'none' }),
  concomitant_meds: JSON.stringify([]),
  specimen_notes: 'Normal specimen processing.',
};

async function run(): Promise<boolean> {
  logHeader('12 — Diagnose Warning Query Generation');

  const state = loadState();

  if (!state.studyId || !state.subjectId || !state.eventDefinitionIds?.length) {
    logInfo('Missing state — run full suite first');
    return false;
  }

  const studyId = state.studyId;
  const subjectId = state.subjectId;
  // Use the Follow-Up visit (3rd event def) to avoid conflicts with previous data
  const eventDefId = state.eventDefinitionIds[2] ?? state.eventDefinitionIds[0];

  // ── Fetch query count BEFORE tests ─────────────────────────────────────────
  const beforeRes = await apiCall({
    method: 'GET', url: '/queries',
    script: SCRIPT, step: 'Count queries before test',
    params: { studyId, limit: 200 },
  });
  const beforeQueries = ((beforeRes.data as any)?.data ?? []);
  const beforeCount = Array.isArray(beforeQueries) ? beforeQueries.length : 0;
  logInfo(`Queries BEFORE test: ${beforeCount}`);

  // ══════════════════════════════════════════════════════════════════════════
  // TEST A: Submit data with ONLY warnings (no hard errors)
  //         to Validation eCRF 1 (General form with 4 rules: 2 error, 2 warning)
  // ══════════════════════════════════════════════════════════════════════════
  logInfo('─── TEST A: Warnings only (General eCRF) ───');
  const crfA = state.validationCrf1Id;
  if (!crfA) {
    logWarn(SCRIPT, 'TEST A', 'No validationCrf1Id in state');
    return false;
  }

  const resA = await apiCall({
    method: 'POST', url: '/forms/save',
    script: SCRIPT, step: 'TEST A: Submit with warnings only',
    data: { studyId, subjectId, studyEventDefinitionId: eventDefId, crfId: crfA, formData: WARNINGS_ONLY_DATA },
  });

  if (resA.ok) {
    const d = resA.data as any;
    logPass(SCRIPT, `TEST A: Save SUCCEEDED (eventCrfId: ${d.eventCrfId ?? d.data?.eventCrfId ?? '?'})`);
    logInfo(`  queriesCreated in response: ${d.queriesCreated ?? 'not present'}`);
    if (d.warnings?.length) logInfo(`  warnings in response: ${JSON.stringify(d.warnings)}`);
  } else {
    logWarn(SCRIPT, 'TEST A', `Save was BLOCKED (status ${resA.status})`);
    const d = resA.data as any;
    logInfo(`  errors: ${JSON.stringify(d?.errors)}`);
    logInfo(`  warnings: ${JSON.stringify(d?.warnings)}`);
    logInfo(`  queriesCreated: ${d?.queriesCreated}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST B: Submit data with hard errors + warnings (should block save)
  // ══════════════════════════════════════════════════════════════════════════
  logInfo('─── TEST B: Hard errors + warnings (General eCRF) ───');
  const crfB = state.workflowCrf1Id;
  if (!crfB) {
    logWarn(SCRIPT, 'TEST B', 'No workflowCrf1Id in state');
    return false;
  }

  const resB = await apiCall({
    method: 'POST', url: '/forms/save',
    script: SCRIPT, step: 'TEST B: Submit with errors + warnings',
    data: { studyId, subjectId, studyEventDefinitionId: eventDefId, crfId: crfB, formData: ERRORS_AND_WARNINGS_DATA },
  });

  if (resB.ok) {
    logWarn(SCRIPT, 'TEST B', 'Save SUCCEEDED — hard errors did not block!');
  } else {
    const d = resB.data as any;
    logPass(SCRIPT, `TEST B: Save BLOCKED as expected (status ${resB.status})`);
    logInfo(`  errors: ${JSON.stringify(d?.errors)}`);
    logInfo(`  warnings: ${JSON.stringify(d?.warnings)}`);
    logInfo(`  queriesCreated: ${d?.queriesCreated}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST C: Submit lab data with ONLY BMI warning
  // ══════════════════════════════════════════════════════════════════════════
  logInfo('─── TEST C: Lab eCRF BMI warning only ───');
  const crfC = state.validationCrf2Id;
  if (!crfC) {
    logWarn(SCRIPT, 'TEST C', 'No validationCrf2Id in state');
    return false;
  }

  const resC = await apiCall({
    method: 'POST', url: '/forms/save',
    script: SCRIPT, step: 'TEST C: Submit lab with BMI warning',
    data: { studyId, subjectId, studyEventDefinitionId: eventDefId, crfId: crfC, formData: LAB_WARNINGS_ONLY_DATA },
  });

  if (resC.ok) {
    const d = resC.data as any;
    logPass(SCRIPT, `TEST C: Save SUCCEEDED (eventCrfId: ${d.eventCrfId ?? d.data?.eventCrfId ?? '?'})`);
    logInfo(`  queriesCreated in response: ${d.queriesCreated ?? 'not present'}`);
  } else {
    logWarn(SCRIPT, 'TEST C', `Save was BLOCKED (status ${resC.status})`);
    const d = resC.data as any;
    logInfo(`  errors: ${JSON.stringify(d?.errors)}`);
    logInfo(`  warnings: ${JSON.stringify(d?.warnings)}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Check query count AFTER tests
  // ══════════════════════════════════════════════════════════════════════════
  logInfo('─── Query Comparison ───');

  const afterRes = await apiCall({
    method: 'GET', url: '/queries',
    script: SCRIPT, step: 'Count queries after test',
    params: { studyId, limit: 200 },
  });
  const afterQueries = ((afterRes.data as any)?.data ?? []);
  const afterCount = Array.isArray(afterQueries) ? afterQueries.length : 0;
  const newCount = afterCount - beforeCount;

  logInfo(`Queries AFTER test: ${afterCount}`);
  logInfo(`NEW queries created: ${newCount}`);

  // Dump the newest queries
  if (Array.isArray(afterQueries) && afterQueries.length > 0) {
    logInfo('─── All queries for this study (newest first) ───');
    const sorted = [...afterQueries].sort((a: any, b: any) => {
      const aId = a.id ?? a.discrepancy_note_id ?? 0;
      const bId = b.id ?? b.discrepancy_note_id ?? 0;
      return bId - aId;
    });
    for (const q of sorted.slice(0, 20)) {
      const qId = q.id ?? q.discrepancy_note_id;
      const desc = q.description ?? q.detailed_notes ?? '';
      const type = q.discrepancyNoteTypeId ?? q.discrepancy_note_type_id ?? q.noteType ?? '?';
      const status = q.statusName ?? q.resolution_status ?? q.status ?? '?';
      const assignee = q.assignedUsername ?? q.assigned_user ?? q.assignedTo ?? 'unassigned';
      const notes = (q.detailedNotes ?? q.detailed_notes ?? '').substring(0, 120);
      logInfo(`  Query #${qId}: type=${type} status=[${status}] → ${assignee}`);
      logInfo(`    desc: "${desc}"`);
      if (notes) logInfo(`    notes: "${notes}"`);
    }
  }

  // ── Verdict ─────────────────────────────────────────────────────────────
  logInfo('─── VERDICT ───');
  if (newCount >= 2) {
    logPass(SCRIPT, `WARNING queries ARE being created! (${newCount} new queries from warning-only submissions)`);
  } else if (newCount === 1) {
    logWarn(SCRIPT, 'VERDICT', `Only 1 new query — some warnings may not be generating queries`);
  } else {
    logWarn(SCRIPT, 'VERDICT', `NO new queries from warning-only submissions — WARNING→QUERY path is BROKEN`);
  }

  return true;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
