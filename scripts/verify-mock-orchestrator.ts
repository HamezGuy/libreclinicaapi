/**
 * Standalone verifier that exercises the FULL backend AI rule-compiler
 * pipeline (orchestrator → mock provider → validator → response) with
 * NO database, NO API key, NO Express server.
 *
 * This is the smoke test you should run after any backend AI change to
 * confirm:
 *   - Provider selector picks the mock when AI_COMPILER_PROVIDER=mock.
 *   - PHI scanner refuses dangerous descriptions before the mock fires.
 *   - Idempotency cache returns the same response on repeated calls.
 *   - Validator post-validates the mock's output.
 *   - Audit `safeAudit()` calls degrade gracefully without a DB.
 *
 * Usage (from libreclinicaapi/):
 *   npx tsx scripts/verify-mock-orchestrator.ts
 *
 * Exit 0 = all assertions passed; exit 1 = at least one failed.
 *
 * NOTE on env var timing: `config/environment.ts` reads process.env at
 * import time, and ES module imports get hoisted above any statement in
 * the file. We set the env vars in this file BEFORE any import, but
 * we ALSO use a `require()`-based dynamic import below for the AI
 * module to be bullet-proof against transpiler hoisting.
 */
/* eslint-disable no-console */

// Force the AI feature on. MUST happen before requiring the orchestrator.
process.env.AI_COMPILER_ENABLED = 'true';
process.env.AI_COMPILER_PROVIDER = 'mock';

