/**
 * TypeScript Type Definitions
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SINGLE SOURCE OF TRUTH                                            ║
 * ║                                                                    ║
 * ║  Canonical (camelCase) models:  ./libreclinica-models.ts           ║
 * ║  Event/visit DTOs:              ./event.dto.ts                     ║
 * ║  Study DTOs:                    ./study.dto.ts                     ║
 * ║                                                                    ║
 * ║  ALL new code MUST import from the canonical files above.          ║
 * ║  Do NOT add new interfaces to this file.                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * This file re-exports the canonical models and also contains LEGACY
 * snake_case database-row interfaces (marked @deprecated). The legacy
 * interfaces exist for backward compatibility with older code that
 * directly maps database rows. They should be migrated to use the
 * canonical camelCase models + toXxx() converter functions.
 *
 * RULE: Never define an interface here with the same name as one in
 * libreclinica-models.ts — that shadows the canonical export.
 */

// Re-export all LibreClinica core models (CANONICAL — single source of truth)
export * from './libreclinica-models';

/**
 * User account row from user_account table.
 * Used by auth and user services for database-row mapping.
 */
export interface User {
  user_id: number;
  user_name: string;
  passwd: string;
  first_name: string;
  last_name: string;
  email: string;
  institutional_affiliation?: string;
  phone?: string;
  enabled?: boolean;
  account_non_locked?: boolean;
  user_type_id?: number;
  user_type?: string;
  owner_id?: number;
  status_id?: number;
  update_id?: number;
  date_created?: Date | string;
  date_lastvisit?: Date | string;
  passwd_timestamp?: Date | string;
  lock_counter?: number;
  run_webservices?: boolean;
  bcrypt_passwd?: string;
}

// Re-export Wound Scanner types
export * from './wound.types';

// ─── USER & AUTHENTICATION ──────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: {
    userId: number;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    studyIds: number[];
  };
  message?: string;
}

export interface GoogleAuthRequest {
  idToken: string;
}

/**
 * ============================================================================
 * STUDY TYPES
 * ============================================================================
 */

/**
 * ============================================================================
 * SUBJECT (PATIENT) TYPES
 * ============================================================================
 */

export interface SubjectCreateRequest {
  studyId: number;
  studySubjectId: string;
  secondaryId?: string;
  enrollmentDate?: string;
  gender?: string;
  dateOfBirth?: string;
}

export interface SubjectListQuery {
  studyId: number;
  status?: string;
  page?: number;
  limit?: number;
}

/**
 * ============================================================================
 * EVENT & CRF TYPES
 * ============================================================================
 */

/**
 * ============================================================================
 * FORM DATA TYPES
 * ============================================================================
 */

export interface FormDataRequest {
  studyId: number;
  subjectId: number;
  studyEventDefinitionId: number;
  crfId: number;
  formData: Record<string, any>;
  hiddenFields?: string[];
  electronicSignature?: ElectronicSignature;
}

/**
 * ============================================================================
 * SHARED FORM FIELD DTOs – SINGLE SOURCE OF TRUTH
 * ============================================================================
 *
 * These interfaces define the canonical shape of every form-field sub-type.
 * The frontend form.models.ts MIRRORS these definitions exactly.
 *
 * >>> When you change an interface here, update the frontend copy too:
 *     ElectronicDataCaptureReal/src/app/models/form.models.ts
 */

// ---------------------------------------------------------------------------
// Field options & validation
// ---------------------------------------------------------------------------

/** Option for select / radio / checkbox fields */
export interface FormFieldOption {
  label: string;
  value: string;
  order?: number;
}

/** Inline validation constraint on a form field definition (not the validation rules engine) */
export interface FieldValidationConstraint {
  type: string;
  value?: any;
  message?: string;
}

/** @deprecated Use FieldValidationConstraint instead */
export type ValidationRule = FieldValidationConstraint;

/** Cross-field validation (like Medidata Rave edit checks) */
export interface EditCheck {
  id: string;
  name: string;
  description?: string;
  sourceFieldId: string;
  targetFieldId?: string;
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' |
            'between' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'custom';
  value?: any;
  value2?: any;
  customFormula?: string;
  errorMessage: string;
  severity: 'error' | 'warning' | 'info';
  isActive: boolean;
  requiresQuery?: boolean;
}

// ---------------------------------------------------------------------------
// Branching / skip logic
// ---------------------------------------------------------------------------

/** All supported operators for showWhen / hideWhen / requiredWhen conditions */
export type ShowWhenOperator =
  | 'equals' | 'notEquals' | 'not_equals'
  | 'greaterThan' | 'greater_than' | 'lessThan' | 'less_than'
  | 'greater_than_or_equal' | 'less_than_or_equal'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'isEmpty' | 'isNotEmpty' | 'is_empty' | 'is_not_empty'
  | 'between' | 'not_between'
  | 'is_true' | 'is_false'
  | 'in_list' | 'not_in_list'
  | 'matches_regex'
  | 'date_before' | 'date_after' | 'date_between'
  | 'age_greater_than' | 'age_less_than';

