/**
 * Tasks Controller
 * 
 * Handles API requests for the unified task system.
 * Aggregates work items from multiple LibreClinica tables:
 * - discrepancy_note (queries)
 * - study_event (scheduled visits)
 * - event_crf (forms, SDV, signatures)
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as tasksService from '../services/database/tasks.service';

/**
 * Get tasks for current user
 * GET /api/tasks
 */
export const getTasks = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId, types, status, priority, includeQueries, limit, offset } = req.query;
  
  const filters: tasksService.TaskFilters = {
    userId: user?.userId,
    username: user?.username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined,
    types: types ? (types as string).split(',') as tasksService.TaskType[] : undefined,
    status: status as tasksService.TaskStatus | undefined,
    priority: priority as tasksService.TaskPriority | undefined,
    includeQueries: includeQueries !== 'false', // Default to true
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0
  };
  
  const result = await tasksService.getUserTasks(filters);
  
  res.json(result);
});

/**
 * Get tasks for specific user
 * GET /api/tasks/user/:username
 */
export const getUserTasks = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { username } = req.params;
  const { studyId, types, status, priority, limit } = req.query;
  
  const filters: tasksService.TaskFilters = {
    username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined,
    types: types ? (types as string).split(',') as tasksService.TaskType[] : undefined,
    status: status as tasksService.TaskStatus | undefined,
    priority: priority as tasksService.TaskPriority | undefined,
    limit: limit ? parseInt(limit as string) : 50
  };
  
  const result = await tasksService.getUserTasks(filters);
  
  res.json(result);
});

/**
 * Get task summary for current user
 * GET /api/tasks/summary
 */
export const getTaskSummary = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId, includeQueries } = req.query;
  
  const filters: tasksService.TaskFilters = {
    userId: user?.userId,
    username: user?.username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined,
    includeQueries: includeQueries !== 'false' // Default to true
  };
  
  const result = await tasksService.getTaskSummary(filters);
  
  res.json(result);
});

/**
 * Get task summary for specific user
 * GET /api/tasks/user/:username/summary
 */
export const getUserTaskSummary = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { username } = req.params;
  const { studyId } = req.query;
  
  const filters: tasksService.TaskFilters = {
    username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined
  };
  
  const result = await tasksService.getTaskSummary(filters);
  
  res.json(result);
});

/**
 * Get single task by ID
 * GET /api/tasks/:taskId
 */
export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const { taskId } = req.params;
  
  const result = await tasksService.getTaskById(taskId);
  
  if (!result.data) {
    res.status(404).json({ success: false, message: 'Task not found' });
    return;
  }
  
  res.json(result);
});

/**
 * Get tasks by type
 * GET /api/tasks/type/:type
 */
export const getTasksByType = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { type } = req.params;
  const { studyId, limit } = req.query;
  
  const validTypes: tasksService.TaskType[] = [
    'query', 'scheduled_visit', 'data_entry', 
    'form_completion', 'sdv_required', 'signature_required'
  ];
  
  if (!validTypes.includes(type as tasksService.TaskType)) {
    res.status(400).json({ success: false, message: 'Invalid task type' });
    return;
  }
  
  const filters: tasksService.TaskFilters = {
    userId: user?.userId,
    username: user?.username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined,
    types: [type as tasksService.TaskType],
    limit: limit ? parseInt(limit as string) : 50
  };
  
  const result = await tasksService.getUserTasks(filters);
  
  res.json(result);
});

/**
 * Get overdue tasks
 * GET /api/tasks/overdue
 */
export const getOverdueTasks = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId, limit } = req.query;
  
  const filters: tasksService.TaskFilters = {
    userId: user?.userId,
    username: user?.username,
    callerUserId: user?.userId,  // For org-scoping
    studyId: studyId ? parseInt(studyId as string) : undefined,
    status: 'overdue',
    limit: limit ? parseInt(limit as string) : 50
  };
  
  const result = await tasksService.getUserTasks(filters);
  
  // Filter to only overdue tasks
  result.data = result.data.filter(t => t.status === 'overdue');
  result.total = result.data.length;
  
  res.json(result);
});

/**
 * Complete a task
 * PATCH /api/tasks/:taskId/complete
 */
export const completeTask = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { taskId } = req.params;
  const { reason } = req.body;
  
  const result = await tasksService.completeTask(taskId, user?.userId, reason);
  
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  
  res.json(result);
});

/**
 * Dismiss a task as uncompletable
 * PATCH /api/tasks/:taskId/dismiss
 */
export const dismissTask = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { taskId } = req.params;
  const { reason } = req.body;
  
  if (!reason || reason.trim().length === 0) {
    res.status(400).json({ success: false, message: 'A reason is required when dismissing a task' });
    return;
  }
  
  const result = await tasksService.dismissTask(taskId, user?.userId, reason);
  
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  
  res.json(result);
});

/**
 * Reopen a task
 * PATCH /api/tasks/:taskId/reopen
 */
export const reopenTask = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { taskId } = req.params;
  
  const result = await tasksService.reopenTask(taskId, user?.userId);
  
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  
  res.json(result);
});

export default {
  getTasks,
  getUserTasks,
  getTaskSummary,
  getUserTaskSummary,
  getTask,
  getTasksByType,
  getOverdueTasks,
  completeTask,
  dismissTask,
  reopenTask
};

