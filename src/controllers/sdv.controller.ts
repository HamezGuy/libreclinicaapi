/**
 * SDV (Source Data Verification) Controller
 * 
 * Handles SDV operations for LibreClinica:
 * - List SDV records with filtering
 * - Get individual SDV record details
 * - Get form data for SDV preview
 * - Verify/Unverify operations with audit trail
 * - Bulk verification
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as sdvService from '../services/database/sdv.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { studyId, subjectId, status, page, limit } = req.query;

  const result = await sdvService.getSDVRecords({
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

  const result = await sdvService.getSDVById(parseInt(id));

  if (!result) {
    res.status(404).json({ success: false, message: 'SDV record not found' });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * Get form data for SDV preview
 * Returns all item_data for the specified event_crf
 */
export const getFormData = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await sdvService.getSDVFormData(parseInt(id));

  res.json(result);
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await sdvService.verifySDV(parseInt(id), user.userId);

  res.json(result);
});

/**
 * Bulk verify multiple SDV records
 */
export const bulkVerify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { eventCrfIds } = req.body;

  if (!eventCrfIds || !Array.isArray(eventCrfIds)) {
    res.status(400).json({ success: false, message: 'eventCrfIds array is required' });
    return;
  }

  const result = await sdvService.bulkVerifySDV(eventCrfIds, user.userId);

  res.json(result);
});

/**
 * Get SDV status for a subject
 */
export const getSubjectStatus = asyncHandler(async (req: Request, res: Response) => {
  const { subjectId } = req.params;

  const result = await sdvService.getSubjectSDVStatus(parseInt(subjectId));

  res.json(result);
});

/**
 * Get SDV statistics for a study
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await sdvService.getSDVStats(parseInt(studyId as string));

  res.json(result);
});

/**
 * Get SDV by visit/event
 */
export const getByVisit = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.query;

  if (!studyId) {
    res.status(400).json({ success: false, message: 'studyId is required' });
    return;
  }

  const result = await sdvService.getSDVByVisit(parseInt(studyId as string));

  res.json(result);
});

/**
 * Unverify SDV record
 */
export const unverify = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const result = await sdvService.unverifySDV(parseInt(id), user.userId);

  res.json(result);
});

export default { list, get, verify, bulkVerify, getSubjectStatus, getStats, getByVisit, unverify };
