/**
 * Event Controller
 * 
 * Handles study event (phase) operations
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as eventService from '../services/hybrid/event.service';
import type { ApiResponse, CreateEventRequest, UpdateEventRequest, ScheduleEventRequest, StudyEventDefinition, EventCRF, LockEligibility } from '@accura-trial/shared-types';

/**
 * List events - accepts studyId as query param for frontend compatibility
 */
export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId } = req.query;
  
  if (subjectId) {
    const result = await eventService.getSubjectEvents(parseInt(subjectId as string));
    const response: ApiResponse<typeof result> = { success: true, data: result };
    res.json(response);
    return;
  }
  
  if (studyId) {
    const result = await eventService.getStudyEvents(parseInt(studyId as string));
    const response: ApiResponse<StudyEventDefinition[]> = { success: true, data: result };
    res.json(response);
    return;
  }
  
  res.json({ success: true, data: [] } as ApiResponse<StudyEventDefinition[]>);
});

export const getStudyEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  const result = await eventService.getStudyEvents(parseInt(studyId));

  const response: ApiResponse<StudyEventDefinition[]> = { success: true, data: result };
  res.json(response);
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await eventService.getStudyEventById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Event not found' } as ApiResponse<null>);
    return;
  }

  const response: ApiResponse<StudyEventDefinition> = { success: true, data: result };
  res.json(response);
});

export const getSubjectEvents = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await eventService.getSubjectEvents(parseInt(subjectId));

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

export const getEventCRFs = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await eventService.getEventCRFs(parseInt(id));

  const response: ApiResponse<EventCRF[]> = { success: true, data: result };
  res.json(response);
});

/**
 * Get patient's event_crfs for a specific study_event instance
 * These are the editable copies of templates for this patient's phase
 */
export const getPatientEventCRFs = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const result = await eventService.getPatientEventCRFs(parseInt(studyEventId));

  const response: ApiResponse<EventCRF[]> = { success: true, data: result };
  res.json(response);
});

/**
 * Get CRF completion statuses for a patient's visit instance.
 * Returns simplified status info: crfId, crfName, eventCrfId, status, completedFields, totalFields.
 */
export const getPatientEventCRFStatuses = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const eventCrfs = await eventService.getPatientEventCRFs(parseInt(studyEventId));

  const statuses = eventCrfs.map((ec: any) => ({
    crfId: ec.crfId,
    crfName: ec.crfName,
    eventCrfId: ec.eventCrfId,
    status: ec.completionStatus || 'not_started',
    statusId: ec.completionStatusId,
    completedFields: parseInt(ec.filledFields) || 0,
    totalFields: parseInt(ec.totalFields) || 0
  }));

  const response: ApiResponse<typeof statuses> = { success: true, data: statuses };
  res.json(response);
});

/**
 * Get ALL forms for a patient's visit — single endpoint for the visit detail UI.
 * Combines template-level assignments with the patient's actual form instances.
 */
export const getVisitForms = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const rows = await eventService.getVisitForms(parseInt(studyEventId));

  const forms = rows.map((r: any) => ({
    crfId: r.crfId,
    crfName: r.crfName,
    crfDescription: r.crfDescription || '',
    required: r.requiredCrf || false,
    doubleEntry: r.doubleEntry || false,
    electronicSignature: r.electronicSignature || false,
    ordinal: r.ordinal || 1,
    defaultVersionId: r.defaultVersionId,
    defaultVersionName: r.defaultVersionName,
    // Patient-specific
    eventCrfId: r.eventCrfId || null,
    patientVersionId: r.patientVersionId || null,
    statusId: r.statusId ?? null,
    frozen: r.frozen || false,
    completionStatus: r.statusId === 6 ? 'locked' : (r.completionStatus || 'not_started'),
    completionStatusId: r.completionStatusId || null,
    startedAt: r.startedAt || null,
    completedAt: r.completedAt || null,
    filledFields: parseInt(r.filledFields) || 0,
    totalFields: parseInt(r.totalFields) || 0,
    progress: r.totalFields > 0
      ? Math.round((parseInt(r.filledFields) || 0) / parseInt(r.totalFields) * 100)
      : null
  }));

  const response: ApiResponse<typeof forms> = { success: true, data: forms };
  res.json(response);
});

/**
 * Get lock eligibility for a visit — shows whether all forms are complete,
 * open query counts, and whether the visit can be locked.
 */
export const getVisitLockEligibility = asyncHandler(async (req: Request, res: Response) => {
  const studyEventId = parseInt(req.params.studyEventId);

  const { checkEventLockEligibility } = await import('../services/database/data-locks.service');
  const eligibility = await checkEventLockEligibility(studyEventId);

  const response: ApiResponse<LockEligibility> = { success: true, data: eligibility };
  res.json(response);
});

export const scheduleEvent = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await eventService.scheduleSubjectEvent(
    req.body,
    user.userId,
    user.username
  );

  res.status(result.success ? 201 : 400).json(result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await eventService.createStudyEvent(req.body, user.userId);

  res.status(result.success ? 201 : 400).json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await eventService.updateStudyEvent(parseInt(id), req.body, user.userId);

  res.json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await eventService.deleteStudyEvent(parseInt(id), user.userId);

  res.json(result);
});

// ============================================
// EVENT CRF ASSIGNMENT ENDPOINTS
// ============================================

