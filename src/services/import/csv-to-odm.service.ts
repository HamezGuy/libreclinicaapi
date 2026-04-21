/**
 * CSV to ODM Converter Service
 * 
 * Converts CSV data to ODM XML format that can be imported via 
 * EXISTING dataSoap.service.ts (LibreClinica SOAP Data endpoint)
 * 
 * LibreClinica Models Used:
 * - SubjectDataBean (submit/crfdata/SubjectDataBean.java)
 * - StudyEventDataBean (submit/crfdata/StudyEventDataBean.java)
 * - FormDataBean (submit/crfdata/FormDataBean.java)
 * - ImportItemGroupDataBean (submit/crfdata/ImportItemGroupDataBean.java)
 * - ImportItemDataBean (submit/crfdata/ImportItemDataBean.java)
 */

import { logger } from '../../config/logger';
import { buildOdmFromCsvRows, type CsvOdmMapping } from './odm-builder.service';

/**
 * Column mapping configuration
 */
export interface CSVMapping {
  subjectIdColumn: string;
  eventOIDColumn?: string;
  formOIDColumn?: string;
  itemGroupOIDColumn?: string;
  repeatKeyColumn?: string;
  // Default values when not in CSV
  defaultEventOID: string;
  defaultFormOID: string;
  defaultItemGroupOID: string;
  // Map CSV columns to LibreClinica item OIDs
  columnToItemOID: Record<string, string>;
}

export interface CSVImportConfig {
  studyOID: string;
  metaDataVersionOID: string;
  mapping: CSVMapping;
}

export interface CSVParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Parse CSV content to structured data
 */
export const parseCSV = (csvContent: string): CSVParseResult => {
  // Normalize line endings: handle Windows (\r\n), old Mac (\r), and Unix (\n)
  const normalizedContent = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.split('\n').filter(l => l.trim());
  
  if (lines.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows, rowCount: rows.length };
};

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result.map(v => v.replace(/^"|"$/g, ''));
}

/**
 * Validate CSV against mapping before import
 */
export const validateCSV = (
  csvContent: string,
  mapping: CSVMapping
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const { headers, rows } = parseCSV(csvContent);

    // Check subject ID column exists
    if (!headers.includes(mapping.subjectIdColumn)) {
      errors.push(`Subject ID column "${mapping.subjectIdColumn}" not found in CSV headers`);
    }

    // Check mapped columns exist
    for (const csvColumn of Object.keys(mapping.columnToItemOID)) {
      if (!headers.includes(csvColumn)) {
        errors.push(`Mapped column "${csvColumn}" not found in CSV headers`);
      }
    }

    // Check for data issues
    if (rows.length === 0) {
      errors.push('CSV file contains no data rows');
    }

    // Check for empty subject IDs
    const emptySubjectRows = rows.filter(r => !r[mapping.subjectIdColumn]?.trim());
    if (emptySubjectRows.length > 0) {
      warnings.push(`${emptySubjectRows.length} rows have empty Subject ID and will be skipped`);
    }

    // Check for unmapped columns
    const mappedColumns = new Set([
      mapping.subjectIdColumn,
      mapping.eventOIDColumn,
      mapping.formOIDColumn,
      mapping.itemGroupOIDColumn,
      mapping.repeatKeyColumn,
      ...Object.keys(mapping.columnToItemOID)
    ].filter(Boolean));

    const unmappedColumns = headers.filter(h => !mappedColumns.has(h));
    if (unmappedColumns.length > 0) {
      warnings.push(`Unmapped columns will be ignored: ${unmappedColumns.join(', ')}`);
    }

  } catch (error: any) {
    errors.push(`Failed to parse CSV: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Convert CSV data to ODM XML format.
 *
 * Refactored to delegate the XML envelope + CSV row → ODM mapping to the
 * shared `odm-builder.service.ts`, so the CSV import path and the
 * interop-middleware JSON import path produce identical XML structure
 * (same envelope, same escape rules, same element ordering).
 */
export const convertCSVToODM = (
  csvContent: string,
  config: CSVImportConfig
): string => {
  logger.info('Converting CSV to ODM XML', {
    studyOID: config.studyOID,
    mappedColumns: Object.keys(config.mapping.columnToItemOID).length,
  });

  const { rows } = parseCSV(csvContent);
  const { mapping } = config;

  const subjectMap = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const subjectId = row[mapping.subjectIdColumn]?.trim();
    if (!subjectId) continue;
    const list = subjectMap.get(subjectId) ?? [];
    list.push(row);
    subjectMap.set(subjectId, list);
  }

  return buildOdmFromCsvRows(subjectMap, mapping as CsvOdmMapping, {
    studyOID: config.studyOID,
    metaDataVersionOID: config.metaDataVersionOID,
    fileOID: `CSV-Import-${Date.now()}`,
  });
};

/**
 * Get preview of import data
 */
export const getImportPreview = (
  csvContent: string,
  mapping: CSVMapping,
  maxRows: number = 5
): { 
  headers: string[];
  previewRows: Record<string, string>[];
  totalRows: number;
  mappedItems: { column: string; itemOID: string }[];
} => {
  const { headers, rows } = parseCSV(csvContent);

  const mappedItems = Object.entries(mapping.columnToItemOID).map(([column, itemOID]) => ({
    column,
    itemOID
  }));

  return {
    headers,
    previewRows: rows.slice(0, maxRows),
    totalRows: rows.length,
    mappedItems
  };
};

/**
 * Auto-suggest column mappings based on header names
 */
export const suggestColumnMappings = (
  headers: string[]
): { subjectIdColumn?: string; suggestions: Record<string, string> } => {
  const suggestions: Record<string, string> = {};
  let subjectIdColumn: string | undefined;

  // Common patterns for subject ID
  const subjectPatterns = ['subjectid', 'subject_id', 'subjid', 'participantid', 'patient', 'patientid'];
  
  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (subjectPatterns.some(p => normalized.includes(p))) {
      subjectIdColumn = header;
    }
    
    // Common clinical field patterns
    if (normalized.includes('date')) {
      suggestions[header] = `I_${normalized.toUpperCase()}`;
    } else if (normalized.includes('age')) {
      suggestions[header] = 'I_AGE';
    } else if (normalized.includes('gender') || normalized.includes('sex')) {
      suggestions[header] = 'I_SEX';
    }
  }

  return { subjectIdColumn, suggestions };
};

// `escapeXml` was previously local to this file; it now lives in
// `odm-builder.service.ts` so both the CSV path and the JSON
// (interop-middleware) path use identical escaping rules.

export default {
  parseCSV,
  validateCSV,
  convertCSVToODM,
  getImportPreview,
  suggestColumnMappings
};

