/**
 * Event Controller
 * 
 * Handles study event (phase) operations
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as eventService from '../services/hybrid/event.service';

/**
 * List events - accepts studyId as query param for frontend compatibility
 */
export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId } = req.query;
  
  if (subjectId) {
    const result = await eventService.getSubjectEvents(parseInt(subjectId as string));
    res.json({ success: true, data: result, total: result.length });
    return;
  }
  
  if (studyId) {
    const result = await eventService.getStudyEvents(parseInt(studyId as string));
    res.json({ success: true, data: result, total: result.length });
    return;
  }
  
  // Return empty array if no filters provided
  res.json({ success: true, data: [], total: 0 });
});

export const getStudyEvents = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  const result = await eventService.getStudyEvents(parseInt(studyId));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await eventService.getStudyEventById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Event not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const getSubjectEvents = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await eventService.getSubjectEvents(parseInt(subjectId));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

export const getEventCRFs = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await eventService.getEventCRFs(parseInt(id));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

/**
 * Get patient's event_crfs for a specific study_event instance
 * These are the editable copies of templates for this patient's phase
 */
export const getPatientEventCRFs = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const result = await eventService.getPatientEventCRFs(parseInt(studyEventId));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

/**
 * Get CRF completion statuses for a patient's visit instance.
 * Returns simplified status info: crfId, crfName, eventCrfId, status, completedFields, totalFields.
 */
export const getPatientEventCRFStatuses = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const eventCrfs = await eventService.getPatientEventCRFs(parseInt(studyEventId));

  const statuses = eventCrfs.map((ec: any) => ({
    crf_id: ec.crf_id,
    crf_name: ec.crf_name,
    event_crf_id: ec.event_crf_id,
    status: ec.completion_status || 'not_started',
    status_id: ec.completion_status_id,
    completed_fields: parseInt(ec.filled_fields) || 0,
    total_fields: parseInt(ec.total_fields) || 0
  }));

  res.json({ 
    success: true, 
    data: statuses,
    total: statuses.length 
  });
});

/**
 * Get ALL forms for a patient's visit — single endpoint for the visit detail UI.
 * Combines template-level assignments with the patient's actual form instances.
 */
export const getVisitForms = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const rows = await eventService.getVisitForms(parseInt(studyEventId));

  const forms = rows.map((r: any) => ({
    crfId: r.crf_id,
    crfName: r.crf_name,
    crfDescription: r.crf_description || '',
    required: r.required_crf || false,
    doubleEntry: r.double_entry || false,
    electronicSignature: r.electronic_signature || false,
    ordinal: r.ordinal || 1,
    defaultVersionId: r.default_version_id,
    defaultVersionName: r.default_version_name,
    // Patient-specific
    eventCrfId: r.event_crf_id || null,
    patientVersionId: r.patient_version_id || null,
    completionStatus: r.completion_status || 'not_started',
    completionStatusId: r.completion_status_id || null,
    startedAt: r.started_at || null,
    completedAt: r.completed_at || null,
    filledFields: parseInt(r.filled_fields) || 0,
    totalFields: parseInt(r.total_fields) || 0,
    progress: r.total_fields > 0
      ? Math.round((parseInt(r.filled_fields) || 0) / parseInt(r.total_fields) * 100)
      : null
  }));

  res.json({ success: true, data: forms, total: forms.length });
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

  res.json({
    success: true,
    data: result,
    total: result.length
  });
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
 * Create an unscheduled visit on the fly for a patient
 */
export const createUnscheduledVisit = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await eventService.createUnscheduledVisit(
    req.body,
    user.userId,
    user.username || user.userName
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Get patient form snapshots for a visit
 */
export const getPatientFormSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { studyEventId } = req.params;

  const result = await eventService.getPatientFormSnapshots(parseInt(studyEventId));

  res.json({ success: true, data: result, total: result.length });
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

  res.json(result);
});

/**
 * Verify patient form integrity:
 * Compares study source-of-truth (event_definition_crf) with
 * the patient's copies (event_crf + patient_event_form snapshots).
 */
export const verifyPatientFormIntegrity = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await eventService.verifyPatientFormIntegrity(parseInt(subjectId));

  res.json({ success: true, data: result });
});

/**
 * Repair missing patient_event_form snapshots for a subject.
 */
export const repairMissingSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;
  const user = (req as any).user;

  const result = await eventService.repairMissingSnapshots(parseInt(subjectId), user.userId);

  res.json({ success: true, data: result });
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
  createUnscheduledVisit,
  getPatientFormSnapshots,
  savePatientFormData,
  // Verification / repair
  verifyPatientFormIntegrity,
  repairMissingSnapshots
};

