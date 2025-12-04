/**
 * LibreClinica Core Models
 * 
 * These TypeScript interfaces match the actual LibreClinica Java Bean classes.
 * All frontend and API code should use these models for consistency.
 * 
 * Source: LibreClinica\core\src\main\java\org\akaza\openclinica\bean\
 */

// =============================================================================
// BASE ENTITY TYPES (from AuditableEntityBean.java)
// =============================================================================

/**
 * Base entity that all LibreClinica entities extend
 * Matches AuditableEntityBean.java
 */
export interface AuditableEntity {
  id: number;
  name?: string;
  status: Status;
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  active?: boolean;
}

// =============================================================================
// STATUS TYPES (from Status.java)
// =============================================================================

/**
 * LibreClinica Status values
 * Matches bean/core/Status.java EXACTLY
 * 
 * From Status.java:
 *   INVALID = 0, AVAILABLE = 1, UNAVAILABLE = 2, PRIVATE = 3, PENDING = 4,
 *   DELETED = 5, LOCKED = 6, AUTO_DELETED = 7, SIGNED = 8, FROZEN = 9,
 *   SOURCE_DATA_VERIFICATION = 10, RESET = 11
 */
export type Status = 
  | 'invalid'                   // 0 - Invalid
  | 'available'                 // 1 - Active/Available
  | 'unavailable'               // 2 - Unavailable
  | 'private'                   // 3 - Private
  | 'pending'                   // 4 - Pending
  | 'removed'                   // 5 - Removed/Deleted
  | 'locked'                    // 6 - Locked
  | 'auto-removed'              // 7 - Auto-removed
  | 'signed'                    // 8 - Signed
  | 'frozen'                    // 9 - Frozen
  | 'source_data_verification'  // 10 - SDV
  | 'reset';                    // 11 - Reset

export const STATUS_MAP: Record<number, Status> = {
  0: 'invalid',
  1: 'available',
  2: 'unavailable',
  3: 'private',
  4: 'pending',
  5: 'removed',
  6: 'locked',
  7: 'auto-removed',
  8: 'signed',
  9: 'frozen',
  10: 'source_data_verification',
  11: 'reset'
};

export function getStatusFromId(statusId: number): Status {
  return STATUS_MAP[statusId] || 'available';
}

export function getStatusId(status: Status): number {
  const entry = Object.entries(STATUS_MAP).find(([_, v]) => v === status);
  return entry ? parseInt(entry[0]) : 1;
}

// =============================================================================
// USER TYPES (from UserAccountBean.java)
// =============================================================================

/**
 * User Account - matches UserAccountBean.java
 */
export interface UserAccount {
  userId: number;
  userName: string;
  firstName: string;
  lastName: string;
  email: string;
  institutionalAffiliation?: string;
  phone?: string;
  
  // Authentication
  passwd?: string;
  passwdTimestamp?: Date | string;
  passwdChallengeQuestion?: string;
  passwdChallengeAnswer?: string;
  
  // Status
  enabled: boolean;
  accountNonLocked: boolean;
  lockCounter?: number;
  lastVisitDate?: Date | string;
  
  // Type and Role
  sysAdmin: boolean;
  techAdmin: boolean;
  activeStudyId?: number;
  
  // API Access
  runWebservices?: boolean;
  enableApiKey?: boolean;
  apiKey?: string;
  accessCode?: string;
  
  // Two-Factor Auth
  authtype?: 'STANDARD' | 'MARKED' | 'TWO_FACTOR';
  authsecret?: string;
  
  // Timezone
  timeZone?: string;
  
  // Audit fields
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Not in DB - computed
  notes?: string;
  roles?: StudyUserRole[];
}

/**
 * User Type - matches UserType.java
 */
export type UserType = 'USER' | 'SYSADMIN' | 'TECHADMIN';

/**
 * Study User Role - matches StudyUserRoleBean.java
 */
export interface StudyUserRole {
  userName: string;
  studyId: number;
  roleName: string;
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
}

