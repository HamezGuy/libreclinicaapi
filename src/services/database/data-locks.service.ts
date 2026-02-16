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

// ═══════════════════════════════════════════════════════════════════
// LOCK ELIGIBILITY CHECKING
// ═══════════════════════════════════════════════════════════════════

export interface LockEligibility {
  canLock: boolean;
  reasons: string[];
  openQueries: number;
  incompleteForms: number;
  totalForms: number;
  completedForms: number;
  pendingSDV: number;
  subjectId?: number;
  studyEventId?: number;
}

/**
 * Check if a subject's data is eligible for locking
 * Validates:
 * - All queries are closed (resolution_status_id = 4 means closed)
 * - All required forms are complete (status_id in (2, 6) = data complete or already locked)
 */
export const checkSubjectLockEligibility = async (studySubjectId: number): Promise<LockEligibility> => {
  logger.info('Checking lock eligibility for subject', { studySubjectId });

  try {
    // Get open queries for this subject
    const openQueriesQuery = `
      SELECT COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN item_data id ON dn.entity_id = id.item_data_id AND dn.entity_type = 'itemData'
      INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND dn.resolution_status_id != 4  -- Not closed
        AND dnt.name = 'Query'  -- Only count actual queries
    `;
    const openQueriesResult = await pool.query(openQueriesQuery, [studySubjectId]);
    const openQueries = parseInt(openQueriesResult.rows[0]?.count || '0');

    // Get form completion status
    // status_id: 1=available, 2=data complete, 4=pending, 6=locked
    // We consider forms complete if status_id is 2 (complete) or 6 (already locked)
    const formsQuery = `
      SELECT 
        COUNT(*) as total_forms,
        COUNT(CASE WHEN ec.status_id IN (2, 6) THEN 1 END) as completed_forms,
        COUNT(CASE WHEN ec.status_id NOT IN (2, 6) THEN 1 END) as incomplete_forms
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      WHERE se.study_subject_id = $1
        AND ec.status_id != 5  -- Exclude removed
        AND ec.status_id != 7  -- Exclude auto-removed
    `;
    const formsResult = await pool.query(formsQuery, [studySubjectId]);
    const totalForms = parseInt(formsResult.rows[0]?.total_forms || '0');
    const completedForms = parseInt(formsResult.rows[0]?.completed_forms || '0');
    const incompleteForms = parseInt(formsResult.rows[0]?.incomplete_forms || '0');

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
      const sdvResult = await pool.query(sdvQuery, [studySubjectId]);
      pendingSDV = parseInt(sdvResult.rows[0]?.count || '0');
    } catch (sdvError) {
      // acc_sdv_status table might not exist - ignore
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
      subjectId: studySubjectId
    };
  } catch (error: any) {
    logger.error('Check lock eligibility error', { studySubjectId, error: error.message });
    throw error;
  }
};

/**
 * Check if a specific study event (visit) is eligible for locking
 */
