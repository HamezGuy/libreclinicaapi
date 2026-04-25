/**
 * Data Locks Service
 * Uses event_crf.status_id = 6 (locked) from LibreClinica
 * 
 * Lock Status IDs in LibreClinica:
 * 1 = available (unlocked, can be edited)
 * 2 = unavailable (data complete)
 * 3 = private
 * 4 = pending
 * 5 = removed
 * 6 = locked (data locked — permanent)
 * 7 = auto-removed
 * 
 * FREEZE:
 * Freeze is a two-stage protection step BEFORE lock.  A frozen form cannot be
 * edited by CRCs, but can be unfrozen by a DM/admin.  Lock is permanent (only
 * admin can unlock).  We use a separate `frozen` boolean on event_crf (added
 * via migration) rather than a new status_id, because the status table is
 * shared with LibreClinica core.
 * 
 * Lifecycle:  Available → Frozen → Locked
 * 
 * Data Locking Process (21 CFR Part 11 Compliant):
 * 1. All queries must be closed
 * 2. All required forms must be completed
 * 3. Electronic signature required
 * 4. Audit trail is maintained
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import type {
  LockEligibility,
  SanitationReport,
  SanitationSubjectRow,
  StudyLockStatus,
  CasebookReadiness,
  LockHistory,
} from '@accura-trial/shared-types';

export type { LockEligibility, SanitationReport, SanitationSubjectRow, StudyLockStatus, CasebookReadiness, LockHistory };

type LockHistoryEntry = LockHistory;

// ═══════════════════════════════════════════════════════════════════
// LOCK ELIGIBILITY CHECKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a subject's data is eligible for locking
 * Validates:
 * - All queries are closed (resolution_status_id = 4 means closed)
 * - All required forms are complete (status_id in (2, 6) = data complete or already locked)
 */
export const checkSubjectLockEligibility = async (studySubjectId: number, client?: any): Promise<LockEligibility> => {
  logger.info('Checking lock eligibility for subject', { studySubjectId });

  const queryRunner = client || pool;

  try {
    // Get open queries for this subject
    // Count open queries for this subject via ALL mapping tables.
    // Queries can be linked to a form (dn_event_crf_map), a field (dn_item_data_map),
    // or the subject directly (dn_study_subject_map).  Previous code only checked
    // entity_id directly on discrepancy_note which is not how createQuery stores them.
    const openQueriesQuery = `
      SELECT COUNT(DISTINCT dn.discrepancy_note_id) as count
      FROM discrepancy_note dn
      WHERE dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM dn_event_crf_map dem
            INNER JOIN event_crf ec ON dem.event_crf_id = ec.event_crf_id
            INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
            WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
              AND se.study_subject_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM dn_item_data_map dim
            INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
            INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
            INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
            WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
              AND se.study_subject_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM dn_study_subject_map dssm
            WHERE dssm.discrepancy_note_id = dn.discrepancy_note_id
              AND dssm.study_subject_id = $1
          )
        )
    `;
    const openQueriesResult = await queryRunner.query(openQueriesQuery, [studySubjectId]);
    const openQueries = parseInt(openQueriesResult.rows[0]?.count || '0');

    // Get form completion status (with FOR UPDATE when inside a transaction)
    const forUpdateClause = client ? 'FOR UPDATE OF ec' : '';
    const formsQuery = `
      SELECT 
        COUNT(*) as total_forms,
        COUNT(CASE WHEN ec.completion_status_id >= 4 OR ec.status_id IN (2, 6) THEN 1 END) as completed_forms,
        COUNT(CASE WHEN ec.completion_status_id < 4 AND ec.status_id NOT IN (2, 6) THEN 1 END) as incomplete_forms
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.status_id != 5  -- Exclude removed
        AND ec.status_id != 7  -- Exclude auto-removed
      ${forUpdateClause}
    `;
    const formsResult = await queryRunner.query(formsQuery, [studySubjectId]);
    const totalForms = parseInt(formsResult.rows[0]?.totalForms || '0');
    const completedForms = parseInt(formsResult.rows[0]?.completedForms || '0');
    const incompleteForms = parseInt(formsResult.rows[0]?.incompleteForms || '0');

    // Get SDV status (if SDV is enabled - check for acc_sdv_status table)
    let pendingSDV = 0;
    try {
      const sdvQuery = `
        SELECT COUNT(*) as count
        FROM acc_sdv_status sdv
        INNER JOIN event_crf ec ON sdv.event_crf_id = ec.event_crf_id
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        WHERE se.study_subject_id = $1
          AND sdv.sdv_status = 'pending'
      `;
      const sdvResult = await queryRunner.query(sdvQuery, [studySubjectId]);
      pendingSDV = parseInt(sdvResult.rows[0]?.count || '0');
    } catch (sdvError) {
      logger.debug('SDV table not found, skipping SDV check');
    }

    // Build reasons array
    const reasons: string[] = [];
    if (openQueries > 0) {
      reasons.push(`${openQueries} open ${openQueries === 1 ? 'query' : 'queries'} must be resolved`);
    }
    if (incompleteForms > 0) {
      reasons.push(`${incompleteForms} ${incompleteForms === 1 ? 'form' : 'forms'} not completed`);
    }
    if (pendingSDV > 0) {
      reasons.push(`${pendingSDV} ${pendingSDV === 1 ? 'form' : 'forms'} pending SDV`);
    }

    const canLock = openQueries === 0 && incompleteForms === 0;

    return {
      canLock,
      reasons,
      openQueries,
      incompleteForms,
      totalForms,
      completedForms,
      pendingSDV,
      studySubjectId
    };
  } catch (error: any) {
    logger.error('Check lock eligibility error', { studySubjectId, error: error.message });
    throw error;
  }
};

/**
 * Check if a specific study event (visit) is eligible for locking
 */
