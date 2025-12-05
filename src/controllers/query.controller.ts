/**
 * Query Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as queryService from '../services/database/query.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, status, page, limit } = req.query;

  const result = await queryService.getQueries({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    subjectId: subjectId ? parseInt(subjectId as string) : undefined,
    status: status as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 20
  });

  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await queryService.getQueryById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'Query not found' });
    return;
  }

  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await queryService.createQuery(req.body, user.userId);

  // Return proper HTTP status codes
  let statusCode = 201;
  if (!result.success) {
    if (result.message?.includes('not found')) {
      statusCode = 404;
    } else if (result.message?.includes('required') || result.message?.includes('invalid')) {
      statusCode = 400;
    } else {
      statusCode = 500; // Server error for database issues
    }
  }

  res.status(statusCode).json(result);
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { response, description, detailedNotes, newStatusId } = req.body;

  // Validate that we have a response/description
  if (!response && !description) {
    res.status(400).json({ success: false, message: 'Response text is required' });
    return;
  }

  const result = await queryService.addQueryResponse(
    parseInt(id), 
    {
      description: response || description,
      detailedNotes,
      newStatusId
    }, 
    user.userId
  );

  // Return proper HTTP status codes
  let statusCode = 200;
  if (!result.success) {
    if (result.message?.includes('not found')) {
      statusCode = 404;
    } else {
      statusCode = 500; // Server error for database issues
    }
  }

  res.status(statusCode).json(result);
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { statusId, reason } = req.body;

  // Validate statusId
  if (statusId === undefined || statusId === null) {
    res.status(400).json({ success: false, message: 'statusId is required' });
    return;
  }

  const result = await queryService.updateQueryStatus(
    parseInt(id), 
    statusId, 
    user.userId,
    { reason }
  );

  // Return proper HTTP status codes
  let statusCode = 200;
  if (!result.success) {
    if (result.message?.includes('not found')) {
      statusCode = 404;
    } else {
      statusCode = 500; // Server error for database issues
    }
  }

  res.status(statusCode).json(result);
});

/**
 * Close query with electronic signature (password verification)
 * 21 CFR Part 11 compliant
 */
export const closeWithSignature = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { password, reason, meaning } = req.body;

  if (!password) {
    res.status(400).json({ success: false, message: 'Password is required for electronic signature' });
    return;
  }

  if (!reason) {
    res.status(400).json({ success: false, message: 'Reason is required for closing a query' });
    return;
  }

  const result = await queryService.closeQueryWithSignature(
    parseInt(id),
    user.userId,
    { password, reason, meaning }
  );

  // Return 401 ONLY for password/authentication failures, not for other errors
  // This prevents the frontend interceptor from logging the user out on server errors
  let statusCode = 200;
  if (!result.success) {
    if (result.message?.includes('Invalid password') || result.message?.includes('signature verification failed')) {
      statusCode = 401; // Authentication failure
    } else if (result.message?.includes('not found')) {
      statusCode = 404; // Not found
    } else {
      statusCode = 500; // Server error for database issues etc.
    }
  }

  res.status(statusCode).json(result);
});

/**
 * Get query audit trail
 */
export const getAuditTrail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await queryService.getQueryAuditTrail(parseInt(id));

  res.json({ success: true, data: result });
});

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await queryService.getQueryStats(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get query types
 */
export const getQueryTypes = asyncHandler(async (req: Request, res: Response) => {
  const result = await queryService.getQueryTypes();
  res.json({ success: true, data: result });
});

/**
 * Get resolution statuses
 */
export const getResolutionStatuses = asyncHandler(async (req: Request, res: Response) => {
  const result = await queryService.getResolutionStatuses();
  res.json({ success: true, data: result });
});

/**
 * Get queries for a specific form
 */
export const getFormQueries = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;

  const result = await queryService.getFormQueries(parseInt(eventCrfId));

  res.json({ success: true, data: result });
});

/**
 * Reassign query
 */
export const reassign = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { assignedUserId } = req.body;

  if (!assignedUserId) {
    res.status(400).json({ success: false, message: 'assignedUserId is required' });
    return;
  }

  const result = await queryService.reassignQuery(
    parseInt(id),
    assignedUserId,
    user.userId
  );

  // Return proper HTTP status codes
  let statusCode = 200;
  if (!result.success) {
    if (result.message?.includes('not found')) {
      statusCode = 404;
    } else {
      statusCode = 500; // Server error for database issues
    }
  }

  res.status(statusCode).json(result);
});

/**
 * Get query count by status
 */
export const countByStatus = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await queryService.getQueryCountByStatus(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get query count by type
 */
export const countByType = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await queryService.getQueryCountByType(parseInt(studyId as string));

  res.json({ success: true, data: result });
});

/**
 * Get query thread (conversation)
 */
export const getThread = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await queryService.getQueryThread(parseInt(id));

  res.json({ success: true, data: result });
});

/**
 * Get overdue queries
 */
export const getOverdue = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await queryService.getOverdueQueries(
    parseInt(studyId as string),
    parseInt(days as string) || 7
  );

  res.json({ success: true, data: result });
});

/**
 * Get my assigned queries
 */
export const getMyAssigned = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId } = req.query;

  const result = await queryService.getMyAssignedQueries(
    user.userId,
    studyId ? parseInt(studyId as string) : undefined
  );

  res.json({ success: true, data: result });
});

export default { 
  list, 
  get, 
  create, 
  respond, 
  updateStatus, 
  closeWithSignature,
  getAuditTrail,
  stats, 
  getQueryTypes, 
  getResolutionStatuses, 
  getFormQueries, 
  reassign, 
  countByStatus, 
  countByType, 
  getThread, 
  getOverdue, 
  getMyAssigned 
};

