/**
 * Validation Rules Routes
 * 
 * API endpoints for managing validation rules
 * 
 * Endpoints for form instances (event_crf):
 * - GET /event-crf/:eventCrfId/rules - Get rules for a form instance
 * - POST /event-crf/:eventCrfId/validate - Validate a form instance
 * - POST /validate-field - Validate a single field change
 * 
 * 21 CFR Part 11 Compliance:
 * - Rule creation/modification requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 * - Validation checks are device checks per §11.10(h)
 */

import { Router } from 'express';
import * as controller from '../controllers/validation-rules.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor } from '../middleware/part11.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================
// FORM INSTANCE (EVENT_CRF) VALIDATION ROUTES
// These apply validation rules to form copies on patients
// ============================================

// Get validation rules for a form instance (event_crf)
// Used when loading a form to apply rules to ALL copies
router.get('/event-crf/:eventCrfId/rules', controller.getRulesForEventCrf);

// Validate a form instance (event_crf) - validates all data in the form
// Optionally creates queries for validation failures
router.post('/event-crf/:eventCrfId/validate', controller.validateEventCrf);

// Validate a single field change - for real-time validation on field blur/change
// This is the primary endpoint for triggering validation on CRUD operations
router.post('/validate-field', controller.validateFieldChange);

// ============================================
// TEMPLATE-LEVEL VALIDATION ROUTES
// These manage validation rules on CRF templates
// ============================================

// Get validation rules for a CRF template
router.get('/crf/:crfId', controller.getRulesForCrf);

// Get validation rules for a study (all CRFs)
router.get('/study/:studyId', controller.getRulesForStudy);

// Get a single rule
router.get('/:ruleId', controller.getRule);

// Create a new rule (admin/coordinator only + signature)
router.post('/', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor('I authorize creation of this validation rule'),
  controller.createRule
);

// Update a rule (signature required)
router.put('/:ruleId', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor('I authorize modification of this validation rule'),
  controller.updateRule
);

// Toggle rule active state (signature required)
router.patch('/:ruleId/toggle', 
  requireRole('admin', 'data_manager'), 
  requireSignatureFor('I authorize toggling this validation rule'),
  controller.toggleRule
);

// Delete a rule (admin only + signature)
router.delete('/:ruleId', 
  requireRole('admin'), 
  requireSignatureFor('I authorize deletion of this validation rule'),
  controller.deleteRule
);

// Validate form data against rules (for templates - no form instance context)
router.post('/validate/:crfId', controller.validateData);

// Test a rule (no signature - read-only operation)
router.post('/test', controller.testRule);

// Serve the shared format type definitions so the frontend can stay in sync
router.get('/format-types', (_req, res) => {
  try {
    const formatTypes = require('../../config/format-types.json');
    res.json({ success: true, data: formatTypes });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load format types' });
  }
});

export default router;

