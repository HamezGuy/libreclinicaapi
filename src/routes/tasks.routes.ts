/**
 * Tasks Routes
 * 
 * Unified task management endpoints aggregating:
 * - Queries (discrepancy_note)
 * - Scheduled Visits (study_event)
 * - Data Entry (study_event/event_crf)
 * - Form Completion (event_crf)
 * - SDV Required (event_crf)
 * - Signature Required (event_crf)
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import tasksController from '../controllers/tasks.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get tasks for current user
router.get('/', tasksController.getTasks);

// Get task summary for current user
router.get('/summary', tasksController.getTaskSummary);

// Get overdue tasks
router.get('/overdue', tasksController.getOverdueTasks);

// Get tasks by type
router.get('/type/:type', tasksController.getTasksByType);

// Get tasks for specific user
router.get('/user/:username', tasksController.getUserTasks);

// Get task summary for specific user
router.get('/user/:username/summary', tasksController.getUserTaskSummary);

// Get single task by ID
router.get('/:taskId', tasksController.getTask);

export default router;

