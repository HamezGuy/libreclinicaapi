/**
 * Validation Rules Routes
 * 
 * API endpoints for managing validation rules
 * 
 * 21 CFR Part 11 Compliance:
 * - Rule creation/modification requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import { Router } from 'express';
import * as controller from '../controllers/validation-rules.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor } from '../middleware/part11.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get validation rules for a CRF (no signature required)
router.get('/crf/:crfId', controller.getRulesForCrf);

// Get validation rules for a study (all CRFs)
router.get('/study/:studyId', controller.getRulesForStudy);

// Get a single rule
router.get('/:ruleId', controller.getRule);

// Create a new rule (admin/coordinator only + signature)
router.post('/', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor('I authorize creation of this validation rule'),
  controller.createRule
);

// Update a rule (signature required)
router.put('/:ruleId', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor('I authorize modification of this validation rule'),
  controller.updateRule
);

// Toggle rule active state (signature required)
router.patch('/:ruleId/toggle', 
  requireRole('admin', 'coordinator'), 
  requireSignatureFor('I authorize toggling this validation rule'),
  controller.toggleRule
);

// Delete a rule (admin only + signature)
router.delete('/:ruleId', 
  requireRole('admin'), 
  requireSignatureFor('I authorize deletion of this validation rule'),
  controller.deleteRule
);

// Validate form data against rules (no signature - read-only operation)
router.post('/validate/:crfId', controller.validateData);

// Test a rule (no signature - read-only operation)
router.post('/test', controller.testRule);

export default router;

