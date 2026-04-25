/**
 * Protocol Parse Controller — Async Job-Based
 * 
 * Flow:
 *   1. POST /upload → saves PDF to disk + DB, submits to Python, returns jobId
 *   2. GET /jobs/:jobId → poll for status
 *   3. GET /jobs/:jobId/result → get results when complete
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { ApiResponse } from '@accura-trial/shared-types';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as protocolParseService from '../services/ai/protocol-parse.service';
import type { ProtocolDocument, CreatedEvent, JobStatusResult, JobResult } from '../services/ai/protocol-parse.service';
import { logger } from '../config/logger';

const UPLOAD_DIR = process.env.PROTOCOL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'protocols');

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

interface UploadData {
  jobId: string;
  documentId: number | null;
  message: string;
  fileSizeMb: number;
}

/**
 * POST /api/protocol-parse/upload
 * Saves PDF, submits to pipeline, returns job_id immediately.
 */
export const uploadProtocol = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' } satisfies ApiResponse);
  }
  if (!req.file.mimetype.includes('pdf')) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted' } satisfies ApiResponse);
  }

  const parserBackend = (req.body.parserBackend as string) || 'unstructured';
  const studyId = req.body.studyId ? parseInt(req.body.studyId, 10) : null;
  const userId = (req as any).userId;

  ensureUploadDir();
  const checksum = crypto.createHash('md5').update(req.file.buffer).digest('hex');
  const storedName = `${Date.now()}_${checksum}.pdf`;
  const storagePath = path.join(UPLOAD_DIR, storedName);
  fs.writeFileSync(storagePath, req.file.buffer);

  logger.info(`[protocol-parse] Saved ${req.file.originalname} (${(req.file.size/(1024*1024)).toFixed(1)} MB) → ${storedName}`);

  const submitResult = await protocolParseService.submitProtocol(
    req.file.buffer, req.file.originalname, parserBackend
  );

  if (submitResult.status === 'error') {
    return res.status(503).json({ success: false, message: submitResult.message } satisfies ApiResponse);
  }

  const docId = await protocolParseService.saveDocument({
    studyId,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
    checksum,
    storagePath,
    jobId: submitResult.jobId,
    uploadedBy: userId,
  });

  const body: ApiResponse<UploadData> = {
    success: true,
    data: {
      jobId: submitResult.jobId,
      documentId: docId,
      message: submitResult.message,
      fileSizeMb: +(req.file.size / (1024 * 1024)).toFixed(1),
    },
  };
  return res.status(202).json(body);
});

/**
 * GET /api/protocol-parse/jobs/:jobId
 * Poll for pipeline job status.
 */
export const getJobStatus = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ success: false, message: 'jobId required' } satisfies ApiResponse);
  }

  const status = await protocolParseService.getJobStatus(jobId);

  if (status.status === 'completed' || status.status === 'failed') {
    await protocolParseService.updateDocumentStatus(jobId, status.status);
  }

  const body: ApiResponse<JobStatusResult> = { success: true, data: status };
  return res.status(200).json(body);
});

/**
 * GET /api/protocol-parse/jobs/:jobId/result
 * Get full results (bundle, visits, conflicts) for a completed job.
 */
export const getJobResult = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ success: false, message: 'jobId required' } satisfies ApiResponse);
  }

  const result = await protocolParseService.getJobResult(jobId);
  if (!result) {
    return res.status(409).json({ success: false, message: 'Job not complete or result unavailable' } satisfies ApiResponse);
  }

  await protocolParseService.updateDocumentResult(jobId, result);

  const body: ApiResponse<JobResult> = { success: true, data: result };
  return res.status(200).json(body);
});

/**
 * POST /api/protocol-parse/recompile
 */
export const recompile = asyncHandler(async (req: Request, res: Response) => {
  const { blueprint } = req.body;
  if (!blueprint) {
    return res.status(400).json({ success: false, message: 'blueprint required' } satisfies ApiResponse);
  }

  try {
    const result = await protocolParseService.recompileBlueprint(blueprint);
    const body: ApiResponse<typeof result> = { success: true, data: result };
    return res.status(200).json(body);
  } catch (error: any) {
    return res.status(422).json({ success: false, message: error.message } satisfies ApiResponse);
  }
});

/**
 * GET /api/protocol-parse/health
 */
export const healthCheck = asyncHandler(async (req: Request, res: Response) => {
  const healthy = await protocolParseService.checkPipelineHealth();
  const body: ApiResponse = {
    success: healthy,
    message: healthy ? 'Pipeline healthy' : 'Pipeline unreachable',
  };
  return res.status(healthy ? 200 : 503).json(body);
});

/**
 * POST /api/protocol-parse/import-visits
 * Creates study event definitions and CRF assignments from AI-generated visit definitions.
 */
export const importVisitDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const { visitDefinitions, targetStudyId, createdForms } = req.body;
  const userId = (req as any).userId;

  if (!visitDefinitions || !targetStudyId) {
    return res.status(400).json({ success: false, message: 'visitDefinitions and targetStudyId are required' } satisfies ApiResponse);
  }
  if (!Array.isArray(visitDefinitions) || visitDefinitions.length === 0) {
    return res.status(400).json({ success: false, message: 'visitDefinitions must be a non-empty array' } satisfies ApiResponse);
  }

  const formRefToCrfId = new Map<string, number>();
  if (Array.isArray(createdForms)) {
    for (const f of createdForms) {
      if (f.refKey && f.newCrfId) formRefToCrfId.set(f.refKey, f.newCrfId);
    }
  }

  try {
    const { createdEvents, warnings } = await protocolParseService.importVisitDefinitions(
      targetStudyId, visitDefinitions, formRefToCrfId, userId
    );

    const body: ApiResponse<{ createdEvents: CreatedEvent[]; warnings: string[] }> = {
      success: true,
      data: { createdEvents, warnings },
      message: `Created ${createdEvents.length} visit definition(s)`,
      warnings,
    };
    return res.status(201).json(body);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message } satisfies ApiResponse);
  }
});

/**
 * GET /api/protocol-parse/documents
 */
export const listDocuments = asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string, 10) : null;
  const documents = await protocolParseService.listDocuments(studyId);
  const body: ApiResponse<ProtocolDocument[]> = { success: true, data: documents };
  return res.status(200).json(body);
});