/**
 * Role - matches Role.java
 */
export type Role = 
  | 'system_administrator'    // 1
  | 'investigator'            // 2  
  | 'clinical_research_coordinator' // 3
  | 'ra'                      // 4 - Research Assistant
  | 'monitor'                 // 5
  | 'study_director'          // 6
  | 'data_specialist'         // 7
  | 'data_entry_person'       // 8
  | 'guest';                  // 9

// =============================================================================
// STUDY TYPES (from StudyBean.java)
// =============================================================================

/**
 * Study - matches StudyBean.java exactly
 */
export interface Study {
  studyId: number;
  parentStudyId?: number;
  parentStudyName?: string;
  
  // Identifiers
  name: string;
  officialTitle?: string;
  identifier: string;  // Unique study identifier (protocol number)
  secondaryIdentifier?: string;
  oid?: string;
  
  // Description
  summary?: string;
  protocolDescription?: string;
  
  // Timeline
  datePlannedStart?: Date | string;
  datePlannedEnd?: Date | string;
  
  // Classification
  type: StudyType;
  protocolType?: string;  // 'interventional' | 'observational'
  phase?: string;
  
  // Enrollment
  expectedTotalEnrollment?: number;
  subjectCount?: number;
  
  // Sponsor & Investigators
  sponsor?: string;
  collaborators?: string;
  principalInvestigator?: string;
  
  // Facility Info
  facilityName?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  facilityContactName?: string;
  facilityContactDegree?: string;
  facilityContactPhone?: string;
  facilityContactEmail?: string;
  
  // Protocol Details
  protocolDateVerification?: Date | string;
  medlineIdentifier?: string;
  resultsReference?: boolean;
  url?: string;
  urlDescription?: string;
  
  // Eligibility
  conditions?: string;
  keywords?: string;
  eligibility?: string;
  gender?: string;
  ageMin?: string;
  ageMax?: string;
  healthyVolunteerAccepted?: boolean;
  
  // Study Design
  purpose?: string;
  allocation?: string;
  masking?: string;
  control?: string;
  assignment?: string;
  endpoint?: string;
  interventions?: string;
  duration?: string;
  selection?: string;
  timing?: string;
  
  // Settings
  studyParameterConfig?: StudyParameterConfig;
  
  // Notifications
  mailNotification?: string;
  contactEmail?: string;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed fields
  genetic?: boolean;
  published?: boolean;
  
  // Schema/Environment (multi-tenant)
  schemaName?: string;
  envType?: string;
  studyEnvUuid?: string;
  studyEnvSiteUuid?: string;
  studyUuid?: string;
}

/**
 * Study Type - matches StudyType.java
 */
export type StudyType = 'genetic' | 'nongenetic';

/**
 * Study Parameter Config - matches StudyParameterConfig.java
 */
export interface StudyParameterConfig {
  collectDob?: string;
  discrepancyManagement?: boolean;
  genderRequired?: string;
  subjectPersonIdRequired?: string;
  subjectIdGeneration?: string;
  subjectIdPrefixSuffix?: string;
  personIdShownOnCrf?: string;
  secondaryLabelViewable?: boolean;
  eventLocationRequired?: boolean;
  studySubjectIdLabel?: string;
  secondaryIdLabel?: string;
  dateOfEnrollmentForStudyRequired?: string;
}

// =============================================================================
// STUDY SUBJECT TYPES (from StudySubjectBean.java)
// =============================================================================

/**
 * Study Subject - matches StudySubjectBean.java
 * This is the primary "patient" model in LibreClinica
 */
export interface StudySubject {
  studySubjectId: number;
  label: string;              // Primary identifier (e.g., "SS-001")
  secondaryLabel?: string;    // Secondary ID or name
  
  // Foreign Keys
  subjectId: number;          // Reference to Subject table
  studyId: number;
  
  // Enrollment
  enrollmentDate?: Date | string;
  
  // OID
  oid?: string;
  
