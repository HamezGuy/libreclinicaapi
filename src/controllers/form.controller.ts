/**
 * Form Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as formService from '../services/hybrid/form.service';

export const saveData = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await formService.saveFormData(req.body, user.userId, user.username);

  res.status(result.success ? 200 : 400).json(result);
});

export const getData = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;

  const result = await formService.getFormData(parseInt(eventCrfId));

  res.json({ success: true, data: result });
});

export const getMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { crfId } = req.params;

  const result = await formService.getFormMetadata(parseInt(crfId));

  if (!result) {
    res.status(404).json({ success: false, message: 'Form not found' });
    return;
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

export default { saveData, getData, getMetadata, getStatus, list, get, getByStudy };

