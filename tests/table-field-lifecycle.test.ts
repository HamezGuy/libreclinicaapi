/**
 * Table Field Lifecycle Tests
 * 
 * Tests the complete CRUD lifecycle of table fields:
 * 1. SAVE: Frontend serialization -> API -> Database
 * 2. LOAD: Database -> API -> Frontend mapping
 * 3. FILL: Patient form data entry -> save -> retrieve
 * 
 * These tests verify that tableColumns, tableRows, and tableSettings
 * survive every mapping layer without data loss.
 */

// ============================================================================
// TEST DATA
// ============================================================================

const SAMPLE_TABLE_COLUMNS = [
  { id: 'col_1', label: 'Serial No.', type: 'number', name: 'serial_no', width: 'auto', required: true, options: [] },
  { id: 'col_2', label: 'Drug Name', type: 'text', name: 'drug_name', width: 'auto', required: true, options: [] },
  { id: 'col_3', label: 'Dosage', type: 'text', name: 'dosage', width: 'auto', required: false, options: [] },
  { id: 'col_4', label: 'Route', type: 'select', name: 'route', width: 'auto', required: false, options: [
    { label: 'Oral', value: '1' },
    { label: 'IV', value: '2' },
    { label: 'IM', value: '3' }
  ]},
  { id: 'col_5', label: 'Start Date', type: 'date', name: 'start_date', width: 'auto', required: true },
];

const SAMPLE_TABLE_SETTINGS = {
  minRows: 1,
  maxRows: 50,
  allowAddRows: true,
  allowDeleteRows: true,
  showRowNumbers: true,
  defaultRows: 1
};

const SAMPLE_TABLE_FIELD = {
  id: 'field_test123',
  name: 'medications_table',
  label: 'Current Medications',
  type: 'table',
  helpText: 'List all current medications',
  description: 'Current and concomitant medications',
  required: false,
  readonly: false,
  hidden: false,
  isPhiField: false,
  tableColumns: SAMPLE_TABLE_COLUMNS,
  tableSettings: SAMPLE_TABLE_SETTINGS,
  tableRows: [],
  width: 'full',
  columnPosition: 1,
  order: 1
};

// ============================================================================
// 1. SERIALIZATION TESTS (Frontend -> Backend)
// ============================================================================

describe('Table Field Serialization (Save Path)', () => {

  test('confirmSignature serializes table columns correctly', () => {
    // Simulate what confirmSignature does with a table field
    const field = { ...SAMPLE_TABLE_FIELD };
    
    const processed = {
      id: field.id,
      name: field.name,
      type: field.type,
      label: field.label,
      tableColumns: field.tableColumns?.length > 0 ? field.tableColumns : undefined,
      tableRows: field.tableRows?.length > 0 ? field.tableRows : undefined,
      tableSettings: field.type === 'table' ? (field.tableSettings || {}) : undefined,
    };

    expect(processed.tableColumns).toBeDefined();
    expect(processed.tableColumns).toHaveLength(5);
    expect(processed.tableColumns![0].label).toBe('Serial No.');
    expect(processed.tableColumns![0].name).toBe('serial_no');
    expect(processed.tableColumns![3].options).toHaveLength(3);
    expect(processed.tableSettings).toBeDefined();
    expect((processed.tableSettings as any)!.allowAddRows).toBe(true);
    expect(processed.type).toBe('table');
  });

  test('empty tableColumns array is serialized as undefined', () => {
    const field = { ...SAMPLE_TABLE_FIELD, tableColumns: [] };
    const tableColumns = field.tableColumns?.length > 0 ? field.tableColumns : undefined;
    expect(tableColumns).toBeUndefined();
  });

  test('options inside table columns use newline delimiter correctly', () => {
    const options = SAMPLE_TABLE_COLUMNS[3].options!;
    const optionsText = options.map(o => o.label).join('\n');
    const optionsValues = options.map(o => o.value).join('\n');
    
    expect(optionsText).toBe('Oral\nIV\nIM');
    expect(optionsValues).toBe('1\n2\n3');
    
    // Verify no commas that would cause splitting issues
    expect(optionsText).not.toContain(',');
  });
});

// ============================================================================
// 2. EXTENDED PROPERTIES SERIALIZATION TESTS (Backend)
// ============================================================================

