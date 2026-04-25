/**
 * Query Controller
 *
 * Thin handlers: validate input, call the service, respond.
 * All errors thrown by services bubble up through asyncHandler → errorHandler.
 * No more manual { success: false } pattern here.
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { BadRequestError, ForbiddenError, NotFoundError } from '../middleware/errorHandler.middleware';
import * as queryService from '../services/database/query.service';
import type { CreateQueryRequest, RespondToQueryRequest, CloseQueryRequest, QueryListRequest, ApiResponse, QueryWithDetails } from '@accura-trial/shared-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userId  = (req: Request) => (req as any).user.userId  as number;
const userRole = (req: Request) => (req as any).user.role   as string | undefined;
const intParam = (req: Request, name: string) => parseInt(req.params[name]);

async function assertCanEdit(req: Request, queryId: number): Promise<void> {
  const check = await queryService.canEditQuery(queryId, userId(req), userRole(req));
  if (!check.allowed) throw new ForbiddenError(check.message);
}

// ─── Read endpoints ────────────────────────────────────────────────────────────

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, status, page, limit } = req.query;
  const result = await queryService.getQueries(
    {
      studyId:   studyId   ? parseInt(studyId   as string) : undefined,
      subjectId: subjectId ? parseInt(subjectId as string) : undefined,
      status:    status as string,
      page:      parseInt(page  as string) || 1,
      limit:     parseInt(limit as string) || 20,
    },
    userId(req)
  );
  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const result = await queryService.getQueryById(intParam(req, 'id'), userId(req));
  if (!result) throw new NotFoundError('Query not found');
  const response: ApiResponse<QueryWithDetails> = { success: true, data: result };
  res.json(response);
});

export const getAuditTrail = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getQueryAuditTrail(intParam(req, 'id'), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  if (!studyId) throw new BadRequestError('studyId is required');
  const data = await queryService.getQueryStats(parseInt(studyId as string), userId(req));
  const response: ApiResponse<{ status: string; count: number }[]> = { success: true, data };
  res.json(response);
});

export const getQueryTypes = asyncHandler(async (_req: Request, res: Response) => {
  const response: ApiResponse = { success: true, data: await queryService.getQueryTypes() };
  res.json(response);
});

export const getResolutionStatuses = asyncHandler(async (_req: Request, res: Response) => {
  const response: ApiResponse = { success: true, data: await queryService.getResolutionStatuses() };
  res.json(response);
});

export const getFormQueries = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getFormQueries(intParam(req, 'eventCrfId'), userId(req));
  const response: ApiResponse<QueryWithDetails[]> = { success: true, data };
  res.json(response);
});

export const getFieldQueries = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getFieldQueries(intParam(req, 'itemDataId'), userId(req));
  const response: ApiResponse<QueryWithDetails[]> = { success: true, data };
  res.json(response);
});

export const getQueriesByField = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getQueriesByField(
    intParam(req, 'eventCrfId'), req.params.fieldName, userId(req)
  );
  const response: ApiResponse<QueryWithDetails[]> = { success: true, data };
  res.json(response);
});

export const getFormFieldQueryCounts = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getFormFieldQueryCounts(intParam(req, 'eventCrfId'), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const countByStatus = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  if (!studyId) throw new BadRequestError('studyId is required');
  const data = await queryService.getQueryCountByStatus(parseInt(studyId as string), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const countByType = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  if (!studyId) throw new BadRequestError('studyId is required');
  const data = await queryService.getQueryCountByType(parseInt(studyId as string), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const getThread = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getQueryThread(intParam(req, 'id'), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const getOverdue = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, days } = req.query;
  if (!studyId) throw new BadRequestError('studyId is required');
  const data = await queryService.getOverdueQueries(
    parseInt(studyId as string),
    parseInt(days as string) || 7,
    userId(req)
  );
  const response: ApiResponse<QueryWithDetails[]> = { success: true, data };
  res.json(response);
});

export const getMyAssigned = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  const data = await queryService.getMyAssignedQueries(
    userId(req),
    studyId ? parseInt(studyId as string) : undefined
  );
  const response: ApiResponse<QueryWithDetails[]> = { success: true, data };
  res.json(response);
});

// ─── Write endpoints ──────────────────────────────────────────────────────────

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { queryId, message } = await queryService.createQuery(req.body, userId(req));
  const response: ApiResponse<{ queryId: number }> = { success: true, data: { queryId }, message };
  res.status(201).json(response);
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  const { response, description, detailedNotes, newStatusId,
          correctedValue, correctionReason } = req.body;
  const qId = intParam(req, 'id');

  await assertCanEdit(req, qId);

  const result = await queryService.addQueryResponse(
    qId,
    { description: response || description, detailedNotes, newStatusId,
      correctedValue, correctionReason },
    userId(req)
  );
  res.json({ success: true, ...result });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const qId = intParam(req, 'id');
  const { statusId, reason } = req.body;

  await assertCanEdit(req, qId);
  const { message } = await queryService.updateQueryStatus(qId, statusId, userId(req), { reason });
  res.json({ success: true, message });
});

export const reassign = asyncHandler(async (req: Request, res: Response) => {
  const qId = intParam(req, 'id');
  const { assignedUserId } = req.body;
  const { message } = await queryService.reassignQuery(qId, assignedUserId, userId(req));
  res.json({ success: true, message });
});

/**
 * Close with electronic signature — 21 CFR Part 11 compliant.
 * Password verification done by requireSignatureFor middleware; the middleware
 * sets req.signatureVerified = true and removes the raw password from req.body.
 */