// Use `require` (not `import`) so the env vars above are set BEFORE
// `config/environment.ts` is loaded. ESM `import` would hoist above the
// process.env writes and the kill-switch would still read `false`.
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
} from '../src/services/ai/types';

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label}`); }
}

const FIELDS = [
  { path: 'age',          label: 'Age',          type: 'number', itemId: 1, unit: 'years', min: 0, max: 150 },
  { path: 'consent_date', label: 'Consent Date', type: 'date',   itemId: 2 },
  { path: 'email',        label: 'Email',        type: 'email',  itemId: 3 },
];

const CALLER: CompileCallerContext = {
  userId: 999,
  username: 'mock-orchestrator-tester',
  role: 'data_manager',
};

function makeReq(over: Partial<RuleSuggestionRequest>): RuleSuggestionRequest {
  return {
    description: '',
    fieldContext: FIELDS,
    existingRules: [],
    correlationId: 'test-corr-1',
    maxRules: 5,
    idempotencyKey: 'test-key-1',
    ...over,
  };
}

async function main() {
  __resetCompilerCacheForTests();
  __resetCompilerProviderForTests();

  console.log('--- 1: provider selector picks the mock ---');
  // Run a trivial request that should produce a `required` rule.
  const r1 = await compileRules(makeReq({
    description: 'require this field',
    correlationId: 'corr-1', idempotencyKey: 'key-1',
  }), CALLER);
  assert(r1.stats.providerName === 'mock', `stats.providerName = mock (got ${r1.stats.providerName})`);
  assert(r1.stats.modelId.startsWith('mock'), `stats.modelId starts with mock (got ${r1.stats.modelId})`);
  assert(r1.flags.refused === false, 'mock with valid description -> not refused');
  assert(r1.rules.length === 1, `mock returned 1 rule (got ${r1.rules.length})`);
  assert(r1.rules[0].ruleType === 'required', 'rule type = required');
  assert(r1.rules[0].fieldPath === 'age', 'rule targets first available field (age)');
  assert(r1.rules[0].itemId === 1, 'rule itemId echoes the field metadata');

  console.log('\n--- 2: range keyword ---');
  const r2 = await compileRules(makeReq({
    description: 'value must be between 18 and 120',
    correlationId: 'corr-2', idempotencyKey: 'key-2',
  }), CALLER);
  assert(r2.rules.length === 1, 'range -> 1 rule');
  assert(r2.rules[0].ruleType === 'range', 'rule type = range');
  assert(r2.rules[0].minValue === 18, 'minValue = 18');
  assert(r2.rules[0].maxValue === 120, 'maxValue = 120');

  console.log('\n--- 3: multi-rule ---');
  const r3 = await compileRules(makeReq({
    description: 'make this field required and between 1 and 100',
    correlationId: 'corr-3', idempotencyKey: 'key-3',
  }), CALLER);
  assert(r3.rules.length === 2, `multi -> 2 rules (got ${r3.rules.length})`);
  const types3 = r3.rules.map(r => r.ruleType).sort();
  assert(JSON.stringify(types3) === JSON.stringify(['range', 'required']), 'has range + required');

  console.log('\n--- 4: PHI scanner refuses BEFORE the mock fires ---');
  const r4 = await compileRules(makeReq({
    description: 'patient SSN 123-45-6789 must be valid',
    correlationId: 'corr-4', idempotencyKey: 'key-4',
  }), CALLER);
  assert(r4.flags.refused === true, 'PHI description -> refused');
  assert(r4.flags.refusedReason === 'phi_in_description', `refused reason = phi_in_description (got ${r4.flags.refusedReason})`);
  assert(r4.flags.containedPhi === true, 'flags.containedPhi = true');
  assert(r4.rules.length === 0, 'no rules returned');

  console.log('\n--- 5: idempotency cache returns identical response on repeat ---');
  const idemKey = 'idempotency-test-' + Date.now();
  const r5a = await compileRules(makeReq({
    description: 'must be a valid email',
    correlationId: 'corr-5a', idempotencyKey: idemKey,
  }), CALLER);
  const r5b = await compileRules(makeReq({
    description: 'must be a valid email',
    correlationId: 'corr-5b', idempotencyKey: idemKey,
  }), CALLER);
  assert(r5a.rules.length === 1, 'first call returns 1 rule');
  assert(r5b.rules.length === 1, 'second call also returns 1 rule');
  assert(r5b.stats.fromCache === true, 'second call served from cache');
  assert(r5a.stats.fromCache !== true, 'first call NOT from cache');
  assert(JSON.stringify(r5a.rules) === JSON.stringify(r5b.rules), 'rules identical between calls');

  console.log('\n--- 6: empty fieldContext is refused (orchestrator gate) ---');
  const r6 = await compileRules(makeReq({
    description: 'require this field',
    fieldContext: [],
    correlationId: 'corr-6', idempotencyKey: 'key-6',
  }), CALLER);
  assert(r6.flags.refused === true, 'empty fieldContext -> refused');
  assert(r6.flags.refusedReason === 'no_field_context', `refused reason = no_field_context (got ${r6.flags.refusedReason})`);

  console.log('\n--- 7: empty description is refused ---');
  const r7 = await compileRules(makeReq({
    description: '   ',
    correlationId: 'corr-7', idempotencyKey: 'key-7',
  }), CALLER);
  assert(r7.flags.refused === true, 'whitespace-only description -> refused');
  assert(r7.flags.refusedReason === 'empty_description', `refused reason = empty_description (got ${r7.flags.refusedReason})`);

  console.log('\n--- 8: validator catches mock-emitted bad shapes ---');
  // The mock NEVER emits forbidden ruleTypes (its keyword set excludes
  // them); this asserts that the orchestrator wires the validator.
  // We can prove the validator gate ran by checking the response shape:
  // it should have stats.providerName=mock and the rule's itemId should
  // match the resolved field (validator forces this).
  const r8 = await compileRules(makeReq({
    description: 'flag if the answer is yes',
    correlationId: 'corr-8', idempotencyKey: 'key-8',
  }), CALLER);
  assert(r8.rules.length === 1, 'value_match keyword -> 1 rule');
  assert(r8.rules[0].ruleType === 'value_match', 'rule type = value_match');
  assert(r8.rules[0].severity === 'warning', 'severity = warning');
  assert(r8.rules[0].compareValue === 'Yes', 'compareValue = Yes');
  // Validator strips operator on value_match rules — see ai-rule-pipeline doc.
  assert((r8.rules[0] as any).operator === undefined, 'operator stripped from value_match by validator');
  assert(r8.rules[0].itemId === 1, 'itemId forced to match resolved field by validator');

  console.log(`\n--- summary ---\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
