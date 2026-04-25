/**
 * Protocol Parse Service — Async Job-Based
 * 
 * The Python pipeline is now async:
 *   POST /parse → returns { job_id } immediately
 *   GET /jobs/{job_id} → poll for status
 *   GET /jobs/{job_id}/result → get results when complete
 */

import { logger } from '../../config/logger';
import { pool } from '../../config/database';

const PIPELINE_URL = process.env.PROTOCOL_PIPELINE_URL || 'http://localhost:8100';
const PIPELINE_TIMEOUT_MS = parseInt(process.env.PROTOCOL_PIPELINE_TIMEOUT_MS || '30000', 10);

export interface SubmitResult {
  jobId: string;
  status: string;
  message: string;
}

export interface ProtocolDocument {
  id: number;
  studyId: number | null;
  filename: string;
  fileSize: number;
  pipelineStatus: string;
  threadId: string | null;
  totalFormsGenerated: number | null;
  totalConflicts: number | null;
  uploadedAt: string;
  processedAt: string | null;
}

export interface CreatedEvent {
  name: string;
  eventDefId: number;
}

export interface ImportVisitResult {
  createdEvents: CreatedEvent[];
  warnings: string[];
}

export interface CrfAssignment {
  formRefKey?: string;
  formName?: string;
  required?: boolean;
  doubleDataEntry?: boolean;
  ordinal?: number;
  electronicSignature?: boolean;
}

export interface VisitDefinition {
  name?: string;
  description?: string;
  ordinal?: number;
  type?: string;
  repeating?: boolean;
  category?: string;
  scheduleDay?: number | null;
  minDay?: number | null;
  maxDay?: number | null;
  crfAssignments?: CrfAssignment[];
}

export interface JobStatusResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  currentPhase: string;
  progressPercent: number;
  progressMessage: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  warnings: string[];
  stats: Record<string, any>;
}

export interface JobResult {
  bundle: any;
  visitDefinitions: any[];
  conflicts: any[];
  summary: Record<string, any>;
}

/**
 * Submit a protocol PDF for async processing.
 * Returns immediately with a job_id.
 */
export async function submitProtocol(
  fileBuffer: Buffer,
  filename: string,
  parserBackend: string = 'unstructured'
): Promise<SubmitResult> {
  const url = `${PIPELINE_URL}/parse?parser_backend=${encodeURIComponent(parserBackend)}`;

  logger.info(`[protocol-parse] Submitting PDF: ${filename} (${(fileBuffer.length / (1024*1024)).toFixed(1)} MB)`);

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  formData.append('file', blob, filename);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      return { jobId: '', status: 'error', message: `Pipeline returned ${response.status}: ${err.slice(0, 300)}` };
    }

    const data: any = await response.json();
    return { jobId: data.job_id, status: data.status, message: data.message };
  } catch (error: any) {
    const msg = error.name === 'AbortError' ? 'Submit timed out' : error.message;
    logger.error(`[protocol-parse] Submit failed: ${msg}`);
    return { jobId: '', status: 'error', message: msg };
  }
}

/**
 * Poll for job status.
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResult> {
  try {
    const response = await fetch(`${PIPELINE_URL}/jobs/${jobId}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return { jobId, status: 'failed', currentPhase: 'unknown', progressPercent: 0,
               progressMessage: `Status check returned ${response.status}`, createdAt: '',
               completedAt: null, error: `HTTP ${response.status}`, warnings: [], stats: {} };
    }
    const data: any = await response.json();
    return {
      jobId: data.job_id,
      status: data.status,
      currentPhase: data.current_phase,
      progressPercent: data.progress_percent,
      progressMessage: data.progress_message,
      createdAt: data.created_at,
      completedAt: data.completed_at,
      error: data.error,
      warnings: data.warnings || [],
      stats: data.stats || {},
    };
  } catch (error: any) {
    return { jobId, status: 'failed', currentPhase: 'error', progressPercent: 0,
             progressMessage: error.message, createdAt: '', completedAt: null,
             error: error.message, warnings: [], stats: {} };
  }
}

/**
 * Get full results for a completed job.
 */
