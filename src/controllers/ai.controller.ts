/**
 * AI Assistant Controller
 * Placeholder - will integrate full AI service later
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';

export const chat = asyncHandler(async (req: Request, res: Response) => {
  res.status(501).json({
    success: false,
    message: 'AI service not configured'
  });
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'AI service not configured' });
});

export const clearHistory = asyncHandler(async (req: Request, res: Response) => {
  res.status(501).json({ success: false, message: 'AI service not configured' });
});

export default { chat, getHistory, clearHistory };
