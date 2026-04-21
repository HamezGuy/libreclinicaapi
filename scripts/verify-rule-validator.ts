/**
 * Standalone verifier for the AI rule-validator service.
 *
 * Mirrors the structure of `tests/unit/ai/rule-validator.unit.test.ts` but
 * runs WITHOUT Jest's globalSetup (which requires a Postgres test DB on
 * localhost:5433). Useful for sanity-checking the validator changes
 * locally before deploy without spinning up Docker.
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/verify-rule-validator.ts
 *
 * Exit 0 = all assertions passed; exit 1 = at least one failed.
 */
/* eslint-disable no-console */
import { validateSuggestions } from '../src/services/ai/rule-validator.service';
import { FieldContextEntry, SuggestedRule } from '../src/services/ai/types';

const FIELDS: FieldContextEntry[] = [
  { path: 'age', label: 'Age', type: 'number', itemId: 1 },
  { path: 'email', label: 'Email', type: 'text', itemId: 2 },
  { path: 'gender', label: 'Gender', type: 'select', itemId: 3, options: [{ label: 'M', value: 'M' }, { label: 'F', value: 'F' }] },
  { path: 'photo', label: 'Photo', type: 'image', itemId: 4 },
  { path: 'symptoms', label: 'Symptoms', type: 'checkbox', itemId: 5, options: [{ label: 'Cough', value: 'cough' }] },
  { path: 'bp', label: 'Blood Pressure', type: 'blood_pressure', itemId: 6 },
  { path: 'consent', label: 'Consent', type: 'yesno', itemId: 7 },
  { path: 'name', label: 'Name', type: 'text', itemId: 8 },
  { path: 'visit_date', label: 'Visit Date', type: 'date', itemId: 9 },
  { path: 'screening_date', label: 'Screening Date', type: 'date', itemId: 10 },
  { path: 'dob', label: 'Date of Birth', type: 'date_of_birth', itemId: 11 },
  { path: 'visit_dt', label: 'Visit DateTime', type: 'datetime', itemId: 12 },
];