/** Condition that controls field visibility / requirement */
export interface ShowWhenCondition {
  fieldId: string;
  operator: ShowWhenOperator;
  value?: any;
  value2?: any;
  message?: string;
  logicalOperator?: 'AND' | 'OR';
}

// ---------------------------------------------------------------------------
// Form linking (branch to another form)
// ---------------------------------------------------------------------------

export interface FormLinkDefinition {
  id: string;
  name: string;
  description?: string;
  targetFormId: number;
  targetFormName?: string;
  triggerConditions: ShowWhenCondition[];
  linkType: 'modal' | 'redirect' | 'new_tab' | 'embedded';
  required: boolean;
  autoOpen: boolean;
  prefillFields?: { sourceFieldId: string; targetFieldId: string }[];
}

// ---------------------------------------------------------------------------
// Table field types
// ---------------------------------------------------------------------------

/**
 * All types supported within table column cells and question-table answer cells.
 * Mirrors the frontend TableCellType in form.models.ts.
 */
export type TableCellType =
  | 'text' | 'number' | 'textarea' | 'date' | 'datetime' | 'time'
  | 'select' | 'combobox' | 'radio' | 'checkbox' | 'yesno'
  | 'email' | 'phone'
  | 'blood_pressure'
  | 'file' | 'image';

export interface TableColumnDefinition {
  id: string;
  name: string;
  label: string;
  type: TableCellType;
  width?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  readonly?: boolean;
  defaultValue?: string;
}

export interface TableRowDefinition {
  id: string;
  label: string;
}

export interface TableSettings {
  minRows?: number;
  maxRows?: number;
  allowAddRows?: boolean;
  allowDeleteRows?: boolean;
  showRowNumbers?: boolean;
  defaultRows?: number;
}

// ---------------------------------------------------------------------------
// Inline group field types
// ---------------------------------------------------------------------------

export interface InlineFieldDefinition {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  width?: string;
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  unit?: string;
  min?: number;
  max?: number;
}

export interface InlineGroupSettings {
  labelPosition: 'before' | 'above';
  separator?: string;
  alignment?: 'left' | 'center' | 'right';
}

// ---------------------------------------------------------------------------
// Criteria list field types
// ---------------------------------------------------------------------------

export interface CriteriaItem {
  id: string;
  number?: number;
  text: string;
  responseType: 'yesno' | 'checkbox' | 'text' | 'select' | 'initials';
  required?: boolean;
  options?: { label: string; value: string }[];
  failValue?: string;
  helpText?: string;
}

export interface CriteriaListSettings {
  showNumbers?: boolean;
  numberStyle?: 'number' | 'letter' | 'roman';
  requireAll?: boolean;
  inclusionCriteria?: boolean;
  responseColumnHeader?: string;
}

// ---------------------------------------------------------------------------
// Question table field types
// ---------------------------------------------------------------------------

export interface QuestionAnswerColumn {
  id: string;
  type: TableCellType;
  header?: string;
  width?: string;
  required?: boolean;
  readonly?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  defaultValue?: string;
}

export interface QuestionRow {
  id: string;
  question: string;
  answerColumns: QuestionAnswerColumn[];
}

export interface QuestionTableSettings {
  questionColumnHeader?: string;
  questionColumnWidth?: string;
  showRowNumbers?: boolean;
}

// ---------------------------------------------------------------------------

export interface ElectronicSignature {
  username: string;
  password: string;
  meaning: 'Data Entry' | 'Review' | 'Approval';
}

export interface FormDataResponse {
  success: boolean;
  eventCrfId?: number;
  message?: string;
  validationErrors?: ValidationError[];
}