export const checkEventLockEligibility = async (studyEventId: number): Promise<LockEligibility> => {
  logger.info('Checking lock eligibility for event', { studyEventId });

  try {
    // Get subject ID for this event
    const subjectQuery = `SELECT study_subject_id FROM study_event WHERE study_event_id = $1`;
    const subjectResult = await pool.query(subjectQuery, [studyEventId]);
    const subjectId = subjectResult.rows[0]?.study_subject_id;

    // Get open queries for this event
    const openQueriesQuery = `
      SELECT COUNT(*) as count
      FROM discrepancy_note dn
      INNER JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
      INNER JOIN item_data id ON dn.entity_id = id.item_data_id AND dn.entity_type = 'itemData'
      INNER JOIN event_crf ec ON id.event_crf_id = ec.event_crf_id
      WHERE ec.study_event_id = $1
        AND dn.resolution_status_id != 4
        AND dnt.name = 'Query'
    `;
    const openQueriesResult = await pool.query(openQueriesQuery, [studyEventId]);
    const openQueries = parseInt(openQueriesResult.rows[0]?.count || '0');

    // Get form completion status for this event
    const formsQuery = `
      SELECT 
        COUNT(*) as total_forms,
        COUNT(CASE WHEN ec.status_id IN (2, 6) THEN 1 END) as completed_forms,
        COUNT(CASE WHEN ec.status_id NOT IN (2, 6) THEN 1 END) as incomplete_forms
      FROM event_crf ec
      WHERE ec.study_event_id = $1
        AND ec.status_id NOT IN (5, 7)
    `;
    const formsResult = await pool.query(formsQuery, [studyEventId]);
    const totalForms = parseInt(formsResult.rows[0]?.total_forms || '0');
    const completedForms = parseInt(formsResult.rows[0]?.completed_forms || '0');
    const incompleteForms = parseInt(formsResult.rows[0]?.incomplete_forms || '0');

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
      subjectId,
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
    // Check eligibility first (unless skipped by admin)
    const eligibility = await checkSubjectLockEligibility(studySubjectId);
    
    if (!skipValidation && !eligibility.canLock) {
      return {
        success: false,
        message: `Cannot lock data: ${eligibility.reasons.join('; ')}`,
        eligibility
      };
    }

    await client.query('BEGIN');

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
    const eligibility = await checkEventLockEligibility(studyEventId);

    if (!skipValidation && !eligibility.canLock) {
      return {
        success: false,
        message: `Cannot lock data: ${eligibility.reasons.join('; ')}`,
        eligibility
      };
    }

    await client.query('BEGIN');

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
    const subjectLabel = eventResult.rows[0]?.subject_label;

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

    // Unlock all event CRFs
    const unlockQuery = `
      UPDATE event_crf ec
      SET status_id = 2, update_id = $2, date_updated = CURRENT_TIMESTAMP
      FROM study_event se
      WHERE ec.study_event_id = se.study_event_id
        AND se.study_subject_id = $1
        AND ec.status_id = 6
      RETURNING ec.event_crf_id
    `;
    const unlockResult = await client.query(unlockQuery, [studySubjectId, userId]);
    const unlockedCount = unlockResult.rowCount || 0;

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

    // Get total count for pagination
    let countParams: any[] = [];
    let countWhereClause = 'ec.status_id = 6';
    if (studyId) {
      countWhereClause += ' AND ss.study_id = $1';
      countParams.push(studyId);
    }
    
    const countQuery = `
      SELECT COUNT(*) as total
      FROM event_crf ec
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ${countWhereClause}
    `;
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    return {
      success: true,
      data: result.rows.map((row: any) => ({
        ...row,
        locked: true,
        lock_date: row.lock_date,
        locked_by_name: row.locked_by
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
export const lockRecord = async (eventCrfId: number, userId: number) => {
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
    `, [eventCrfId]);

    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'CRF instance not found' };
    }

    const ec = ecResult.rows[0];
    if (ec.status_id === 6) {
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
      `, [ec.crf_id]);
      if (cfgResult.rows.length > 0) {
        requiresSDV = cfgResult.rows[0].requires_sdv;
        requiresSignature = cfgResult.rows[0].requires_signature;
        requiresDDE = cfgResult.rows[0].requires_dde;
      }
    } catch { /* table may not exist */ }

    // 3. Enforce requirements
    const blockingReasons: string[] = [];

    // Must be at least data_entry_complete (completion_status_id >= 4 or status_id = 2)
    if (ec.completion_status_id < 4 && ec.status_id !== 2) {
      blockingReasons.push('Form must be marked as complete before locking');
    }

    if (requiresSDV && !ec.sdv_verified) {
      blockingReasons.push('Source Data Verification (SDV) is required but not yet completed');
    }

    if (requiresSignature && ec.completion_status_id < 5 && !ec.is_signed) {
      blockingReasons.push('PI electronic signature is required but not yet applied');
    }

    // Check open queries on this CRF
    const queryResult = await client.query(`
      SELECT COUNT(*) as cnt FROM discrepancy_note dn
      INNER JOIN dn_event_crf_map dem ON dn.discrepancy_note_id = dem.discrepancy_note_id
      WHERE dem.event_crf_id = $1
        AND dn.resolution_status_id IN (1, 2, 3)
        AND dn.parent_dn_id IS NULL
    `, [eventCrfId]);
    const openQueries = parseInt(queryResult.rows[0]?.cnt || '0');
    if (openQueries > 0) {
      blockingReasons.push(`${openQueries} open ${openQueries === 1 ? 'query' : 'queries'} must be resolved before locking`);
    }

    if (blockingReasons.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, message: blockingReasons.join('. '), blockingReasons };
    }

    // 4. Lock the record
    const updateQuery = `
      UPDATE event_crf
      SET status_id = 6, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id != 6
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or already locked' };
    }

    // 5. Audit log
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Locked',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return { success: true, data: result.rows[0] };
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
 * Returns summary of how many succeeded / failed.
 */
export const batchLockRecords = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; locked: number; failed: number; errors: string[] }> => {
  logger.info('Batch locking records', { count: eventCrfIds.length, userId });
  let locked = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const ecId of eventCrfIds) {
    try {
      const result = await lockRecord(ecId, userId);
      if (result.success) {
        locked++;
      } else {
        failed++;
        errors.push(`CRF ${ecId}: ${result.message}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`CRF ${ecId}: ${e.message}`);
    }
  }

  return { success: failed === 0, locked, failed, errors };
};

