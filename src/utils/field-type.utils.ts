/**
 * Field Type Utilities (Backend)
 *
 * Single source of truth for mapping ANY type string — response_type,
 * data_type_code, or frontend type — to its canonical frontend field type.
 *
 * This map is identical to the frontend copy in
 *   ElectronicDataCaptureReal/src/app/utils/field-type.utils.ts
 *
 * Adding a new alias?  Add it in BOTH files so frontend and backend stay in sync.
 */

const FIELD_TYPE_MAP: Record<string, string> = {
  // ── LibreClinica data_type codes ──────────────────────────────────────
  'st': 'text', 'int': 'number', 'real': 'decimal', 'bl': 'yesno',
  'date': 'date', 'pdate': 'date', 'file': 'file',
  'string': 'text', 'varchar': 'text', 'integer': 'number', 'float': 'decimal',
  'boolean': 'yesno',

  // ── LibreClinica response_type names ──────────────────────────────────
  'radio': 'radio', 'radiobutton': 'radio', 'radio-button': 'radio',
  'single-select': 'select', 'select': 'select', 'dropdown': 'select',
  'multi-select': 'checkbox', 'multiselect': 'checkbox',
  'checkbox': 'checkbox',
  'calculation': 'calculation', 'calculated': 'calculation',
  'group-calculation': 'calculation', 'group_calculation': 'calculation',
  'instant-calculation': 'barcode',
  'table': 'table', 'repeating': 'table', 'repeating-group': 'table', 'grid': 'table',

  // ── Canonical frontend types (pass-through) ──────────────────────────
  'text': 'text', 'textarea': 'textarea', 'number': 'number', 'decimal': 'decimal',
  'yesno': 'yesno', 'barcode': 'barcode', 'qrcode': 'qrcode',
  'combobox': 'combobox', 'signature': 'signature', 'image': 'image',

  // ── Date / time variants ─────────────────────────────────────────────
  'date_of_birth': 'date_of_birth', 'datetime': 'datetime', 'time': 'time',

  // ── Clinical vital types ─────────────────────────────────────────────
  'blood_pressure': 'blood_pressure', 'temperature': 'temperature',
  'height': 'height', 'weight': 'weight', 'bmi': 'bmi',
  'heart_rate': 'heart_rate', 'respiration_rate': 'respiration_rate',
  'oxygen_saturation': 'oxygen_saturation',

  // ── Calculated subtypes ──────────────────────────────────────────────
  'age': 'age', 'bsa': 'bsa', 'egfr': 'egfr',
  'sum': 'sum', 'average': 'average',

  // ── Text-like clinical / PII types ───────────────────────────────────
  'email': 'email', 'phone': 'phone', 'address': 'address',
  'patient_name': 'patient_name', 'patient_id': 'patient_id',
  'ssn': 'ssn', 'medical_record_number': 'medical_record_number',
  'medication': 'medication', 'diagnosis': 'diagnosis',
  'procedure': 'procedure', 'lab_result': 'lab_result',

  // ── Layout / structural types ────────────────────────────────────────
  'section_header': 'section_header', 'static_text': 'static_text',
  'inline_group': 'inline_group', 'criteria_list': 'criteria_list',
  'question_table': 'question_table',
};

/**
 * Resolve ANY type string to its canonical frontend field type.
 *
 * @example
 *   resolveFieldType('radiobutton')    // → 'radio'
 *   resolveFieldType('ST')             // → 'text'
 *   resolveFieldType('single-select')  // → 'select'
 *   resolveFieldType('BL')             // → 'yesno'
 *   resolveFieldType('calculation')    // → 'calculation'
 */
export function resolveFieldType(rawType: string | undefined | null): string {
  if (!rawType) return 'text';
  return FIELD_TYPE_MAP[rawType.toLowerCase()] ?? 'text';
}