export const checkEventLockEligibility = async (studyEventId: number, client?: any): Promise<LockEligibility> => {
  logger.info('Checking lock eligibility for event', { studyEventId });

  const queryRunner = client || pool;

  try {
    // Get subject ID for this event
    const subjectQuery = `SELECT study_subject_id FROM study_event WHERE study_event_id = $1`;
    const subjectResult = await queryRunner.query(subjectQuery, [studyEventId]);
    const subjectId = subjectResult.rows[0]?.studySubjectId;

    // Count open queries for this event via ALL mapping tables
    const openQueriesQuery = `
      SELECT COUNT(DISTINCT dn.discrepancy_note_id) as count
      FROM discrepancy_note dn
      WHERE dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM dn_event_crf_map dem
            INNER JOIN event_crf ec ON dem.event_crf_id = ec.event_crf_id
            WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
              AND ec.study_event_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM dn_item_data_map dim
            INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
            INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
            WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
              AND ec.study_event_id = $1
          )
        )
    `;
    const openQueriesResult = await queryRunner.query(openQueriesQuery, [studyEventId]);
    const openQueries = parseInt(openQueriesResult.rows[0]?.count || '0');

    // Get form completion status for this event (with FOR UPDATE when inside a transaction)
    const forUpdateClause = client ? 'FOR UPDATE OF ec' : '';
    const formsQuery = `
      SELECT 
        COUNT(*) as total_forms,
        COUNT(CASE WHEN ec.completion_status_id >= 4 OR ec.status_id IN (2, 6) THEN 1 END) as completed_forms,
        COUNT(CASE WHEN ec.completion_status_id < 4 AND ec.status_id NOT IN (2, 6) THEN 1 END) as incomplete_forms
      FROM event_crf ec
      WHERE ec.study_event_id = $1
        AND ec.status_id NOT IN (5, 7)
      ${forUpdateClause}
    `;
    const formsResult = await queryRunner.query(formsQuery, [studyEventId]);
    const totalForms = parseInt(formsResult.rows[0]?.totalForms || '0');
    const completedForms = parseInt(formsResult.rows[0]?.completedForms || '0');
    const incompleteForms = parseInt(formsResult.rows[0]?.incompleteForms || '0');

    const reasons: string[] = [];
    if (openQueries > 0) {
      reasons.push(`${openQueries} open ${openQueries === 1 ? 'query' : 'queries'} must be resolved`);
    }
    if (incompleteForms > 0) {
      reasons.push(`${incompleteForms} ${incompleteForms === 1 ? 'form' : 'forms'} not completed`);
    }

    const canLock = openQueries === 0 && incompleteForms === 0;

    return {
      canLock,
      reasons,
      openQueries,
      incompleteForms,
      totalForms,
      completedForms,
      pendingSDV: 0,
      studySubjectId: subjectId,
      studyEventId
    };
  } catch (error: any) {
    logger.error('Check event lock eligibility error', { studyEventId, error: error.message });
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════════
// LOCK SUBJECT DATA
// ═══════════════════════════════════════════════════════════════════

/**
 * Lock all data for a subject (all event CRFs)
 * Validates eligibility before locking
 */
export const lockSubjectData = async (
  studySubjectId: number, 
  userId: number, 
  reason: string,
  skipValidation: boolean = false
): Promise<{ success: boolean; message: string; lockedCount?: number; eligibility?: LockEligibility }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check eligibility inside the transaction (unless skipped by admin)
    const eligibility = await checkSubjectLockEligibility(studySubjectId, client);
    
    if (!skipValidation && !eligibility.canLock) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Cannot lock data: ${eligibility.reasons.join('; ')}`,
        eligibility
      };
    }

    // Lock all event CRFs for this subject
    const lockQuery = `
      UPDATE event_crf ec
      SET status_id = 6, update_id = $2, date_updated = CURRENT_TIMESTAMP
      FROM study_event se
      WHERE ec.study_event_id = se.study_event_id
        AND se.study_subject_id = $1
        AND ec.status_id != 6
        AND ec.status_id NOT IN (5, 7)
      RETURNING ec.event_crf_id
    `;
    const lockResult = await client.query(lockQuery, [studySubjectId, userId]);
    const lockedCount = lockResult.rowCount || 0;

    // Sync patient_event_form for all locked forms
    if (lockedCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_locked = true, is_frozen = false
        FROM event_crf ec
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        WHERE pef.event_crf_id = ec.event_crf_id
          AND se.study_subject_id = $1
          AND ec.status_id = 6
      `, [studySubjectId]);
    }

    // Get subject label for audit log
    const subjectQuery = `SELECT label FROM study_subject WHERE study_subject_id = $1`;
    const subjectResult = await client.query(subjectQuery, [studySubjectId]);
    const subjectLabel = subjectResult.rows[0]?.label || studySubjectId;

    // Audit log
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'study_subject', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, studySubjectId, `Subject ${subjectLabel} data locked`, reason]);

    await client.query('COMMIT');

    logger.info('Subject data locked', { studySubjectId, userId, lockedCount });

    return {
      success: true,
      message: `Successfully locked ${lockedCount} forms for subject ${subjectLabel}`,
      lockedCount,
      eligibility
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Lock subject data error', { studySubjectId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Lock data for a specific study event (visit)
 */
export const lockEventData = async (
  studyEventId: number,
  userId: number,
  reason: string,
  skipValidation: boolean = false
): Promise<{ success: boolean; message: string; lockedCount?: number; eligibility?: LockEligibility }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const eligibility = await checkEventLockEligibility(studyEventId, client);

    if (!skipValidation && !eligibility.canLock) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Cannot lock data: ${eligibility.reasons.join('; ')}`,
        eligibility
      };
    }

    // Lock all event CRFs for this event
    const lockQuery = `
      UPDATE event_crf
      SET status_id = 6, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE study_event_id = $1
        AND status_id != 6
        AND status_id NOT IN (5, 7)
      RETURNING event_crf_id
    `;
    const lockResult = await client.query(lockQuery, [studyEventId, userId]);
    const lockedCount = lockResult.rowCount || 0;

    // Sync patient_event_form for all locked forms
    if (lockedCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_locked = true, is_frozen = false
        FROM event_crf ec
        WHERE pef.event_crf_id = ec.event_crf_id
          AND ec.study_event_id = $1
          AND ec.status_id = 6
      `, [studyEventId]);
    }

    // Get event name for audit
    const eventQuery = `
      SELECT sed.name, ss.label as subject_label
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE se.study_event_id = $1
    `;
    const eventResult = await client.query(eventQuery, [studyEventId]);
    const eventName = eventResult.rows[0]?.name || studyEventId;
    const subjectLabel = eventResult.rows[0]?.subjectLabel;

    // Audit log
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'study_event', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, studyEventId, `Event ${eventName} data locked for ${subjectLabel}`, reason]);

    await client.query('COMMIT');

    return {
      success: true,
      message: `Successfully locked ${lockedCount} forms for event ${eventName}`,
      lockedCount,
      eligibility
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unlock all data for a subject (requires admin + reason)
 */
export const unlockSubjectData = async (
  studySubjectId: number,
  userId: number,
  reason: string
): Promise<{ success: boolean; message: string; unlockedCount?: number }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire row locks on all locked event_crf rows for this subject
    await client.query(`
      SELECT ec.event_crf_id
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.status_id = 6
      FOR UPDATE OF ec
    `, [studySubjectId]);

    // Unlock all event CRFs
    const unlockQuery = `
      UPDATE event_crf ec
      SET status_id = 2, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
      FROM study_event se
      WHERE ec.study_event_id = se.study_event_id
        AND se.study_subject_id = $1
        AND ec.status_id = 6
      RETURNING ec.event_crf_id
    `;
    const unlockResult = await client.query(unlockQuery, [studySubjectId, userId]);
    const unlockedCount = unlockResult.rowCount || 0;

    // Sync patient_event_form for all unlocked forms
    if (unlockedCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_locked = false, is_frozen = false
        FROM event_crf ec
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        WHERE pef.event_crf_id = ec.event_crf_id
          AND se.study_subject_id = $1
      `, [studySubjectId]);
    }

    // Get subject label
    const subjectQuery = `SELECT label FROM study_subject WHERE study_subject_id = $1`;
    const subjectResult = await client.query(subjectQuery, [studySubjectId]);
    const subjectLabel = subjectResult.rows[0]?.label || studySubjectId;

    // Audit log
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'study_subject', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, studySubjectId, `Subject ${subjectLabel} data UNLOCKED`, reason]);

    await client.query('COMMIT');

    return {
      success: true,
      message: `Successfully unlocked ${unlockedCount} forms for subject ${subjectLabel}`,
      unlockedCount
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// EXISTING FUNCTIONS (Enhanced)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get lock/freeze status for a single event CRF record.
 * Returns locked, frozen, and sdv_status flags for the given form.
 */
export const getRecordLockStatus = async (eventCrfId: number): Promise<{
  eventCrfId: number;
  locked: boolean;
  frozen: boolean;
  sdvVerified: boolean;
  statusId: number;
}> => {
  const result = await pool.query(
    `SELECT ec.event_crf_id, ec.status_id,
            COALESCE(ec.frozen, false) AS frozen,
            COALESCE(ec.sdv_status, false) AS sdv_status
     FROM event_crf ec
     WHERE ec.event_crf_id = $1`,
    [eventCrfId]
  );

  if (!result.rows.length) {
    return { eventCrfId, locked: false, frozen: false, sdvVerified: false, statusId: 0 };
  }

  const row = result.rows[0];
  return {
    eventCrfId,
    locked: row.statusId === 6,
    frozen: row.frozen === true,
    sdvVerified: row.sdvStatus === true,
    statusId: row.statusId
  };
};

export const getLockedRecords = async (filters: {
  studyId?: number;
  subjectId?: number;
  page?: number;
  limit?: number;
}) => {
  logger.info('Getting locked records', filters);

  try {
    const { studyId, subjectId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    let whereClause = 'ec.status_id = 6';
    const params: any[] = [];
    let paramIndex = 1;

    if (studyId) {
      whereClause += ` AND ss.study_id = $${paramIndex}`;
      params.push(studyId);
      paramIndex++;
    }

    if (subjectId) {
      whereClause += ` AND ss.study_subject_id = $${paramIndex}`;
      params.push(subjectId);
      paramIndex++;
    }

    const query = `
      SELECT 
        ec.event_crf_id,
        ec.status_id,
        st.name as status_name,
        ec.date_updated as lock_date,
        ss.study_subject_id,
        ss.label as subject_label,
        se.study_event_id,
        sed.name as event_name,
        c.name as crf_name,
        locker.user_name as locked_by
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN status st ON ec.status_id = st.status_id
      LEFT JOIN user_account locker ON ec.update_id = locker.user_id
      WHERE ${whereClause}
      ORDER BY ec.date_updated DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);
    const result = await pool.query(query, params);

    // Get total count for pagination — reuse the same WHERE clause as the data query
    const countParams = params.slice(0, -2); // exclude LIMIT/OFFSET
    const countQuery = `
      SELECT COUNT(*) as total
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    return {
      success: true,
      data: result.rows.map((row: any) => ({
        ...row,
        locked: true,
        lock_date: row.lockDate,
        locked_by_name: row.lockedBy
      })),
      pagination: {
        page,
        limit,
        total
      }
    };
  } catch (error: any) {
    logger.error('Get locked records error', { error: error.message });
    throw error;
  }
};

/**
 * Lock a single CRF record.
 * 
 * WORKFLOW ENFORCEMENT: Before locking, checks the acc_form_workflow_config
 * to ensure all required workflow steps have been completed:
 * - SDV must be done if requiresSDV=true
 * - PI signature must be applied if requiresSignature=true
 * - DDE must be completed if requiresDDE=true  
 * - All open queries must be resolved
 */
export const lockRecord = async (eventCrfId: number, userId: number, reason?: string) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Load the event_crf and its workflow config
    const ecResult = await client.query(`
      SELECT 
        ec.event_crf_id, ec.status_id, ec.completion_status_id,
        COALESCE(ec.sdv_status, false) as sdv_verified,
        COALESCE(ec.electronic_signature_status, false) as is_signed,
        cv.crf_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE ec.event_crf_id = $1
      FOR UPDATE OF ec
    `, [eventCrfId]);

    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error(`CRF instance not found (event_crf_id=${eventCrfId})`);
      (err as any).statusCode = 404;
      throw err;
    }

    const ec = ecResult.rows[0];
    if (ec.statusId === 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record is already locked' };
    }

    // 2. Load workflow requirements
    let requiresSDV = false;
    let requiresSignature = false;
    let requiresDDE = false;
    try {
      const cfgResult = await client.query(`
        SELECT requires_sdv, requires_signature, requires_dde
        FROM acc_form_workflow_config
        WHERE crf_id = $1
        ORDER BY study_id DESC NULLS LAST
        LIMIT 1
      `, [ec.crfId]);
      if (cfgResult.rows.length > 0) {
        requiresSDV = cfgResult.rows[0].requiresSdv;
        requiresSignature = cfgResult.rows[0].requiresSignature;
        requiresDDE = cfgResult.rows[0].requiresDde;
      }
    } catch { /* table may not exist */ }

    // 3. Enforce requirements
    const blockingReasons: string[] = [];

    // Must be at least data_entry_complete (completion_status_id >= 4 or status_id = 2)
    if (ec.completionStatusId < 4 && ec.statusId !== 2) {
      blockingReasons.push('Form must be marked as complete before locking');
    }

    if (requiresSDV && !ec.sdvVerified) {
      blockingReasons.push('Source Data Verification (SDV) is required but not yet completed');
    }

    if (requiresSignature && ec.completionStatusId < 5 && !ec.isSigned) {
      blockingReasons.push('PI electronic signature is required but not yet applied');
    }

    // Check open queries on this CRF — covers both form-level and field-level queries
    const queryResult = await client.query(`
      SELECT dn.discrepancy_note_id, dn.description,
             rs.name AS status_name, dnt.name AS note_type
      FROM discrepancy_note dn
      LEFT JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
      LEFT JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      WHERE dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM dn_event_crf_map dem
            WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
              AND dem.event_crf_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM dn_item_data_map dim
            INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
            WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
              AND id.event_crf_id = $1
          )
        )
      ORDER BY dn.date_created
    `, [eventCrfId]);
    const openQueries = queryResult.rows.length;
    if (openQueries > 0) {
      const queryDetails = queryResult.rows.slice(0, 5).map(
        (q: any) => `#${q.discrepancyNoteId} (${q.statusName || 'open'})`
      ).join(', ');
      const suffix = openQueries > 5 ? ` and ${openQueries - 5} more` : '';
      blockingReasons.push(
        `${openQueries} open ${openQueries === 1 ? 'query' : 'queries'} must be resolved before locking: ${queryDetails}${suffix}`
      );
    }

    if (blockingReasons.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: blockingReasons.join('. '), blockingReasons };
    }

    // 4. Lock the record — also clear the frozen flag so DB state is consistent
    const updateQuery = `
      UPDATE event_crf
      SET status_id = 6, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id != 6
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or already locked' };
    }

    // 5. Sync patient_event_form so lock state is consistent across both tables
    await client.query(`
      UPDATE patient_event_form
      SET is_locked = true, is_frozen = false
      WHERE event_crf_id = $1
    `, [eventCrfId]);

    // 6. Audit log
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Locked', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId, reason || null]);

    await client.query('COMMIT');

    return { success: true, message: 'Record locked successfully' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// BATCH LOCK / UNLOCK
// ═══════════════════════════════════════════════════════════════════

/**
 * Batch lock multiple CRF records.  Validates each before locking.
 * All operations run in a single transaction with SELECT FOR UPDATE to
 * prevent concurrent batch operations from interfering.
 */
export const batchLockRecords = async (
  eventCrfIds: number[],
  userId: number,
  reason?: string
): Promise<{ success: boolean; locked: number; failed: number; errors: string[] }> => {
  logger.info('Batch locking records', { count: eventCrfIds.length, userId });

  if (eventCrfIds.length === 0) {
    return { success: true, locked: 0, failed: 0, errors: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let locked = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const ecId of eventCrfIds) {
      // Lock the row to prevent concurrent modifications
      const ecResult = await client.query(`
        SELECT ec.event_crf_id, ec.status_id, ec.completion_status_id,
               COALESCE(ec.sdv_status, false) as sdv_verified,
               COALESCE(ec.electronic_signature_status, false) as is_signed,
               cv.crf_id
        FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        WHERE ec.event_crf_id = $1
        FOR UPDATE OF ec
      `, [ecId]);

      if (ecResult.rows.length === 0) {
        failed++;
        errors.push(`CRF ${ecId}: not found`);
        continue;
      }

      const ec = ecResult.rows[0];
      if (ec.statusId === 6) {
        errors.push(`CRF ${ecId}: already locked`);
        continue;
      }

      // Must be at least data_entry_complete
      if (ec.completionStatusId < 4 && ec.statusId !== 2) {
        failed++;
        errors.push(`CRF ${ecId}: form must be marked as complete before locking`);
        continue;
      }

      // Check open queries on this CRF
      const queryResult = await client.query(`
        SELECT COUNT(DISTINCT dn.discrepancy_note_id) as cnt
        FROM discrepancy_note dn
        WHERE dn.resolution_status_id NOT IN (4, 5)
          AND dn.parent_dn_id IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM dn_event_crf_map dem
              WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
                AND dem.event_crf_id = $1
            )
            OR EXISTS (
              SELECT 1 FROM dn_item_data_map dim
              INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
              WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
                AND id.event_crf_id = $1
            )
          )
      `, [ecId]);
      const openQueries = parseInt(queryResult.rows[0]?.cnt || '0');
      if (openQueries > 0) {
        failed++;
        errors.push(`CRF ${ecId}: ${openQueries} open queries must be resolved`);
        continue;
      }

      // Lock the record
      await client.query(`
        UPDATE event_crf
        SET status_id = 6, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
        WHERE event_crf_id = $1 AND status_id != 6
      `, [ecId, userId]);

      // Sync patient_event_form
      await client.query(`
        UPDATE patient_event_form
        SET is_locked = true, is_frozen = false
        WHERE event_crf_id = $1
      `, [ecId]);

      // Audit log
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
        VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Locked', $3,
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, ecId, reason || null]);

      locked++;
    }

    await client.query('COMMIT');
    logger.info('Batch lock complete', { locked, failed });
    return { success: failed === 0, locked, failed, errors };
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('Batch lock failed — rolled back', { error: msg });
    return { success: false, locked: 0, failed: eventCrfIds.length, errors: [msg] };
  } finally {
    client.release();
  }
};

/**
 * Batch unlock multiple CRF records.
 * All operations run in a single transaction with SELECT FOR UPDATE.
 */
export const batchUnlockRecords = async (
  eventCrfIds: number[],
  userId: number,
  reason?: string
): Promise<{ success: boolean; unlocked: number; failed: number; errors: string[] }> => {
  logger.info('Batch unlocking records', { count: eventCrfIds.length, userId });

  if (eventCrfIds.length === 0) {
    return { success: true, unlocked: 0, failed: 0, errors: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let unlocked = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const ecId of eventCrfIds) {
      // Lock the row to prevent concurrent modifications
      const ecResult = await client.query(`
        SELECT event_crf_id, status_id FROM event_crf
        WHERE event_crf_id = $1
        FOR UPDATE
      `, [ecId]);

      if (ecResult.rows.length === 0) {
        failed++;
        errors.push(`CRF ${ecId}: not found`);
        continue;
      }

      if (ecResult.rows[0].statusId !== 6) {
        failed++;
        errors.push(`CRF ${ecId}: not locked`);
        continue;
      }

      await client.query(`
        UPDATE event_crf
        SET status_id = 2, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
        WHERE event_crf_id = $1 AND status_id = 6
      `, [ecId, userId]);

      // Sync patient_event_form
      await client.query(`
        UPDATE patient_event_form
        SET is_locked = false, is_frozen = false
        WHERE event_crf_id = $1
      `, [ecId]);

      // Audit log
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
        VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Unlocked', $3,
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, ecId, reason || null]);

      unlocked++;
    }

    await client.query('COMMIT');
    logger.info('Batch unlock complete', { unlocked, failed });
    return { success: failed === 0, unlocked, failed, errors };
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('Batch unlock failed — rolled back', { error: msg });
    return { success: false, unlocked: 0, failed: eventCrfIds.length, errors: [msg] };
  } finally {
    client.release();
  }
};

/**
 * Batch SDV: mark multiple CRF records as source-data-verified.
 * All updates run in a single transaction — partial success is not allowed.
 */
export const batchSDV = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; verified: number; failed: number; errors: string[] }> => {
  logger.info('Batch SDV', { count: eventCrfIds.length, userId });

  if (eventCrfIds.length === 0) {
    return { success: true, verified: 0, failed: 0, errors: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let verified = 0;
    const errors: string[] = [];

    for (const ecId of eventCrfIds) {
      const result = await client.query(`
        UPDATE event_crf SET sdv_status = true, sdv_update_id = $1, date_updated = NOW()
        WHERE event_crf_id = $2 AND (sdv_status IS NULL OR sdv_status = false)
        RETURNING event_crf_id
      `, [userId, ecId]);

      if ((result.rowCount || 0) === 0) {
        // Not an error — already verified or doesn't exist; count it as skipped
        errors.push(`CRF ${ecId}: already verified or not found`);
      } else {
        await client.query(`
          INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
          VALUES (NOW(), 'event_crf', $1, $2, 'SDV Verified (batch)',
            (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
        `, [userId, ecId]);
        verified++;
      }
    }

    await client.query('COMMIT');
    logger.info('Batch SDV complete', { verified, skipped: errors.length });
    return { success: true, verified, failed: 0, errors };
  } catch (e: any) {
    await client.query('ROLLBACK');
    logger.error('Batch SDV failed — rolled back', { error: e.message });
    return { success: false, verified: 0, failed: eventCrfIds.length, errors: [e.message] };
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE  (two-stage protection before lock)
// ═══════════════════════════════════════════════════════════════════

/**
 * Ensure the `frozen` column exists on event_crf (adds it if missing).
 */
const ensureFrozenColumn = async (): Promise<void> => {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'event_crf' AND column_name = 'frozen'
      ) THEN
        ALTER TABLE event_crf ADD COLUMN frozen BOOLEAN NOT NULL DEFAULT false;
      END IF;
    END $$
  `);
};

