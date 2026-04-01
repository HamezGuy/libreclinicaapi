import { resolveFieldType, isStructuredDataType } from './field-type.utils';
import { parseExtendedProps } from './extended-props';

const STRUCTURED_MARKER = '__STRUCTURED_DATA__';

export interface FieldTypeInfo {
  canonicalType: string;
  options?: { label: string; value: string }[];
  tableColumns?: any[];
  tableSettings?: any;
  questionRows?: any[];
  questionTableSettings?: any;
  criteriaItems?: any[];
  criteriaListSettings?: any;
  inlineFields?: any[];
  inlineGroupSettings?: any;
  isStructured: boolean;
}

export interface SerializedCorrection {
  itemDataValue: string;
  jsonbValue: any;
}

/**
 * Parse pipe-delimited response_set options into label/value pairs.
 */
export function parseResponseSetOptions(
  optionsText: string | null | undefined,
  optionsValues: string | null | undefined
): { label: string; value: string }[] {
  if (!optionsText || !optionsValues) return [];
  const labels = optionsText.split('|').map(s => s.trim());
  const values = optionsValues.split('|').map(s => s.trim());
  const result: { label: string; value: string }[] = [];
  for (let i = 0; i < Math.max(labels.length, values.length); i++) {
    result.push({
      label: labels[i] ?? values[i] ?? '',
      value: values[i] ?? labels[i] ?? ''
    });
  }
  return result;
}

/**
 * Build FieldTypeInfo from raw DB columns and extended properties.
 */
export function buildFieldTypeInfo(
  itemDescription: string | null | undefined,
  itemDataTypeId: number | null | undefined,
  responseTypeName: string | null | undefined,
  optionsText: string | null | undefined,
  optionsValues: string | null | undefined
): FieldTypeInfo {
  const ext = parseExtendedProps(itemDescription);

  const DATA_TYPE_CODES: Record<number, string> = {
    1: 'ST', 2: 'INT', 3: 'REAL', 4: 'DATE', 5: 'PDATE', 6: 'FILE', 7: 'BL', 8: 'CODE', 9: 'SET'
  };
  const dataTypeCode = itemDataTypeId ? DATA_TYPE_CODES[itemDataTypeId] : undefined;
  const canonicalType = resolveFieldType(ext.type || responseTypeName || dataTypeCode);

  const options = ext.options || parseResponseSetOptions(optionsText, optionsValues);

  return {
    canonicalType,
    options: options.length > 0 ? options : undefined,
    tableColumns: ext.tableColumns,
    tableSettings: ext.tableSettings,
    questionRows: ext.questionRows,
    questionTableSettings: ext.questionTableSettings,
    criteriaItems: ext.criteriaItems,
    criteriaListSettings: ext.criteriaListSettings,
    inlineFields: ext.inlineFields,
    inlineGroupSettings: ext.inlineGroupSettings,
    isStructured: isStructuredDataType(canonicalType)
  };
}

/**
 * Serialize a correction value for dual-storage (item_data + JSONB).
 *
 * Deterministic based on the field's canonical type — never guesses via
 * "try JSON.parse" heuristics.
 */
export function serializeCorrectionForStorage(
  canonicalType: string,
  rawValue: any
): SerializedCorrection {
  if (rawValue === null || rawValue === undefined) {
    return { itemDataValue: '', jsonbValue: null };
  }

  if (isStructuredDataType(canonicalType)) {
    let parsed = rawValue;
    if (typeof rawValue === 'string') {
      try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue; }
    }
    return { itemDataValue: STRUCTURED_MARKER, jsonbValue: parsed };
  }

  switch (canonicalType) {
    case 'checkbox': {
      if (Array.isArray(rawValue)) {
        return { itemDataValue: rawValue.join(','), jsonbValue: rawValue };
      }
      const str = String(rawValue);
      const arr = str.split(',').map(s => s.trim()).filter(Boolean);
      return { itemDataValue: str, jsonbValue: arr };
    }

    case 'yesno': {
      const normalized = String(rawValue).toLowerCase();
      const val = normalized === 'true' || normalized === 'yes' || normalized === '1' ? 'true' : 'false';
      return { itemDataValue: val, jsonbValue: val };
    }

    case 'blood_pressure': {
      const str = String(rawValue);
      return { itemDataValue: str, jsonbValue: str };
    }

    case 'number':
    case 'decimal':
    case 'integer': {
      const str = String(rawValue);
      return { itemDataValue: str, jsonbValue: str };
    }

    default: {
      if (!['text','textarea','email','phone','address','date','date_of_birth','datetime','time',
            'patient_name','patient_id','ssn','medical_record_number','medication','diagnosis',
            'procedure','lab_result','select','radio','combobox','height','weight','temperature',
            'heart_rate','respiration_rate','oxygen_saturation','bmi','age','bsa','egfr',
            'calculation','sum','average','group_calculation','barcode','qrcode',
            'file','image','signature'].includes(canonicalType)) {
        console.error(
          `[QueryCorrectionHelper] Unknown canonical type "${canonicalType}" in serializeCorrectionForStorage — ` +
          `storing as plain string. Add an explicit case if this type needs special handling.`
        );
      }
      const str = String(rawValue);
      return { itemDataValue: str, jsonbValue: str };
    }
  }
}

/**
 * Deserialize a stored value into the shape the frontend expects.
 *
 * For structured types the JSONB value is authoritative; for scalars
 * the item_data string value is returned as-is (or option-mapped).
 */
export function deserializeCorrectionForDisplay(
  canonicalType: string,
  itemDataValue: string | null | undefined,
  jsonbValue: any
): any {
  if (isStructuredDataType(canonicalType)) {
    return jsonbValue ?? (itemDataValue === STRUCTURED_MARKER ? null : itemDataValue);
  }

  switch (canonicalType) {
    case 'checkbox': {
      if (Array.isArray(jsonbValue)) return jsonbValue;
      if (typeof itemDataValue === 'string' && itemDataValue) {
        return itemDataValue.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
    }
    default:
      return itemDataValue ?? jsonbValue ?? '';
  }
}
