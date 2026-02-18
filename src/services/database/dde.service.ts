/**
 * Double Data Entry (DDE) Service
 * 
 * Implements double data entry workflow using LibreClinica's NATIVE tables.
 * LibreClinica already supports DDE via:
 * - event_definition_crf.double_entry (boolean flag)
 * - event_crf.completion_status_id (1=not_started, 2=initial_data_entry, 3=complete, etc.)
 * - event_crf.validator_id (stores second entry user)
 * - Uses discrepancy_note for tracking differences
 * 
 * 21 CFR Part 11 Compliance:
 * - Full audit trail via audit_log_event
 * - Different user required for second entry (validator)
 * - Complete data integrity checks
 * 
 * NOTE: This version uses ONLY existing LibreClinica tables - NO custom acc_* tables
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { stripExtendedProps } from '../../utils/extended-props';

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
// LibreClinica Completion Status IDs
// ============================================================================
// From LibreClinica's completion_status table:
// 1 = not_started
// 2 = initial_data_entry (first entry in progress)
// 3 = initial_data_entry_complete (first entry done, awaiting second)
// 4 = double_data_entry (second entry in progress)  
// 5 = double_data_entry_complete (both entries done)
// ============================================================================

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
 * Uses LibreClinica's native completion_status_id and validator fields
 */
