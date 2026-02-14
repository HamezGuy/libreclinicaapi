/**
 * Notification Routes
 * 
 * In-app notification endpoints for the current user.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import * as notificationService from '../services/database/notification.service';

const router = Router();

router.use(authMiddleware);

// GET /api/notifications - Get notifications for current user
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const result = await notificationService.getUnreadNotifications(userId, limit);
    res.json({ success: true, data: result.data, unreadCount: result.unreadCount });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const notificationId = parseInt(req.params.id);
    await notificationService.markAsRead(notificationId, userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const count = await notificationService.markAllAsRead(userId);
    res.json({ success: true, data: { marked: count } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
