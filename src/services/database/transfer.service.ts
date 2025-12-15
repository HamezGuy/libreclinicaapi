/**
 * Subject Transfer Service
 * 
 * Handles subject transfers between sites within a study.
 * Includes approval workflow, audit logging, and notification triggers.
 * 
 * 21 CFR Part 11 Compliance:
 * - Full audit trail of all transfer actions
 * - Electronic signatures for approvals
 * - Atomic transactions for data integrity
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { 
  verifyPasswordForSignature, 
  applyElectronicSignature,
  SignatureRequest 
} from './esignature.service';

// ============================================================================
// Types
// ============================================================================

export interface TransferRequest {
  studySubjectId: number;
  destinationSiteId: number;
  reasonForTransfer: string;
  notes?: string;
  initiatedBy: number;
  requiresApprovals?: boolean; // Default true
}

export interface TransferApproval {
  transferId: number;
  approvalType: 'source' | 'destination';
  approvedBy: number;
  password: string; // For e-signature verification
}

export interface TransferCancellation {
  transferId: number;
  cancelledBy: number;
  cancelReason: string;
}

export interface Transfer {
  transferId: number;
  studySubjectId: number;
  studyId: number;
  subjectLabel: string;
  sourceSiteId: number;
  sourceSiteName: string;
  destinationSiteId: number;
  destinationSiteName: string;
  reasonForTransfer: string;
  transferStatus: 'pending' | 'approved' | 'completed' | 'cancelled';
  requiresApprovals: boolean;
  initiatedBy: number;
  initiatedByName: string;
  initiatedAt: Date;
  sourceApprovedBy?: number;
  sourceApprovedByName?: string;
  sourceApprovedAt?: Date;
  destinationApprovedBy?: number;
  destinationApprovedByName?: string;
  destinationApprovedAt?: Date;
  completedBy?: number;
  completedByName?: string;
  completedAt?: Date;
  cancelledBy?: number;
  cancelledByName?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  notes?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get user name by ID
 */
async function getUserName(userId: number): Promise<string> {
  const result = await pool.query(
    'SELECT first_name, last_name FROM user_account WHERE user_id = $1',
    [userId]
  );
  if (result.rows[0]) {
    return `${result.rows[0].first_name} ${result.rows[0].last_name}`;
  }
  return 'Unknown User';
}

/**
 * Get site name by ID (sites are child studies in LibreClinica)
 */
async function getSiteName(siteId: number): Promise<string> {
  const result = await pool.query(
    'SELECT name FROM study WHERE study_id = $1',
    [siteId]
  );
  return result.rows[0]?.name || 'Unknown Site';
}

/**
 * Get subject's current site ID
 */
async function getSubjectSiteId(studySubjectId: number): Promise<number | null> {
  const result = await pool.query(
    'SELECT study_id FROM study_subject WHERE study_subject_id = $1',
    [studySubjectId]
  );
  return result.rows[0]?.study_id || null;
}

/**
 * Get parent study ID for a site
 */
async function getParentStudyId(siteId: number): Promise<number | null> {
  const result = await pool.query(
    'SELECT parent_study_id, study_id FROM study WHERE study_id = $1',
    [siteId]
  );
  // If parent_study_id is null, this is the parent study itself
  return result.rows[0]?.parent_study_id || result.rows[0]?.study_id || null;
}

// ============================================================================
// Transfer Operations
// ============================================================================

/**
 * Initiate a subject transfer
 */