export async function getDDEStatus(eventCrfId: number): Promise<DDEStatus | null> {
  try {
    const query = `
      SELECT 
        ec.event_crf_id,
        ec.completion_status_id,
        cs.name as completion_status_name,
        ec.owner_id as first_entry_by,
        CONCAT(u1.first_name, ' ', u1.last_name) as first_entry_by_name,
        ec.date_created as first_entry_at,
        ec.validator_id as second_entry_by,
        CONCAT(u2.first_name, ' ', u2.last_name) as second_entry_by_name,
        ec.date_validate as second_entry_at,
        edc.double_entry,
        (SELECT COUNT(*) FROM item_data WHERE event_crf_id = ec.event_crf_id AND status_id = 1) as total_items,
        (SELECT COUNT(*) FROM discrepancy_note dn 
         INNER JOIN dn_event_crf_map dem ON dn.discrepancy_note_id = dem.discrepancy_note_id
         WHERE dem.event_crf_id = ec.event_crf_id AND dn.discrepancy_note_type_id = 4
         AND dn.resolution_status_id = 1) as open_discrepancies
      FROM event_crf ec
      JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON ec.validator_id = u2.user_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      LEFT JOIN crf c ON cv.crf_id = c.crf_id
      LEFT JOIN event_definition_crf edc ON edc.crf_id = c.crf_id 
        AND edc.study_event_definition_id = se.study_event_definition_id
      WHERE ec.event_crf_id = $1
    `;

    const result = await pool.query(query, [eventCrfId]);

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToDDEStatus(result.rows[0]);
  } catch (error: any) {
    logger.error('Error getting DDE status', { error: error.message, eventCrfId });
    return null;
  }
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
      return { allowed: false, reason: 'Form not found' };
    }

    // If first entry not complete, any user can do it
    if (status.firstEntryStatus !== 'complete') {
      return { allowed: true, entryType: 'first' };
    }

    // Check if DDE is required
    const isRequired = await isDDERequired(eventCrfId);
    if (!isRequired) {
      return { allowed: false, reason: 'DDE not required for this form' };
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
 * Updates LibreClinica's completion_status_id to 3 (initial_data_entry_complete)
 */
export async function markFirstEntryComplete(
  eventCrfId: number,
  userId: number
): Promise<DDEStatus> {
  logger.info('Marking first entry complete', { eventCrfId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update event_crf completion status to initial_data_entry_complete (3)
    await client.query(`
      UPDATE event_crf
      SET completion_status_id = 3,
          date_updated = CURRENT_TIMESTAMP,
          update_id = $2
      WHERE event_crf_id = $1
    `, [eventCrfId, userId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change,
        event_crf_id
      ) VALUES (
        CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'DDE First Entry Complete',
        'initial_data_entry', 'initial_data_entry_complete', 2,
        'First data entry completed for DDE', $2
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
 * Stores second entry values as annotations and updates validator_id
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

    // Store second entry values in validator_annotations as JSON
    const secondEntryData = JSON.stringify(request.entries.map(e => ({
      itemId: e.itemId,
      value: e.value
    })));

    // Update event_crf with validator info and completion status
    await client.query(`
      UPDATE event_crf
      SET validator_id = $2,
          date_validate = CURRENT_TIMESTAMP,
          validator_annotations = $3,
          completion_status_id = 4,
          date_updated = CURRENT_TIMESTAMP,
          update_id = $2
      WHERE event_crf_id = $1
    `, [request.eventCrfId, request.userId, secondEntryData]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change,
        event_crf_id
      ) VALUES (
        CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'DDE Second Entry Submitted',
        'initial_data_entry_complete', 'double_data_entry', 2,
        'Second data entry submitted for comparison', $2
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
 * Creates discrepancy_notes for mismatches using LibreClinica's native query system
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

  // Get second entries from validator_annotations
  const eventCrfResult = await pool.query(`
    SELECT 
      ec.validator_annotations,
      ss.label as subject_label,
      ss.study_subject_id,
      cv.name as form_name
    FROM event_crf ec
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    WHERE ec.event_crf_id = $1
  `, [eventCrfId]);

  const eventCrf = eventCrfResult.rows[0] || {};
  let secondEntries: { itemId: number; value: string }[] = [];
  
  try {
    if (eventCrf.validator_annotations) {
      secondEntries = JSON.parse(eventCrf.validator_annotations);
    }
  } catch (e) {
    logger.warn('Could not parse validator_annotations', { eventCrfId });
  }

  // Build lookup for second entries
  const secondEntriesMap: Record<number, string> = {};
  for (const entry of secondEntries) {
    secondEntriesMap[entry.itemId] = entry.value;
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

      if (matches) {
        matched++;
      } else {
        discrepancies++;
        
        // Create discrepancy note using LibreClinica's native system
        // discrepancy_note_type_id = 4 is "Reason for Change" - we use it for DDE
        const discResult = await client.query(`
          INSERT INTO discrepancy_note (
            description, discrepancy_note_type_id, resolution_status_id,
            detailed_notes, date_created, date_updated, owner_id,
            entity_type, entity_id, study_id
          )
          SELECT 
            'DDE Discrepancy: First value differs from second entry',
            4, 1, $2,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ec.owner_id,
            'itemData', $3, ss.study_id
          FROM event_crf ec
          JOIN study_event se ON ec.study_event_id = se.study_event_id
          JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
          WHERE ec.event_crf_id = $1
          RETURNING discrepancy_note_id
        `, [
          eventCrfId,
          JSON.stringify({ firstValue: first.value, secondValue }),
          first.item_data_id
        ]);

        // Link to item_data via dn_item_data_map
        if (discResult.rows.length > 0) {
          await client.query(`
            INSERT INTO dn_item_data_map (
              discrepancy_note_id, item_data_id, study_subject_id
            )
            SELECT $1, $2, ss.study_subject_id
            FROM event_crf ec
            JOIN study_event se ON ec.study_event_id = se.study_event_id
            JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
            WHERE ec.event_crf_id = $3
          `, [discResult.rows[0].discrepancy_note_id, first.item_data_id, eventCrfId]);
        }
      }

      // Check for existing discrepancy
      const existingDiscResult = await client.query(`
        SELECT dn.discrepancy_note_id, dn.resolution_status_id, dn.detailed_notes,
               CONCAT(u.first_name, ' ', u.last_name) as resolved_by
        FROM discrepancy_note dn
        INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
        LEFT JOIN user_account u ON dn.update_id = u.user_id
        WHERE dim.item_data_id = $1 AND dn.discrepancy_note_type_id = 4
        ORDER BY dn.date_created DESC
        LIMIT 1
      `, [first.item_data_id]);

      const disc = existingDiscResult.rows[0];

      comparisons.push({
        itemId: first.item_id,
        itemName: first.item_name,
        itemDescription: stripExtendedProps(first.description),
        firstValue: first.value,
        secondValue: secondValue,
        matches,
        discrepancyId: disc?.discrepancy_note_id,
        resolutionStatus: disc?.resolution_status_id === 4 ? 'resolved' : 'open',
        resolvedBy: disc?.resolved_by
      });
    }

    // Update completion status if no discrepancies
    if (discrepancies === 0) {
      await client.query(`
        UPDATE event_crf
        SET completion_status_id = 5,
            date_validate_completed = CURRENT_TIMESTAMP,
            date_updated = CURRENT_TIMESTAMP
        WHERE event_crf_id = $1
      `, [eventCrfId]);
    }

    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    eventCrfId,
    subjectLabel: eventCrf.subject_label || '',
    formName: eventCrf.form_name || '',
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
 * Uses LibreClinica's native discrepancy_note resolution
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
      SELECT dn.*, dim.item_data_id, id.value as first_value, id.event_crf_id
      FROM discrepancy_note dn
      LEFT JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
      LEFT JOIN item_data id ON dim.item_data_id = id.item_data_id
      WHERE dn.discrepancy_note_id = $1
    `, [resolution.discrepancyId]);

    if (discResult.rows.length === 0) {
      throw new Error('Discrepancy not found');
    }

    const disc = discResult.rows[0];
    let detailedNotes: any = {};
    try {
      detailedNotes = JSON.parse(disc.detailed_notes || '{}');
    } catch (e) {}

    // Determine resolved value
    let resolvedValue: string;
    switch (resolution.resolution) {
      case 'first_correct':
        resolvedValue = disc.first_value;
        break;
      case 'second_correct':
        resolvedValue = detailedNotes.secondValue || '';
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

    // Update discrepancy note - resolution_status_id = 4 is "Closed"
    await client.query(`
      UPDATE discrepancy_note
      SET resolution_status_id = 4,
          detailed_notes = $1,
          date_updated = CURRENT_TIMESTAMP,
          update_id = $2
      WHERE discrepancy_note_id = $3
    `, [
      JSON.stringify({ ...detailedNotes, resolvedValue, resolution: resolution.resolution, adjudicationNotes: resolution.adjudicationNotes }),
      resolution.resolvedBy,
      resolution.discrepancyId
    ]);

    // Update the actual item_data with resolved value
    if (disc.item_data_id) {
      await client.query(`
        UPDATE item_data
        SET value = $1, date_updated = CURRENT_TIMESTAMP, update_id = $2
        WHERE item_data_id = $3
      `, [resolvedValue, resolution.resolvedBy, disc.item_data_id]);

      // Log to audit trail
      await client.query(`
        INSERT INTO audit_log_event (
          audit_date, audit_table, user_id, entity_id, entity_name,
          old_value, new_value, audit_log_event_type_id, reason_for_change,
          event_crf_id
        ) VALUES (
          CURRENT_TIMESTAMP, 'item_data', $1, $2, 'DDE Resolution',
          $3, $4, 1, $5, $6
        )
      `, [
        resolution.resolvedBy,
        disc.item_data_id,
        disc.first_value,
        resolvedValue,
        resolution.adjudicationNotes || `DDE resolved as ${resolution.resolution}`,
        disc.event_crf_id
      ]);
    }

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
      FROM discrepancy_note dn
      INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
      INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
      WHERE id.event_crf_id = $1 
        AND dn.discrepancy_note_type_id = 4
        AND dn.resolution_status_id != 4
    `, [eventCrfId]);

    const openCount = parseInt(openResult.rows[0]?.open_count || '0');
    if (openCount > 0) {
      throw new Error(`Cannot finalize: ${openCount} unresolved discrepancies remain`);
    }

    // Update completion_status_id to 5 (double_data_entry_complete)
    await client.query(`
      UPDATE event_crf
      SET completion_status_id = 5,
          date_validate_completed = CURRENT_TIMESTAMP,
          date_updated = CURRENT_TIMESTAMP,
          update_id = $2
      WHERE event_crf_id = $1
    `, [eventCrfId, userId]);

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change,
        event_crf_id
      ) VALUES (
        CURRENT_TIMESTAMP, 'event_crf', $1, $2, 'DDE Finalized',
        'double_data_entry', 'double_data_entry_complete', 2,
        'Double data entry finalized', $2
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
 * Uses LibreClinica's native completion_status to determine DDE state
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
    // Get forms pending second entry (completion_status = 3)
    const pendingSecondQuery = `
      SELECT 
        ec.event_crf_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        site.name as site_name,
        cv.name as form_name,
        sed.name as event_name,
        ec.completion_status_id,
        ec.owner_id as first_entry_by,
        CONCAT(u1.first_name, ' ', u1.last_name) as first_entry_by_name,
        ec.date_created as first_entry_at,
        ec.validator_id as second_entry_by,
        CONCAT(u2.first_name, ' ', u2.last_name) as second_entry_by_name,
        ec.date_validate as second_entry_at,
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - ec.date_created)) as days_waiting
      FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN crf c ON cv.crf_id = c.crf_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      JOIN study site ON ss.study_id = site.study_id
      JOIN study s ON COALESCE(site.parent_study_id, site.study_id) = s.study_id
      JOIN event_definition_crf edc ON edc.crf_id = c.crf_id 
        AND edc.study_event_definition_id = se.study_event_definition_id
      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON ec.validator_id = u2.user_id
      WHERE ec.completion_status_id = 3
        AND edc.double_entry = true
        ${siteId ? 'AND ss.study_id = $1' : ''}
      ORDER BY ec.date_created ASC
      LIMIT 50
    `;

    const pendingSecondResult = await pool.query(pendingSecondQuery, siteId ? [siteId] : []);

    // Get forms with unresolved discrepancies (completion_status = 4)
    const pendingResolutionQuery = `
      SELECT 
        ec.event_crf_id,
        ss.study_subject_id,
        ss.label as subject_label,
        s.name as study_name,
        site.name as site_name,
        cv.name as form_name,
        sed.name as event_name,
        ec.completion_status_id,
        ec.owner_id as first_entry_by,
        CONCAT(u1.first_name, ' ', u1.last_name) as first_entry_by_name,
        ec.date_created as first_entry_at,
        ec.validator_id as second_entry_by,
        CONCAT(u2.first_name, ' ', u2.last_name) as second_entry_by_name,
        ec.date_validate as second_entry_at,
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - ec.date_validate)) as days_waiting,
        (SELECT COUNT(*) FROM discrepancy_note dn 
         INNER JOIN dn_item_data_map dim ON dn.discrepancy_note_id = dim.discrepancy_note_id
         INNER JOIN item_data id ON dim.item_data_id = id.item_data_id
         WHERE id.event_crf_id = ec.event_crf_id AND dn.discrepancy_note_type_id = 4 
         AND dn.resolution_status_id != 4) as open_discrepancies
      FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN crf c ON cv.crf_id = c.crf_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      JOIN study site ON ss.study_id = site.study_id
      JOIN study s ON COALESCE(site.parent_study_id, site.study_id) = s.study_id
      JOIN event_definition_crf edc ON edc.crf_id = c.crf_id 
        AND edc.study_event_definition_id = se.study_event_definition_id
      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON ec.validator_id = u2.user_id
      WHERE ec.completion_status_id = 4
        AND edc.double_entry = true
        ${siteId ? 'AND ss.study_id = $1' : ''}
      ORDER BY ec.date_validate ASC
      LIMIT 50
    `;

    const pendingResolutionResult = await pool.query(pendingResolutionQuery, siteId ? [siteId] : []);

    // Get stats
    const statsQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE ec.completion_status_id IN (3, 4, 5) AND edc.double_entry = true) as total,
        COUNT(*) FILTER (WHERE ec.completion_status_id = 3 AND edc.double_entry = true) as pending,
        COUNT(*) FILTER (WHERE ec.completion_status_id = 4 AND edc.double_entry = true) as discrepancies,
        COUNT(*) FILTER (WHERE ec.completion_status_id = 5 AND edc.double_entry = true) as complete
      FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN crf c ON cv.crf_id = c.crf_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN event_definition_crf edc ON edc.crf_id = c.crf_id 
        AND edc.study_event_definition_id = se.study_event_definition_id
    `;

    const statsResult = await pool.query(statsQuery);
    const stats = statsResult.rows[0] || {};

    return {
      pendingSecondEntry: pendingSecondResult.rows.map(mapRowToDashboardItem),
      pendingResolution: pendingResolutionResult.rows.map(mapRowToDashboardItem),
      stats: {
        total: parseInt(stats.total || '0'),
        pending: parseInt(stats.pending || '0'),
        discrepancies: parseInt(stats.discrepancies || '0'),
        complete: parseInt(stats.complete || '0')
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
  // Map LibreClinica completion_status_id to DDE status
  // 1 = not_started, 2 = initial_data_entry, 3 = initial_data_entry_complete,
  // 4 = double_data_entry, 5 = double_data_entry_complete
  
  const completionStatus = row.completion_status_id;
  
  let firstEntryStatus: 'pending' | 'in_progress' | 'complete' = 'pending';
  let secondEntryStatus: 'pending' | 'in_progress' | 'complete' = 'pending';
  let comparisonStatus: 'pending' | 'matched' | 'discrepancies' | 'resolved' = 'pending';
  let ddeComplete = false;

  if (completionStatus >= 2) firstEntryStatus = 'in_progress';
  if (completionStatus >= 3) firstEntryStatus = 'complete';
  if (completionStatus >= 4) secondEntryStatus = 'complete';
  if (completionStatus === 4) comparisonStatus = row.open_discrepancies > 0 ? 'discrepancies' : 'matched';
  if (completionStatus === 5) {
    comparisonStatus = 'resolved';
    ddeComplete = true;
  }

  return {
    statusId: row.event_crf_id,
    eventCrfId: row.event_crf_id,
    firstEntryStatus,
    firstEntryBy: row.first_entry_by,
    firstEntryByName: row.first_entry_by_name,
    firstEntryAt: row.first_entry_at,
    secondEntryStatus,
    secondEntryBy: row.second_entry_by,
    secondEntryByName: row.second_entry_by_name,
    secondEntryAt: row.second_entry_at,
    comparisonStatus,
    totalItems: parseInt(row.total_items || '0'),
    matchedItems: parseInt(row.total_items || '0') - parseInt(row.open_discrepancies || '0'),
    discrepancyCount: parseInt(row.open_discrepancies || '0'),
    resolvedCount: 0,
    ddeComplete
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
