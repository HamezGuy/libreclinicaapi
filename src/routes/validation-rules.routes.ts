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
import Joi from 'joi';
import * as controller from '../controllers/validation-rules.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor } from '../middleware/part11.middleware';
import { validate, validationRuleSchemas } from '../middleware/validation.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================
// FORM INSTANCE (EVENT_CRF) VALIDATION ROUTES
// ============================================

const eventCrfIdParam = Joi.object({ eventCrfId: Joi.number().integer().positive().required() });
const crfIdParam = Joi.object({ crfId: Joi.number().integer().positive().required() });
const ruleIdParam = Joi.object({ ruleId: Joi.number().integer().positive().required() });

router.get('/event-crf/:eventCrfId/rules',
  validate({ params: eventCrfIdParam }),
  controller.getRulesForEventCrf
);

router.post('/event-crf/:eventCrfId/validate',
  validate({ params: eventCrfIdParam, body: validationRuleSchemas.validateForm }),
  controller.validateEventCrf
);

// Validate a single field change (real-time, on field blur)
router.post('/validate-field',
  validate({ body: validationRuleSchemas.validateField }),
  controller.validateFieldChange
);

// ============================================
// TEMPLATE-LEVEL VALIDATION ROUTES
// ============================================

router.get('/crf/:crfId', validate({ params: crfIdParam }), controller.getRulesForCrf);
router.get('/study/:studyId', validate({ params: Joi.object({ studyId: Joi.number().integer().positive().required() }) }), controller.getRulesForStudy);
router.get('/all-crfs', controller.getAllCrfsWithRules);

// /format-types MUST be registered before /:ruleId — Express matches routes in order and
// /:ruleId would shadow any static path segment like /format-types.
router.get('/format-types', (_req, res) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const formatTypes = require('../../config/format-types.json');
    res.json({ success: true, data: formatTypes });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load format types' });
  }
});

router.get('/:ruleId', validate({ params: ruleIdParam }), controller.getRule);

// Create a new rule
router.post('/',
  requireRole('admin', 'data_manager'),
  requireSignatureFor('I authorize creation of this validation rule'),
  validate({ body: validationRuleSchemas.create }),
  controller.createRule
);

// Update a rule
router.put('/:ruleId',
  requireRole('admin', 'data_manager'),
  requireSignatureFor('I authorize modification of this validation rule'),
  validate({ params: ruleIdParam, body: validationRuleSchemas.update }),
  controller.updateRule
);

// Toggle rule active state
router.patch('/:ruleId/toggle',
  requireRole('admin', 'data_manager'),
  requireSignatureFor('I authorize toggling this validation rule'),
  validate({ params: ruleIdParam }),
  controller.toggleRule
);

// Delete a rule
router.delete('/:ruleId',
  requireRole('admin'),
  requireSignatureFor('I authorize deletion of this validation rule'),
  validate({ params: ruleIdParam }),
  controller.deleteRule
);

// Validate form data against CRF rules (template-level, no form instance)
router.post('/validate/:crfId',
  validate({ params: crfIdParam, body: validationRuleSchemas.validateForm }),
  controller.validateData
);

// Test a rule against a value (read-only)
router.post('/test',
  validate({ body: validationRuleSchemas.testRule }),
  controller.testRule
);

export default router;