  // Status & Audit
  statusId: number;
  status?: Status;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Joined from Subject table (not in study_subject table directly)
  uniqueIdentifier?: string;  // From Subject.uniqueIdentifier
  gender?: string;            // From Subject.gender ('m', 'f', '')
  dateOfBirth?: Date | string; // From Subject.dateOfBirth
  dobCollected?: boolean;
  
  // Computed/Display fields (not in DB)
  studyName?: string;
  siteName?: string;
  eventStartDate?: Date | string;
  timeZone?: string;
  
  // For list view
  studyGroupMaps?: SubjectGroupMap[];
}

/**
 * Subject - matches SubjectBean.java
 * Base subject entity (demographics)
 */
export interface Subject {
  subjectId: number;
  uniqueIdentifier: string;
  dateOfBirth?: Date | string;
  gender: string;  // 'm', 'f', or ''
  dobCollected: boolean;
  
  // Parent references (for family studies)
  fatherId?: number;
  motherId?: number;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Display fields (not in DB)
  label?: string;
  studyIdentifier?: string;
}

/**
 * Subject Group Map - matches SubjectGroupMapBean.java
 */
export interface SubjectGroupMap {
  id: number;
  studyGroupClassId: number;
  studyGroupId: number;
  studySubjectId: number;
  notes?: string;
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
}

// =============================================================================
// STUDY EVENT TYPES (from StudyEventBean.java)
// =============================================================================

/**
 * Study Event - matches StudyEventBean.java
 * An instance of a study event for a subject
 */
export interface StudyEvent {
  studyEventId: number;
  studyEventDefinitionId: number;
  studySubjectId: number;
  
  // Event Details
  location?: string;
  sampleOrdinal: number;  // For repeating events
  dateStarted?: Date | string;
  dateEnded?: Date | string;
  
  // Time Flags
  startTimeFlag?: boolean;
  endTimeFlag?: boolean;
  
  // Status
  subjectEventStatus: SubjectEventStatus;
  statusId: number;
  
  // Audit
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed/Joined fields (not in DB)
  studyEventDefinition?: StudyEventDefinition;
  eventCRFs?: EventCRF[];
  studySubjectLabel?: string;
  scheduledDatePast?: boolean;
  repeatingNum?: number;
  editable?: boolean;
}

/**
 * Subject Event Status - matches SubjectEventStatus.java
 */
export type SubjectEventStatus =
  | 'scheduled'           // 1
  | 'not_scheduled'       // 2
  | 'data_entry_started'  // 3
  | 'completed'           // 4
  | 'stopped'             // 5
  | 'skipped'             // 6
  | 'locked'              // 7
  | 'signed';             // 8

export const SUBJECT_EVENT_STATUS_MAP: Record<number, SubjectEventStatus> = {
  1: 'scheduled',
  2: 'not_scheduled',
  3: 'data_entry_started',
  4: 'completed',
  5: 'stopped',
  6: 'skipped',
  7: 'locked',
  8: 'signed'
};

/**
 * Study Event Definition - matches StudyEventDefinitionBean.java
 * Template for study events
 */
export interface StudyEventDefinition {
  studyEventDefinitionId: number;
  studyId: number;
  
  // Event Definition
  name: string;
  description?: string;
  category?: string;
  type: string;  // 'scheduled', 'unscheduled', 'common'
  
  // Ordering
  ordinal: number;
  repeating: boolean;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // OID
  oid?: string;
  
  // Computed fields
  crfOrdinal?: number;
  eventDefinitionCRFs?: EventDefinitionCRF[];
}

// =============================================================================
// CRF TYPES (from CRFBean.java)
// =============================================================================

/**
 * CRF - matches CRFBean.java
 * Case Report Form template
 */
export interface CRF {
  crfId: number;
  studyId?: number;
  
  // CRF Details
  name: string;
  description?: string;
  
  // OID
  oid?: string;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed fields
  versions?: CRFVersion[];
  selected?: boolean;
}

/**
 * CRF Version - matches CRFVersionBean.java
 */
export interface CRFVersion {
  crfVersionId: number;
  crfId: number;
  
