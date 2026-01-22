/**
 * Retention Manager Service - 21 CFR Part 11 & HIPAA Compliant
 * 
 * Manages retention policies, legal holds, and automated cleanup
 * of backup files based on configurable policies.
 * 
 * HIPAA §164.530(j): Retention periods
 * 21 CFR Part 11 §11.10(c): Protection of records
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as fs from 'fs';
import * as path from 'path';
import { deleteCloudBackup, verifyCloudBackup } from './cloud-storage.service';
import { calculateFileChecksum } from './encryption.service';

/**
 * Retention policy interface
 */
export interface RetentionPolicy {
  id: number;
  policyName: string;
  description?: string;
  recordType: string;
  retentionDays: number;
  retentionPermanent: boolean;
  storageTier: string;
  encryptionRequired: boolean;
  cloudBackupRequired: boolean;
  crossRegionReplication: boolean;
  regulatoryReference?: string;
  active: boolean;
}

/**
 * Legal hold interface
 */
export interface LegalHold {
  id: number;
  holdName: string;
  holdReason: string;
  holdType: 'litigation' | 'regulatory' | 'audit' | 'investigation' | 'other';
  studyId?: number;
  subjectId?: number;
  backupId?: string;
  recordType?: string;
  effectiveDate: Date;
  expirationDate?: Date;
  isActive: boolean;
  createdBy: number;
  createdByUsername: string;
  approvedBy?: number;
  approvedByUsername?: string;
  approvedAt?: Date;
  notes?: string;
}

/**
 * Backup file record for cleanup
 */
interface BackupFileRecord {
  id: number;
  backupId: string;
  databaseName: string;
  filePath: string;
  encryptedPath?: string;
  cloudKey?: string;
  cloudBucket?: string;
  retentionUntil: Date;
}

/**
 * Get all active retention policies
 */
export const getRetentionPolicies = async (recordType?: string): Promise<RetentionPolicy[]> => {
  try {
    let query = `
      SELECT 
        id,
        policy_name as "policyName",
        description,
        record_type as "recordType",
        retention_days as "retentionDays",
        retention_permanent as "retentionPermanent",
        storage_tier as "storageTier",
        encryption_required as "encryptionRequired",
        cloud_backup_required as "cloudBackupRequired",
        cross_region_replication as "crossRegionReplication",
        regulatory_reference as "regulatoryReference",
        active
      FROM retention_policies
      WHERE active = true
    `;
    
    const params: any[] = [];
    if (recordType) {
      query += ` AND record_type = $1`;
      params.push(recordType);
    }
    
    query += ` ORDER BY policy_name`;
    
    const result = await pool.query(query, params);
    return result.rows;
    
  } catch (error: any) {
    logger.error('Failed to get retention policies', { error: error.message });
    return [];
  }
};

/**
 * Get retention policy by name
 */
