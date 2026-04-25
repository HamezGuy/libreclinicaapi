/**
 * Flagging Controller
 *
 * Thin handlers: parse input, call the service, respond.
 */

import { Request, Response } from 'express';
import { asyncHandler, BadRequestError } from '../middleware/errorHandler.middleware';
import * as flaggingService from '../services/database/flagging.service';
import { logger } from '../config/logger';
import type { ApiResponse } from '@accura-trial/shared-types';

const userId = (req: Request) => (req as any).user?.userId as number;

export const getCrfFlags = asyncHandler(async (req: Request, res: Response) => {
  const eventCrfId = parseInt(req.params.eventCrfId);
  if (isNaN(eventCrfId)) throw new BadRequestError('Invalid eventCrfId');

  const data = await flaggingService.getCrfFlags(eventCrfId);
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const flagCrf = asyncHandler(async (req: Request, res: Response) => {
  const eventCrfId = parseInt(req.params.eventCrfId);
  const { flagType, comment } = req.body;

  const data = await flaggingService.createCrfFlag(eventCrfId, flagType, comment, userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const getItemFlags = asyncHandler(async (req: Request, res: Response) => {
  const itemDataId = parseInt(req.params.itemDataId);
  if (isNaN(itemDataId)) throw new BadRequestError('Invalid itemDataId');

  const data = await flaggingService.getItemFlags(itemDataId);
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const flagItem = asyncHandler(async (req: Request, res: Response) => {
  const itemDataId = parseInt(req.params.itemDataId);
  const { flagType, comment } = req.body;

  const data = await flaggingService.createItemFlag(itemDataId, flagType, comment, userId(req));
  const response: ApiResponse = { success: true, data };
  res.json(response);
});
