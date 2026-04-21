/**
 * Standalone verifier for the /api/validation-rules/compile Joi schema.
 *
 * Regression-locks the fix for the HTTP-400 "Validation failed" bug
 * where the AI suggester was unusable on any CRF that already had at
 * least one validation rule. The backend GET endpoint serialises unset
 * columns as JSON `null` (Postgres NULL → JSON null). The /compile
 * Joi schema previously rejected `null` on the optional rule-summary
 * fields with errors like:
 *
 *     "existingRules.0.minValue" must be a number  (type=number.base)
 *     "existingRules.0.pattern"  must be a string  (type=string.base)
 *
 * Result: every AI suggestion request hit 400, the modal showed
 * "block — http_400 — Validation failed", and zero AI rules were ever
 * persisted in production.
 *
 * The fix: every optional existingRules field is now `.allow(null)`
 * (defence in depth — the frontend builder also strips nulls now).
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/verify-compile-schema-nulls.ts
 */
/* eslint-disable no-console */
import { validationRuleSchemas } from '../src/middleware/validation.middleware';

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  [PASS] ${label}`); }
  else      { fail++; console.error(`  [FAIL] ${label}`); }
}

const baseRequest = {
  description: 'Make this field required',
  fieldContext: [{ path: 'fld', label: 'Test Field', type: 'text', itemId: 100 }],
  correlationId: 'corr-1',
  idempotencyKey: 'k-1',
  maxRules: 5,
};

console.log('--- baseline: empty existingRules accepted ---');
let r = validationRuleSchemas.compile.validate({ ...baseRequest, existingRules: [] });
assert(!r.error, 'empty existingRules: no error');

console.log('\n--- regression: existing rule with NULL optional fields accepted ---');
// This is the EXACT shape the backend's GET /validation-rules/crf/:id
// returns for a `required` rule (every nullable column = null).
const requiredRuleAsReturnedByGet = {
  id: 100,
  name: 'My Required Rule',
  ruleType: 'required',
  fieldPath: 'patient_id',
  severity: 'error',
  minValue: null,
  maxValue: null,
  pattern: null,
  formatType: null,
  operator: null,
  compareValue: null,
  compareFieldPath: null,
};
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [requiredRuleAsReturnedByGet],
});
if (r.error) {
  console.error('   error details:', r.error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('\n   '));
}
assert(!r.error, 'required-shaped rule with all-null optional fields: no error');

console.log('\n--- regression: 18 production-shape rules accepted ---');
// This mimics CRF 417 in production — the actual failing case.
const productionLike = [
  {
    id: 456, name: 'BP Range', ruleType: 'range', fieldPath: 'dt_test_table', severity: 'warning',
    minValue: null, maxValue: null, pattern: null, formatType: null,
    operator: null, compareValue: null, compareFieldPath: null,
  },
  {
    id: 451, name: 'Combobox Val', ruleType: 'value_match', fieldPath: 'dt_test_table', severity: 'warning',
    minValue: null, maxValue: null, pattern: null, formatType: null,
    operator: 'not_equals', compareValue: 'severe', compareFieldPath: null,
  },
  {
    id: 449, name: 'Date After', ruleType: 'consistency', fieldPath: 'dt_test_table', severity: 'warning',
    minValue: null, maxValue: null, pattern: null, formatType: null,
    operator: 'date_after', compareValue: '2020-01-01', compareFieldPath: null,
  },
  {
    id: 200, name: 'Format Email', ruleType: 'format', fieldPath: 'email_field', severity: 'error',
    minValue: null, maxValue: null, pattern: null, formatType: 'email',
    operator: null, compareValue: null, compareFieldPath: null,
  },
];
r = validationRuleSchemas.compile.validate({ ...baseRequest, existingRules: productionLike });
if (r.error) {
  console.error('   error details:', r.error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('\n   '));
}
assert(!r.error, 'mixed production-shape batch: no error');

console.log('\n--- valid values still accepted ---');
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{
    id: 1, ruleType: 'range', fieldPath: 'age', severity: 'error',
    minValue: 18, maxValue: 120,
  }],
});
assert(!r.error, 'range rule with numeric bounds: no error');

console.log('\n--- string fields with empty string still accepted ---');
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{
    id: 1, ruleType: 'format', fieldPath: 'fld', severity: 'error',
    pattern: '', formatType: '', operator: '', compareValue: '', compareFieldPath: '',
  }],
});
assert(!r.error, 'rule with empty-string optional fields: no error');

console.log('\n--- name=null also accepted (some legacy rows have NULL name) ---');
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{
    id: 1, name: null, ruleType: 'required', fieldPath: 'fld', severity: 'error',
  }],
});
assert(!r.error, 'rule with name=null: no error');

console.log('\n--- bad shapes still rejected (regression for the regression) ---');
// id missing
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{ ruleType: 'required', fieldPath: 'f', severity: 'error' }],
});
assert(!!r.error, 'missing id: rejected');

// severity missing
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{ id: 1, ruleType: 'required', fieldPath: 'f' }],
});
assert(!!r.error, 'missing severity: rejected');

// invalid severity
r = validationRuleSchemas.compile.validate({
  ...baseRequest,
  existingRules: [{ id: 1, ruleType: 'required', fieldPath: 'f', severity: 'critical' }],
});
assert(!!r.error, 'invalid severity value: rejected');

console.log('\n--- summary ---');
console.log(`PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
