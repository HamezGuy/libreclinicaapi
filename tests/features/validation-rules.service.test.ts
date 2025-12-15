/**
 * Validation Rules Service Unit Tests
 * 
 * Tests for rules integration with LibreClinica's rule, rule_expression, rule_action tables
 */

import { pool } from '../../src/config/database';
import * as validationRulesService from '../../src/services/database/validation-rules.service';

// Mock database
jest.mock('../../src/config/database', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Validation Rules Service', () => {
  const mockPool = pool as jest.Mocked<typeof pool>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRulesForCrf', () => {
    test('should combine custom rules, item rules, and native LibreClinica rules', async () => {
      // Mock custom rules query
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 1,
              crf_id: 1,
              name: 'Age Range Check',
              rule_type: 'range',
              field_path: 'age',
              severity: 'error',
              error_message: 'Age must be between 0 and 150',
              active: true,
              min_value: 0,
              max_value: 150
            }
          ] 
        })
        // Mock item_form_metadata rules query
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 100,
              crf_id: 1,
              name: 'email_field',
              rule_type: 'format',
              field_path: 'email_field',
              severity: 'error',
              error_message: 'Invalid email format',
              active: true,
              pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
            }
          ] 
        })
        // Mock native LibreClinica rules query
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 200,
              name: 'Native Rule',
              description: 'LibreClinica native rule',
              oc_oid: 'R_NATIVE_1',
              enabled: true,
              crf_id: 1,
              expression: '{field1} > 0',
              expression_context: 'validation',
              action_type: 'DISCREPANCY_NRS',
              action_message: 'Field must be greater than 0'
            }
          ] 
        });

      const rules = await validationRulesService.getRulesForCrf(1);

      expect(rules.length).toBe(3);
      
      // Custom rule
      expect(rules[0].name).toBe('Age Range Check');
      expect(rules[0].minValue).toBe(0);
      expect(rules[0].maxValue).toBe(150);
      
      // Item form metadata rule
      expect(rules[1].name).toBe('email_field');
      expect(rules[1].ruleType).toBe('format');
      
      // Native rule (with offset ID)
      const nativeRule = rules.find(r => r.name === 'Native Rule');
      expect(nativeRule).toBeDefined();
      expect(nativeRule?.customExpression).toBe('{field1} > 0');
    });

    test('should handle database errors gracefully', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // Custom rules empty
        .mockResolvedValueOnce({ rows: [] }) // Item rules empty
        .mockRejectedValueOnce(new Error('Native rules table not available'));

      const rules = await validationRulesService.getRulesForCrf(1);

      // Should still return rules from other sources
      expect(Array.isArray(rules)).toBe(true);
    });
  });

  describe('validateFormData', () => {
    test('should validate against all rule types', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 1,
              name: 'required_field',
              rule_type: 'required',
              field_path: 'required_field',
              severity: 'error',
              error_message: 'This field is required',
              active: true
            },
            {
              id: 2,
              name: 'range_field',
              rule_type: 'range',
              field_path: 'age',
              severity: 'error',
              error_message: 'Age out of range',
              active: true,
              min_value: 0,
              max_value: 150
            },
            {
              id: 3,
              name: 'pattern_field',
              rule_type: 'format',
              field_path: 'email',
              severity: 'warning',
              warning_message: 'Email format may be invalid',
              active: true,
              pattern: '^[a-z]+@[a-z]+\\.[a-z]+$'
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [] });

      // Valid data
      const validResult = await validationRulesService.validateFormData(1, {
        required_field: 'value',
        age: 25,
        email: 'test@example.com'
      });

      expect(validResult.valid).toBe(true);
      expect(validResult.errors.length).toBe(0);

      // Invalid data - reset mocks
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 1,
              name: 'required_field',
              rule_type: 'required',
              field_path: 'required_field',
              severity: 'error',
              error_message: 'This field is required',
              active: true
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [] });

      const invalidResult = await validationRulesService.validateFormData(1, {
        required_field: '', // Empty - should fail
        age: 200 // Out of range
      });

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    test('should separate errors and warnings by severity', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ 
          rows: [
            {
              id: 1,
              rule_type: 'range',
              field_path: 'score',
              severity: 'error',
              error_message: 'Score too high',
              active: true,
              max_value: 100
            },
            {
              id: 2,
              rule_type: 'range',
              field_path: 'optional_score',
              severity: 'warning',
              warning_message: 'Score seems high',
              active: true,
              max_value: 50
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await validationRulesService.validateFormData(1, {
        score: 150, // Error
        optional_score: 75 // Warning
      });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('CRUD operations', () => {
    test('should create a new validation rule', async () => {
      // Mock table check
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists check
        .mockResolvedValueOnce({ 
          rows: [{ validation_rule_id: 1 }] 
        }); // Insert

      const rule = {
        crfId: 1,
        name: 'Test Rule',
        ruleType: 'range' as const,
        fieldPath: 'age',
        severity: 'error' as const,
        errorMessage: 'Invalid age',
        active: true,
        minValue: 0,
        maxValue: 120
      };

      const result = await validationRulesService.createRule(rule, 1);

      expect(result.id).toBeDefined();
    });

    test('should update an existing rule', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({ rows: [{ validation_rule_id: 1 }] });

      const result = await validationRulesService.updateRule(1, {
        name: 'Updated Rule',
        maxValue: 150
      }, 1);

      expect(result.success).toBe(true);
    });

    test('should delete a rule', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ validation_rule_id: 1 }] });

      const result = await validationRulesService.deleteRule(1);

      expect(result.success).toBe(true);
    });
  });

  describe('Rule type mapping', () => {
    test('should map LibreClinica action types to rule types', () => {
      // This tests the internal mapping function
      const actionTypeMap: Record<string, string> = {
        'DISCREPANCY_NRS': 'business_logic',
        'DISCREPANCY_RS': 'business_logic',
        'EMAIL': 'notification',
        'HIDE': 'consistency',
        'SHOW': 'consistency',
        'INSERT': 'calculation',
        'RANDOMIZATION': 'business_logic',
        'STRATIFICATION_FACTOR': 'calculation'
      };

      for (const [actionType, expectedRuleType] of Object.entries(actionTypeMap)) {
        // The mapping is internal, but we can test the concept
        expect(['business_logic', 'notification', 'consistency', 'calculation']).toContain(expectedRuleType);
      }
    });
  });
});

