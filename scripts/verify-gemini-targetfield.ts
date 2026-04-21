/**
 * Quick live verification that the new "Target field:" prefix the
 * per-question UI sends does what we expect against real Gemini:
 *   1. Scope guard accepts the description (length / noise / etc.).
 *   2. Backend prompt §2a anchors the rule to the named field even
 *      when the user's plain-English text is super terse.
 *   3. Validator + runtime confirm the rule is well-formed.
 */
/* eslint-disable no-console */
process.env.AI_COMPILER_ENABLED = 'true';
process.env.AI_COMPILER_PROVIDER = 'gemini';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const m = require('../src/services/ai/rule-compiler.service');

interface Scenario {
  label: string;
  prompt: string;
  /** What we expect the FIRST emitted rule to look like (loose checks). */
  expect: { ruleType?: string; fieldPath?: string };
}

const FIELDS = [
  { path: 'subject_id', label: 'Subject ID', type: 'text', itemId: 1 },
  { path: 'age', label: 'Age', type: 'number', itemId: 2, unit: 'years', min: 0, max: 150 },
  { path: 'email', label: 'Email', type: 'email', itemId: 3 },
];

// What the per-question button sends to the backend.
function scoped(field: typeof FIELDS[0], userRequest: string): string {
  return `Target field: "${field.label}" (path=${field.path}, type=${field.type}${
    (field as any).unit ? `, unit=${(field as any).unit}` : ''
  }${
    typeof (field as any).min === 'number' ? `, min=${(field as any).min}` : ''
  }${
    typeof (field as any).max === 'number' ? `, max=${(field as any).max}` : ''
  }). Every rule you emit MUST target this field unless the user EXPLICITLY names a different one.\n\nUser request: ${userRequest}`;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'Age — terse "required"',
    prompt: scoped(FIELDS[1], 'must be required'),
    expect: { ruleType: 'required', fieldPath: 'age' },
  },
  {
    label: 'Age — "between 18 and 120"',
    prompt: scoped(FIELDS[1], 'between 18 and 120'),
    expect: { ruleType: 'range', fieldPath: 'age' },
  },
  {
    label: 'Email — "must be valid"',
    prompt: scoped(FIELDS[2], 'must be valid'),
    expect: { ruleType: 'format', fieldPath: 'email' },
  },
  {
    label: 'Subject ID — "site-001"',
    prompt: scoped(FIELDS[0], 'site-001 format'),
    expect: { ruleType: 'format', fieldPath: 'subject_id' },
  },
];

(async () => {
  let pass = 0;
  let fail = 0;
  for (const s of SCENARIOS) {
    console.log('\n--- ' + s.label + ' ---');
    console.log('  prompt: ' + s.prompt.replace(/\n/g, ' ').substring(0, 100) + '...');
    try {
      const r = await m.compileRules({
        description: s.prompt,
        fieldContext: FIELDS,
        existingRules: [],
        correlationId: 'tf-' + Date.now(),
        maxRules: 3,
        idempotencyKey: 'tf-' + Math.random(),
      }, { userId: 1, username: 'tf-tester', role: 'data_manager' });
      if (r.flags.refused) {
        fail++;
        console.error('  [FAIL] refused: ' + r.flags.refusedReason);
        for (const w of r.warnings) console.error('    warning: ' + w.substring(0, 150));
        continue;
      }
      if (r.rules.length === 0) {
        fail++;
        console.error('  [FAIL] no rules emitted');
        continue;
      }
      const rule = r.rules[0];
      const matches = (!s.expect.ruleType || rule.ruleType === s.expect.ruleType) &&
                      (!s.expect.fieldPath || rule.fieldPath === s.expect.fieldPath);
      if (matches) {
        pass++;
        console.log('  [PASS] type=' + rule.ruleType + ' field=' + rule.fieldPath);
      } else {
        fail++;
        console.error('  [FAIL] expected type=' + s.expect.ruleType + ' field=' + s.expect.fieldPath +
                      '; got type=' + rule.ruleType + ' field=' + rule.fieldPath);
      }
    } catch (err: any) {
      fail++;
      console.error('  [CRASH] ' + (err?.message || String(err)));
    }
  }
  console.log('\n=== TARGET FIELD PREFIX TEST ===');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