export const closeWithSignature = asyncHandler(async (req: Request, res: Response) => {
  const signatureVerified = (req as any).signatureVerified as boolean;
  const qId = intParam(req, 'id');
  const { password, reason, meaning } = req.body;

  if (!signatureVerified && !password) {
    throw new BadRequestError('Password is required for electronic signature');
  }
  if (!reason?.trim()) {
    throw new BadRequestError('Reason is required for closing a query');
  }

  await assertCanEdit(req, qId);

  const result = signatureVerified
    ? await queryService.closeQueryWithSignatureVerified(qId, userId(req), { reason, meaning })
    : await queryService.closeQueryWithSignature(qId, userId(req), { password, reason, meaning });

  res.json({ success: true, message: result.message });
});

export const acceptResolution = asyncHandler(async (req: Request, res: Response) => {
  const { reason, meaning } = req.body;
  const { message } = await queryService.acceptResolution(intParam(req, 'id'), userId(req), { reason, meaning });
  res.json({ success: true, message });
});

export const rejectResolution = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const { message } = await queryService.rejectResolution(intParam(req, 'id'), userId(req), { reason });
  res.json({ success: true, message });
});

export const reopenQuery = asyncHandler(async (req: Request, res: Response) => {
  const qId = intParam(req, 'id');
  await assertCanEdit(req, qId);
  const { message } = await queryService.reopenQuery(qId, userId(req), req.body.reason || 'Reopened');
  res.json({ success: true, message });
});

// ─── Bulk operations ──────────────────────────────────────────────────────────

export const bulkUpdateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { queryIds, statusId, reason } = req.body;
  const result = await queryService.bulkUpdateStatus(queryIds, statusId, userId(req), reason);
  res.json({ success: result.success, message: `${result.updated} updated, ${result.failed} failed`, data: { updated: result.updated, failed: result.failed, errors: result.errors } });
});

export const bulkClose = asyncHandler(async (req: Request, res: Response) => {
  const { queryIds, reason } = req.body;
  const result = await queryService.bulkCloseQueries(queryIds, userId(req), reason || 'Bulk closed');
  res.json({ success: result.success, message: `${result.closed} closed, ${result.failed} failed`, data: { closed: result.closed, failed: result.failed, errors: result.errors } });
});

export const bulkReassign = asyncHandler(async (req: Request, res: Response) => {
  const { queryIds, assignToUserId, reason } = req.body;
  const result = await queryService.bulkReassignQueries(queryIds, assignToUserId, userId(req), reason);
  res.json({ success: result.success, message: `${result.reassigned} reassigned, ${result.failed} failed`, data: { reassigned: result.reassigned, failed: result.failed, errors: result.errors } });
});

export const subjectCounts = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;
  if (!studyId) throw new BadRequestError('studyId is required');
  const data = await queryService.getQueryCountsBySubject(parseInt(studyId as string), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const formQueryCountsBySubject = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getFormQueryCountsBySubject(intParam(req, 'studySubjectId'));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const formQueryStatusByEvent = asyncHandler(async (req: Request, res: Response) => {
  const data = await queryService.getFormQueryStatusByEvent(intParam(req, 'studyEventId'), userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

/**
 * Preview who will receive a query before creating it.
 * Returns all resolved recipients (workflow config + default role-based).
 */
export const resolveRecipients = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId, studyId } = req.query;
  const data = await queryService.resolveQueryRecipients(
    eventCrfId ? parseInt(eventCrfId as string) : undefined,
    studyId ? parseInt(studyId as string) : undefined
  );
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

/**
 * Re-query: return an answered query to the respondent for further clarification.
 * Sets status back to New (1) and adds the re-query message to the thread.
 */
export const requery = asyncHandler(async (req: Request, res: Response) => {
  const qId = intParam(req, 'id');
  const { description, detailedNotes } = req.body;

  if (!description?.trim()) {
    throw new BadRequestError('A re-query message is required');
  }

  await assertCanEdit(req, qId);

  const result = await queryService.requeryQuery(qId, userId(req), {
    description: description.trim(),
    detailedNotes: detailedNotes || ''
  });
  res.json({ success: true, ...result });
});

export default {
  list, get, create, respond, updateStatus, closeWithSignature,
  acceptResolution, rejectResolution,
  getAuditTrail, stats, getQueryTypes, getResolutionStatuses,
  getFormQueries, getFieldQueries, getQueriesByField, getFormFieldQueryCounts,
  reassign, countByStatus, countByType, getThread, getOverdue, getMyAssigned,
  reopenQuery, bulkUpdateStatus, bulkClose, bulkReassign,
  subjectCounts, formQueryCountsBySubject, formQueryStatusByEvent, resolveRecipients, requery
};
