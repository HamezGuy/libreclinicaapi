/**
 * Form Controller
 * 
 * Handles form/CRF operations with audit tracking
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as formService from '../services/hybrid/form.service';
import { trackDocumentAccess, trackUserAction } from '../services/database/audit.service';

export const saveData = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await formService.saveFormData(req.body, user.userId, user.username);

  // Track form save action
  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username,
      action: 'FORM_UPDATED',
      entityType: 'event_crf',
      entityId: req.body.eventCrfId || req.body.crfId,
      details: 'Form data saved'
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

export const getData = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormData(parseInt(eventCrfId));

  // Track form view
  if (user?.userId) {
    await trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'event_crf',
      parseInt(eventCrfId),
      undefined,
      'view'
    );
  }

  res.json({ success: true, data: result });
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { crfId } = req.params;
  const user = (req as any).user;

  const result = await formService.getFormMetadata(parseInt(crfId));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  // Track document access (21 CFR Part 11)
  if (user?.userId) {
    await trackDocumentAccess(
      user.userId,
      user.username || user.userName,
      'crf',
      parseInt(crfId),
      result.crf?.name,
      'view'
    );
  }

  res.json({ success: true, data: result });
});

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;

  const result = await formService.getFormStatus(parseInt(eventCrfId));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await formService.getAllForms();
  
  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await formService.getFormById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const getByStudy = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await formService.getStudyForms(parseInt(studyId as string));

  res.json({ 
    success: true, 
    data: result,
    total: result.length 
  });
});

/**
 * Create a new form template (CRF)
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await formService.createForm(req.body, user.userId);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_CREATED',
      entityType: 'crf',
      entityId: result.crfId,
      details: `Created form: ${req.body.name}`
    });
  }

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * Update a form template
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await formService.updateForm(parseInt(id), req.body, user.userId);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_UPDATED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Updated form: ${req.body.name || id}`
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Delete a form template
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req as any).user;

  const result = await formService.deleteForm(parseInt(id), user.userId);

  if (result.success) {
    await trackUserAction({
      userId: user.userId,
      username: user.username || user.userName,
      action: 'FORM_DELETED',
      entityType: 'crf',
      entityId: parseInt(id),
      details: `Deleted form ID: ${id}`
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

export default { saveData, getData, getMetadata, getStatus, list, get, getByStudy, create, update, remove };

