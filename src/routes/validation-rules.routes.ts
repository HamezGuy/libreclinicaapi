/**
 * Validation Rules Routes
 * 
 * API endpoints for managing validation rules
 */

import { Router } from 'express';
import * as controller from '../controllers/validation-rules.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get validation rules for a CRF
router.get('/crf/:crfId', controller.getRulesForCrf);

// Get validation rules for a study (all CRFs)
router.get('/study/:studyId', controller.getRulesForStudy);

// Get a single rule
router.get('/:ruleId', controller.getRule);

// Create a new rule (admin/coordinator only)
router.post('/', requireRole('admin', 'coordinator'), controller.createRule);

// Update a rule
router.put('/:ruleId', requireRole('admin', 'coordinator'), controller.updateRule);

// Toggle rule active state
router.patch('/:ruleId/toggle', requireRole('admin', 'coordinator'), controller.toggleRule);

// Delete a rule (admin only)
router.delete('/:ruleId', requireRole('admin'), controller.deleteRule);

// Validate form data against rules
router.post('/validate/:crfId', controller.validateData);

// Test a rule
router.post('/test', controller.testRule);

export default router;

