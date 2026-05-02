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
import { FormWorkflowConfig } from '@accura-trial/shared-types';

// ─── Public Interface ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Omit<FormWorkflowConfig, 'crfId'> = {
  requiresSdv: false,
  requiresSignature: false,
  requiresDde: false,
  autoQueryRouting: false,
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
    _tableExists = res.rows[0].exists;  } catch {
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
      const raw = row.queryRouteToUsers;
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
        queryRouteToUserIds = userResult.rows.map((r: any) => r.userId);
      } catch { /* ignore */ }
    }

    return {
      crfId,
      studyId,
      requiresSdv: !!row.requiresSdv,
      requiresSignature: !!row.requiresSignature,
      requiresDde: !!row.requiresDde,
      autoQueryRouting: !!row.autoQueryRouting,
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
        resolvedCrfId = ecResult.rows[0].crfId;
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
      if (ecResult.rows.length > 0) resolvedCrfId = ecResult.rows[0].crfId;
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
 * In clinical trials, queries flow: Monitor/CRA raises → Site responds → Monitor closes.
 * For automatically generated queries (validation failures), the query needs to go to
 * the site user who can investigate and correct the data. For manual queries raised by
 * monitors, the query goes to the site coordinator/investigator.
 *
 * Priority (site-side respondent):
 *   1. Site coordinator / CRC (they do day-to-day data management)
 *   2. Data entry person / RA (they entered the data)
 *   3. Investigator (PI signs off, may need to clarify clinical data)
 *   4. Data Manager (escalation if no site staff found)
 *   5. Monitor (fallback — typically monitors raise, not receive queries)
 *   6. Any active study user (absolute fallback)
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
            WHEN sur.role_name IN ('coordinator', 'Clinical Research Coordinator', 'crc', 'study_coordinator', 'site_study_coordinator', 'Study Coordinator') THEN 1
            WHEN sur.role_name IN ('data_entry_person', 'site_data_entry_person', 'site_data_entry_person2', 'ra', 'ra2') THEN 2
            WHEN sur.role_name IN ('investigator', 'Investigator', 'site_investigator') THEN 3
            WHEN sur.role_name IN ('data_manager', 'Data Manager', 'director', 'study_director', 'site_study_director') THEN 4
            WHEN sur.role_name IN ('monitor', 'site_monitor') THEN 5
            WHEN sur.role_name ILIKE '%coordinator%' THEN 6
            WHEN sur.role_name ILIKE '%manager%' THEN 7
            WHEN sur.role_name ILIKE '%monitor%' THEN 8
            ELSE 9
          END as role_priority
        FROM user_account ua
        INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
        WHERE sur.study_id = $1
          AND sur.status_id = 1
          AND ua.enabled = true
          AND (
            sur.role_name IN (
              'admin', 'data_manager', 'coordinator', 'investigator', 'monitor',
              'Study Coordinator', 'Clinical Research Coordinator', 'Data Manager',
              'Investigator', 'site_monitor', 'site_investigator',
              'study_coordinator', 'site_study_coordinator', 'director',
              'study_director', 'site_study_director',
              'crc', 'ra', 'ra2', 'data_entry_person',
              'site_data_entry_person', 'site_data_entry_person2'
            )
            OR sur.role_name ILIKE '%coordinator%'
            OR sur.role_name ILIKE '%manager%'
            OR sur.role_name ILIKE '%monitor%'
          )
        ORDER BY role_priority
        LIMIT 1
      ) ranked
    `, [studyId]);

    if (result.rows.length > 0) return result.rows[0].userId;

    const fallbackResult = await pool.query(`
      SELECT ua.user_id
      FROM user_account ua
      INNER JOIN study_user_role sur ON ua.user_name = sur.user_name
      WHERE sur.study_id = $1 AND sur.status_id = 1 AND ua.enabled = true
      ORDER BY ua.user_id DESC
      LIMIT 1
    `, [studyId]);

    return fallbackResult.rows.length > 0 ? fallbackResult.rows[0].userId : null;
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
    case 'sdv': return config.requiresSdv;
    case 'signature': return config.requiresSignature;
    case 'dde': return config.requiresDde;
  }
}

// ─── Route-facing helpers ────────────────────────────────────────────────────

function parseRouteUsers(row: any): string[] {
  try {
    const raw = row.queryRouteToUsers;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore parse errors */ }
  return [];
}

const DEFAULT_ROUTE_CONFIG = { requiresSDV: false, requiresSignature: false, requiresDDE: false, queryRouteToUsers: [] as string[] };

/**
 * Get workflow configuration for ALL forms (bulk).
 * Study-specific rows override global ones.
 */
export async function getAllWorkflowConfigs(
  studyId?: number | null
): Promise<Record<string, { requiresSDV: boolean; requiresSignature: boolean; requiresDDE: boolean; queryRouteToUsers: string[] }>> {
  if (!(await ensureTable())) return {};

  let result;
  if (studyId) {
    result = await pool.query(`
      SELECT crf_id, requires_sdv, requires_signature, requires_dde, query_route_to_users
      FROM acc_form_workflow_config
      WHERE study_id = $1 OR study_id IS NULL
      ORDER BY crf_id, study_id DESC NULLS LAST
    `, [studyId]);
  } else {
    result = await pool.query(`
      SELECT crf_id, requires_sdv, requires_signature, requires_dde, query_route_to_users
      FROM acc_form_workflow_config
      WHERE study_id IS NULL
      ORDER BY crf_id
    `);
  }

  const configMap: Record<string, any> = {};
  for (const row of result.rows) {
    if (configMap[String(row.crfId)]) continue;
    configMap[String(row.crfId)] = {
      requiresSDV: row.requiresSdv,
      requiresSignature: row.requiresSignature,
      requiresDDE: row.requiresDde,
      queryRouteToUsers: parseRouteUsers(row)
    };
  }
  return configMap;
}

/**
 * Get workflow configuration for a single form (by CRF ID).
 * Returns the default config if the table doesn't exist or no row is found.
 */
export async function getSingleWorkflowConfig(
  crfId: number,
  studyId?: number | null
): Promise<{ requiresSDV: boolean; requiresSignature: boolean; requiresDDE: boolean; queryRouteToUsers: string[] }> {
  if (!(await ensureTable())) return { ...DEFAULT_ROUTE_CONFIG };

  const result = await pool.query(`
    SELECT requires_sdv, requires_signature, requires_dde, query_route_to_users
    FROM acc_form_workflow_config
    WHERE crf_id = $1 AND (study_id = $2 OR study_id IS NULL)
    ORDER BY study_id DESC NULLS LAST
    LIMIT 1
  `, [crfId, studyId || null]);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      requiresSDV: row.requiresSdv,
      requiresSignature: row.requiresSignature,
      requiresDDE: row.requiresDde,
      queryRouteToUsers: parseRouteUsers(row)
    };
  }
  return { ...DEFAULT_ROUTE_CONFIG };
}

/**
 * Save (upsert) workflow configuration for a form.
 */
export async function saveWorkflowConfig(
  crfId: number,
  config: { requiresSDV?: boolean; requiresSignature?: boolean; requiresDDE?: boolean; queryRouteToUsers?: string[]; studyId?: number | null },
  userId: number
): Promise<void> {
  const usersJson = JSON.stringify(config.queryRouteToUsers || []);
  const resolvedStudyId = config.studyId || null;

  await pool.query(`
    INSERT INTO acc_form_workflow_config
      (crf_id, study_id, requires_sdv, requires_signature, requires_dde, query_route_to_users, updated_by, date_updated)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (crf_id, COALESCE(study_id, 0))
    DO UPDATE SET
      requires_sdv = EXCLUDED.requires_sdv,
      requires_signature = EXCLUDED.requires_signature,
      requires_dde = EXCLUDED.requires_dde,
      query_route_to_users = EXCLUDED.query_route_to_users,
      updated_by = EXCLUDED.updated_by,
      date_updated = NOW()
  `, [crfId, resolvedStudyId, config.requiresSDV || false, config.requiresSignature || false, config.requiresDDE || false, usersJson, userId]);
}