export async function initiateTransfer(request: TransferRequest): Promise<Transfer> {
  logger.info('Initiating subject transfer', {
    studySubjectId: request.studySubjectId,
    destinationSiteId: request.destinationSiteId,
    initiatedBy: request.initiatedBy
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get current subject info
    const subjectResult = await client.query(`
      SELECT ss.study_subject_id, ss.label, ss.study_id, s.parent_study_id
      FROM study_subject ss
      JOIN study s ON ss.study_id = s.study_id
      WHERE ss.study_subject_id = $1
    `, [request.studySubjectId]);

    if (subjectResult.rows.length === 0) {
      throw new Error('Subject not found');
    }

    const subject = subjectResult.rows[0];
    const sourceSiteId = subject.study_id;
    const studyId = subject.parent_study_id || sourceSiteId;

    // 2. Verify destination site is in the same study
    const destSiteResult = await client.query(`
      SELECT study_id, parent_study_id, name FROM study WHERE study_id = $1
    `, [request.destinationSiteId]);

    if (destSiteResult.rows.length === 0) {
      throw new Error('Destination site not found');
    }

    const destParentId = destSiteResult.rows[0].parent_study_id;
    if (destParentId !== studyId && request.destinationSiteId !== studyId) {
      throw new Error('Destination site is not in the same study');
    }

    if (sourceSiteId === request.destinationSiteId) {
      throw new Error('Source and destination sites are the same');
    }

    // 3. Check for existing pending transfer
    const pendingResult = await client.query(`
      SELECT transfer_id FROM acc_transfer_log
      WHERE study_subject_id = $1 AND transfer_status = 'pending'
    `, [request.studySubjectId]);

    if (pendingResult.rows.length > 0) {
      throw new Error('Subject already has a pending transfer');
    }

    // 4. Create transfer record
    const insertResult = await client.query(`
      INSERT INTO acc_transfer_log (
        study_subject_id, study_id, source_site_id, destination_site_id,
        reason_for_transfer, transfer_status, requires_approvals,
        initiated_by, initiated_at, notes, date_created, date_updated
      ) VALUES (
        $1, $2, $3, $4, $5, 'pending', $6, $7, CURRENT_TIMESTAMP, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING transfer_id
    `, [
      request.studySubjectId,
      studyId,
      sourceSiteId,
      request.destinationSiteId,
      request.reasonForTransfer,
      request.requiresApprovals !== false,
      request.initiatedBy,
      request.notes || null
    ]);

    const transferId = insertResult.rows[0].transfer_id;

    // 5. Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_transfer_log', $1, $2, 'Subject Transfer',
        NULL, 'Transfer initiated', 
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1),
        $3
      )
    `, [request.initiatedBy, request.studySubjectId, request.reasonForTransfer]);

    await client.query('COMMIT');

    logger.info('Transfer initiated successfully', { transferId });

    // Get and return full transfer details
    return await getTransferDetails(transferId);

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to initiate transfer', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approve a transfer (source or destination site)
 */
export async function approveTransfer(approval: TransferApproval): Promise<Transfer> {
  logger.info('Approving transfer', {
    transferId: approval.transferId,
    approvalType: approval.approvalType,
    approvedBy: approval.approvedBy
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get transfer details
    const transferResult = await client.query(`
      SELECT * FROM acc_transfer_log WHERE transfer_id = $1
    `, [approval.transferId]);

    if (transferResult.rows.length === 0) {
      throw new Error('Transfer not found');
    }

    const transfer = transferResult.rows[0];

    if (transfer.transfer_status !== 'pending') {
      throw new Error(`Transfer is not pending (status: ${transfer.transfer_status})`);
    }

    // 2. Get user info for e-signature
    const userResult = await client.query(
      'SELECT user_name, first_name, last_name FROM user_account WHERE user_id = $1',
      [approval.approvedBy]
    );
    
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }
    
    const user = userResult.rows[0];
    const username = user.user_name;
    const userFullName = `${user.first_name} ${user.last_name}`;

    // 3. Apply e-signature (includes password verification)
    const signatureRequest: SignatureRequest = {
      userId: approval.approvedBy,
      username: username,
      userFullName: userFullName,
      entityType: 'study_subject', // Use valid entity type for LibreClinica
      entityId: transfer.study_subject_id,
      password: approval.password,
      meaning: 'approval',
      reasonForSigning: `Approved ${approval.approvalType} site transfer for subject ${transfer.study_subject_id}`
    };

    const signatureResult = await applyElectronicSignature(signatureRequest);

    if (!signatureResult.success) {
      throw new Error(signatureResult.message || 'Failed to apply electronic signature');
    }

    // 4. Update transfer with approval
    const updateColumn = approval.approvalType === 'source'
      ? 'source_approved_by'
      : 'destination_approved_by';
    const dateColumn = approval.approvalType === 'source'
      ? 'source_approved_at'
      : 'destination_approved_at';
    const signatureColumn = approval.approvalType === 'source'
      ? 'source_signature_id'
      : 'destination_signature_id';

    await client.query(`
      UPDATE acc_transfer_log
      SET ${updateColumn} = $1,
          ${dateColumn} = CURRENT_TIMESTAMP,
          ${signatureColumn} = $2,
          date_updated = CURRENT_TIMESTAMP
      WHERE transfer_id = $3
    `, [approval.approvedBy, signatureResult.data?.signatureId || null, approval.transferId]);

    // 5. Check if both approvals are complete
    const updatedResult = await client.query(`
      SELECT source_approved_by, destination_approved_by, requires_approvals
      FROM acc_transfer_log WHERE transfer_id = $1
    `, [approval.transferId]);

    const updated = updatedResult.rows[0];
    
    // If approvals not required, or both approvals received, mark as approved
    if (!updated.requires_approvals || 
        (updated.source_approved_by && updated.destination_approved_by)) {
      await client.query(`
        UPDATE acc_transfer_log
        SET transfer_status = 'approved',
            date_updated = CURRENT_TIMESTAMP
        WHERE transfer_id = $1
      `, [approval.transferId]);
    }

    // 6. Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_transfer_log', $1, $2, 'Subject Transfer',
        'pending', $3, 
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        $4
      )
    `, [
      approval.approvedBy,
      transfer.study_subject_id,
      `${approval.approvalType} approved`,
      `${approval.approvalType} site approval`
    ]);

    await client.query('COMMIT');

    logger.info('Transfer approved', { 
      transferId: approval.transferId, 
      approvalType: approval.approvalType 
    });

    return await getTransferDetails(approval.transferId);

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to approve transfer', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Complete a transfer (move subject to new site)
 */
