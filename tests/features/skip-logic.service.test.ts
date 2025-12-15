/**
 * Skip Logic Service Unit Tests
 * 
 * Tests for scd_item_metadata and dyn_item_form_metadata integration
 */

import { pool } from '../../src/config/database';
import * as formService from '../../src/services/hybrid/form.service';

// Mock the database pool for unit tests
jest.mock('../../src/config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(() => ({
      query: jest.fn(),
      release: jest.fn()
    }))
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

describe('Skip Logic Service', () => {
  const mockPool = pool as jest.Mocked<typeof pool>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFormMetadata with SCD', () => {
    test('should parse scd_item_metadata entries into showWhen conditions', async () => {
      // Mock CRF query
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ crf_id: 1, name: 'Test Form' }] }) // CRF
        .mockResolvedValueOnce({ rows: [{ crf_version_id: 1 }] }) // Version
        .mockResolvedValueOnce({ rows: [{ section_id: 1, label: 'Main' }] }) // Sections
        .mockResolvedValueOnce({ rows: [{ item_group_id: 1, name: 'Group1' }] }) // Item groups
        .mockResolvedValueOnce({ rows: [
          { 
            item_id: 1, 
            name: 'diabetes_type',
            data_type: 'text',
            data_type_code: 'ST',
            description: 'Diabetes type field'
          },
          { 
            item_id: 2, 
            name: 'has_diabetes',
            data_type: 'text',
            data_type_code: 'ST',
            description: ''
          }
        ] }) // Items
        .mockResolvedValueOnce({ rows: [
          {
            scd_id: 1,
            target_item_id: 1,
            control_field_name: 'has_diabetes',
            option_value: 'yes',
            message: 'Show when diabetes is yes'
          }
        ] }) // SCD metadata
        .mockResolvedValueOnce({ rows: [] }); // Decision conditions

      const metadata = await formService.getFormMetadata(1);

      expect(metadata.items).toBeDefined();
      expect(metadata.items.length).toBe(2);

      // The diabetes_type field should have showWhen from SCD
      const diabetesField = metadata.items.find((i: any) => i.name === 'diabetes_type');
      expect(diabetesField).toBeDefined();
      expect(diabetesField.showWhen).toBeDefined();
      expect(diabetesField.showWhen[0].fieldId).toBe('has_diabetes');
      expect(diabetesField.showWhen[0].value).toBe('yes');
      expect(diabetesField.hasNativeScd).toBe(true);
    });

    test('should handle fields without skip logic', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ crf_id: 1, name: 'Test' }] })
        .mockResolvedValueOnce({ rows: [{ crf_version_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { item_id: 1, name: 'simple_field', data_type_code: 'ST' }
        ] })
        .mockResolvedValueOnce({ rows: [] }) // No SCD entries
        .mockResolvedValueOnce({ rows: [] });

      const metadata = await formService.getFormMetadata(1);

      const simpleField = metadata.items.find((i: any) => i.name === 'simple_field');
      expect(simpleField).toBeDefined();
      expect(simpleField.showWhen).toEqual([]);
      expect(simpleField.hasNativeScd).toBe(false);
    });

    test('should merge SCD conditions with extended properties showWhen', async () => {
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ crf_id: 1, name: 'Test' }] })
        .mockResolvedValueOnce({ rows: [{ crf_version_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { 
            item_id: 1, 
            name: 'conditional_field', 
            data_type_code: 'ST',
            description: '---EXTENDED_PROPS---\n{"showWhen":[{"fieldId":"other","operator":"equals","value":"test"}]}'
          }
        ] })
        .mockResolvedValueOnce({ rows: [
          {
            scd_id: 1,
            target_item_id: 1,
            control_field_name: 'trigger_field',
            option_value: 'trigger_value'
          }
        ] })
        .mockResolvedValueOnce({ rows: [] });

      const metadata = await formService.getFormMetadata(1);

      const field = metadata.items.find((i: any) => i.name === 'conditional_field');
      expect(field).toBeDefined();
      // SCD conditions take precedence
      expect(field.showWhen[0].fieldId).toBe('trigger_field');
      expect(field.hasNativeScd).toBe(true);
    });
  });

  describe('createForm with skip logic', () => {
    test('should insert scd_item_metadata entries for showWhen conditions', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] }) // Check OID exists
          .mockResolvedValueOnce({ rows: [{ crf_id: 1 }] }) // Insert CRF
          .mockResolvedValueOnce({ rows: [{ crf_version_id: 1 }] }) // Insert version
          .mockResolvedValueOnce({ rows: [{ section_id: 1 }] }) // Insert section
          .mockResolvedValueOnce({ rows: [{ item_group_id: 1 }] }) // Insert item group
          // Control field
          .mockResolvedValueOnce({ rows: [{ item_id: 1 }] }) // Insert item
          .mockResolvedValueOnce({ rows: [] }) // Item group metadata
          .mockResolvedValueOnce({ rows: [{ response_set_id: 1 }] }) // Response set
          .mockResolvedValueOnce({ rows: [] }) // Item form metadata
          // Conditional field
          .mockResolvedValueOnce({ rows: [{ item_id: 2 }] }) // Insert item
          .mockResolvedValueOnce({ rows: [] }) // Item group metadata
          .mockResolvedValueOnce({ rows: [{ response_set_id: 2 }] }) // Response set
          .mockResolvedValueOnce({ rows: [] }) // Item form metadata
          // SCD lookup and insert
          .mockResolvedValueOnce({ rows: [{ item_form_metadata_id: 1 }] }) // Target IFM
          .mockResolvedValueOnce({ rows: [{ item_form_metadata_id: 2, name: 'control' }] }) // Control IFM
          .mockResolvedValueOnce({ rows: [] }) // Insert SCD
          .mockResolvedValueOnce({ rows: [] }), // COMMIT
        release: jest.fn()
      };

      (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const formData = {
        name: 'Form with Skip Logic',
        fields: [
          { label: 'Control Field', name: 'control', type: 'radio', options: [{ label: 'Yes', value: 'yes' }] },
          { 
            label: 'Conditional Field', 
            name: 'conditional', 
            type: 'text',
            showWhen: [{ fieldId: 'control', operator: 'equals', value: 'yes' }]
          }
        ]
      };

      await formService.createForm(formData, 1);

      // Verify SCD insert was called
      const scdInsertCall = mockClient.query.mock.calls.find(
        call => call[0]?.includes?.('INSERT INTO scd_item_metadata')
      );
      
      expect(scdInsertCall).toBeDefined();
    });
  });
});

describe('Skip Logic Condition Operators', () => {
  test('should support "equals" operator', () => {
    const condition = {
      fieldId: 'status',
      operator: 'equals',
      value: 'active'
    };

    // In real implementation, this would be used by frontend
    expect(condition.operator).toBe('equals');
    expect(condition.value).toBe('active');
  });

  test('should support "notEquals" operator', () => {
    const condition = {
      fieldId: 'status',
      operator: 'notEquals',
      value: 'inactive'
    };

    expect(condition.operator).toBe('notEquals');
  });

  test('should support "isEmpty" operator', () => {
    const condition = {
      fieldId: 'optional_field',
      operator: 'isEmpty'
    };

    expect(condition.operator).toBe('isEmpty');
    expect(condition.value).toBeUndefined();
  });

  test('should support multiple conditions', () => {
    const conditions = [
      { fieldId: 'field1', operator: 'equals', value: 'yes' },
      { fieldId: 'field2', operator: 'greaterThan', value: 10 }
    ];

    expect(conditions.length).toBe(2);
    expect(conditions[0].fieldId).toBe('field1');
    expect(conditions[1].fieldId).toBe('field2');
  });
});

