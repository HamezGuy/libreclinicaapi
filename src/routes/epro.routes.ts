/**
 * ePRO (Electronic Patient-Reported Outcomes) Routes
 *
 * Endpoints for managing PRO instruments, patient assignments, and responses.
 * Integrates with LibreClinica's database for patient/subject information.
 *
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all CREATE, UPDATE, DELETE operations
 * - §11.10(k): UTC timestamps for all events
 * - §11.50: Electronic signature for critical operations
 */

import { Router } from 'express';
import Joi from 'joi';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as controller from '../controllers/epro.controller';

const router = Router();

router.use(authMiddleware);

// ============================================================================
// Validation Schemas
// ============================================================================

const eproSchemas = {
  createInstrument: Joi.object({
    name: Joi.string().required().max(500)
      .messages({ 'any.required': 'Instrument name is required' }),
    shortName: Joi.string().optional().max(50).allow(''),
    description: Joi.string().optional().max(5000).allow(''),
    content: Joi.any().optional(),
    category: Joi.string().optional().max(255).allow(''),
    estimatedMinutes: Joi.number().integer().min(1).optional(),
    languageCode: Joi.string().optional().max(10),
  }),

  createAssignment: Joi.object({
    subjectId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'subjectId is required' }),
    instrumentId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'instrumentId is required' }),
    dueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
    studyId: Joi.number().integer().positive().optional(),
  }),
};

// ============================================================================
// Dashboard
// ============================================================================

router.get('/dashboard', controller.getDashboard);

// ============================================================================
// Instruments
// ============================================================================

router.get('/instruments', controller.listInstruments);
router.post('/instruments', requireRole('admin', 'investigator'), validate({ body: eproSchemas.createInstrument }), controller.createInstrument);
router.get('/instruments/:id', controller.getInstrument);

// ============================================================================
// Assignments
// ============================================================================

router.get('/assignments', controller.listAssignments);
router.post('/assignments', requireRole('admin', 'investigator', 'coordinator'), validate({ body: eproSchemas.createAssignment }), controller.createAssignment);
router.post('/assignments/:id/remind', controller.sendAssignmentReminder);
router.post('/assignments/:id/respond', controller.submitResponse);
router.get('/assignments/:id/response', controller.getResponse);
router.post('/assignments/:id/schedule-reminders', controller.scheduleReminders);

// ============================================================================
// Patient Accounts
// ============================================================================

router.get('/patients', controller.listPatients);
router.post('/patients/:id/resend-activation', controller.resendActivation);

// ============================================================================
// Reminders
// ============================================================================

router.get('/reminders', controller.listReminders);
router.get('/reminders/pending/due', controller.listPendingDueReminders);
router.get('/reminders/:id', controller.getReminder);
router.post('/reminders', controller.createReminder);
router.post('/reminders/:id/send', controller.sendReminder);
router.post('/reminders/:id/cancel', controller.cancelReminder);

export default router;