/**
 * Freeze a single CRF record.
 * Frozen forms cannot be edited by CRCs but can be unfrozen by DM/admin.
 * Validates that the form is complete and all queries are resolved.
 */
export const freezeRecord = async (
  eventCrfId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  await ensureFrozenColumn();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check current state
    const ecResult = await client.query(
      `SELECT status_id, completion_status_id, frozen FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`,
      [eventCrfId]
    );
    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'CRF instance not found' };
    }
    const ec = ecResult.rows[0];
    if (ec.statusId === 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is already locked — cannot freeze a locked form' };
    }
    if (ec.frozen) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is already frozen' };
    }

    // Must be at least data complete
    if (ec.completionStatusId < 4 && ec.statusId !== 2) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form must be marked as complete before freezing' };
    }

    // Check open queries — covers both form-level and field-level queries
    const qResult = await client.query(`
      SELECT COUNT(DISTINCT dn.discrepancy_note_id) as cnt
      FROM discrepancy_note dn
      WHERE dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM dn_event_crf_map dem
            WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
              AND dem.event_crf_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM dn_item_data_map dim
            INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
            WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
              AND id.event_crf_id = $1
          )
        )
    `, [eventCrfId]);
    const openQueries = parseInt(qResult.rows[0]?.cnt || '0');
    if (openQueries > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: `${openQueries} open queries must be resolved before freezing` };
    }

    // Freeze
    await client.query(
      `UPDATE event_crf SET frozen = true, date_updated = NOW(), update_id = $1 WHERE event_crf_id = $2`,
      [userId, eventCrfId]
    );

    // Sync patient_event_form
    await client.query(`
      UPDATE patient_event_form
      SET is_frozen = true
      WHERE event_crf_id = $1
    `, [eventCrfId]);

    // Audit
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (NOW(), 'event_crf', $1, $2, 'Data Frozen',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId]);

    await client.query('COMMIT');
    logger.info('Form frozen', { eventCrfId, userId });
    return { success: true, message: 'Form frozen successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Freeze error', { eventCrfId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unfreeze a frozen CRF record (DM/admin only).
 */
export const unfreezeRecord = async (
  eventCrfId: number,
  userId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  await ensureFrozenColumn();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire row lock to prevent concurrent unfreeze/freeze
    const lockCheck = await client.query(
      `SELECT event_crf_id, frozen, status_id FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`,
      [eventCrfId]
    );
    if (lockCheck.rows.length === 0 || !lockCheck.rows[0].frozen) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is not frozen or not found' };
    }

    await client.query(
      `UPDATE event_crf SET frozen = false, date_updated = NOW(), update_id = $1
       WHERE event_crf_id = $2`,
      [userId, eventCrfId]
    );

    // Sync patient_event_form
    await client.query(`
      UPDATE patient_event_form
      SET is_frozen = false
      WHERE event_crf_id = $1
    `, [eventCrfId]);

    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (NOW(), 'event_crf', $1, $2, 'Data Unfrozen', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId, reason]);

    await client.query('COMMIT');
    logger.info('Form unfrozen', { eventCrfId, userId, reason });
    return { success: true, message: 'Form unfrozen successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Batch freeze multiple CRF records.
 * All operations run in a single transaction with SELECT FOR UPDATE.
 */
export const batchFreezeRecords = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; frozen: number; failed: number; errors: string[] }> => {
  await ensureFrozenColumn();

  if (eventCrfIds.length === 0) {
    return { success: true, frozen: 0, failed: 0, errors: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let frozen = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const ecId of eventCrfIds) {
      // Lock the row to prevent concurrent modifications
      const ecResult = await client.query(
        `SELECT status_id, completion_status_id, frozen FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`,
        [ecId]
      );

      if (ecResult.rows.length === 0) {
        failed++;
        errors.push(`CRF ${ecId}: not found`);
        continue;
      }

      const ec = ecResult.rows[0];
      if (ec.statusId === 6) {
        failed++;
        errors.push(`CRF ${ecId}: already locked — cannot freeze a locked form`);
        continue;
      }
      if (ec.frozen) {
        errors.push(`CRF ${ecId}: already frozen`);
        continue;
      }
      if (ec.completionStatusId < 4 && ec.statusId !== 2) {
        failed++;
        errors.push(`CRF ${ecId}: form must be marked as complete before freezing`);
        continue;
      }

      // Check open queries
      const qResult = await client.query(`
        SELECT COUNT(DISTINCT dn.discrepancy_note_id) as cnt
        FROM discrepancy_note dn
        WHERE dn.resolution_status_id NOT IN (4, 5)
          AND dn.parent_dn_id IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM dn_event_crf_map dem
              WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
                AND dem.event_crf_id = $1
            )
            OR EXISTS (
              SELECT 1 FROM dn_item_data_map dim
              INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
              WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
                AND id.event_crf_id = $1
            )
          )
      `, [ecId]);
      const openQueries = parseInt(qResult.rows[0]?.cnt || '0');
      if (openQueries > 0) {
        failed++;
        errors.push(`CRF ${ecId}: ${openQueries} open queries must be resolved before freezing`);
        continue;
      }

      // Freeze the record
      await client.query(
        `UPDATE event_crf SET frozen = true, date_updated = NOW(), update_id = $1 WHERE event_crf_id = $2`,
        [userId, ecId]
      );

      // Sync patient_event_form
      await client.query(`
        UPDATE patient_event_form
        SET is_frozen = true
        WHERE event_crf_id = $1
      `, [ecId]);

      // Audit log
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
        VALUES (NOW(), 'event_crf', $1, $2, 'Data Frozen',
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, ecId]);

      frozen++;
    }

    await client.query('COMMIT');
    logger.info('Batch freeze complete', { frozen, failed });
    return { success: failed === 0, frozen, failed, errors };
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('Batch freeze failed — rolled back', { error: msg });
    return { success: false, frozen: 0, failed: eventCrfIds.length, errors: [msg] };
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// DATA SANITATION (Study-wide pre-lock quality check)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get a study-wide data quality / sanitation snapshot.
 * Used as the pre-lock checklist before the Data Lock Manager can approve locking.
 */
export const getStudySanitationReport = async (
  studyId: number
): Promise<SanitationReport> => {
  logger.info('Generating sanitation report', { studyId });

  try {
    // Subject counts by status
    const subjectStatusQuery = `
      SELECT
        COUNT(DISTINCT ss.study_subject_id) AS total_subjects,
        COUNT(DISTINCT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id NOT IN (5,7)
          ) THEN ss.study_subject_id END
        ) AS no_data,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id NOT IN (5,7,6,2)
              AND COALESCE(ec2.frozen, false) = false
          ) THEN ss.study_subject_id END
        ) AS in_progress,
        COUNT(DISTINCT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id NOT IN (5,7,6,2)
              AND COALESCE(ec2.frozen, false) = false
          )
          AND EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id IN (2) AND COALESCE(ec2.frozen, false) = false
          ) THEN ss.study_subject_id END
        ) AS complete,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND COALESCE(ec2.frozen, false) = true AND ec2.status_id != 6
          )
          AND NOT EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id NOT IN (5,7,6) AND COALESCE(ec2.frozen, false) = false
              AND ec2.status_id != 2
          ) THEN ss.study_subject_id END
        ) AS frozen,
        COUNT(DISTINCT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id != 6 AND ec2.status_id NOT IN (5,7)
          )
          AND EXISTS (
            SELECT 1 FROM study_event se2
            INNER JOIN event_crf ec2 ON se2.study_event_id = ec2.study_event_id
            WHERE se2.study_subject_id = ss.study_subject_id
              AND ec2.status_id = 6
          ) THEN ss.study_subject_id END
        ) AS locked
      FROM study_subject ss
      WHERE ss.study_id = $1
        AND ss.status_id NOT IN (5, 7)
    `;
    const subjectStatusResult = await pool.query(subjectStatusQuery, [studyId]);
    const s = subjectStatusResult.rows[0] || {};

    const totalSubjects = parseInt(s.totalSubjects || '0');
    const noData = parseInt(s.noData || '0');
    const inProgress = parseInt(s.inProgress || '0');
    const complete = parseInt(s.complete || '0');
    const frozen = parseInt(s.frozen || '0');
    const locked = parseInt(s.locked || '0');

    // Open queries across the study
    const openQueriesResult = await pool.query(`
      SELECT COUNT(DISTINCT dn.discrepancy_note_id) AS cnt
      FROM discrepancy_note dn
      WHERE dn.study_id = $1
        AND dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
    `, [studyId]);
    const openQueriesTotal = parseInt(openQueriesResult.rows[0]?.cnt || '0');

    // Incomplete forms
    const incompleteFormsResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = $1
        AND ec.status_id NOT IN (2, 6, 5, 7)
        AND COALESCE(ec.frozen, false) = false
    `, [studyId]);
    const incompleteFormsTotal = parseInt(incompleteFormsResult.rows[0]?.cnt || '0');

    // Missing required fields (required items with no item_data value)
    const missingFieldsResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN item_form_metadata ifm ON ec.crf_version_id = ifm.crf_version_id
      WHERE ss.study_id = $1
        AND ifm.required = true
        AND ec.status_id NOT IN (5, 7)
        AND NOT EXISTS (
          SELECT 1 FROM item_data id
          WHERE id.item_id = ifm.item_id
            AND id.event_crf_id = ec.event_crf_id
            AND id.value IS NOT NULL
            AND TRIM(id.value) <> ''
        )
    `, [studyId]);
    const missingRequiredFieldsTotal = parseInt(missingFieldsResult.rows[0]?.cnt || '0');

    // Pending SDV
    let pendingSDVTotal = 0;
    try {
      const sdvResult = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM acc_sdv_status sdv
        INNER JOIN event_crf ec ON sdv.event_crf_id = ec.event_crf_id
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        WHERE ss.study_id = $1 AND sdv.sdv_status = 'pending'
      `, [studyId]);
      pendingSDVTotal = parseInt(sdvResult.rows[0]?.cnt || '0');
    } catch { /* SDV table may not exist */ }

    // Readiness score: weighted 0-100
    // Full lock readiness = all subjects locked, no open queries, no incomplete forms
    let score = 0;
    if (totalSubjects > 0) {
      const lockedRatio = locked / totalSubjects;
      const queryPenalty = Math.min(openQueriesTotal / Math.max(totalSubjects, 1), 1);
      const incompletePenalty = Math.min(incompleteFormsTotal / Math.max(totalSubjects * 2, 1), 1);
      score = Math.round(lockedRatio * 100 - queryPenalty * 30 - incompletePenalty * 20);
      score = Math.max(0, Math.min(100, score));
    }

    return {
      studyId,
      generatedAt: new Date().toISOString(),
      totalSubjects,
      readyCount: locked,
      notReadyCount: totalSubjects - locked,
      subjects: [],
      subjectsByStatus: { noData, inProgress, complete, frozen, locked },
      openQueriesTotal,
      incompleteFormsTotal,
      missingRequiredFieldsTotal,
      pendingSDVTotal,
      lockReadinessScore: score
    };
  } catch (error: any) {
    logger.error('getStudySanitationReport error', { studyId, error: error.message });
    throw error;
  }
};

/**
 * Per-subject breakdown for the data sanitation panel.
 * Returns one row per subject with their form completion and open query counts.
 */
export const getSanitationSubjects = async (
  studyId: number,
  page: number = 1,
  limit: number = 50
): Promise<{ success: boolean; data: SanitationSubjectRow[]; pagination: any }> => {
  const offset = (page - 1) * limit;

  try {
    await ensureFrozenColumn();

    // Check if acc_sdv_status table exists to build the query dynamically
    const sdvTableCheck = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'acc_sdv_status' AND table_schema = 'public'
    `);
    const hasSDVTable = sdvTableCheck.rows.length > 0;

    const sdvSubquery = hasSDVTable
      ? `COALESCE((
          SELECT COUNT(*)
          FROM acc_sdv_status sdv
          INNER JOIN event_crf ec3 ON sdv.event_crf_id = ec3.event_crf_id
          INNER JOIN study_event se3 ON ec3.study_event_id = se3.study_event_id
          WHERE se3.study_subject_id = ss.study_subject_id
            AND sdv.sdv_status = 'pending'
        ), 0)`
      : '0';

    const result = await pool.query(`
      SELECT
        ss.study_subject_id,
        ss.label AS subject_label,
        COALESCE(site.name, '') AS site_name,
        COUNT(ec.event_crf_id) FILTER (WHERE ec.status_id NOT IN (5,7)) AS total_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE ec.status_id IN (2) AND COALESCE(ec.frozen,false)=false) AS complete_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE COALESCE(ec.frozen,false)=true AND ec.status_id!=6) AS frozen_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE ec.status_id=6) AS locked_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE ec.status_id NOT IN (2,5,6,7) AND COALESCE(ec.frozen,false)=false) AS incomplete_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE COALESCE(ec.electronic_signature_status, false) = false AND ec.status_id NOT IN (5,7)) AS unsigned_forms,
        COUNT(ec.event_crf_id) FILTER (WHERE COALESCE(ec.sdv_status, false) = false AND ec.status_id NOT IN (5,7)) AS unverified_forms,
        (
          SELECT COUNT(DISTINCT dn.discrepancy_note_id)
          FROM discrepancy_note dn
          WHERE dn.resolution_status_id NOT IN (4,5)
            AND dn.parent_dn_id IS NULL
            AND (
              EXISTS (
                SELECT 1 FROM dn_event_crf_map dem
                INNER JOIN event_crf ec2 ON dem.event_crf_id = ec2.event_crf_id
                INNER JOIN study_event se2 ON ec2.study_event_id = se2.study_event_id
                WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
                  AND se2.study_subject_id = ss.study_subject_id
              )
              OR EXISTS (
                SELECT 1 FROM dn_item_data_map dim
                INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
                INNER JOIN event_crf ec2 ON id.event_crf_id = ec2.event_crf_id
                INNER JOIN study_event se2 ON ec2.study_event_id = se2.study_event_id
                WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
                  AND se2.study_subject_id = ss.study_subject_id
              )
              OR EXISTS (
                SELECT 1 FROM dn_study_subject_map dssm
                WHERE dssm.discrepancy_note_id = dn.discrepancy_note_id
                  AND dssm.study_subject_id = ss.study_subject_id
              )
            )
        ) AS open_queries,
        ${sdvSubquery} AS pending_sdv
      FROM study_subject ss
      LEFT JOIN study site ON ss.study_id = site.study_id
      LEFT JOIN study_event se ON ss.study_subject_id = se.study_subject_id
      LEFT JOIN event_crf ec ON se.study_event_id = ec.study_event_id
      WHERE ss.study_id = $1
        AND ss.status_id NOT IN (5,7)
      GROUP BY ss.study_subject_id, ss.label, site.name
      ORDER BY ss.label
      LIMIT $2 OFFSET $3
    `, [studyId, limit, offset]);

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM study_subject WHERE study_id = $1 AND status_id NOT IN (5,7)`,
      [studyId]
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    const data: SanitationSubjectRow[] = result.rows.map((r: any) => {
      const totalForms = parseInt(r.totalForms || '0');
      const completeForms = parseInt(r.completeForms || '0');
      const frozenForms = parseInt(r.frozenForms || '0');
      const lockedForms = parseInt(r.lockedForms || '0');
      const openQueries = parseInt(r.openQueries || '0');
      const pendingSDV = parseInt(r.pendingSdv || '0');
      const incompleteForms = parseInt(r.incompleteForms || '0');
      const unsignedForms = parseInt(r.unsignedForms || '0');
      const unverifiedForms = parseInt(r.unverifiedForms || '0');

      let overallStatus: SanitationSubjectRow['overallStatus'] = 'no_data';
      if (totalForms === 0) overallStatus = 'no_data';
      else if (lockedForms === totalForms) overallStatus = 'locked';
      else if (frozenForms > 0 && lockedForms + frozenForms === totalForms) overallStatus = 'frozen';
      else if (completeForms + frozenForms + lockedForms === totalForms) overallStatus = 'complete';
      else overallStatus = 'in_progress';

      const isReady = openQueries === 0 && incompleteForms === 0;

      return {
        studySubjectId: r.studySubjectId,
        label: r.subjectLabel || '',
        subjectLabel: r.subjectLabel,
        siteName: r.siteName || '',
        isReady,
        incompleteForms,
        unsignedForms,
        unverifiedForms,
        totalForms,
        completeForms,
        frozenForms,
        lockedForms,
        openQueries,
        pendingSDV,
        overallStatus
      };
    });

    return { success: true, data, pagination: { page, limit, total } };
  } catch (error: any) {
    logger.error('getSanitationSubjects error', { studyId, error: error.message });
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════════
// STUDY-LEVEL LOCK
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the lock status of a study.
 */
export const getStudyLockStatus = async (studyId: number): Promise<StudyLockStatus> => {
  // database_lock_date is a custom column — check if it exists first
  const colCheck = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study' AND column_name = 'database_lock_date'
  `);
  const hasLockCol = colCheck.rows.length > 0;

  const query = hasLockCol
    ? `SELECT s.study_id, s.database_lock_date,
              ua.first_name || ' ' || ua.last_name AS locked_by_name
       FROM study s
       LEFT JOIN user_account ua ON s.update_id = ua.user_id
       WHERE s.study_id = $1`
    : `SELECT s.study_id, NULL AS database_lock_date, NULL AS locked_by_name
       FROM study s WHERE s.study_id = $1`;

  const result = await pool.query(query, [studyId]);
  if (result.rows.length === 0) {
    return { studyId, isLocked: false };
  }
  const row = result.rows[0];
  return {
    studyId,
    isLocked: !!row.databaseLockDate,
    databaseLockDate: row.databaseLockDate,
    lockedByName: row.lockedByName
  };
};

/**
 * Lock the entire study dataset.
 *
 * Requirements:
 *   - All non-removed event_crf records must be status_id = 6 (locked)
 *   - No open discrepancy notes (queries) across the study
 *   - Sets study.database_lock_date = NOW()
 *   - Writes a dual-signature audit record
 *
 * The dual-signature is enforced at the route level via two sequential calls to
 * requireSignatureFor middleware; this function records BOTH user IDs.
 */
export const lockStudy = async (
  studyId: number,
  lockerUserId: number,
  reason: string
): Promise<{ success: boolean; message: string; blockingReasons?: string[] }> => {
  logger.info('Locking study', { studyId, lockerUserId });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify study exists
    const studyResult = await client.query(
      `SELECT study_id, database_lock_date FROM study WHERE study_id = $1`,
      [studyId]
    );
    if (studyResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study not found' };
    }
    if (studyResult.rows[0].databaseLockDate) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study is already locked' };
    }

    // 2. Check all forms are locked
    const unlockedFormsResult = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = $1
        AND ec.status_id != 6
        AND ec.status_id NOT IN (5, 7)
    `, [studyId]);
    const unlockedForms = parseInt(unlockedFormsResult.rows[0]?.cnt || '0');

    // 3. Check no open queries
    const openQueriesResult = await client.query(`
      SELECT COUNT(DISTINCT dn.discrepancy_note_id) AS cnt
      FROM discrepancy_note dn
      WHERE dn.study_id = $1
        AND dn.resolution_status_id NOT IN (4, 5)
        AND dn.parent_dn_id IS NULL
    `, [studyId]);
    const openQueries = parseInt(openQueriesResult.rows[0]?.cnt || '0');

    const blockingReasons: string[] = [];
    if (unlockedForms > 0) {
      blockingReasons.push(`${unlockedForms} form${unlockedForms > 1 ? 's are' : ' is'} not yet locked`);
    }
    if (openQueries > 0) {
      blockingReasons.push(`${openQueries} open ${openQueries > 1 ? 'queries' : 'query'} must be resolved`);
    }

    if (blockingReasons.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: blockingReasons.join('; '), blockingReasons };
    }

    // 4. Set database lock date
    await client.query(`
      UPDATE study
      SET database_lock_date = NOW(), update_id = $1, date_updated = NOW()
      WHERE study_id = $2
    `, [lockerUserId, studyId]);

    // 5. Audit
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, 'Study Dataset Locked', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [lockerUserId, studyId, reason]);

    await client.query('COMMIT');

    logger.info('Study locked', { studyId, lockerUserId });
    return { success: true, message: 'Study dataset has been locked successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('lockStudy error', { studyId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unlock a study (admin only with documented reason).
 */
export const unlockStudy = async (
  studyId: number,
  adminUserId: number,
  reason: string
): Promise<{ success: boolean; message: string }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE study
      SET database_lock_date = NULL, update_id = $1, date_updated = NOW()
      WHERE study_id = $2 AND database_lock_date IS NOT NULL
      RETURNING study_id
    `, [adminUserId, studyId]);

    if ((result.rowCount || 0) === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Study is not locked or not found' };
    }

    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), 'study', $1, $2, 'Study Dataset UNLOCKED', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1)
      )
    `, [adminUserId, studyId, reason]);

    await client.query('COMMIT');
    logger.info('Study unlocked', { studyId, adminUserId });
    return { success: true, message: 'Study dataset has been unlocked' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('unlockStudy error', { studyId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

export const unlockRecord = async (eventCrfId: number, userId: number, reason?: string) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire row lock to prevent concurrent unlock/lock
    const lockCheck = await client.query(
      `SELECT event_crf_id, status_id FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`,
      [eventCrfId]
    );
    if (lockCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or not locked' };
    }
    if (lockCheck.rows[0].statusId !== 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or not locked' };
    }

    await client.query(`
      UPDATE event_crf
      SET status_id = 2, frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id = 6
    `, [eventCrfId, userId]);

    // Sync patient_event_form
    await client.query(`
      UPDATE patient_event_form
      SET is_locked = false, is_frozen = false
      WHERE event_crf_id = $1
    `, [eventCrfId]);

    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Unlocked', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId, reason || null]);

    await client.query('COMMIT');

    return { success: true, message: 'Data unlocked successfully' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unlock all data for a specific event (visit).
 * Performs all unlocks in a single transaction.
 */
export const unlockEventData = async (
  studyEventId: number,
  userId: number,
  reason: string
): Promise<{ success: boolean; message: string; unlockedCount?: number }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Acquire row locks on all locked event_crf rows for this event
    await client.query(`
      SELECT event_crf_id FROM event_crf
      WHERE study_event_id = $1 AND status_id = 6
      FOR UPDATE
    `, [studyEventId]);

    const unlockResult = await client.query(
      `UPDATE event_crf
       SET status_id = 2, frozen = false, update_id = $1, date_updated = CURRENT_TIMESTAMP
       WHERE study_event_id = $2 AND status_id = 6
       RETURNING event_crf_id`,
      [userId, studyEventId]
    );
    const unlockedCount = unlockResult.rowCount || 0;

    // Sync patient_event_form for all unlocked forms
    if (unlockedCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_locked = false, is_frozen = false
        FROM event_crf ec
        WHERE pef.event_crf_id = ec.event_crf_id
          AND ec.study_event_id = $1
      `, [studyEventId]);
    }

    for (const row of unlockResult.rows) {
      await client.query(
        `INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
         VALUES (NOW(), 'event_crf', $1, $2, 'Data Unlocked', $3,
           (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))`,
        [userId, row.eventCrfId, reason]
      );
    }

    // Event-level audit entry
    const eventQuery = `
      SELECT sed.name FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      WHERE se.study_event_id = $1
    `;
    const eventResult = await client.query(eventQuery, [studyEventId]);
    const eventName = eventResult.rows[0]?.name || studyEventId;

    await client.query(
      `INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
       VALUES (NOW(), 'study_event', $1, $2, $3, $4,
         (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))`,
      [userId, studyEventId, `Event ${eventName} data UNLOCKED`, reason]
    );

    await client.query('COMMIT');
    return { success: true, message: `Unlocked ${unlockedCount} forms for event ${eventName}`, unlockedCount };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// CASEBOOK READINESS
