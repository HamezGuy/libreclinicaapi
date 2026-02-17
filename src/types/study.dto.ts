/**
 * Study DTOs — SINGLE SOURCE OF TRUTH (Backend)
 * 
 * ALL study creation, update, and retrieval operations MUST use these DTOs.
 * Do NOT create inline object types for study data.
 * 
 * Maps to LibreClinica `study` table.
 * See interfaces/dtos/study.dto.ts in the frontend for the mirror definition.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CREATE STUDY REQUEST
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateStudyRequest {
  // ─── REQUIRED ───────────────────────────────────────────────────────
  name: string;
  uniqueIdentifier: string;

  // ─── IDENTIFICATION ────────────────────────────────────────────────
  officialTitle?: string;
  secondaryIdentifier?: string;
  summary?: string;
  studyAcronym?: string;                  // study.study_acronym (varchar 64)

  // ─── TEAM ──────────────────────────────────────────────────────────
  principalInvestigator?: string;
  sponsor?: string;
  collaborators?: string;

  // ─── TIMELINE & CLASSIFICATION ─────────────────────────────────────
  phase?: string;
  protocolType?: string;
  expectedTotalEnrollment?: number;
  datePlannedStart?: string;
  datePlannedEnd?: string;
  parentStudyId?: number;

  // ─── TIMELINE MILESTONES ───────────────────────────────────────────
  fpfvDate?: string;                      // study.fpfv_date (date) — First Patient First Visit
  lpfvDate?: string;                      // study.lpfv_date (date) — Last Patient First Visit
  lplvDate?: string;                      // study.lplv_date (date) — Last Patient Last Visit
  databaseLockDate?: string;              // study.database_lock_date (date)

  // ─── FACILITY ──────────────────────────────────────────────────────
  facilityName?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  facilityContactName?: string;
  facilityContactDegree?: string;
  facilityContactPhone?: string;
  facilityContactEmail?: string;

  // ─── PROTOCOL ──────────────────────────────────────────────────────
  protocolDescription?: string;
  protocolDateVerification?: string;
  protocolVersion?: string;               // study.protocol_version (varchar 30)
  protocolAmendmentNumber?: string;       // study.protocol_amendment_number (varchar 30)
  medlineIdentifier?: string;
  url?: string;
  urlDescription?: string;
  resultsReference?: boolean;
  conditions?: string;
  keywords?: string;
  interventions?: string;

  // ─── REGULATORY ────────────────────────────────────────────────────
  therapeuticArea?: string;               // study.therapeutic_area (varchar 255)
  indication?: string;                    // study.indication (varchar 255)
  nctNumber?: string;                     // study.nct_number (varchar 30) — ClinicalTrials.gov
  irbNumber?: string;                     // study.irb_number (varchar 255)
  regulatoryAuthority?: string;           // study.regulatory_authority (varchar 255)

  // ─── ELIGIBILITY ───────────────────────────────────────────────────
  eligibility?: string;
  gender?: string;
  ageMin?: string;
  ageMax?: string;
  healthyVolunteerAccepted?: boolean;

  // ─── STUDY DESIGN ──────────────────────────────────────────────────
  purpose?: string;
  allocation?: string;
  masking?: string;
  control?: string;
  assignment?: string;
  endpoint?: string;
  duration?: string;
  selection?: string;
  timing?: string;
  sdvRequirement?: string;               // study.sdv_requirement (varchar 64)

  // ─── NESTED STRUCTURES ─────────────────────────────────────────────
  eventDefinitions?: EventDefinitionInput[];
  groupClasses?: GroupClassInput[];
  sites?: SiteInput[];
  studyParameters?: Record<string, string>;

  // ─── ELECTRONIC SIGNATURE ──────────────────────────────────────────
  password?: string;
  signatureMeaning?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE STUDY REQUEST
// ═══════════════════════════════════════════════════════════════════════════

export interface UpdateStudyRequest {
  // ─── IDENTIFICATION ────────────────────────────────────────────────
  name?: string;
  officialTitle?: string;
  secondaryIdentifier?: string;
  summary?: string;
  studyAcronym?: string;

  // ─── TEAM ──────────────────────────────────────────────────────────
  principalInvestigator?: string;
  sponsor?: string;
  collaborators?: string;

  // ─── TIMELINE & CLASSIFICATION ─────────────────────────────────────
  phase?: string;
  protocolType?: string;
  expectedTotalEnrollment?: number;
  datePlannedStart?: string;
  datePlannedEnd?: string;

  // ─── TIMELINE MILESTONES ───────────────────────────────────────────
  fpfvDate?: string;
  lpfvDate?: string;
  lplvDate?: string;
  databaseLockDate?: string;

  // ─── FACILITY ──────────────────────────────────────────────────────
  facilityName?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
  facilityContactName?: string;
  facilityContactDegree?: string;
  facilityContactPhone?: string;
  facilityContactEmail?: string;

  // ─── PROTOCOL ──────────────────────────────────────────────────────
  protocolDescription?: string;
  protocolDateVerification?: string;
  protocolVersion?: string;
  protocolAmendmentNumber?: string;
  medlineIdentifier?: string;
  url?: string;
  urlDescription?: string;
  resultsReference?: boolean;
  conditions?: string;
  keywords?: string;
  interventions?: string;

  // ─── REGULATORY ────────────────────────────────────────────────────
  therapeuticArea?: string;
  indication?: string;
  nctNumber?: string;
  irbNumber?: string;
  regulatoryAuthority?: string;

  // ─── ELIGIBILITY ───────────────────────────────────────────────────
  eligibility?: string;
  gender?: string;
  ageMin?: string;
  ageMax?: string;
  healthyVolunteerAccepted?: boolean;

  // ─── STUDY DESIGN ──────────────────────────────────────────────────
  purpose?: string;
  allocation?: string;
  masking?: string;
  control?: string;
  assignment?: string;
  endpoint?: string;
  duration?: string;
  selection?: string;
  timing?: string;
  sdvRequirement?: string;

  // ─── STATUS ────────────────────────────────────────────────────────
  statusId?: number;

  // ─── NESTED STRUCTURES ─────────────────────────────────────────────
  eventDefinitions?: EventDefinitionInput[];
  groupClasses?: GroupClassInput[];
  sites?: SiteInput[];
  studyParameters?: Record<string, string>;

  // ─── ELECTRONIC SIGNATURE ──────────────────────────────────────────
  password?: string;
  signatureMeaning?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// NESTED INPUT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EventDefinitionInput {
  studyEventDefinitionId?: number;
  name: string;
  description?: string;
  category?: string;
  type: string;
  ordinal: number;
  repeating: boolean;
  scheduleDay?: number | null;
  minDay?: number | null;
  maxDay?: number | null;
  referenceEventId?: number | null;
  crfAssignments?: CRFAssignmentInput[];
}

export interface CRFAssignmentInput {
  crfId: number;
  crfName?: string;
  required: boolean;
  doubleDataEntry: boolean;
  electronicSignature: boolean;
  hideCrf: boolean;
  ordinal: number;
}

export interface GroupClassInput {
  studyGroupClassId?: number;
  name: string;
  groupClassTypeId: number;
  customTypeName?: string;                // For groupClassTypeId=5 (Custom), user-defined type name
  subjectAssignment?: string;
  groups?: GroupInput[];
}

export interface GroupInput {
  studyGroupId?: number;
  name: string;
  description?: string;
}

export interface SiteInput {
  studyId?: number;
  name: string;
  uniqueIdentifier: string;
  summary?: string;
  principalInvestigator?: string;
  expectedTotalEnrollment?: number;
  facilityName?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityCountry?: string;
  facilityRecruitmentStatus?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateStudyResponse {
  success: boolean;
  studyId?: number;
  message?: string;
}
