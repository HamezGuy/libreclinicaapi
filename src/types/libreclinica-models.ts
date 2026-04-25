/**
 * LibreClinica Backend-Only Models
 *
 * This file re-exports shared-types DTOs and keeps ONLY types that are
 * backend-internal (never cross the API boundary to the frontend).
 *
 * ALL API-boundary DTOs now live in @accura-trial/shared-types.
 * DO NOT redefine interfaces that exist in shared-types.
 */

import {
  Status,
  STATUS_MAP,
  StudyType,
  StudySubject,
  StudyEvent,
  StudyEventDefinition,
  EventCRF,
  EventDefinitionCRF,
  CRF,
  CRFVersion,
  StudyGroupClass,
  StudyGroup,
  CompletionStatus,
  COMPLETION_STATUS_MAP,
  WorkflowTask,
} from '@accura-trial/shared-types';

// Re-export everything from shared-types so existing `import from '../../types'` still works
export * from '@accura-trial/shared-types';

// =============================================================================
// BACKEND-ONLY HELPER FUNCTIONS
// These use shared-types types but are only called by backend services.
// =============================================================================

export function getStatusFromId(statusId: number): Status {
  return STATUS_MAP[statusId] || 'available';
}

export function getStatusId(status: Status): number {
  const entry = Object.entries(STATUS_MAP).find(([_, v]) => v === status);
  return entry ? parseInt(entry[0]) : 1;
}

export const STUDY_TYPE_MAP: Record<number, StudyType> = {
  1: 'genetic',
  2: 'observational',
  3: 'interventional',
  4: 'other',
};

export function getStudyType(typeId: number): StudyType {
  return STUDY_TYPE_MAP[typeId] || 'other';
}

export function getRoleDisplayName(roleCode: string): string {
  const map: Record<string, string> = {
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
    'guest': 'Guest',
  };
  return map[roleCode] || roleCode;
}

export function getCompletionStatusFromId(completionStatusId: number): CompletionStatus {
  return COMPLETION_STATUS_MAP[completionStatusId] || 'not_started';
}

export function getCompletionStatusId(status: CompletionStatus): number {
  const entry = Object.entries(COMPLETION_STATUS_MAP).find(([_, v]) => v === status);
  return entry ? parseInt(entry[0]) : 1;
}

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

export function getEnrollmentDate(subject: StudySubject | null | undefined): Date | null {
  if (!subject?.enrollmentDate) return null;
  const d = new Date(subject.enrollmentDate);
  return isNaN(d.getTime()) ? null : d;
}

export function setEnrollmentDate(subject: StudySubject, date: Date | string | null | undefined): void {
  subject.enrollmentDate = date ?? undefined;
}

// =============================================================================
// BACKEND-ONLY TYPES
// These are internal to the backend and never sent to the frontend.
// =============================================================================

/**
 * Conditional rule for form display logic (backend-internal)
 */
export interface ConditionalRule {
  fieldId: string;
  operator: string;
  value: unknown;
}

/**
 * Form section (maps to ItemGroup display) — backend-internal
 */
export interface FormSection {
  id: string;
  name: string;
  description?: string;
  order: number;
}

/**
 * Form permissions for access control — backend-internal
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
 * User task summary for dashboard — backend-internal composite
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
 * Query response (child of DiscrepancyNote) — backend-internal
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
 * Phase transition rule for study workflow — backend-internal
 */
export interface PhaseTransitionRule {
  fromPhaseId: string;
  toPhaseId: string;
  condition?: string;
}

// =============================================================================
// DATABASE ENTITY TYPES — backend-only DB row shapes
// These are internal to the Node API and are never exposed to the frontend.
// =============================================================================

/**
 * Notification — matches acc_notifications table.
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
 * FileUpload — matches file_uploads table (extended backend shape).
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
 * OrganizationMember — matches acc_organization_member table.
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
 * QUERY_GENERATION_TYPE_MAP — backend-only constant
 */
export const QUERY_GENERATION_TYPE_MAP: Record<string, string> = {
  manual: 'manual',
  automatic: 'automatic',
};

/**
 * GROUP_CLASS_TYPE_MAP — maps legacy numeric IDs to GroupClassType strings
 */
export const GROUP_CLASS_TYPE_MAP: Record<number, string> = {
  1: 'Arm',
  2: 'Family/Pedigree',
  3: 'Demographic',
  4: 'Other',
};

// =============================================================================
// COMPOSED BACKEND TYPES — joined data shapes used by hybrid services
// =============================================================================

/**
 * Study Subject with full details (joined data) — used by subject hybrid service
 */
export interface StudySubjectWithDetails extends StudySubject {
  subject: import('@accura-trial/shared-types').Subject;
  study: import('@accura-trial/shared-types').Study;
  events: StudyEvent[];
  progress: import('@accura-trial/shared-types').SubjectProgress;
  lastActivityDate?: Date | string;
}
