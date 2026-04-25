/**
 * Form Layout Routes
 * 
 * Manages column layout configuration for CRF form rendering.
 * Uses LibreClinica native tables: item_form_metadata (column_number), section
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as formLayoutController from '../controllers/form-layout.controller';

const router = express.Router();
router.use(authMiddleware);

router.get('/:crfVersionId', formLayoutController.getFormLayout);

router.get('/:crfVersionId/render', formLayoutController.getRenderedLayout);

router.post(
  '/',
  requireRole('admin', 'data_manager'),
  formLayoutController.saveFormLayout,
);

router.put(
  '/field/:itemFormMetadataId',
  requireRole('admin', 'data_manager'),
  formLayoutController.updateFieldLayout,
);

export default router;
