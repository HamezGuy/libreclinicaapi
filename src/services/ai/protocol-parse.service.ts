/**
 * Protocol Parse Service — Async Job-Based
 * 
 * The Python pipeline is now async:
 *   POST /parse → returns { job_id } immediately
 *   GET /jobs/{job_id} → poll for status
 *   GET /jobs/{job_id}/result → get results when complete
 */

import { logger } from '../../config/logger';

const PIPELINE_URL = process.env.PROTOCOL_PIPELINE_URL || 'http://localhost:8100';
const PIPELINE_TIMEOUT_MS = parseInt(process.env.PROTOCOL_PIPELINE_TIMEOUT_MS || '30000', 10);

export interface SubmitResult {
  jobId: string;
  status: string;
  message: string;
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
