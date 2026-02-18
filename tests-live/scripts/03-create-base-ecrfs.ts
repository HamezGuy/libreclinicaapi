/**
 * Script 03 — Create 2 Base eCRF Templates
 *
 * eCRF 1 "General Assessment Form":
 *   radio buttons, yes/no, multiselect, text, number, date — all with options/data
 *
 * eCRF 2 "Lab Results & Procedures Form":
 *   table (filled with columns), criteria_list, question_table, calculation, file
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '03-create-base-ecrfs';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── eCRF 1 fields: Normal/common field types ───────────────────────────────

export const ECRF1_FIELDS = [
  {
    label: 'Assessment Date',
    name: 'assessment_date',
    type: 'date',
    required: true,
    order: 1,
    helpText: 'Date this assessment was performed',
    // defaultValue is set dynamically at call time — see createEcrf()
  },
  {
    label: 'Pain Level',
    name: 'pain_level',
    type: 'radio',
    required: true,
    order: 2,
    helpText: 'Rate the patient pain on a scale of 1-10',
    options: [
      { label: '1 - No pain', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' },
      { label: '4', value: '4' },
      { label: '5 - Moderate', value: '5' },
      { label: '6', value: '6' },
      { label: '7', value: '7' },
      { label: '8', value: '8' },
      { label: '9', value: '9' },
      { label: '10 - Worst', value: '10' },
    ],
    defaultValue: '3',
  },
  {
    label: 'Has Known Allergies',
    name: 'has_allergies',
    type: 'yesno',
    required: true,
    order: 3,
    helpText: 'Does the patient have any known allergies?',
    defaultValue: 'no',
  },
  {
    label: 'Reported Symptoms',
    name: 'reported_symptoms',
    type: 'checkbox',
    required: false,
    order: 4,
    helpText: 'Select all symptoms reported by the patient',
    options: [
      { label: 'Headache', value: 'headache' },
      { label: 'Nausea', value: 'nausea' },
      { label: 'Dizziness', value: 'dizziness' },
      { label: 'Fatigue', value: 'fatigue' },
      { label: 'Fever', value: 'fever' },
      { label: 'Cough', value: 'cough' },
      { label: 'Shortness of breath', value: 'shortness_of_breath' },
      { label: 'Joint pain', value: 'joint_pain' },
    ],
  },
  {
    label: 'Heart Rate',
    name: 'heart_rate',
    type: 'number',
    required: true,
    order: 5,
    unit: 'bpm',
    helpText: 'Resting heart rate in beats per minute',
    min: 30,
    max: 250,
    defaultValue: 72,
  },
  {
    label: 'Blood Pressure',
    name: 'blood_pressure',
    type: 'blood_pressure',
    required: true,
    order: 6,
    unit: 'mmHg',
    helpText: 'Systolic/Diastolic blood pressure',
  },
  {
    label: 'Temperature',
    name: 'temperature',
    type: 'temperature',
    required: false,
    order: 7,
    unit: '°C',
    helpText: 'Body temperature',
    defaultValue: 36.6,
  },
  {
    label: 'Treatment Response',
    name: 'treatment_response',
    type: 'select',
    required: true,
    order: 8,
    helpText: 'Overall response to current treatment',
    options: [
      { label: 'Complete Response (CR)', value: 'CR' },
      { label: 'Partial Response (PR)', value: 'PR' },
      { label: 'Stable Disease (SD)', value: 'SD' },
      { label: 'Progressive Disease (PD)', value: 'PD' },
      { label: 'Not Evaluable (NE)', value: 'NE' },
    ],
    defaultValue: 'SD',
  },
  {
    label: 'Clinical Notes',
    name: 'clinical_notes',
    type: 'textarea',
    required: false,
    order: 9,
    helpText: 'Any additional observations or notes',
    placeholder: 'Enter clinical observations here...',
    defaultValue: 'Patient presents with stable vitals. No significant changes since last visit.',
  },
  {
    label: 'Next Visit Date',
    name: 'next_visit_date',
    type: 'date',
    required: false,
    order: 10,
    helpText: 'Scheduled date for the next visit',
  },
];

// ─── eCRF 2 fields: Advanced/complex field types ────────────────────────────

export const ECRF2_FIELDS = [
  {
    label: 'Patient Height',
    name: 'patient_height',
    type: 'height',
    required: true,
    order: 1,
    unit: 'cm',
    helpText: 'Height in centimeters',
    defaultValue: 175,
  },
  {
    label: 'Patient Weight',
    name: 'patient_weight',
    type: 'weight',
    required: true,
    order: 2,
    unit: 'kg',
    helpText: 'Weight in kilograms',
    defaultValue: 78,
  },
  {
    label: 'BMI (Calculated)',
    name: 'bmi_calculated',
    type: 'calculation',
    required: false,
    order: 3,
    helpText: 'Body Mass Index — auto-calculated from height and weight',
    calculationFormula: 'patient_weight / ((patient_height / 100) * (patient_height / 100))',
    calculationType: 'field',
  },
  {
    label: 'Lab Results',
    name: 'lab_results_table',
    type: 'table',
    required: true,
    order: 4,
    helpText: 'Enter all laboratory test results',
    tableSettings: {
      allowAddRows: true,
      allowDeleteRows: true,
      minRows: 1,
      maxRows: 20,
      showRowNumbers: true,
    },
    tableColumns: [
      { name: 'test_name', label: 'Test Name', type: 'text', required: true, width: '25%', placeholder: 'e.g. WBC' },
      { name: 'result_value', label: 'Result', type: 'number', required: true, width: '15%', placeholder: '0.0' },
      { name: 'unit', label: 'Unit', type: 'select', required: true, width: '15%', options: [
        { label: 'mg/dL', value: 'mg_dl' },
        { label: 'mmol/L', value: 'mmol_l' },
        { label: 'g/dL', value: 'g_dl' },
        { label: 'U/L', value: 'u_l' },
        { label: 'x10^3/uL', value: 'k_ul' },
        { label: 'x10^6/uL', value: 'm_ul' },
        { label: '%', value: 'percent' },
      ]},
      { name: 'ref_range', label: 'Reference Range', type: 'text', required: false, width: '20%', placeholder: '4.5-11.0' },
      { name: 'flag', label: 'Flag', type: 'select', required: false, width: '10%', options: [
        { label: 'Normal', value: 'normal' },
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
        { label: 'Critical', value: 'critical' },
      ]},
      { name: 'comments', label: 'Comments', type: 'text', required: false, width: '15%' },
    ],
  },
  {
    label: 'Inclusion Criteria Checklist',
    name: 'inclusion_criteria',
    type: 'criteria_list',
    required: true,
    order: 5,
    helpText: 'Verify the patient meets all inclusion criteria',
    criteriaListSettings: {
      numbering: 'auto',
      requireAll: false,
    },
    options: [
      { label: 'Age 18-75 years', value: 'age_eligible' },
      { label: 'Signed informed consent', value: 'consent_signed' },
      { label: 'Confirmed diagnosis via imaging', value: 'diagnosis_confirmed' },
      { label: 'Adequate organ function per protocol', value: 'organ_function' },
      { label: 'ECOG performance status 0-2', value: 'ecog_status' },
      { label: 'No prior treatment with study drug class', value: 'no_prior_treatment' },
    ],
  },
  {
    label: 'Adverse Event Assessment',
    name: 'ae_assessment',
    type: 'question_table',
    required: false,
    order: 6,
    helpText: 'Rate each potential adverse event',
    questionTableSettings: {
      answerType: 'select',
      answerOptions: [
        { label: 'None', value: 'none' },
        { label: 'Mild (Grade 1)', value: 'grade1' },
        { label: 'Moderate (Grade 2)', value: 'grade2' },
        { label: 'Severe (Grade 3)', value: 'grade3' },
        { label: 'Life-threatening (Grade 4)', value: 'grade4' },
      ],
    },
    options: [
      { label: 'Nausea/Vomiting', value: 'nausea_vomiting' },
      { label: 'Diarrhea', value: 'diarrhea' },
      { label: 'Fatigue', value: 'fatigue' },
      { label: 'Rash/Dermatitis', value: 'rash' },
      { label: 'Neutropenia', value: 'neutropenia' },
      { label: 'Peripheral Neuropathy', value: 'neuropathy' },
      { label: 'Hepatotoxicity', value: 'hepatotoxicity' },
    ],
  },
  {
    label: 'Concomitant Medications',
    name: 'concomitant_meds',
    type: 'table',
    required: false,
    order: 7,
    helpText: 'List all concomitant medications',
    tableSettings: {
      allowAddRows: true,
      allowDeleteRows: true,
      minRows: 0,
      maxRows: 30,
      showRowNumbers: true,
    },
    tableColumns: [
      { name: 'med_name', label: 'Medication Name', type: 'text', required: true, width: '25%' },
      { name: 'dose', label: 'Dose', type: 'text', required: true, width: '15%', placeholder: '500 mg' },
      { name: 'route', label: 'Route', type: 'select', required: true, width: '15%', options: [
        { label: 'Oral', value: 'oral' },
        { label: 'IV', value: 'iv' },
        { label: 'IM', value: 'im' },
        { label: 'SC', value: 'sc' },
        { label: 'Topical', value: 'topical' },
      ]},
      { name: 'frequency', label: 'Frequency', type: 'select', required: true, width: '15%', options: [
        { label: 'QD (Once daily)', value: 'qd' },
        { label: 'BID (Twice daily)', value: 'bid' },
        { label: 'TID (Three times)', value: 'tid' },
        { label: 'PRN (As needed)', value: 'prn' },
      ]},
      { name: 'start_date', label: 'Start Date', type: 'date', required: false, width: '15%' },
      { name: 'ongoing', label: 'Ongoing', type: 'checkbox', required: false, width: '10%' },
    ],
  },
  {
    label: 'Specimen Collection Notes',
    name: 'specimen_notes',
    type: 'textarea',
    required: false,
    order: 8,
    helpText: 'Notes on specimen collection, handling, and shipment',
    placeholder: 'Describe specimen details...',
    defaultValue: 'Blood samples collected per protocol. Centrifuged within 30 min of draw. Stored at -80C.',
  },
  {
    label: 'Imaging Report Upload',
    name: 'imaging_upload',
    type: 'file',
    required: false,
    order: 9,
    helpText: 'Upload imaging reports (PDF, DICOM, or images)',
    allowedFileTypes: ['pdf', 'jpg', 'png', 'dcm'],
  },
];

async function createForm(name: string, description: string, fields: any[], stepLabel: string) {
  // Set dynamic defaults at call time (not module load time)
  const processedFields = fields.map(f => {
    if (f.name === 'assessment_date' && !f.defaultValue) {
      return { ...f, defaultValue: todayStr() };
    }
    return f;
  });

  const res = await apiCall({
    method: 'POST',
    url: '/forms',
    script: SCRIPT,
    step: stepLabel,
    data: {
      name,
      description,
      category: 'clinical',
      version: 'v1.0',
      status: 'published',
      fields: processedFields,
    },
  });

  if (res.ok) {
    const d = res.data as any;
    const crfId = d.data?.crfId ?? d.crfId ?? d.data?.crf_id ?? d.crf_id;
    const versionId = d.data?.crfVersionId ?? d.crfVersionId ?? d.data?.crf_version_id;
    logPass(SCRIPT, `${stepLabel} — CRF ID: ${crfId}, Version ID: ${versionId}`);
    return { crfId, versionId };
  }
  return null;
}

async function run(): Promise<boolean> {
  logHeader('03 — Create Base eCRF Templates');

  const state = loadState();
  if (!state.accessToken) {
    logInfo('No accessToken in state — run script 02 first');
    return false;
  }

  // eCRF 1 — General Assessment Form
  logInfo('Creating eCRF 1: General Assessment Form (10 normal fields)');
  const crf1 = await createForm(
    'General Assessment Form',
    'Standard clinical assessment form with common field types including vitals, symptoms, and clinical notes.',
    ECRF1_FIELDS,
    'Create eCRF 1 — General Assessment Form',
  );

  if (crf1) {
    updateState({ baseCrf1Id: crf1.crfId, baseCrf1VersionId: crf1.versionId });
  }

  // eCRF 2 — Lab Results & Procedures Form
  logInfo('Creating eCRF 2: Lab Results & Procedures Form (9 advanced fields)');
  const crf2 = await createForm(
    'Lab Results & Procedures Form',
    'Advanced form with data tables, criteria checklists, question tables, calculated fields, and file uploads.',
    ECRF2_FIELDS,
    'Create eCRF 2 — Lab Results & Procedures Form',
  );

  if (crf2) {
    updateState({ baseCrf2Id: crf2.crfId, baseCrf2VersionId: crf2.versionId });
  }

  return !!(crf1 && crf2);
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
