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

/**
 * Get audit event types
 */
export const getEventTypes = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.getAuditEventTypes();
  res.json({ success: true, data: result });
});

/**
 * Get auditable tables list
 */
export const getTables = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.getAuditableTables();
  res.json({ success: true, data: result });
});

/**
 * Get audit statistics
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { days } = req.query;

  const result = await auditService.getAuditStatistics(
    parseInt(days as string) || 30
  );

  res.json({ success: true, data: result });
});

/**
 * Get form audit trail
 */
export const getFormAudit = asyncHandler(async (req: Request, res: Response) => {
  const { eventCrfId } = req.params;

  const result = await auditService.getFormAudit(parseInt(eventCrfId));

  res.json({ success: true, data: result });
});

/**
 * Get audit summary by date range
 */
export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    return;
  }

  const result = await auditService.getAuditSummary(
    startDate as string,
    endDate as string
  );

  res.json(result);
});

/**
 * Get compliance report
 */
export const getComplianceReport = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, studyId } = req.query;

  if (!startDate || !endDate) {
    res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    return;
  }

  const result = await auditService.getComplianceReport({
    startDate: startDate as string,
    endDate: endDate as string,
    studyId: studyId ? parseInt(studyId as string) : undefined
  });

  res.json(result);
});

/**
 * Get recent audit events
 */
export const getRecent = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query;

  const result = await auditService.getRecentAuditEvents(
    parseInt(limit as string) || 50
  );

  res.json({ success: true, data: result });
});

export default { 
  get, 
  exportCsv, 
  getSubjectAudit, 
  getEventTypes, 
  getTables, 
  getStats, 
  getFormAudit, 
  getSummary, 
  getComplianceReport, 
  getRecent 
};

