/**
 * Double Data Entry (DDE) Service
 * 
 * Implements double data entry workflow for high-quality clinical trials.
 * Extends LibreClinica's native DDE support with:
 * - Discrepancy detection
 * - Side-by-side comparison
 * - Reconciliation workflow
 * 
 * 21 CFR Part 11 Compliance:
 * - Full audit trail of all entries and resolutions
 * - Different user required for second entry
 * - Complete data integrity checks
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ============================================================================
// Types
// ============================================================================

export interface DDEEntryRequest {
  eventCrfId: number;
  entries: { itemId: number; value: string }[];
  userId: number;
}

export interface DDEStatus {
  statusId: number;
  eventCrfId: number;
  firstEntryStatus: 'pending' | 'in_progress' | 'complete';
  firstEntryBy?: number;
  firstEntryByName?: string;
  firstEntryAt?: Date;
  secondEntryStatus: 'pending' | 'in_progress' | 'complete';
  secondEntryBy?: number;
  secondEntryByName?: string;
  secondEntryAt?: Date;
  comparisonStatus: 'pending' | 'matched' | 'discrepancies' | 'resolved';
  totalItems: number;
  matchedItems: number;
  discrepancyCount: number;
  resolvedCount: number;
  ddeComplete: boolean;
}

export interface DDEItemComparison {
  itemId: number;
  itemName: string;
  itemDescription?: string;
  firstValue: string;
  secondValue: string;
  matches: boolean;
  discrepancyId?: number;
  resolutionStatus?: string;
  resolvedValue?: string;
  resolvedBy?: string;
}

export interface DDEComparison {
  eventCrfId: number;
  subjectLabel: string;
  formName: string;
  items: DDEItemComparison[];
  summary: {
    total: number;
    matched: number;
    discrepancies: number;
    resolved: number;
  };
}

export interface DDEResolution {
  discrepancyId: number;
  resolution: 'first_correct' | 'second_correct' | 'new_value' | 'adjudicated';
  newValue?: string;
  adjudicationNotes?: string;
  resolvedBy: number;
}

export interface DDEDashboardItem {
  eventCrfId: number;
  studySubjectId: number;
  subjectLabel: string;
  studyName: string;
  siteName: string;
  formName: string;
  eventName: string;
  ddeStatus: DDEStatus;
  daysWaiting: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if DDE is required for an event_crf
 * Uses LibreClinica's native double_entry flag in event_definition_crf
 */
export async function isDDERequired(eventCrfId: number): Promise<boolean> {
  try {
    const query = `
      SELECT edc.double_entry
      FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN crf c ON cv.crf_id = c.crf_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN event_definition_crf edc ON edc.crf_id = c.crf_id 
        AND edc.study_event_definition_id = se.study_event_definition_id
      WHERE ec.event_crf_id = $1
    `;

    const result = await pool.query(query, [eventCrfId]);
    return result.rows[0]?.double_entry === true;
  } catch (error: any) {
    logger.error('Error checking DDE requirement', { error: error.message, eventCrfId });
    return false;
  }
}

/**
 * Get DDE status for an event_crf
 */
export async function getDDEStatus(eventCrfId: number): Promise<DDEStatus | null> {
  try {
    const query = `
      SELECT 
        ds.*,
        CONCAT(u1.first_name, ' ', u1.last_name) as first_entry_by_name,
        CONCAT(u2.first_name, ' ', u2.last_name) as second_entry_by_name
      FROM acc_dde_status ds
      LEFT JOIN user_account u1 ON ds.first_entry_by = u1.user_id
      LEFT JOIN user_account u2 ON ds.second_entry_by = u2.user_id
      WHERE ds.event_crf_id = $1
    `;

    const result = await pool.query(query, [eventCrfId]);

    if (result.rows.length === 0) {
      // Check if DDE is required but status not yet created
      const isRequired = await isDDERequired(eventCrfId);
      if (isRequired) {
        // Create initial DDE status
        return await initializeDDEStatus(eventCrfId);
      }
      return null;
    }

    return mapRowToDDEStatus(result.rows[0]);
  } catch (error: any) {
    logger.error('Error getting DDE status', { error: error.message, eventCrfId });
    return null;
  }
}

/**
 * Initialize DDE status for an event_crf
 */