export interface ValidationError {
  itemOid: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * ============================================================================
 * QUERY/DISCREPANCY NOTE TYPES
 * ============================================================================
 */

export interface QueryCreateRequest {
  entityType: 'itemData' | 'eventCrf' | 'studySubject' | 'studyEvent';
  entityId: number;
  description: string;
  detailedNotes?: string;
  queryType: 'Query' | 'Failed Validation Check' | 'Annotation' | 'Reason for Change';
  studyId: number;
  subjectId?: number;
}

export interface QueryResponse {
  success: boolean;
  queryId?: number;
  message?: string;
}

export interface QueryListQuery {
  studyId?: number;
  subjectId?: number;
  status?: 'New' | 'Updated' | 'Resolution Proposed' | 'Closed' | 'Not Applicable';
  page?: number;
  limit?: number;
}

/**
 * ============================================================================
 * AUDIT TRAIL TYPES
 * ============================================================================
 */

export interface AuditQuery {
  studyId?: number;
  subjectId?: number;
  userId?: number;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface AuditExportRequest {
  studyId?: number;
  startDate: string;
  endDate: string;
  format?: 'csv' | 'pdf' | 'json';
}

/**
 * ============================================================================
 * DASHBOARD & REPORTING TYPES
 * ============================================================================
 */

export interface EnrollmentStats {
  totalSubjects: number;
  activeSubjects: number;
  completedSubjects: number;
  withdrawnSubjects: number;
  screenedSubjects: number;
  enrollmentByMonth: MonthlyEnrollment[];
  enrollmentRate: number;
  targetEnrollment?: number;
}

export interface MonthlyEnrollment {
  month: string;
  year: number;
  count: number;
  cumulative: number;
}

export interface CompletionStats {
  totalCRFs: number;
  completedCRFs: number;
  incompleteCRFs: number;
  completionPercentage: number;
  completionByForm: FormCompletion[];
  averageCompletionTime: number;
}

export interface FormCompletion {
  crfId: number;
  crfName: string;
  totalExpected: number;
  completed: number;
  completionPercentage: number;
}

export interface QueryStats {
  totalQueries: number;
  openQueries: number;
  closedQueries: number;
  queriesByType: QueryTypeCount[];
  queriesByStatus: QueryStatusCount[];
  averageResolutionTime: number;
  queryRate: number;
}

export interface QueryTypeCount {
  type: string;
  count: number;
}

export interface QueryStatusCount {
  status: string;
  count: number;
}

export interface UserActivityStats {
  activeUsers: number;
  totalLogins: number;
  averageSessionDuration: number;
  activityByUser: UserActivity[];
  activityByDay: DailyActivity[];
}

export interface UserActivity {
  userId: number;
  username: string;
  loginCount: number;
  lastLogin: Date;
  dataEntryCount: number;
}

export interface DailyActivity {
  date: string;
  logins: number;
  dataEntries: number;
  queries: number;
}

/**
 * ============================================================================
 * ODM (CDISC) TYPES
 * ============================================================================
 */

export interface ODMDocument {
  ODM: {
    ClinicalData: {
      StudyOID: string;
      MetaDataVersionOID: string;
      SubjectData: SubjectData;
    };
  };
}

export interface SubjectData {
  SubjectKey: string;
  StudyEventData: StudyEventData[];
}

export interface StudyEventData {
  StudyEventOID: string;
  StudyEventRepeatKey?: string;
  FormData: FormData[];
}

export interface FormData {
  FormOID: string;
  ItemGroupData: ItemGroupData[];
}

export interface ItemGroupData {
  ItemGroupOID: string;
  ItemGroupRepeatKey?: string;
  ItemData: ODMItemData[];
}

export interface ODMItemData {
  ItemOID: string;
  Value: string;
}

/**
 * ============================================================================
 * API RESPONSE TYPES
 * ============================================================================
 *
 * CANONICAL DEFINITIONS: ApiResponse and PaginatedResponse are defined in
 * libreclinica-models.ts and re-exported via `export * from './libreclinica-models'`
 * above. Do NOT redefine them here — that shadows the canonical versions.
 *
 * If you need the extended version with `errors` and `warnings` fields, use:
 *   import { ApiResponse } from './libreclinica-models';
 * The canonical ApiResponse already supports `errors?: any[]` if needed — add
 * the field there, not here.
 */

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    soap: ServiceStatus;
  };
}

export interface ServiceStatus {
  status: 'up' | 'down';
  responseTime?: number;
  message?: string;
}

/**
 * ============================================================================
 * REPORT TYPES
 * ============================================================================
 */

export interface ReportRequest {
  studyId: number;
  reportType: 'enrollment' | 'completion' | 'audit' | 'queries';
  startDate?: string;
  endDate?: string;
  format: 'csv' | 'pdf' | 'xlsx';
  filters?: Record<string, any>;
}

export interface ReportResponse {
  success: boolean;
  reportUrl?: string;
  fileName?: string;
  message?: string;
}

/**
 * ============================================================================
 * EXPORT TYPES
 * ============================================================================
 */

export type ExportFormat = 'csv' | 'json' | 'xml' | 'pdf' | 'xlsx';

export interface ExportOptions {
  format: ExportFormat;
  includeHeaders: boolean;
  dateFormat?: string;
  timezone?: string;
}

/**
 * ============================================================================
 * UTILITY TYPES
 * ============================================================================
 */

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface IdNamePair {
  id: number;
  name: string;
}

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

export interface ApiError {
  statusCode: number;
  message: string;
  details?: any;
  stack?: string;
}

export default {
  // Export all types
};