// ═══════════════════════════════════════════════════════════════════

export const getSubjectCasebookReadiness = async (
  studySubjectId: number
): Promise<CasebookReadiness> => {
  await ensureFrozenColumn();

  const labelResult = await pool.query(
    `SELECT label FROM study_subject WHERE study_subject_id = $1`,
    [studySubjectId]
  );
  const subjectLabel = labelResult.rows[0]?.label || String(studySubjectId);

  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE ec.status_id NOT IN (5, 7)) AS total_forms,
      COUNT(*) FILTER (WHERE (ec.completion_status_id >= 4 OR ec.status_id IN (2, 6)) AND ec.status_id NOT IN (5, 7)) AS completed_forms,
      COUNT(*) FILTER (WHERE COALESCE(ec.sdv_status, false) = true AND ec.status_id NOT IN (5, 7)) AS sdv_forms,
      COUNT(*) FILTER (WHERE COALESCE(ec.electronic_signature_status, false) = true AND ec.status_id NOT IN (5, 7)) AS signed_forms,
      COUNT(*) FILTER (WHERE ec.status_id = 6) AS locked_forms,
      COUNT(*) FILTER (WHERE COALESCE(ec.frozen, false) = true AND ec.status_id != 6 AND ec.status_id NOT IN (5, 7)) AS frozen_forms
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    WHERE se.study_subject_id = $1
  `, [studySubjectId]);

  const openQueriesResult = await pool.query(`
    SELECT COUNT(DISTINCT dn.discrepancy_note_id) AS cnt
    FROM discrepancy_note dn
    WHERE dn.resolution_status_id NOT IN (4, 5)
      AND dn.parent_dn_id IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM dn_event_crf_map dem
          INNER JOIN event_crf ec ON dem.event_crf_id = ec.event_crf_id
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE dem.discrepancy_note_id = dn.discrepancy_note_id
            AND se.study_subject_id = $1
        )
        OR EXISTS (
          SELECT 1 FROM dn_item_data_map dim
          INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
          INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE dim.discrepancy_note_id = dn.discrepancy_note_id
            AND se.study_subject_id = $1
        )
        OR EXISTS (
          SELECT 1 FROM dn_study_subject_map dssm
          WHERE dssm.discrepancy_note_id = dn.discrepancy_note_id
            AND dssm.study_subject_id = $1
        )
      )
  `, [studySubjectId]);

  const r = result.rows[0] || {};
  const totalForms = parseInt(r.totalForms || '0');
  const completedForms = parseInt(r.completedForms || '0');
  const sdvForms = parseInt(r.sdvForms || '0');
  const signedForms = parseInt(r.signedForms || '0');
  const lockedForms = parseInt(r.lockedForms || '0');
  const frozenForms = parseInt(r.frozenForms || '0');
  const openQueries = parseInt(openQueriesResult.rows[0]?.cnt || '0');

  const allComplete = totalForms > 0 && completedForms === totalForms;
  const allQueriesResolved = openQueries === 0;
  const allSdvd = totalForms > 0 && sdvForms === totalForms;
  const allSigned = totalForms > 0 && signedForms === totalForms;
  const lockReady = allComplete && allQueriesResolved;

  let readinessPercent = 0;
  if (totalForms > 0) {
    const completionWeight = (completedForms / totalForms) * 40;
    const sdvWeight = (sdvForms / totalForms) * 20;
    const signatureWeight = (signedForms / totalForms) * 10;
    const lockWeight = (lockedForms / totalForms) * 30;
    readinessPercent = Math.round(completionWeight + sdvWeight + signatureWeight + lockWeight);
  }

  return {
    studySubjectId,
    subjectLabel,
    allComplete,
    allQueriesResolved,
    allSdvd,
    allSigned,
    lockReady,
    openQueries,
    totalForms,
    completedForms,
    sdvForms,
    signedForms,
    lockedForms,
    frozenForms,
    readinessPercent
  };
};

export const getStudyCasebookReadiness = async (
  studyId: number
): Promise<{ studyId: number; subjects: CasebookReadiness[]; aggregated: { totalForms: number; completedForms: number; sdvForms: number; signedForms: number; lockedForms: number; frozenForms: number; readinessPercent: number } }> => {
  const subjectsResult = await pool.query(
    `SELECT study_subject_id FROM study_subject WHERE study_id = $1 AND status_id NOT IN (5, 7) ORDER BY label`,
    [studyId]
  );

  const subjects: CasebookReadiness[] = [];
  let aggTotal = 0, aggCompleted = 0, aggSdv = 0, aggSigned = 0, aggLocked = 0, aggFrozen = 0;

  for (const row of subjectsResult.rows) {
    const readiness = await getSubjectCasebookReadiness(row.studySubjectId);
    subjects.push(readiness);
    aggTotal += readiness.totalForms;
    aggCompleted += readiness.completedForms;
    aggSdv += readiness.sdvForms;
    aggSigned += readiness.signedForms;
    aggLocked += readiness.lockedForms;
    aggFrozen += readiness.frozenForms;
  }

  let readinessPercent = 0;
  if (aggTotal > 0) {
    const completionWeight = (aggCompleted / aggTotal) * 40;
    const sdvWeight = (aggSdv / aggTotal) * 20;
    const signatureWeight = (aggSigned / aggTotal) * 10;
    const lockWeight = (aggLocked / aggTotal) * 30;
    readinessPercent = Math.round(completionWeight + sdvWeight + signatureWeight + lockWeight);
  }

  return {
    studyId,
    subjects,
    aggregated: {
      totalForms: aggTotal,
      completedForms: aggCompleted,
      sdvForms: aggSdv,
      signedForms: aggSigned,
      lockedForms: aggLocked,
      frozenForms: aggFrozen,
      readinessPercent
    }
  };
};

// ═══════════════════════════════════════════════════════════════════
// LOCK AUDIT HISTORY
// ═══════════════════════════════════════════════════════════════════

export const getFormLockHistory = async (
  eventCrfId: number
): Promise<LockHistoryEntry[]> => {
  const result = await pool.query(`
    SELECT
      ale.audit_log_event_id,
      ale.audit_date,
      ale.user_id,
      COALESCE(ua.first_name || ' ' || ua.last_name, 'System') AS user_name,
      ale.entity_name AS action,
      ale.reason_for_change AS reason,
      ale.entity_id
    FROM audit_log_event ale
    LEFT JOIN user_account ua ON ale.user_id = ua.user_id
    WHERE ale.audit_table = 'event_crf'
      AND ale.entity_id = $1
      AND ale.entity_name IN ('Data Locked', 'Data Unlocked', 'Data Frozen', 'Data Unfrozen')
    ORDER BY ale.audit_date DESC
  `, [eventCrfId]);

  return result.rows.map((r: any) => {
    const actionStr: string = r.action || '';
    let mappedAction: LockHistory['action'] = 'lock';
    if (actionStr.includes('Unlocked')) mappedAction = 'unlock';
    else if (actionStr.includes('Unfrozen')) mappedAction = 'unfreeze';
    else if (actionStr.includes('Frozen')) mappedAction = 'freeze';

    return {
      lockId: r.auditLogEventId,
      entityType: 'event_crf',
      entityId: r.entityId,
      action: mappedAction,
      reason: r.reason,
      performedBy: r.userId,
      performedByName: r.userName,
      performedAt: r.auditDate,
    };
  });
};

export const getSubjectLockHistory = async (
  studySubjectId: number
): Promise<LockHistoryEntry[]> => {
  const result = await pool.query(`
    SELECT
      ale.audit_log_event_id,
      ale.audit_date,
      ale.audit_table,
      ale.user_id,
      COALESCE(ua.first_name || ' ' || ua.last_name, 'System') AS user_name,
      ale.entity_name AS action,
      ale.reason_for_change AS reason,
      ale.entity_id
    FROM audit_log_event ale
    LEFT JOIN user_account ua ON ale.user_id = ua.user_id
    WHERE (
      (ale.audit_table = 'event_crf'
        AND ale.entity_id IN (
          SELECT ec.event_crf_id FROM event_crf ec
          INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
          WHERE se.study_subject_id = $1
        )
        AND ale.entity_name IN ('Data Locked', 'Data Unlocked', 'Data Frozen', 'Data Unfrozen')
      )
      OR (
        ale.audit_table = 'study_subject'
        AND ale.entity_id = $1
        AND (ale.entity_name ILIKE '%locked%' OR ale.entity_name ILIKE '%unlocked%'
             OR ale.entity_name ILIKE '%frozen%' OR ale.entity_name ILIKE '%unfrozen%')
      )
    )
    ORDER BY ale.audit_date DESC
  `, [studySubjectId]);

  return result.rows.map((r: any) => {
    const actionStr: string = r.action || '';
    let mappedAction: LockHistory['action'] = 'lock';
    if (actionStr.toLowerCase().includes('unlock')) mappedAction = 'unlock';
    else if (actionStr.toLowerCase().includes('unfro')) mappedAction = 'unfreeze';
    else if (actionStr.toLowerCase().includes('fro') && !actionStr.toLowerCase().includes('unfro')) mappedAction = 'freeze';

    return {
      lockId: r.auditLogEventId,
      entityType: r.auditTable === 'study_subject' ? 'study_subject' : 'event_crf',
      entityId: r.entityId,
      action: mappedAction,
      reason: r.reason,
      performedBy: r.userId,
      performedByName: r.userName,
      performedAt: r.auditDate,
    };
  });
};

// ═══════════════════════════════════════════════════════════════════
// FREEZE / UNFREEZE SUBJECT-LEVEL
// ═══════════════════════════════════════════════════════════════════

export const freezeSubjectData = async (
  studySubjectId: number,
  userId: number,
  reason?: string
): Promise<{ success: boolean; message: string; frozenCount?: number }> => {
  await ensureFrozenColumn();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock rows to prevent concurrent freeze/lock operations
    await client.query(`
      SELECT ec.event_crf_id
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.status_id NOT IN (5, 6, 7)
      FOR UPDATE OF ec
    `, [studySubjectId]);

    const freezeResult = await client.query(`
      UPDATE event_crf ec
      SET frozen = true, update_id = $2, date_updated = CURRENT_TIMESTAMP
      FROM study_event se
      WHERE ec.study_event_id = se.study_event_id
        AND se.study_subject_id = $1
        AND COALESCE(ec.frozen, false) = false
        AND ec.status_id NOT IN (5, 6, 7)
      RETURNING ec.event_crf_id
    `, [studySubjectId, userId]);
    const frozenCount = freezeResult.rowCount || 0;

    // Sync patient_event_form for all frozen forms
    if (frozenCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_frozen = true
        FROM event_crf ec
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        WHERE pef.event_crf_id = ec.event_crf_id
          AND se.study_subject_id = $1
          AND ec.frozen = true
          AND ec.status_id NOT IN (5, 6, 7)
      `, [studySubjectId]);
    }

    const subjectResult = await client.query(
      `SELECT label FROM study_subject WHERE study_subject_id = $1`,
      [studySubjectId]
    );
    const subjectLabel = subjectResult.rows[0]?.label || studySubjectId;

    for (const row of freezeResult.rows) {
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
        VALUES (NOW(), 'event_crf', $1, $2, 'Data Frozen', $3,
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, row.eventCrfId, reason || null]);
    }

    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (NOW(), 'study_subject', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, studySubjectId, `Subject ${subjectLabel} data frozen`, reason || null]);

    await client.query('COMMIT');
    logger.info('Subject data frozen', { studySubjectId, userId, frozenCount });

    return {
      success: true,
      message: `Successfully frozen ${frozenCount} forms for subject ${subjectLabel}`,
      frozenCount
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('freezeSubjectData error', { studySubjectId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

export const unfreezeSubjectData = async (
  studySubjectId: number,
  userId: number,
  reason: string
): Promise<{ success: boolean; message: string; unfrozenCount?: number }> => {
  await ensureFrozenColumn();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire row locks on all frozen event_crf rows for this subject
    await client.query(`
      SELECT ec.event_crf_id
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.frozen = true
        AND ec.status_id NOT IN (5, 6, 7)
      FOR UPDATE OF ec
    `, [studySubjectId]);

    const unfreezeResult = await client.query(`
      UPDATE event_crf ec
      SET frozen = false, update_id = $2, date_updated = CURRENT_TIMESTAMP
      FROM study_event se
      WHERE ec.study_event_id = se.study_event_id
        AND se.study_subject_id = $1
        AND ec.frozen = true
        AND ec.status_id NOT IN (5, 6, 7)
      RETURNING ec.event_crf_id
    `, [studySubjectId, userId]);
    const unfrozenCount = unfreezeResult.rowCount || 0;

    // Sync patient_event_form for all unfrozen forms
    if (unfrozenCount > 0) {
      await client.query(`
        UPDATE patient_event_form pef
        SET is_frozen = false
        FROM event_crf ec
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        WHERE pef.event_crf_id = ec.event_crf_id
          AND se.study_subject_id = $1
      `, [studySubjectId]);
    }

    const subjectResult = await client.query(
      `SELECT label FROM study_subject WHERE study_subject_id = $1`,
      [studySubjectId]
    );
    const subjectLabel = subjectResult.rows[0]?.label || studySubjectId;

    for (const row of unfreezeResult.rows) {
      await client.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
        VALUES (NOW(), 'event_crf', $1, $2, 'Data Unfrozen', $3,
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, row.eventCrfId, reason]);
    }

    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, reason_for_change, audit_log_event_type_id)
      VALUES (NOW(), 'study_subject', $1, $2, $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, studySubjectId, `Subject ${subjectLabel} data unfrozen`, reason]);

    await client.query('COMMIT');
    logger.info('Subject data unfrozen', { studySubjectId, userId, unfrozenCount });

    return {
      success: true,
      message: `Successfully unfrozen ${unfrozenCount} forms for subject ${subjectLabel}`,
      unfrozenCount
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('unfreezeSubjectData error', { studySubjectId, error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// LIST FROZEN RECORDS
// ═══════════════════════════════════════════════════════════════════

export const getFrozenRecords = async (filters: {
  studyId?: number;
  page?: number;
  limit?: number;
}): Promise<{ success: boolean; data: any[]; pagination: { page: number; limit: number; total: number } }> => {
  await ensureFrozenColumn();

  const { studyId, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;
  const params: any[] = [];
  let paramIndex = 1;

  let whereClause = 'COALESCE(ec.frozen, false) = true AND ec.status_id NOT IN (5, 6, 7)';

  if (studyId) {
    whereClause += ` AND ss.study_id = $${paramIndex}`;
    params.push(studyId);
    paramIndex++;
  }

  const query = `
    SELECT
      ec.event_crf_id,
      ec.status_id,
      ec.date_updated AS freeze_date,
      ss.study_subject_id,
      ss.label AS subject_label,
      se.study_event_id,
      sed.name AS event_name,
      c.name AS crf_name,
      ua.user_name AS frozen_by
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    INNER JOIN crf c ON cv.crf_id = c.crf_id
    LEFT JOIN user_account ua ON ec.update_id = ua.user_id
    WHERE ${whereClause}
    ORDER BY ec.date_updated DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  const countParams = params.slice(0, -2);
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM event_crf ec
    INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
    INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    WHERE ${whereClause}
  `;
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0]?.total || '0');

  return {
    success: true,
    data: result.rows,
    pagination: { page, limit, total }
  };
};