async function initializeDDEStatus(eventCrfId: number): Promise<DDEStatus> {
  const query = `
    INSERT INTO acc_dde_status (
      event_crf_id, crf_version_id, first_entry_status, second_entry_status,
      comparison_status, date_created, date_updated
    )
    SELECT 
      ec.event_crf_id, ec.crf_version_id, 'pending', 'pending', 'pending',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM event_crf ec
    WHERE ec.event_crf_id = $1
    ON CONFLICT (event_crf_id) DO NOTHING
    RETURNING *
  `;

  const result = await pool.query(query, [eventCrfId]);
  
  if (result.rows.length === 0) {
    // Already exists, fetch it
    const existing = await pool.query(
      'SELECT * FROM acc_dde_status WHERE event_crf_id = $1',
      [eventCrfId]
    );
    return mapRowToDDEStatus(existing.rows[0]);
  }

  return mapRowToDDEStatus(result.rows[0]);
}

/**
 * Check if a user can perform DDE entry
 */
export async function canUserPerformDDE(
  eventCrfId: number,
  userId: number
): Promise<{ allowed: boolean; reason?: string; entryType?: 'first' | 'second' }> {
  try {
    const status = await getDDEStatus(eventCrfId);

    if (!status) {
      // DDE not required for this form
      return { allowed: false, reason: 'DDE not required for this form' };
    }

    // If first entry not complete, any user can do it
    if (status.firstEntryStatus !== 'complete') {
      return { allowed: true, entryType: 'first' };
    }

    // First entry complete - check for second entry
    if (status.secondEntryStatus === 'complete') {
      return { allowed: false, reason: 'DDE entries already complete' };
    }

    // Different user required for second entry
    if (status.firstEntryBy === userId) {
      return { 
        allowed: false, 
        reason: 'Different user required for second entry. First entry was done by ' + status.firstEntryByName 
      };
    }

    return { allowed: true, entryType: 'second' };
  } catch (error: any) {
    logger.error('Error checking DDE permission', { error: error.message });
    return { allowed: false, reason: 'Error checking permissions' };
  }
}

/**
 * Mark first entry as complete
 * Called when form is initially submitted
 */
