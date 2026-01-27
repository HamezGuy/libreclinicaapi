/**
 * Device Service
 * 
 * 21 CFR Part 11 §11.10(d) - Device Checks
 * 
 * Manages trusted device registry and device access logging for:
 * - Electronic signature device tracking
 * - Trusted device management
 * - Device-based access audit trails
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse } from '../../types';

// ============================================================================
// Types
// ============================================================================

export interface TrustedDevice {
  id: number;
  userId: number;
  fingerprintId: string;
  deviceName: string;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  screenResolution: string | null;
  timezone: string | null;
  platform: string | null;
  isTrusted: boolean;
  registeredAt: Date;
  lastUsedAt: Date;
  isCurrentDevice?: boolean;
}

export interface DeviceAccessLog {
  id: number;
  userId: number | null;
  fingerprintId: string;
  action: string;
  ipAddress: string | null;
  isTrustedDevice: boolean;
  accessTimestamp: Date;
  entityType: string | null;
  entityId: number | null;
}

export interface DeviceInfo {
  fingerprintId: string;
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  screenResolution?: string;
  timezone?: string;
  platform?: string;
  webglRenderer?: string;
}

// ============================================================================
// Trusted Device Management
// ============================================================================

/**
 * Get trusted devices for a user
 */
export const getTrustedDevices = async (
  userId: number
): Promise<ApiResponse<TrustedDevice[]>> => {
  logger.info('Getting trusted devices', { userId });

  try {
    const query = `
      SELECT 
        id, user_id, fingerprint_id, device_name,
        browser_name, browser_version, os_name, os_version,
        screen_resolution, timezone, platform,
        is_trusted, registered_at, last_used_at
      FROM trusted_devices
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY last_used_at DESC
    `;

    const result = await pool.query(query, [userId]);

    const devices: TrustedDevice[] = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      fingerprintId: row.fingerprint_id,
      deviceName: row.device_name,
      browserName: row.browser_name,
      browserVersion: row.browser_version,
      osName: row.os_name,
      osVersion: row.os_version,
      screenResolution: row.screen_resolution,
      timezone: row.timezone,
      platform: row.platform,
      isTrusted: row.is_trusted,
      registeredAt: row.registered_at,
      lastUsedAt: row.last_used_at
    }));

    return { success: true, data: devices };

  } catch (error: any) {
    logger.error('Error getting trusted devices', { error: error.message, userId });
    return { success: false, message: error.message };
  }
};

/**
 * Register a new trusted device
 */
