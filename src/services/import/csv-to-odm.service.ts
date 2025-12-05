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
  const lines = csvContent.split('\n').filter(l => l.trim());
  
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
 * Convert CSV data to ODM XML format
 * Matches LibreClinica's ODMContainer structure for import
 */
export const convertCSVToODM = (
  csvContent: string,
  config: CSVImportConfig
): string => {
  logger.info('Converting CSV to ODM XML', { 
    studyOID: config.studyOID,
    mappedColumns: Object.keys(config.mapping.columnToItemOID).length 
  });

  const { rows } = parseCSV(csvContent);
  const { studyOID, metaDataVersionOID, mapping } = config;
  const timestamp = new Date().toISOString();

  // Group rows by subject (matching SubjectDataBean structure)
  const subjectMap = new Map<string, Record<string, string>[]>();
  
  for (const row of rows) {
    const subjectId = row[mapping.subjectIdColumn]?.trim();
    if (!subjectId) continue;
    
    if (!subjectMap.has(subjectId)) {
      subjectMap.set(subjectId, []);
    }
    subjectMap.get(subjectId)!.push(row);
  }

  // Build ODM XML following LibreClinica's expected structure
  let odmXml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="CSV-Import-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${escapeXml(studyOID)}" MetaDataVersionOID="${escapeXml(metaDataVersionOID)}">`;

  // Build SubjectData elements (matching SubjectDataBean)
  for (const [subjectId, subjectRows] of subjectMap) {
    odmXml += `
    <SubjectData SubjectKey="${escapeXml(subjectId)}">`;

    // Get event OID (from row or default)
    const eventOID = mapping.eventOIDColumn && subjectRows[0][mapping.eventOIDColumn]
      ? subjectRows[0][mapping.eventOIDColumn]
      : mapping.defaultEventOID;

    // Build StudyEventData (matching StudyEventDataBean)
    odmXml += `
      <StudyEventData StudyEventOID="${escapeXml(eventOID)}" StudyEventRepeatKey="1">`;

    // Get form OID (from row or default)
    const formOID = mapping.formOIDColumn && subjectRows[0][mapping.formOIDColumn]
      ? subjectRows[0][mapping.formOIDColumn]
      : mapping.defaultFormOID;

    // Build FormData (matching FormDataBean)
    odmXml += `
        <FormData FormOID="${escapeXml(formOID)}">`;

    // Get item group OID (from row or default)
    const itemGroupOID = mapping.itemGroupOIDColumn && subjectRows[0][mapping.itemGroupOIDColumn]
      ? subjectRows[0][mapping.itemGroupOIDColumn]
      : mapping.defaultItemGroupOID;

    // Build ItemGroupData for each row (matching ImportItemGroupDataBean)
    let repeatKey = 1;
    for (const row of subjectRows) {
      const currentRepeatKey = mapping.repeatKeyColumn && row[mapping.repeatKeyColumn]
        ? row[mapping.repeatKeyColumn]
        : String(repeatKey);

      odmXml += `
          <ItemGroupData ItemGroupOID="${escapeXml(itemGroupOID)}" ItemGroupRepeatKey="${currentRepeatKey}" TransactionType="Insert">`;

      // Build ItemData elements (matching ImportItemDataBean)
      for (const [csvColumn, itemOID] of Object.entries(mapping.columnToItemOID)) {
        const value = row[csvColumn];
        if (value !== undefined && value !== '') {
          odmXml += `
            <ItemData ItemOID="${escapeXml(itemOID)}" Value="${escapeXml(value)}"/>`;
        }
      }

      odmXml += `
          </ItemGroupData>`;
      repeatKey++;
    }

    odmXml += `
        </FormData>
      </StudyEventData>
    </SubjectData>`;
  }

  odmXml += `
  </ClinicalData>
</ODM>`;

  logger.info('ODM XML generated', { 
    subjectCount: subjectMap.size,
    xmlLength: odmXml.length 
  });

  return odmXml;
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

// Helper function
function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default {
  parseCSV,
  validateCSV,
  convertCSVToODM,
  getImportPreview,
  suggestColumnMappings
};

