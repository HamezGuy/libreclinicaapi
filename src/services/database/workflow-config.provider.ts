/**
 * Workflow Config Provider
 *
 * Single source of truth for workflow configuration lookups.
 * Any service, DTO, or controller that needs to know whether a form
 * requires SDV / Signature / DDE, or where to route queries, MUST
 * import from this module instead of querying acc_form_workflow_config
 * directly.
 *
 * Callers:
 *   - validation-rules.service.ts  (query assignment on rule failure)
 *   - query.service.ts             (manual query assignment)
 *   - workflow.service.ts          (CRF lifecycle status)
 *   - form.service.ts              (post-save warning queries)
 *
 * Database table: acc_form_workflow_config
 *   crf_id                 int   — form template
 *   study_id               int?  — study-specific override (NULL = global)
 *   requires_sdv           bool
 *   requires_signature     bool
 *   requires_dde           bool
 *   query_route_to_users   text  — JSON array of usernames
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ─── Public Interface ────────────────────────────────────────────────────────

export interface FormWorkflowConfig {
  crfId: number;
  studyId?: number;
  requiresSDV: boolean;
  requiresSignature: boolean;
  requiresDDE: boolean;
  queryRouteToUsers: string[];
  queryRouteToUserIds: number[];
}

const DEFAULT_CONFIG: Omit<FormWorkflowConfig, 'crfId'> = {
  requiresSDV: false,
  requiresSignature: false,
  requiresDDE: false,
  queryRouteToUsers: [],
  queryRouteToUserIds: [],
};

// ─── Table-existence guard ───────────────────────────────────────────────────
// The custom table may not exist in freshly-migrated LibreClinica instances.
// We cache the check so it runs at most once per process lifetime.

let _tableExists: boolean | null = null;

async function ensureTable(): Promise<boolean> {
  if (_tableExists !== null) return _tableExists;
  try {
    const res = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'acc_form_workflow_config'
      ) AS exists
    `);
    _tableExists = res.rows[0].exists;
  } catch {
    _tableExists = false;
  }
  return _tableExists;
}

// ─── Core lookup ─────────────────────────────────────────────────────────────

/**
 * Load the full workflow configuration for a form.
 * Study-specific rows take precedence over global (study_id IS NULL) rows.
 */
export async function getFormWorkflowConfig(
  crfId: number,
  studyId?: number
): Promise<FormWorkflowConfig> {
  if (!(await ensureTable())) {
    return { crfId, ...DEFAULT_CONFIG };
  }

  try {
    const configResult = await pool.query(`
      SELECT requires_sdv, requires_signature, requires_dde, query_route_to_users
      FROM acc_form_workflow_config
      WHERE crf_id = $1
        AND (study_id = $2 OR study_id IS NULL)
      ORDER BY study_id DESC NULLS LAST
      LIMIT 1
    `, [crfId, studyId || null]);

    if (configResult.rows.length === 0) {
      return { crfId, studyId, ...DEFAULT_CONFIG };
    }

    const row = configResult.rows[0];

    let queryRouteToUsers: string[] = [];
    try {
      const raw = row.query_route_to_users;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) queryRouteToUsers = parsed;
      }
    } catch { /* ignore parse errors */ }

    let queryRouteToUserIds: number[] = [];
    if (queryRouteToUsers.length > 0) {
      try {
        const userResult = await pool.query(
          `SELECT user_id FROM user_account WHERE user_name = ANY($1) AND enabled = true`,
          [queryRouteToUsers]
        );
        queryRouteToUserIds = userResult.rows.map((r: any) => r.user_id);
      } catch { /* ignore */ }
    }

    return {
      crfId,
      studyId,
      requiresSDV: !!row.requires_sdv,
      requiresSignature: !!row.requires_signature,
      requiresDDE: !!row.requires_dde,
      queryRouteToUsers,
      queryRouteToUserIds,
    };
  } catch (e: any) {
    logger.warn('getFormWorkflowConfig failed, returning defaults', { crfId, error: e.message });
    return { crfId, studyId, ...DEFAULT_CONFIG };
  }
}

// ─── Query Assignee Resolution ───────────────────────────────────────────────

/**
 * Resolve the user_id that queries for a given form should be assigned to.
 *
 * Priority:
 *   1. Workflow config  (acc_form_workflow_config.query_route_to_users)
 *   2. Default study role-based assignee (coordinator / data manager)
 *
 * @param crfId      CRF template ID (may be undefined — will be resolved from eventCrfId)
 * @param studyId    Study for study-specific config override
 * @param eventCrfId Form instance — used to resolve crfId when not provided
 * @param subjectId  study_subject_id — currently unused, reserved for site-level routing
 */