export const registerTrustedDevice = async (
  userId: number,
  deviceInfo: DeviceInfo & { deviceName: string }
): Promise<ApiResponse<TrustedDevice>> => {
  logger.info('Registering trusted device', { userId, fingerprintId: deviceInfo.fingerprintId });

  try {
    const query = `
      INSERT INTO trusted_devices (
        user_id, fingerprint_id, device_name,
        browser_name, browser_version, os_name, os_version,
        screen_resolution, timezone, platform, webgl_renderer,
        is_trusted, registered_at, last_used_at, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        true, NOW(), NOW(), $12
      )
      ON CONFLICT (user_id, fingerprint_id) 
      DO UPDATE SET 
        device_name = EXCLUDED.device_name,
        last_used_at = NOW(),
        is_trusted = true,
        revoked_at = NULL
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      deviceInfo.fingerprintId,
      deviceInfo.deviceName,
      deviceInfo.browserName || null,
      deviceInfo.browserVersion || null,
      deviceInfo.osName || null,
      deviceInfo.osVersion || null,
      deviceInfo.screenResolution || null,
      deviceInfo.timezone || null,
      deviceInfo.platform || null,
      deviceInfo.webglRenderer || null,
      JSON.stringify(deviceInfo)
    ]);

    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        userId: row.user_id,
        fingerprintId: row.fingerprint_id,
        deviceName: row.device_name,
        browserName: row.browser_name,
        browserVersion: row.browser_version,
        osName: row.os_name,
        osVersion: row.os_version,
        screenResolution: row.screen_resolution,
        timezone: row.timezone,
        platform: row.platform,
        isTrusted: row.is_trusted,
        registeredAt: row.registered_at,
        lastUsedAt: row.last_used_at
      }
    };

  } catch (error: any) {
    logger.error('Error registering trusted device', { error: error.message, userId });
    return { success: false, message: error.message };
  }
};

/**
 * Remove/revoke a trusted device
 */
export const removeTrustedDevice = async (
  deviceId: number,
  userId: number,
  reason?: string
): Promise<ApiResponse<void>> => {
  logger.info('Removing trusted device', { deviceId, userId });

  try {
    const query = `
      UPDATE trusted_devices
      SET 
        is_trusted = false,
        revoked_at = NOW(),
        revoked_by = $1,
        revocation_reason = $2
      WHERE id = $3 AND user_id = $1
      RETURNING id
    `;

    const result = await pool.query(query, [userId, reason || 'User requested removal', deviceId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Device not found or not owned by user' };
    }

    return { success: true };

  } catch (error: any) {
    logger.error('Error removing trusted device', { error: error.message, deviceId });
    return { success: false, message: error.message };
  }
};

/**
 * Check if a device is trusted for a user
 */
export const isDeviceTrusted = async (
  userId: number,
  fingerprintId: string
): Promise<boolean> => {
  try {
    const query = `
      SELECT id FROM trusted_devices
      WHERE user_id = $1 
        AND fingerprint_id = $2 
        AND is_trusted = true 
        AND revoked_at IS NULL
    `;

    const result = await pool.query(query, [userId, fingerprintId]);
    return result.rows.length > 0;

  } catch (error: any) {
    logger.error('Error checking device trust', { error: error.message, userId, fingerprintId });
    return false;
  }
};

/**
 * Update device last used timestamp
 */
export const updateDeviceLastUsed = async (
  userId: number,
  fingerprintId: string
): Promise<void> => {
  try {
    await pool.query(`
      UPDATE trusted_devices
      SET last_used_at = NOW()
      WHERE user_id = $1 AND fingerprint_id = $2 AND is_trusted = true
    `, [userId, fingerprintId]);
  } catch (error: any) {
    logger.error('Error updating device last used', { error: error.message });
  }
};

// ============================================================================
// Device Access Logging
// ============================================================================

/**
 * Log device access for audit trail
 */
export const logDeviceAccess = async (
  data: {
    userId?: number;
    fingerprintId: string;
    action: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: DeviceInfo;
    sessionId?: string;
    studyId?: number;
    entityType?: string;
    entityId?: number;
  }
): Promise<{ success: boolean; logId?: number }> => {
  try {
    // Check if device is trusted
    let isTrusted = false;
    if (data.userId) {
      isTrusted = await isDeviceTrusted(data.userId, data.fingerprintId);
    }

    const query = `
      INSERT INTO device_access_log (
        user_id, fingerprint_id, action, ip_address, user_agent,
        device_info, is_trusted_device, session_id, study_id,
        entity_type, entity_id, access_timestamp
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
      )
      RETURNING id
    `;

    const result = await pool.query(query, [
      data.userId || null,
      data.fingerprintId,
      data.action,
      data.ipAddress || null,
      data.userAgent || null,
      JSON.stringify(data.deviceInfo || {}),
      isTrusted,
      data.sessionId || null,
      data.studyId || null,
      data.entityType || null,
      data.entityId || null
    ]);

    return { success: true, logId: result.rows[0].id };

  } catch (error: any) {
    logger.error('Error logging device access', { error: error.message });
    return { success: false };
  }
};

/**
 * Get device access history for a user
 */
export const getDeviceAccessHistory = async (
  userId: number,
  options: {
    limit?: number;
    action?: string;
    fingerprintId?: string;
  } = {}
): Promise<ApiResponse<DeviceAccessLog[]>> => {
  logger.info('Getting device access history', { userId, options });

  try {
    let query = `
      SELECT 
        id, user_id, fingerprint_id, action, ip_address,
        is_trusted_device, access_timestamp, entity_type, entity_id
      FROM device_access_log
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (options.action) {
      params.push(options.action);
      query += ` AND action = $${params.length}`;
    }

    if (options.fingerprintId) {
      params.push(options.fingerprintId);
      query += ` AND fingerprint_id = $${params.length}`;
    }

    query += ` ORDER BY access_timestamp DESC`;

    if (options.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);

    const logs: DeviceAccessLog[] = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      fingerprintId: row.fingerprint_id,
      action: row.action,
      ipAddress: row.ip_address,
      isTrustedDevice: row.is_trusted_device,
      accessTimestamp: row.access_timestamp,
      entityType: row.entity_type,
      entityId: row.entity_id
    }));

    return { success: true, data: logs };

  } catch (error: any) {
    logger.error('Error getting device access history', { error: error.message, userId });
    return { success: false, message: error.message };
  }
};

