/**
 * Data Import Types - Using LibreClinica Models
 * Matches SubjectDataBean, StudyEventDataBean, FormDataBean, ImportItemDataBean
 */

// Import data structures matching ODM ClinicalData import
export interface ImportSubjectData {
  subjectOID: string;
  studySubjectId?: string;  // For new subject creation
  uniqueIdentifier?: string;
  dateOfBirth?: string;
  gender?: string;
  enrollmentDate?: string;
  studyEventData: ImportStudyEventData[];
}

export interface ImportStudyEventData {
  studyEventOID: string;
  studyEventRepeatKey: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  formData: ImportFormData[];
}

export interface ImportFormData {
  formOID: string;
  itemGroupData: ImportItemGroupData[];
}

export interface ImportItemGroupData {
  itemGroupOID: string;
  itemGroupRepeatKey: string;
  transactionType?: 'Insert' | 'Update' | 'Upsert';
  itemData: ImportItemData[];
}

export interface ImportItemData {
  itemOID: string;
  value: string;
  isNull?: boolean;
  reasonForNull?: string;
  measurementUnitOID?: string;
}

// Validation result matching CRFDataPostImportContainer
export interface ImportValidationResult {
  isValid: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
  summary: ImportSummary;
  previewData?: ImportSubjectData[];
}

export interface ImportError {
  row?: number;
  subjectOID: string;
  eventOID?: string;
  formOID?: string;
  itemGroupOID?: string;
  itemOID?: string;
  errorCode: ImportErrorCode;
  message: string;
  field?: string;
}

export type ImportErrorCode = 
  | 'SUBJECT_NOT_FOUND'
  | 'SUBJECT_CREATION_FAILED'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_SCHEDULED'
  | 'FORM_NOT_ASSIGNED'
  | 'FORM_NOT_AVAILABLE'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_DATA_TYPE'
  | 'INVALID_RESPONSE'
  | 'REQUIRED_FIELD_MISSING'
  | 'VALUE_OUT_OF_RANGE'
  | 'DATE_FORMAT_INVALID'
  | 'DUPLICATE_DATA'
  | 'FORM_LOCKED'
  | 'PARSE_ERROR';

export interface ImportWarning {
  row?: number;
  subjectOID: string;
  itemOID?: string;
  warningCode: string;
  message: string;
}

// Import summary matching SummaryStatsBean
export interface ImportSummary {
  totalSubjects: number;
  totalEvents: number;
  totalForms: number;
  totalItems: number;
  newSubjects: number;
  newEvents: number;
  newForms: number;
  insertedItems: number;
  updatedItems: number;
  skippedItems: number;
  errorCount: number;
  warningCount: number;
}

// CSV column mapping for import
export interface CSVColumnMapping {
  subjectIdColumn: string;
  eventOIDColumn?: string;
  formOIDColumn?: string;
  itemGroupOIDColumn?: string;
  defaultEventOID?: string;
  defaultFormOID?: string;
  defaultItemGroupOID?: string;
  repeatKeyColumn?: string;
  columnToItemOID: Record<string, string>;
}

// Import configuration
export interface ImportConfig {
  studyId: number;
  format: 'csv' | 'odm';
  mapping?: CSVColumnMapping;
  createSubjects: boolean;
  createEvents: boolean;
  upsertMode: boolean;  // Update if exists, insert if not
  skipValidation?: boolean;
  dryRun?: boolean;
}

// Import execution result
export interface ImportExecutionResult {
  success: boolean;
  summary: ImportSummary;
  errors: ImportError[];
  warnings: ImportWarning[];
  startTime: Date;
  endTime: Date;
  duration: number;
}

