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
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as protocolParseService from '../services/ai/protocol-parse.service';
import { pool } from '../config/database';
import { logger } from '../config/logger';

const UPLOAD_DIR = process.env.PROTOCOL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'protocols');

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * POST /api/protocol-parse/upload
 * Saves PDF, submits to pipeline, returns job_id immediately.
 */
export const uploadProtocol = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!req.file.mimetype.includes('pdf')) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted' });
  }

  const parserBackend = (req.body.parserBackend as string) || 'unstructured';
  const studyId = req.body.studyId ? parseInt(req.body.studyId, 10) : null;
  const userId = (req as any).userId;

  // Save file to disk
  ensureUploadDir();
  const checksum = crypto.createHash('md5').update(req.file.buffer).digest('hex');
  const storedName = `${Date.now()}_${checksum}.pdf`;
  const storagePath = path.join(UPLOAD_DIR, storedName);
  fs.writeFileSync(storagePath, req.file.buffer);

  logger.info(`[protocol-parse] Saved ${req.file.originalname} (${(req.file.size/(1024*1024)).toFixed(1)} MB) → ${storedName}`);

  // Submit to Python pipeline (returns immediately with job_id)
  const submitResult = await protocolParseService.submitProtocol(
    req.file.buffer, req.file.originalname, parserBackend
  );

  if (submitResult.status === 'error') {
    return res.status(503).json({ success: false, message: submitResult.message });
  }

  // Save to DB
  let docId: number | null = null;
  try {
    const result = await pool.query(`
      INSERT INTO acc_protocol_documents
        (study_id, filename, mime_type, file_size, checksum_md5, storage_path, pipeline_status, thread_id, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7, $8)
      RETURNING id
    `, [studyId, req.file.originalname, req.file.mimetype, req.file.size, checksum, storagePath, submitResult.jobId, userId]);
    docId = result.rows[0]?.id;
  } catch (dbErr: any) {
    logger.warn(`[protocol-parse] DB insert failed (table may not exist yet): ${dbErr.message}`);
  }

  return res.status(202).json({
    success: true,
    data: {
      jobId: submitResult.jobId,
      documentId: docId,
      message: submitResult.message,
      fileSizeMb: +(req.file.size / (1024 * 1024)).toFixed(1),
    },
  });
});

/**
 * GET /api/protocol-parse/jobs/:jobId
 * Poll for pipeline job status.
 */
export const getJobStatus = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });

  const status = await protocolParseService.getJobStatus(jobId);

  // If completed, update DB
  if (status.status === 'completed' || status.status === 'failed') {
    try {
      await pool.query(`
        UPDATE acc_protocol_documents SET pipeline_status = $2, processed_at = NOW()
        WHERE thread_id = $1 AND pipeline_status = 'processing'
      `, [jobId, status.status]);
    } catch { /* table may not exist */ }
  }

  return res.status(200).json({ success: true, data: status });
});

/**
 * GET /api/protocol-parse/jobs/:jobId/result
 * Get full results (bundle, visits, conflicts) for a completed job.
 */
export const getJobResult = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });

  const result = await protocolParseService.getJobResult(jobId);
  if (!result) {
    return res.status(409).json({ success: false, message: 'Job not complete or result unavailable' });
  }

  // Cache result in DB
  try {
    await pool.query(`
      UPDATE acc_protocol_documents SET
        generated_bundle = $2,
        conflict_log = $3,
        total_forms_generated = $4,
        total_rules_extracted = $5,
        total_conflicts = $6
      WHERE thread_id = $1
    `, [jobId, JSON.stringify(result.bundle), JSON.stringify(result.conflicts),
        result.summary?.total_forms, result.summary?.total_rules, result.summary?.total_conflicts]);
  } catch { /* table may not exist */ }

  return res.status(200).json({ success: true, data: result });
});

/**
 * POST /api/protocol-parse/recompile
 */