/**
 * Get available CRFs that can be assigned to an event.
 * Scoped by study and organization membership.
 */
export const getAvailableCrfs = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, eventId } = req.params;
  const user = (req as any).user;

  const result = await eventService.getAvailableCrfsForEvent(
    parseInt(studyId),
    parseInt(eventId),
    user?.userId
  );

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

/**
 * Assign a CRF to a study event
 */
export const assignCrf = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventId } = req.params;

  const result = await eventService.assignCrfToEvent(
    {
      studyEventDefinitionId: parseInt(eventId),
      crfId: req.body.crfId,
      crfVersionId: req.body.crfVersionId,
      required: req.body.required,
      doubleEntry: req.body.doubleEntry,
      hideCrf: req.body.hideCrf,
      ordinal: req.body.ordinal,
      electronicSignature: req.body.electronicSignature
    },
    user.userId
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Update CRF settings for an event
 */
export const updateEventCrf = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { crfAssignmentId } = req.params;

  const result = await eventService.updateEventCrf(
    parseInt(crfAssignmentId),
    {
      required: req.body.required,
      doubleEntry: req.body.doubleEntry,
      hideCrf: req.body.hideCrf,
      ordinal: req.body.ordinal,
      defaultVersionId: req.body.defaultVersionId,
      electronicSignature: req.body.electronicSignature
    },
    user.userId
  );

  res.json(result);
});

/**
 * Remove CRF from event
 */
export const removeCrf = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { crfAssignmentId } = req.params;

  const result = await eventService.removeCrfFromEvent(
    parseInt(crfAssignmentId),
    user.userId
  );

  res.json(result);
});

/**
 * Reorder CRFs within an event
 */
export const reorderCrfs = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventId } = req.params;

  const result = await eventService.reorderEventCrfs(
    parseInt(eventId),
    req.body.orderedCrfIds,
    user.userId
  );

  res.json(result);
});

/**
 * Bulk assign CRFs to event
 */
export const bulkAssignCrfs = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventId } = req.params;

  const result = await eventService.bulkAssignCrfsToEvent(
    parseInt(eventId),
    req.body.crfAssignments,
    user.userId
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Assign a form to a specific patient visit instance
 */
export const assignFormToPatientVisit = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyEventId } = req.params;

  const result = await eventService.assignFormToPatientVisit(
    parseInt(studyEventId),
    req.body.crfId,
    req.body.studySubjectId,
    user.userId
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Remove a form from a specific patient visit instance
 */
export const removeFormFromPatientVisit = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyEventId, eventCrfId } = req.params;

  const result = await eventService.removeFormFromPatientVisit(
    parseInt(studyEventId),
    parseInt(eventCrfId),
    user.userId
  );

  res.json(result);
});

/**
 * Create an unscheduled visit on the fly for a patient
 */
export const createUnscheduledVisit = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !user.userId) {
    res.status(401).json({ success: false, message: 'Authentication required' } as ApiResponse<null>);
    return;
  }

  const result = await eventService.createUnscheduledVisit(
    req.body,
    user.userId,
    user.username || user.userName || 'unknown'
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Get patient form snapshots for a visit
 */
export const getPatientFormSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const result = await eventService.getPatientFormSnapshots(parseInt(studyEventId));

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

/**
 * Save patient form data to a snapshot
 */
export const savePatientFormData = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { patientEventFormId } = req.params;

  const result = await eventService.savePatientFormData(
    parseInt(patientEventFormId),
    req.body.formData,
    user.userId
  );

  const statusCode = result.statusCode || (result.success ? 200 : 400);
  res.status(statusCode).json(result);
});

/**
 * Verify patient form integrity:
 * Compares study source-of-truth (event_definition_crf) with
 * the patient's copies (event_crf + patient_event_form snapshots).
 */
export const verifyPatientFormIntegrity = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await eventService.verifyPatientFormIntegrity(parseInt(subjectId));

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

/**
 * Repair missing patient_event_form snapshots for a subject.
 */
export const repairMissingSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;
  const user = (req as any).user;

  const result = await eventService.repairMissingSnapshots(parseInt(subjectId), user.userId);

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

/**
 * Refresh ALL patient_event_form snapshots for a subject.
 * Deletes existing snapshots and re-creates from current form metadata.
 */
export const refreshAllSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;
  const user = (req as any).user;

  const result = await eventService.refreshAllSnapshots(parseInt(subjectId), user.userId);

  const response: ApiResponse<typeof result> = { success: true, data: result };
  res.json(response);
});

export default { 
  listEvents,
  getStudyEvents, 
  getEvent, 
  getSubjectEvents, 
  getEventCRFs, 
  getPatientEventCRFs,
  getPatientEventCRFStatuses,
  getVisitForms,
  getVisitLockEligibility,
  scheduleEvent, 
  create, 
  update, 
  remove,
  // Event CRF assignment
  getAvailableCrfs,
  assignCrf,
  updateEventCrf,
  removeCrf,
  reorderCrfs,
  bulkAssignCrfs,
  // Patient-specific
  assignFormToPatientVisit,
  removeFormFromPatientVisit,
  createUnscheduledVisit,
  getPatientFormSnapshots,
  savePatientFormData,
  // Verification / repair
  verifyPatientFormIntegrity,
  repairMissingSnapshots,
  refreshAllSnapshots
};

