/**
 * Permission Service
 * 
 * Manages per-user custom permission overrides (à la carte permissions).
 * These overrides take precedence over role-derived defaults.
 * 
 * Table: user_custom_permissions
 * - permission_key: e.g. 'canExportData', 'canManageUsers'
 * - granted: true = explicitly grant, false = explicitly revoke
 * 
 * 21 CFR Part 11 §11.10(d) - Limiting system access to authorized individuals
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

/**
 * All available permission keys with descriptions.
 * Grouped by 21 CFR Part 11 compliance categories.
 *
 * §11.10(d) - Access Control: limiting system access to authorized individuals
 * §11.10(c) - Data Entry & Modification: protecting records from alteration
 * §11.300   - Electronic Signatures: signing, locking, verifying
 * §11.10(e) - Audit, Export & Compliance: audit trails, data export, reporting
 * §11.10(g) - Study & System Administration: authority checks, configuration
 */
export const AVAILABLE_PERMISSIONS: { key: string; label: string; category: string }[] = [
  // §11.10(d) Access Control — who can view what
  { key: 'canViewPatients',     label: 'View Patient Records',        category: '§11.10(d) Access Control' },
  { key: 'canViewAllData',      label: 'View All Study Data',         category: '§11.10(d) Access Control' },
  { key: 'canViewSdv',          label: 'View SDV Dashboard',          category: '§11.10(d) Access Control' },
  { key: 'canViewQueries',      label: 'View Data Queries',           category: '§11.10(d) Access Control' },
  { key: 'canViewReports',      label: 'View Reports & Analytics',    category: '§11.10(d) Access Control' },
  { key: 'canViewAuditLogs',    label: 'View Audit Trail',            category: '§11.10(d) Access Control' },

  // §11.10(c) Data Entry & Modification — creating and changing records
  { key: 'canEnrollPatients',      label: 'Enroll Patients',             category: '§11.10(c) Data Entry & Records' },
  { key: 'canEditPatients',        label: 'Edit Patient Records',        category: '§11.10(c) Data Entry & Records' },
  { key: 'canDeletePatients',      label: 'Delete Patient Records',      category: '§11.10(c) Data Entry & Records' },
  { key: 'canFillForms',           label: 'Enter Data (Fill Forms)',      category: '§11.10(c) Data Entry & Records' },
  { key: 'canEditForms',           label: 'Edit Existing Form Data',     category: '§11.10(c) Data Entry & Records' },
  { key: 'canCreateQueries',       label: 'Create Data Queries',         category: '§11.10(c) Data Entry & Records' },
  { key: 'canRespondToQueries',    label: 'Respond to Data Queries',     category: '§11.10(c) Data Entry & Records' },
  { key: 'canCloseQueries',        label: 'Close / Resolve Queries',     category: '§11.10(c) Data Entry & Records' },

  // §11.300 Electronic Signatures — signing, locking, verifying
  { key: 'canSignForms',       label: 'Apply Electronic Signature',   category: '§11.300 Electronic Signatures' },
  { key: 'canLockForms',       label: 'Lock / Freeze Form Data',      category: '§11.300 Electronic Signatures' },
  { key: 'canPerformSdv',      label: 'Perform Source Data Verification', category: '§11.300 Electronic Signatures' },
  { key: 'canApproveChanges',  label: 'Approve Data Changes',         category: '§11.300 Electronic Signatures' },

  // §11.10(e) Audit, Export & Compliance — audit trail and data output
  { key: 'canExportData',            label: 'Export Study Data',            category: '§11.10(e) Audit, Export & Compliance' },
  { key: 'canManageDataLocks',       label: 'Manage Data Locks',            category: '§11.10(e) Audit, Export & Compliance' },
  { key: 'canManageValidationRules', label: 'Manage Validation Rules',      category: '§11.10(e) Audit, Export & Compliance' },
  { key: 'canManageBranchingLogic',  label: 'Manage Branching / Skip Logic', category: '§11.10(e) Audit, Export & Compliance' },

  // §11.10(g) Study & System Administration — authority checks, configuration
  { key: 'canCreateStudy',       label: 'Create Studies',              category: '§11.10(g) Study & System Admin' },
  { key: 'canEditStudy',         label: 'Edit Study Configuration',    category: '§11.10(g) Study & System Admin' },
  { key: 'canDeleteStudy',       label: 'Delete / Archive Studies',    category: '§11.10(g) Study & System Admin' },
  { key: 'canCreateTemplates',   label: 'Create Form Templates',      category: '§11.10(g) Study & System Admin' },
  { key: 'canEditTemplates',     label: 'Edit Form Templates',        category: '§11.10(g) Study & System Admin' },
  { key: 'canDeleteTemplates',   label: 'Delete Form Templates',      category: '§11.10(g) Study & System Admin' },
  { key: 'canPublishTemplates',  label: 'Publish Form Templates',     category: '§11.10(g) Study & System Admin' },
  { key: 'canManageUsers',       label: 'Manage User Accounts',       category: '§11.10(g) Study & System Admin' },
];

