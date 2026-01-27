/**
 * Form Layout Controller
 * 
 * Handles API requests for form layout management including:
 * - Get layout configuration for a form
 * - Save/update layout with column positions
 * - Update individual field positions
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as formLayoutService from '../services/database/form-layout.service';
import { logger } from '../config/logger';

/**
 * Get form layout configuration
 * GET /api/form-layout/:crfVersionId
 */
export const getFormLayout = asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId } = req.params;

  logger.info('📐 Get form layout request', { crfVersionId });

  const result = await formLayoutService.getFormLayout(parseInt(crfVersionId));

  if (!result.success) {
    res.status(404).json(result);
    return;
  }

  res.json(result);
});

/**
 * Get form layout optimized for rendering
 * GET /api/form-layout/:crfVersionId/render
 */
export const getFormLayoutForRendering = asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId } = req.params;

  logger.info('📐 Get form layout for rendering', { crfVersionId });

  const result = await formLayoutService.getFormLayoutForRendering(parseInt(crfVersionId));

  if (!result.success) {
    res.status(404).json(result);
    return;
  }

  res.json(result);
});

/**
 * Save form layout configuration
 * POST /api/form-layout
 */
export const saveFormLayout = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  logger.info('📐 Save form layout request', { 
    body: req.body,
    userId: user.userId
  });

  const { crfVersionId, columnCount, fields } = req.body;

  if (!crfVersionId || !columnCount || !fields) {
    res.status(400).json({ 
      success: false, 
      message: 'crfVersionId, columnCount, and fields are required' 
    });
    return;
  }

  if (![1, 2, 3].includes(columnCount)) {
    res.status(400).json({ 
      success: false, 
      message: 'columnCount must be 1, 2, or 3' 
    });
    return;
  }

  const result = await formLayoutService.saveFormLayout({
    crfVersionId: parseInt(crfVersionId),
    columnCount,
    fields
  }, user.userId);

  res.json(result);
});

/**
 * Update a single field's layout position
 * PUT /api/form-layout/field/:itemFormMetadataId
 */
export const updateFieldLayout = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { itemFormMetadataId } = req.params;
  const { columnNumber, ordinal } = req.body;

  logger.info('📐 Update field layout request', { 
    itemFormMetadataId,
    columnNumber,
    ordinal,
    userId: user.userId
  });

  if (columnNumber === undefined) {
    res.status(400).json({ 
      success: false, 
      message: 'columnNumber is required' 
    });
    return;
  }

  const result = await formLayoutService.updateFieldLayout(
    parseInt(itemFormMetadataId),
    columnNumber,
    ordinal || 0,
    user.userId
  );

  res.json(result);
});

export default {
  getFormLayout,
  getFormLayoutForRendering,
  saveFormLayout,
  updateFieldLayout
};

