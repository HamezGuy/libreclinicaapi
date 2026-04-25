/**
 * Form Layout Controller
 *
 * Thin handlers: parse input, call the service, respond.
 */

import { Request, Response } from 'express';
import { asyncHandler, BadRequestError } from '../middleware/errorHandler.middleware';
import * as formLayoutService from '../services/database/form-layout.service';
import type { ApiResponse } from '@accura-trial/shared-types';

export const getFormLayout = asyncHandler(async (req: Request, res: Response) => {
  const crfVersionId = parseInt(req.params.crfVersionId);
  const data = await formLayoutService.getFormLayout(crfVersionId);
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const getRenderedLayout = asyncHandler(async (req: Request, res: Response) => {
  const crfVersionId = parseInt(req.params.crfVersionId);
  const data = await formLayoutService.getRenderedLayout(crfVersionId);
  const response: ApiResponse = { success: true, data };
  res.json(response);
});

export const saveFormLayout = asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId, fields: items } = req.body;

  if (!crfVersionId || !items || !Array.isArray(items)) {
    throw new BadRequestError('crfVersionId and items array required');
  }

  await formLayoutService.saveFormLayout(crfVersionId, items);
  const response: ApiResponse = { success: true, message: 'Layout saved' };
  res.json(response);
});

export const updateFieldLayout = asyncHandler(async (req: Request, res: Response) => {
  const itemFormMetadataId = parseInt(req.params.itemFormMetadataId);
  const { columnNumber, ordinal } = req.body;

  await formLayoutService.updateFieldLayout(itemFormMetadataId, columnNumber, ordinal);
  const response: ApiResponse = { success: true, message: 'Field layout updated' };
  res.json(response);
});
