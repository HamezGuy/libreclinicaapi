/**
 * Script 07 — Create Validation Rules
 *
 * Adds validation rules to the 4 eCRFs that need them:
 *   - validationCrf1 + workflowCrf1 (General Assessment copies): 4 rules each
 *   - validationCrf2 + workflowCrf2 (Lab Results copies):        3 rules each
 *
 * Total: 14 validation rules.
 * Rules use optional e-signature — the Part 11 middleware passes through without one.
 */

import { apiCall } from '../lib/api-client';
import { logHeader, logPass, logInfo } from '../lib/logger';
import { loadState, updateState } from '../lib/state';

const SCRIPT = '07-create-validation-rules';

interface RuleDef {
  name: string;
  description: string;
  ruleType: string;
  fieldPath: string;
  severity: 'error' | 'warning';
  errorMessage: string;
  warningMessage?: string;
  active: boolean;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  customExpression?: string;
}

// Rules for "General Assessment Form" copies (eCRF 1 variants)
const GENERAL_RULES: RuleDef[] = [
  {
    name: 'Heart Rate Range Check',
    description: 'Heart rate must be between 40 and 200 bpm',
    ruleType: 'range',
    fieldPath: 'heart_rate',
    severity: 'error',
    errorMessage: 'Heart rate is out of physiological range (40-200 bpm). Please verify.',
    active: true,
    minValue: 40,
    maxValue: 200,
  },
  {
    name: 'Clinical Notes Minimum Length',
    description: 'Clinical notes should be at least 10 characters if provided',
    ruleType: 'format',
    fieldPath: 'clinical_notes',
    severity: 'warning',
    errorMessage: 'Clinical notes are too short.',
    warningMessage: 'Clinical notes should be at least 10 characters for meaningful documentation.',
    active: true,
    pattern: '^.{10,}$',
    formatType: 'custom',
  },
  {
    name: 'Assessment Date Required',
    description: 'Assessment date must be filled in',
    ruleType: 'required',
    fieldPath: 'assessment_date',
    severity: 'error',
    errorMessage: 'Assessment date is required.',
    active: true,
  },
  {
    name: 'Pain Level Range',
    description: 'Pain level must be between 1 and 10',
    ruleType: 'range',
    fieldPath: 'pain_level',
    severity: 'warning',
    errorMessage: 'Pain level out of range.',
    warningMessage: 'Pain level should be between 1 and 10 on the standard pain scale.',
    active: true,
    minValue: 1,
    maxValue: 10,
  },
];

// Rules for "Lab Results & Procedures Form" copies (eCRF 2 variants)
// NOTE: Rules on nested dot-paths (e.g. lab_results_table.result_value) target
// rows inside JSON-stringified table data. The server may not resolve these.
// Top-level rules (patient_weight, patient_height) are guaranteed to fire.
const LAB_RULES: RuleDef[] = [
  {
    name: 'Patient Weight Range',
    description: 'Patient weight must be physiologically reasonable',
    ruleType: 'range',
    fieldPath: 'patient_weight',
    severity: 'error',
    errorMessage: 'Patient weight must be between 20-250 kg. Please verify.',
    active: true,
    minValue: 20,
    maxValue: 250,
  },
  {
    name: 'Patient Height Range',
    description: 'Patient height must be physiologically reasonable',
    ruleType: 'range',
    fieldPath: 'patient_height',
    severity: 'error',
    errorMessage: 'Patient height must be between 50-250 cm. Please verify.',
    active: true,
    minValue: 50,
    maxValue: 250,
  },
  {
    name: 'Lab Result Value Range',
    description: 'Lab result values must be between 0 and 1000',
    ruleType: 'range',
    fieldPath: 'lab_results_table.result_value',
    severity: 'error',
    errorMessage: 'Lab result value is out of expected range (0-1000). Check value and units.',
    active: true,
    minValue: 0,
    maxValue: 1000,
  },
  {
    name: 'BMI Reasonable Range',
    description: 'BMI should be between 10 and 60',
    ruleType: 'range',
    fieldPath: 'bmi_calculated',
    severity: 'warning',
    errorMessage: 'BMI is outside reasonable range.',
    warningMessage: 'BMI should typically be between 10 and 60. Please verify height and weight.',
    active: true,
    minValue: 10,
    maxValue: 60,
  },
  {
    name: 'Test Name Required in Lab Table',
    description: 'Each lab result row must have a test name',
    ruleType: 'required',
    fieldPath: 'lab_results_table.test_name',
    severity: 'error',
    errorMessage: 'Test name is required for each lab result entry.',
    active: true,
  },
];

async function createRulesForCrf(crfId: number, rules: RuleDef[], label: string): Promise<number[]> {
  const ids: number[] = [];

  for (const rule of rules) {
    const res = await apiCall({
      method: 'POST',
      url: '/validation-rules',
      script: SCRIPT,
      step: `${label}: ${rule.name}`,
      data: {
        crfId,
        ...rule,
      },
    });

    if (res.ok) {
      const d = res.data as any;
      const ruleId = d.ruleId ?? d.data?.ruleId ?? d.data?.id ?? d.id;
      logPass(SCRIPT, `${label}: "${rule.name}" (ID: ${ruleId}) [${rule.severity}]`);
      if (ruleId) ids.push(ruleId);
    }
  }

  return ids;
}

async function run(): Promise<boolean> {
  logHeader('07 — Create Validation Rules');

  const state = loadState();

  const targets = [
    { id: state.validationCrf1Id, rules: GENERAL_RULES, label: 'Validation eCRF 1' },
    { id: state.validationCrf2Id, rules: LAB_RULES, label: 'Validation eCRF 2' },
    { id: state.workflowCrf1Id, rules: GENERAL_RULES, label: 'Workflow eCRF 1' },
    { id: state.workflowCrf2Id, rules: LAB_RULES, label: 'Workflow eCRF 2' },
  ];

  const missing = targets.filter((t) => !t.id);
  if (missing.length) {
    logInfo(`Missing CRF IDs for: ${missing.map((m) => m.label).join(', ')} — run scripts 04-05 first`);
    return false;
  }

  const allRuleIds: number[] = [];

  for (const target of targets) {
    logInfo(`Creating ${target.rules.length} rules for ${target.label} (CRF ${target.id})...`);
    const ids = await createRulesForCrf(target.id!, target.rules, target.label);
    allRuleIds.push(...ids);
  }

  updateState({ validationRuleIds: allRuleIds });
  logPass(SCRIPT, `Total rules created: ${allRuleIds.length}`);

  return allRuleIds.length > 0;
}

export { run };
if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}
