import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { WorkflowController } from '../controllers/workflow.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireEntityStudyAccess } from '../middleware/study-scope.middleware';
import { validate, commonSchemas } from '../middleware/validation.middleware';
import * as workflowService from '../services/database/workflow.service';

const router = Router();
const controller = new WorkflowController();

// All workflow routes require authentication
router.use(authMiddleware);

// Get all workflows (admin only)
router.get(
  '/',
  requireRole('admin', 'data_manager', 'coordinator', 'investigator'),
  controller.getAllWorkflows.bind(controller)
);

// Get workflows for specific user
router.get(
  '/user/:userId',
  controller.getUserWorkflows.bind(controller)
);

// Get user task summary
router.get(
  '/user/:userId/summary',
  controller.getUserTaskSummary.bind(controller)
);

// Create new workflow task
router.post(
  '/',
  requireRole('admin', 'data_manager', 'investigator', 'coordinator'),
  controller.createWorkflow.bind(controller)
);

// Update workflow status
router.put(
  '/:id/status',
  requireRole('admin', 'data_manager', 'coordinator', 'investigator'),
  requireEntityStudyAccess('workflowTask', 'id'),
  controller.updateWorkflowStatus.bind(controller)
);

// Complete workflow task
router.post(
  '/:id/complete',
  requireRole('admin', 'data_manager', 'coordinator', 'investigator'),
  requireEntityStudyAccess('workflowTask', 'id'),
  controller.completeWorkflow.bind(controller)
);

// Approve workflow task
router.post(
  '/:id/approve',
  requireRole('admin', 'investigator', 'data_manager'),
  requireEntityStudyAccess('workflowTask', 'id'),
  controller.approveWorkflow.bind(controller)
);

// Reject workflow task
router.post(
  '/:id/reject',
  requireRole('admin', 'investigator', 'data_manager'),
  requireEntityStudyAccess('workflowTask', 'id'),
  controller.rejectWorkflow.bind(controller)
);

// Handoff workflow task to another user/role
router.post(
  '/:id/handoff',
  requireRole('admin', 'data_manager', 'coordinator', 'investigator'),
  controller.handoffWorkflow.bind(controller)
);

// ── CRF Lifecycle Status ──────────────────────────────────────────────

// Get lifecycle status for a single CRF instance
router.get('/crf-lifecycle/:eventCrfId', validate({ params: Joi.object({ eventCrfId: Joi.number().integer().positive().required() }) }), async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const status = await workflowService.getCrfLifecycleStatus(eventCrfId);
    if (!status) {
      res.status(404).json({ success: false, message: 'CRF instance not found' });
      return;
    }
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get lifecycle status for all patient CRF instances in a study (dashboard data).
// This is the core endpoint for tracking each form per patient — NOT the base template.
router.get('/crf-lifecycle-summary/:studyId', validate({ params: Joi.object({ studyId: Joi.number().integer().positive().required() }) }), controller.getCrfLifecycleSummary.bind(controller));

export default router;
