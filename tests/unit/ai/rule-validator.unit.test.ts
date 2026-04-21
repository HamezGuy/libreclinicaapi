/**
 * Rule validator unit tests.
 *
 * Covers Gates 2-4:
 *   - forbidden ruleType -> rejected, NOT retryable
 *   - unknown formatType -> rejected, NOT retryable
 *   - missing fieldPath -> rejected, NOT retryable
 *   - invalid pattern -> rejected, retryable
 *   - failing self-test -> rejected, retryable
 *   - happy path -> accepted with normalized fields
 */
import { describe, it, expect } from '@jest/globals';
import { validateSuggestions } from '../../../src/services/ai/rule-validator.service';
import { FieldContextEntry, SuggestedRule } from '../../../src/services/ai/types';

const FIELDS: FieldContextEntry[] = [
  { path: 'age', label: 'Age', type: 'number', itemId: 1 },
  { path: 'email', label: 'Email', type: 'text', itemId: 2 },
  { path: 'gender', label: 'Gender', type: 'select', itemId: 3, options: [{ label: 'M', value: 'M' }, { label: 'F', value: 'F' }] },
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

describe('rule-validator: structural rejections (not retryable)', () => {
  it('rejects forbidden formula ruleType', () => {
    const r = validateSuggestions([
      { ...makeRule({ ruleType: 'formula' as any }), customExpression: '=1+1' } as any,
    ], FIELDS);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/forbidden_ruleType/);
    expect(r.rejected[0].retryable).toBe(false);
  });
  it('rejects business_logic and cross_form too', () => {
    for (const t of ['business_logic', 'cross_form']) {
      const r = validateSuggestions([makeRule({ ruleType: t as any })], FIELDS);
      expect(r.accepted).toHaveLength(0);
      expect(r.rejected[0].reason).toMatch(/forbidden_ruleType/);
    }
  });
  it('rejects unknown ruleType', () => {
    const r = validateSuggestions([makeRule({ ruleType: 'whatever' as any })], FIELDS);
    expect(r.rejected[0].reason).toMatch(/unknown_ruleType/);
    expect(r.rejected[0].retryable).toBe(false);
  });
  it('rejects unknown fieldPath', () => {
    const r = validateSuggestions([makeRule({ ruleType: 'required', fieldPath: 'nonexistent' })], FIELDS);
    expect(r.rejected[0].reason).toMatch(/unknown_fieldPath/);
  });
  it('rejects unknown formatType (registry membership)', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'format', formatType: 'space_telephone' }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/unknown_formatType/);
  });
  it('rejects range with min > max', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'range', minValue: 10, maxValue: 1 }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/min_greater_than_max/);
  });
  it('rejects consistency with invalid operator', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'consistency', operator: '=', compareValue: '1' }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/invalid_operator/);
  });
  it('rejects consistency referencing unknown compareFieldPath', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'consistency', operator: '==', compareFieldPath: 'no_such_field' }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/unknown_compareFieldPath/);
  });
});

describe('rule-validator: full operator vocabulary', () => {
  // Generic operators
  for (const op of ['==', '!=', '>', '<', '>=', '<=']) {
    it(`accepts generic operator '${op}'`, () => {
      const r = validateSuggestions([
        makeRule({ ruleType: 'consistency', operator: op, compareValue: '42' }),
      ], FIELDS);
      expect(r.accepted).toHaveLength(1);
    });
  }

  // Date operators
  const FIELDS_WITH_DATES: FieldContextEntry[] = [
    ...FIELDS,
    { path: 'visit_date', label: 'Visit Date', type: 'date', itemId: 9 },
    { path: 'screening_date', label: 'Screening Date', type: 'date', itemId: 10 },
  ];

  for (const op of ['date_before', 'date_after', 'date_on_or_before', 'date_on_or_after', 'date_equals']) {
    it(`accepts date operator '${op}' with ISO date literal`, () => {
      const r = validateSuggestions([
        makeRule({
          ruleType: 'consistency',
          fieldPath: 'visit_date', itemId: 9,
          operator: op, compareValue: '2024-01-15',
        }),
      ], FIELDS_WITH_DATES);
      expect(r.accepted).toHaveLength(1);
    });
  }

  it('accepts date operator with field-to-field on two date fields', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency',
        fieldPath: 'visit_date', itemId: 9,
        operator: 'date_on_or_after', compareFieldPath: 'screening_date',
      }),
    ], FIELDS_WITH_DATES);
    expect(r.accepted).toHaveLength(1);
  });

  it('rejects date operator on a non-date field', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency',
        fieldPath: 'age', itemId: 1,
        operator: 'date_before', compareValue: '2024-01-01',
      }),
    ], FIELDS_WITH_DATES);
    expect(r.rejected[0].reason).toMatch(/date_operator_on_non_date_field/);
  });

  it('rejects date operator with non-parseable compareValue (retryable)', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency',
        fieldPath: 'visit_date', itemId: 9,
        operator: 'date_before', compareValue: 'sometime in March',
      }),
    ], FIELDS_WITH_DATES);
    expect(r.rejected[0].reason).toMatch(/date_operator_with_non_date_compareValue/);
    expect(r.rejected[0].retryable).toBe(true);
  });

  it('rejects date operator with non-date compareField', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency',
        fieldPath: 'visit_date', itemId: 9,
        operator: 'date_after', compareFieldPath: 'age',
      }),
    ], FIELDS_WITH_DATES);
    expect(r.rejected[0].reason).toMatch(/date_operator_with_non_date_compareField/);
  });

  it.each([
    ['===',         '=='],
    ['!==',         '!='],
    ['equals',      '=='],
    ['not_equals',  '!='],
    ['gt',          '>'],
    ['lte',         '<='],
    ['before',      'date_before'],
    ['on_or_after', 'date_on_or_after'],
  ])('alias %s suggests canonical %s in error message (retryable)', (alias, suggested) => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'consistency', operator: alias as any, compareValue: '0' }),
    ], FIELDS);
    const reason = r.rejected[0].reason;
    expect(reason).toMatch(/invalid_operator/);
    expect(reason).toContain(`'${suggested}'`);
    expect(r.rejected[0].retryable).toBe(true);
  });
});

