/**
 * Feature Access Service
 * 
 * Manages per-user feature access. Each user can be granted or denied
 * access to specific application features (training, econsent, ePRO, etc.).
 * 
 * Resolution order:
 *   1. Per-user override (acc_user_feature_access) — explicit grant/deny
 *   2. Role defaults (acc_role_default_features) — what the role normally gets
 *   3. Feature registry (acc_feature.is_active) — feature must be active globally
 * 
 * 21 CFR Part 11: Access controls per §11.10(d) — system limits access
 * to authorized individuals based on role and explicit feature grants.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { getRoleByName } from '../../constants/roles';

export interface FeatureDefinition {
  feature_key: string;
  display_name: string;
  description: string;
  category: string;
  is_active: boolean;
  requires_role_level: number;
}

export interface UserFeatureAccess {
  feature_key: string;
  display_name: string;
  description: string;
  category: string;
  is_enabled: boolean;
  source: 'user_override' | 'role_default' | 'denied';
  granted_by?: number;
  granted_at?: string;
}

/**
 * Get all features available in the system
 */
export async function getAllFeatures(): Promise<FeatureDefinition[]> {
  const result = await pool.query(`
    SELECT feature_key, display_name, description, category, is_active, requires_role_level
    FROM acc_feature
    ORDER BY category, display_name
  `);
  return result.rows;
}

/**
 * Get a user's effective feature access (resolves overrides + role defaults)
 */
export async function getUserFeatureAccess(userId: number): Promise<UserFeatureAccess[]> {
  try {
    // Get user's role(s) from study_user_role
    const roleResult = await pool.query(`
      SELECT DISTINCT sur.role_name
      FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE ua.user_id = $1 AND sur.status_id = 1
    `, [userId]);
    const rawRoleNames = roleResult.rows.map(r => r.role_name);

    // Normalize legacy role names to canonical names via the alias map.
    // e.g., 'coordinator' (legacy DB) → 'data_manager' (new canonical),
    //        'ra' (legacy DB) → 'coordinator' (new canonical CRC)
    const canonicalRoles = new Set<string>();
    for (const raw of rawRoleNames) {
      const resolved = getRoleByName(raw);
      if (resolved.id !== 0) {
        canonicalRoles.add(resolved.name);
      }
    }
    // Also include the raw names in case they match directly
    for (const raw of rawRoleNames) {
      canonicalRoles.add(raw.toLowerCase());
    }
    const userRoles = Array.from(canonicalRoles);

    // Get all active features
    const featuresResult = await pool.query(`
      SELECT feature_key, display_name, description, category, is_active, requires_role_level
      FROM acc_feature
      WHERE is_active = true
      ORDER BY category, display_name
    `);

    // Get per-user overrides
    const overridesResult = await pool.query(`
      SELECT feature_key, is_enabled, granted_by, granted_at
      FROM acc_user_feature_access
      WHERE user_id = $1
    `, [userId]);
    const overrides = new Map(overridesResult.rows.map(r => [r.feature_key, r]));

    // Get role defaults for ALL of the user's roles (union of canonical + raw names)
    let roleFeatures = new Set<string>();
    if (userRoles.length > 0) {
      const roleDefaultsResult = await pool.query(`
        SELECT DISTINCT feature_key
        FROM acc_role_default_features
        WHERE role_name = ANY($1) AND is_enabled = true
      `, [userRoles]);
      roleFeatures = new Set(roleDefaultsResult.rows.map(r => r.feature_key));
    }

    // Resolve effective access for each feature
    const featureAccess: UserFeatureAccess[] = [];
    for (const feature of featuresResult.rows) {
      const override = overrides.get(feature.feature_key);
      
      let isEnabled = false;
      let source: UserFeatureAccess['source'] = 'denied';

      if (override) {
        // Per-user override takes priority
        isEnabled = override.is_enabled;
        source = 'user_override';
      } else if (roleFeatures.has(feature.feature_key)) {
        // Role default
        isEnabled = true;
        source = 'role_default';
      }

      featureAccess.push({
        feature_key: feature.feature_key,
        display_name: feature.display_name,
        description: feature.description,
        category: feature.category,
        is_enabled: isEnabled,
        source,
        granted_by: override?.granted_by,
        granted_at: override?.granted_at,
      });
    }

    return featureAccess;
  } catch (error: any) {
    logger.error('Error getting user feature access', { userId, error: error.message });
    throw error;
  }
}