/**
 * Batch unlock multiple CRF records.
 */
export const batchUnlockRecords = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; unlocked: number; failed: number; errors: string[] }> => {
  logger.info('Batch unlocking records', { count: eventCrfIds.length, userId });
  let unlocked = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const ecId of eventCrfIds) {
    try {
      const result = await unlockRecord(ecId, userId);
      if (result.success) {
        unlocked++;
      } else {
        failed++;
        errors.push(`CRF ${ecId}: ${result.message}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`CRF ${ecId}: ${e.message}`);
    }
  }

  return { success: failed === 0, unlocked, failed, errors };
};

/**
 * Batch SDV: mark multiple CRF records as source-data-verified.
 */
export const batchSDV = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; verified: number; failed: number; errors: string[] }> => {
  logger.info('Batch SDV', { count: eventCrfIds.length, userId });
  let verified = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const ecId of eventCrfIds) {
    try {
      await pool.query(`
        UPDATE event_crf SET sdv_status = true, sdv_update_id = $1, date_updated = NOW()
        WHERE event_crf_id = $2 AND (sdv_status IS NULL OR sdv_status = false)
      `, [userId, ecId]);

      await pool.query(`
        INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
        VALUES (NOW(), 'event_crf', $1, $2, 'SDV Verified (batch)',
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
      `, [userId, ecId]);

      verified++;
    } catch (e: any) {
      failed++;
      errors.push(`CRF ${ecId}: ${e.message}`);
    }
  }

  return { success: failed === 0, verified, failed, errors };
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
      `SELECT status_id, completion_status_id, frozen FROM event_crf WHERE event_crf_id = $1`,
      [eventCrfId]
    );
    if (ecResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'CRF instance not found' };
    }
    const ec = ecResult.rows[0];
    if (ec.status_id === 6) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is already locked — cannot freeze a locked form' };
    }
    if (ec.frozen) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is already frozen' };
    }

    // Must be at least data complete
    if (ec.completion_status_id < 4 && ec.status_id !== 2) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form must be marked as complete before freezing' };
    }

    // Check open queries
    const qResult = await client.query(`
      SELECT COUNT(*) as cnt FROM discrepancy_note dn
      INNER JOIN dn_event_crf_map dem ON dn.discrepancy_note_id = dem.discrepancy_note_id
      WHERE dem.event_crf_id = $1 AND dn.resolution_status_id IN (1, 2, 3) AND dn.parent_dn_id IS NULL
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
    return { success: false, message: error.message };
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

    const result = await client.query(
      `UPDATE event_crf SET frozen = false, date_updated = NOW(), update_id = $1
       WHERE event_crf_id = $2 AND frozen = true RETURNING event_crf_id`,
      [userId, eventCrfId]
    );

    if ((result.rowCount || 0) === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Form is not frozen or not found' };
    }

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
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Batch freeze multiple CRF records.
 */
export const batchFreezeRecords = async (
  eventCrfIds: number[],
  userId: number
): Promise<{ success: boolean; frozen: number; failed: number; errors: string[] }> => {
  await ensureFrozenColumn();
  let frozen = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const ecId of eventCrfIds) {
    const result = await freezeRecord(ecId, userId);
    if (result.success) { frozen++; } else { failed++; errors.push(`CRF ${ecId}: ${result.message}`); }
  }

  return { success: failed === 0, frozen, failed, errors };
};

export const unlockRecord = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE event_crf
      SET status_id = 1, update_id = $2, date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1 AND status_id = 6
      RETURNING *
    `;

    const result = await client.query(updateQuery, [eventCrfId, userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Record not found or not locked' };
    }

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
    await client.query(`
      INSERT INTO audit_log_event (audit_date, audit_table, user_id, entity_id, entity_name, audit_log_event_type_id)
      VALUES (CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'Data Unlocked',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1))
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return { success: true, message: 'Data unlocked successfully' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
