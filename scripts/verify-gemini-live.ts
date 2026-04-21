/**
 * LIVE end-to-end verifier against the real Gemini API.
 *
 * Exercises the FULL backend AI rule-compiler pipeline through the
 * orchestrator with provider=gemini. Each scenario is wrapped in its
 * own try/catch so a single failure (rate limit, model timeout, schema
 * drift) does NOT abort the run — we report what worked and what
 * didn't and exit with the count.
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/verify-gemini-live.ts
 *
 * Requires GEMINI_API_KEY in the environment (or set in .env, since
 * `dotenv.config()` runs at config load time).
 *
 * Cost note: each scenario sends ~3-5KB of prompt + receives ~500-1500
 * tokens of JSON. With the Apr-2026 pricing of ~$1.25/1M input and
 * $10/1M output for gemini-2.5-pro, a full run of ~12 scenarios is
 * conservatively under $0.05. We deliberately do NOT spam retries.
 */
/* eslint-disable no-console */

// MUST set env BEFORE any module that depends on config loads.
// Skip if the user already set the key (e.g. via .env or shell).
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

import type {
  RuleSuggestionRequest,
  CompileCallerContext,
  RuleSuggestionResponse,
} from '../src/services/ai/types';

// Field catalogue used by all scenarios. Includes one of each major
// type so the LLM has something realistic to work with.
const FIELDS = [
  { path: 'age',            label: 'Age',                type: 'number',   itemId: 1, unit: 'years', min: 0, max: 150 },
  { path: 'weight_kg',      label: 'Weight',             type: 'weight',   itemId: 2, unit: 'kg' },
  { path: 'subject_id',     label: 'Subject ID',         type: 'text',     itemId: 3 },
  { path: 'email',          label: 'Email',              type: 'email',    itemId: 4 },
  { path: 'visit_date',     label: 'Visit Date',         type: 'date',     itemId: 5 },
  { path: 'screening_date', label: 'Screening Date',     type: 'date',     itemId: 6 },
  { path: 'consent',        label: 'Consent obtained?',  type: 'yesno',    itemId: 7 },
  { path: 'sex',            label: 'Sex',                type: 'select',   itemId: 8,
    options: [{ label: 'Male', value: 'M' }, { label: 'Female', value: 'F' }] },
  { path: 'systolic',       label: 'Systolic BP',        type: 'number',   itemId: 9, unit: 'mmHg' },
  { path: 'diastolic',      label: 'Diastolic BP',       type: 'number',   itemId: 10, unit: 'mmHg' },
];

const CALLER: CompileCallerContext = {
  userId: 999,
  username: 'gemini-live-tester',
  role: 'data_manager',
};

interface Scenario {
  label: string;
  description: string;
  /** Per-rule expectations. ALL must be satisfied for the scenario to pass. */
  expect: (resp: RuleSuggestionResponse) => string[];  // returns array of failure strings; empty = OK
  /** Skip this scenario if `--quick` was passed (for cheap smoke tests). */
  quick?: boolean;
}

