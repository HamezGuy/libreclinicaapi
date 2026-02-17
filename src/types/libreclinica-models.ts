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

/**
 * Maps database role names (as stored in study_user_role.role_name) to display names.
 * The Role type above uses canonical names, but the database may store shorter versions.
 */
export const ROLE_DISPLAY_MAP: Record<string, string> = {
  'admin': 'System Administrator',
  'system_administrator': 'System Administrator',
  'coordinator': 'Clinical Research Coordinator',
  'clinical_research_coordinator': 'Clinical Research Coordinator',
  'director': 'Study Director',
  'study_director': 'Study Director',
  'Investigator': 'Investigator',
  'investigator': 'Investigator',
  'ra': 'Research Assistant',
  'ra2': 'Data Entry Person',
  'monitor': 'Monitor',
  'data_specialist': 'Data Specialist',
  'data_entry_person': 'Data Entry Person',
  'guest': 'Guest'
};

/**
 * Gets the display name for a role.
 * @param roleCode The role code from the database
 * @returns Human-readable role name
 */
export function getRoleDisplayName(roleCode: string): string {
  return ROLE_DISPLAY_MAP[roleCode] || roleCode;
}

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
/**
 * Study Type - maps to study_type table
 * Database values: 1='genetic', 2='observational', 3='interventional', 4='other'
 * 'nongenetic' is a legacy alias for non-genetic studies
 */
export type StudyType = 'genetic' | 'nongenetic' | 'observational' | 'interventional' | 'other';

/**
 * Maps study_type_id to StudyType
 */
export const STUDY_TYPE_MAP: Record<number, StudyType> = {
  1: 'genetic',
  2: 'observational',
  3: 'interventional',
  4: 'other'
};

/**
 * Get study type from type_id
 */
export function getStudyType(typeId: number): StudyType {
  return STUDY_TYPE_MAP[typeId] || 'other';
}

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
  screeningDate?: Date | string;
  enrollmentStatus?: string;  // 'screening' | 'enrolled' | 'screen_failure'
  
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
// STUDY PHASE TYPES (StudyEventDefinition = Phase Template)
// =============================================================================

/**
 * Study Phase (Study Event Definition) - matches StudyEventDefinitionBean.java
 * 
 * In LibreClinica, a "Study Event Definition" defines a phase/visit in the study protocol.
 * This is the TEMPLATE that defines what phases exist in a study.
 * When a patient is enrolled, study_event records are created based on these definitions.
 * 
 * Database Table: study_event_definition
 */
export interface StudyPhase {
  studyEventDefinitionId: number;  // Maps to study_event_definition_id (PK)
  studyId: number;                  // Maps to study_id (FK)
  
  // Phase Definition
  name: string;                     // Phase name (e.g., "Screening", "Week 4", "End of Study")
  description?: string;             // Detailed description
  category?: string;                // Category grouping (e.g., "Baseline", "Treatment", "Follow-up")
  type: 'scheduled' | 'unscheduled' | 'common';  // Event type
  
  // Ordering and Behavior
  ordinal: number;                  // Order in study (1, 2, 3...)
  repeating: boolean;               // Can this phase be repeated? (e.g., multiple visits)
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // OID
  oid?: string;                     // OC OID (e.g., "SE_SCREENING_123")
  
  // Computed/Joined fields (not in DB)
  crfCount?: number;                // Number of CRFs assigned to this phase
  usageCount?: number;              // Number of patients scheduled for this phase
  statusName?: string;              // Human-readable status
  assignedCrfs?: EventDefinitionCRF[]; // CRFs assigned to this phase
}

/**
 * Convert database row (snake_case) to StudyPhase (camelCase)
 */
export function toStudyPhase(row: any): StudyPhase {
  return {
    studyEventDefinitionId: row.study_event_definition_id,
    studyId: row.study_id,
    name: row.name || '',
    description: row.description,
    category: row.category,
    type: row.type || 'scheduled',
    ordinal: row.ordinal || 1,
    repeating: row.repeating || false,
    statusId: row.status_id || 1,
    ownerId: row.owner_id,
    dateCreated: row.date_created,
    dateUpdated: row.date_updated,
    updateId: row.update_id,
    oid: row.oc_oid,
    crfCount: parseInt(row.crf_count) || 0,
    usageCount: parseInt(row.usage_count) || 0,
    statusName: row.status_name
  };
}

