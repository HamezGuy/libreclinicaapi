/**
 * Event Controller
 * 
 * Handles study event (phase) operations
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as eventService from '../services/hybrid/event.service';

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

export default { 
  getStudyEvents, 
  getEvent, 
  getSubjectEvents, 
  getEventCRFs, 
  scheduleEvent, 
  create, 
  update, 
  remove 
};