export const recompile = asyncHandler(async (req: Request, res: Response) => {
  const { blueprint } = req.body;
  if (!blueprint) return res.status(400).json({ success: false, message: 'blueprint required' });

  try {
    const result = await protocolParseService.recompileBlueprint(blueprint);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(422).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/protocol-parse/health
 */
export const healthCheck = asyncHandler(async (req: Request, res: Response) => {
  const healthy = await protocolParseService.checkPipelineHealth();
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy ? 'Pipeline healthy' : 'Pipeline unreachable',
  });
});

/**
 * POST /api/protocol-parse/import-visits
 * Creates study event definitions and CRF assignments from AI-generated visit definitions.
 * Called after forms have been imported via /api/forms/import-bundle.
 */
export const importVisitDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const { visitDefinitions, targetStudyId, createdForms } = req.body;
  const userId = (req as any).userId;

  if (!visitDefinitions || !targetStudyId) {
    return res.status(400).json({ success: false, message: 'visitDefinitions and targetStudyId are required' });
  }
  if (!Array.isArray(visitDefinitions) || visitDefinitions.length === 0) {
    return res.status(400).json({ success: false, message: 'visitDefinitions must be a non-empty array' });
  }

  const formRefToCrfId = new Map<string, number>();
  if (Array.isArray(createdForms)) {
    for (const f of createdForms) {
      if (f.refKey && f.newCrfId) formRefToCrfId.set(f.refKey, f.newCrfId);
    }
  }

  const client = await pool.connect();
  const warnings: string[] = [];
  const createdEvents: { name: string; eventDefId: number }[] = [];

  try {
    await client.query('BEGIN');

    const parentCheck = await client.query(
      `SELECT COALESCE(parent_study_id, study_id) AS parent_study_id FROM study WHERE study_id = $1`,
      [targetStudyId]
    );
    const resolvedStudyId = parentCheck.rows.length > 0 ? parentCheck.rows[0].parent_study_id : targetStudyId;

    for (const visit of visitDefinitions) {
      const sanitizedName = (visit.name || 'Visit').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const eventOid = `SE_${resolvedStudyId}_${sanitizedName}_${randomSuffix}`;

      const eventResult = await client.query(`
        INSERT INTO study_event_definition (
          study_id, name, description, ordinal, type, repeating, category,
          schedule_day, min_day, max_day,
          status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, NOW(), $12)
        RETURNING study_event_definition_id
      `, [
        resolvedStudyId,
        visit.name || `Visit ${visit.ordinal || 1}`,
        visit.description || '',
        visit.ordinal || 1,
        visit.type || 'scheduled',
        visit.repeating || false,
        visit.category || 'Study Event',
        visit.scheduleDay ?? null,
        visit.minDay ?? null,
        visit.maxDay ?? null,
        userId,
        eventOid
      ]);

      const eventDefId = eventResult.rows[0].study_event_definition_id;
      createdEvents.push({ name: visit.name, eventDefId });

      if (Array.isArray(visit.crfAssignments)) {
        const seenCrfIds = new Set<number>();
        for (let i = 0; i < visit.crfAssignments.length; i++) {
          const assign = visit.crfAssignments[i];

          let crfId: number | null = null;
          if (assign.formRefKey && formRefToCrfId.has(assign.formRefKey)) {
            crfId = formRefToCrfId.get(assign.formRefKey)!;
          } else if (assign.formName) {
            const lookup = await client.query(
              `SELECT crf_id FROM crf WHERE name = $1 AND source_study_id = $2 AND status_id NOT IN (5,7) LIMIT 1`,
              [assign.formName, resolvedStudyId]
            );
            if (lookup.rows.length > 0) crfId = lookup.rows[0].crf_id;
          }

          if (!crfId) {
            warnings.push(`Visit "${visit.name}": could not resolve form "${assign.formRefKey || assign.formName}" — assignment skipped`);
            continue;
          }
          if (seenCrfIds.has(crfId)) continue;
          seenCrfIds.add(crfId);

          let defaultVersionId: number | null = null;
          const vr = await client.query(
            `SELECT crf_version_id FROM crf_version WHERE crf_id = $1 ORDER BY crf_version_id DESC LIMIT 1`,
            [crfId]
          );
          if (vr.rows.length > 0) defaultVersionId = vr.rows[0].crf_version_id;

          await client.query(`
            INSERT INTO event_definition_crf (
              study_event_definition_id, study_id, crf_id, required_crf,
              double_entry, hide_crf, ordinal, status_id, owner_id,
              date_created, default_version_id, electronic_signature
            ) VALUES ($1, $2, $3, $4, $5, false, $6, 1, $7, NOW(), $8, $9)
            ON CONFLICT (study_event_definition_id, study_id, crf_id) DO NOTHING
          `, [
            eventDefId,
            resolvedStudyId,
            crfId,
            assign.required ?? false,
            assign.doubleDataEntry ?? false,
            assign.ordinal ?? i,
            userId,
            defaultVersionId,
            assign.electronicSignature ?? false
          ]);
        }
      }
    }

    await client.query('COMMIT');
    logger.info('[protocol-parse] Visit definitions imported', {
      eventCount: createdEvents.length, studyId: resolvedStudyId, warnings: warnings.length
    });

    return res.status(201).json({
      success: true,
      createdEvents,
      warnings,
      message: `Created ${createdEvents.length} visit definition(s)`
    });

  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error('[protocol-parse] Visit definition import failed', { error: err.message });
    return res.status(500).json({ success: false, message: err.message, warnings });
  } finally {
    client.release();
  }
});

/**
 * GET /api/protocol-parse/documents
 */
export const listDocuments = asyncHandler(async (req: Request, res: Response) => {
  const studyId = req.query.studyId ? parseInt(req.query.studyId as string, 10) : null;
  try {
    let query = `SELECT id, study_id, filename, file_size, pipeline_status, thread_id,
                   total_forms_generated, total_conflicts, uploaded_at, processed_at
                 FROM acc_protocol_documents WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (studyId) { params.push(studyId); query += ` AND study_id = $${params.length}`; }
    query += ' ORDER BY uploaded_at DESC LIMIT 50';
    const result = await pool.query(query, params);
    return res.status(200).json({ success: true, data: result.rows });
  } catch {
    return res.status(200).json({ success: true, data: [] });
  }
});
