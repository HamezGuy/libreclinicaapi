import { resolveFieldType, isStructuredDataType } from './field-type.utils';
import { parseExtendedProps } from './extended-props';
import {
  TableColumnDefinition, TableSettings,
  QuestionRow, QuestionTableSettings,
  CriteriaItem, CriteriaListSettings,
  InlineFieldDefinition, InlineGroupSettings
} from '../types/index';

const STRUCTURED_MARKER = '__STRUCTURED_DATA__';

export interface FieldTypeInfo {
  canonicalType: string;
  options?: { label: string; value: string }[];
  tableColumns?: TableColumnDefinition[];
  tableSettings?: TableSettings;
  questionRows?: QuestionRow[];
  questionTableSettings?: QuestionTableSettings;
  criteriaItems?: CriteriaItem[];
  criteriaListSettings?: CriteriaListSettings;
  inlineFields?: InlineFieldDefinition[];
  inlineGroupSettings?: InlineGroupSettings;
  isStructured: boolean;
}

export interface SerializedCorrection {
  itemDataValue: string;
  jsonbValue: any;
}

/**
 * Split an options string by the correct delimiter.
 * LibreClinica response_set uses pipe (|) in legacy CRF imports and
 * newline (\n) when options are stored from the form builder.
 * We detect which delimiter is present and split accordingly.
 * If the string contains pipes, we split on pipe (takes precedence);
 * otherwise we split on newline; otherwise we return the string as a single entry.
 */
function splitOptions(raw: string): string[] {
  if (raw.includes('|')) return raw.split('|').map(s => s.trim()).filter(Boolean);
  if (raw.includes('\n')) return raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (raw.includes(',')) return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [raw.trim()].filter(Boolean);
}

/**
 * Parse response_set options into label/value pairs.
 * Supports pipe-delimited, newline-delimited, and comma-delimited formats.
 */
export function parseResponseSetOptions(
  optionsText: string | null | undefined,
  optionsValues: string | null | undefined
): { label: string; value: string }[] {
  if (!optionsText || !optionsValues) return [];
  const labels = splitOptions(optionsText);
  const values = splitOptions(optionsValues);
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

// ─── Cell Path Parsing (mirrors frontend table-cell-path.utils.ts) ─────────

const DATA_TABLE_PATH_RE = /^(.+)\[(\d+|\*)\]\.(.+)$/;
const QUESTION_TABLE_PATH_RE = /^([^.[]+)\.([^.]+)\.([^.]+)$/;

export interface CellTarget {
  tableFieldPath: string;
  tableItemId?: number;
  columnId: string;
  columnType?: string;
  rowIndex?: number;
  rowId?: string;
  allRows: boolean;
  tableType: 'table' | 'question_table';
}

export interface CellTypeInfo {
  cellType: string;
  cellOptions?: { label: string; value: string }[];
  cellMin?: number;
  cellMax?: number;
}

/**
 * Parse a cellPath and extract the column key.
 * @deprecated Prefer using CellTarget.columnId directly when a structured
 * cell_target is available. This regex-based parser is kept only for legacy
 * data that predates the cell_target JSONB migration.
 */
export function parseCellPathColumnKey(cellPath: string | null | undefined): string | null {
  if (!cellPath) return null;
  const dtMatch = cellPath.match(DATA_TABLE_PATH_RE);
  if (dtMatch) return dtMatch[3];
  const qtMatch = cellPath.match(QUESTION_TABLE_PATH_RE);
  if (qtMatch) return qtMatch[3];
  return null;
}

/**
 * Resolve the specific column type for a cell-level query from
 * the parent field's FieldTypeInfo.
 *
 * Accepts either a structured CellTarget (preferred — no regex) or a
 * legacy cellPath string (regex fallback for pre-migration data).
 */
export function resolveCellTypeInfo(
  cellPathOrTarget: string | CellTarget | null | undefined,
  parentFieldTypeInfo: FieldTypeInfo
): CellTypeInfo | null {
  // Extract the column key from either the structured target or legacy string
  let colKey: string | null = null;
  if (cellPathOrTarget && typeof cellPathOrTarget === 'object') {
    colKey = cellPathOrTarget.columnId || null;
  } else {
    colKey = parseCellPathColumnKey(cellPathOrTarget as string | null | undefined);
  }
  if (!colKey) return null;

  // Check data table columns
  if (parentFieldTypeInfo.tableColumns?.length) {
    const col = parentFieldTypeInfo.tableColumns.find(
      (c: any) => (c.id === colKey || c.name === colKey || c.key === colKey)
    );
    if (col) {
      return {
        cellType: col.type || 'text',
        cellOptions: col.options,
        cellMin: col.min,
        cellMax: col.max,
      };
    }
  }

  // Check question table answer columns — prefer top-level answerColumns,
  // fall back to per-row answerColumns for legacy data.
  const ansCols = (parentFieldTypeInfo as any).answerColumns
    || parentFieldTypeInfo.questionRows?.[0]?.answerColumns;
  if (Array.isArray(ansCols)) {
    const ansCol = ansCols.find(
      (c: any) => c.id === colKey || c.name === colKey || (c as any).key === colKey
    );
    if (ansCol) {
      return {
        cellType: ansCol.type || 'text',
        cellOptions: ansCol.options,
        cellMin: ansCol.min,
        cellMax: ansCol.max,
      };
    }
  }

  return null;
}
