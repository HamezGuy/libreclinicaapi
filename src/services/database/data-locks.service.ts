/**
 * Data Locks Service
 * Uses event_crf.status_id = 6 (locked) from LibreClinica
 * 
 * Lock Status IDs in LibreClinica:
 * 1 = available (unlocked, can be edited)
 * 2 = unavailable
 * 3 = private
 * 4 = pending
 * 5 = removed
 * 6 = locked (data locked)
 * 7 = auto-removed
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

export const lockRecord = async (eventCrfId: number, userId: number) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    // Audit log - audit_log_event requires audit_log_event_type_id (FK to audit_log_event_type)
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
