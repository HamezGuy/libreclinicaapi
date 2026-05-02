/**
 * Subject Controller
 * 
 * Handles all subject/patient-related API endpoints including:
 * - CRUD operations
 * - Progress tracking
 * - Events and forms
 * 
 * All operations are tracked in the audit trail.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as subjectService from '../services/hybrid/subject.service';
import { logger } from '../config/logger';
import { trackUserAction } from '../services/database/audit.service';
import type { SubjectCreateRequest, SubjectUpdateRequest, ApiResponse, StudySubject } from '@accura-trial/shared-types';
import { demandSignature, type SignedRequest } from '../middleware/part11.middleware';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, status, page, limit, search, siteId, includeArchived } = req.query;
  const user = (req as any).user;

  // Validate studyId
  const parsedStudyId = parseInt(studyId as string);
  if (isNaN(parsedStudyId)) {
    logger.warn('Invalid or missing studyId', { studyId, userId: user?.userId });
    res.status(400).json({ 
      success: false, 
      message: 'Valid studyId is required',
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
    } as ApiResponse & { pagination: unknown });
    return;
  }

  const result = await subjectService.getSubjectList(
    parsedStudyId,
    { 
      status: status as string,
      search: search as string,
      siteId: siteId ? parseInt(siteId as string) : undefined,
      page: parseInt(page as string) || 1, 
      limit: parseInt(limit as string) || 20,
      includeArchived: includeArchived === 'true'
    },
    user?.userId,
    user?.username || user?.userName
  );

  // Track study access
  if (user?.userId && studyId) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'STUDY_ACCESSED',
      entityType: 'study',
      entityId: parsedStudyId,
      details: 'Viewed subject list'
    });
  }

  res.json(result as ApiResponse<StudySubject[]>);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await subjectService.getSubjectById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Subject not found' } satisfies ApiResponse);
    return;
  }

  // Track subject access
  if (user?.userId) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'SUBJECT_VIEWED',
      entityType: 'study_subject',
      entityId: parseInt(id),
      entityName: (result as any).label || (result as any).studySubjectId,
      details: `Viewed subject ${(result as any).label || id}`
    });
  }

  res.json({ success: true, data: result } satisfies ApiResponse<StudySubject>);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const username = user?.username || user?.userName;
  
  if (!user?.userId || !username) {
    logger.error('Missing user info for subject creation', { 
      hasUserId: !!user?.userId, 
      hasUsername: !!username 
    });
    res.status(401).json({ 
      success: false, 
      message: 'User authentication required for subject creation' 
    } satisfies ApiResponse);
    return;
  }
  
  logger.info('Creating subject', { 
    userId: user.userId, 
    username,
    studyId: req.body.studyId,
    label: req.body.label || req.body.studySubjectId
  });
  
  const result = await subjectService.createSubject(req.body, user.userId, username);
  
  if (!result.success) {
    logger.warn('Subject creation failed', { 
      message: result.message,
      studyId: req.body.studyId,
      label: req.body.label || req.body.studySubjectId
    });
  }

  res.status(result.success ? 201 : 400).json(result as ApiResponse<StudySubject>);
});

export const getProgress = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await subjectService.getSubjectProgress(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Subject not found' } satisfies ApiResponse);
    return;
  }

  res.json({ success: true, data: result } satisfies ApiResponse);
});

/**
 * Update subject
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;
  const updates = req.body;
  
  logger.info('Updating subject', { subjectId: id, userId: user.userId });

  try {
    await subjectService.updateSubject(parseInt(id), updates, user.userId);

    // Fetch updated subject
    const updatedSubject = await subjectService.getSubjectById(parseInt(id));

    res.json({ success: true, data: updatedSubject, message: 'Subject updated successfully' } satisfies ApiResponse<StudySubject>);
  } catch (error: any) {
    logger.error('Update subject error', { error: error.message });
    res.status(500).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

/**
 * Update subject status
 */
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  demandSignature(req as SignedRequest);
  const { id } = req.params;
  const user = (req as any).user;
  const { statusId, reason } = req.body;

  logger.info('Updating subject status', { subjectId: id, statusId, userId: user.userId });

  try {
    await subjectService.updateSubjectStatus(parseInt(id), statusId, user.userId, reason);
    res.json({ success: true, message: 'Subject status updated successfully' } satisfies ApiResponse);
  } catch (error: any) {
    if (error.statusCode === 404) {
      res.status(404).json({ success: false, message: 'Subject not found' } satisfies ApiResponse);
      return;
    }
    logger.error('Update subject status error', { error: error.message });
    res.status(500).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

/**
 * Soft delete subject (set status to removed)
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  demandSignature(req as SignedRequest);
  const { id } = req.params;
  const user = (req as any).user;

  logger.info('Removing subject', { subjectId: id, userId: user.userId });

  try {
    await subjectService.removeSubject(parseInt(id), user.userId);
    res.json({ success: true, message: 'Subject removed successfully' } satisfies ApiResponse);
  } catch (error: any) {
    if (error.statusCode === 404) {
      res.status(404).json({ success: false, message: 'Subject not found' } satisfies ApiResponse);
      return;
    }
    logger.error('Remove subject error', { error: error.message });
    res.status(500).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

/**
 * Get subject events
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('Getting subject events', { subjectId: id });

  try {
    const rows = await subjectService.getSubjectEvents(parseInt(id));

    const events = rows.map(event => {
      const totalForms = parseInt(event.totalForms) || 0;
      const completedForms = parseInt(event.completedForms) || 0;
      const startedForms = parseInt(event.startedForms) || 0;
      const lockedForms = parseInt(event.lockedForms) || 0;

      let status: string;
      if (totalForms > 0 && lockedForms >= totalForms) {
        status = 'locked';
      } else if (totalForms > 0 && completedForms >= totalForms) {
        status = 'completed';
      } else if (startedForms > 0) {
        status = 'data_entry_started';
      } else {
        status = 'scheduled';
      }

      return {
        id: event.studyEventId.toString(),
        eventDefinitionId: event.studyEventDefinitionId.toString(),
        name: event.eventName,
        description: event.eventDescription || '',
        type: event.eventType || 'scheduled',
        order: event.eventOrder,
        ordinal: event.eventOrder,
        occurrence: event.sampleOrdinal,
        startDate: event.dateStart,
        endDate: event.dateEnd,
        scheduledDate: event.scheduledDate,
        isUnscheduled: event.isUnscheduled,
        location: event.location || '',
        scheduleDay: event.scheduleDay,
        minDay: event.minDay,
        maxDay: event.maxDay,
        status,
        statusName: status,
        dateCreated: event.dateCreated,
        totalForms,
        completedForms,
        completionPercentage: totalForms > 0 
          ? Math.round((completedForms / totalForms) * 100) 
          : 0
      };
    });

    res.json({ success: true, data: events } satisfies ApiResponse);
  } catch (error: any) {
    logger.error('Get subject events error', { error: error.message });
    res.status(500).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

/**
 * Get subject forms/CRFs
 */
export const getForms = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info('Getting subject forms', { subjectId: id });

  try {
    const { existingRows, assignedRows } = await subjectService.getSubjectForms(parseInt(id));

    // Track which (study_event_id, crf_id) pairs already have event_crf entries
    const existingPairs = new Set(
      existingRows.map((r: any) => `${r.studyEventId}_${r.crfId}`)
    );

    // Map existing forms (with data)
    const forms = existingRows.map((form: any) => ({
      id: form.eventCrfId.toString(),
      eventId: form.studyEventId.toString(),
      eventName: form.eventName,
      formId: form.crfId.toString(),
      formName: form.formName,
      formDescription: form.formDescription || '',
      versionId: form.crfVersionId?.toString() || '',
      versionName: form.versionName || '',
      interviewDate: form.dateInterviewed,
      interviewer: form.interviewerName || '',
      completionStatus: form.completionStatus,
      status: form.status,
      required: form.requiredCrf === true,
      dateCreated: form.dateCreated,
      dateUpdated: form.dateUpdated,
      dateCompleted: form.dateCompleted,
      dateValidated: form.dateValidate,
      validatorId: form.validatorId
    }));

    // Add assigned but not-yet-started forms (no event_crf entry yet)
    for (const assigned of assignedRows) {
      const pairKey = `${assigned.studyEventId}_${assigned.crfId}`;
      if (!existingPairs.has(pairKey)) {
        forms.push({
          id: `pending_${assigned.studyEventId}_${assigned.crfId}`,
          eventId: assigned.studyEventId.toString(),
          eventName: assigned.eventName,
          formId: assigned.crfId.toString(),
          formName: assigned.formName,
          formDescription: assigned.formDescription || '',
          versionId: assigned.crfVersionId?.toString() || '',
          versionName: assigned.versionName || '',
          interviewDate: null,
          interviewer: '',
          completionStatus: 'not_started',
          status: 'available',
          required: assigned.requiredCrf === true,
          dateCreated: null,
          dateUpdated: null,
          dateCompleted: null,
          dateValidated: null,
          validatorId: null
        });
        existingPairs.add(pairKey);
      }
    }

    res.json({ success: true, data: forms } satisfies ApiResponse);
  } catch (error: any) {
    logger.error('Get subject forms error', { error: error.message });
    res.status(500).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

export default { 
  list, 
  get, 
  create, 
  update, 
  updateStatus, 
  remove, 
  getProgress, 
  getEvents, 
  getForms 
};

export const getQueryCounts = asyncHandler(async (req: Request, res: Response) => {
  const { studySubjectIds } = req.body;
  
  if (!Array.isArray(studySubjectIds) || studySubjectIds.length === 0) {
    res.status(400).json({ success: false, message: 'studySubjectIds array is required' } satisfies ApiResponse);
    return;
  }

  const ids = studySubjectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
  const counts = await subjectService.getQueryCountsForSubjects(ids);
  res.json({ success: true, data: counts } satisfies ApiResponse);
});

export const getFormsWithQueries = asyncHandler(async (req: Request, res: Response) => {
  const { studySubjectIds } = req.body;
  
  if (!Array.isArray(studySubjectIds) || studySubjectIds.length === 0) {
    res.status(400).json({ success: false, message: 'studySubjectIds array is required' } satisfies ApiResponse);
    return;
  }

  const ids = studySubjectIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
  const forms = await subjectService.getFormsWithQueriesForSubjects(ids);
  res.json({ success: true, data: forms } satisfies ApiResponse);
});

export const checkLabel = asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const label = decodeURIComponent(req.params.label).trim();

  if (isNaN(studyId) || !label) {
    res.status(400).json({ success: false, message: 'Invalid study ID or label' } satisfies ApiResponse);
    return;
  }

  const exists = await subjectService.checkLabelExists(studyId, label);
  res.json({ success: true, data: { exists, label } } satisfies ApiResponse);
});

