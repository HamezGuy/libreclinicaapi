/**
 * PDF Generation Types
 * 
 * 21 CFR Part 11 compliant PDF generation for:
 * - Form printing (blank and completed)
 * - Casebook generation
 * - Audit trail export
 */

/**
 * PDF generation options
 */
export interface PDFGenerationOptions {
  pageSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  watermark?: 'DRAFT' | 'VERIFIED' | 'LOCKED' | 'SDV_COMPLETE';
  includeHeader: boolean;
  includeFooter: boolean;
  includeAuditTrail: boolean;
  includeSignatures?: boolean;
}

/**
 * Printable form data structure
 */
export interface PrintableForm {
  formId: number;
  formName: string;
  formVersion: string;
  eventName: string;
  subjectLabel: string;
  studyName: string;
  siteName: string;
  sections: PrintableSection[];
  status: string;
  completedDate?: Date;
  completedBy?: string;
  signatureStatus?: boolean;
  sdvStatus?: boolean;
  lockStatus?: boolean;
}

/**
 * Printable section structure
 */
export interface PrintableSection {
  sectionId: number;
  title: string;
  subtitle?: string;
  instructions?: string;
  fields: PrintableField[];
}

/**
 * Printable field structure
 */
export interface PrintableField {
  fieldId: number;
  name: string;
  label: string;
  type: string;
  value?: string;
  displayValue?: string;
  unit?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  status?: 'entered' | 'missing' | 'sdv_verified' | 'queried';
  query?: {
    queryId: number;
    text: string;
    status: string;
  };
}

/**
 * Casebook data structure
 */
export interface PrintableCasebook {
  studySubjectId: number;
  subjectLabel: string;
  studyName: string;
  siteName: string;
  enrollmentDate: Date;
  status: string;
  events: PrintableEvent[];
  generatedAt: Date;
  generatedBy: string;
}

/**
 * Printable event structure
 */
export interface PrintableEvent {
  eventId: number;
  eventName: string;
  eventDate?: Date;
  status: string;
  forms: PrintableForm[];
}

/**
 * Audit trail entry structure
 */
export interface AuditTrailEntry {
  auditId: number;
  auditDate: Date;
  action: string;
  entityType: string;
  entityId: number;
  oldValue?: string;
  newValue?: string;
  username: string;
  userFullName: string;
  reasonForChange?: string;
  ipAddress?: string;
}

/**
 * Printable audit trail
 */
export interface PrintableAuditTrail {
  entityType: string;
  entityId: number;
  entityName: string;
  entries: AuditTrailEntry[];
  generatedAt: Date;
  generatedBy: string;
}

/**
 * PDF generation result
 */
export interface PDFGenerationResult {
  success: boolean;
  buffer?: Buffer;
  filename?: string;
  contentType?: string;
  pageCount?: number;
  error?: string;
}

/**
 * Bulk export job status
 */
export interface BulkExportJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalItems: number;
  completedItems: number;
  startedAt: Date;
  completedAt?: Date;
  downloadUrl?: string;
  error?: string;
}

// Types are exported inline above

