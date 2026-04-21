/**
 * USER DATA-ENTRY SIMULATION
 *
 * For each plain-English rule description, we:
 *   1. Send it through the FULL backend orchestrator → real Gemini API.
 *   2. Get back the structured rule(s).
 *   3. SIMULATE A USER ENTERING REAL VALUES INTO THE FORM by calling
 *      `testRuleDirectly` (the actual runtime evaluator) on a curated
 *      list of values a real clinician/data manager might type.
 *   4. Verify the rule's verdict on each value matches what a human
 *      would expect for that rule.
 *
 * The runtime evaluator returns `{ valid: boolean }`:
 *   - valid:true   → rule does NOT fire (no query/error created)
 *   - valid:false  → rule fires (a query is raised, severity decides
 *                    whether it's a hard error or a soft warning)
 *
 * Crash-safe: every API call wrapped in try/catch; always exits 0
 * unless --strict is passed.
 */
/* eslint-disable no-console */

if (!process.env.AI_COMPILER_ENABLED) process.env.AI_COMPILER_ENABLED = 'true';
if (!process.env.AI_COMPILER_PROVIDER) process.env.AI_COMPILER_PROVIDER = 'gemini';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const compilerModule = require('../src/services/ai/rule-compiler.service');
const compileRules: typeof import('../src/services/ai/rule-compiler.service').compileRules =
  compilerModule.compileRules;
const __resetCompilerCacheForTests: typeof import('../src/services/ai/rule-compiler.service').__resetCompilerCacheForTests =
  compilerModule.__resetCompilerCacheForTests;
const __resetCompilerProviderForTests: typeof import('../src/services/ai/rule-compiler.service').__resetCompilerProviderForTests =
  compilerModule.__resetCompilerProviderForTests;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const validationRulesService = require('../src/services/database/validation-rules.service');
const testRuleDirectly: typeof import('../src/services/database/validation-rules.service').testRuleDirectly =
  validationRulesService.testRuleDirectly;

import type {
  RuleSuggestionRequest,
  CompileCallerContext,
  RuleSuggestionResponse,
  SuggestedRule,
} from '../src/services/ai/types';
import type { ValidationRule } from '../src/services/database/validation-rules.service';

const FIELDS = [
  { path: 'subject_id',     label: 'Subject ID',         type: 'text',     itemId: 1 },
  { path: 'email',          label: 'Email',              type: 'email',    itemId: 2 },
  { path: 'phone_us',       label: 'Phone (US)',         type: 'phone',    itemId: 3 },
  { path: 'mrn',            label: 'Medical Record',     type: 'text',     itemId: 4 },
  { path: 'visit_date',     label: 'Visit Date',         type: 'date',     itemId: 5 },
  { path: 'screening_date', label: 'Screening Date',     type: 'date',     itemId: 6 },
  { path: 'consent_date',   label: 'Consent Date',       type: 'date',     itemId: 7 },
  { path: 'age',            label: 'Age',                type: 'number',   itemId: 8, unit: 'years', min: 0, max: 150 },
  { path: 'weight_kg',      label: 'Weight',             type: 'weight',   itemId: 9, unit: 'kg' },
  { path: 'height_cm',      label: 'Height',             type: 'height',   itemId: 10, unit: 'cm' },
  { path: 'systolic',       label: 'Systolic BP',        type: 'number',   itemId: 11, unit: 'mmHg' },
  { path: 'diastolic',      label: 'Diastolic BP',       type: 'number',   itemId: 12, unit: 'mmHg' },
  { path: 'sex',            label: 'Sex',                type: 'select',   itemId: 13,
    options: [{ label: 'Male', value: 'M' }, { label: 'Female', value: 'F' }] },
  { path: 'smoker',         label: 'Currently smoking?', type: 'yesno',    itemId: 14 },
  { path: 'temperature_c',  label: 'Temperature',        type: 'temperature', itemId: 15, unit: '°C' },
];

const CALLER: CompileCallerContext = {
  userId: 999,
  username: 'user-data-tester',
  role: 'data_manager',
};

interface UserEntry {
  /** What the user typed into the form. */
  value: string;
  /** What the rule SHOULD do given that value:
   *    'pass'  = rule does NOT fire (entry is acceptable)
   *    'fire'  = rule DOES fire (entry triggers a query/error)
   */
  expect: 'pass' | 'fire';
  /** Optional companion field values for cross-field consistency rules. */
  extraData?: Record<string, any>;
  /** Plain-English explanation of why this entry is in the test. */
  why?: string;
}