  // Version Details
  name: string;
  description?: string;
  revisionNotes?: string;
  
  // OID
  oid?: string;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
}

/**
 * Event Definition CRF - maps CRFs to event definitions
 */
export interface EventDefinitionCRF {
  eventDefinitionCrfId: number;
  studyEventDefinitionId: number;
  studyId: number;
  crfId: number;
  
  // Configuration
  requiredCrf: boolean;
  doubleEntry: boolean;
  electronicSignature: boolean;
  hidecrF: boolean;
  evaluatedCrf: boolean;
  tabbingMode?: string;
  
  // Default Version
  defaultVersionId?: number;
  defaultVersionName?: string;
  
  // Ordering
  ordinal: number;
  
  // SDV
  sourceDataVerification?: number;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed
  crf?: CRF;
  versions?: CRFVersion[];
}

// =============================================================================
// EVENT CRF TYPES (from EventCRFBean.java)
// =============================================================================

/**
 * Event CRF - matches EventCRFBean.java
 * An instance of a CRF for a study event
 */
export interface EventCRF {
  eventCrfId: number;
  studyEventId: number;
  crfVersionId: number;
  studySubjectId: number;
  
  // Interview Details
  dateInterviewed?: Date | string;
  interviewerName?: string;
  
  // Completion Status
  completionStatusId: number;
  
  // Validation
  validatorId?: number;
  dateValidate?: Date | string;
  dateValidateCompleted?: Date | string;
  validatorAnnotations?: string;
  validateString?: string;
  
  // Annotations
  annotations?: string;
  
  // Dates
  dateCompleted?: Date | string;
  
  // Electronic Signature
  electronicSignatureStatus: boolean;
  
  // SDV
  sdvStatus: boolean;
  sdvUpdateId?: number;
  
  // Status & Audit
  statusId: number;
  status?: Status;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed fields (not in DB)
  studySubjectName?: string;
  eventName?: string;
  studyName?: string;
  eventOrdinal?: number;
  crf?: CRF;
  crfVersion?: CRFVersion;
  stage?: DataEntryStage;
  studySubject?: StudySubject;
  studyEvent?: StudyEvent;
}

/**
 * Data Entry Stage - matches DataEntryStage.java EXACTLY
 * 
 * From DataEntryStage.java:
 *   INVALID = 0, UNCOMPLETED = 1, INITIAL_DATA_ENTRY = 2,
 *   INITIAL_DATA_ENTRY_COMPLETE = 3, DOUBLE_DATA_ENTRY = 4,
 *   DOUBLE_DATA_ENTRY_COMPLETE = 5, ADMINISTRATIVE_EDITING = 6, LOCKED = 7
 */
export type DataEntryStage =
  | 'invalid'                      // 0
  | 'not_started'                  // 1 - UNCOMPLETED
  | 'initial_data_entry'           // 2
  | 'initial_data_entry_complete'  // 3
  | 'double_data_entry'            // 4
  | 'data_entry_complete'          // 5 - DOUBLE_DATA_ENTRY_COMPLETE
  | 'administrative_editing'       // 6
  | 'locked';                      // 7

export const DATA_ENTRY_STAGE_MAP: Record<number, DataEntryStage> = {
  0: 'invalid',
  1: 'not_started',
  2: 'initial_data_entry',
  3: 'initial_data_entry_complete',
  4: 'double_data_entry',
  5: 'data_entry_complete',
  6: 'administrative_editing',
  7: 'locked'
};

/**
 * Completion Status - matches CompletionStatus.java
 */
export type CompletionStatus =
  | 'not_started'   // 0
  | 'in_progress'   // 1
  | 'complete';     // 2

// =============================================================================
// ITEM DATA TYPES (from ItemDataBean.java)
// =============================================================================

/**
 * Item Data - matches ItemDataBean.java
 * Individual field value in a CRF
 */
export interface ItemData {
  itemDataId: number;
  itemId: number;
  eventCrfId: number;
  