export async function completeTransfer(
  transferId: number,
  completedBy: number
): Promise<Transfer> {
  logger.info('Completing transfer', { transferId, completedBy });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get transfer details
    const transferResult = await client.query(`
      SELECT tl.*, ss.label as subject_label,
             src.name as source_site_name, dst.name as dest_site_name
      FROM acc_transfer_log tl
      JOIN study_subject ss ON tl.study_subject_id = ss.study_subject_id
      JOIN study src ON tl.source_site_id = src.study_id
      JOIN study dst ON tl.destination_site_id = dst.study_id
      WHERE tl.transfer_id = $1
    `, [transferId]);

    if (transferResult.rows.length === 0) {
      throw new Error('Transfer not found');
    }

    const transfer = transferResult.rows[0];

    // 2. Verify transfer is approved (or doesn't require approvals)
    if (transfer.requires_approvals) {
      if (!transfer.source_approved_by || !transfer.destination_approved_by) {
        throw new Error('All approvals required before completing transfer');
      }
    }

    if (transfer.transfer_status === 'completed') {
      throw new Error('Transfer already completed');
    }

    if (transfer.transfer_status === 'cancelled') {
      throw new Error('Transfer was cancelled');
    }

    // 3. Update study_subject to new site
    await client.query(`
      UPDATE study_subject
      SET study_id = $1,
          date_updated = CURRENT_TIMESTAMP,
          update_id = $2
      WHERE study_subject_id = $3
    `, [transfer.destination_site_id, completedBy, transfer.study_subject_id]);

    // 4. Update transfer log
    await client.query(`
      UPDATE acc_transfer_log
      SET transfer_status = 'completed',
          completed_by = $1,
          completed_at = CURRENT_TIMESTAMP,
          date_updated = CURRENT_TIMESTAMP
      WHERE transfer_id = $2
    `, [completedBy, transferId]);

    // 5. Create comprehensive audit log entry
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'study_subject', $1, $2, 'Site Transfer',
        $3, $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        $5
      )
    `, [
      completedBy,
      transfer.study_subject_id,
      transfer.source_site_name,
      transfer.dest_site_name,
      transfer.reason_for_transfer
    ]);

    await client.query('COMMIT');

    logger.info('Transfer completed', {
      transferId,
      subjectId: transfer.study_subject_id,
      fromSite: transfer.source_site_name,
      toSite: transfer.dest_site_name
    });

    return await getTransferDetails(transferId);

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to complete transfer', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cancel a pending transfer
 */
export async function cancelTransfer(cancellation: TransferCancellation): Promise<Transfer> {
  logger.info('Cancelling transfer', {
    transferId: cancellation.transferId,
    cancelledBy: cancellation.cancelledBy
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify transfer exists and is pending/approved
    const transferResult = await client.query(`
      SELECT * FROM acc_transfer_log WHERE transfer_id = $1
    `, [cancellation.transferId]);

    if (transferResult.rows.length === 0) {
      throw new Error('Transfer not found');
    }

    const transfer = transferResult.rows[0];

    if (transfer.transfer_status === 'completed') {
      throw new Error('Cannot cancel a completed transfer');
    }

    if (transfer.transfer_status === 'cancelled') {
      throw new Error('Transfer already cancelled');
    }

    // 2. Update transfer status
    await client.query(`
      UPDATE acc_transfer_log
      SET transfer_status = 'cancelled',
          cancelled_by = $1,
          cancelled_at = CURRENT_TIMESTAMP,
          cancel_reason = $2,
          date_updated = CURRENT_TIMESTAMP
      WHERE transfer_id = $3
    `, [cancellation.cancelledBy, cancellation.cancelReason, cancellation.transferId]);

    // 3. Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, audit_log_event_type_id, reason_for_change
      ) VALUES (
        CURRENT_TIMESTAMP, 'acc_transfer_log', $1, $2, 'Subject Transfer',
        $3, 'cancelled',
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        $4
      )
    `, [
      cancellation.cancelledBy,
      transfer.study_subject_id,
      transfer.transfer_status,
      cancellation.cancelReason
    ]);

    await client.query('COMMIT');

    logger.info('Transfer cancelled', { transferId: cancellation.transferId });

    return await getTransferDetails(cancellation.transferId);

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to cancel transfer', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get transfer details by ID
 */