export async function markFirstEntryComplete(
  eventCrfId: number,
  userId: number
): Promise<DDEStatus> {
  logger.info('Marking first entry complete', { eventCrfId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Count total items for this form
    const itemCountResult = await client.query(`
      SELECT COUNT(DISTINCT id.item_id) as total
      FROM item_data id
      WHERE id.event_crf_id = $1 AND id.status_id = 1
    `, [eventCrfId]);

    const totalItems = parseInt(itemCountResult.rows[0]?.total || '0');

    // Update or create DDE status
    await client.query(`
      INSERT INTO acc_dde_status (
        event_crf_id, first_entry_status, first_entry_by, first_entry_at,
        total_items, date_created, date_updated
      ) VALUES (
        $1, 'complete', $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (event_crf_id) DO UPDATE SET
        first_entry_status = 'complete',
        first_entry_by = $2,
        first_entry_at = CURRENT_TIMESTAMP,
        total_items = $3,
        date_updated = CURRENT_TIMESTAMP
    `, [eventCrfId, userId, totalItems]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_dde_status', $1, $2, 'DDE First Entry',
        'pending', 'complete',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        'First data entry completed'
      )
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return (await getDDEStatus(eventCrfId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error marking first entry complete', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Submit second entry data
 */
export async function submitSecondEntry(request: DDEEntryRequest): Promise<DDEStatus> {
  logger.info('Submitting second entry', { 
    eventCrfId: request.eventCrfId, 
    userId: request.userId,
    itemCount: request.entries.length 
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify user can perform second entry
    const canDo = await canUserPerformDDE(request.eventCrfId, request.userId);
    if (!canDo.allowed || canDo.entryType !== 'second') {
      throw new Error(canDo.reason || 'Cannot perform second entry');
    }

    // Insert DDE entries
    for (const entry of request.entries) {
      // Get corresponding item_data_id
      const itemDataResult = await client.query(`
        SELECT item_data_id FROM item_data
        WHERE event_crf_id = $1 AND item_id = $2 AND status_id = 1
        ORDER BY ordinal DESC LIMIT 1
      `, [request.eventCrfId, entry.itemId]);

      const itemDataId = itemDataResult.rows[0]?.item_data_id;

      await client.query(`
        INSERT INTO acc_dde_entry (
          event_crf_id, item_id, item_data_id, second_entry_value,
          entered_by, entered_at
        ) VALUES (
          $1, $2, $3, $4, $5, CURRENT_TIMESTAMP
        )
        ON CONFLICT (event_crf_id, item_id) DO UPDATE SET
          second_entry_value = $4,
          entered_by = $5,
          entered_at = CURRENT_TIMESTAMP
      `, [request.eventCrfId, entry.itemId, itemDataId, entry.value, request.userId]);
    }

    // Update DDE status
    await client.query(`
      UPDATE acc_dde_status
      SET second_entry_status = 'complete',
          second_entry_by = $2,
          second_entry_at = CURRENT_TIMESTAMP,
          date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1
    `, [request.eventCrfId, request.userId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_dde_status', $1, $2, 'DDE Second Entry',
        'pending', 'complete',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        'Second data entry completed'
      )
    `, [request.userId, request.eventCrfId]);

    await client.query('COMMIT');

    // Automatically run comparison
    await compareEntries(request.eventCrfId);

    return (await getDDEStatus(request.eventCrfId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error submitting second entry', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Compare first and second entries
 */
export async function compareEntries(eventCrfId: number): Promise<DDEComparison> {
  logger.info('Comparing DDE entries', { eventCrfId });

  // Get first entries (from item_data)
  const firstEntriesResult = await pool.query(`
    SELECT id.item_data_id, id.item_id, id.value, i.name as item_name, i.description
    FROM item_data id
    JOIN item i ON id.item_id = i.item_id
    WHERE id.event_crf_id = $1 AND id.status_id = 1
    ORDER BY i.item_id
  `, [eventCrfId]);

  // Get second entries (from acc_dde_entry)
  const secondEntriesResult = await pool.query(`
    SELECT dde.item_id, dde.second_entry_value
    FROM acc_dde_entry dde
    WHERE dde.event_crf_id = $1
  `, [eventCrfId]);

  // Get form info for context
  const formInfoResult = await pool.query(`
    SELECT 
      ss.label as subject_label,
      cv.name as form_name
    FROM event_crf ec
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    WHERE ec.event_crf_id = $1
  `, [eventCrfId]);

  const formInfo = formInfoResult.rows[0] || {};

  // Build lookup for second entries
  const secondEntriesMap: Record<number, string> = {};
  for (const entry of secondEntriesResult.rows) {
    secondEntriesMap[entry.item_id] = entry.second_entry_value;
  }

  // Compare and create discrepancies
  const comparisons: DDEItemComparison[] = [];
  let matched = 0;
  let discrepancies = 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const first of firstEntriesResult.rows) {
      const secondValue = secondEntriesMap[first.item_id] ?? '';
      const matches = normalizeForComparison(first.value) === normalizeForComparison(secondValue);

      // Update match status in dde_entry
      await client.query(`
        UPDATE acc_dde_entry
        SET matches_first = $1
        WHERE event_crf_id = $2 AND item_id = $3
      `, [matches, eventCrfId, first.item_id]);

      if (matches) {
        matched++;
      } else {
        discrepancies++;
        
        // Create or update discrepancy record
        await client.query(`
          INSERT INTO acc_dde_discrepancy (
            event_crf_id, item_id, first_value, second_value,
            resolution_status, date_created, date_updated
          ) VALUES (
            $1, $2, $3, $4, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT ON CONSTRAINT acc_dde_discrepancy_event_crf_id_item_id_key
          DO UPDATE SET
            first_value = $3,
            second_value = $4,
            resolution_status = 'open',
            date_updated = CURRENT_TIMESTAMP
        `, [eventCrfId, first.item_id, first.value, secondValue]);
      }

      // Get discrepancy ID if exists
      const discResult = await client.query(`
        SELECT discrepancy_id, resolution_status, resolved_value,
               CONCAT(u.first_name, ' ', u.last_name) as resolved_by
        FROM acc_dde_discrepancy d
        LEFT JOIN user_account u ON d.resolved_by = u.user_id
        WHERE d.event_crf_id = $1 AND d.item_id = $2
      `, [eventCrfId, first.item_id]);

      const disc = discResult.rows[0];

      comparisons.push({
        itemId: first.item_id,
        itemName: first.item_name,
        itemDescription: first.description,
        firstValue: first.value,
        secondValue: secondValue,
        matches,
        discrepancyId: disc?.discrepancy_id,
        resolutionStatus: disc?.resolution_status,
        resolvedValue: disc?.resolved_value,
        resolvedBy: disc?.resolved_by
      });
    }

    // Update DDE status
    await client.query(`
      UPDATE acc_dde_status
      SET comparison_status = $1,
          matched_items = $2,
          discrepancy_count = $3,
          date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $4
    `, [
      discrepancies > 0 ? 'discrepancies' : 'matched',
      matched,
      discrepancies,
      eventCrfId
    ]);

    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    eventCrfId,
    subjectLabel: formInfo.subject_label || '',
    formName: formInfo.form_name || '',
    items: comparisons,
    summary: {
      total: comparisons.length,
      matched,
      discrepancies,
      resolved: 0
    }
  };
}

/**
 * Resolve a discrepancy
 */
export async function resolveDiscrepancy(resolution: DDEResolution): Promise<void> {
  logger.info('Resolving discrepancy', { 
    discrepancyId: resolution.discrepancyId, 
    resolution: resolution.resolution 
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get discrepancy details
    const discResult = await client.query(`
      SELECT * FROM acc_dde_discrepancy WHERE discrepancy_id = $1
    `, [resolution.discrepancyId]);

    if (discResult.rows.length === 0) {
      throw new Error('Discrepancy not found');
    }

    const disc = discResult.rows[0];

    // Determine resolved value
    let resolvedValue: string;
    switch (resolution.resolution) {
      case 'first_correct':
        resolvedValue = disc.first_value;
        break;
      case 'second_correct':
        resolvedValue = disc.second_value;
        break;
      case 'new_value':
      case 'adjudicated':
        if (!resolution.newValue) {
          throw new Error('New value required for this resolution type');
        }
        resolvedValue = resolution.newValue;
        break;
      default:
        throw new Error('Invalid resolution type');
    }

    // Update discrepancy
    await client.query(`
      UPDATE acc_dde_discrepancy
      SET resolution_status = $1,
          resolved_value = $2,
          resolved_by = $3,
          resolved_at = CURRENT_TIMESTAMP,
          adjudication_notes = $4,
          date_updated = CURRENT_TIMESTAMP
      WHERE discrepancy_id = $5
    `, [
      resolution.resolution,
      resolvedValue,
      resolution.resolvedBy,
      resolution.adjudicationNotes || null,
      resolution.discrepancyId
    ]);

    // Update the actual item_data with resolved value
    await client.query(`
      UPDATE item_data
      SET value = $1, date_updated = CURRENT_TIMESTAMP, update_id = $2
      WHERE event_crf_id = $3 AND item_id = $4 AND status_id = 1
    `, [resolvedValue, resolution.resolvedBy, disc.event_crf_id, disc.item_id]);

    // Update DDE status resolved count
    await client.query(`
      UPDATE acc_dde_status
      SET resolved_count = (
            SELECT COUNT(*) FROM acc_dde_discrepancy
            WHERE event_crf_id = $1 AND resolution_status != 'open'
          ),
          comparison_status = CASE
            WHEN (SELECT COUNT(*) FROM acc_dde_discrepancy 
                  WHERE event_crf_id = $1 AND resolution_status = 'open') = 0
            THEN 'resolved'
            ELSE 'discrepancies'
          END,
          date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1
    `, [disc.event_crf_id]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_dde_discrepancy', $1, $2, 'DDE Discrepancy Resolution',
        'open', $3,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        $4
      )
    `, [
      resolution.resolvedBy,
      disc.event_crf_id,
      resolution.resolution,
      resolution.adjudicationNotes || `Resolved as ${resolution.resolution}`
    ]);

    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error resolving discrepancy', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finalize DDE (all discrepancies must be resolved)
 */
export async function finalizeDDE(eventCrfId: number, userId: number): Promise<DDEStatus> {
  logger.info('Finalizing DDE', { eventCrfId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check all discrepancies are resolved
    const openResult = await client.query(`
      SELECT COUNT(*) as open_count
      FROM acc_dde_discrepancy
      WHERE event_crf_id = $1 AND resolution_status = 'open'
    `, [eventCrfId]);

    const openCount = parseInt(openResult.rows[0]?.open_count || '0');
    if (openCount > 0) {
      throw new Error(`Cannot finalize: ${openCount} unresolved discrepancies remain`);
    }

    // Update DDE status to complete
    await client.query(`
      UPDATE acc_dde_status
      SET dde_complete = true,
          comparison_status = 'resolved',
          date_updated = CURRENT_TIMESTAMP
      WHERE event_crf_id = $1
    `, [eventCrfId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_dde_status', $1, $2, 'DDE Finalized',
        'in_progress', 'complete',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        'Double data entry finalized'
      )
    `, [userId, eventCrfId]);

    await client.query('COMMIT');

    return (await getDDEStatus(eventCrfId))!;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error finalizing DDE', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get DDE dashboard items (pending work)
 */
export async function getDDEDashboard(
  userId: number,
  siteId?: number
): Promise<{
  pendingSecondEntry: DDEDashboardItem[];
  pendingResolution: DDEDashboardItem[];
  stats: { total: number; pending: number; discrepancies: number; complete: number };
}> {
  try {
    // Base query conditions
    let siteCondition = '';
    const params: any[] = [];

    if (siteId) {
      params.push(siteId);
      siteCondition = 'AND ss.study_id = $1';
    }

    // Get forms pending second entry
    const pendingSecondQuery = `
      SELECT 
        ds.event_crf_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        site.name as site_name,
        cv.name as form_name,
        sed.name as event_name,
        ds.*,
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - ds.first_entry_at)) as days_waiting
      FROM acc_dde_status ds
      JOIN event_crf ec ON ds.event_crf_id = ec.event_crf_id
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      JOIN study site ON ss.study_id = site.study_id
      JOIN study s ON COALESCE(site.parent_study_id, site.study_id) = s.study_id
      WHERE ds.first_entry_status = 'complete'
        AND ds.second_entry_status != 'complete'
        AND ds.dde_complete = false
        ${siteCondition}
      ORDER BY ds.first_entry_at ASC
      LIMIT 50
    `;

    const pendingSecondResult = await pool.query(pendingSecondQuery, params);

    // Get forms with unresolved discrepancies
    const pendingResolutionQuery = `
      SELECT 
        ds.event_crf_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        site.name as site_name,
        cv.name as form_name,
        sed.name as event_name,
        ds.*,
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - ds.second_entry_at)) as days_waiting
      FROM acc_dde_status ds
      JOIN event_crf ec ON ds.event_crf_id = ec.event_crf_id
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      JOIN study site ON ss.study_id = site.study_id
      JOIN study s ON COALESCE(site.parent_study_id, site.study_id) = s.study_id
      WHERE ds.second_entry_status = 'complete'
        AND ds.comparison_status = 'discrepancies'
        AND ds.dde_complete = false
        ${siteCondition}
      ORDER BY ds.second_entry_at ASC
      LIMIT 50
    `;

    const pendingResolutionResult = await pool.query(pendingResolutionQuery, params);

    // Get stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN second_entry_status != 'complete' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN comparison_status = 'discrepancies' THEN 1 ELSE 0 END) as discrepancies,
        SUM(CASE WHEN dde_complete = true THEN 1 ELSE 0 END) as complete
      FROM acc_dde_status
    `;

    const statsResult = await pool.query(statsQuery);
    const stats = statsResult.rows[0];

    return {
      pendingSecondEntry: pendingSecondResult.rows.map(mapRowToDashboardItem),
      pendingResolution: pendingResolutionResult.rows.map(mapRowToDashboardItem),
      stats: {
        total: parseInt(stats?.total || '0'),
        pending: parseInt(stats?.pending || '0'),
        discrepancies: parseInt(stats?.discrepancies || '0'),
        complete: parseInt(stats?.complete || '0')
      }
    };
  } catch (error: any) {
    logger.error('Error getting DDE dashboard', { error: error.message });
    return {
      pendingSecondEntry: [],
      pendingResolution: [],
      stats: { total: 0, pending: 0, discrepancies: 0, complete: 0 }
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeForComparison(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function mapRowToDDEStatus(row: any): DDEStatus {
  return {
    statusId: row.status_id,
    eventCrfId: row.event_crf_id,
    firstEntryStatus: row.first_entry_status,
    firstEntryBy: row.first_entry_by,
    firstEntryByName: row.first_entry_by_name,
    firstEntryAt: row.first_entry_at,
    secondEntryStatus: row.second_entry_status,
    secondEntryBy: row.second_entry_by,
    secondEntryByName: row.second_entry_by_name,
    secondEntryAt: row.second_entry_at,
    comparisonStatus: row.comparison_status,
    totalItems: row.total_items || 0,
    matchedItems: row.matched_items || 0,
    discrepancyCount: row.discrepancy_count || 0,
    resolvedCount: row.resolved_count || 0,
    ddeComplete: row.dde_complete || false
  };
}

function mapRowToDashboardItem(row: any): DDEDashboardItem {
  return {
    eventCrfId: row.event_crf_id,
    studySubjectId: row.study_subject_id,
    subjectLabel: row.subject_label,
    studyName: row.study_name,
    siteName: row.site_name,
    formName: row.form_name,
    eventName: row.event_name,
    ddeStatus: mapRowToDDEStatus(row),
    daysWaiting: parseInt(row.days_waiting || '0')
  };
}

// Need to add unique constraint for discrepancy table
// This is added in the migration but noted here for reference

export default {
  isDDERequired,
  getDDEStatus,
  canUserPerformDDE,
  markFirstEntryComplete,
  submitSecondEntry,
  compareEntries,
  resolveDiscrepancy,
  finalizeDDE,
  getDDEDashboard
};

