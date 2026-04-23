/**
 * LibreClinica Core Models — SINGLE SOURCE OF TRUTH (Backend)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  This file is the CANONICAL definition for all domain models.      ║
 * ║  All new code MUST import interfaces from here.                    ║
 * ║  Do NOT define duplicate interfaces in services, controllers,      ║
 * ║  or types/index.ts.                                                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * These TypeScript interfaces match the actual LibreClinica Java Bean classes
 * and PostgreSQL table schemas. Each interface has a corresponding toXxx()
 * converter function that maps snake_case database rows to camelCase objects.
 *
 * Frontend mirror: ElectronicDataCaptureReal/src/app/models/libreclinica.models.ts
 * Source:          LibreClinica/core/src/main/java/org/akaza/openclinica/bean/
 */

import { Status, STATUS_MAP, StudyType } from '@accura-trial/shared-types';
export { Status, STATUS_MAP, StudyType };

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
// STATUS TYPES — imported from @accura-trial/shared-types
// Helper functions remain here as they are backend-only.
// =============================================================================

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
 * Study Type — imported from @accura-trial/shared-types.
 * STUDY_TYPE_MAP and getStudyType() remain here as backend-only helpers.
 */

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
  
  // Visit date reference: controls how visit timing is calculated per patient
  visitDateReference?: 'scheduling_date' | 'enrollment_date' | 'custom_date';
  visitDateCustom?: Date | string;
  
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
  
  // Unscheduled visit fields (added by migration 20260214)
  scheduledDate?: Date | string;
  isUnscheduled?: boolean;
  
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
  
  // Data Freeze
  frozen?: boolean;
  
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
 * Patient Event Form — matches patient_event_form table (created by migration 20260218).
 * Stores a frozen JSONB snapshot of a form's structure + the patient's entered data.
 */