// =============================================================================
// STUDY EVENT TYPES (from StudyEventBean.java)
// =============================================================================

/**
 * Study Event - matches StudyEventBean.java
 * 
 * An INSTANCE of a study phase for a specific subject.
 * Created when a patient is scheduled for a phase.
 * 
 * Database Table: study_event
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
/**
 * CRF - matches CRFBean.java
 * Case Report Form template
 * 
 * NOTE: The studyId field maps to the 'source_study_id' column in the database,
 * which represents the study the CRF was originally created for. The database
 * also has a 'study_id' column which may be different or null.
 */
export interface CRF {
  crfId: number;
  studyId?: number;  // Maps to source_study_id in database
  
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
 * Completion Status - matches CompletionStatus.java and database completion_status table
 * 
 * Database values (completion_status table):
 *   1 = 'not_started'
 *   2 = 'initial_data_entry' 
 *   3 = 'data_entry_started'
 *   4 = 'complete'
 *   5 = 'signed'
 */
export type CompletionStatus =
  | 'not_started'           // 1
  | 'initial_data_entry'    // 2
  | 'data_entry_started'    // 3
  | 'complete'              // 4
  | 'signed';               // 5

export const COMPLETION_STATUS_MAP: Record<number, CompletionStatus> = {
  1: 'not_started',
  2: 'initial_data_entry',
  3: 'data_entry_started',
  4: 'complete',
  5: 'signed'
};

export function getCompletionStatusFromId(completionStatusId: number): CompletionStatus {
  return COMPLETION_STATUS_MAP[completionStatusId] || 'not_started';
}

export function getCompletionStatusId(status: CompletionStatus): number {
  const entry = Object.entries(COMPLETION_STATUS_MAP).find(([_, v]) => v === status);
  return entry ? parseInt(entry[0]) : 1;
}

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

/**
 * DiscrepancyNoteType - matches discrepancy_note_type table in LibreClinica
 * 
 * Database IDs (discrepancy_note_type table):
 *   1 = 'Failed Validation Check'
 *   2 = 'Annotation'
 *   3 = 'Query'
 *   4 = 'Reason for Change'
 */
export type DiscrepancyNoteType = 
  | 'Failed Validation Check'   // 1
  | 'Annotation'                // 2
  | 'Query'                     // 3
  | 'Reason for Change';        // 4

export const DISCREPANCY_NOTE_TYPE_MAP: Record<number, DiscrepancyNoteType> = {
  1: 'Failed Validation Check',
  2: 'Annotation',
  3: 'Query',
  4: 'Reason for Change'
};

/**
 * ResolutionStatus - matches resolution_status table in LibreClinica
 * 
 * Database IDs (resolution_status table):
 *   1 = 'New'
 *   2 = 'Updated'
 *   3 = 'Resolution Proposed'
 *   4 = 'Closed'
 *   5 = 'Not Applicable'
 */
export type ResolutionStatus =
  | 'New'                  // 1
  | 'Updated'              // 2
  | 'Resolution Proposed'  // 3
  | 'Closed'               // 4
  | 'Not Applicable';      // 5

export const RESOLUTION_STATUS_MAP: Record<number, ResolutionStatus> = {
  1: 'New',
  2: 'Updated',
  3: 'Resolution Proposed',
  4: 'Closed',
  5: 'Not Applicable'
};

// =============================================================================
// STUDY GROUP TYPES (from StudyGroupBean.java, StudyGroupClassBean.java)
// =============================================================================

/**
 * Study Group Class - matches StudyGroupClassBean.java
 * Defines a category of groups (e.g., "Treatment Arm", "Cohort", "Stratum")
 */
export interface StudyGroupClass {
  studyGroupClassId: number;
  studyId: number;
  