export async function getJobResult(jobId: string): Promise<JobResult | null> {
  try {
    const response = await fetch(`${PIPELINE_URL}/jobs/${jobId}/result`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const data: any = await response.json();
    return {
      bundle: data.bundle,
      visitDefinitions: data.visit_definitions,
      conflicts: data.conflicts,
      summary: data.summary,
    };
  } catch {
    return null;
  }
}

/**
 * Re-compile a blueprint (fast, no LLM).
 */
export async function recompileBlueprint(blueprint: any): Promise<any> {
  const response = await fetch(`${PIPELINE_URL}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blueprint }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Recompile failed: HTTP ${response.status}`);
  }
  return await response.json();
}

export async function checkPipelineHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PIPELINE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const data: any = await response.json();
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// DB-facing helpers (migrated from controller)
// ────────────────────────────────────────────────────────────────────

export async function saveDocument(params: {
  studyId: number | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  storagePath: string;
  jobId: string;
  uploadedBy: number;
}): Promise<number | null> {
  try {
    const result = await pool.query(`
      INSERT INTO acc_protocol_documents
        (study_id, filename, mime_type, file_size, checksum_md5, storage_path, pipeline_status, thread_id, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7, $8)
      RETURNING id
    `, [params.studyId, params.filename, params.mimeType, params.fileSize,
        params.checksum, params.storagePath, params.jobId, params.uploadedBy]);
    return result.rows[0]?.id ?? null;
  } catch (dbErr: any) {
    logger.warn(`[protocol-parse] DB insert failed (table may not exist yet): ${dbErr.message}`);
    return null;
  }
}

export async function updateDocumentStatus(jobId: string, status: string): Promise<void> {
  try {
    await pool.query(`
      UPDATE acc_protocol_documents SET pipeline_status = $2, processed_at = NOW()
      WHERE thread_id = $1 AND pipeline_status = 'processing'
    `, [jobId, status]);
  } catch { /* table may not exist */ }
}

export async function updateDocumentResult(jobId: string, result: JobResult): Promise<void> {
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
}

export async function listDocuments(studyId: number | null): Promise<ProtocolDocument[]> {
  try {
    let query = `SELECT id, study_id, filename, file_size, pipeline_status, thread_id,
                   total_forms_generated, total_conflicts, uploaded_at, processed_at
                 FROM acc_protocol_documents WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (studyId) { params.push(studyId); query += ` AND study_id = $${params.length}`; }
    query += ' ORDER BY uploaded_at DESC LIMIT 50';
    const result = await pool.query(query, params);
    return result.rows.map((row: any) => ({
      id: row.id,
      studyId: row.studyId,
      filename: row.filename,
      fileSize: row.fileSize,
      pipelineStatus: row.pipelineStatus,
      threadId: row.threadId,
      totalFormsGenerated: row.totalFormsGenerated,
      totalConflicts: row.totalConflicts,
      uploadedAt: row.uploadedAt,
      processedAt: row.processedAt,
    }));
  } catch {
    return [];
  }
}

export async function importVisitDefinitions(
  targetStudyId: number,
  visitDefinitions: VisitDefinition[],
  formRefToCrfId: Map<string, number>,
  userId: number
): Promise<ImportVisitResult> {
  const client = await pool.connect();
  const warnings: string[] = [];
  const createdEvents: CreatedEvent[] = [];

  try {
    await client.query('BEGIN');

    const parentCheck = await client.query(
      `SELECT COALESCE(parent_study_id, study_id) AS parent_study_id FROM study WHERE study_id = $1`,
      [targetStudyId]
    );
    const resolvedStudyId = parentCheck.rows.length > 0
      ? parentCheck.rows[0].parentStudyId
      : targetStudyId;

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

      const eventDefId = eventResult.rows[0].studyEventDefinitionId;
      createdEvents.push({ name: visit.name || `Visit ${visit.ordinal || 1}`, eventDefId });

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
            if (lookup.rows.length > 0) crfId = lookup.rows[0].crfId;
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
          if (vr.rows.length > 0) defaultVersionId = vr.rows[0].crfVersionId;

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

    return { createdEvents, warnings };
  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error('[protocol-parse] Visit definition import failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}
