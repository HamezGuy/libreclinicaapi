/**
 * Validation Rules Data-Type Test
 * 
 * Tests applyRule logic for each data type:
 * - yes/no, radio, checkbox/multiselect, combobox, number, text, date
 * - value_match (with trim+lowercase+multi-value)
 * - pattern_match (regex on selection fields)
 * - range, consistency (compare to value), format
 * 
 * This test imports the service module directly and exercises testRuleDirectly().
 * No database connection needed.
 */

// Minimal mock for pool + logger so the module can be imported
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/database/workflow-config.provider', () => ({ resolveQueryAssignee: jest.fn() }));
jest.mock('../src/utils/extended-props', () => ({ parseExtendedProps: jest.fn().mockReturnValue({}) }));

import { testRuleDirectly } from '../src/services/database/validation-rules.service';

function makeRule(overrides: Record<string, any>) {
  return {
    id: 1, crfId: 1, name: 'Test Rule', description: '', fieldPath: 'test',
    severity: 'warning' as const, errorMessage: 'Test failed', active: true,
    ruleType: 'value_match' as any,
    dateCreated: new Date(), createdBy: 1,
    ...overrides
  };
}

describe('Validation Rules — Data Type Tests', () => {

  // =====================================================================
  // YES/NO FIELDS
  // =====================================================================
  describe('Yes/No fields', () => {
    it('value_match triggers on "Yes" (exact)', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, 'Yes', {}).valid).toBe(false);
    });

    it('value_match does NOT trigger on "No" when rule targets "Yes"', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, 'No', {}).valid).toBe(true);
    });

    it('value_match triggers case-insensitively ("yes" matches "Yes")', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, 'yes', {}).valid).toBe(false);
    });

    it('value_match triggers with trim ("  Yes  " matches "Yes")', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, '  Yes  ', {}).valid).toBe(false);
    });

    it('value_match triggers on "No"', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'No' });
      expect(testRuleDirectly(rule, 'No', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Yes', {}).valid).toBe(true);
    });
  });

  // =====================================================================
  // RADIO / SINGLE-SELECT FIELDS
  // =====================================================================
  describe('Radio/Select fields', () => {
    it('value_match triggers on a specific option', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Severe' });
      expect(testRuleDirectly(rule, 'Severe', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Mild', {}).valid).toBe(true);
    });

    it('value_match with multiple targets (pipe-delimited)', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Severe||Life-threatening' });
      expect(testRuleDirectly(rule, 'Severe', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Life-threatening', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Mild', {}).valid).toBe(true);
    });

    it('consistency compare to value (greater than)', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '>', compareValue: '100' });
      expect(testRuleDirectly(rule, '150', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '50', {}).valid).toBe(false);
    });

    it('consistency compare to value (less than)', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '<', compareValue: '100' });
      expect(testRuleDirectly(rule, '50', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '150', {}).valid).toBe(false);
    });

    it('consistency compare to value (equals)', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '==', compareValue: 'Active' });
      expect(testRuleDirectly(rule, 'Active', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, 'Inactive', {}).valid).toBe(false);
    });
  });

  // =====================================================================
  // CHECKBOX / MULTI-SELECT FIELDS
  // =====================================================================
  describe('Checkbox/Multi-select fields', () => {
    it('value_match triggers when ANY selected value matches (comma-separated)', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Nausea||Vomiting' });
      expect(testRuleDirectly(rule, 'Headache,Nausea,Fatigue', {}).valid).toBe(false);
    });

    it('value_match does NOT trigger when no selected value matches', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Nausea||Vomiting' });
      expect(testRuleDirectly(rule, 'Headache,Fatigue', {}).valid).toBe(true);
    });

    it('value_match handles spaces in comma-separated values', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Nausea' });
      expect(testRuleDirectly(rule, 'Headache, Nausea, Fatigue', {}).valid).toBe(false);
    });

    it('pattern_match triggers when any selected value matches regex', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '^Severe' });
      expect(testRuleDirectly(rule, 'Mild,Severe headache,Fatigue', {}).valid).toBe(false);
    });

    it('pattern_match does NOT trigger when no value matches regex', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '^Severe' });
      expect(testRuleDirectly(rule, 'Mild,Moderate,Fatigue', {}).valid).toBe(true);
    });
  });

  // =====================================================================
  // COMBOBOX FIELDS
  // =====================================================================
  describe('Combobox fields', () => {
    it('value_match triggers on exact option', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Other' });
      expect(testRuleDirectly(rule, 'Other', {}).valid).toBe(false);
    });

    it('pattern_match triggers on free-text matching pattern', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: 'Grade\\s[3-5]' });
      expect(testRuleDirectly(rule, 'Grade 4', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Grade 1', {}).valid).toBe(true);
    });

    it('pattern_match is case-insensitive', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '^critical' });
      expect(testRuleDirectly(rule, 'CRITICAL finding', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Normal finding', {}).valid).toBe(true);
    });
  });

  // =====================================================================
  // NUMBER FIELDS
  // =====================================================================
  describe('Number fields', () => {
    it('range check: value within range passes', () => {
      const rule = makeRule({ ruleType: 'range', minValue: 18, maxValue: 120 });
      expect(testRuleDirectly(rule, '25', {}).valid).toBe(true);
    });

    it('range check: value below min fails', () => {
      const rule = makeRule({ ruleType: 'range', minValue: 18, maxValue: 120 });
      expect(testRuleDirectly(rule, '10', {}).valid).toBe(false);
    });

    it('range check: value above max fails', () => {
      const rule = makeRule({ ruleType: 'range', minValue: 18, maxValue: 120 });
      expect(testRuleDirectly(rule, '200', {}).valid).toBe(false);
    });

    it('consistency: greater than a value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '>', compareValue: '0' });
      expect(testRuleDirectly(rule, '5', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '-1', {}).valid).toBe(false);
    });

    it('consistency: less than a value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '<', compareValue: '300' });
      expect(testRuleDirectly(rule, '250', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '350', {}).valid).toBe(false);
    });

    it('consistency: greater than or equal to a value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '>=', compareValue: '18' });
      expect(testRuleDirectly(rule, '18', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '17', {}).valid).toBe(false);
    });

    it('consistency: less than or equal to a value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '<=', compareValue: '100' });
      expect(testRuleDirectly(rule, '100', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '101', {}).valid).toBe(false);
    });

    it('consistency: not equal to a value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '!=', compareValue: '0' });
      expect(testRuleDirectly(rule, '5', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '0', {}).valid).toBe(false);
    });
  });

  // =====================================================================
  // TEXT FIELDS
  // =====================================================================
  describe('Text fields', () => {
    it('format check: email pattern', () => {
      const rule = makeRule({ ruleType: 'format', pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$' });
      expect(testRuleDirectly(rule, 'user@example.com', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, 'invalid-email', {}).valid).toBe(false);
    });

    it('format check: letters only', () => {
      const rule = makeRule({ ruleType: 'format', pattern: '^[a-zA-Z\\s]+$' });
      expect(testRuleDirectly(rule, 'John Doe', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, 'John123', {}).valid).toBe(false);
    });

    it('value_match: direct match with trim and lowercase', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'screen failure' });
      expect(testRuleDirectly(rule, 'Screen Failure', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, '  SCREEN FAILURE  ', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'Completed', {}).valid).toBe(true);
    });

    it('pattern_match: regex on text value', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '^SAE-\\d{4}' });
      expect(testRuleDirectly(rule, 'SAE-0001', {}).valid).toBe(false);
      expect(testRuleDirectly(rule, 'AE-0001', {}).valid).toBe(true);
    });

    it('consistency: equals a specific text value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '==', compareValue: 'Active' });
      expect(testRuleDirectly(rule, 'Active', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, 'Inactive', {}).valid).toBe(false);
    });

    it('consistency: not equal to a specific value', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '!=', compareValue: 'Excluded' });
      expect(testRuleDirectly(rule, 'Included', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, 'Excluded', {}).valid).toBe(false);
    });
  });

  // =====================================================================
  // DATE FIELDS
  // =====================================================================
  describe('Date fields', () => {
    it('consistency: date greater than a value (after)', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '>', compareValue: '2025-01-01' });
      expect(testRuleDirectly(rule, '2025-06-15', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '2024-06-15', {}).valid).toBe(false);
    });

    it('consistency: date less than a value (before)', () => {
      const rule = makeRule({ ruleType: 'consistency', operator: '<', compareValue: '2030-12-31' });
      expect(testRuleDirectly(rule, '2025-06-15', {}).valid).toBe(true);
      expect(testRuleDirectly(rule, '2031-01-01', {}).valid).toBe(false);
    });

    it('consistency: compare date fields (start before end)', () => {
      const rule = makeRule({
        ruleType: 'consistency', operator: '<',
        compareFieldPath: 'endDate'
      });
      const allData = { startDate: '2025-01-01', endDate: '2025-12-31' };
      expect(testRuleDirectly(rule, '2025-01-01', allData).valid).toBe(true);
    });
  });

  // =====================================================================
  // REQUIRED RULE (all types)
  // =====================================================================
  describe('Required rule', () => {
    it('fails on empty string', () => {
      const rule = makeRule({ ruleType: 'required' });
      expect(testRuleDirectly(rule, '', {}).valid).toBe(false);
    });

    it('fails on null', () => {
      const rule = makeRule({ ruleType: 'required' });
      expect(testRuleDirectly(rule, null, {}).valid).toBe(false);
    });

    it('passes on non-empty value', () => {
      const rule = makeRule({ ruleType: 'required' });
      expect(testRuleDirectly(rule, 'Yes', {}).valid).toBe(true);
    });

    it('passes on number zero (valid value)', () => {
      const rule = makeRule({ ruleType: 'required' });
      expect(testRuleDirectly(rule, '0', {}).valid).toBe(true);
    });
  });

  // =====================================================================
  // EDGE CASES
  // =====================================================================
  describe('Edge cases', () => {
    it('value_match with empty compareValue passes', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: '' });
      expect(testRuleDirectly(rule, 'anything', {}).valid).toBe(true);
    });

    it('pattern_match with empty pattern passes', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '' });
      expect(testRuleDirectly(rule, 'anything', {}).valid).toBe(true);
    });

    it('pattern_match with invalid regex passes gracefully', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '[invalid(' });
      expect(testRuleDirectly(rule, 'test', {}).valid).toBe(true);
    });

    it('value_match on empty value passes (not triggered)', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, '', {}).valid).toBe(true);
    });

    it('pattern_match on empty value passes (not triggered)', () => {
      const rule = makeRule({ ruleType: 'pattern_match', pattern: '.*' });
      expect(testRuleDirectly(rule, '', {}).valid).toBe(true);
    });

    it('range check skips non-numeric values', () => {
      const rule = makeRule({ ruleType: 'range', minValue: 0, maxValue: 100 });
      expect(testRuleDirectly(rule, 'abc', {}).valid).toBe(true);
    });

    it('value_match handles spaces-only value with trim', () => {
      const rule = makeRule({ ruleType: 'value_match', compareValue: 'Yes' });
      expect(testRuleDirectly(rule, '   ', {}).valid).toBe(true);
    });
  });
});
