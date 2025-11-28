/**
 * TypeScript Type Definitions
 * 
 * Comprehensive type definitions for LibreClinica API
 * - Database entity types
 * - API request/response types
 * - SOAP message types
 * - Business logic types
 * - Wound Scanner types
 */

// Re-export Wound Scanner types
export * from './wound.types';

/**
 * ============================================================================
 * USER & AUTHENTICATION TYPES
 * ============================================================================
 */

export interface User {
  user_id: number;
  user_name: string;
  first_name: string;
  last_name: string;
  email: string;
  institutional_affiliation?: string;
  active_study?: number;
  passwd: string;
  passwd_timestamp?: Date;
  passwd_challenge_question?: string;
  passwd_challenge_answer?: string;
  phone?: string;
  owner_id: number;
  date_created: Date;
  date_updated?: Date;
  date_lastvisit?: Date;
  enabled: boolean;
  account_non_locked: boolean;
  lockout_time?: Date;
  failed_login_attempts: number;
  user_type_id: number;
  status_id: number;
  update_id: number;
}

export interface UserRole {
  role_id: number;
  role_name: string;
  parent_id?: number;
  role_desc?: string;
}

export interface StudyUserRole {
  role_name: string;
  study_id: number;
  status_id: number;
  owner_id: number;
  date_created: Date;
  date_updated?: Date;
  update_id: number;
  user_name: string;
}

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

export interface Study {
  study_id: number;
  parent_study_id?: number;
  unique_identifier: string;
  secondary_identifier?: string;
  name: string;
  summary?: string;
  date_planned_start?: Date;
  date_planned_end?: Date;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id: number;
  type_id: number;
  status_id: number;
  protocol_type?: string;
  protocol_description?: string;
  phase?: string;
  expected_total_enrollment?: number;
  sponsor?: string;
  collaborators?: string;
  principal_investigator?: string;
}

export interface StudyMetadata {
  study: Study;
  events: StudyEventDefinition[];
  crfs: CRF[];
  subjects?: StudySubject[];
  enrollmentStats?: EnrollmentStats;
}

export interface StudyEventDefinition {
  study_event_definition_id: number;
  study_id: number;
  name: string;
  description?: string;
  repeating: boolean;
  type: string;
  category?: string;
  ordinal: number;
  owner_id: number;
  date_created: Date;
  date_updated?: Date;
  update_id: number;
}

/**
 * ============================================================================
 * SUBJECT (PATIENT) TYPES
 * ============================================================================
 */

export interface StudySubject {
  study_subject_id: number;
  label: string;
  secondary_label?: string;
  subject_id: number;
  study_id: number;
  status_id: number;
  enrollment_date?: Date;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id: number;
  oc_oid?: string;
}

export interface Subject {
  subject_id: number;
  unique_identifier: string;
  father_id?: number;
  mother_id?: number;
  status_id: number;
  date_of_birth?: Date;
  gender: string;
  date_created: Date;
  owner_id: number;
  update_id: number;
  date_updated?: Date;
}

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

export interface SubjectDetails extends StudySubject {
  subject: Subject;
  events: StudyEvent[];
  completionPercentage: number;
  lastActivity?: Date;
}

/**
 * ============================================================================
 * EVENT & CRF TYPES
 * ============================================================================
 */

export interface StudyEvent {
  study_event_id: number;
  study_event_definition_id: number;
  study_subject_id: number;
  location?: string;
  sample_ordinal: number;
  date_start?: Date;
  date_end?: Date;
  owner_id: number;
  status_id: number;
  date_created: Date;
  date_updated?: Date;
  update_id: number;
  subject_event_status_id: number;
  start_time_flag: boolean;
  end_time_flag: boolean;
  reference_visit_id?: number;
}

export interface CRF {
  crf_id: number;
  study_id: number;
  name: string;
  description?: string;
  oc_oid?: string;
  owner_id: number;
  date_created: Date;
  date_updated?: Date;
  update_id: number;
  status_id: number;
  source_data_verification_code?: number;
}

export interface EventCRF {
  event_crf_id: number;
  study_event_id: number;
  crf_version_id: number;
  date_interviewed?: Date;
  interviewer_name?: string;
  completion_status_id: number;
  status_id: number;
  annotations?: string;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id: number;
  validator_id?: number;
  date_validate?: Date;
  date_validate_completed?: Date;
  validator_annotations?: string;
  validate_string?: string;
  sdv_status: boolean;
  sdv_update_id?: number;
}

export interface ItemData {
  item_data_id: number;
  item_id: number;
  event_crf_id: number;
  status_id: number;
  value?: string;
  date_created: Date;
  date_updated?: Date;
  owner_id: number;
  update_id: number;
  ordinal: number;
  deleted: boolean;
  old_status_id?: number;
}

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
  electronicSignature?: ElectronicSignature;
}

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

export interface DiscrepancyNote {
  discrepancy_note_id: number;
  description: string;
  discrepancy_note_type_id: number;
  resolution_status_id: number;
  detailed_notes?: string;
  date_created: Date;
  owner_id: number;
  parent_dn_id?: number;
  entity_type: string;
  study_id: number;
  assigned_user_id?: number;
  entity_id?: number;
  column_name?: string;
  event_crf_id?: number;
  study_subject_id?: number;
}

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
  status?: 'New' | 'Updated' | 'Resolved' | 'Closed' | 'Not Applicable';
  page?: number;
  limit?: number;
}

/**
 * ============================================================================
 * AUDIT TRAIL TYPES
 * ============================================================================
 */

export interface AuditLogEvent {
  audit_id: number;
  audit_date: Date;
  audit_table: string;
  user_id: number;
  entity_id?: number;
  entity_name?: string;
  old_value?: string;
  new_value?: string;
  event_type_id: number;
  reason_for_change?: string;
  study_id?: number;
  subject_id?: number;
  event_crf_id?: number;
}

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
  studyId: number;
  startDate: string;
  endDate: string;
  format: 'csv' | 'pdf' | 'json';
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
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: any[];
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

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
 * WORKFLOW TYPES
 * ============================================================================
 */

export interface WorkflowStatus {
  statusId: number;
  statusName: string;
  description?: string;
  allowedTransitions: number[];
}

export interface WorkflowTransition {
  fromStatusId: number;
  toStatusId: number;
  actionRequired: string;
  validatorRequired: boolean;
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

