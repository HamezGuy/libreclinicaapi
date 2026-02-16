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

export default { 
  getStudyEvents, 
  getEvent, 
  getSubjectEvents, 
  getEventCRFs, 
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
  bulkAssignCrfs
};

