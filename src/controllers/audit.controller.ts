/**
 * Audit Controller
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as auditService from '../services/database/audit.service';

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, userId, eventType, startDate, endDate, page, limit } = req.query;

  const result = await auditService.getAuditTrail({
    studyId: studyId ? parseInt(studyId as string) : undefined,
    subjectId: subjectId ? parseInt(subjectId as string) : undefined,
    userId: userId ? parseInt(userId as string) : undefined,
    eventType: eventType as string,
    startDate: startDate as string,
    endDate: endDate as string,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50
  });

  res.json(result);
});

export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, startDate, endDate } = req.query;

  const csv = await auditService.exportAuditTrailCSV({
    studyId: parseInt(studyId as string),
    startDate: startDate as string,
    endDate: endDate as string,
    format: 'csv'
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=audit-trail-${Date.now()}.csv`);
  res.send(csv);
});

export const getSubjectAudit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { page, limit } = req.query;

  const result = await auditService.getSubjectAudit(
    parseInt(id),
    parseInt(page as string) || 1,
    parseInt(limit as string) || 100
  );

  res.json(result);
});

export default { get, exportCsv, getSubjectAudit };

