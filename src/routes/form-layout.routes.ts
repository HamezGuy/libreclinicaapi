/**
 * Form Layout Routes
 * 
 * API endpoints for form layout management:
 * - GET /form-layout/:crfVersionId - Get layout configuration
 * - GET /form-layout/:crfVersionId/render - Get layout for rendering
 * - POST /form-layout - Save layout configuration
 * - PUT /form-layout/field/:itemFormMetadataId - Update single field position
 */

import express from 'express';
import * as controller from '../controllers/form-layout.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================================================
// READ OPERATIONS - All authenticated users
// ============================================================================

// Get form layout configuration
router.get('/:crfVersionId', controller.getFormLayout);

// Get form layout optimized for rendering
router.get('/:crfVersionId/render', controller.getFormLayoutForRendering);

// ============================================================================
// WRITE OPERATIONS - Require admin/coordinator role
// ============================================================================

// Save layout configuration
router.post('/',
  requireRole('admin', 'coordinator'),
  controller.saveFormLayout
);

// Update single field position
router.put('/field/:itemFormMetadataId',
  requireRole('admin', 'coordinator'),
  controller.updateFieldLayout
);

export default router;