  // Value
  value?: string;
  
  // Ordering
  ordinal: number;
  
  // Delete flag
  deleted: boolean;
  oldStatusId?: number;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
}

/**
 * Item - matches ItemBean.java
 * Field definition in a CRF
 */
export interface Item {
  itemId: number;
  
  // Item Details
  name: string;
  description?: string;
  units?: string;
  phiStatus: boolean;
  
  // Data Type
  itemDataTypeId: number;
  itemReferenceTypeId?: number;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // OID
  oid?: string;
}

// =============================================================================
// DISCREPANCY NOTE TYPES (from DiscrepancyNoteBean.java)
// =============================================================================

/**
 * Discrepancy Note (Query) - matches DiscrepancyNoteBean.java
 */
export interface DiscrepancyNote {
  discrepancyNoteId: number;
  
  // Note Details
  description: string;
  detailedNotes?: string;
  
  // Classification
  discrepancyNoteTypeId: number;  // Query, Failed Validation, Annotation, Reason for Change
  resolutionStatusId: number;     // New, Updated, Resolved, Closed
  
  // Relationships
  entityType: string;  // 'itemData', 'eventCrf', 'studySubject', 'studyEvent'
  entityId?: number;
  columnName?: string;
  
  // Context
  studyId: number;
  studySubjectId?: number;
  eventCrfId?: number;
  
  // Assignment
  assignedUserId?: number;
  
  // Parent (for threaded notes)
  parentDnId?: number;
  
  // Status & Audit
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
}

export type DiscrepancyNoteType = 
  | 'Query'                     // 1
  | 'Failed Validation Check'   // 2
  | 'Annotation'                // 3
  | 'Reason for Change';        // 4

export type ResolutionStatus =
  | 'New'             // 1
  | 'Updated'         // 2
  | 'Resolved'        // 3
  | 'Closed'          // 4
  | 'Not Applicable'; // 5

// =============================================================================
// AUDIT LOG TYPES (from AuditLogEvent.java)
// =============================================================================

/**
 * Audit Log Event - matches AuditLogEvent.java
 */
export interface AuditLogEvent {
  auditId: number;
  auditDate: Date | string;
  auditTable: string;
  userId: number;
  
  // Entity Info
  entityId?: number;
  entityName?: string;
  
  // Change Details
  oldValue?: string;
  newValue?: string;
  eventTypeId: number;
  reasonForChange?: string;
  
  // Context
  studyId?: number;
  subjectId?: number;
  eventCrfId?: number;
}

// =============================================================================
// HELPER TYPES & UTILITIES
// =============================================================================

/**
 * Study Subject with full details (joined data)
 */
export interface StudySubjectWithDetails extends StudySubject {
  subject: Subject;
  study: Study;
  events: StudyEvent[];
  progress: SubjectProgress;
}

/**
 * Subject Progress statistics
 */