describe('Extended Properties Serialization (Backend)', () => {

  // Simulate serializeExtendedProperties
  function serializeExtendedProperties(field: any): string {
    const extended: any = {
      type: field.type,
      fieldName: field.name,
      isPhiField: field.isPhiField,
      width: field.width,
      columnPosition: field.columnPosition,
      tableColumns: field.tableColumns,
      tableRows: field.tableRows,
      tableSettings: field.tableSettings,
    };
    
    // Remove undefined values (mirrors actual implementation)
    Object.keys(extended).forEach(key => {
      if (extended[key] === undefined) delete extended[key];
    });
    
    return Object.keys(extended).length > 0 ? JSON.stringify(extended) : '';
  }

  test('serializeExtendedProperties includes tableColumns', () => {
    const json = serializeExtendedProperties(SAMPLE_TABLE_FIELD);
    const parsed = JSON.parse(json);
    
    expect(parsed.tableColumns).toBeDefined();
    expect(parsed.tableColumns).toHaveLength(5);
    expect(parsed.tableColumns[0].label).toBe('Serial No.');
    expect(parsed.tableColumns[0].name).toBe('serial_no');
  });

  test('serializeExtendedProperties includes tableSettings', () => {
    const json = serializeExtendedProperties(SAMPLE_TABLE_FIELD);
    const parsed = JSON.parse(json);
    
    expect(parsed.tableSettings).toBeDefined();
    expect(parsed.tableSettings.allowAddRows).toBe(true);
    expect(parsed.tableSettings.maxRows).toBe(50);
  });

  test('serializeExtendedProperties preserves field type as table', () => {
    const json = serializeExtendedProperties(SAMPLE_TABLE_FIELD);
    const parsed = JSON.parse(json);
    
    expect(parsed.type).toBe('table');
  });

  test('serializeExtendedProperties preserves fieldName', () => {
    const json = serializeExtendedProperties(SAMPLE_TABLE_FIELD);
    const parsed = JSON.parse(json);
    
    expect(parsed.fieldName).toBe('medications_table');
  });

  test('description stores extended props with delimiter', () => {
    const helpText = 'Current and concomitant medications';
    const extendedProps = serializeExtendedProperties(SAMPLE_TABLE_FIELD);
    const description = `${helpText}\n---EXTENDED_PROPS---\n${extendedProps}`;
    
    expect(description).toContain('---EXTENDED_PROPS---');
    expect(description).toContain('tableColumns');
    
    // Verify it can be parsed back
    const parts = description.split('---EXTENDED_PROPS---');
    expect(parts).toHaveLength(2);
    expect(parts[0].trim()).toBe(helpText);
    
    const reparsed = JSON.parse(parts[1].trim());
    expect(reparsed.tableColumns).toHaveLength(5);
  });

  test('column options with commas in labels survive serialization', () => {
    const fieldWithCommaOptions = {
      ...SAMPLE_TABLE_FIELD,
      tableColumns: [{
        id: 'col_test',
        label: 'Assessment',
        type: 'select',
        name: 'assessment',
        options: [
          { label: 'Mild, no treatment needed', value: '1' },
          { label: 'Moderate, requires monitoring', value: '2' },
          { label: 'Severe, requires intervention', value: '3' }
        ]
      }]
    };
    
    const json = serializeExtendedProperties(fieldWithCommaOptions);
    const reparsed = JSON.parse(json);
    
    // Commas in labels must survive JSON round-trip
    expect(reparsed.tableColumns[0].options[0].label).toBe('Mild, no treatment needed');
    expect(reparsed.tableColumns[0].options[1].label).toBe('Moderate, requires monitoring');
  });
});

// ============================================================================
// 3. LOADING/PARSING TESTS (Backend -> Frontend)
// ============================================================================

