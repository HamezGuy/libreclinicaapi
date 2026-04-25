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
import { FORMAT_TYPE_REGISTRY } from '../services/database/validation-rules.service';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor, requireSignatureForStrict } from '../middleware/part11.middleware';
import { validate, validationRuleSchemas } from '../middleware/validation.middleware';
import { aiCompileRateLimiter } from '../middleware/rateLimiter.middleware';

const router = Router();

/**
 * ISSUE-002 fix: opt-in strict signature enforcement on rule write routes.
 * Set `STRICT_VALIDATION_RULE_SIGNATURES=true` in env to require an actual
 * verified electronic signature on create/update/delete/toggle. The
 * default (soft) keeps the existing behaviour so deploying this code
 * change doesn't break the rule-authoring UI overnight; flip the env
 * flag only after the frontend has been updated to surface the
 * ESignatureModal before submitting rule mutations.
 */
const SIG_STRICT = process.env.STRICT_VALIDATION_RULE_SIGNATURES === 'true';
const ruleSignature = SIG_STRICT ? requireSignatureForStrict : requireSignatureFor;

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

// Toggle field required status (direct field property, not a validation rule)
router.put('/field-required',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  ruleSignature('I authorize changing this field required status'),
  controller.toggleFieldRequired
);

// /format-types MUST be registered before /:ruleId — Express matches routes in order and
// /:ruleId would shadow any static path segment like /format-types.
router.get('/format-types', (_req, res) => {
  try {
    res.json({ success: true, data: FORMAT_TYPE_REGISTRY });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load format types' });
  }
});

router.get('/:ruleId', validate({ params: ruleIdParam }), controller.getRule);

// Create a new rule
router.post('/',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  ruleSignature('I authorize creation of this validation rule'),
  validate({ body: validationRuleSchemas.create }),
  controller.createRule
);

// Update a rule
router.put('/:ruleId',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  ruleSignature('I authorize modification of this validation rule'),
  validate({ params: ruleIdParam, body: validationRuleSchemas.update }),
  controller.updateRule
);

// Toggle rule active state
router.patch('/:ruleId/toggle',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  ruleSignature('I authorize toggling this validation rule'),
  validate({ params: ruleIdParam }),
  controller.toggleRule
);

// Delete a rule
router.delete('/:ruleId',
  requireRole('admin'),
  ruleSignature('I authorize deletion of this validation rule'),
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

// AI-suggested rule compilation (NEW v7).
//   - Read-only with respect to validation_rules (no DB writes here).
//   - Costs real money per call -> dedicated rate limiter (2500/user/hr).
//   - Authorisation: same as create/update — admin or data_manager only.
//   - The orchestrator returns 200 with `data.flags.refused=true` when
//     the kill-switch is off, the description has PHI, or every
//     provider failed. The caller inspects `data.flags` and `data.warnings`.
router.post('/compile',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  aiCompileRateLimiter,
  validate({ body: validationRuleSchemas.compile }),
  controller.compileRulesFromText
);

export default router;

