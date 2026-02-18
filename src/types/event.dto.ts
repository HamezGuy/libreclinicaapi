/**
 * Event/Visit DTOs — SINGLE SOURCE OF TRUTH (Backend)
 *
 * ALL event/visit creation, scheduling, and CRF assignment operations
 * MUST use these DTOs. Do NOT create inline object types for event data.
 *
 * Frontend mirror: ElectronicDataCaptureReal/src/app/interfaces/dtos/event.dto.ts
 *
 * Database tables:
 *   study_event_definition  — visit/phase templates
 *   study_event             — patient visit instances
 *   event_definition_crf    — form-to-visit template assignments
 *   event_crf               — patient form instances (references)
 *   patient_event_form      — patient form copies (JSONB snapshots)
 */

// ═══════════════════════════════════════════════════════════════════════════
// STUDY EVENT DEFINITION (Visit Template)
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateEventRequest {
  studyId: number;
  name: string;
  description?: string;
  ordinal?: number;
  type?: 'scheduled' | 'unscheduled' | 'common';
  repeating?: boolean;
  category?: string;
  scheduleDay?: number | null;
  minDay?: number | null;
  maxDay?: number | null;
  referenceEventId?: number | null;
  estimatedDurationHours?: number | null;
  // Electronic signature (21 CFR Part 11)
  password?: string;
  signatureMeaning?: string;
}

export interface UpdateEventRequest {
  name?: string;
  description?: string;
  ordinal?: number;
  type?: 'scheduled' | 'unscheduled' | 'common';
  repeating?: boolean;
  category?: string;
  scheduleDay?: number | null;
  minDay?: number | null;
  maxDay?: number | null;
  referenceEventId?: number | null;
  estimatedDurationHours?: number | null;
  // Electronic signature
  password?: string;
  signatureMeaning?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE EVENT (Patient Visit Instance)
// ═══════════════════════════════════════════════════════════════════════════

export interface ScheduleEventRequest {
  studySubjectId: number;
  studyEventDefinitionId: number;
  startDate?: string;
  endDate?: string;
  location?: string;
  scheduledDate?: string;
  isUnscheduled?: boolean;
  estimatedStart?: string;
  estimatedEnd?: string;
  // Electronic signature
  password?: string;
  signatureMeaning?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNSCHEDULED VISIT (Create + Schedule in one operation)
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateUnscheduledVisitRequest {
  studyId?: number;
  studySubjectId: number;
  studyEventDefinitionId?: number;
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  estimatedStart?: string;
  estimatedEnd?: string;
  location?: string;
  reason?: string;
  crfIds?: number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CRF ASSIGNMENT (Form-to-Visit Template)
// ═══════════════════════════════════════════════════════════════════════════

export interface AssignCrfToEventRequest {
  crfId: number;
  crfVersionId?: number;
  required?: boolean;
  doubleEntry?: boolean;
  hideCrf?: boolean;
  ordinal?: number;
  electronicSignature?: boolean;
  // Electronic signature
  password?: string;
  signatureMeaning?: string;
}

export interface UpdateCrfAssignmentRequest {
  required?: boolean;
  doubleEntry?: boolean;
  hideCrf?: boolean;
  ordinal?: number;
  defaultVersionId?: number;
  electronicSignature?: boolean;
}

export interface BulkAssignCrfRequest {
  crfAssignments: Array<{
    crfId: number;
    required?: boolean;
    doubleEntry?: boolean;
    ordinal?: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATIENT VISIT FORM ASSIGNMENT (Add form to patient's specific visit)
// ═══════════════════════════════════════════════════════════════════════════

export interface AssignFormToPatientVisitRequest {
  crfId: number;
  studySubjectId: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATIENT FORM DATA (Save data to patient's form snapshot)
// ═══════════════════════════════════════════════════════════════════════════

export interface SavePatientFormDataRequest {
  formData: Record<string, any>;
}