export interface SubjectProgress {
  totalEvents: number;
  completedEvents: number;
  totalForms: number;
  completedForms: number;
  percentComplete: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * API Response wrapper
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// =============================================================================
// CONVERSION UTILITIES: DATABASE ROW → TYPESCRIPT MODEL (snake_case → camelCase)
// =============================================================================

/**
 * Convert database row (snake_case) to Subject (camelCase)
 */
export function toSubject(row: any): Subject {
  return {
    subjectId: row.subject_id,
    uniqueIdentifier: row.unique_identifier || '',
    dateOfBirth: row.date_of_birth,
    gender: row.gender || '',
    dobCollected: row.dob_collected ?? false,
    fatherId: row.father_id,
    motherId: row.mother_id,
    statusId: row.status_id || 1,
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id,
    label: row.label,
    studyIdentifier: row.study_unique_identifier
  };
}

/**
 * Convert database row (snake_case) to StudySubject (camelCase)
 */
export function toStudySubject(row: any): StudySubject {
  return {
    studySubjectId: row.study_subject_id,
    label: row.label || '',
    secondaryLabel: row.secondary_label || '',
    subjectId: row.subject_id,
    studyId: row.study_id,
    enrollmentDate: row.enrollment_date,
    oid: row.oc_oid,
    statusId: row.status_id || 1,
    status: getStatusFromId(row.status_id || 1),
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id,
    uniqueIdentifier: row.unique_identifier,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    dobCollected: row.dob_collected,
    studyName: row.study_name,
    siteName: row.site_name,
    timeZone: row.time_zone
  };
}

/**
 * Convert database row (snake_case) to Study (camelCase)
 */
export function toStudy(row: any): Study {
  return {
    studyId: row.study_id,
    parentStudyId: row.parent_study_id,
    name: row.name || '',
    officialTitle: row.official_title,
    identifier: row.unique_identifier || '',
    secondaryIdentifier: row.secondary_identifier,
    oid: row.oc_oid,
    summary: row.summary,
    protocolDescription: row.protocol_description,
    datePlannedStart: row.date_planned_start,
    datePlannedEnd: row.date_planned_end,
    type: row.type_id === 2 ? 'genetic' : 'nongenetic',
    protocolType: row.protocol_type,
    phase: row.phase,
    expectedTotalEnrollment: row.expected_total_enrollment,
    sponsor: row.sponsor,
    collaborators: row.collaborators,
    principalInvestigator: row.principal_investigator,
    facilityName: row.facility_name,
    facilityCity: row.facility_city,
    facilityState: row.facility_state,
    facilityZip: row.facility_zip,
    facilityCountry: row.facility_country,
    facilityRecruitmentStatus: row.facility_recruitment_status,
    facilityContactName: row.facility_contact_name,
    facilityContactDegree: row.facility_contact_degree,
    facilityContactPhone: row.facility_contact_phone,
    facilityContactEmail: row.facility_contact_email,
    statusId: row.status_id || 1,
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id
  };
}

/**
 * Convert database row (snake_case) to StudyEvent (camelCase)
 */
export function toStudyEvent(row: any): StudyEvent {
  return {
    studyEventId: row.study_event_id,
    studyEventDefinitionId: row.study_event_definition_id,
    studySubjectId: row.study_subject_id,
    location: row.location,
    sampleOrdinal: row.sample_ordinal || 1,
    dateStarted: row.date_start,
    dateEnded: row.date_end,
    startTimeFlag: row.start_time_flag,
    endTimeFlag: row.end_time_flag,
    subjectEventStatus: SUBJECT_EVENT_STATUS_MAP[row.subject_event_status_id] || 'scheduled',
    statusId: row.status_id,
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id,
    studySubjectLabel: row.study_subject_label
  };
}

/**
 * Convert database row (snake_case) to EventCRF (camelCase)
 */
export function toEventCRF(row: any): EventCRF {
  return {
    eventCrfId: row.event_crf_id,
    studyEventId: row.study_event_id,
    crfVersionId: row.crf_version_id,
    studySubjectId: row.study_subject_id,
    dateInterviewed: row.date_interviewed,
    interviewerName: row.interviewer_name,
    completionStatusId: row.completion_status_id,
    validatorId: row.validator_id,
    dateValidate: row.date_validate,
    dateValidateCompleted: row.date_validate_completed,
    validatorAnnotations: row.validator_annotations,
    validateString: row.validate_string,
    annotations: row.annotations,
    dateCompleted: row.date_completed,
    electronicSignatureStatus: row.electronic_signature_status || false,
    sdvStatus: row.sdv_status || false,
    sdvUpdateId: row.sdv_update_id,
    statusId: row.status_id,
    status: getStatusFromId(row.status_id),
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id,
    studySubjectName: row.study_subject_name,
    eventName: row.event_name,
    studyName: row.study_name,
    eventOrdinal: row.event_ordinal
  };
}

/**
 * Convert database row (snake_case) to CRF (camelCase)
 */
export function toCRF(row: any): CRF {
  return {
    crfId: row.crf_id,
    studyId: row.study_id,
    name: row.name || '',
    description: row.description,
    oid: row.oc_oid,
    statusId: row.status_id,
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id
  };
}

/**
 * Convert database row (snake_case) to UserAccount (camelCase)
 */
export function toUserAccount(row: any): UserAccount {
  return {
    userId: row.user_id,
    userName: row.user_name || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email || '',
    institutionalAffiliation: row.institutional_affiliation,
    phone: row.phone,
    enabled: row.enabled ?? true,
    accountNonLocked: row.account_non_locked ?? true,
    lockCounter: row.lock_counter,
    lastVisitDate: row.date_lastvisit,
    sysAdmin: row.user_type_id === 1 || row.user_type_id === 0,
    techAdmin: row.user_type_id === 0,
    activeStudyId: row.active_study,
    runWebservices: row.run_webservices,
    enableApiKey: row.enable_api_key,
    apiKey: row.api_key,
    accessCode: row.access_code,
    authtype: row.authtype,
    authsecret: row.authsecret,
    timeZone: row.time_zone,
    statusId: row.status_id || 1,
    ownerId: row.owner_id || row.user_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id
  };
}

// =============================================================================
// UI-SPECIFIC TYPES (extending LibreClinica models for frontend)
// =============================================================================

/**
 * Lock history entry for audit trail
 */
export interface LockHistory {
  id: string;
  lockId: string;
  action: 'locked' | 'unlocked';
  performedBy: string;
  performedByName: string;
  performedAt: Date;
  reason: string;
  ipAddress?: string;
}

/**
 * Unlock request for locked data
 */
export interface UnlockRequest {
  id: string;
  lockId: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
}

/**
 * Lock statistics summary
 */
export interface LockStatistics {
  totalLocks: number;
  lockedForms: number;
  lockedSubjects: number;
  pendingUnlockRequests: number;
}

/**
 * Conditional rule for form display logic
 */
export interface ConditionalRule {
  fieldId: string;
  operator: string;
  value: any;
}

/**
 * Form section (maps to ItemGroup display)
 */
export interface FormSection {
  id: string;
  name: string;
  description?: string;
  order: number;
}

/**
 * Form permissions for access control
 */
export interface FormPermissions {
  canView: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canSign: boolean;
  canReview: boolean;
}

/**
 * Workflow types
 */
export type WorkflowType = 
  | 'form_review'
  | 'data_query'
  | 'electronic_signature'
  | 'study_event';

export type WorkflowStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type WorkflowPriority = 
  | 'high'
  | 'medium'
  | 'low';

/**
 * Workflow task for task management
 */
export interface WorkflowTask {
  id: string;
  workflowId: string;
  title: string;
  description: string;
  type: WorkflowType;
  status: WorkflowStatus;
  priority: WorkflowPriority;
  assignedTo: string[];
  createdAt: Date;
  dueDate?: Date;
  completedAt?: Date;
  requiresSignature: boolean;
}

/**
 * User task summary for dashboard
 */
export interface UserTaskSummary {
  userId: string;
  userName: string;
  tasks: {
    overdue: WorkflowTask[];
    pending: WorkflowTask[];
    inProgress: WorkflowTask[];
  };
  statistics: {
    totalActive: number;
    completedToday: number;
    overdueCount: number;
  };
}

/**
 * Query response (child of DiscrepancyNote)
 */
export interface QueryResponse {
  id: string;
  respondedByName: string;
  respondedByRole: string;
  respondedAt: Date;
  responseText: string;
  attachments?: { fileName: string; fileUrl: string }[];
}

/**
 * Phase transition rule for study workflow
 */
export interface PhaseTransitionRule {
  fromPhaseId: string;
  toPhaseId: string;
  condition?: string;
}

export default {
  STATUS_MAP,
  SUBJECT_EVENT_STATUS_MAP,
  DATA_ENTRY_STAGE_MAP,
  getStatusFromId,
  getStatusId,
  toStudySubject,
  toStudy,
  toStudyEvent,
  toEventCRF,
  toCRF,
  toUserAccount
};