/**
 * Set feature access for a user (create or update override)
 */
export async function setUserFeatureAccess(
  userId: number,
  featureKey: string,
  isEnabled: boolean,
  grantedBy: number,
  notes?: string
): Promise<{ success: boolean; message?: string }> {
  try {
    if (isEnabled) {
      await pool.query(`
        INSERT INTO acc_user_feature_access (user_id, feature_key, is_enabled, granted_by, granted_at, notes)
        VALUES ($1, $2, $3, $4, NOW(), $5)
        ON CONFLICT (user_id, feature_key) DO UPDATE SET
          is_enabled = $3, granted_by = $4, granted_at = NOW(), revoked_by = NULL, revoked_at = NULL,
          notes = $5, date_updated = NOW()
      `, [userId, featureKey, isEnabled, grantedBy, notes || null]);
    } else {
      await pool.query(`
        INSERT INTO acc_user_feature_access (user_id, feature_key, is_enabled, revoked_by, revoked_at, notes)
        VALUES ($1, $2, false, $3, NOW(), $4)
        ON CONFLICT (user_id, feature_key) DO UPDATE SET
          is_enabled = false, revoked_by = $3, revoked_at = NOW(),
          notes = $4, date_updated = NOW()
      `, [userId, featureKey, grantedBy, notes || null]);
    }

    logger.info('User feature access updated', { userId, featureKey, isEnabled, grantedBy });
    return { success: true, message: `Feature '${featureKey}' ${isEnabled ? 'enabled' : 'disabled'} for user ${userId}` };
  } catch (error: any) {
    logger.error('Error setting user feature access', { userId, featureKey, error: error.message });
    return { success: false, message: error.message };
  }
}

/**
 * Bulk set feature access for a user (replaces all overrides)
 */
export async function bulkSetUserFeatureAccess(
  userId: number,
  features: { featureKey: string; isEnabled: boolean }[],
  grantedBy: number
): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const f of features) {
      if (f.isEnabled) {
        await client.query(`
          INSERT INTO acc_user_feature_access (user_id, feature_key, is_enabled, granted_by, granted_at)
          VALUES ($1, $2, true, $3, NOW())
          ON CONFLICT (user_id, feature_key) DO UPDATE SET
            is_enabled = true, granted_by = $3, granted_at = NOW(),
            revoked_by = NULL, revoked_at = NULL, date_updated = NOW()
        `, [userId, f.featureKey, grantedBy]);
      } else {
        await client.query(`
          INSERT INTO acc_user_feature_access (user_id, feature_key, is_enabled, revoked_by, revoked_at)
          VALUES ($1, $2, false, $3, NOW())
          ON CONFLICT (user_id, feature_key) DO UPDATE SET
            is_enabled = false, revoked_by = $3, revoked_at = NOW(), date_updated = NOW()
        `, [userId, f.featureKey, grantedBy]);
      }
    }

    await client.query('COMMIT');
    logger.info('Bulk feature access updated', { userId, featureCount: features.length, grantedBy });
    return { success: true, message: `Updated ${features.length} feature(s) for user ${userId}` };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error in bulk feature access update', { userId, error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
}

/**
 * Remove a per-user override (fall back to role default)
 */
export async function removeUserFeatureOverride(
  userId: number,
  featureKey: string
): Promise<{ success: boolean; message?: string }> {
  try {
    await pool.query(`
      DELETE FROM acc_user_feature_access
      WHERE user_id = $1 AND feature_key = $2
    `, [userId, featureKey]);

    logger.info('User feature override removed', { userId, featureKey });
    return { success: true, message: `Override removed for feature '${featureKey}', now using role default` };
  } catch (error: any) {
    logger.error('Error removing feature override', { userId, featureKey, error: error.message });
    return { success: false, message: error.message };
  }
}