export const getRetentionPolicyByName = async (policyName: string): Promise<RetentionPolicy | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        policy_name as "policyName",
        description,
        record_type as "recordType",
        retention_days as "retentionDays",
        retention_permanent as "retentionPermanent",
        storage_tier as "storageTier",
        encryption_required as "encryptionRequired",
        cloud_backup_required as "cloudBackupRequired",
        cross_region_replication as "crossRegionReplication",
        regulatory_reference as "regulatoryReference",
        active
      FROM retention_policies
      WHERE policy_name = $1
    `, [policyName]);
    
    return result.rows[0] || null;
    
  } catch (error: any) {
    logger.error('Failed to get retention policy', { policyName, error: error.message });
    return null;
  }
};

/**
 * Create or update a retention policy
 */
export const upsertRetentionPolicy = async (
  policy: Partial<RetentionPolicy>,
  userId: number
): Promise<{ success: boolean; id?: number; error?: string }> => {
  try {
    const result = await pool.query(`
      INSERT INTO retention_policies (
        policy_name, description, record_type, retention_days,
        retention_permanent, storage_tier, encryption_required,
        cloud_backup_required, cross_region_replication, 
        regulatory_reference, active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (policy_name) 
      DO UPDATE SET
        description = EXCLUDED.description,
        retention_days = EXCLUDED.retention_days,
        retention_permanent = EXCLUDED.retention_permanent,
        storage_tier = EXCLUDED.storage_tier,
        encryption_required = EXCLUDED.encryption_required,
        cloud_backup_required = EXCLUDED.cloud_backup_required,
        cross_region_replication = EXCLUDED.cross_region_replication,
        regulatory_reference = EXCLUDED.regulatory_reference,
        active = EXCLUDED.active,
        updated_at = NOW()
      RETURNING id
    `, [
      policy.policyName,
      policy.description,
      policy.recordType,
      policy.retentionDays,
      policy.retentionPermanent || false,
      policy.storageTier || 'STANDARD',
      policy.encryptionRequired !== false,
      policy.cloudBackupRequired || false,
      policy.crossRegionReplication || false,
      policy.regulatoryReference,
      policy.active !== false,
      userId
    ]);
    
    logger.info('Retention policy upserted', { 
      policyName: policy.policyName, 
      id: result.rows[0]?.id 
    });
    
    return { success: true, id: result.rows[0]?.id };
    
  } catch (error: any) {
    logger.error('Failed to upsert retention policy', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Get all active legal holds
 */
export const getLegalHolds = async (filters?: {
  studyId?: number;
  subjectId?: number;
  backupId?: string;
  activeOnly?: boolean;
}): Promise<LegalHold[]> => {
  try {
    let query = `
      SELECT 
        id,
        hold_name as "holdName",
        hold_reason as "holdReason",
        hold_type as "holdType",
        study_id as "studyId",
        subject_id as "subjectId",
        backup_id as "backupId",
        record_type as "recordType",
        effective_date as "effectiveDate",
        expiration_date as "expirationDate",
        is_active as "isActive",
        created_by as "createdBy",
        created_by_username as "createdByUsername",
        approved_by as "approvedBy",
        approved_by_username as "approvedByUsername",
        approved_at as "approvedAt",
        notes
      FROM legal_holds
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (filters?.activeOnly !== false) {
      query += ` AND is_active = true`;
    }
    
    if (filters?.studyId) {
      query += ` AND (study_id = $${paramIndex} OR study_id IS NULL)`;
      params.push(filters.studyId);
      paramIndex++;
    }
    
    if (filters?.subjectId) {
      query += ` AND (subject_id = $${paramIndex} OR subject_id IS NULL)`;
      params.push(filters.subjectId);
      paramIndex++;
    }
    
    if (filters?.backupId) {
      query += ` AND (backup_id = $${paramIndex} OR backup_id IS NULL)`;
      params.push(filters.backupId);
      paramIndex++;
    }
    
    query += ` ORDER BY effective_date DESC`;
    
    const result = await pool.query(query, params);
    return result.rows;
    
  } catch (error: any) {
    logger.error('Failed to get legal holds', { error: error.message });
    return [];
  }
};

/**
 * Create a legal hold
 */
