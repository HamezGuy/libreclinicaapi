/**
 * Query Correction Helper Unit Tests
 *
 * Tests serializeCorrectionForStorage and deserializeCorrectionForDisplay
 * for EVERY data type to ensure DB read/write round-trips correctly.
 *
 * Run with: npx jest unit/query-correction-helper
 */

import { describe, it, expect } from '@jest/globals';
import {
  serializeCorrectionForStorage,
  deserializeCorrectionForDisplay,
  parseResponseSetOptions,
  buildFieldTypeInfo,
} from '../../src/utils/query-correction.helper';

// ═══════════════════════════════════════════════════════════════════════════
// serializeCorrectionForStorage
// ═══════════════════════════════════════════════════════════════════════════

describe('serializeCorrectionForStorage', () => {

  // ── Scalar types ──────────────────────────────────────────────────────

  it('text: stores as plain string', () => {
    const r = serializeCorrectionForStorage('text', 'hello world');
    expect(r.itemDataValue).toBe('hello world');
    expect(r.jsonbValue).toBe('hello world');
  });

  it('select: stores option value as string', () => {
    const r = serializeCorrectionForStorage('select', 'option_a');
    expect(r.itemDataValue).toBe('option_a');
    expect(r.jsonbValue).toBe('option_a');
  });

  it('radio: stores option value as string', () => {
    const r = serializeCorrectionForStorage('radio', 'yes');
    expect(r.itemDataValue).toBe('yes');
    expect(r.jsonbValue).toBe('yes');
  });

  it('number: stores numeric string', () => {
    const r = serializeCorrectionForStorage('number', '42');
    expect(r.itemDataValue).toBe('42');
  });

  it('number: converts numeric to string', () => {
    const r = serializeCorrectionForStorage('number', 42);
    expect(r.itemDataValue).toBe('42');
  });

  it('decimal: stores decimal string', () => {
    const r = serializeCorrectionForStorage('decimal', '3.14');
    expect(r.itemDataValue).toBe('3.14');
  });

  it('date: stores ISO date string', () => {
    const r = serializeCorrectionForStorage('date', '2026-01-15');
    expect(r.itemDataValue).toBe('2026-01-15');
  });

  it('datetime: stores ISO datetime string', () => {
    const r = serializeCorrectionForStorage('datetime', '2026-01-15T14:30');
    expect(r.itemDataValue).toBe('2026-01-15T14:30');
  });

  it('time: stores time string', () => {
    const r = serializeCorrectionForStorage('time', '14:30');
    expect(r.itemDataValue).toBe('14:30');
  });

  it('email: stores as string', () => {
    const r = serializeCorrectionForStorage('email', 'test@example.com');
    expect(r.itemDataValue).toBe('test@example.com');
  });

  it('phone: stores as string', () => {
    const r = serializeCorrectionForStorage('phone', '+1-555-0199');
    expect(r.itemDataValue).toBe('+1-555-0199');
  });

  // ── YesNo ─────────────────────────────────────────────────────────────

  it('yesno: "true" normalizes to "true"', () => {
    const r = serializeCorrectionForStorage('yesno', 'true');
    expect(r.itemDataValue).toBe('true');
    expect(r.jsonbValue).toBe('true');
  });

  it('yesno: "false" normalizes to "false"', () => {
    const r = serializeCorrectionForStorage('yesno', 'false');
    expect(r.itemDataValue).toBe('false');
  });

  it('yesno: "yes" normalizes to "true"', () => {
    const r = serializeCorrectionForStorage('yesno', 'yes');
    expect(r.itemDataValue).toBe('true');
  });

  it('yesno: "no" normalizes to "false"', () => {
    const r = serializeCorrectionForStorage('yesno', 'no');
    expect(r.itemDataValue).toBe('false');
  });

  it('yesno: "1" normalizes to "true"', () => {
    const r = serializeCorrectionForStorage('yesno', '1');
    expect(r.itemDataValue).toBe('true');
  });

  it('yesno: random string normalizes to "false"', () => {
    const r = serializeCorrectionForStorage('yesno', 'maybe');
    expect(r.itemDataValue).toBe('false');
  });

  // ── Checkbox ──────────────────────────────────────────────────────────

  it('checkbox: array joins to CSV', () => {
    const r = serializeCorrectionForStorage('checkbox', ['opt1', 'opt2', 'opt3']);
    expect(r.itemDataValue).toBe('opt1,opt2,opt3');
    expect(r.jsonbValue).toEqual(['opt1', 'opt2', 'opt3']);
  });

  it('checkbox: single-element array', () => {
    const r = serializeCorrectionForStorage('checkbox', ['opt1']);
    expect(r.itemDataValue).toBe('opt1');
    expect(r.jsonbValue).toEqual(['opt1']);
  });

  it('checkbox: CSV string splits correctly', () => {
    const r = serializeCorrectionForStorage('checkbox', 'a, b, c');
    expect(r.itemDataValue).toBe('a, b, c');
    expect(r.jsonbValue).toEqual(['a', 'b', 'c']);
  });

  // ── Blood Pressure ────────────────────────────────────────────────────

  it('blood_pressure: stores systolic/diastolic string', () => {
    const r = serializeCorrectionForStorage('blood_pressure', '120/80');
    expect(r.itemDataValue).toBe('120/80');
  });

  // ── Structured types ──────────────────────────────────────────────────

  it('table: array stores as __STRUCTURED_DATA__ marker', () => {
    const rows = [{ col1: 'a', col2: 1 }, { col1: 'b', col2: 2 }];
    const r = serializeCorrectionForStorage('table', rows);
    expect(r.itemDataValue).toBe('__STRUCTURED_DATA__');
    expect(r.jsonbValue).toEqual(rows);
  });

  it('table: JSON string parses to array', () => {
    const json = JSON.stringify([{ a: 1 }]);
    const r = serializeCorrectionForStorage('table', json);
    expect(r.itemDataValue).toBe('__STRUCTURED_DATA__');
    expect(r.jsonbValue).toEqual([{ a: 1 }]);
  });

  it('question_table: object stores as __STRUCTURED_DATA__ marker', () => {
    const obj = { q1: { ans: 'grade1' }, q2: { ans: 'grade2' } };
    const r = serializeCorrectionForStorage('question_table', obj);
    expect(r.itemDataValue).toBe('__STRUCTURED_DATA__');
    expect(r.jsonbValue).toEqual(obj);
  });

  it('criteria_list: object stores as structured', () => {
    const obj = { c1: 'true', c2: 'false' };
    const r = serializeCorrectionForStorage('criteria_list', obj);
    expect(r.itemDataValue).toBe('__STRUCTURED_DATA__');
    expect(r.jsonbValue).toEqual(obj);
  });

  it('inline_group: object stores as structured', () => {
    const obj = { height: '175', weight: '78' };
    const r = serializeCorrectionForStorage('inline_group', obj);
    expect(r.itemDataValue).toBe('__STRUCTURED_DATA__');
    expect(r.jsonbValue).toEqual(obj);
  });

  // ── Null/empty ────────────────────────────────────────────────────────

  it('null value returns empty', () => {
    const r = serializeCorrectionForStorage('text', null);
    expect(r.itemDataValue).toBe('');
    expect(r.jsonbValue).toBeNull();
  });

  it('undefined value returns empty', () => {
    const r = serializeCorrectionForStorage('text', undefined);
    expect(r.itemDataValue).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deserializeCorrectionForDisplay
// ═══════════════════════════════════════════════════════════════════════════

describe('deserializeCorrectionForDisplay', () => {

  it('text: returns item_data value', () => {
    expect(deserializeCorrectionForDisplay('text', 'hello', 'hello')).toBe('hello');
  });

  it('select: returns item_data value', () => {
    expect(deserializeCorrectionForDisplay('select', 'opt_a', 'opt_a')).toBe('opt_a');
  });

  it('checkbox: returns JSONB array when available', () => {
    expect(deserializeCorrectionForDisplay('checkbox', 'a,b', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('checkbox: splits CSV when no JSONB', () => {
    expect(deserializeCorrectionForDisplay('checkbox', 'a,b,c', null)).toEqual(['a', 'b', 'c']);
  });

  it('checkbox: empty string returns empty array', () => {
    expect(deserializeCorrectionForDisplay('checkbox', '', null)).toEqual([]);
  });

  it('table: returns JSONB value for structured types', () => {
    const rows = [{ a: 1 }];
    expect(deserializeCorrectionForDisplay('table', '__STRUCTURED_DATA__', rows)).toEqual(rows);
  });

  it('question_table: returns JSONB value', () => {
    const obj = { q1: { grade: '1' } };
    expect(deserializeCorrectionForDisplay('question_table', '__STRUCTURED_DATA__', obj)).toEqual(obj);
  });

  it('yesno: returns item_data value', () => {
    expect(deserializeCorrectionForDisplay('yesno', 'true', 'true')).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseResponseSetOptions
// ═══════════════════════════════════════════════════════════════════════════

describe('parseResponseSetOptions', () => {

  it('parses pipe-delimited options', () => {
    const result = parseResponseSetOptions('Yes|No', 'yes|no');
    expect(result).toEqual([
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]);
  });

  it('parses newline-delimited options', () => {
    const result = parseResponseSetOptions('Option A\nOption B', 'a\nb');
    expect(result).toEqual([
      { label: 'Option A', value: 'a' },
      { label: 'Option B', value: 'b' },
    ]);
  });

  it('parses comma-delimited options', () => {
    const result = parseResponseSetOptions('Red,Blue,Green', '1,2,3');
    expect(result).toEqual([
      { label: 'Red', value: '1' },
      { label: 'Blue', value: '2' },
      { label: 'Green', value: '3' },
    ]);
  });

  it('returns empty array when text is null', () => {
    expect(parseResponseSetOptions(null, '1|2')).toEqual([]);
  });

  it('returns empty array when values is null', () => {
    expect(parseResponseSetOptions('A|B', null)).toEqual([]);
  });

  it('handles mismatched label/value counts', () => {
    const result = parseResponseSetOptions('A|B|C', '1|2');
    expect(result).toHaveLength(3);
    expect(result[2].label).toBe('C');
    expect(result[2].value).toBe('C');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildFieldTypeInfo
// ═══════════════════════════════════════════════════════════════════════════

describe('buildFieldTypeInfo', () => {

  it('resolves radio response type', () => {
    const info = buildFieldTypeInfo(null, null, 'radio', 'Yes|No', 'yes|no');
    expect(info.canonicalType).toBe('radio');
    expect(info.options).toEqual([
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]);
  });

  it('resolves select response type with options', () => {
    const info = buildFieldTypeInfo(null, null, 'single-select', 'A|B', '1|2');
    expect(info.canonicalType).toBe('select');
    expect(info.options).toHaveLength(2);
  });

  it('resolves BL data type to yesno', () => {
    const info = buildFieldTypeInfo(null, 7, null, null, null);
    expect(info.canonicalType).toBe('yesno');
  });

  it('resolves INT data type to number', () => {
    const info = buildFieldTypeInfo(null, 2, null, null, null);
    expect(info.canonicalType).toBe('number');
  });

  it('marks table as structured', () => {
    const desc = '---EXTENDED_PROPS---{"type":"table","tableColumns":[{"name":"col1","type":"text"}]}';
    const info = buildFieldTypeInfo(desc, null, null, null, null);
    expect(info.canonicalType).toBe('table');
    expect(info.isStructured).toBe(true);
    expect(info.tableColumns).toBeDefined();
  });

  it('marks question_table as structured', () => {
    const desc = '---EXTENDED_PROPS---{"type":"question_table","questionRows":[{"id":"q1","question":"Test"}]}';
    const info = buildFieldTypeInfo(desc, null, null, null, null);
    expect(info.canonicalType).toBe('question_table');
    expect(info.isStructured).toBe(true);
  });

  it('prefers extended props type over response_type', () => {
    const desc = '---EXTENDED_PROPS---{"type":"blood_pressure"}';
    const info = buildFieldTypeInfo(desc, null, 'radio', null, null);
    expect(info.canonicalType).toBe('blood_pressure');
  });

  it('prefers extended props options over response_set', () => {
    const desc = '---EXTENDED_PROPS---{"type":"select","options":[{"label":"X","value":"x"}]}';
    const info = buildFieldTypeInfo(desc, null, 'single-select', 'A|B', '1|2');
    expect(info.options).toEqual([{ label: 'X', value: 'x' }]);
  });
});