/**
 * Check if a user has access to a specific feature
 */
export async function hasFeatureAccess(userId: number, featureKey: string): Promise<boolean> {
  try {
    // Check per-user override first
    const overrideResult = await pool.query(`
      SELECT is_enabled FROM acc_user_feature_access
      WHERE user_id = $1 AND feature_key = $2
    `, [userId, featureKey]);

    if (overrideResult.rows.length > 0) {
      return overrideResult.rows[0].is_enabled;
    }

    // Check role defaults - get user's roles, normalize, then check
    const rolesResult = await pool.query(`
      SELECT DISTINCT sur.role_name
      FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE ua.user_id = $1 AND sur.status_id = 1
    `, [userId]);

    // Normalize role names through alias map
    const allRoleNames: string[] = [];
    for (const row of rolesResult.rows) {
      allRoleNames.push(row.role_name.toLowerCase());
      const resolved = getRoleByName(row.role_name);
      if (resolved.id !== 0) allRoleNames.push(resolved.name);
    }
    const uniqueRoles = [...new Set(allRoleNames)];

    if (uniqueRoles.length === 0) return false;

    const roleDefaultResult = await pool.query(`
      SELECT 1 FROM acc_role_default_features
      WHERE role_name = ANY($1) AND feature_key = $2 AND is_enabled = true
      LIMIT 1
    `, [uniqueRoles, featureKey]);

    return roleDefaultResult.rows.length > 0;
  } catch (error: any) {
    logger.error('Error checking feature access', { userId, featureKey, error: error.message });
    return false;
  }
}

/**
 * Get role default features for a given role
 */
export async function getRoleDefaultFeatures(roleName: string): Promise<string[]> {
  try {
    const result = await pool.query(`
      SELECT feature_key FROM acc_role_default_features
      WHERE role_name = $1 AND is_enabled = true
    `, [roleName]);
    return result.rows.map(r => r.feature_key);
  } catch (error: any) {
    logger.error('Error getting role default features', { roleName, error: error.message });
    return [];
  }
}

/**
 * Apply role defaults to a user (used when role is assigned/changed)
 * Only adds features, does not remove existing overrides
 */
export async function applyRoleDefaults(
  userId: number,
  roleName: string,
  grantedBy: number
): Promise<void> {
  try {
    // Normalize the role name: legacy DB names → canonical names
    const resolved = getRoleByName(roleName);
    const canonicalName = resolved.id !== 0 ? resolved.name : roleName;

    // Try canonical name first, fall back to raw name
    let defaults = await getRoleDefaultFeatures(canonicalName);
    if (defaults.length === 0 && canonicalName !== roleName.toLowerCase()) {
      defaults = await getRoleDefaultFeatures(roleName.toLowerCase());
    }
    for (const featureKey of defaults) {
      // Only insert if no override exists
      await pool.query(`
        INSERT INTO acc_user_feature_access (user_id, feature_key, is_enabled, granted_by, granted_at, notes)
        VALUES ($1, $2, true, $3, NOW(), $4)
        ON CONFLICT (user_id, feature_key) DO NOTHING
      `, [userId, featureKey, grantedBy, `Auto-granted from role: ${roleName}`]);
    }
    logger.info('Role defaults applied to user', { userId, roleName, featureCount: defaults.length });
  } catch (error: any) {
    logger.error('Error applying role defaults', { userId, roleName, error: error.message });
  }
}

export default {
  getAllFeatures,
  getUserFeatureAccess,
  setUserFeatureAccess,
  bulkSetUserFeatureAccess,
  removeUserFeatureOverride,
  hasFeatureAccess,
  getRoleDefaultFeatures,
  applyRoleDefaults,
};