interface UserScenario {
  label: string;
  /** What the clinician would type in the rule-creation UI. */
  description: string;
  /** Realistic user entries to feed the resulting rule. */
  entries: UserEntry[];
}

const SCENARIOS: UserScenario[] = [
  // ════════════════════════════════════════════════════════════════
  // 1. Age range (the most common clinical rule)
  // ════════════════════════════════════════════════════════════════
  {
    label: '1. Age 18-120',
    description: 'Age must be between 18 and 120 years',
    entries: [
      { value: '18',   expect: 'pass', why: 'lower bound, inclusive' },
      { value: '50',   expect: 'pass', why: 'middle of range' },
      { value: '120',  expect: 'pass', why: 'upper bound, inclusive' },
      { value: '17',   expect: 'fire', why: 'just below lower bound' },
      { value: '121',  expect: 'fire', why: 'just above upper bound' },
      { value: '0',    expect: 'fire', why: 'newborn — clearly out of range' },
      { value: '999',  expect: 'fire', why: 'unrealistic high' },
      { value: '18.5', expect: 'pass', why: 'fractional age within range' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 2. Email format
  // ════════════════════════════════════════════════════════════════
  {
    label: '2. Email format',
    description: 'Email must be a valid email address',
    entries: [
      { value: 'jane.doe@example.com',         expect: 'pass', why: 'standard email' },
      { value: 'first.last+tag@subdomain.co.uk', expect: 'pass', why: 'tagged email with multi-part TLD' },
      { value: 'user_name@example.org',        expect: 'pass', why: 'underscore allowed' },
      { value: 'broken@',                      expect: 'fire', why: 'missing domain' },
      { value: '@nope.com',                    expect: 'fire', why: 'missing local part' },
      { value: 'plain-text-no-at',             expect: 'fire', why: 'no @ at all' },
      { value: 'two@@signs.com',               expect: 'fire', why: 'duplicated @' },
      { value: 'spaces in@email.com',          expect: 'fire', why: 'spaces' },
      { value: '',                             expect: 'pass', why: 'empty values are not validated by format (a separate required rule covers that)' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 3. Subject ID format
  // ════════════════════════════════════════════════════════════════
  {
    label: '3. Subject ID SITE-001 format',
    description: 'Subject ID must be in SITE-001 format (uppercase letters dash digits)',
    entries: [
      { value: 'NYC-001',  expect: 'pass', why: '3 caps + 3 digits' },
      { value: 'BOS-1234', expect: 'pass', why: '3 caps + 4 digits' },
      { value: 'LA-001',   expect: 'pass', why: '2 caps' },
      { value: 'NYC-12345', expect: 'pass', why: '3 caps + 5 digits' },
      { value: 'nyc-001',  expect: 'fire', why: 'lowercase' },
      { value: 'NYC001',   expect: 'fire', why: 'no dash' },
      { value: 'NYC-12',   expect: 'fire', why: 'too few digits' },
      { value: 'X-001',    expect: 'fire', why: 'too few letters' },
      { value: 'NYC-1A2',  expect: 'fire', why: 'letter mixed in digits' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 4. Date chronology — visit must be on or after screening
  // ════════════════════════════════════════════════════════════════
  {
    label: '4. Visit date >= Screening date',
    description: 'Visit Date must be on or after the Screening Date',
    entries: [
      { value: '2024-06-15', expect: 'pass', extraData: { screening_date: '2024-06-01' }, why: '14 days after screening' },
      { value: '2024-06-01', expect: 'pass', extraData: { screening_date: '2024-06-01' }, why: 'same day' },
      { value: '2024-12-31', expect: 'pass', extraData: { screening_date: '2024-06-01' }, why: 'months later' },
      { value: '2024-05-31', expect: 'fire', extraData: { screening_date: '2024-06-01' }, why: 'one day before' },
      { value: '2023-01-01', expect: 'fire', extraData: { screening_date: '2024-06-01' }, why: 'over a year before' },
      // Non-ISO date format that the runtime CAN parse:
      { value: '06/15/2024', expect: 'pass', extraData: { screening_date: '2024-06-01' }, why: 'US date entered after screening' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 5. Consent date upper bound (date_before with literal)
  // ════════════════════════════════════════════════════════════════
  {
    label: '5. Consent before 2025-01-01',
    description: 'Consent Date must be before 2025-01-01',
    entries: [
      { value: '2024-12-31', expect: 'pass', why: 'one day before' },
      { value: '2024-06-15', expect: 'pass', why: 'months before' },
      { value: '2025-01-01', expect: 'fire', why: 'on the boundary (date_before is strict)' },
      { value: '2025-06-15', expect: 'fire', why: 'after boundary' },
      { value: '2026-01-01', expect: 'fire', why: 'far after' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 6. Diastolic < Systolic (BP physiological constraint)
  // ════════════════════════════════════════════════════════════════
  {
    label: '6. Diastolic < Systolic (BP physiology)',
    description: 'Diastolic BP must be less than Systolic BP',
    entries: [
      { value: '80',  expect: 'pass', extraData: { systolic: '120' }, why: 'normal BP 120/80' },
      { value: '60',  expect: 'pass', extraData: { systolic: '110' }, why: 'low-normal BP' },
      { value: '90',  expect: 'pass', extraData: { systolic: '140' }, why: 'borderline hypertensive' },
      { value: '120', expect: 'fire', extraData: { systolic: '80' },  why: 'transposed values' },
      { value: '80',  expect: 'fire', extraData: { systolic: '80' },  why: 'equal — diastolic NOT strictly less' },
      { value: '150', expect: 'fire', extraData: { systolic: '120' }, why: 'diastolic above systolic (impossible IRL but tests rule)' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 7. Smoker = Yes warning (value_match — fires WHEN matches)
  // ════════════════════════════════════════════════════════════════
  {
    label: '7. Flag if smoker = Yes',
    description: 'Flag for review (warning) if the patient is currently smoking (answer is Yes)',
    entries: [
      { value: 'No',    expect: 'pass', why: 'not smoking — not flagged' },
      { value: 'no',    expect: 'pass', why: 'lowercase no' },
      { value: 'Yes',   expect: 'fire', why: 'smoker — flag for review' },
      { value: 'yes',   expect: 'fire', why: 'lowercase yes (case-folded)' },
      { value: 'YES',   expect: 'fire', why: 'uppercase' },
      { value: 'true',  expect: 'fire', why: 'yes-synonym' },
      { value: '1',     expect: 'fire', why: 'numeric yes-synonym' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 8. Required field
  // ════════════════════════════════════════════════════════════════
  {
    label: '8. Age is required',
    description: 'Age is a required field',
    entries: [
      { value: '50', expect: 'pass', why: 'value present' },
      { value: '0',  expect: 'pass', why: 'zero is present (required only checks presence)' },
      { value: '',   expect: 'fire', why: 'empty string — required fires' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 9. Phone format (US)
  // ════════════════════════════════════════════════════════════════
  {
    label: '9. US phone format',
    description: 'Phone (US) must be a valid US phone number',
    entries: [
      { value: '123-456-7890',   expect: 'pass', why: 'dashes' },
      { value: '(123) 456-7890', expect: 'pass', why: 'parens + dashes' },
      { value: '123.456.7890',   expect: 'pass', why: 'dots' },
      { value: '1234567890',     expect: 'pass', why: 'no separators (registry allows)' },
      { value: '12-3456-7890',   expect: 'fire', why: 'wrong groupings' },
      { value: 'not-a-phone',    expect: 'fire', why: 'letters' },
      { value: '+44 7700 900900', expect: 'fire', why: 'UK number rejected by US format' },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 10. Temperature fever flag (warning)
  // ════════════════════════════════════════════════════════════════
  {
    label: '10. Flag temperature above 38°C',
    description: 'Flag temperature above 38 degrees Celsius as a possible fever',
    entries: [
      { value: '36.5', expect: 'pass', why: 'normal' },
      { value: '37.5', expect: 'pass', why: 'mildly elevated, sub-fever' },
      { value: '38.0', expect: 'pass', why: 'on the boundary (depends on rule semantics)' },
      { value: '38.5', expect: 'fire', why: 'low-grade fever' },
      { value: '40.0', expect: 'fire', why: 'high fever' },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────

function asRuntimeRule(rule: SuggestedRule): ValidationRule {
  return {
    id: 0, crfId: 0, name: rule.name, description: rule.description || '',
    ruleType: rule.ruleType, fieldPath: 'testField',
    severity: rule.severity, errorMessage: rule.errorMessage, active: true,
    minValue: rule.minValue, maxValue: rule.maxValue,
    pattern: rule.pattern, formatType: rule.formatType,
    operator: rule.operator, compareFieldPath: rule.compareFieldPath, compareValue: rule.compareValue,
    bpSystolicMin: rule.bpSystolicMin, bpSystolicMax: rule.bpSystolicMax,
    bpDiastolicMin: rule.bpDiastolicMin, bpDiastolicMax: rule.bpDiastolicMax,
    dateCreated: new Date(), createdBy: 0,
  } as ValidationRule;
}

function describeRule(rule: SuggestedRule): string {
  const bits: string[] = [`type=${rule.ruleType}`, `field=${rule.fieldPath}`];
  if (typeof rule.minValue === 'number') bits.push(`min=${rule.minValue}`);
  if (typeof rule.maxValue === 'number') bits.push(`max=${rule.maxValue}`);
  if (rule.formatType) bits.push(`formatType=${rule.formatType}`);
  if (rule.pattern) bits.push(`pattern=${rule.pattern.substring(0, 60)}`);
  if (rule.operator) bits.push(`op=${rule.operator}`);
  if (rule.compareFieldPath) bits.push(`vsField=${rule.compareFieldPath}`);
  if (rule.compareValue) bits.push(`vsValue=${rule.compareValue}`);
  if (rule.severity) bits.push(`sev=${rule.severity}`);
  return bits.join(' ');
}

interface ScenarioResult {
  label: string;
  description: string;
  ruleAccepted: boolean;
  ruleSummary: string;
  entryResults: Array<{
    value: string;
    expect: 'pass' | 'fire';
    got: 'pass' | 'fire' | 'error';
    correct: boolean;
    why?: string;
    error?: string;
  }>;
  entriesPassed: number;
  entriesTotal: number;
  scenarioPassed: boolean;
  cost: number;
}
const allResults: ScenarioResult[] = [];

function makeReq(scenario: UserScenario, idx: number): RuleSuggestionRequest {
  return {
    description: scenario.description,
    fieldContext: FIELDS,
    existingRules: [],
    correlationId: `user-data-${idx}-${Date.now()}`,
    maxRules: 5,
    idempotencyKey: `user-data-${idx}-${Math.random()}`,
  };
}

async function runScenario(scenario: UserScenario, idx: number) {
  console.log('\n' + '─'.repeat(78));
  console.log(`[${idx + 1}/${SCENARIOS.length}] ${scenario.label}`);
  console.log(`  rule description: "${scenario.description}"`);

  let response: RuleSuggestionResponse | null = null;
  let crashError = '';
  try {
    response = await compileRules(makeReq(scenario, idx), CALLER);
  } catch (err: any) {
    crashError = err?.message || String(err);
  }

  if (!response) {
    console.error(`  [CRASH] ${crashError}`);
    allResults.push({
      label: scenario.label, description: scenario.description,
      ruleAccepted: false, ruleSummary: '',
      entryResults: [], entriesPassed: 0, entriesTotal: scenario.entries.length,
      scenarioPassed: false, cost: 0,
    });
    return;
  }

  if (response.rules.length === 0) {
    console.error(`  [FAIL] No rule produced (refused=${response.flags.refused}, reason=${response.flags.refusedReason})`);
    if (response.warnings.length > 0) {
      for (const w of response.warnings.slice(0, 2)) {
        console.error(`         warning: ${w.substring(0, 200)}`);
      }
    }
    allResults.push({
      label: scenario.label, description: scenario.description,
      ruleAccepted: false, ruleSummary: '',
      entryResults: [], entriesPassed: 0, entriesTotal: scenario.entries.length,
      scenarioPassed: false, cost: response.stats.costUsd ?? 0,
    });
    return;
  }

  // Use the FIRST rule for entry simulation. Multi-rule responses (e.g.
  // required+range) usually mean the test should focus on the rule whose
  // semantics match the entries.
  const rule = response.rules[0];
  console.log(`  rule emitted: ${describeRule(rule)}`);
  console.log(`  rule rationale: ${(rule.rationale || '').substring(0, 200)}`);

  const runtimeRule = asRuntimeRule(rule);

  console.log(`  ── user data entry simulation ──`);
  const entryResults: ScenarioResult['entryResults'] = [];
  let passed = 0;

  for (const entry of scenario.entries) {
    const data = { testField: entry.value, ...(entry.extraData || {}) };
    let gotValid: boolean | 'error';
    let probeError = '';
    try {
      const r = testRuleDirectly(runtimeRule, entry.value, data);
      gotValid = r.valid;
    } catch (err: any) {
      gotValid = 'error';
      probeError = err?.message || String(err);
    }
    const got: 'pass' | 'fire' | 'error' =
      gotValid === 'error' ? 'error' :
      gotValid === true ? 'pass' : 'fire';
    const correct = got === entry.expect;
    if (correct) passed++;
    entryResults.push({
      value: entry.value,
      expect: entry.expect,
      got,
      correct,
      why: entry.why,
      error: probeError || undefined,
    });
    const icon = correct ? '✓' : '✗';
    const valuePart = JSON.stringify(entry.value);
    const extraPart = entry.extraData
      ? ` + ${Object.entries(entry.extraData).map(([k, v]) => `${k}=${v}`).join(', ')}`
      : '';
    const expectPart = `expect=${entry.expect.padEnd(4)} got=${got.padEnd(5)}`;
    const whyPart = entry.why ? ` (${entry.why})` : '';
    console.log(`    ${icon} value=${valuePart}${extraPart}  ${expectPart}${whyPart}${probeError ? '  ERR=' + probeError : ''}`);
  }

  const scenarioPassed = passed === scenario.entries.length;
  console.log(`  ${scenarioPassed ? '[PASS]' : '[FAIL]'} ${passed}/${scenario.entries.length} user entries handled correctly`);

  allResults.push({
    label: scenario.label,
    description: scenario.description,
    ruleAccepted: true,
    ruleSummary: describeRule(rule),
    entryResults,
    entriesPassed: passed,
    entriesTotal: scenario.entries.length,
    scenarioPassed,
    cost: response.stats.costUsd ?? 0,
  });
}

async function main() {
  console.log('='.repeat(78));
  console.log('USER DATA-ENTRY SIMULATION — Real Gemini → Real validator → Real runtime');
  console.log('='.repeat(78));
  console.log(`Provider: ${process.env.AI_COMPILER_PROVIDER}`);
  console.log(`Model:    ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Total entries to test: ${SCENARIOS.reduce((s, x) => s + x.entries.length, 0)}`);
  console.log('='.repeat(78));

  __resetCompilerCacheForTests();
  __resetCompilerProviderForTests();

  for (let i = 0; i < SCENARIOS.length; i++) {
    await runScenario(SCENARIOS[i], i);
    if (i < SCENARIOS.length - 1) await new Promise(r => setTimeout(r, 250));
  }

  // Summary report.
  console.log('\n' + '='.repeat(78));
  console.log('SUMMARY');
  console.log('='.repeat(78));

  const totalEntries = allResults.reduce((s, r) => s + r.entriesTotal, 0);
  const totalEntriesPassed = allResults.reduce((s, r) => s + r.entriesPassed, 0);
  const scenariosPassed = allResults.filter(r => r.scenarioPassed).length;
  const scenariosFailed = allResults.filter(r => !r.scenarioPassed).length;
  const totalCost = allResults.reduce((s, r) => s + r.cost, 0);

  for (const r of allResults) {
    const icon = r.scenarioPassed ? '✓' : '✗';
    const accepted = r.ruleAccepted ? `${r.entriesPassed}/${r.entriesTotal} entries` : 'NO RULE';
    console.log(`  ${icon} ${r.label.padEnd(45)}  ${accepted}`);
    if (!r.scenarioPassed && r.ruleAccepted) {
      const fails = r.entryResults.filter(e => !e.correct);
      for (const f of fails) {
        console.log(`      ↳ value=${JSON.stringify(f.value)} expected=${f.expect} got=${f.got}${f.error ? ' (' + f.error + ')' : ''}${f.why ? ' — ' + f.why : ''}`);
      }
    }
  }
  console.log('-'.repeat(78));
  console.log(`Scenarios: PASS=${scenariosPassed}  FAIL=${scenariosFailed}  (total=${allResults.length})`);
  console.log(`Entries:   correct=${totalEntriesPassed}/${totalEntries} (${(100 * totalEntriesPassed / totalEntries).toFixed(1)}%)`);
  console.log(`Cost:      $${totalCost.toFixed(6)}`);
  console.log('='.repeat(78));

  if (process.argv.includes('--strict') && scenariosFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected fatal error:', err?.message || String(err));
  console.error(err?.stack);
  process.exit(0);
});
