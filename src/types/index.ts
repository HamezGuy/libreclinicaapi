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

// Re-export shared cross-project DTOs from the shared-types package
export {
  ElectronicSignature,
  SignatureMeaning,
  SubjectCreateRequest,
  FormDataRequest,
  // Entity types
  type AuditableEntity as SharedAuditableEntity,
  type ApiResponse as SharedApiResponse,
  type PaginatedResponse as SharedPaginatedResponse,
  type DataEntryStage as SharedDataEntryStage,
  type CompletionStatus as SharedCompletionStatus,
  type SubjectEventStatus as SharedSubjectEventStatus,
  DATA_ENTRY_STAGE_MAP as SHARED_DATA_ENTRY_STAGE_MAP,
  COMPLETION_STATUS_MAP as SHARED_COMPLETION_STATUS_MAP,
  SUBJECT_EVENT_STATUS_MAP as SHARED_SUBJECT_EVENT_STATUS_MAP,
  // Form/CRF types
  type CRF as SharedCRF,
  type CRFVersion as SharedCRFVersion,
  type EventCRF as SharedEventCRF,
  type PatientEventForm as SharedPatientEventForm,
  type ItemData as SharedItemData,
  type Item as SharedItem,
  type EventDefinitionCRF as SharedEventDefinitionCRF,
  type StudyEventDefinition as SharedStudyEventDefinition,
  type StudyEvent as SharedStudyEvent,
  type StudyPhase as SharedStudyPhase,
  type StudyGroupClass as SharedStudyGroupClass,
  type StudyGroup as SharedStudyGroup,
  // Query types
  type DiscrepancyNote as SharedDiscrepancyNote,
  type DiscrepancyNoteType as SharedDiscrepancyNoteType,
  type QueryGenerationType as SharedQueryGenerationType,
  type ResolutionStatus as SharedResolutionStatus,
  DISCREPANCY_NOTE_TYPE_MAP as SHARED_DISCREPANCY_NOTE_TYPE_MAP,
  RESOLUTION_STATUS_MAP as SHARED_RESOLUTION_STATUS_MAP,
  type CreateQueryRequest,
  type RespondToQueryRequest,
  type QueryWithDetails,
  // Event DTOs
  type CreateEventRequest,
  type UpdateEventRequest,
  type ScheduleEventRequest,
  type CreateUnscheduledVisitRequest,
  type AssignCrfToEventRequest,
  type UpdateCrfAssignmentRequest,
  type BulkAssignCrfRequest,
  type AssignFormToPatientVisitRequest,
  type SavePatientFormDataRequest,
  // Study DTOs
  type CreateStudyRequest,
  type UpdateStudyRequest,
  type EventDefinitionInput,
  type CRFAssignmentInput,
  type GroupClassInput,
  type GroupInput,
  type SiteInput,
  type CreateStudyResponse,
  // E-Signature types
  type SignatureRequest,
  type SignatureVerificationResult,
  // Dashboard & reporting types
  type EnrollmentStats,
  type MonthlyEnrollment,
  type CompletionStats,
  type FormCompletionMetric,
  type FormCompletion,
  type QueryStats,
  type QueryTypeCount,
  type QueryStatusCount,
  type UserActivityStats,
  type UserActivityDetail,
  type UserActivity,
  type DailyActivity,
  type SitePerformance,
  type DataQualityMetrics,
  type SubjectStatusDistribution,
  type ActivityFeedItem,
  type StudyHealthScore,
  type DashboardSummary,
  type DashboardStats,
  type EnrollmentTrendPoint,
  type CompletionTrendPoint,
  type FormCompletionRate,
  type ActionItemsSummary,
  type SubjectProgressRow,
  type SubjectProgressResponse,
  type OverdueForm,
  type DataLockProgress,
  type SubjectLockReadiness,
  type CrfLifecycleStage,
  type CrfLifecycleResponse,
} from '@accura-trial/shared-types';

/**
 * User account row from user_account table.
 * Used by auth and user services for database-row mapping.
 */
export interface User {
  userId: number;
  userName: string;
  passwd: string;
  firstName: string;
  lastName: string;
  email: string;
  institutionalAffiliation?: string;
  phone?: string;
  enabled?: boolean;
  accountNonLocked?: boolean;
  userTypeId?: number;
  userType?: string;
  ownerId?: number;
  statusId?: number;
  updateId?: number;
  dateCreated?: Date | string;
  dateLastvisit?: Date | string;
  passwdTimestamp?: Date | string;
  lockCounter?: number;
  runWebservices?: boolean;
  bcryptPasswd?: string;
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
 *
 * SubjectCreateRequest is now re-exported from @accura-trial/shared-types
 * at the top of this file. The SOAP service
 * (services/soap/subjectSoap.service.ts) uses `label` — the canonical field
 * that matches both shared-types and the Joi validator.
 */

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
 *
 * FormDataRequest and ElectronicSignature are now re-exported from
 * @accura-trial/shared-types at the top of this file.
 * ============================================================================
 */

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
// ElectronicSignature and FormDataResponse are re-exported from shared-types.
// ---------------------------------------------------------------------------

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
  generationType?: 'manual' | 'automatic';
  studyId: number;
  subjectId?: number;
  assignedUserId?: number;
  severity?: 'minor' | 'major' | 'critical';
  dueDate?: string | null;
  eventCrfId?: number;
  itemId?: number;
  itemDataId?: number;
  fieldName?: string;
  fieldPath?: string;
  columnName?: string;
}

export interface QueryCreateResponse {
  success: boolean;
  queryId?: number;
  message?: string;
}

export interface QueryListQuery {
  studyId?: number;
  subjectId?: number;
  status?: 'New' | 'Updated' | 'Resolution Proposed' | 'Closed' | 'Not Applicable';
  typeId?: number;
  assignedUserId?: number;
  search?: string;
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
 * Re-exported from @accura-trial/shared-types (canonical source)
 * ============================================================================
 */

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

