/**
 * Device Routes
 * 
 * 21 CFR Part 11 §11.10(d) - Device Checks
 * 
 * API endpoints for:
 * - Trusted device management
 * - Device access logging
 * - Device fingerprint verification
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  getTrustedDevices,
  registerTrustedDevice,
  removeTrustedDevice,
  isDeviceTrusted,
  logDeviceAccess,
  getDeviceAccessHistory
} from '../services/database/device.service';

const router = Router();

// ============================================================================
// Trusted Device Management
// ============================================================================

/**
 * @route GET /api/devices/trusted
 * @desc Get all trusted devices for current user
 * @access Private
 */
router.get('/trusted', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await getTrustedDevices(userId);
    res.json(result);
  } catch (error: any) {
    logger.error('Error getting trusted devices', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/devices/trusted
 * @desc Register current device as trusted
 * @access Private
 */
router.post('/trusted', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { fingerprintId, deviceName, deviceInfo } = req.body;

    if (!fingerprintId || !deviceName) {
      return res.status(400).json({ 
        success: false, 
        message: 'fingerprintId and deviceName are required' 
      });
    }

    const result = await registerTrustedDevice(userId, {
      fingerprintId,
      deviceName,
      ...deviceInfo
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Error registering trusted device', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route DELETE /api/devices/trusted/:deviceId
 * @desc Remove a trusted device
 * @access Private
 */
router.delete('/trusted/:deviceId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const deviceId = parseInt(req.params.deviceId, 10);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { reason } = req.body;
    const result = await removeTrustedDevice(deviceId, userId, reason);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error: any) {
    logger.error('Error removing trusted device', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/devices/check-trusted
 * @desc Check if current device is trusted
 * @access Private
 */
router.get('/check-trusted', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const fingerprintId = req.query.fingerprintId as string;

    if (!userId || !fingerprintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'fingerprintId query parameter required' 
      });
    }

    const isTrusted = await isDeviceTrusted(userId, fingerprintId);
    res.json({ success: true, data: { isTrusted } });
  } catch (error: any) {
    logger.error('Error checking device trust', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// Device Access Logging
// ============================================================================

/**
 * @route POST /api/devices/log-access
 * @desc Log device access for audit trail
 * @access Private
 */
router.post('/log-access', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                      req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    const { fingerprintId, action, deviceInfo, entityType, entityId, studyId } = req.body;

    if (!fingerprintId || !action) {
      return res.status(400).json({ 
        success: false, 
        message: 'fingerprintId and action are required' 
      });
    }

    const result = await logDeviceAccess({
      userId,
      fingerprintId,
      action,
      ipAddress,
      userAgent,
      deviceInfo,
      entityType,
      entityId,
      studyId
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Error logging device access', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/devices/access-history
 * @desc Get device access history for current user
 * @access Private
 */
router.get('/access-history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { limit, action, fingerprintId } = req.query;

    const result = await getDeviceAccessHistory(userId, {
      limit: limit ? parseInt(limit as string, 10) : 50,
      action: action as string,
      fingerprintId: fingerprintId as string
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting access history', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;