export const createLegalHold = async (
  hold: Omit<LegalHold, 'id' | 'isActive' | 'createdBy' | 'createdByUsername'>,
  userId: number,
  username: string
): Promise<{ success: boolean; id?: number; error?: string }> => {
  try {
    const result = await pool.query(`
      INSERT INTO legal_holds (
        hold_name, hold_reason, hold_type, study_id, subject_id,
        backup_id, record_type, effective_date, expiration_date,
        is_active, created_by, created_by_username, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12)
      RETURNING id
    `, [
      hold.holdName,
      hold.holdReason,
      hold.holdType,
      hold.studyId,
      hold.subjectId,
      hold.backupId,
      hold.recordType,
      hold.effectiveDate || new Date(),
      hold.expirationDate,
      userId,
      username,
      hold.notes
    ]);
    
    // Log to audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table, 
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'legal_holds', $1, $2, $3, $4, $5)
    `, [
      result.rows[0].id,
      hold.holdName,
      userId,
      JSON.stringify({ holdType: hold.holdType, reason: hold.holdReason }),
      'Legal hold created'
    ]);
    
    logger.info('Legal hold created', { 
      holdName: hold.holdName, 
      id: result.rows[0].id 
    });
    
    return { success: true, id: result.rows[0].id };
    
  } catch (error: any) {
    logger.error('Failed to create legal hold', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Release a legal hold
 */
export const releaseLegalHold = async (
  holdId: number,
  userId: number,
  username: string,
  reason: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const result = await pool.query(`
      UPDATE legal_holds 
      SET is_active = false, 
          notes = COALESCE(notes, '') || E'\n\nReleased: ' || $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING hold_name
    `, [reason, holdId]);
    
    if (result.rowCount === 0) {
      return { success: false, error: 'Legal hold not found' };
    }
    
    // Log to audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table, 
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'legal_holds', $1, $2, $3, $4, $5)
    `, [
      holdId,
      result.rows[0].hold_name,
      userId,
      JSON.stringify({ action: 'released', reason }),
      'Legal hold released'
    ]);
    
    logger.info('Legal hold released', { holdId, reason });
    
    return { success: true };
    
  } catch (error: any) {
    logger.error('Failed to release legal hold', { holdId, error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Check if a backup is under legal hold
 */
export const isBackupUnderLegalHold = async (backupId: string): Promise<boolean> => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM legal_holds
      WHERE is_active = true
        AND (backup_id = $1 OR backup_id IS NULL)
        AND (expiration_date IS NULL OR expiration_date > NOW())
    `, [backupId]);
    
    return parseInt(result.rows[0].count) > 0;
    
  } catch (error: any) {
    logger.error('Failed to check legal hold status', { backupId, error: error.message });
    // Fail safe - assume it's under hold if we can't check
    return true;
  }
};

/**
 * Get backups eligible for cleanup (past retention, not under hold)
 */
export const getBackupsForCleanup = async (): Promise<BackupFileRecord[]> => {
  try {
    const result = await pool.query(`
      SELECT 
        bf.id,
        bf.backup_id as "backupId",
        bf.database_name as "databaseName",
        bf.file_path as "filePath",
        bf.encrypted_path as "encryptedPath",
        bf.cloud_key as "cloudKey",
        bf.cloud_bucket as "cloudBucket",
        bf.retention_until as "retentionUntil"
      FROM backup_files bf
      LEFT JOIN legal_holds lh ON (
        lh.is_active = true 
        AND (lh.backup_id = bf.backup_id OR lh.backup_id IS NULL)
        AND (lh.expiration_date IS NULL OR lh.expiration_date > NOW())
      )
      WHERE bf.retention_until < NOW()
        AND lh.id IS NULL
      ORDER BY bf.retention_until ASC
    `);
    
    return result.rows;
    
  } catch (error: any) {
    logger.error('Failed to get backups for cleanup', { error: error.message });
    return [];
  }
};

/**
 * Perform automated cleanup of expired backups
 */
export const performAutomatedCleanup = async (
  userId: number = 0,
  username: string = 'system'
): Promise<{
  success: boolean;
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
}> => {
  const errors: string[] = [];
  let filesDeleted = 0;
  let bytesFreed = 0;
  
  logger.info('Starting automated backup cleanup');
  
  try {
    const backupsToClean = await getBackupsForCleanup();
    
    for (const backup of backupsToClean) {
      try {
        // Double-check legal hold status
        const underHold = await isBackupUnderLegalHold(backup.backupId);
        if (underHold) {
          logger.info('Skipping backup under legal hold', { backupId: backup.backupId });
          continue;
        }
        
        let fileSize = 0;
        
        // Delete local files
        const filesToDelete = [
          backup.filePath,
          backup.encryptedPath,
          backup.encryptedPath ? `${backup.encryptedPath}.meta.json` : null
        ].filter(Boolean) as string[];
        
        for (const filePath of filesToDelete) {
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            fileSize += stats.size;
            fs.unlinkSync(filePath);
            logger.debug('Deleted local file', { filePath });
          }
        }
        
        // Delete from cloud storage
        if (backup.cloudKey && backup.cloudBucket) {
          const cloudResult = await deleteCloudBackup(backup.cloudKey);
          if (!cloudResult.success) {
            errors.push(`Failed to delete cloud backup ${backup.cloudKey}: ${cloudResult.error}`);
          }
        }
        
        // Remove from database
        await pool.query(`DELETE FROM backup_files WHERE id = $1`, [backup.id]);
        
        filesDeleted++;
        bytesFreed += fileSize;
        
        logger.info('Backup file cleaned up', { 
          backupId: backup.backupId, 
          databaseName: backup.databaseName,
          bytesFreed: fileSize
        });
        
      } catch (err: any) {
        errors.push(`Failed to cleanup ${backup.backupId}: ${err.message}`);
        logger.error('Failed to cleanup backup', { 
          backupId: backup.backupId, 
          error: err.message 
        });
      }
    }
    
    // Log cleanup action to audit trail
    if (filesDeleted > 0) {
      await pool.query(`
        INSERT INTO audit_log_event (
          audit_log_event_type_id, audit_date, audit_table, 
          entity_id, entity_name, user_id, new_value, reason_for_change
        ) VALUES (1, NOW(), 'system_backup', 0, 'automated_cleanup', $1, $2, $3)
      `, [
        userId,
        JSON.stringify({ filesDeleted, bytesFreed }),
        'Automated retention cleanup'
      ]);
    }
    
    logger.info('Automated backup cleanup completed', { 
      filesDeleted, 
      bytesFreed,
      errors: errors.length 
    });
    
    return { 
      success: errors.length === 0, 
      filesDeleted, 
      bytesFreed, 
      errors 
    };
    
  } catch (error: any) {
    logger.error('Automated cleanup failed', { error: error.message });
    return { 
      success: false, 
      filesDeleted, 
      bytesFreed, 
      errors: [error.message, ...errors] 
    };
  }
};

/**
 * Verify backup integrity
 */
export const verifyBackupIntegrity = async (
  backupId: string,
  userId: number,
  username: string
): Promise<{
  success: boolean;
  localValid: boolean;
  cloudValid: boolean;
  errors: string[];
}> => {
  const errors: string[] = [];
  let localValid = true;
  let cloudValid = true;
  
  logger.info('Verifying backup integrity', { backupId });
  
  try {
    // Get backup files
    const result = await pool.query(`
      SELECT 
        file_path, encrypted_path, checksum, encrypted_checksum,
        cloud_key, cloud_bucket
      FROM backup_files
      WHERE backup_id = $1
    `, [backupId]);
    
    for (const file of result.rows) {
      // Verify local file
      const pathToVerify = file.encrypted_path || file.file_path;
      const expectedChecksum = file.encrypted_checksum || file.checksum;
      
      if (fs.existsSync(pathToVerify)) {
        const actualChecksum = await calculateFileChecksum(pathToVerify);
        if (actualChecksum !== expectedChecksum) {
          localValid = false;
          errors.push(`Checksum mismatch for ${pathToVerify}`);
        }
      } else {
        localValid = false;
        errors.push(`Local file not found: ${pathToVerify}`);
      }
      
      // Verify cloud backup
      if (file.cloud_key) {
        const cloudResult = await verifyCloudBackup(file.cloud_key, expectedChecksum);
        if (!cloudResult.valid) {
          cloudValid = false;
          errors.push(`Cloud verification failed: ${cloudResult.error}`);
        }
      }
    }
    
    // Log verification to audit trail
    const verificationResult = localValid && cloudValid ? 'passed' : 'failed';
    await pool.query(`
      INSERT INTO backup_verification_log (
        backup_id, verification_type, verification_result,
        original_checksum, error_message, verified_by, verified_by_username
      ) VALUES ($1, 'checksum', $2, $3, $4, $5, $6)
    `, [
      backupId,
      verificationResult,
      null,
      errors.length > 0 ? errors.join('; ') : null,
      userId,
      username
    ]);
    
    logger.info('Backup integrity verification completed', { 
      backupId, 
      localValid, 
      cloudValid 
    });
    
    return { 
      success: localValid && cloudValid, 
      localValid, 
      cloudValid, 
      errors 
    };
    
  } catch (error: any) {
    logger.error('Backup verification failed', { backupId, error: error.message });
    return { 
      success: false, 
      localValid: false, 
      cloudValid: false, 
      errors: [error.message] 
    };
  }
};

/**
 * Get retention statistics
 */
export const getRetentionStatistics = async (): Promise<{
  totalBackups: number;
  totalSize: number;
  backupsUnderHold: number;
  backupsExpiringSoon: number;
  policiesActive: number;
  legalHoldsActive: number;
}> => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM backup_files) as total_backups,
        (SELECT COALESCE(SUM(file_size_bytes), 0) FROM backup_files) as total_size,
        (SELECT COUNT(DISTINCT bf.backup_id) 
         FROM backup_files bf
         INNER JOIN legal_holds lh ON lh.is_active = true 
           AND (lh.backup_id = bf.backup_id OR lh.backup_id IS NULL)
        ) as backups_under_hold,
        (SELECT COUNT(*) FROM backup_files 
         WHERE retention_until BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        ) as backups_expiring_soon,
        (SELECT COUNT(*) FROM retention_policies WHERE active = true) as policies_active,
        (SELECT COUNT(*) FROM legal_holds WHERE is_active = true) as legal_holds_active
    `);
    
    return {
      totalBackups: parseInt(stats.rows[0].total_backups) || 0,
      totalSize: parseInt(stats.rows[0].total_size) || 0,
      backupsUnderHold: parseInt(stats.rows[0].backups_under_hold) || 0,
      backupsExpiringSoon: parseInt(stats.rows[0].backups_expiring_soon) || 0,
      policiesActive: parseInt(stats.rows[0].policies_active) || 0,
      legalHoldsActive: parseInt(stats.rows[0].legal_holds_active) || 0
    };
    
  } catch (error: any) {
    logger.error('Failed to get retention statistics', { error: error.message });
    return {
      totalBackups: 0,
      totalSize: 0,
      backupsUnderHold: 0,
      backupsExpiringSoon: 0,
      policiesActive: 0,
      legalHoldsActive: 0
    };
  }
};

export default {
  getRetentionPolicies,
  getRetentionPolicyByName,
  upsertRetentionPolicy,
  getLegalHolds,
  createLegalHold,
  releaseLegalHold,
  isBackupUnderLegalHold,
  getBackupsForCleanup,
  performAutomatedCleanup,
  verifyBackupIntegrity,
  getRetentionStatistics
};
