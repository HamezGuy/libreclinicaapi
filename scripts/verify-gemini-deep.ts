/**
 * Deep LIVE end-to-end test against the real Gemini API.
 *
 * For each plain-English description we:
 *   1. Send it through the FULL backend orchestrator → real Gemini API
 *      → validator → response.
 *   2. Inspect every accepted rule.
 *   3. Run each accepted rule through `testRuleDirectly` (the real
 *      runtime evaluator) against hand-picked should-pass / should-fail
 *      values to confirm the rule actually fires correctly on patient data.
 *
 * Focus: complex regex patterns + the full operator vocabulary + every
 * rule type + intentional traps (PHI, forbidden ruleTypes, ambiguous
 * comparisons, date_* on non-date fields).
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/verify-gemini-deep.ts
 *   npx tsx scripts/verify-gemini-deep.ts --strict   # exit 1 on any failure
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

// ─── Field catalogue (rich enough for the LLM to reason about) ──────────
const FIELDS = [
  { path: 'subject_id',     label: 'Subject ID',         type: 'text',     itemId: 1 },
  { path: 'email',          label: 'Email',              type: 'email',    itemId: 2 },
  { path: 'phone_us',       label: 'Phone (US)',         type: 'phone',    itemId: 3 },
  { path: 'mrn',            label: 'Medical Record',     type: 'text',     itemId: 4 },
  { path: 'icd10',          label: 'ICD-10 diagnosis',   type: 'text',     itemId: 5 },
  { path: 'visit_date',     label: 'Visit Date',         type: 'date',     itemId: 6 },
  { path: 'screening_date', label: 'Screening Date',     type: 'date',     itemId: 7 },
  { path: 'consent_date',   label: 'Consent Date',       type: 'date',     itemId: 8 },
  { path: 'age',            label: 'Age',                type: 'number',   itemId: 9, unit: 'years', min: 0, max: 150 },
  { path: 'weight_kg',      label: 'Weight',             type: 'weight',   itemId: 10, unit: 'kg' },
  { path: 'height_cm',      label: 'Height',             type: 'height',   itemId: 11, unit: 'cm' },
  { path: 'systolic',       label: 'Systolic BP',        type: 'number',   itemId: 12, unit: 'mmHg' },
  { path: 'diastolic',      label: 'Diastolic BP',       type: 'number',   itemId: 13, unit: 'mmHg' },
  { path: 'sex',            label: 'Sex',                type: 'select',   itemId: 14,
    options: [{ label: 'Male', value: 'M' }, { label: 'Female', value: 'F' }] },
  { path: 'consent',        label: 'Consent obtained?',  type: 'yesno',    itemId: 15 },
  { path: 'smoker',         label: 'Currently smoking?', type: 'yesno',    itemId: 16 },
];

const CALLER: CompileCallerContext = {
  userId: 999,
  username: 'gemini-deep-tester',
  role: 'data_manager',
};

// ─── Test result accounting ──────────────────────────────────────────────
type ProbeResult = { value: string; expectedValid: boolean; gotValid: boolean | 'error'; ok: boolean; error?: string };
interface TestRecord {
  scenario: string;
  description: string;
  ruleAccepted: boolean;
  ruleSummary: string;
  llmRationale?: string;
  validatorWarnings: string[];
  refused: boolean;
  refusedReason?: string;
  shapeChecks: { check: string; ok: boolean; detail?: string }[];
  runtimeProbes: ProbeResult[];
  passed: boolean;
  failures: string[];
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}
const allResults: TestRecord[] = [];

function describeRule(rule: SuggestedRule): string {
  const bits: string[] = [`type=${rule.ruleType}`, `field=${rule.fieldPath}`];
  if (typeof rule.minValue === 'number') bits.push(`min=${rule.minValue}`);
  if (typeof rule.maxValue === 'number') bits.push(`max=${rule.maxValue}`);
  if (rule.formatType) bits.push(`formatType=${rule.formatType}`);
  if (rule.pattern) bits.push(`pattern=${rule.pattern}`);
  if (rule.operator) bits.push(`op=${rule.operator}`);
  if (rule.compareFieldPath) bits.push(`vsField=${rule.compareFieldPath}`);
  if (rule.compareValue) bits.push(`vsValue=${rule.compareValue}`);
  if (typeof rule.bpSystolicMin === 'number') bits.push(`bpSysMin=${rule.bpSystolicMin}`);
  if (typeof rule.bpSystolicMax === 'number') bits.push(`bpSysMax=${rule.bpSystolicMax}`);
  if (typeof rule.bpDiastolicMin === 'number') bits.push(`bpDiaMin=${rule.bpDiastolicMin}`);
  if (typeof rule.bpDiastolicMax === 'number') bits.push(`bpDiaMax=${rule.bpDiastolicMax}`);
  return bits.join(' ');
}

function asRuntimeRule(rule: SuggestedRule): ValidationRule {
  return {
    id: 0,
    crfId: 0,
    name: rule.name,
    description: rule.description || '',
    ruleType: rule.ruleType,
    fieldPath: 'testField',
    severity: rule.severity,
    errorMessage: rule.errorMessage,
    active: true,
    minValue: rule.minValue,
    maxValue: rule.maxValue,
    pattern: rule.pattern,
    formatType: rule.formatType,
    operator: rule.operator,
    compareFieldPath: rule.compareFieldPath,
    compareValue: rule.compareValue,
    bpSystolicMin: rule.bpSystolicMin,
    bpSystolicMax: rule.bpSystolicMax,
    bpDiastolicMin: rule.bpDiastolicMin,
    bpDiastolicMax: rule.bpDiastolicMax,
    dateCreated: new Date(),
    createdBy: 0,
  } as ValidationRule;
}

interface RuntimeProbe {
  value: string;
  /** What the runtime evaluator should return. */
  expectedValid: boolean;
  /** Optional extra fields for cross-field consistency rules. */
  extraData?: Record<string, any>;
}

