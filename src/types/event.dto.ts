/**
 * Event/Visit DTOs — re-exported from @accura-trial/shared-types
 *
 * This file is a thin wrapper that maintains backward compatibility
 * for existing imports. The canonical definitions live in shared-types.
 */
export {
  CreateEventRequest,
  UpdateEventRequest,
  ScheduleEventRequest,
  CreateUnscheduledVisitRequest,
  AssignCrfToEventRequest,
  UpdateCrfAssignmentRequest,
  BulkAssignCrfRequest,
  AssignFormToPatientVisitRequest,
  SavePatientFormDataRequest,
} from '@accura-trial/shared-types';
