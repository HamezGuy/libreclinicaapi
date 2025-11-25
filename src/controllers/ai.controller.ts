/**
 * AI Assistant Controller
 * Placeholder - will integrate full AI service later
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';

export const chat = asyncHandler(async (req: Request, res: Response) => {
  const { message, context } = req.body;
  const user = (req as any).user;

  // TODO: Integrate full AI Assistant service from ElectronicDataCaptureReal/backend
  res.json({
    success: true,
    type: 'answer',
    message: `AI Assistant received: "${message}". Full AI integration pending.`,
    data: {
      userId: user.userId,
      timestamp: new Date().toISOString()
    }
  });
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: [] });
});

export const clearHistory = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, message: 'History cleared' });
});

export default { chat, getHistory, clearHistory };