function makeRule(over: Partial<SuggestedRule> & Pick<SuggestedRule, 'ruleType'>): SuggestedRule {
  return {
    name: 'r',
    ruleType: over.ruleType,
    fieldPath: over.fieldPath ?? 'age',
    itemId: over.itemId ?? 1,
    severity: over.severity ?? 'error',
    errorMessage: over.errorMessage ?? 'msg',
    rationale: over.rationale ?? 'reason',
    ...over,
  } as SuggestedRule;
}

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label}`); }
}

console.log('--- structural rejections (existing behavior unchanged) ---');

{
  const r = validateSuggestions([makeRule({ ruleType: 'formula' as any })], FIELDS);
  assert(r.accepted.length === 0 && /forbidden_ruleType/.test(r.rejected[0]?.reason || ''), 'forbidden formula -> rejected');
}
{
  const r = validateSuggestions([makeRule({ ruleType: 'whatever' as any })], FIELDS);
  assert(r.rejected[0]?.reason.includes('unknown_ruleType'), 'unknown ruleType -> rejected');
}
{
  const r = validateSuggestions([makeRule({ ruleType: 'required', fieldPath: 'nonexistent' })], FIELDS);
  assert(r.rejected[0]?.reason.includes('unknown_fieldPath'), 'unknown fieldPath -> rejected');
}
{
  const r = validateSuggestions([makeRule({ ruleType: 'range', minValue: 10, maxValue: 1 })], FIELDS);
  assert(r.rejected[0]?.reason.includes('min_greater_than_max'), 'range min>max -> rejected');
}

console.log('\n--- new: type-appropriateness gates ---');

{
  // range on a checkbox field — multi-value, runtime would skip
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'symptoms', itemId: 5, minValue: 0, maxValue: 5 }),
  ], FIELDS);
  assert(r.accepted.length === 0 && /range_on_incompatible_type/.test(r.rejected[0]?.reason || ''),
    'range on checkbox -> rejected (silent no-op at runtime)');
}
{
  // range on an image field — UUID blob
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'photo', itemId: 4, minValue: 0, maxValue: 100 }),
  ], FIELDS);
  assert(/range_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'range on image -> rejected');
}
{
  // range on a text field — would compare numbers against strings
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'name', itemId: 8, minValue: 0, maxValue: 100 }),
  ], FIELDS);
  assert(/range_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'range on text -> rejected');
}
{
  // range on a yesno field — would compare yes/no against numbers
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'consent', itemId: 7, minValue: 0, maxValue: 1 }),
  ], FIELDS);
  assert(/range_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'range on yesno -> rejected');
}
{
  // BP per-component range against a non-BP field
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'age', itemId: 1, bpSystolicMin: 90, bpSystolicMax: 140 }),
  ], FIELDS);
  assert(/bp_bounds_on_non_bp_field/.test(r.rejected[0]?.reason || ''),
    'BP bounds on non-BP field -> rejected');
}
{
  // BP per-component range against a BP field — accepted
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', fieldPath: 'bp', itemId: 6, bpSystolicMin: 90, bpSystolicMax: 140, bpDiastolicMin: 60, bpDiastolicMax: 90 }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'BP per-component range on bp field -> accepted');
}
{
  // format on a checkbox field — multi-value, runtime would skip
  const r = validateSuggestions([
    makeRule({
      ruleType: 'format', formatType: 'email',
      fieldPath: 'symptoms', itemId: 5,
      selfTest: { shouldPass: ['user@example.com'], shouldFail: ['nope'] },
    }),
  ], FIELDS);
  assert(/format_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'format on checkbox -> rejected');
}
{
  // format on a file/image field
  const r = validateSuggestions([
    makeRule({
      ruleType: 'format', formatType: 'email',
      fieldPath: 'photo', itemId: 4,
      selfTest: { shouldPass: ['user@example.com'], shouldFail: ['nope'] },
    }),
  ], FIELDS);
  assert(/format_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'format on image -> rejected');
}
{
  // format on a text field — accepted
  const r = validateSuggestions([
    makeRule({
      ruleType: 'format', formatType: 'email',
      fieldPath: 'email', itemId: 2,
      selfTest: {
        shouldPass: ['user@example.com', 'first.last@example.co.uk'],
        shouldFail: ['not-an-email', 'a@', '@b.com'],
      },
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'format=email on text field -> accepted');
}
{
  // pattern_match on a checkbox is OK (runtime iterates).
  // pattern_match runtime: returns INVALID (= rule fires) WHEN any element
  // matches the pattern. So a self-test:
  //   shouldPass = "values that should NOT trigger the rule" = no match = ['headache'].
  //   shouldFail = "values that SHOULD trigger the rule"     = match    = ['cough'].
  // This mirrors how the rest of the AI pipeline labels them.
  const r = validateSuggestions([
    makeRule({
      ruleType: 'pattern_match',
      pattern: '^cough$',
      fieldPath: 'symptoms', itemId: 5,
      selfTest: { shouldPass: ['headache'], shouldFail: ['cough'] },
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'pattern_match on checkbox -> accepted (runtime iterates)');
}
{
  // pattern_match on a file -> rejected
  const r = validateSuggestions([
    makeRule({
      ruleType: 'pattern_match',
      pattern: '^abc$',
      fieldPath: 'photo', itemId: 4,
      selfTest: { shouldPass: ['abc'], shouldFail: ['def'] },
    }),
  ], FIELDS);
  assert(/pattern_match_on_incompatible_type/.test(r.rejected[0]?.reason || ''), 'pattern_match on image -> rejected');
}

console.log('\n--- new: consistency tightening ---');

{
  // both compareValue + compareFieldPath -> rejected
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency', operator: '==',
      compareValue: 'X', compareFieldPath: 'email',
    }),
  ], FIELDS);
  assert(/has_both_compareValue_and_compareFieldPath/.test(r.rejected[0]?.reason || ''),
    'consistency with both compareValue + compareFieldPath -> rejected');
}
{
  // self-reference -> rejected
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency', operator: '==',
      fieldPath: 'age', itemId: 1, compareFieldPath: 'age',
    }),
  ], FIELDS);
  assert(/self_reference/.test(r.rejected[0]?.reason || ''),
    'consistency self-reference -> rejected');
}
{
  // valid consistency rule with compareValue
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency', operator: '>=',
      compareValue: '0',
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'consistency with compareValue -> accepted');
}
{
  // valid consistency rule with compareFieldPath
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency', operator: '!=',
      fieldPath: 'age', itemId: 1, compareFieldPath: 'email',
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'consistency with compareFieldPath -> accepted');
}

console.log('\n--- new: full operator vocabulary ---');

// Generic operators on numbers
for (const op of ['==', '!=', '>', '<', '>=', '<=']) {
  const r = validateSuggestions([
    makeRule({ ruleType: 'consistency', operator: op, compareValue: '42' }),
  ], FIELDS);
  assert(r.accepted.length === 1, `consistency operator '${op}' on number -> accepted`);
}

// date_* operators on date fields with literal date values
for (const op of ['date_before', 'date_after', 'date_on_or_before', 'date_on_or_after', 'date_equals']) {
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: op, compareValue: '2024-01-15',
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, `date operator '${op}' with ISO date literal -> accepted`);
}

// date_* with field-to-field on two date-family fields
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: 'date_on_or_after', compareFieldPath: 'screening_date',
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, 'date_on_or_after with date<->date field-to-field -> accepted');
}

// date_* with field-to-field where compareField is NOT a date -> rejected
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: 'date_after', compareFieldPath: 'age',
    }),
  ], FIELDS);
  assert(/date_operator_with_non_date_compareField/.test(r.rejected[0]?.reason || ''),
    'date operator with non-date compareField -> rejected');
}

// date_* on a non-date field -> rejected
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'age', itemId: 1,
      operator: 'date_before', compareValue: '2024-01-01',
    }),
  ], FIELDS);
  assert(/date_operator_on_non_date_field/.test(r.rejected[0]?.reason || ''),
    'date operator on numeric field -> rejected');
}

// date_* with non-date compareValue -> rejected (retryable)
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: 'date_before', compareValue: 'sometime in March',
    }),
  ], FIELDS);
  assert(/date_operator_with_non_date_compareValue/.test(r.rejected[0]?.reason || ''),
    'date operator with non-parseable compareValue -> rejected');
  assert(r.rejected[0]?.retryable === true, 'date operator non-date compareValue -> retryable');
}

// Various date string formats the runtime accepts
for (const dateLit of ['2024-01-15', '01/15/2024', '2024-01-15T14:30', '2024-01-15T14:30:00Z', 'January 15, 2024']) {
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: 'date_equals', compareValue: dateLit,
    }),
  ], FIELDS);
  assert(r.accepted.length === 1, `date literal '${dateLit}' -> accepted`);
}

// DD/MM/YYYY is NOT reliably handled by Date.parse → runtime would silently
// fail; we should reject it pre-flight so the LLM picks ISO instead.
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'consistency',
      fieldPath: 'visit_date', itemId: 9,
      operator: 'date_equals', compareValue: '15/01/2024',
    }),
  ], FIELDS);
  // Note: 15/01/2024 looks DD/MM/YYYY; Date.parse rejects it (month=15).
  // 01/15/2024 (MM/DD/YYYY) is what we accept — see prompt for guidance.
  assert(r.rejected.length === 1, `ambiguous DD/MM/YYYY '15/01/2024' -> rejected (use ISO)`);
}

// === Operator alias hints (LLM hallucinations) ===
const aliasCases: Array<{ alias: string; suggested: string }> = [
  { alias: '===',          suggested: '==' },
  { alias: '!==',          suggested: '!=' },
  { alias: 'equals',       suggested: '==' },
  { alias: 'not_equals',   suggested: '!=' },
  { alias: 'gt',           suggested: '>'  },
  { alias: 'lte',          suggested: '<=' },
  { alias: 'before',       suggested: 'date_before' },
  { alias: 'on_or_after',  suggested: 'date_on_or_after' },
];
for (const { alias, suggested } of aliasCases) {
  const r = validateSuggestions([
    makeRule({ ruleType: 'consistency', operator: alias as any, compareValue: '0' }),
  ], FIELDS);
  const reason = r.rejected[0]?.reason || '';
  assert(/invalid_operator/.test(reason), `alias '${alias}' rejected as invalid_operator`);
  assert(reason.includes(`'${suggested}'`), `alias '${alias}' suggests '${suggested}' in error`);
  assert(r.rejected[0]?.retryable === true, `alias '${alias}' is retryable (LLM can fix)`);
}

// Truly unknown operator -> rejected with allowed list
{
  const r = validateSuggestions([
    makeRule({ ruleType: 'consistency', operator: 'frobnicate' as any, compareValue: '0' }),
  ], FIELDS);
  assert(/invalid_operator/.test(r.rejected[0]?.reason || ''), 'unknown operator -> rejected');
  assert(/Allowed:/.test(r.rejected[0]?.reason || ''), 'unknown operator error lists allowed set');
  assert(r.rejected[0]?.retryable === true, 'unknown operator -> retryable');
}

console.log('\n--- new: value_match operator stripped ---');

{
  // value_match with operator emitted by an LLM -> stripped silently
  const r = validateSuggestions([
    {
      ...makeRule({ ruleType: 'value_match', compareValue: 'Yes', severity: 'warning' }),
      operator: 'equals',
    } as any,
  ], FIELDS);
  assert(r.accepted.length === 1, 'value_match with bogus operator -> accepted');
  assert((r.accepted[0] as any).operator === undefined, 'operator silently stripped from value_match');
}

console.log('\n--- new: unknown property stripped (additionalProperties:false at runtime) ---');

{
  const r = validateSuggestions([
    {
      ...makeRule({ ruleType: 'required' }),
      vendorDebugTrace: 'some debug info',
      undocumentedFlag: true,
    } as any,
  ], FIELDS);
  assert(r.accepted.length === 1, 'unknown properties -> still accepted');
  assert((r.accepted[0] as any).vendorDebugTrace === undefined, 'vendorDebugTrace stripped');
  assert((r.accepted[0] as any).undocumentedFlag === undefined, 'undocumentedFlag stripped');
}

console.log('\n--- regression: existing happy paths still work ---');

{
  const r = validateSuggestions([makeRule({ ruleType: 'required' })], FIELDS);
  assert(r.accepted.length === 1 && r.accepted[0].ruleType === 'required', 'required rule accepted');
}
{
  const r = validateSuggestions([
    makeRule({ ruleType: 'range', minValue: 18, maxValue: 120 }),
  ], FIELDS);
  assert(r.accepted.length === 1 && r.accepted[0].minValue === 18, 'range rule accepted');
}
{
  const r = validateSuggestions([
    makeRule({
      ruleType: 'format', formatType: 'email', fieldPath: 'email', itemId: 2,
      selfTest: {
        shouldPass: ['user@example.com', 'first.last@example.co.uk'],
        shouldFail: ['not-an-email', 'a@', '@b.com'],
      },
    }),
  ], FIELDS);
  assert(r.accepted.length === 1 && r.accepted[0].formatType === 'email', 'format=email accepted');
  assert((r.accepted[0] as any).pattern === undefined, 'pattern stripped (registry resolves)');
}
{
  // customExpression smuggled through
  const r = validateSuggestions([
    {
      ...makeRule({ ruleType: 'required' }),
      customExpression: 'totally not allowed',
    } as any,
  ], FIELDS);
  assert(r.accepted.length === 1, 'rule accepted with customExpression smuggled');
  assert((r.accepted[0] as any).customExpression === undefined, 'customExpression stripped');
}
{
  // tableCellTarget smuggled through
  const r = validateSuggestions([
    {
      ...makeRule({ ruleType: 'required' }),
      tableCellTarget: { tableFieldPath: 't', tableItemId: 99, columnId: 'c', columnType: 'text', allRows: true, displayPath: 'd' },
    } as any,
  ], FIELDS);
  assert(r.accepted.length === 1, 'rule accepted with tableCellTarget smuggled');
  assert((r.accepted[0] as any).tableCellTarget === undefined, 'tableCellTarget stripped');
}

console.log(`\n--- summary ---\nPASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