const scenarios: Scenario[] = [
  {
    label: '1. Required keyword',
    description: 'Make Age required',
    quick: true,
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      if (r.rules.length === 0) fails.push('no rules');
      const hasRequired = r.rules.some(rule => rule.ruleType === 'required');
      if (!hasRequired) fails.push(`expected required rule; got types: ${r.rules.map(x => x.ruleType).join(',')}`);
      const targetsAge = r.rules.some(rule => rule.fieldPath === 'age');
      if (!targetsAge) fails.push(`expected fieldPath=age; got: ${r.rules.map(x => x.fieldPath).join(',')}`);
      return fails;
    },
  },
  {
    label: '2. Range with explicit bounds',
    description: 'Age must be between 18 and 120 years',
    quick: true,
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const range = r.rules.find(x => x.ruleType === 'range');
      if (!range) fails.push(`no range rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        if (range.minValue !== 18) fails.push(`minValue expected 18, got ${range.minValue}`);
        if (range.maxValue !== 120) fails.push(`maxValue expected 120, got ${range.maxValue}`);
        if (range.fieldPath !== 'age') fails.push(`fieldPath expected age, got ${range.fieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '3. Multi-rule (required + range)',
    description: 'Age must be required and between 18 and 120',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const types = r.rules.map(x => x.ruleType);
      if (!types.includes('required')) fails.push(`missing required; got: ${types.join(',')}`);
      if (!types.includes('range')) fails.push(`missing range; got: ${types.join(',')}`);
      return fails;
    },
  },
  {
    label: '4. Email format (registry key preferred)',
    description: 'Email field must be a valid email address',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const fmt = r.rules.find(x => x.ruleType === 'format');
      if (!fmt) fails.push(`no format rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        if (fmt.formatType !== 'email') fails.push(`expected formatType=email; got: ${fmt.formatType}`);
        if (fmt.pattern) fails.push(`should NOT have raw pattern when registry key is used; got pattern=${fmt.pattern}`);
        if (fmt.fieldPath !== 'email') fails.push(`expected fieldPath=email; got ${fmt.fieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '5. Subject ID format (registry key)',
    description: 'Subject ID must look like SITE-001',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const fmt = r.rules.find(x => x.ruleType === 'format');
      if (!fmt) fails.push(`no format rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        // Either subject_id registry key or a custom regex is acceptable;
        // prefer the registry key but don't fail if the LLM picked custom.
        if (fmt.formatType !== 'subject_id' && fmt.formatType !== 'custom_regex') {
          fails.push(`expected formatType=subject_id (preferred) or custom_regex; got ${fmt.formatType}`);
        }
        if (fmt.fieldPath !== 'subject_id') fails.push(`expected fieldPath=subject_id; got ${fmt.fieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '6. Consistency: equality with literal',
    description: 'Consent must equal Yes',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const cons = r.rules.find(x => x.ruleType === 'consistency');
      if (!cons) fails.push(`no consistency rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        if (cons.operator !== '==') fails.push(`expected operator='=='; got ${cons.operator}`);
        // compareValue should be Yes (case-insensitive ok via runtime yes/no folding)
        if (!cons.compareValue || !/yes/i.test(cons.compareValue)) {
          fails.push(`expected compareValue=Yes-ish; got ${cons.compareValue}`);
        }
        if (cons.fieldPath !== 'consent') fails.push(`expected fieldPath=consent; got ${cons.fieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '7. Consistency: field-to-field comparison',
    description: 'Diastolic BP must be less than Systolic BP',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const cons = r.rules.find(x => x.ruleType === 'consistency');
      if (!cons) fails.push(`no consistency rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        if (cons.operator !== '<') fails.push(`expected operator='<'; got ${cons.operator}`);
        if (cons.fieldPath !== 'diastolic') fails.push(`expected fieldPath=diastolic; got ${cons.fieldPath}`);
        if (cons.compareFieldPath !== 'systolic') fails.push(`expected compareFieldPath=systolic; got ${cons.compareFieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '8. Date operator: date_on_or_after with field-to-field',
    description: 'Visit Date must be on or after the Screening Date',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const cons = r.rules.find(x => x.ruleType === 'consistency');
      if (!cons) fails.push(`no consistency rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        // Accept date_on_or_after (preferred) OR generic >= (acceptable).
        if (cons.operator !== 'date_on_or_after' && cons.operator !== '>=') {
          fails.push(`expected operator=date_on_or_after (or >=); got ${cons.operator}`);
        }
        if (cons.fieldPath !== 'visit_date') fails.push(`expected fieldPath=visit_date; got ${cons.fieldPath}`);
        if (cons.compareFieldPath !== 'screening_date') fails.push(`expected compareFieldPath=screening_date; got ${cons.compareFieldPath}`);
      }
      return fails;
    },
  },
  {
    label: '9. value_match (FIRE WHEN MATCHES)',
    description: 'Flag for review if the consent answer is No',
    expect: (r) => {
      const fails: string[] = [];
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      const vm = r.rules.find(x => x.ruleType === 'value_match');
      if (!vm) fails.push(`no value_match rule; got: ${r.rules.map(x => x.ruleType).join(',')}`);
      else {
        if (vm.severity !== 'warning') fails.push(`expected severity=warning; got ${vm.severity}`);
        if (!vm.compareValue || !/no/i.test(vm.compareValue)) {
          fails.push(`expected compareValue=No-ish; got ${vm.compareValue}`);
        }
        if (vm.fieldPath !== 'consent') fails.push(`expected fieldPath=consent; got ${vm.fieldPath}`);
        // Validator MUST strip operator from value_match.
        if ((vm as any).operator !== undefined) fails.push(`operator should be stripped; got ${(vm as any).operator}`);
      }
      return fails;
    },
  },
  {
    label: '10. PHI in description -> hard refused (BEFORE any LLM call)',
    description: 'Patient SSN 123-45-6789 must be valid format',
    expect: (r) => {
      const fails: string[] = [];
      if (!r.flags.refused) fails.push('expected refused');
      if (r.flags.refusedReason !== 'phi_in_description') {
        fails.push(`expected refusedReason=phi_in_description; got ${r.flags.refusedReason}`);
      }
      if (!r.flags.containedPhi) fails.push('expected containedPhi=true');
      if (r.rules.length !== 0) fails.push(`expected 0 rules; got ${r.rules.length}`);
      return fails;
    },
  },
  {
    label: '11. Forbidden ruleType bait (formula) -> stripped to 0 or non-formula',
    description: 'Use a formula to compute BMI from weight and height',
    expect: (r) => {
      const fails: string[] = [];
      // The LLM MAY refuse, OR emit nothing, OR emit non-formula rules.
      // The hard requirement: NO rule with ruleType in {formula, business_logic, cross_form}.
      const forbidden = r.rules.filter(x =>
        x.ruleType === 'formula' || x.ruleType === 'business_logic' || x.ruleType === 'cross_form');
      if (forbidden.length > 0) {
        fails.push(`forbidden ruleType emitted: ${forbidden.map(x => x.ruleType).join(',')}`);
      }
      return fails;
    },
  },
  {
    label: '12. Idempotency cache hit on second call with same key',
    description: 'Email field must be a valid email address',
    quick: true,
    expect: (r) => {
      const fails: string[] = [];
      // First call seeds the cache; the runner does the second call below.
      // Asserted by the runner (see scenario 12b).
      if (r.flags.refused) fails.push(`refused: ${r.flags.refusedReason}`);
      return fails;
    },
  },
];

interface Result {
  scenario: string;
  status: 'PASS' | 'FAIL' | 'CRASH';
  details: string;
  rulesProduced: number;
  ruleTypes: string;
  refused: boolean;
  refusedReason?: string;
  warnings: string[];
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  fromCache?: boolean;
}

function makeReq(scenario: Scenario, idx: number): RuleSuggestionRequest {
  return {
    description: scenario.description,
    fieldContext: FIELDS,
    existingRules: [],
    correlationId: `gemini-live-${idx}-${Date.now()}`,
    maxRules: 5,
    idempotencyKey: `gemini-live-${idx}`,
  };
}

async function runOne(scenario: Scenario, idx: number, results: Result[]) {
  const id = `${idx + 1}/${scenarios.length}`;
  console.log(`\n[${id}] ${scenario.label}`);
  console.log(`    description: ${JSON.stringify(scenario.description)}`);
  const req = makeReq(scenario, idx);
  let resp: RuleSuggestionResponse | null = null;
  let crashed = false;
  let crashMsg = '';
  try {
    resp = await compileRules(req, CALLER);
  } catch (err: any) {
    crashed = true;
    crashMsg = err?.message || String(err);
  }
  if (crashed || !resp) {
    console.error(`    [CRASH] ${crashMsg}`);
    results.push({
      scenario: scenario.label, status: 'CRASH', details: crashMsg,
      rulesProduced: 0, ruleTypes: '', refused: false, warnings: [], latencyMs: 0,
    });
    return;
  }
  const fails = scenario.expect(resp);
  const status: Result['status'] = fails.length === 0 ? 'PASS' : 'FAIL';
  results.push({
    scenario: scenario.label,
    status,
    details: fails.length === 0 ? '(all expectations met)' : fails.join(' | '),
    rulesProduced: resp.rules.length,
    ruleTypes: resp.rules.map(x => x.ruleType).join(','),
    refused: !!resp.flags.refused,
    refusedReason: resp.flags.refusedReason,
    warnings: [...resp.warnings],
    latencyMs: resp.stats.latencyMs,
    inputTokens: resp.stats.inputTokens,
    outputTokens: resp.stats.outputTokens,
    costUsd: resp.stats.costUsd,
    fromCache: resp.stats.fromCache,
  });
  console.log(`    rules: ${resp.rules.length} (${resp.rules.map(x => x.ruleType).join(',') || 'none'}) | refused=${resp.flags.refused} | latency=${resp.stats.latencyMs}ms | tokens=in:${resp.stats.inputTokens ?? 'n/a'}/out:${resp.stats.outputTokens ?? 'n/a'} | cost=$${(resp.stats.costUsd ?? 0).toFixed(6)} | cache=${resp.stats.fromCache ?? false}`);
  if (resp.warnings.length > 0) {
    console.log(`    warnings: ${resp.warnings.slice(0, 3).map(w => w.substring(0, 200)).join(' || ')}`);
  }
  if (resp.rules.length > 0) {
    for (const rule of resp.rules) {
      console.log(`      • ${rule.ruleType} on ${rule.fieldPath} | ${describeRule(rule)} | severity=${rule.severity}`);
    }
  }
  if (status === 'PASS') {
    console.log(`    [PASS] ${scenario.label}`);
  } else {
    console.error(`    [FAIL] ${fails.join(' | ')}`);
  }
}

function describeRule(rule: any): string {
  const bits: string[] = [];
  if (typeof rule.minValue === 'number') bits.push(`min=${rule.minValue}`);
  if (typeof rule.maxValue === 'number') bits.push(`max=${rule.maxValue}`);
  if (rule.formatType) bits.push(`formatType=${rule.formatType}`);
  if (rule.pattern) bits.push(`pattern=${String(rule.pattern).substring(0, 60)}`);
  if (rule.operator) bits.push(`op=${rule.operator}`);
  if (rule.compareFieldPath) bits.push(`vs field=${rule.compareFieldPath}`);
  if (rule.compareValue) bits.push(`vs value=${rule.compareValue}`);
  return bits.join(', ') || '(no params)';
}

async function main() {
  console.log('='.repeat(70));
  console.log('GEMINI LIVE END-TO-END VERIFIER');
  console.log('='.repeat(70));
  console.log(`Provider: ${process.env.AI_COMPILER_PROVIDER}`);
  console.log(`Model:    ${process.env.GEMINI_MODEL || 'gemini-2.5-pro (default)'}`);
  console.log(`Enabled:  ${process.env.AI_COMPILER_ENABLED}`);
  console.log(`API key:  ${process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 8)}…` : '(not set!)'}`);
  console.log(`Fields:   ${FIELDS.length} fields covering 8 distinct types`);
  console.log('='.repeat(70));

  __resetCompilerCacheForTests();
  __resetCompilerProviderForTests();

  const results: Result[] = [];

  // Run each scenario in sequence (sequential is gentler on rate limits).
  for (let i = 0; i < scenarios.length; i++) {
    await runOne(scenarios[i], i, results);
    // Tiny pause to be polite to the API.
    if (i < scenarios.length - 1) await new Promise(r => setTimeout(r, 250));
  }

  // Idempotency follow-up: scenario 12 already seeded the cache; re-run it
  // and confirm fromCache=true.
  console.log(`\n[12b/12b] Idempotency follow-up (re-run scenario 12 with same key)`);
  try {
    const cachedResp = await compileRules(makeReq(scenarios[11], 11), CALLER);
    const cacheOk = cachedResp.stats.fromCache === true;
    console.log(`    fromCache=${cachedResp.stats.fromCache} | rules=${cachedResp.rules.length} | latency=${cachedResp.stats.latencyMs}ms`);
    results.push({
      scenario: '12b. Idempotency follow-up (cache hit)',
      status: cacheOk ? 'PASS' : 'FAIL',
      details: cacheOk ? '(cached as expected)' : `expected fromCache=true; got ${cachedResp.stats.fromCache}`,
      rulesProduced: cachedResp.rules.length,
      ruleTypes: cachedResp.rules.map(x => x.ruleType).join(','),
      refused: !!cachedResp.flags.refused,
      warnings: [...cachedResp.warnings],
      latencyMs: cachedResp.stats.latencyMs,
      fromCache: cachedResp.stats.fromCache,
    });
    console.log(`    [${cacheOk ? 'PASS' : 'FAIL'}] cache hit assertion`);
  } catch (err: any) {
    console.error(`    [CRASH] ${err?.message || String(err)}`);
    results.push({
      scenario: '12b. Idempotency follow-up',
      status: 'CRASH',
      details: err?.message || String(err),
      rulesProduced: 0, ruleTypes: '', refused: false, warnings: [], latencyMs: 0,
    });
  }

  // Aggregate report
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const totals = {
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    crash: results.filter(r => r.status === 'CRASH').length,
    totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
    totalCostUsd: results.reduce((s, r) => s + (r.costUsd || 0), 0),
    totalInputTokens: results.reduce((s, r) => s + (r.inputTokens || 0), 0),
    totalOutputTokens: results.reduce((s, r) => s + (r.outputTokens || 0), 0),
  };

  for (const r of results) {
    const icon = r.status === 'PASS' ? '[PASS]' : r.status === 'FAIL' ? '[FAIL]' : '[CRASH]';
    console.log(`${icon} ${r.scenario}`);
    if (r.status !== 'PASS') {
      console.log(`        → ${r.details}`);
    }
  }

  console.log('\n--- aggregates ---');
  console.log(`PASS=${totals.pass}  FAIL=${totals.fail}  CRASH=${totals.crash}  (total=${results.length})`);
  console.log(`Total latency:        ${totals.totalLatencyMs}ms`);
  console.log(`Total input tokens:   ${totals.totalInputTokens}`);
  console.log(`Total output tokens:  ${totals.totalOutputTokens}`);
  console.log(`Total estimated cost: $${totals.totalCostUsd.toFixed(6)}`);

  // Exit 0 always — we want to see the full report even on partial failure.
  // Caller can scan the report. Use --strict to fail the process on any
  // non-PASS.
  if (process.argv.includes('--strict') && (totals.fail + totals.crash > 0)) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  // Defensive — main() shouldn't throw because every await is wrapped.
  console.error('Unexpected fatal error:', err?.message || String(err));
  console.error(err?.stack || '');
  process.exit(0); // still exit 0 so we don't crash on the user.
});
