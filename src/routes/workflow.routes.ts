import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = Router();
const controller = new WorkflowController();

// All workflow routes require authentication
router.use(authMiddleware);

// Get all workflows (admin only)
router.get(
  '/',
  requireRole('admin', 'coordinator', 'data_entry'),
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
  requireRole('admin', 'coordinator'),
  controller.createWorkflow.bind(controller)
);

// Update workflow status
router.put(
  '/:id/status',
  controller.updateWorkflowStatus.bind(controller)
);

// Complete workflow task
router.post(
  '/:id/complete',
  controller.completeWorkflow.bind(controller)
);

// Approve workflow task
router.post(
  '/:id/approve',
  requireRole('admin', 'investigator'),
  controller.approveWorkflow.bind(controller)
);

// Reject workflow task
router.post(
  '/:id/reject',
  requireRole('admin', 'investigator'),
  controller.rejectWorkflow.bind(controller)
);

// Handoff workflow task to another user/role
router.post(
  '/:id/handoff',
  controller.handoffWorkflow.bind(controller)
);

export default router;