export interface PatientEventForm {
  patientEventFormId: number;
  studyEventId: number;
  eventCrfId?: number;
  crfId: number;
  crfVersionId: number;
  studySubjectId: number;
  formName: string;
  formStructure: Record<string, any>;
  formData: Record<string, any>;
  completionStatus: string;
  isLocked: boolean;
  isFrozen: boolean;
  sdvStatus: boolean;
  ordinal: number;
  openQueryCount: number;
  overdueQueryCount: number;
  closedQueryCount: number;
  dateCreated?: Date | string;
  dateUpdated?: Date | string;
  createdBy?: number;
  updatedBy?: number;
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
  generationType?: QueryGenerationType;  // 'manual' or 'automatic'
  
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
 * QueryGenerationType — whether a query was created manually by a user
 * or automatically by the system (validation rules, edit checks).
 *
 * Stored in discrepancy_note.generation_type (custom column added by AccuraTrial).
 * Other EDCs (Rave, Clinical One, OpenClinica) distinguish these internally but
 * do not expose a formal enum. We surface it for filtering, audit, and reporting.
 */
export type QueryGenerationType = 'manual' | 'automatic';

export const QUERY_GENERATION_TYPE_MAP: Record<string, QueryGenerationType> = {
  manual: 'manual',
  automatic: 'automatic'
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
  lastActivityDate?: Date | string;
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
  errors?: any[];
  warnings?: any[];
}

/**
 * Get the enrollment date for display. Returns the formatted date or 'N/A' if null/undefined.
 */
export function getEnrollmentDateDisplay(subject: StudySubject | null | undefined): string {
  if (!subject?.enrollmentDate) return 'N/A';
  try {
    const d = typeof subject.enrollmentDate === 'string' ? new Date(subject.enrollmentDate) : subject.enrollmentDate;
    if (isNaN(d.getTime())) return 'N/A';
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${year}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
  } catch {
    return 'N/A';
  }
}

/**
 * Get the enrollment date value, preserving null.
 */
export function getEnrollmentDate(subject: StudySubject | null | undefined): Date | null {
  if (!subject?.enrollmentDate) return null;
  const d = new Date(subject.enrollmentDate);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Set the enrollment date on a subject. Accepts Date, ISO string, or null to clear.
 */
export function setEnrollmentDate(subject: StudySubject, date: Date | string | null | undefined): void {
  subject.enrollmentDate = date ?? undefined;
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
 * Unlock request — matches acc_unlock_request table (created by migration).
 * Tracks requests to unlock frozen/locked event CRFs.
 */
export interface UnlockRequest {
  unlockRequestId: number;
  eventCrfId: number;
  studySubjectId?: number;
  studyId?: number;
  requestedById: number;
  requestedAt: Date | string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedById?: number;
  reviewedAt?: Date | string;
  reviewNotes?: string;
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
 * Workflow task — matches acc_workflow_tasks table (created by migration).
 * Database columns use snake_case; the pool config auto-camelizes.
 */
export interface WorkflowTask {
  taskId: number;
  taskType: string;
  title: string;
  description?: string;
  status: WorkflowStatus;
  priority: WorkflowPriority;
  entityType?: string;
  entityId?: number;
  eventCrfId?: number;
  studyId?: number;
  assignedToUserIds: number[];
  createdBy: number;
  completedBy?: number;
  dateCreated: Date | string;
  dateUpdated: Date | string;
  dateCompleted?: Date | string;
  dueDate?: Date | string;
  metadata?: Record<string, any>;
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

// =============================================================================
// DATABASE ENTITY TYPES — matches acc_* and custom tables (created by migrations.ts)
// =============================================================================

/**
 * Notification — matches acc_notifications table.
 * Per-user in-app notifications for query assignments, workflow transitions, etc.
 */
export interface Notification {
  notificationId: number;
  userId: number;
  notificationType: string;
  title: string;
  message: string;
  isRead: boolean;
  entityType?: string;
  entityId?: number;
  studyId?: number;
  linkUrl?: string;
  dateCreated: Date | string;
  dateRead?: Date | string;
}

/**
 * FormWorkflowConfig — matches acc_form_workflow_config table.
 * Per-CRF lifecycle settings: SDV, PI signature, DDE, query routing.
 */
export interface FormWorkflowConfig {
  configId: number;
  crfId: number;
  studyId?: number;
  requiresSdv: boolean;
  requiresSignature: boolean;
  requiresDde: boolean;
  queryRouteToUsers?: string;
  updatedBy?: number;
  dateUpdated?: Date | string;
}

/**
 * UserAccountExtended — matches user_account_extended table.
 * Stores bcrypt password hashes and platform role, keyed by user_id.
 */
export interface UserAccountExtended {
  userId: number;
  bcryptPasswd?: string;
  passwdUpgradedAt?: Date | string;
  passwordVersion?: number;
  platformRole?: string;
  secondaryRole?: string;
}

/**
 * FileUpload — matches file_uploads table.
 * Tracks uploaded files (CRF media, consent scans, wound images, etc.).
 */
export interface FileUpload {
  fileId: string;
  originalName: string;
  storedName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  crfVersionId?: number;
  itemId?: number;
  crfVersionMediaId?: number;
  eventCrfId?: number;
  studySubjectId?: number;
  consentId?: number;
  uploadedBy: number;
  uploadedAt: Date | string;
  deletedAt?: Date | string;
  deletedBy?: number;
}

/**
 * Organization — matches acc_organization table.
 * Represents a sponsor, CRO, or site organization.
 */
export interface Organization {
  organizationId: number;
  name: string;
  type: string;
  status: string;
  email: string;
  phone?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  ownerId?: number;
  approvedBy?: number;
  approvedAt?: Date | string;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
}

/**
 * OrganizationMember — matches acc_organization_member table.
 * Links a user to an organization with a role.
 */
export interface OrganizationMember {
  memberId: number;
  organizationId: number;
  userId: number;
  role: string;
  status: string;
  dateJoined: Date | string;
  dateUpdated?: Date | string;
}

/**
 * OrganizationCode — matches acc_organization_code table.
 * Invite codes that allow users to self-register into an organization.
 */
export interface OrganizationCode {
  codeId: number;
  code: string;
  organizationId: number;
  maxUses?: number;
  currentUses: number;
  expiresAt?: Date | string;
  defaultRole?: string;
  isActive: boolean;
  createdBy?: number;
  dateCreated: Date | string;
}

/**
 * AccessRequest — matches acc_access_request table.
 * External users requesting access to an organization / the platform.
 */
export interface AccessRequest {
  requestId: number;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  organizationName?: string;
  professionalTitle?: string;
  credentials?: string;
  reason?: string;
  organizationId?: number;
  requestedRole?: string;
  status: string;
  reviewedBy?: number;
  reviewedAt?: Date | string;
  reviewNotes?: string;
  userId?: number;
  dateCreated: Date | string;
}

/**
 * UserInvitation — matches acc_user_invitation table.
 * Token-based invitations sent by an admin to onboard new users.
 */
export interface UserInvitation {
  invitationId: number;
  email: string;
  token: string;
  organizationId?: number;
  studyId?: number;
  role?: string;
  expiresAt: Date | string;
  invitedBy?: number;
  message?: string;
  status: string;
  acceptedBy?: number;
  acceptedAt?: Date | string;
  dateCreated: Date | string;
}

/**
 * RolePermission — matches acc_role_permission table.
 * Per-organization overrides for role-level permissions.
 */
export interface RolePermission {
  rolePermissionId: number;
  organizationId: number;
  roleName: string;
  permissionKey: string;
  allowed: boolean;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
}

/**
 * ValidationRule — matches validation_rules table.
 * Field-level validation rules attached to CRF items.
 */
export interface ValidationRule {
  validationRuleId: number;
  crfId?: number;
  crfVersionId?: number;
  itemId?: number;
  name: string;
  description?: string;
  ruleType: string;
  fieldPath?: string;
  severity?: string;
  errorMessage: string;
  warningMessage?: string;
  active: boolean;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  formatType?: string;
  operator?: string;
  compareFieldPath?: string;
  customExpression?: string;
  compareValue?: string;
  bpSystolicMin?: number;
  bpSystolicMax?: number;
  bpDiastolicMin?: number;
  bpDiastolicMax?: number;
  dateCreated?: Date | string;
  dateUpdated?: Date | string;
  ownerId?: number;
  updateId?: number;
}

/**
 * FormFolder — matches acc_form_folder table.
 * Visual-only folder grouping for CRFs on the dashboard.
 */
export interface FormFolder {
  folderId: number;
  name: string;
  description?: string;
  studyId?: number;
  ownerId: number;
  sortOrder: number;
  parentFolderId?: number;
  organizationId?: number;
  dateCreated: Date | string;
  dateUpdated?: Date | string;
}

/**
 * FormFolderItem — matches acc_form_folder_item table.
 * Links a CRF into a FormFolder with a display order.
 */
export interface FormFolderItem {
  folderItemId: number;
  folderId: number;
  crfId: number;
  sortOrder: number;
  dateAdded: Date | string;
}

export default {
  STATUS_MAP,
  SUBJECT_EVENT_STATUS_MAP,
  DATA_ENTRY_STAGE_MAP,
  COMPLETION_STATUS_MAP,
  getStatusFromId,
  getStatusId,
  getCompletionStatusFromId,
  getCompletionStatusId
};