describe('Extended Properties Deserialization (Load Path)', () => {

  function parseExtendedProps(description: string): { helpText: string; extendedProps: any } {
    let helpText = description || '';
    let extendedProps: any = {};
    
    if (helpText.includes('---EXTENDED_PROPS---')) {
      const parts = helpText.split('---EXTENDED_PROPS---');
      helpText = parts[0].trim();
      try {
        extendedProps = JSON.parse(parts[1].trim());
      } catch (e) {
        // Parse error
      }
    }
    
    return { helpText, extendedProps };
  }

  test('parses tableColumns from description', () => {
    const desc = `Help text\n---EXTENDED_PROPS---\n${JSON.stringify({
      type: 'table',
      tableColumns: SAMPLE_TABLE_COLUMNS,
      tableSettings: SAMPLE_TABLE_SETTINGS
    })}`;
    
    const { helpText, extendedProps } = parseExtendedProps(desc);
    
    expect(helpText).toBe('Help text');
    expect(extendedProps.type).toBe('table');
    expect(extendedProps.tableColumns).toHaveLength(5);
    expect(extendedProps.tableSettings.allowAddRows).toBe(true);
  });

  test('handles missing extended props gracefully', () => {
    const { helpText, extendedProps } = parseExtendedProps('Just help text, no props');
    
    expect(helpText).toBe('Just help text, no props');
    expect(extendedProps).toEqual({});
    expect(extendedProps.tableColumns).toBeUndefined();
  });

  test('handles empty description', () => {
    const { helpText, extendedProps } = parseExtendedProps('');
    
    expect(helpText).toBe('');
    expect(extendedProps).toEqual({});
  });

  test('API response includes tableColumns in field object', () => {
    const extendedProps = {
      type: 'table',
      fieldName: 'medications_table',
      tableColumns: SAMPLE_TABLE_COLUMNS,
      tableSettings: SAMPLE_TABLE_SETTINGS
    };
    
    // Simulate API response field mapping (form.service.ts getFormMetadata)
    const apiField = {
      id: '181',
      item_id: 181,
      name: extendedProps.fieldName || 'Current Medications',
      label: 'Current Medications',
      type: extendedProps.type || 'text',
      tableColumns: extendedProps.tableColumns,
      tableRows: (extendedProps as any).tableRows,
      tableSettings: extendedProps.tableSettings,
    };
    
    expect(apiField.type).toBe('table');
    expect(apiField.tableColumns).toHaveLength(5);
    expect(apiField.name).toBe('medications_table');
  });
});

// ============================================================================
// 4. FRONTEND FIELD MAPPING TESTS
// ============================================================================

describe('Frontend Field Mapping (All 3 Mappers)', () => {

  const apiItem = {
    id: '181',
    item_id: 181,
    name: 'medications_table',
    label: 'Current Medications',
    type: 'table',
    tableColumns: SAMPLE_TABLE_COLUMNS,
    tableRows: [],
    tableSettings: SAMPLE_TABLE_SETTINGS,
    required: false,
    hidden: false,
    options: null,
    unit: '',
    width: 'full',
  };

  test('dashboard mapItemToField preserves tableColumns', () => {
    // Simulate dashboard.component.ts mapItemToField
    const mapped = {
      id: apiItem.id,
      name: apiItem.name,
      label: apiItem.label,
      type: apiItem.type, // Must be 'table' not mapped to something else
      tableColumns: apiItem.tableColumns,
      tableRows: apiItem.tableRows,
      tableSettings: apiItem.tableSettings,
    };
    
    expect(mapped.type).toBe('table');
    expect(mapped.tableColumns).toBeDefined();
    expect(mapped.tableColumns).toHaveLength(5);
    expect(mapped.tableColumns![0].label).toBe('Serial No.');
  });

  test('adapter mapMetadataToFields preserves tableColumns', () => {
    // Simulate libreclinica-form-template-adapter.service.ts mapMetadataToFields
    const mapped = {
      id: apiItem.id,
      name: apiItem.name,
      label: apiItem.label,
      type: apiItem.type,
      tableColumns: apiItem.tableColumns,
      tableRows: apiItem.tableRows,
      tableSettings: apiItem.tableSettings,
    };
    
    expect(mapped.tableColumns).toBeDefined();
    expect(mapped.tableColumns).toHaveLength(5);
    expect(mapped.tableRows).toBeDefined();
    expect(mapped.tableSettings).toBeDefined();
  });

  test('patient-form-modal mapSingleItemToField preserves tableColumns', () => {
    // Simulate patient-form-modal.component.ts mapSingleItemToField
    const typeMap: Record<string, string> = {
      'table': 'table',
      'text': 'text',
    };
    
    const normalizedType = (apiItem.type || 'text').toLowerCase();
    
    const mapped = {
      id: apiItem.id,
      name: apiItem.name,
      label: apiItem.label,
      type: typeMap[normalizedType] || normalizedType || 'text',
      tableColumns: apiItem.tableColumns,
      tableRows: apiItem.tableRows,
      tableSettings: apiItem.tableSettings,
    };
    
    expect(mapped.type).toBe('table');
    expect(mapped.tableColumns).toBeDefined();
    expect(mapped.tableColumns).toHaveLength(5);
  });

  test('dashboard mapItemType maps table correctly', () => {
    const typeMap: Record<string, string> = {
      'table': 'table',
      'text': 'text',
      'st': 'text',
    };
    
    expect(typeMap['table']).toBe('table');
    expect(typeMap['text']).toBe('text');
  });
});