export async function resolveQueryAssignee(
  crfId?: number,
  studyId?: number,
  eventCrfId?: number,
  subjectId?: number
): Promise<number | null> {
  try {
    // Resolve crfId from eventCrfId if needed
    let resolvedCrfId = crfId;
    if (!resolvedCrfId && eventCrfId) {
      const ecResult = await pool.query(`
        SELECT cv.crf_id FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.event_crf_id = $1
      `, [eventCrfId]);
      if (ecResult.rows.length > 0) {
        resolvedCrfId = ecResult.rows[0].crf_id;
      }
    }

    if (resolvedCrfId) {
      const config = await getFormWorkflowConfig(resolvedCrfId, studyId);
      if (config.queryRouteToUserIds.length > 0) {
        logger.info('Workflow-assigned query to user', {
          crfId: resolvedCrfId,
          usernames: config.queryRouteToUsers,
          userId: config.queryRouteToUserIds[0],
        });
        return config.queryRouteToUserIds[0];
      }
    }

    // Fall through to default role-based assignment
    if (studyId) {
      return resolveDefaultAssignee(studyId, subjectId);
    }

    return null;
  } catch (e: any) {
    logger.warn('resolveQueryAssignee failed', { error: e.message });
    return null;
  }
}

/**
 * Resolve all user_ids that queries for a given form should go to.
 * The first entry is the primary assignee; the rest are additional
 * assignees who should receive child query notes.
 */
export async function resolveAllQueryAssignees(
  crfId?: number,
  studyId?: number,
  eventCrfId?: number
): Promise<{ primaryUserId: number | null; additionalUserIds: number[] }> {
  let resolvedCrfId = crfId;
  if (!resolvedCrfId && eventCrfId) {
    try {
      const ecResult = await pool.query(`
        SELECT cv.crf_id FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.event_crf_id = $1
      `, [eventCrfId]);
      if (ecResult.rows.length > 0) resolvedCrfId = ecResult.rows[0].crf_id;
    } catch { /* ignore */ }
  }

  if (resolvedCrfId) {
    const config = await getFormWorkflowConfig(resolvedCrfId, studyId);
    if (config.queryRouteToUserIds.length > 0) {
      return {
        primaryUserId: config.queryRouteToUserIds[0],
        additionalUserIds: config.queryRouteToUserIds.slice(1),
      };
    }
  }

  const fallback = studyId ? await resolveDefaultAssignee(studyId) : null;
  return { primaryUserId: fallback, additionalUserIds: [] };
}

// ─── Default Assignee ────────────────────────────────────────────────────────

/**
 * Find a default user to assign queries to based on study roles.
 *
 * Priority:
 *   1. Study Coordinator
 *   2. Clinical Research Coordinator
 *   3. Data Manager
 *   4. Any active study user (fallback)
 */
export async function resolveDefaultAssignee(
  studyId: number,
  _subjectId?: number
): Promise<number | null> {
  try {
    const result = await pool.query(`
      SELECT user_id FROM (
        SELECT ua.user_id,
          CASE
            WHEN sur.role_name = 'Study Coordinator' THEN 1
            WHEN sur.role_name = 'Clinical Research Coordinator' THEN 2
            WHEN sur.role_name = 'Data Manager' THEN 3
            ELSE 4
          END as role_priority
        FROM user_account ua
        INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
        WHERE sur.study_id = $1
          AND sur.status_id = 1
          AND sur.role_name IN ('Study Coordinator', 'Clinical Research Coordinator', 'Data Manager', 'coordinator')
        ORDER BY role_priority
        LIMIT 1
      ) ranked
    `, [studyId]);

    if (result.rows.length > 0) return result.rows[0].user_id;

    const fallbackResult = await pool.query(`
      SELECT ua.user_id
      FROM user_account ua
      INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
      WHERE sur.study_id = $1 AND sur.status_id = 1 AND ua.enabled = true
      LIMIT 1
    `, [studyId]);

    return fallbackResult.rows.length > 0 ? fallbackResult.rows[0].user_id : null;
  } catch (e: any) {
    logger.warn('resolveDefaultAssignee failed', { error: e.message, studyId });
    return null;
  }
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Check whether a specific workflow step is required for a form.
 */
export async function needsWorkflowStep(
  crfId: number,
  step: 'sdv' | 'signature' | 'dde',
  studyId?: number
): Promise<boolean> {
  const config = await getFormWorkflowConfig(crfId, studyId);
  switch (step) {
    case 'sdv': return config.requiresSDV;
    case 'signature': return config.requiresSignature;
    case 'dde': return config.requiresDDE;
  }
}
