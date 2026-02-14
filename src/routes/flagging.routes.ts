/**
 * CRF/Item Flagging Routes
 * 
 * Uses LibreClinica native tables: event_crf_flag, item_data_flag
 * Allows monitors and coordinators to flag CRFs and individual items
 * for data review.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { logger } from '../config/logger';
import { pool } from '../config/database';

const router = Router();

router.use(authMiddleware);

// GET /api/flagging/crfs/:eventCrfId - Get flags for a CRF
router.get('/crfs/:eventCrfId', async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    if (isNaN(eventCrfId)) {
      res.status(400).json({ success: false, message: 'Invalid eventCrfId' });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM event_crf_flag WHERE event_crf_id = $1 ORDER BY created_at DESC`,
      [eventCrfId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    logger.error('Failed to get CRF flags', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/flagging/crfs/:eventCrfId - Flag a CRF
router.post('/crfs/:eventCrfId', requireRole('monitor', 'data_manager', 'admin'), async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const { flagType, comment } = req.body;
    const userId = (req as any).user?.userId;

    const result = await pool.query(
      `INSERT INTO event_crf_flag (event_crf_id, flag_type, comment, user_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [eventCrfId, flagType || 'review', comment || '', userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error('Failed to flag CRF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/flagging/items/:itemDataId - Get flags for an item
router.get('/items/:itemDataId', async (req: Request, res: Response) => {
  try {
    const itemDataId = parseInt(req.params.itemDataId);
    if (isNaN(itemDataId)) {
      res.status(400).json({ success: false, message: 'Invalid itemDataId' });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM item_data_flag WHERE item_data_id = $1 ORDER BY created_at DESC`,
      [itemDataId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    logger.error('Failed to get item flags', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/flagging/items/:itemDataId - Flag an item
router.post('/items/:itemDataId', requireRole('monitor', 'data_manager', 'admin'), async (req: Request, res: Response) => {
  try {
    const itemDataId = parseInt(req.params.itemDataId);
    const { flagType, comment } = req.body;
    const userId = (req as any).user?.userId;

    const result = await pool.query(
      `INSERT INTO item_data_flag (item_data_id, flag_type, comment, user_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [itemDataId, flagType || 'review', comment || '', userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    logger.error('Failed to flag item', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