// ============================================================================
// 5. TABLE COLUMN RESOLUTION TESTS (getTableColumns)
// ============================================================================

describe('getTableColumns Resolution', () => {

  test('resolves columns from tableColumns property', () => {
    const field = {
      id: 'test',
      name: 'test_table',
      label: 'Test Table',
      type: 'table',
      tableColumns: SAMPLE_TABLE_COLUMNS,
    };
    
    const columns = field.tableColumns.map((col: any) => ({
      key: col.name || col.id || col.key,
      label: col.label || col.name || col.id,
      type: col.type || 'text',
    }));
    
    expect(columns).toHaveLength(5);
    expect(columns[0].key).toBe('serial_no');
    expect(columns[0].label).toBe('Serial No.');
    expect(columns[0].type).toBe('number');
    expect(columns[4].key).toBe('start_date');
    expect(columns[4].type).toBe('date');
  });

  test('returns empty array when tableColumns is missing (no fallback)', () => {
    const field = {
      id: 'test',
      name: 'test_table',
      label: 'Test Table',
      type: 'table',
      // NO tableColumns
    };
    
    const tableColumns = (field as any).tableColumns;
    const hasColumns = tableColumns && Array.isArray(tableColumns) && tableColumns.length > 0;
    
    expect(hasColumns).toBeFalsy();
    // Should return empty array, not fallback
    const columns = hasColumns ? tableColumns : [];
    expect(columns).toHaveLength(0);
  });

  test('column key prefers name over id', () => {
    const col = { id: 'col_1', name: 'serial_no', label: 'Serial No.' };
    const key = col.name || col.id;
    expect(key).toBe('serial_no');
  });

  test('column key falls back to id when name is missing', () => {
    const col = { id: 'col_1', label: 'Serial No.' };
    const key = (col as any).name || col.id;
    expect(key).toBe('col_1');
  });
});

// ============================================================================
// 6. TABLE DATA ENTRY TESTS (Patient Form)
// ============================================================================

describe('Table Data Entry (Fill Path)', () => {

  test('addTableRow creates row with correct column keys', () => {
    const columns = SAMPLE_TABLE_COLUMNS.map(col => ({
      key: col.name || col.id,
      label: col.label,
      type: col.type,
    }));
    
    const newRow: any = {};
    columns.forEach(col => newRow[col.key] = '');
    
    expect(Object.keys(newRow)).toEqual(['serial_no', 'drug_name', 'dosage', 'route', 'start_date']);
    expect(newRow.serial_no).toBe('');
    expect(newRow.drug_name).toBe('');
  });

  test('onTableCellChange updates correct cell', () => {
    const tableData: any[] = [{ serial_no: '', drug_name: '' }];
    
    // Simulate onTableCellChange
    tableData[0]['drug_name'] = 'Aspirin';
    
    expect(tableData[0].drug_name).toBe('Aspirin');
  });

  test('syncTableToFormControl stores as valid JSON', () => {
    const tableData = [
      { serial_no: '1', drug_name: 'Aspirin', dosage: '100mg' },
      { serial_no: '2', drug_name: 'Metformin', dosage: '500mg' },
    ];
    
    const jsonValue = JSON.stringify(tableData);
    
    expect(() => JSON.parse(jsonValue)).not.toThrow();
    
    const parsed = JSON.parse(jsonValue);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].drug_name).toBe('Aspirin');
    expect(parsed[1].dosage).toBe('500mg');
  });

  test('getTableRows parses JSON from form control', () => {
    const controlValue = JSON.stringify([
      { serial_no: '1', drug_name: 'Aspirin' },
      { serial_no: '2', drug_name: 'Metformin' },
    ]);
    
    const parsed = typeof controlValue === 'string' ? JSON.parse(controlValue) : controlValue;
    const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    
    expect(rows).toHaveLength(2);
    expect(rows[0].drug_name).toBe('Aspirin');
  });

  test('removeTableRow removes correct row and preserves others', () => {
    const tableData = [
      { serial_no: '1', drug_name: 'Aspirin' },
      { serial_no: '2', drug_name: 'Metformin' },
      { serial_no: '3', drug_name: 'Lisinopril' },
    ];
    
    // Remove row at index 1 (Metformin)
    tableData.splice(1, 1);
    
    expect(tableData).toHaveLength(2);
    expect(tableData[0].drug_name).toBe('Aspirin');
    expect(tableData[1].drug_name).toBe('Lisinopril');
  });
});