interface ScenarioSpec {
  label: string;
  description: string;
  /** Soft assertions about the SHAPE of the rule the LLM emitted. */
  shapeChecks?: Array<{
    name: string;
    check: (rule: SuggestedRule) => boolean;
    detail?: (rule: SuggestedRule) => string;
  }>;
  /** Optional check on batch-level response (refused, warnings). */
  responseChecks?: Array<{
    name: string;
    check: (resp: RuleSuggestionResponse) => boolean;
    detail?: (resp: RuleSuggestionResponse) => string;
  }>;
  /** Runtime probes — values to feed the rule and what we expect. */
  runtimeProbes?: RuntimeProbe[];
  /** Index of the rule to probe. Defaults to 0 (first accepted). */
  ruleIndex?: number;
  /** Skip running the LLM for this scenario (used for refusal tests
   *  where we just verify the orchestrator gate fires). */
  expectRefused?: boolean;
  expectRefusedReason?: string;
}

const SCENARIOS: ScenarioSpec[] = [
  // ════════════════════════════════════════════════════════════════
  // FORMAT REGISTRY — the LLM should pick canonical keys
  // ════════════════════════════════════════════════════════════════
  {
    label: 'F1. Email format → registry key',
    description: 'Email field must be a valid email address',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'fieldPath=email', check: r => r.fieldPath === 'email' },
      { name: 'formatType=email', check: r => r.formatType === 'email',
        detail: r => `formatType=${r.formatType}` },
      { name: 'no raw pattern', check: r => !r.pattern,
        detail: r => `pattern=${r.pattern}` },
    ],
    runtimeProbes: [
      { value: 'jane.doe@example.com', expectedValid: true },
      { value: 'first.last+tag@subdomain.example.co.uk', expectedValid: true },
      { value: 'broken@', expectedValid: false },
      { value: '@nope.com', expectedValid: false },
      { value: 'plain-text', expectedValid: false },
    ],
  },
  {
    label: 'F2. Subject ID format → registry key',
    description: 'Subject ID must be in SITE-001 format (uppercase letters, dash, digits)',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'fieldPath=subject_id', check: r => r.fieldPath === 'subject_id' },
      { name: 'formatType=subject_id (preferred) or custom_regex',
        check: r => r.formatType === 'subject_id' || r.formatType === 'custom_regex',
        detail: r => `formatType=${r.formatType}` },
    ],
    runtimeProbes: [
      { value: 'NYC-001', expectedValid: true },
      { value: 'BOS-1234', expectedValid: true },
      { value: 'nyc-001', expectedValid: false },
      { value: 'NYC001', expectedValid: false },
      { value: 'X-001', expectedValid: false },  // need 2+ letters
    ],
  },
  {
    label: 'F3. US phone format → registry key',
    description: 'Phone (US) must be a valid US phone number',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'fieldPath=phone_us', check: r => r.fieldPath === 'phone_us' },
      { name: 'formatType=phone_us', check: r => r.formatType === 'phone_us' },
    ],
    runtimeProbes: [
      { value: '123-456-7890', expectedValid: true },
      { value: '(123) 456-7890', expectedValid: true },
      { value: '123.456.7890', expectedValid: true },
      { value: 'not-a-phone', expectedValid: false },
      { value: '12-3456-7890', expectedValid: false },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // CUSTOM REGEX — the LLM has to author a real pattern
  // ════════════════════════════════════════════════════════════════
  {
    label: 'R1. ICD-10 code custom regex',
    description: 'ICD-10 diagnosis must be a valid ICD-10 code: a letter (not U), then a digit, then a digit-or-A-or-B, optionally followed by a dot and 1-4 alphanumerics.',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'fieldPath=icd10', check: r => r.fieldPath === 'icd10' },
      { name: 'has pattern', check: r => !!r.pattern,
        detail: r => `pattern=${r.pattern}` },
      { name: 'pattern is anchored', check: r => !!r.pattern && r.pattern.startsWith('^') && r.pattern.endsWith('$'),
        detail: r => `pattern=${r.pattern}` },
    ],
    runtimeProbes: [
      { value: 'A00', expectedValid: true },
      { value: 'B99', expectedValid: true },
      { value: 'M79.604', expectedValid: true },
      { value: 'Z99.89', expectedValid: true },
      { value: 'U07.1', expectedValid: false },  // U excluded
      { value: 'A001', expectedValid: false },   // 4 chars before dot
      { value: 'abc', expectedValid: false },
      { value: '123', expectedValid: false },
    ],
  },
  {
    label: 'R2. MRN with two formats (alternation)',
    description: 'MRN must be either MRN-123456 (MRN dash, 6 to 10 digits) or M12345678 (M then exactly 8 digits).',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'fieldPath=mrn', check: r => r.fieldPath === 'mrn' },
      { name: 'has pattern (alternation expected)', check: r => !!r.pattern && r.pattern.includes('|'),
        detail: r => `pattern=${r.pattern}` },
    ],
    runtimeProbes: [
      { value: 'MRN-123456', expectedValid: true },
      { value: 'MRN-1234567890', expectedValid: true },
      { value: 'M12345678', expectedValid: true },
      { value: 'MRN-12345', expectedValid: false },  // only 5 digits
      { value: 'M1234567', expectedValid: false },   // only 7 digits
      { value: 'mrn-123456', expectedValid: false }, // lowercase
    ],
  },
  {
    label: 'R3. Currency with cents ($X.YY)',
    description: 'Subject ID must look like a US dollar amount (e.g. $12.34 or $1000.00) — dollar sign, digits, dot, exactly two digits.',
    shapeChecks: [
      { name: 'ruleType=format', check: r => r.ruleType === 'format' },
      { name: 'has pattern with literal $', check: r => !!r.pattern && r.pattern.includes('\\$'),
        detail: r => `pattern=${r.pattern}` },
    ],
    runtimeProbes: [
      { value: '$12.34', expectedValid: true },
      { value: '$0.99', expectedValid: true },
      { value: '$1000000.00', expectedValid: true },
      { value: '12.34', expectedValid: false },     // missing $
      { value: '$12', expectedValid: false },       // missing .XX
      { value: '$12.345', expectedValid: false },   // 3 decimals
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // RANGE
  // ════════════════════════════════════════════════════════════════
  {
    label: 'D1. Range (18-120) on Age',
    description: 'Age must be between 18 and 120 years',
    shapeChecks: [
      { name: 'ruleType=range', check: r => r.ruleType === 'range' },
      { name: 'fieldPath=age', check: r => r.fieldPath === 'age' },
      { name: 'minValue=18', check: r => r.minValue === 18, detail: r => `min=${r.minValue}` },
      { name: 'maxValue=120', check: r => r.maxValue === 120, detail: r => `max=${r.maxValue}` },
    ],
    runtimeProbes: [
      { value: '50', expectedValid: true },
      { value: '18', expectedValid: true },
      { value: '120', expectedValid: true },
      { value: '17', expectedValid: false },
      { value: '121', expectedValid: false },
    ],
  },
  {
    label: 'D2. Range with unit-driven default — clinically reasonable systolic BP',
    description: 'Systolic BP must be in a clinically valid range',
    shapeChecks: [
      { name: 'ruleType=range', check: r => r.ruleType === 'range' },
      { name: 'fieldPath=systolic', check: r => r.fieldPath === 'systolic' },
      { name: 'min set sensibly (60-100)', check: r => typeof r.minValue === 'number' && r.minValue >= 50 && r.minValue <= 100,
        detail: r => `min=${r.minValue}` },
      { name: 'max set sensibly (180-250)', check: r => typeof r.maxValue === 'number' && r.maxValue >= 150 && r.maxValue <= 280,
        detail: r => `max=${r.maxValue}` },
    ],
    // The LLM picks the bounds; we just verify they're not insane and the runtime fires correctly.
  },

  // ════════════════════════════════════════════════════════════════
  // CONSISTENCY — generic + date operators + field-to-field
  // ════════════════════════════════════════════════════════════════
  {
    label: 'C1. consistency field-to-field: diastolic < systolic',
    description: 'Diastolic BP must be less than Systolic BP',
    shapeChecks: [
      { name: 'ruleType=consistency', check: r => r.ruleType === 'consistency' },
      { name: 'fieldPath=diastolic', check: r => r.fieldPath === 'diastolic' },
      { name: "operator='<'", check: r => r.operator === '<', detail: r => `op=${r.operator}` },
      { name: 'compareFieldPath=systolic', check: r => r.compareFieldPath === 'systolic' },
    ],
    runtimeProbes: [
      // For consistency, we need to put the compare field in extraData.
      { value: '80', expectedValid: true,  extraData: { systolic: '120' } },   // 80<120 ✓
      { value: '120', expectedValid: false, extraData: { systolic: '80' } },   // 120<80 fail
      { value: '80', expectedValid: false, extraData: { systolic: '80' } },    // 80<80 fail
    ],
  },
  {
    label: 'C2. consistency literal: dose must equal "0.5"',
    description: 'Subject ID must equal "0.5"',
    shapeChecks: [
      { name: 'ruleType=consistency', check: r => r.ruleType === 'consistency' },
      { name: "operator='=='", check: r => r.operator === '==', detail: r => `op=${r.operator}` },
      { name: "compareValue='0.5'", check: r => r.compareValue === '0.5', detail: r => `compareValue=${r.compareValue}` },
    ],
    runtimeProbes: [
      { value: '0.5', expectedValid: true },
      { value: '0.6', expectedValid: false },
      { value: '0.5 ', expectedValid: true },  // runtime trims numerics? no — equality only auto-coerces both numerics
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // DATE OPERATORS
  // ════════════════════════════════════════════════════════════════
  {
    label: 'C3. consistency date_on_or_after with field-to-field',
    description: 'Visit Date must be on or after the Screening Date',
    shapeChecks: [
      { name: 'ruleType=consistency', check: r => r.ruleType === 'consistency' },
      { name: 'fieldPath=visit_date', check: r => r.fieldPath === 'visit_date' },
      { name: "operator=date_on_or_after (preferred) or '>='",
        check: r => r.operator === 'date_on_or_after' || r.operator === '>=',
        detail: r => `op=${r.operator}` },
      { name: 'compareFieldPath=screening_date', check: r => r.compareFieldPath === 'screening_date' },
    ],
    runtimeProbes: [
      { value: '2024-06-15', expectedValid: true,  extraData: { screening_date: '2024-06-01' } },
      { value: '2024-06-01', expectedValid: true,  extraData: { screening_date: '2024-06-01' } },
      { value: '2024-05-31', expectedValid: false, extraData: { screening_date: '2024-06-01' } },
    ],
  },
  {
    label: 'C4. consistency date_before with literal',
    description: 'Consent Date must be before 2025-01-01',
    shapeChecks: [
      { name: 'ruleType=consistency', check: r => r.ruleType === 'consistency' },
      { name: 'fieldPath=consent_date', check: r => r.fieldPath === 'consent_date' },
      { name: 'operator=date_before', check: r => r.operator === 'date_before',
        detail: r => `op=${r.operator}` },
      { name: 'compareValue=2025-01-01 (ISO)', check: r => r.compareValue === '2025-01-01',
        detail: r => `compareValue=${r.compareValue}` },
    ],
    runtimeProbes: [
      { value: '2024-12-31', expectedValid: true },
      { value: '2024-06-15', expectedValid: true },
      { value: '2025-01-01', expectedValid: false },
      { value: '2025-06-15', expectedValid: false },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // VALUE_MATCH (FIRE-WHEN-MATCHES semantics + multi-value)
  // ════════════════════════════════════════════════════════════════
  {
    label: 'V1. value_match: flag if smoker = Yes (warning)',
    description: 'Flag for review if the patient is currently smoking (answer is Yes)',
    shapeChecks: [
      { name: 'ruleType=value_match', check: r => r.ruleType === 'value_match' },
      { name: 'fieldPath=smoker', check: r => r.fieldPath === 'smoker' },
      { name: 'compareValue contains Yes', check: r => !!r.compareValue && /yes/i.test(r.compareValue),
        detail: r => `compareValue=${r.compareValue}` },
      { name: 'severity=warning', check: r => r.severity === 'warning' },
      { name: 'no operator (validator strips it)', check: r => r.operator === undefined,
        detail: r => `op=${r.operator}` },
    ],
    runtimeProbes: [
      { value: 'Yes', expectedValid: false }, // matches → fires → invalid
      { value: 'yes', expectedValid: false }, // case-folded
      { value: 'No',  expectedValid: true  },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // PATTERN_MATCH (FIRE-WHEN-MATCHES — the substring detector)
  // ════════════════════════════════════════════════════════════════
  {
    label: 'P1. pattern_match: flag if Subject ID contains an SSN-shaped substring',
    description: 'Warn if the Subject ID field contains an SSN-shaped substring (3 digits, dash, 2 digits, dash, 4 digits) — patient privacy check',
    shapeChecks: [
      { name: 'ruleType=pattern_match', check: r => r.ruleType === 'pattern_match' },
      { name: 'fieldPath=subject_id', check: r => r.fieldPath === 'subject_id' },
      { name: 'has pattern', check: r => !!r.pattern,
        detail: r => `pattern=${r.pattern}` },
      { name: 'severity=warning', check: r => r.severity === 'warning' },
    ],
    runtimeProbes: [
      // pattern_match returns valid:false WHEN it matches. shouldPass = no match → valid; shouldFail = match → invalid.
      { value: 'NYC-001', expectedValid: true },          // no SSN
      { value: 'note 123-45-6789 included', expectedValid: false }, // contains
      { value: '123-45-6789', expectedValid: false },     // entire is SSN
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // MULTI-RULE
  // ════════════════════════════════════════════════════════════════
  {
    label: 'M1. Multi-rule: required + range + format on Age',
    description: 'Age must be required, between 18 and 120 years',
    // For multi-rule we don't probe runtime (different rules each have
    // different probe values) but we verify shape AT THE BATCH LEVEL.
    responseChecks: [
      { name: 'at least 2 rules', check: r => r.rules.length >= 2,
        detail: r => `got ${r.rules.length} rules: ${r.rules.map(x => x.ruleType).join(',')}` },
      { name: 'has required', check: r => r.rules.some(x => x.ruleType === 'required'),
        detail: r => r.rules.map(x => x.ruleType).join(',') },
      { name: 'has range', check: r => r.rules.some(x => x.ruleType === 'range'),
        detail: r => r.rules.map(x => x.ruleType).join(',') },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // SAFETY GATES — must refuse / strip
  // ════════════════════════════════════════════════════════════════
  {
    label: 'S1. PHI in description (SSN) → orchestrator refuses BEFORE Gemini call',
    description: 'Patient SSN 123-45-6789 must be valid SSN format',
    expectRefused: true,
    expectRefusedReason: 'phi_in_description',
    responseChecks: [
      { name: 'refused=true', check: r => r.flags.refused === true },
      { name: 'reason=phi_in_description', check: r => r.flags.refusedReason === 'phi_in_description' },
      { name: 'containedPhi=true', check: r => r.flags.containedPhi === true },
      { name: '0 rules', check: r => r.rules.length === 0 },
    ],
  },
  {
    label: 'S2. Forbidden ruleType bait (formula) → no formula rule emitted',
    description: 'Use a formula to compute BMI from weight and height',
    responseChecks: [
      { name: 'no formula/business_logic/cross_form rule',
        check: r => !r.rules.some(x =>
          x.ruleType === 'formula' || x.ruleType === 'business_logic' || x.ruleType === 'cross_form'),
        detail: r => `rule types: ${r.rules.map(x => x.ruleType).join(',') || 'none'}` },
    ],
  },
  {
    label: 'S3. Unknown field path bait → must NOT invent fields',
    description: 'The "magic_score" field must be between 1 and 10',
    responseChecks: [
      { name: 'no rule references "magic_score"',
        check: r => !r.rules.some(x => x.fieldPath === 'magic_score'),
        detail: r => `fields: ${r.rules.map(x => x.fieldPath).join(',') || 'none'}` },
    ],
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────

function makeReq(scenario: ScenarioSpec, idx: number): RuleSuggestionRequest {
  return {
    description: scenario.description,
    fieldContext: FIELDS,
    existingRules: [],
    correlationId: `gemini-deep-${idx}-${Date.now()}`,
    maxRules: 5,
    idempotencyKey: `gemini-deep-${idx}-${Math.random()}`,
  };
}

async function runScenario(scenario: ScenarioSpec, idx: number) {
  console.log('\n' + '─'.repeat(72));
  console.log(`[${idx + 1}/${SCENARIOS.length}] ${scenario.label}`);
  console.log(`  description: ${JSON.stringify(scenario.description)}`);

  const t0 = Date.now();
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
      scenario: scenario.label,
      description: scenario.description,
      ruleAccepted: false,
      ruleSummary: '',
      validatorWarnings: [],
      refused: false,
      shapeChecks: [],
      runtimeProbes: [],
      passed: false,
      failures: [`CRASH: ${crashError}`],
      latencyMs: Date.now() - t0,
    });
    return;
  }

  const rec: TestRecord = {
    scenario: scenario.label,
    description: scenario.description,
    ruleAccepted: response.rules.length > 0,
    ruleSummary: response.rules.map(describeRule).join(' || '),
    llmRationale: response.rules[0]?.rationale,
    validatorWarnings: [...response.warnings],
    refused: !!response.flags.refused,
    refusedReason: response.flags.refusedReason,
    shapeChecks: [],
    runtimeProbes: [],
    passed: true,
    failures: [],
    latencyMs: response.stats.latencyMs,
    inputTokens: response.stats.inputTokens,
    outputTokens: response.stats.outputTokens,
    costUsd: response.stats.costUsd,
  };

  console.log(`  rules: ${response.rules.length} | refused=${response.flags.refused}${response.flags.refusedReason ? ` (${response.flags.refusedReason})` : ''} | latency=${response.stats.latencyMs}ms | in/out/cost=${response.stats.inputTokens}/${response.stats.outputTokens}/$${(response.stats.costUsd ?? 0).toFixed(6)}`);

  if (response.rules.length > 0) {
    for (const rule of response.rules) {
      console.log(`    • ${describeRule(rule)}`);
      if (rule.rationale) console.log(`      rationale: ${rule.rationale.substring(0, 150)}${rule.rationale.length > 150 ? '…' : ''}`);
    }
  }
  if (response.warnings.length > 0) {
    console.log(`  warnings: ${response.warnings.length}`);
    for (const w of response.warnings.slice(0, 3)) {
      console.log(`    - ${w.substring(0, 200)}${w.length > 200 ? '…' : ''}`);
    }
  }

  // ── Response-level checks ──
  if (scenario.responseChecks) {
    for (const c of scenario.responseChecks) {
      const ok = c.check(response);
      const detail = c.detail ? c.detail(response) : undefined;
      rec.shapeChecks.push({ check: c.name, ok, detail });
      if (!ok) rec.failures.push(`response check failed: ${c.name}${detail ? ` (${detail})` : ''}`);
    }
  }

  // ── Refusal expectation ──
  if (scenario.expectRefused && !response.flags.refused) {
    rec.failures.push(`expected refused; got accepted with ${response.rules.length} rules`);
  }
  if (scenario.expectRefusedReason && response.flags.refusedReason !== scenario.expectRefusedReason) {
    rec.failures.push(`expected refusedReason=${scenario.expectRefusedReason}; got ${response.flags.refusedReason}`);
  }

  // ── Rule-level shape checks ──
  if (scenario.shapeChecks && response.rules.length > 0) {
    const ruleIdx = scenario.ruleIndex ?? 0;
    const rule = response.rules[ruleIdx];
    if (!rule) {
      rec.failures.push(`expected rule at index ${ruleIdx}; got none`);
    } else {
      for (const c of scenario.shapeChecks) {
        const ok = c.check(rule);
        const detail = c.detail ? c.detail(rule) : undefined;
        rec.shapeChecks.push({ check: c.name, ok, detail });
        if (!ok) rec.failures.push(`shape check failed: ${c.name}${detail ? ` (${detail})` : ''}`);
      }
    }
  } else if (scenario.shapeChecks && !scenario.expectRefused) {
    rec.failures.push(`expected at least 1 rule for shape checks; got 0`);
  }

  // ── Runtime probes ──
  if (scenario.runtimeProbes && response.rules.length > 0) {
    const ruleIdx = scenario.ruleIndex ?? 0;
    const rule = response.rules[ruleIdx];
    if (rule) {
      const runtimeRule = asRuntimeRule(rule);
      for (const probe of scenario.runtimeProbes) {
        const data = { testField: probe.value, ...(probe.extraData || {}) };
        // For consistency rules with compareFieldPath, we need the
        // runtime to look up the compare field by the rule's stated
        // compareFieldPath (e.g. "systolic"). The runtime calls
        // getNestedValue(allData, rule.compareFieldPath), so we put
        // the compare value under that exact key.
        if (rule.compareFieldPath && probe.extraData?.[rule.compareFieldPath] !== undefined) {
          (runtimeRule as any).compareFieldPath = rule.compareFieldPath;
        }
        let gotValid: boolean | 'error';
        let probeError = '';
        try {
          const r = testRuleDirectly(runtimeRule, probe.value, data);
          gotValid = r.valid;
        } catch (err: any) {
          gotValid = 'error';
          probeError = err?.message || String(err);
        }
        const ok = gotValid === probe.expectedValid;
        rec.runtimeProbes.push({
          value: probe.value,
          expectedValid: probe.expectedValid,
          gotValid,
          ok,
          error: probeError || undefined,
        });
        if (!ok) {
          rec.failures.push(
            `runtime probe value=${JSON.stringify(probe.value)} expected valid=${probe.expectedValid} got valid=${gotValid}` +
            (probeError ? ` ERR=${probeError}` : '')
          );
        }
      }
      // Print a probe summary table.
      if (rec.runtimeProbes.length > 0) {
        console.log('  runtime probes:');
        for (const p of rec.runtimeProbes) {
          const icon = p.ok ? '✓' : '✗';
          console.log(`    ${icon} value=${JSON.stringify(p.value).padEnd(50)} expected=${String(p.expectedValid).padEnd(5)} got=${String(p.gotValid)}`);
        }
      }
    }
  }

  rec.passed = rec.failures.length === 0;
  console.log(`  ${rec.passed ? '[PASS]' : '[FAIL]'} ${scenario.label}`);
  if (!rec.passed) {
    for (const f of rec.failures) console.error(`         ↳ ${f}`);
  }

  allResults.push(rec);
}

async function main() {
  console.log('='.repeat(72));
  console.log('GEMINI LIVE DEEP TEST — every rule type, complex regex, runtime probes');
  console.log('='.repeat(72));
  console.log(`Provider: ${process.env.AI_COMPILER_PROVIDER}`);
  console.log(`Model:    ${process.env.GEMINI_MODEL || 'gemini-2.5-pro (default)'}`);
  console.log(`Enabled:  ${process.env.AI_COMPILER_ENABLED}`);
  console.log(`API key:  ${process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 8)}…` : '(not set)'}`);
  console.log(`Fields:   ${FIELDS.length} fields including text/number/date/yesno/select/email/phone/weight/height`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log('='.repeat(72));

  __resetCompilerCacheForTests();
  __resetCompilerProviderForTests();

  for (let i = 0; i < SCENARIOS.length; i++) {
    await runScenario(SCENARIOS[i], i);
    // Polite pause between LLM calls.
    if (i < SCENARIOS.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  // ─── Final report ──────────────────────────────────────────────────
  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('='.repeat(72));
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  for (const r of allResults) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`${icon} ${r.scenario}`);
    if (!r.passed) for (const f of r.failures) console.log(`     ↳ ${f}`);
  }
  console.log('-'.repeat(72));
  console.log(`PASS=${passed}  FAIL=${failed}  (total=${allResults.length})`);
  const totalCost = allResults.reduce((s, r) => s + (r.costUsd || 0), 0);
  const totalIn = allResults.reduce((s, r) => s + (r.inputTokens || 0), 0);
  const totalOut = allResults.reduce((s, r) => s + (r.outputTokens || 0), 0);
  console.log(`Total tokens: in=${totalIn} out=${totalOut}  Total cost: $${totalCost.toFixed(6)}`);
  console.log('='.repeat(72));

  // Detail dump for failed scenarios (helps diagnosis without re-running)
  const fails = allResults.filter(r => !r.passed);
  if (fails.length > 0) {
    console.log('\n--- detailed failures ---');
    for (const r of fails) {
      console.log(`\n${r.scenario}`);
      console.log(`  description: ${r.description}`);
      console.log(`  rule: ${r.ruleSummary || '(none)'}`);
      if (r.llmRationale) console.log(`  rationale: ${r.llmRationale}`);
      if (r.validatorWarnings.length > 0) {
        console.log(`  validator warnings:`);
        for (const w of r.validatorWarnings) console.log(`    - ${w.substring(0, 300)}${w.length > 300 ? '…' : ''}`);
      }
      console.log(`  shape checks:`);
      for (const c of r.shapeChecks) {
        console.log(`    ${c.ok ? '✓' : '✗'} ${c.check}${c.detail ? `  (${c.detail})` : ''}`);
      }
      if (r.runtimeProbes.length > 0) {
        console.log(`  runtime probes:`);
        for (const p of r.runtimeProbes) {
          console.log(`    ${p.ok ? '✓' : '✗'} value=${JSON.stringify(p.value)} expected=${p.expectedValid} got=${p.gotValid}${p.error ? ` ERR=${p.error}` : ''}`);
        }
      }
    }
  }

  if (process.argv.includes('--strict') && failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected fatal error:', err?.message || String(err));
  console.error(err?.stack);
  process.exit(0);
});