export async function getTransferDetails(transferId: number): Promise<Transfer> {
  const query = `
    SELECT 
      tl.transfer_id,
      tl.study_subject_id,
      tl.study_id,
      ss.label as subject_label,
      tl.source_site_id,
      src.name as source_site_name,
      tl.destination_site_id,
      dst.name as destination_site_name,
      tl.reason_for_transfer,
      tl.transfer_status,
      tl.requires_approvals,
      tl.initiated_by,
      CONCAT(init.first_name, ' ', init.last_name) as initiated_by_name,
      tl.initiated_at,
      tl.source_approved_by,
      CONCAT(srcapp.first_name, ' ', srcapp.last_name) as source_approved_by_name,
      tl.source_approved_at,
      tl.destination_approved_by,
      CONCAT(dstapp.first_name, ' ', dstapp.last_name) as destination_approved_by_name,
      tl.destination_approved_at,
      tl.completed_by,
      CONCAT(comp.first_name, ' ', comp.last_name) as completed_by_name,
      tl.completed_at,
      tl.cancelled_by,
      CONCAT(canc.first_name, ' ', canc.last_name) as cancelled_by_name,
      tl.cancelled_at,
      tl.cancel_reason,
      tl.notes
    FROM acc_transfer_log tl
    JOIN study_subject ss ON tl.study_subject_id = ss.study_subject_id
    JOIN study src ON tl.source_site_id = src.study_id
    JOIN study dst ON tl.destination_site_id = dst.study_id
    JOIN user_account init ON tl.initiated_by = init.user_id
    LEFT JOIN user_account srcapp ON tl.source_approved_by = srcapp.user_id
    LEFT JOIN user_account dstapp ON tl.destination_approved_by = dstapp.user_id
    LEFT JOIN user_account comp ON tl.completed_by = comp.user_id
    LEFT JOIN user_account canc ON tl.cancelled_by = canc.user_id
    WHERE tl.transfer_id = $1
  `;

  const result = await pool.query(query, [transferId]);

  if (result.rows.length === 0) {
    throw new Error('Transfer not found');
  }

  const row = result.rows[0];
  return mapRowToTransfer(row);
}

