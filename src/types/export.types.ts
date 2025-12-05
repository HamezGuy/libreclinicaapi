/**
 * Data Export Types - Using LibreClinica Models
 * Matches DatasetBean, ExportFormatBean, and ODM export structures
 */

// Dataset configuration matching LibreClinica DatasetBean
export interface DatasetConfig {
  datasetId?: number;
  studyId: number;
  name: string;
  description?: string;
  dateStart?: Date | string;
  dateEnd?: Date | string;
  eventIds?: number[];
  itemIds?: number[];
  subjectIds?: number[];
  
  // Display options (from DatasetBean)
  showEventLocation: boolean;
  showEventStart: boolean;
  showEventEnd: boolean;
  showSubjectDob: boolean;
  showSubjectGender: boolean;
  showSubjectStatus: boolean;
  showSubjectSecondaryId: boolean;
  showSubjectUniqueId: boolean;
  showCRFstatus: boolean;
  showCRFversion: boolean;
  showCRFinterviewerName: boolean;
  showCRFinterviewerDate: boolean;
}

// Export formats matching ExportFormatBean
export type ExportFormat = 'csv' | 'excel' | 'odm' | 'json' | 'sas';

export const EXPORT_FORMAT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odm: 'application/xml',
  json: 'application/json',
  sas: 'application/x-sas'
};

// Export data structures matching ODM/ClinicalData
export interface ExportSubjectData {
  subjectOID: string;
  studySubjectId: string;
  uniqueIdentifier?: string;
  status: string;
  statusId: number;
  secondaryId?: string;
  dateOfBirth?: string;
  gender?: string;
  enrollmentDate?: string;
  studyEventData: ExportStudyEventData[];
}

export interface ExportStudyEventData {
  studyEventOID: string;
  studyEventRepeatKey: string;
  eventName: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  status: string;
  formData: ExportFormData[];
}

export interface ExportFormData {
  formOID: string;
  formName: string;
  crfVersion: string;
  interviewerName?: string;
  interviewDate?: string;
  status: string;
  completionStatus: string;
  itemGroupData: ExportItemGroupData[];
}

export interface ExportItemGroupData {
  itemGroupOID: string;
  itemGroupName: string;
  repeatKey: string;
  items: ExportItemData[];
}

export interface ExportItemData {
  itemOID: string;
  itemName: string;
  value: string;
  dataType: string;
  units?: string;
}

// Study metadata for export configuration
export interface ExportMetadata {
  studyId: number;
  studyName: string;
  studyOID: string;
  events: {
    eventId: number;
    eventOID: string;
    eventName: string;
    crfs: {
      crfId: number;
      crfOID: string;
      crfName: string;
      items: {
        itemId: number;
        itemOID: string;
        itemName: string;
        dataType: string;
      }[];
    }[];
  }[];
}

// Export result
export interface ExportResult {
  format: ExportFormat;
  filename: string;
  content: string | Buffer;
  mimeType: string;
  recordCount: number;
}

