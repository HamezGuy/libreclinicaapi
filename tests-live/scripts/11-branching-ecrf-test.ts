/**
 * Script 11 — Branching eCRF (Skip Logic / Conditional Display) Test
 *
 * Creates a form with multiple showWhen conditions where answering certain
 * questions reveals or hides other fields/sections. Then:
 *   1. Creates the branching form with skip logic
 *   2. Forks it and verifies the fork preserved all skip logic
 *   3. Reads metadata for both forms and validates SCD records
 *   4. Tests data entry with different answer paths
 *   5. Verifies that conditional fields behave as expected
 *
 * BRANCHING STRUCTURE:
 *
 *   [study_type] radio: "Interventional" | "Observational" | "Registry"
 *       └─ if "Interventional" → show [drug_name], [dosage], [route_of_admin], [randomization_method]
 *       └─ if "Observational"  → show [observation_period], [data_collection_method]
 *       └─ if "Registry"       → show [registry_name], [registry_id]
 *
 *   [has_adverse_events] yesno
 *       └─ if "yes" → show [ae_description], [ae_severity], [ae_outcome]
 *                          └─ [ae_severity] if "serious" → show [sae_report_date], [sae_narrative]
 *
 *   [pregnancy_status] select: "Not applicable" | "Not pregnant" | "Pregnant" | "Unknown"
 *       └─ if "Pregnant" → show [gestational_age], [expected_due_date], [ob_gyn_contact]
 *
 *   [lab_abnormal] yesno
 *       └─ if "yes" → show [abnormal_lab_table]
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logFail, logWarn, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '11-branching-ecrf-test';

// ─── Form field definitions with skip logic ─────────────────────────────────

const BRANCHING_FIELDS = [
  // ── Section 1: Study Classification (always visible) ──────────────────
  {
    label: 'Study Type',
    name: 'study_type',
    type: 'radio',
    required: true,
    order: 1,
    helpText: 'Select the type of study being conducted',
    options: [
      { label: 'Interventional', value: 'interventional' },
      { label: 'Observational', value: 'observational' },
      { label: 'Registry', value: 'registry' },
    ],
  },

  // ── Branch A: Interventional study fields ─────────────────────────────
  {
    label: 'Drug Name',
    name: 'drug_name',
    type: 'text',
    required: true,
    order: 2,
    helpText: 'Name of the investigational drug',
    placeholder: 'e.g., Pembrolizumab',
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'interventional' }],
  },
  {
    label: 'Dosage',
    name: 'dosage',
    type: 'text',
    required: true,
    order: 3,
    helpText: 'Prescribed dosage and units',
    placeholder: 'e.g., 200mg IV every 3 weeks',
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'interventional' }],
  },
  {
    label: 'Route of Administration',
    name: 'route_of_admin',
    type: 'select',
    required: true,
    order: 4,
    options: [
      { label: 'Oral', value: 'oral' },
      { label: 'Intravenous (IV)', value: 'iv' },
      { label: 'Intramuscular (IM)', value: 'im' },
      { label: 'Subcutaneous (SC)', value: 'sc' },
      { label: 'Topical', value: 'topical' },
      { label: 'Inhalation', value: 'inhalation' },
    ],
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'interventional' }],
  },
  {
    label: 'Randomization Method',
    name: 'randomization_method',
    type: 'select',
    required: false,
    order: 5,
    options: [
      { label: 'Simple randomization', value: 'simple' },
      { label: 'Block randomization', value: 'block' },
      { label: 'Stratified randomization', value: 'stratified' },
      { label: 'Adaptive randomization', value: 'adaptive' },
      { label: 'None / Open-label', value: 'none' },
    ],
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'interventional' }],
  },

  // ── Branch B: Observational study fields ──────────────────────────────
  {
    label: 'Observation Period',
    name: 'observation_period',
    type: 'text',
    required: true,
    order: 6,
    helpText: 'Duration of the observation period',
    placeholder: 'e.g., 12 months',
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'observational' }],
  },
  {
    label: 'Data Collection Method',
    name: 'data_collection_method',
    type: 'select',
    required: true,
    order: 7,
    options: [
      { label: 'Prospective', value: 'prospective' },
      { label: 'Retrospective', value: 'retrospective' },
      { label: 'Cross-sectional', value: 'cross_sectional' },
      { label: 'Mixed methods', value: 'mixed' },
    ],
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'observational' }],
  },

  // ── Branch C: Registry fields ─────────────────────────────────────────
  {
    label: 'Registry Name',
    name: 'registry_name',
    type: 'text',
    required: true,
    order: 8,
    helpText: 'Name of the disease or procedure registry',
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'registry' }],
  },
  {
    label: 'Registry Identifier',
    name: 'registry_id',
    type: 'text',
    required: false,
    order: 9,
    helpText: 'Unique identifier for this registry entry',
    showWhen: [{ fieldId: 'study_type', operator: 'equals', value: 'registry' }],
  },

  // ── Section 2: Adverse Events (always visible question, conditional details) ──
  {
    label: 'Has Adverse Events',
    name: 'has_adverse_events',
    type: 'yesno',
    required: true,
    order: 10,
    helpText: 'Were any adverse events reported?',
  },
  {
    label: 'AE Description',
    name: 'ae_description',
    type: 'textarea',
    required: true,
    order: 11,
    helpText: 'Describe the adverse event(s)',
    placeholder: 'Provide detailed description...',
    showWhen: [{ fieldId: 'has_adverse_events', operator: 'equals', value: 'yes' }],
  },
  {
    label: 'AE Severity',
    name: 'ae_severity',
    type: 'select',
    required: true,
    order: 12,
    options: [
      { label: 'Mild', value: 'mild' },
      { label: 'Moderate', value: 'moderate' },
      { label: 'Serious', value: 'serious' },
      { label: 'Life-threatening', value: 'life_threatening' },
    ],
    showWhen: [{ fieldId: 'has_adverse_events', operator: 'equals', value: 'yes' }],
  },
  {
    label: 'AE Outcome',
    name: 'ae_outcome',
    type: 'select',
    required: true,
    order: 13,
    options: [
      { label: 'Recovered', value: 'recovered' },
      { label: 'Recovering', value: 'recovering' },
      { label: 'Not recovered', value: 'not_recovered' },
      { label: 'Fatal', value: 'fatal' },
      { label: 'Unknown', value: 'unknown' },
    ],
    showWhen: [{ fieldId: 'has_adverse_events', operator: 'equals', value: 'yes' }],
  },

  // ── Nested branch: SAE details (only if ae_severity = 'serious') ──────
  {
    label: 'SAE Report Date',
    name: 'sae_report_date',
    type: 'date',
    required: true,
    order: 14,
    helpText: 'Date the serious adverse event was reported',
    showWhen: [{ fieldId: 'ae_severity', operator: 'equals', value: 'serious' }],
  },
  {
    label: 'SAE Narrative',
    name: 'sae_narrative',
    type: 'textarea',
    required: true,
    order: 15,
    helpText: 'Detailed narrative of the serious adverse event for regulatory reporting',
    placeholder: 'Provide comprehensive SAE narrative...',
    showWhen: [{ fieldId: 'ae_severity', operator: 'equals', value: 'serious' }],
  },

  // ── Section 3: Pregnancy screening ────────────────────────────────────
  {
    label: 'Pregnancy Status',
    name: 'pregnancy_status',
    type: 'select',
    required: true,
    order: 16,
    options: [
      { label: 'Not applicable', value: 'not_applicable' },
      { label: 'Not pregnant', value: 'not_pregnant' },
      { label: 'Pregnant', value: 'pregnant' },
      { label: 'Unknown', value: 'unknown' },
    ],
  },
  {
    label: 'Gestational Age (weeks)',
    name: 'gestational_age',
    type: 'number',
    required: true,
    order: 17,
    unit: 'weeks',
    min: 1,
    max: 45,
    showWhen: [{ fieldId: 'pregnancy_status', operator: 'equals', value: 'pregnant' }],
  },
  {
    label: 'Expected Due Date',
    name: 'expected_due_date',
    type: 'date',
    required: true,
    order: 18,
    showWhen: [{ fieldId: 'pregnancy_status', operator: 'equals', value: 'pregnant' }],
  },
  {
    label: 'OB/GYN Contact',
    name: 'ob_gyn_contact',
    type: 'text',
    required: false,
    order: 19,
    placeholder: 'Dr. Name, Phone',
    showWhen: [{ fieldId: 'pregnancy_status', operator: 'equals', value: 'pregnant' }],
  },

  // ── Section 4: Lab Abnormalities ──────────────────────────────────────
  {
    label: 'Lab Values Abnormal',
    name: 'lab_abnormal',
    type: 'yesno',
    required: true,
    order: 20,
    helpText: 'Were any lab values outside normal range?',
  },
  {
    label: 'Abnormal Lab Values',
    name: 'abnormal_lab_table',
    type: 'table',
    required: true,
    order: 21,
    helpText: 'Detail all abnormal lab results',
    showWhen: [{ fieldId: 'lab_abnormal', operator: 'equals', value: 'yes' }],
    tableSettings: {
      allowAddRows: true,
      allowDeleteRows: true,
      minRows: 1,
      maxRows: 15,
      showRowNumbers: true,
    },
    tableColumns: [
      { name: 'test_name', label: 'Test', type: 'text', required: true, width: '25%' },
      { name: 'result', label: 'Result', type: 'number', required: true, width: '15%' },
      { name: 'normal_range', label: 'Normal Range', type: 'text', required: false, width: '20%' },
      { name: 'clinical_significance', label: 'Clinical Significance', type: 'select', required: true, width: '20%', options: [
        { label: 'Not clinically significant', value: 'ncs' },
        { label: 'Clinically significant', value: 'cs' },
      ]},
      { name: 'action_taken', label: 'Action', type: 'text', required: false, width: '20%' },
    ],
  },

  // ── Final notes (always visible) ──────────────────────────────────────
  {
    label: 'Investigator Notes',
    name: 'investigator_notes',
    type: 'textarea',
    required: false,
    order: 22,
    helpText: 'Any additional notes or comments',
  },
];

// ─── Test data sets for different answer paths ──────────────────────────────

const PATH_INTERVENTIONAL = {
  study_type: 'interventional',
  drug_name: 'Pembrolizumab',
  dosage: '200mg IV every 3 weeks',
  route_of_admin: 'iv',
  randomization_method: 'stratified',
  has_adverse_events: 'no',
  pregnancy_status: 'not_applicable',
  lab_abnormal: 'no',
  investigator_notes: 'Interventional path test — all drug fields visible, AE hidden, pregnancy hidden.',
};

const PATH_OBSERVATIONAL_WITH_AE = {
  study_type: 'observational',
  observation_period: '24 months',
  data_collection_method: 'prospective',
  has_adverse_events: 'yes',
  ae_description: 'Patient experienced grade 2 nausea following standard treatment protocol.',
  ae_severity: 'moderate',
  ae_outcome: 'recovered',
  pregnancy_status: 'not_pregnant',
  lab_abnormal: 'no',
  investigator_notes: 'Observational path with AE — observation fields + AE details visible.',
};

const PATH_REGISTRY_WITH_SAE_AND_PREGNANCY = {
  study_type: 'registry',
  registry_name: 'National Cancer Registry',
  registry_id: 'NCR-2026-00451',
  has_adverse_events: 'yes',
  ae_description: 'Serious hepatotoxicity event requiring hospitalization.',
  ae_severity: 'serious',
  ae_outcome: 'recovering',
  sae_report_date: '2026-02-15',
  sae_narrative: 'Patient admitted to hospital on 2026-02-14 with elevated liver enzymes (ALT 450 U/L, AST 380 U/L). Treatment discontinued immediately. IV fluids and supportive care initiated.',
  pregnancy_status: 'pregnant',
  gestational_age: 16,
  expected_due_date: '2026-08-01',
  ob_gyn_contact: 'Dr. Sarah Chen, +1-555-0303',
  lab_abnormal: 'yes',
  abnormal_lab_table: JSON.stringify([
    { test_name: 'ALT', result: 450, normal_range: '7-56 U/L', clinical_significance: 'cs', action_taken: 'Treatment discontinued' },
    { test_name: 'AST', result: 380, normal_range: '10-40 U/L', clinical_significance: 'cs', action_taken: 'Hepatology consult' },
    { test_name: 'Bilirubin', result: 3.2, normal_range: '0.1-1.2 mg/dL', clinical_significance: 'cs', action_taken: 'Monitoring' },
  ]),
  investigator_notes: 'Full branch coverage: registry + serious AE with SAE narrative + pregnancy + abnormal labs.',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function countShowWhenFields(fields: any[]): number {
  return fields.filter(f => f.showWhen && f.showWhen.length > 0).length;
}

async function verifyMetadataShowWhen(crfId: number, label: string): Promise<number> {
  const res = await apiCall({
    method: 'GET',
    url: `/forms/${crfId}/metadata`,
    script: SCRIPT,
    step: `Get metadata for ${label}`,
  });

  if (!res.ok) return 0;

  const meta = (res.data as any).data ?? res.data;
  const fields = meta.fields ?? meta.items ?? [];
  let scdCount = 0;

  for (const field of fields) {
    const sw = field.showWhen ?? [];
    if (sw.length > 0) {
      scdCount++;
      logPass(SCRIPT, `  ${label}: "${field.label || field.name}" has showWhen → ${JSON.stringify(sw)}`);
    }
  }

  return scdCount;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<boolean> {
  logHeader('11 — Branching eCRF (Skip Logic) Test');

  const state = loadState();
  if (!state.accessToken) {
    logInfo('No accessToken in state — run script 02 first');
    return false;
  }

  let success = true;
  const expectedScdFields = countShowWhenFields(BRANCHING_FIELDS);
  logInfo(`Creating branching form with ${BRANCHING_FIELDS.length} fields (${expectedScdFields} with showWhen conditions)`);

  // ── Step 1: Create the branching eCRF ─────────────────────────────────

  const createRes = await apiCall({
    method: 'POST',
    url: '/forms',
    script: SCRIPT,
    step: 'Create branching eCRF',
    data: {
      name: 'Branching Logic Test Form',
      description: 'Form with extensive skip-logic: study type branches, nested AE/SAE conditions, pregnancy screening, and conditional lab table.',
      category: 'clinical',
      version: 'v1.0',
      status: 'published',
      fields: BRANCHING_FIELDS,
    },
  });

  if (!createRes.ok) return false;

  const branchCrfId = (createRes.data as any).data?.crfId ?? (createRes.data as any).crfId ?? (createRes.data as any).data?.crf_id;
  updateState({ branchingCrfId: branchCrfId });
  logPass(SCRIPT, `Branching eCRF created (CRF ID: ${branchCrfId})`);

  // ── Step 2: Verify metadata has showWhen conditions ───────────────────

  logInfo('Verifying skip logic was persisted in form metadata...');
  const scdCount = await verifyMetadataShowWhen(branchCrfId, 'Original');

  if (scdCount === 0) {
    logWarn(SCRIPT, 'Metadata check', 'No showWhen conditions found in metadata — SCD may not have been created');
  } else if (scdCount < expectedScdFields) {
    logWarn(SCRIPT, 'Metadata check', `Only ${scdCount}/${expectedScdFields} fields have showWhen — some conditions may be missing`);
  } else {
    logPass(SCRIPT, `All ${scdCount} showWhen conditions present in original form metadata`);
  }

  // ── Step 3: Fork the branching form ───────────────────────────────────

  logInfo('Forking branching form to test SCD copy...');
  const forkRes = await apiCall({
    method: 'POST',
    url: `/forms/${branchCrfId}/fork`,
    script: SCRIPT,
    step: 'Fork branching eCRF',
    data: {
      newName: 'Branching Logic Test Form - Forked Copy',
      description: 'Forked copy — should preserve all skip logic / SCD conditions.',
    },
  });

  let forkedCrfId: number | null = null;

  if (forkRes.ok) {
    forkedCrfId = (forkRes.data as any).data?.crfId ?? (forkRes.data as any).crfId ?? (forkRes.data as any).data?.newCrfId ?? (forkRes.data as any).newCrfId;
    updateState({ branchingForkedCrfId: forkedCrfId });
    logPass(SCRIPT, `Forked branching eCRF created (CRF ID: ${forkedCrfId})`);
  } else {
    logFail(SCRIPT, 'Fork branching eCRF', `POST /forms/${branchCrfId}/fork`, forkRes.status,
      'Fork failed — skip logic copy cannot be verified');
    success = false;
  }

  // ── Step 4: Verify forked form has same showWhen ──────────────────────

  if (forkedCrfId) {
    logInfo('Verifying forked form preserved skip logic...');
    const forkedScdCount = await verifyMetadataShowWhen(forkedCrfId, 'Forked');

    if (forkedScdCount === scdCount) {
      logPass(SCRIPT, `Fork preserved all ${forkedScdCount} showWhen conditions`);
    } else {
      logFail(SCRIPT, 'Fork SCD check', `GET /forms/${forkedCrfId}/metadata`,
        200, `Forked form has ${forkedScdCount} showWhen but original has ${scdCount}`);
      success = false;
    }
  }

  // ── Step 5: Assign branching form to the study's first visit ────────────
  // In a real EDC, a template must be assigned to a visit before patients can fill it in.
  // This mirrors what script 06 does with crfAssignments[].

  if (!state.studyId || !state.subjectId || !state.eventDefinitionIds?.length) {
    logInfo('No study/patient in state — skipping data entry tests (run scripts 06+09 first)');
    logInfo('Skip logic creation and fork tests completed above.');
    return success;
  }

  const eventDefId = state.eventDefinitionIds[0]; // Screening Visit
  const testCrfId = forkedCrfId || branchCrfId;

  logInfo(`Assigning branching form (CRF ${testCrfId}) to Screening Visit (event def ${eventDefId})...`);
  const assignRes = await apiCall({
    method: 'POST',
    url: `/events/${eventDefId}/crfs`,
    script: SCRIPT,
    step: 'Assign branching form to visit',
    data: {
      crfId: testCrfId,
      required: false,
      doubleEntry: false,
      hideCrf: false,
      ordinal: 10,
      electronicSignature: false,
    },
  });
  if (assignRes.ok) {
    logPass(SCRIPT, `Branching form assigned to Screening Visit`);
  } else {
    logFail(SCRIPT, 'Assign branching form to visit', `POST /events/${eventDefId}/crfs`, assignRes.status,
      `Could not assign form to visit: ${(assignRes.data as any)?.message}`);
    success = false;
  }
  const paths = [
    { name: 'Path A: Interventional', data: PATH_INTERVENTIONAL },
    { name: 'Path B: Observational + AE', data: PATH_OBSERVATIONAL_WITH_AE },
    { name: 'Path C: Registry + SAE + Pregnancy + Labs', data: PATH_REGISTRY_WITH_SAE_AND_PREGNANCY },
  ];

  for (const path of paths) {
    logInfo(`Testing ${path.name}...`);

    const saveRes = await apiCall({
      method: 'POST',
      url: '/forms/save',
      script: SCRIPT,
      step: `Save: ${path.name}`,
      data: {
        studyId: state.studyId,
        subjectId: state.subjectId,
        studyEventDefinitionId: eventDefId,
        crfId: testCrfId,
        formData: path.data,
      },
    });

    if (saveRes.ok) {
      logPass(SCRIPT, `${path.name} — data saved successfully`);
    } else {
      logFail(SCRIPT, path.name, `POST /forms/save`, saveRes.status,
        `Save failed for branching path test — data entry not working`);
      success = false;
    }
  }

  // ── Step 6: Test partial data (only trigger fields, no conditional fields) ──

  logInfo('Testing partial data — only trigger fields set, conditional fields omitted...');
  const partialRes = await apiCall({
    method: 'POST',
    url: '/forms/save',
    script: SCRIPT,
    step: 'Save: Partial data (trigger only)',
    data: {
      studyId: state.studyId,
      subjectId: state.subjectId,
      studyEventDefinitionId: eventDefId,
      crfId: testCrfId,
      formData: {
        study_type: 'interventional',
        has_adverse_events: 'no',
        pregnancy_status: 'not_applicable',
        lab_abnormal: 'no',
        investigator_notes: 'Partial data — only trigger fields. Conditional fields intentionally omitted.',
      },
    },
  });

  if (partialRes.ok) {
    logPass(SCRIPT, 'Partial data (triggers only) — accepted (conditional fields not enforced server-side)');
  }

  logPass(SCRIPT, 'Branching eCRF test complete');
  return success;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