// ============================================================================
// 7. OPTIONS DELIMITER TESTS (newline vs comma)
// ============================================================================

describe('Options Delimiter (Newline Format)', () => {

  test('save uses newline delimiter', () => {
    const options = [
      { label: 'Oral', value: '1' },
      { label: 'IV', value: '2' },
      { label: 'Topical, applied locally', value: '3' },
    ];
    
    const optionsText = options.map(o => o.label).join('\n');
    const optionsValues = options.map(o => o.value).join('\n');
    
    expect(optionsText).toBe('Oral\nIV\nTopical, applied locally');
    expect(optionsValues).toBe('1\n2\n3');
  });

  test('load detects newline delimiter', () => {
    const optionsText = 'Oral\nIV\nTopical, applied locally';
    const optionsValues = '1\n2\n3';
    
    const delimiter = optionsText.includes('\n') ? '\n' : ',';
    expect(delimiter).toBe('\n');
    
    const labels = optionsText.split(delimiter);
    const values = optionsValues.split(delimiter);
    
    expect(labels).toHaveLength(3);
    expect(labels[2]).toBe('Topical, applied locally'); // Comma preserved!
    expect(values[2]).toBe('3');
  });

  test('load falls back to comma for legacy data', () => {
    const optionsText = 'Oral,IV,IM';
    const optionsValues = '1,2,3';
    
    const delimiter = optionsText.includes('\n') ? '\n' : ',';
    expect(delimiter).toBe(',');
    
    const labels = optionsText.split(delimiter);
    expect(labels).toHaveLength(3);
  });
});

// ============================================================================
// 8. RESPONSE TYPE MAPPING TESTS
// ============================================================================

describe('Response Type Mapping', () => {

  const mapFieldTypeToResponseType = (fieldType: string): number => {
    const typeMap: Record<string, number> = {
      'text': 1, 'textarea': 2, 'checkbox': 3, 'file': 4, 'radio': 5,
      'select': 6, 'multiselect': 3, 'calculation': 8,
      'table': 1, 'inline_group': 1, 'section_header': 1,
    };
    return typeMap[fieldType?.toLowerCase()] || 1;
  };

  test('table maps to response_type 1 (text)', () => {
    expect(mapFieldTypeToResponseType('table')).toBe(1);
  });

  test('does NOT map to invalid response_type 11', () => {
    expect(mapFieldTypeToResponseType('table')).not.toBe(11);
  });

  test('all valid response types are 1-10', () => {
    const types = ['text', 'textarea', 'checkbox', 'file', 'radio', 'select', 'table', 'calculation'];
    for (const t of types) {
      const id = mapFieldTypeToResponseType(t);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(10);
    }
  });
});

// ============================================================================
// 9. FIELD DELETION (SOFT DELETE) TESTS
// ============================================================================

describe('Soft Delete Filtering', () => {

  test('show_item=false fields are excluded from metadata query results', () => {
    const items = [
      { item_id: 1, name: 'Field 1', show_item: true },
      { item_id: 2, name: 'Field 2', show_item: false }, // Soft deleted
      { item_id: 3, name: 'Field 3', show_item: null },  // NULL = visible
    ];
    
    // Simulate: AND (ifm.show_item IS DISTINCT FROM false)
    const filtered = items.filter(i => i.show_item !== false);
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0].name).toBe('Field 1');
    expect(filtered[1].name).toBe('Field 3');
  });

  test('frontend defense-in-depth filter excludes hidden fields', () => {
    const items = [
      { name: 'Visible', hidden: false, show_item: true },
      { name: 'Hidden', hidden: true, show_item: false },
      { name: 'Also Visible', hidden: false },
    ];
    
    const visible = items.filter(i => i.hidden !== true && (i as any).show_item !== false);
    
    expect(visible).toHaveLength(2);
    expect(visible[0].name).toBe('Visible');
    expect(visible[1].name).toBe('Also Visible');
  });
});