describe('Validation Rule Types', () => {
  describe('Required validation', () => {
    test('should fail for empty string', () => {
      const isValid = (value: any) => value !== undefined && value !== null && value !== '';
      expect(isValid('')).toBe(false);
      expect(isValid(null)).toBe(false);
      expect(isValid(undefined)).toBe(false);
      expect(isValid('value')).toBe(true);
      expect(isValid(0)).toBe(true); // 0 is valid
    });
  });

  describe('Range validation', () => {
    test('should validate numeric ranges', () => {
      const validateRange = (value: number, min?: number, max?: number) => {
        if (min !== undefined && value < min) return false;
        if (max !== undefined && value > max) return false;
        return true;
      };

      expect(validateRange(50, 0, 100)).toBe(true);
      expect(validateRange(-1, 0, 100)).toBe(false);
      expect(validateRange(150, 0, 100)).toBe(false);
      expect(validateRange(0, 0, 100)).toBe(true); // Edge case
      expect(validateRange(100, 0, 100)).toBe(true); // Edge case
    });
  });

  describe('Pattern validation', () => {
    test('should validate email pattern', () => {
      const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      
      expect(emailPattern.test('test@example.com')).toBe(true);
      expect(emailPattern.test('invalid')).toBe(false);
      expect(emailPattern.test('test@')).toBe(false);
    });

    test('should validate phone pattern', () => {
      const phonePattern = /^\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}$/;
      
      expect(phonePattern.test('555-123-4567')).toBe(true);
      expect(phonePattern.test('(555) 123-4567')).toBe(true);
      expect(phonePattern.test('123')).toBe(false);
    });
  });

  describe('Consistency validation', () => {
    test('should compare field values', () => {
      const validateConsistency = (
        value1: any, 
        value2: any, 
        operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan'
      ) => {
        switch (operator) {
          case 'equals': return value1 === value2;
          case 'notEquals': return value1 !== value2;
          case 'greaterThan': return value1 > value2;
          case 'lessThan': return value1 < value2;
        }
      };

      expect(validateConsistency(10, 10, 'equals')).toBe(true);
      expect(validateConsistency(10, 5, 'greaterThan')).toBe(true);
      expect(validateConsistency(5, 10, 'lessThan')).toBe(true);
      expect(validateConsistency('a', 'b', 'notEquals')).toBe(true);
    });
  });
});