  // Group Class Details
  name: string;
  groupClassTypeId: number;  // 1=Arm, 2=Family/Pedigree, 3=Dynamic Group, 4=Subject Groups
  subjectAssignment?: string;  // 'required', 'optional', 'not_applicable'
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Computed/Joined
  groups?: StudyGroup[];
}

/**
 * Study Group - matches StudyGroupBean.java
 * An individual group within a class (e.g., "Placebo", "Drug A 10mg", "Drug A 20mg")
 */
export interface StudyGroup {
  studyGroupId: number;
  studyGroupClassId: number;
  
  // Group Details
  name: string;
  description?: string;
  
  // Status & Audit
  statusId: number;
  ownerId: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
  updateId?: number;
  
  // Display
  subjectCount?: number;
}

/**
 * Group Class Types - from LibreClinica
 */
export type GroupClassType = 'arm' | 'family' | 'dynamic' | 'subject_groups';

export const GROUP_CLASS_TYPE_MAP: Record<number, GroupClassType> = {
  1: 'arm',
  2: 'family',
  3: 'dynamic',
  4: 'subject_groups'
};

// =============================================================================
// AUDIT LOG TYPES (from AuditLogEvent.java)
// =============================================================================

/**
 * Audit Log Event - matches AuditLogEvent.java
 * Extended with computed/joined fields for complete audit trail display
 * 21 CFR Part 11 §11.10(e) - Complete Audit Trail
 */
export interface AuditLogEvent {
  // Primary identifier
  auditId: number;
  auditDate: Date | string;
  
  // User who performed the action
  userId: number;
  userName?: string;
  userFullName?: string;
  userEmail?: string;
  userRole?: string;
  
  // What was changed
  auditTable: string;           // Table name (study_subject, item_data, event_crf, etc.)
  entityId?: number;            // ID of the affected entity
  entityName?: string;          // Name/label of the entity
  
  // Change details - CRITICAL for 21 CFR Part 11
  oldValue?: string;            // Previous value
  newValue?: string;            // New value
  eventTypeId: number;          // Type of audit event
  eventTypeName?: string;       // Human-readable event type name
  reasonForChange?: string;     // User-provided reason (required for edits)
  
  // Context - links to related records
  studyId?: number;
  studyName?: string;
  subjectId?: number;
  subjectLabel?: string;
  eventCrfId?: number;
  crfName?: string;
  studyEventId?: number;
  studyEventName?: string;
  
  // Item-level context for data changes
  itemId?: number;
  itemName?: string;
  itemDataRepeatKey?: number;
  
  // Session info for compliance
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  
  // Category for filtering/display
  eventCategory?: 'data' | 'login' | 'query' | 'signature' | 'access' | 'system';
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
  eventCompletionPercentage?: number;
  totalForms: number;
  completedForms: number;
  formCompletionPercentage?: number;
  openQueries?: number;
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
  const statusId = row.status_id || 1;
  return {
    studySubjectId: row.study_subject_id,
    label: row.label || '',
    secondaryLabel: row.secondary_label || '',
    subjectId: row.subject_id,
    studyId: row.study_id,
    enrollmentDate: row.enrollment_date,
    screeningDate: row.screening_date ?? row.screeningDate ?? row.enrollment_date,
    enrollmentStatus: row.enrollment_status ?? row.enrollmentStatus ?? (statusId === 1 ? 'enrolled' : (statusId === 5 ? 'screen_failure' : 'screening')),
    oid: row.oc_oid,
    statusId: statusId,
    status: getStatusFromId(statusId),
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
    type: getStudyType(row.type_id),
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
 * Workflow task types — stored in acc_workflow_tasks.task_type
 */
export type WorkflowType = 'data_entry' | 'review' | 'sdv' | 'signature' | 'query' | 'custom';

/**
 * Workflow task priorities — stored in acc_workflow_tasks.priority
 */
export type WorkflowPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Workflow task statuses — stored in acc_workflow_tasks.status
 */
export type WorkflowStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';

/**
 * Workflow task for task management (acc_workflow_tasks)
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
  COMPLETION_STATUS_MAP,
  getStatusFromId,
  getStatusId,
  getCompletionStatusFromId,
  getCompletionStatusId,
  toStudySubject,
  toStudy,
  toStudyEvent,
  toStudyPhase,
  toEventCRF,
  toCRF,
  toUserAccount
};