describe('rule-validator: retryable rejections (regex / self-test)', () => {
  it('rejects unsafe regex (lookbehind), retryable', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'pattern_match',
        pattern: '(?<=foo)bar',
        selfTest: { shouldPass: ['foobar'], shouldFail: ['baz'] },
      }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/pattern_unsafe/);
    expect(r.rejected[0].retryable).toBe(true);
    expect(r.rejected[0].retryContext).toBeDefined();
  });

  it('rejects format with selfTest that disagrees with the registry pattern, retryable', () => {
    // formatType=email; selfTest claims "abc" passes — it doesn't.
    const r = validateSuggestions([
      makeRule({
        ruleType: 'format', formatType: 'email',
        selfTest: { shouldPass: ['abc'], shouldFail: ['def'] },
      }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/self_test_failed/);
    expect(r.rejected[0].retryable).toBe(true);
  });

  it('rejects pattern_match with no selfTest provided (Gate 4 requirement)', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'pattern_match',
        pattern: '^abc$',
      }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/self_test_failed/);
    expect(r.rejected[0].retryable).toBe(true);
  });
});

describe('rule-validator: type-appropriateness gates', () => {
  // These complement Gates 2-4 by rejecting rules that are syntactically
  // valid but would be silent no-ops at runtime (so the human reviewer
  // never sees a rule that can't actually fire).

  it('rejects range rule on a checkbox field (multi-value, runtime skips)', () => {
    const FIELDS_WITH_CB: FieldContextEntry[] = [
      ...FIELDS,
      { path: 'symptoms', label: 'Symptoms', type: 'checkbox', itemId: 5 },
    ];
    const r = validateSuggestions([
      makeRule({ ruleType: 'range', fieldPath: 'symptoms', itemId: 5, minValue: 0, maxValue: 5 }),
    ], FIELDS_WITH_CB);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/range_on_incompatible_type/);
  });

  it('rejects range rule on a text field (numeric range vs string)', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'range', fieldPath: 'email', itemId: 2, minValue: 0, maxValue: 100 }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/range_on_incompatible_type/);
  });

  it('rejects BP per-component bounds on a non-BP field', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'range', fieldPath: 'age', itemId: 1, bpSystolicMin: 90, bpSystolicMax: 140 }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/bp_bounds_on_non_bp_field/);
  });

  it('accepts BP per-component bounds on a blood_pressure field', () => {
    const FIELDS_WITH_BP: FieldContextEntry[] = [
      ...FIELDS,
      { path: 'bp', label: 'BP', type: 'blood_pressure', itemId: 6 },
    ];
    const r = validateSuggestions([
      makeRule({
        ruleType: 'range', fieldPath: 'bp', itemId: 6,
        bpSystolicMin: 90, bpSystolicMax: 140, bpDiastolicMin: 60, bpDiastolicMax: 90,
      }),
    ], FIELDS_WITH_BP);
    expect(r.accepted).toHaveLength(1);
  });

  it('rejects format rule on a file/image field (UUID blob)', () => {
    const FIELDS_WITH_IMG: FieldContextEntry[] = [
      ...FIELDS,
      { path: 'photo', label: 'Photo', type: 'image', itemId: 4 },
    ];
    const r = validateSuggestions([
      makeRule({
        ruleType: 'format', formatType: 'email',
        fieldPath: 'photo', itemId: 4,
        selfTest: { shouldPass: ['user@example.com'], shouldFail: ['nope'] },
      }),
    ], FIELDS_WITH_IMG);
    expect(r.rejected[0].reason).toMatch(/format_on_incompatible_type/);
  });
});

