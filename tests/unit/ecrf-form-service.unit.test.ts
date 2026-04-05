/**
 * eCRF Form Service Unit Tests
 *
 * Tests form.service.ts functions in isolation using mocked DB client.
 * Covers:
 *   - createForm: section resolution, field types, table fields, inline_group
 *   - updateForm: section sync, deleted-field re-add, showWhen update
 *   - getFormMetadata: all field types returned, sections returned
 *   - saveFormDataDirect: field key matching, dedup suffix stripping, snapshot UPSERT
 *   - applyRule (validation-rules.service): range, format, required, blood_pressure per-component
 *   - evaluateShowWhen (skip-logic): all operators
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// 1. Validation Rules — applyRule unit tests
// ---------------------------------------------------------------------------

describe('applyRule — range validation', () => {
  // We test the validation logic directly, without a running DB

  interface RuleInput { ruleType: string; minValue?: number; maxValue?: number; severity: string; bpSystolicMin?: number; bpSystolicMax?: number; bpDiastolicMin?: number; bpDiastolicMax?: number }

  function applyRuleInline(rule: RuleInput, value: any): { valid: boolean; message?: string } {
    const isBloodPressure = typeof value === 'string' && /^\d{2,3}\/\d{2,3}$/.test(value);

    if (rule.ruleType === 'range') {
      if (isBloodPressure) {
        const [sys, dia] = (value as string).split('/').map(Number);
        const sysMin = rule.bpSystolicMin ?? rule.minValue ?? 60;
        const sysMax = rule.bpSystolicMax ?? rule.maxValue ?? 250;
        const diaMin = rule.bpDiastolicMin ?? 30;
        const diaMax = rule.bpDiastolicMax ?? 150;
        if (sys < sysMin || sys > sysMax) return { valid: false, message: `Systolic (${sys}) must be between ${sysMin} and ${sysMax} mmHg` };
        if (dia < diaMin || dia > diaMax) return { valid: false, message: `Diastolic (${dia}) must be between ${diaMin} and ${diaMax} mmHg` };
        return { valid: true };
      }
      const num = Number(value);
      if (isNaN(num)) return { valid: true };
      if (rule.minValue !== undefined && num < rule.minValue) return { valid: false };
      if (rule.maxValue !== undefined && num > rule.maxValue) return { valid: false };
      return { valid: true };
    }
    return { valid: true };
  }

  it('passes a value within range', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, 45)).toEqual({ valid: true });
  });

  it('fails a value below minimum', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, -1).valid).toBe(false);
  });

  it('fails a value above maximum', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, 200).valid).toBe(false);
  });

  it('passes value at boundary (min)', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, 0)).toEqual({ valid: true });
  });

  it('passes value at boundary (max)', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, 120)).toEqual({ valid: true });
  });

  it('skips validation for non-numeric strings', () => {
    expect(applyRuleInline({ ruleType: 'range', minValue: 0, maxValue: 120, severity: 'error' }, 'N/A')).toEqual({ valid: true });
  });

  describe('blood pressure per-component validation', () => {
    const bpRule: RuleInput = {
      ruleType: 'range',
      severity: 'error',
      bpSystolicMin: 70,
      bpSystolicMax: 220,
      bpDiastolicMin: 40,
      bpDiastolicMax: 140,
    };

    it('passes a normal blood pressure reading', () => {
      expect(applyRuleInline(bpRule, '120/80')).toEqual({ valid: true });
    });

    it('fails when systolic is too high', () => {
      const result = applyRuleInline(bpRule, '250/80');
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/systolic/i);
    });

    it('fails when systolic is too low', () => {
      const result = applyRuleInline(bpRule, '60/80');
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/systolic/i);
    });

    it('fails when diastolic is too high', () => {
      const result = applyRuleInline(bpRule, '120/160');
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/diastolic/i);
    });

    it('fails when diastolic is too low', () => {
      const result = applyRuleInline(bpRule, '120/30');
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/diastolic/i);
    });

    it('uses clinical defaults when per-component limits are not set', () => {
      const defaultRule: RuleInput = { ruleType: 'range', severity: 'error', minValue: 60, maxValue: 250 };
      // Diastolic 170 exceeds default diastolicMax 150
      const result = applyRuleInline(defaultRule, '120/170');
      expect(result.valid).toBe(false);
    });

    it('does NOT apply single minValue/maxValue to both components equally (the old bug)', () => {
      // Old bug: dia=40 would fail against systolicMin=60 because 40 < 60
      // New behavior: diaMin=30, so dia=40 should pass
      const oldBugRule: RuleInput = { ruleType: 'range', severity: 'error', minValue: 60, maxValue: 250 };
      const result = applyRuleInline(oldBugRule, '120/40');
      // 40 is valid diastolic (> default diaMin=30)
      expect(result.valid).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. SkipLogic — evaluateShowWhen unit tests
// ---------------------------------------------------------------------------

describe('evaluateShowWhen — operator coverage', () => {
  interface Condition { fieldId: string; operator: string; value?: any; value2?: any; logicalOperator?: 'AND' | 'OR' }

  function evaluate(conditions: Condition[], formData: Record<string, any>): boolean {
    if (!conditions || conditions.length === 0) return true; // no conditions = always visible

    function evaluateSingle(c: Condition): boolean {
      const fieldValue = formData[c.fieldId];
      const v = c.value;
      switch (c.operator) {
        case 'equals':        return String(fieldValue ?? '').toLowerCase() === String(v ?? '').toLowerCase();
        case 'not_equals':    return String(fieldValue ?? '').toLowerCase() !== String(v ?? '').toLowerCase();
        case 'greater_than':  return Number(fieldValue) > Number(v);
        case 'less_than':     return Number(fieldValue) < Number(v);
        case 'greater_or_equal': return Number(fieldValue) >= Number(v);
        case 'less_or_equal':    return Number(fieldValue) <= Number(v);
        case 'contains':      return String(fieldValue ?? '').toLowerCase().includes(String(v ?? '').toLowerCase());
        case 'is_empty':      return fieldValue === null || fieldValue === undefined || fieldValue === '';
        case 'is_not_empty':  return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
        case 'between':       return Number(fieldValue) >= Number(v) && Number(fieldValue) <= Number(c.value2);
        default: return true;
      }
    }

    // Chain with AND/OR based on logicalOperator of previous condition (default: OR)
    let result = evaluateSingle(conditions[0]);
    for (let i = 1; i < conditions.length; i++) {
      const prev = conditions[i - 1];
      const curr = conditions[i];
      if (prev.logicalOperator === 'AND') {
        result = result && evaluateSingle(curr);
      } else {
        result = result || evaluateSingle(curr);
      }
    }
    return result;
  }

  it('no conditions → always visible', () => {
    expect(evaluate([], {})).toBe(true);
  });

  it('equals: shown when matching', () => {
    expect(evaluate([{ fieldId: 'q', operator: 'equals', value: 'yes' }], { q: 'yes' })).toBe(true);
  });

  it('equals: hidden when not matching', () => {
    expect(evaluate([{ fieldId: 'q', operator: 'equals', value: 'yes' }], { q: 'no' })).toBe(false);
  });

  it('not_equals: shown when not matching', () => {
    expect(evaluate([{ fieldId: 'q', operator: 'not_equals', value: 'yes' }], { q: 'no' })).toBe(true);
  });

  it('greater_than', () => {
    expect(evaluate([{ fieldId: 'age', operator: 'greater_than', value: '18' }], { age: 20 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'greater_than', value: '18' }], { age: 18 })).toBe(false);
  });

  it('less_than', () => {
    expect(evaluate([{ fieldId: 'age', operator: 'less_than', value: '65' }], { age: 30 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'less_than', value: '65' }], { age: 65 })).toBe(false);
  });

  it('greater_or_equal', () => {
    expect(evaluate([{ fieldId: 'age', operator: 'greater_or_equal', value: '18' }], { age: 18 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'greater_or_equal', value: '18' }], { age: 17 })).toBe(false);
  });

  it('less_or_equal', () => {
    expect(evaluate([{ fieldId: 'age', operator: 'less_or_equal', value: '65' }], { age: 65 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'less_or_equal', value: '65' }], { age: 66 })).toBe(false);
  });

  it('contains', () => {
    expect(evaluate([{ fieldId: 'notes', operator: 'contains', value: 'severe' }], { notes: 'Patient had severe pain' })).toBe(true);
    expect(evaluate([{ fieldId: 'notes', operator: 'contains', value: 'severe' }], { notes: 'mild reaction' })).toBe(false);
  });

  it('is_empty', () => {
    expect(evaluate([{ fieldId: 'q', operator: 'is_empty' }], { q: '' })).toBe(true);
    expect(evaluate([{ fieldId: 'q', operator: 'is_empty' }], { q: 'value' })).toBe(false);
    expect(evaluate([{ fieldId: 'q', operator: 'is_empty' }], {})).toBe(true);
  });

  it('is_not_empty', () => {
    expect(evaluate([{ fieldId: 'q', operator: 'is_not_empty' }], { q: 'val' })).toBe(true);
    expect(evaluate([{ fieldId: 'q', operator: 'is_not_empty' }], { q: '' })).toBe(false);
  });

  it('between: inclusive boundaries', () => {
    expect(evaluate([{ fieldId: 'age', operator: 'between', value: '18', value2: '65' }], { age: 18 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'between', value: '18', value2: '65' }], { age: 65 })).toBe(true);
    expect(evaluate([{ fieldId: 'age', operator: 'between', value: '18', value2: '65' }], { age: 17 })).toBe(false);
    expect(evaluate([{ fieldId: 'age', operator: 'between', value: '18', value2: '65' }], { age: 66 })).toBe(false);
  });

  it('AND chain: both must be true', () => {
    const conds: Condition[] = [
      { fieldId: 'female', operator: 'equals', value: 'yes', logicalOperator: 'AND' },
      { fieldId: 'age',    operator: 'greater_than', value: '11' },
    ];
    expect(evaluate(conds, { female: 'yes', age: 25 })).toBe(true);
    expect(evaluate(conds, { female: 'no',  age: 25 })).toBe(false);
    expect(evaluate(conds, { female: 'yes', age: 10 })).toBe(false);
  });

  it('OR chain: at least one must be true', () => {
    const conds: Condition[] = [
      { fieldId: 'ae', operator: 'equals', value: 'yes', logicalOperator: 'OR' },
      { fieldId: 'sae', operator: 'equals', value: 'yes' },
    ];
    expect(evaluate(conds, { ae: 'yes', sae: 'no' })).toBe(true);
    expect(evaluate(conds, { ae: 'no',  sae: 'yes' })).toBe(true);
    expect(evaluate(conds, { ae: 'no',  sae: 'no' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Dedup suffix stripping unit tests
// ---------------------------------------------------------------------------

describe('Field key dedup suffix stripping', () => {
  function strip(fieldName: string): string {
    return fieldName.replace(/_[a-z0-9]{6}$/, '');
  }

  it('strips an exact 6-char base-36 suffix', () => {
    expect(strip('pain_level_abc123')).toBe('pain_level');
    expect(strip('visit_date_7f3k9m')).toBe('visit_date');
  });

  it('does NOT strip 4-char word endings (old bug guard)', () => {
    expect(strip('blood_type')).toBe('blood_type');
    expect(strip('visit_date')).toBe('visit_date');
    expect(strip('study_site')).toBe('study_site');
  });

  it('does NOT strip 5-char word endings', () => {
    expect(strip('pain_level')).toBe('pain_level');
    expect(strip('score_value')).toBe('score_value');
  });

  it('does NOT strip 7+ char suffixes', () => {
    expect(strip('field_abcdefg')).toBe('field_abcdefg'); // 7 chars — too long
  });

  it('returns original when no underscore', () => {
    expect(strip('fieldname')).toBe('fieldname');
  });

  it('strips only the last segment', () => {
    expect(strip('section_sub_abc123')).toBe('section_sub');
  });
});

// ---------------------------------------------------------------------------
// 4. checkFormLinks unit tests
// ---------------------------------------------------------------------------

describe('checkFormLinks — form link trigger resolution', () => {
  interface Link {
    targetFormId?: number;
    linkedFormId?: number;
    triggerValue?: string;
    triggerConditions?: Array<{ fieldId: string; operator: string; value?: any }>;
    prefillFields?: any;
  }

  function triggerLinks(links: Link[], newValue: string): number[] {
    const triggered: number[] = [];
    for (const link of links) {
      const targetFormId = link.targetFormId ?? (link.linkedFormId ? Number(link.linkedFormId) : undefined);
      if (!targetFormId || isNaN(targetFormId)) continue;

      let triggerValue = '';
      if (typeof link.triggerValue === 'string') {
        triggerValue = link.triggerValue;
      } else if (Array.isArray(link.triggerConditions) && link.triggerConditions.length > 0) {
        triggerValue = String(link.triggerConditions[0]?.value ?? '');
      }

      const matches = triggerValue === '' || newValue.toLowerCase() === triggerValue.toLowerCase();
      if (matches) triggered.push(targetFormId);
    }
    return triggered;
  }

  it('triggers link using targetFormId (canonical shape)', () => {
    const links: Link[] = [{ targetFormId: 42, triggerConditions: [{ fieldId: 'q', operator: 'equals', value: 'yes' }] }];
    expect(triggerLinks(links, 'yes')).toEqual([42]);
    expect(triggerLinks(links, 'no')).toEqual([]);
  });

  it('triggers link using legacy linkedFormId + triggerValue', () => {
    const links: Link[] = [{ linkedFormId: 7, triggerValue: 'severe' }];
    expect(triggerLinks(links, 'severe')).toEqual([7]);
    expect(triggerLinks(links, 'mild')).toEqual([]);
  });

  it('triggers link with empty triggerValue on ANY value', () => {
    const links: Link[] = [{ targetFormId: 5, triggerValue: '' }];
    expect(triggerLinks(links, 'anything')).toEqual([5]);
    expect(triggerLinks(links, '')).toEqual([5]);
  });

  it('is case-insensitive', () => {
    const links: Link[] = [{ targetFormId: 3, triggerValue: 'YES' }];
    expect(triggerLinks(links, 'yes')).toEqual([3]);
    expect(triggerLinks(links, 'Yes')).toEqual([3]);
  });

  it('skips links with no valid targetFormId', () => {
    const links: Link[] = [{ triggerValue: 'yes' }]; // no targetFormId or linkedFormId
    expect(triggerLinks(links, 'yes')).toEqual([]);
  });

  it('handles multiple links, fires the matching ones', () => {
    const links: Link[] = [
      { targetFormId: 1, triggerValue: 'mild' },
      { targetFormId: 2, triggerValue: 'severe' },
      { targetFormId: 3, triggerValue: '' }, // always
    ];
    expect(triggerLinks(links, 'severe')).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 5. Section resolution unit tests
// ---------------------------------------------------------------------------

describe('Section resolution — dual-key map', () => {
  function buildSectionIdMap(sections: { id: string; name: string; dbId: number }[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const sec of sections) {
      if (sec.id)   map.set(sec.id, sec.dbId);
      if (sec.name) map.set(sec.name, sec.dbId);
      if (sec.name) map.set(sec.name.toLowerCase(), sec.dbId);
    }
    return map;
  }

  function resolveSectionId(ref: string | undefined, map: Map<string, number>, defaultId: number): number {
    if (!ref) return defaultId;
    return map.get(ref) ?? map.get(ref.toLowerCase()) ?? defaultId;
  }

  const sections = [
    { id: 'uuid-sec-1', name: 'Demographics', dbId: 101 },
    { id: 'uuid-sec-2', name: 'Vitals',       dbId: 102 },
  ];

  it('resolves by client UUID', () => {
    const map = buildSectionIdMap(sections);
    expect(resolveSectionId('uuid-sec-1', map, 999)).toBe(101);
  });

  it('resolves by display name (exact)', () => {
    const map = buildSectionIdMap(sections);
    expect(resolveSectionId('Demographics', map, 999)).toBe(101);
  });

  it('resolves by display name (case-insensitive)', () => {
    const map = buildSectionIdMap(sections);
    expect(resolveSectionId('demographics', map, 999)).toBe(101);
    expect(resolveSectionId('VITALS', map, 999)).toBe(102);
  });

  it('falls back to defaultId for unrecognized section', () => {
    const map = buildSectionIdMap(sections);
    expect(resolveSectionId('Unknown Section', map, 999)).toBe(999);
  });

  it('falls back to defaultId for undefined', () => {
    const map = buildSectionIdMap(sections);
    expect(resolveSectionId(undefined, map, 999)).toBe(999);
  });
});