/**
 * Get transfer history for a subject
 */
export async function getTransferHistory(studySubjectId: number): Promise<Transfer[]> {
  const query = `
    SELECT 
      tl.transfer_id,
      tl.study_subject_id,
      tl.study_id,
      ss.label as subject_label,
      tl.source_site_id,
      src.name as source_site_name,
      tl.destination_site_id,
      dst.name as destination_site_name,
      tl.reason_for_transfer,
      tl.transfer_status,
      tl.requires_approvals,
      tl.initiated_by,
      CONCAT(init.first_name, ' ', init.last_name) as initiated_by_name,
      tl.initiated_at,
      tl.source_approved_by,
      CONCAT(srcapp.first_name, ' ', srcapp.last_name) as source_approved_by_name,
      tl.source_approved_at,
      tl.destination_approved_by,
      CONCAT(dstapp.first_name, ' ', dstapp.last_name) as destination_approved_by_name,
      tl.destination_approved_at,
      tl.completed_by,
      CONCAT(comp.first_name, ' ', comp.last_name) as completed_by_name,
      tl.completed_at,
      tl.cancelled_by,
      CONCAT(canc.first_name, ' ', canc.last_name) as cancelled_by_name,
      tl.cancelled_at,
      tl.cancel_reason,
      tl.notes
    FROM acc_transfer_log tl
    JOIN study_subject ss ON tl.study_subject_id = ss.study_subject_id
    JOIN study src ON tl.source_site_id = src.study_id
    JOIN study dst ON tl.destination_site_id = dst.study_id
    JOIN user_account init ON tl.initiated_by = init.user_id
    LEFT JOIN user_account srcapp ON tl.source_approved_by = srcapp.user_id
    LEFT JOIN user_account dstapp ON tl.destination_approved_by = dstapp.user_id
    LEFT JOIN user_account comp ON tl.completed_by = comp.user_id
    LEFT JOIN user_account canc ON tl.cancelled_by = canc.user_id
    WHERE tl.study_subject_id = $1
    ORDER BY tl.initiated_at DESC
  `;

  const result = await pool.query(query, [studySubjectId]);
  return result.rows.map(mapRowToTransfer);
}

/**
 * Get pending transfers for a site
 */