describe('rule-validator: consistency hardening', () => {
  it('rejects consistency rule with BOTH compareValue and compareFieldPath (ambiguous)', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency', operator: '==',
        compareValue: 'X', compareFieldPath: 'email',
      }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/has_both_compareValue_and_compareFieldPath/);
  });

  it('rejects consistency rule that compares a field to itself (always trivially true/false)', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'consistency', operator: '==',
        fieldPath: 'age', itemId: 1, compareFieldPath: 'age',
      }),
    ], FIELDS);
    expect(r.rejected[0].reason).toMatch(/self_reference/);
  });
});

describe('rule-validator: value_match operator stripping', () => {
  it('strips operator silently from value_match (runtime ignores it)', () => {
    const r = validateSuggestions([
      {
        ...makeRule({ ruleType: 'value_match', compareValue: 'Yes', severity: 'warning' }),
        operator: 'equals',
      } as any,
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect((r.accepted[0] as any).operator).toBeUndefined();
  });
});

describe('rule-validator: additionalProperties:false at runtime', () => {
  it('strips unknown vendor-specific debug fields silently', () => {
    const r = validateSuggestions([
      {
        ...makeRule({ ruleType: 'required' }),
        vendorDebugTrace: 'some debug info',
        undocumentedFlag: true,
      } as any,
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect((r.accepted[0] as any).vendorDebugTrace).toBeUndefined();
    expect((r.accepted[0] as any).undocumentedFlag).toBeUndefined();
  });

  it('strips tableCellTarget silently (AI is forbidden from emitting it)', () => {
    const r = validateSuggestions([
      {
        ...makeRule({ ruleType: 'required' }),
        tableCellTarget: { tableFieldPath: 't', tableItemId: 99, columnId: 'c', columnType: 'text', allRows: true, displayPath: 'd' },
      } as any,
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect((r.accepted[0] as any).tableCellTarget).toBeUndefined();
  });
});

describe('rule-validator: happy paths', () => {
  it('accepts a basic required rule', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'required' }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
    // Forces itemId from the resolved field even if AI sent a wrong one.
    expect(r.accepted[0].itemId).toBe(1);
  });

  it('accepts a range rule with valid bounds', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'range', minValue: 18, maxValue: 120 }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].minValue).toBe(18);
    expect(r.accepted[0].maxValue).toBe(120);
  });

  it('accepts a format rule using a registry key', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'format',
        formatType: 'email',
        fieldPath: 'email',
        itemId: 2,
        selfTest: {
          shouldPass: ['user@example.com', 'first.last@example.co.uk'],
          shouldFail: ['not-an-email', 'a@', '@b.com'],
        },
      }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].formatType).toBe('email');
    // Pattern was stripped (registry resolves it at runtime).
    expect(r.accepted[0].pattern).toBeUndefined();
  });

  it('accepts a value_match rule', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'value_match', compareValue: 'Yes', severity: 'warning' }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
  });

  it('accepts a custom-regex format rule with passing self-tests', () => {
    const r = validateSuggestions([
      makeRule({
        ruleType: 'format',
        pattern: '^[A-Z]{2}-\\d{3}$',
        selfTest: {
          shouldPass: ['NY-001', 'BO-123'],
          shouldFail: ['ny-001', 'NY001'],
        },
      }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].formatType).toBe('custom_regex');
    expect(r.accepted[0].pattern).toBe('^[A-Z]{2}-\\d{3}$');
  });

  it('strips customExpression even from valid rule', () => {
    const r = validateSuggestions([
      { ...makeRule({ ruleType: 'required' }), customExpression: 'totally not allowed' } as any,
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect((r.accepted[0] as any).customExpression).toBeUndefined();
  });

  it('forces itemId to match the resolved field even when AI sent a different one', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'required', fieldPath: 'email', itemId: 99999 }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].itemId).toBe(2); // taken from FIELDS[1].itemId
  });
});

describe('rule-validator: mixed batch', () => {
  it('partitions accepted vs rejected without dropping good ones', () => {
    const r = validateSuggestions([
      makeRule({ ruleType: 'required' }),
      makeRule({ ruleType: 'formula' as any }),
      makeRule({ ruleType: 'range', minValue: 1, maxValue: 10 }),
      makeRule({ ruleType: 'format', formatType: 'made_up' }),
    ], FIELDS);
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted.map(x => x.ruleType).sort()).toEqual(['range', 'required']);
    expect(r.rejected).toHaveLength(2);
  });
});
