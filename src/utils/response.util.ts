import { Response } from 'express';

export function sendSuccess(res: Response, data: any, message?: string, status: number = 200): void {
  res.status(status).json({ success: true, data, message });
}

export function sendError(res: Response, message: string, status: number = 400, code?: string): void {
  res.status(status).json({ success: false, message, code });
}