const VALID_PERMISSION_KEYS = new Set(AVAILABLE_PERMISSIONS.map(p => p.key));

/**
 * Ensure the user_custom_permissions table exists.
 * Table is created by startup migrations (config/migrations.ts).
 */
export const ensureTable = async (): Promise<void> => {
  // No-op: table is created by startup migrations.
  // Kept for backward compatibility with callers.
};

/**
 * Get all custom permission overrides for a user.
 * Returns a Record<string, boolean> where key is permission_key and value is granted.
 */
export const getUserCustomPermissions = async (
  userId: number
): Promise<Record<string, boolean>> => {
  try {
    const result = await pool.query(
      `SELECT permission_key, granted FROM user_custom_permissions WHERE user_id = $1`,
      [userId]
    );
    const perms: Record<string, boolean> = {};
    for (const row of result.rows) {
      perms[row.permission_key] = row.granted;
    }
    return perms;
  } catch (error: any) {
    // Table might not exist yet
    if (error.message?.includes('does not exist')) {
      await ensureTable();
      return {};
    }
    logger.error('Failed to get custom permissions', { error: error.message, userId });
    return {};
  }
};

/**
 * Set/update custom permissions for a user (bulk upsert).
 * permissions: Record<string, boolean | null>
 *   - true/false = set override
 *   - null = remove override (revert to role default)
 */
export const setUserCustomPermissions = async (
  userId: number,
  permissions: Record<string, boolean | null>,
  grantedBy: number
): Promise<{ success: boolean; message: string; updated: number }> => {
  try {
    await ensureTable();
    
    let updated = 0;

    for (const [key, value] of Object.entries(permissions)) {
      if (!VALID_PERMISSION_KEYS.has(key)) {
        logger.warn('Ignoring invalid permission key', { key, userId });
        continue;
      }

      if (value === null) {
        // Remove override
        const delResult = await pool.query(
          `DELETE FROM user_custom_permissions WHERE user_id = $1 AND permission_key = $2`,
          [userId, key]
        );
        if (delResult.rowCount && delResult.rowCount > 0) updated++;
      } else {
        // Upsert override
        await pool.query(
          `INSERT INTO user_custom_permissions (user_id, permission_key, granted, granted_by, date_created, date_updated)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (user_id, permission_key)
           DO UPDATE SET granted = EXCLUDED.granted, granted_by = EXCLUDED.granted_by, date_updated = NOW()`,
          [userId, key, value, grantedBy]
        );
        updated++;
      }
    }

    logger.info('Custom permissions updated', { userId, updated, grantedBy });

    return { success: true, message: `Updated ${updated} permission(s)`, updated };
  } catch (error: any) {
    logger.error('Failed to set custom permissions', { error: error.message, userId });
    return { success: false, message: 'Failed to update permissions: ' + error.message, updated: 0 };
  }
};

/**
 * Remove a single permission override for a user.
 */
export const removePermissionOverride = async (
  userId: number,
  permissionKey: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const result = await pool.query(
      `DELETE FROM user_custom_permissions WHERE user_id = $1 AND permission_key = $2`,
      [userId, permissionKey]
    );
    const removed = result.rowCount && result.rowCount > 0;
    return {
      success: true,
      message: removed ? 'Permission override removed' : 'No override found for this permission'
    };
  } catch (error: any) {
    logger.error('Failed to remove permission override', { error: error.message, userId, permissionKey });
    return { success: false, message: 'Failed to remove permission override' };
  }
};

/**
 * Get available permissions with metadata.
 */
export const getAvailablePermissions = () => {
  return AVAILABLE_PERMISSIONS;
};

export default {
  ensureTable,
  getUserCustomPermissions,
  setUserCustomPermissions,
  removePermissionOverride,
  getAvailablePermissions,
  AVAILABLE_PERMISSIONS,
};