export async function getPendingTransfers(siteId: number): Promise<Transfer[]> {
  const query = `
    SELECT 
      tl.transfer_id,
      tl.study_subject_id,
      tl.study_id,
      ss.label as subject_label,
      tl.source_site_id,
      src.name as source_site_name,
      tl.destination_site_id,
      dst.name as destination_site_name,
      tl.reason_for_transfer,
      tl.transfer_status,
      tl.requires_approvals,
      tl.initiated_by,
      CONCAT(init.first_name, ' ', init.last_name) as initiated_by_name,
      tl.initiated_at,
      tl.source_approved_by,
      CONCAT(srcapp.first_name, ' ', srcapp.last_name) as source_approved_by_name,
      tl.source_approved_at,
      tl.destination_approved_by,
      CONCAT(dstapp.first_name, ' ', dstapp.last_name) as destination_approved_by_name,
      tl.destination_approved_at,
      tl.completed_by,
      tl.completed_at,
      tl.cancelled_by,
      tl.cancelled_at,
      tl.cancel_reason,
      tl.notes
    FROM acc_transfer_log tl
    JOIN study_subject ss ON tl.study_subject_id = ss.study_subject_id
    JOIN study src ON tl.source_site_id = src.study_id
    JOIN study dst ON tl.destination_site_id = dst.study_id
    JOIN user_account init ON tl.initiated_by = init.user_id
    LEFT JOIN user_account srcapp ON tl.source_approved_by = srcapp.user_id
    LEFT JOIN user_account dstapp ON tl.destination_approved_by = dstapp.user_id
    WHERE tl.transfer_status IN ('pending', 'approved')
      AND (tl.source_site_id = $1 OR tl.destination_site_id = $1)
    ORDER BY tl.initiated_at DESC
  `;

  const result = await pool.query(query, [siteId]);
  return result.rows.map(mapRowToTransfer);
}

/**
 * Check if subject has a pending transfer
 */
export async function hasPendingTransfer(studySubjectId: number): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM acc_transfer_log
    WHERE study_subject_id = $1 AND transfer_status IN ('pending', 'approved')
    LIMIT 1
  `, [studySubjectId]);

  return result.rows.length > 0;
}

/**
 * Get available destination sites for transfer
 */
export async function getAvailableSites(
  studySubjectId: number,
  userId: number
): Promise<Array<{ siteId: number; siteName: string }>> {
  // Get subject's current study and site
  const subjectResult = await pool.query(`
    SELECT ss.study_id as current_site_id, s.parent_study_id
    FROM study_subject ss
    JOIN study s ON ss.study_id = s.study_id
    WHERE ss.study_subject_id = $1
  `, [studySubjectId]);

  if (subjectResult.rows.length === 0) {
    return [];
  }

  const currentSiteId = subjectResult.rows[0].current_site_id;
  const parentStudyId = subjectResult.rows[0].parent_study_id || currentSiteId;

  // Get all sites in the same study, excluding current site
  const sitesResult = await pool.query(`
    SELECT s.study_id, s.name
    FROM study s
    WHERE (s.parent_study_id = $1 OR s.study_id = $1)
      AND s.study_id != $2
      AND s.status_id = 1
    ORDER BY s.name
  `, [parentStudyId, currentSiteId]);

  return sitesResult.rows.map(row => ({
    siteId: row.study_id,
    siteName: row.name
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapRowToTransfer(row: any): Transfer {
  return {
    transferId: row.transfer_id,
    studySubjectId: row.study_subject_id,
    studyId: row.study_id,
    subjectLabel: row.subject_label,
    sourceSiteId: row.source_site_id,
    sourceSiteName: row.source_site_name,
    destinationSiteId: row.destination_site_id,
    destinationSiteName: row.destination_site_name,
    reasonForTransfer: row.reason_for_transfer,
    transferStatus: row.transfer_status,
    requiresApprovals: row.requires_approvals,
    initiatedBy: row.initiated_by,
    initiatedByName: row.initiated_by_name,
    initiatedAt: row.initiated_at,
    sourceApprovedBy: row.source_approved_by,
    sourceApprovedByName: row.source_approved_by_name,
    sourceApprovedAt: row.source_approved_at,
    destinationApprovedBy: row.destination_approved_by,
    destinationApprovedByName: row.destination_approved_by_name,
    destinationApprovedAt: row.destination_approved_at,
    completedBy: row.completed_by,
    completedByName: row.completed_by_name,
    completedAt: row.completed_at,
    cancelledBy: row.cancelled_by,
    cancelledByName: row.cancelled_by_name,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    notes: row.notes
  };
}

export default {
  initiateTransfer,
  approveTransfer,
  completeTransfer,
  cancelTransfer,
  getTransferDetails,
  getTransferHistory,
  getPendingTransfers,
  hasPendingTransfer,
  getAvailableSites
};

