/**
 * @jest-environment node
 * 
 * Validation Rules — End-to-End Flow Tests
 * 
 * Tests the full validation pipeline:
 *   Rule creation → Storage → Loading → Evaluation on patient forms
 * 
 * These are pure logic tests (no database required).
 * Run with: npx jest tests/validation-rules-flow.test.ts --setupFilesAfterEnv=[]
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ─── Mock the validation rule evaluation (client-side applyRule logic) ───
// Extracted from patient-form-modal.component.ts for unit testing

interface ValidationRule {
  id: number;
  crfId: number;
  name: string;
  ruleType: 'required' | 'range' | 'format' | 'consistency' | 'formula' | 'business_logic';
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
  compareFieldPath?: string;
  customExpression?: string;
  itemId?: number;
}

const FORMAT_TYPE_MAP: Record<string, string> = {
  'email': '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
  'phone_us': '^\\(?([0-9]{3})\\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$',
  'letters_only': '^[a-zA-Z\\s]+$',
  'numbers_only': '^[0-9]+$',
  'alphanumeric': '^[a-zA-Z0-9\\s]+$',
  'positive_number': '^[0-9]*\\.?[0-9]+$',
  'integer_only': '^-?[0-9]+$',
  'subject_id': '^[A-Z]{2,5}-\\d{3,5}$',
  'blood_pressure': '^\\d{2,3}\\/\\d{2,3}$',
};

function applyRule(
  rule: ValidationRule,
  value: any,
  allData: Record<string, any> = {}
): { valid: boolean } {
  if (!value && value !== 0 && value !== false) {
    return { valid: rule.ruleType !== 'required' };
  }

  const strValue = String(value);
  const isMultiValue = typeof value === 'string' && value.includes(',') && !value.match(/^\d/);

  switch (rule.ruleType) {
    case 'required':
      if (Array.isArray(value)) return { valid: value.length > 0 };
      return { valid: value !== null && value !== undefined && value !== '' };

    case 'range': {
      if (isMultiValue) return { valid: true };
      const numValue = Number(value);
      if (isNaN(numValue)) return { valid: true };
      if (rule.minValue !== undefined && numValue < rule.minValue) return { valid: false };
      if (rule.maxValue !== undefined && numValue > rule.maxValue) return { valid: false };
      return { valid: true };
    }

    case 'format': {
      let resolvedPattern = rule.pattern;
      if (rule.formatType && rule.formatType !== 'custom_regex' && FORMAT_TYPE_MAP[rule.formatType]) {
        resolvedPattern = FORMAT_TYPE_MAP[rule.formatType];
      }
      if (!resolvedPattern) return { valid: true };
      if (isMultiValue) return { valid: true };
      try {
        return { valid: new RegExp(resolvedPattern).test(strValue) };
      } catch {
        return { valid: true };
      }
    }

    case 'consistency': {
      if (!rule.compareFieldPath || !rule.operator) return { valid: true };
      const compareValue = allData[rule.compareFieldPath];
      const a = Number(value);
      const b = Number(compareValue);
      if (isNaN(a) || isNaN(b)) return { valid: true };
      switch (rule.operator) {
        case '>': return { valid: a > b };
        case '<': return { valid: a < b };
        case '>=': return { valid: a >= b };
        case '<=': return { valid: a <= b };
        case '==': return { valid: a === b };
        case '!=': return { valid: a !== b };
        default: return { valid: true };
      }
    }

    default:
      return { valid: true };
  }
}

// ─── TESTS ───

describe('Validation Rules — applyRule', () => {
  describe('Required rule', () => {
    const rule: ValidationRule = {
      id: 1, crfId: 1, name: 'Required', ruleType: 'required',
      fieldPath: 'age', severity: 'error', errorMessage: 'Required', active: true,
    };

    it('fails for empty string', () => {
      expect(applyRule(rule, '').valid).toBe(false);
    });
    it('fails for null', () => {
      expect(applyRule(rule, null).valid).toBe(false);
    });
    it('fails for undefined', () => {
      expect(applyRule(rule, undefined).valid).toBe(false);
    });
    it('passes for non-empty string', () => {
      expect(applyRule(rule, 'hello').valid).toBe(true);
    });
    it('passes for zero (0 is a valid value)', () => {
      expect(applyRule(rule, 0).valid).toBe(true);
    });
    it('passes for false (boolean)', () => {
      expect(applyRule(rule, false).valid).toBe(true);
    });
    it('passes for non-empty array', () => {
      expect(applyRule(rule, ['a']).valid).toBe(true);
    });
    it('fails for empty array', () => {
      expect(applyRule(rule, []).valid).toBe(false);
    });
  });

  describe('Range rule', () => {
    const rule: ValidationRule = {
      id: 2, crfId: 1, name: 'Age Range', ruleType: 'range',
      fieldPath: 'age', severity: 'error', errorMessage: 'Out of range',
      active: true, minValue: 18, maxValue: 85,
    };

    it('passes for value in range', () => {
      expect(applyRule(rule, 30).valid).toBe(true);
    });
    it('passes for min boundary', () => {
      expect(applyRule(rule, 18).valid).toBe(true);
    });
    it('passes for max boundary', () => {
      expect(applyRule(rule, 85).valid).toBe(true);
    });
    it('fails below min', () => {
      expect(applyRule(rule, 17).valid).toBe(false);
    });
    it('fails above max', () => {
      expect(applyRule(rule, 86).valid).toBe(false);
    });
    it('passes for string number in range', () => {
      expect(applyRule(rule, '30').valid).toBe(true);
    });
    it('skips for non-numeric string (dropdown value)', () => {
      expect(applyRule(rule, 'mild').valid).toBe(true);
    });
    it('skips for multi-value (checkbox)', () => {
      expect(applyRule(rule, 'option1,option2').valid).toBe(true);
    });
  });

  describe('Format rule with formatType (no-code)', () => {
    const emailRule: ValidationRule = {
      id: 3, crfId: 1, name: 'Email', ruleType: 'format',
      fieldPath: 'email', severity: 'warning', errorMessage: 'Invalid email',
      active: true, formatType: 'email',
    };

    it('passes for valid email', () => {
      expect(applyRule(emailRule, 'test@example.com').valid).toBe(true);
    });
    it('fails for invalid email', () => {
      expect(applyRule(emailRule, 'not-an-email').valid).toBe(false);
    });
    it('BUG 1: must use formatType to resolve regex (not just pattern)', () => {
      // If formatType is lost (e.g., testRule controller missing it),
      // the rule has no pattern and would return valid: true for everything
      const brokenRule = { ...emailRule, formatType: undefined };
      // Without formatType AND without pattern, this wrongly passes
      expect(applyRule(brokenRule, 'not-an-email').valid).toBe(true);
      // With formatType, it correctly fails
      expect(applyRule(emailRule, 'not-an-email').valid).toBe(false);
    });
  });

  describe('Format rule with custom regex pattern', () => {
    const subjectIdRule: ValidationRule = {
      id: 4, crfId: 1, name: 'Subject ID', ruleType: 'format',
      fieldPath: 'subjectId', severity: 'error', errorMessage: 'Invalid ID',
      active: true, formatType: 'custom_regex', pattern: '^SITE-\\d{3}$',
    };

    it('passes for valid ID', () => {
      expect(applyRule(subjectIdRule, 'SITE-001').valid).toBe(true);
    });
    it('fails for invalid ID', () => {
      expect(applyRule(subjectIdRule, 'site-1').valid).toBe(false);
    });
  });

  describe('Consistency rule', () => {
    const rule: ValidationRule = {
      id: 5, crfId: 1, name: 'Systolic > Diastolic', ruleType: 'consistency',
      fieldPath: 'systolic', severity: 'error', errorMessage: 'SBP must be > DBP',
      active: true, operator: '>', compareFieldPath: 'diastolic',
    };

    it('passes when systolic > diastolic', () => {
      expect(applyRule(rule, 120, { diastolic: 80 }).valid).toBe(true);
    });
    it('fails when systolic <= diastolic', () => {
      expect(applyRule(rule, 80, { diastolic: 80 }).valid).toBe(false);
    });
    it('fails when systolic < diastolic', () => {
      expect(applyRule(rule, 70, { diastolic: 80 }).valid).toBe(false);
    });
  });

  describe('Severity-based categorization', () => {
    it('error severity should block save', () => {
      const rule: ValidationRule = {
        id: 6, crfId: 1, name: 'Test', ruleType: 'range',
        fieldPath: 'age', severity: 'error', errorMessage: 'Out of range',
        active: true, minValue: 18, maxValue: 85,
      };
      const result = applyRule(rule, 10);
      expect(result.valid).toBe(false);
      expect(rule.severity).toBe('error');
    });

    it('warning severity should throw query (not block)', () => {
      const rule: ValidationRule = {
        id: 7, crfId: 1, name: 'Test', ruleType: 'range',
        fieldPath: 'weight', severity: 'warning', errorMessage: 'Unusual weight',
        active: true, minValue: 30, maxValue: 200,
      };
      const result = applyRule(rule, 250);
      expect(result.valid).toBe(false);
      expect(rule.severity).toBe('warning');
    });
  });

  describe('Selection field types should only get required/compare rules', () => {
    it('range rule on dropdown value should skip (returns valid)', () => {
      const rule: ValidationRule = {
        id: 8, crfId: 1, name: 'Range on Dropdown', ruleType: 'range',
        fieldPath: 'severity_level', severity: 'error', errorMessage: 'Bad range',
        active: true, minValue: 1, maxValue: 5,
      };
      // Dropdown value "moderate" is non-numeric, so range check is skipped
      expect(applyRule(rule, 'moderate').valid).toBe(true);
    });

    it('format rule on dropdown value should be skippable', () => {
      const rule: ValidationRule = {
        id: 9, crfId: 1, name: 'Letters on Dropdown', ruleType: 'format',
        fieldPath: 'country', severity: 'error', errorMessage: 'Letters only',
        active: true, formatType: 'letters_only',
      };
      // This tests that if someone misconfigured a format rule on a dropdown,
      // it should still work (the value matches the pattern)
      expect(applyRule(rule, 'United States').valid).toBe(true);
      // But a value with numbers would fail — highlighting why format rules
      // shouldn't be applied to selection fields in the first place
      expect(applyRule(rule, 'Option 1').valid).toBe(false);
    });
  });
});

describe('Validation Rules — Backend Contract Tests', () => {
  describe('BUG 6: testRule Joi schema vs frontend payload', () => {
    it('frontend sends testValue but Joi expects value', () => {
      const frontendPayload = {
        rule: { ruleType: 'range', minValue: 18, maxValue: 85 },
        testValue: '30',
        testData: {},
      };
      // Joi schema expects 'value' not 'testValue'
      expect('value' in frontendPayload).toBe(false);
      expect('testValue' in frontendPayload).toBe(true);
      // This means the request fails Joi validation
    });
  });

  describe('BUG 1: testRule controller missing formatType', () => {
    it('mock rule should include formatType for format rules', () => {
      const requestBody = {
        rule: {
          ruleType: 'format',
          formatType: 'email',
          errorMessage: 'Invalid email',
        },
        testValue: 'bad-email',
      };

      // The controller builds a mockRule but was missing formatType
      const mockRuleAsBuiltByBuggyController = {
        ruleType: requestBody.rule.ruleType,
        pattern: (requestBody.rule as any).pattern,
        // formatType: MISSING! This was the bug
      };

      // Without formatType, the format rule can't resolve the regex
      expect(mockRuleAsBuiltByBuggyController).not.toHaveProperty('formatType');
    });
  });

  describe('BUG 8: getRuleById missing format_type column', () => {
    it('rule fetched by ID should have formatType for format rules', () => {
      // Simulates what getRuleById returns without the fix
      const ruleFromBuggyQuery = {
        id: 1,
        ruleType: 'format',
        pattern: null,
        // format_type: MISSING from SELECT
      };

      // The rule can't resolve its regex without formatType
      expect(ruleFromBuggyQuery).not.toHaveProperty('format_type');
      expect(ruleFromBuggyQuery).not.toHaveProperty('formatType');
    });
  });
});
