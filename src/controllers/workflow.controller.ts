/**
 * Workflow Controller
 * 
 * Handles workflow/task management API endpoints.
 * Uses the workflow service for all database operations.
 * 
 * Real EDC Workflow Patterns Supported:
 * - Automatic task creation on form submission, SDV, signatures
 * - Manual task creation by coordinators/monitors
 * - Task state transitions with audit logging
 * - Role-based task assignment
 * 
 * 21 CFR Part 11 Compliance:
 * - All actions are audit logged
 * - User authentication required
 * - Status transitions are tracked
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { ApiResponse } from '../types';
import * as workflowService from '../services/database/workflow.service';

export class WorkflowController {
  /**
   * Get all workflows (admin/coordinator view)
   * GET /api/workflows
   */
  async getAllWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, priority, assignedTo, studyId, type, limit, offset } = req.query;
      
      const result = await workflowService.getAllWorkflows({
        status: status as unknown as workflowService.WorkflowStatus,
        priority: priority as workflowService.WorkflowPriority,
        assignedTo: assignedTo as string,
        studyId: studyId ? parseInt(studyId as string) : undefined,
        type: type as workflowService.WorkflowType,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0
      });
      
      const response: ApiResponse = {
        success: true,
        data: result.data,
        message: 'Workflows retrieved successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error fetching workflows:', error);
      next(error);
    }
  }

  /**
   * Get workflows for specific user
   * GET /api/workflows/user/:userId
   */
  async getUserWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await workflowService.getUserWorkflows(userId);
      
      const response: ApiResponse = {
        success: true,
        data: result.data
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error fetching user workflows:', error);
      next(error);
    }
  }

  /**
   * Get user task summary with organized task arrays
   * GET /api/workflows/user/:userId/summary
   */
  async getUserTaskSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      
      const result = await workflowService.getUserTaskSummary(userId);
      
      const response: ApiResponse = {
        success: true,
        data: result.data
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error fetching user task summary:', error);
      next(error);
    }
  }

  /**
   * Create new workflow task
   * POST /api/workflows
   */
  async createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, description, studyId, entityType, entityId, assignedTo, type, priority, dueDate, requiresApproval, requiresSignature, eventCrfId } = req.body;
      const user = (req as any).user;
      const userId = user?.userId || user?.user_id;
      const username = user?.username || user?.user_name || 'system';
      
      // Validate required fields
      if (!title) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }

      const result = await workflowService.createWorkflow({
        title,
        description,
        type: type || 'custom',
        priority: priority || 'medium',
        assignedTo: Array.isArray(assignedTo) ? assignedTo : [assignedTo].filter(Boolean),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        studyId: studyId || 1,
        entityType: entityType || 'patient',
        entityId: entityId ? parseInt(entityId) : undefined,
        eventCrfId: eventCrfId ? parseInt(eventCrfId) : undefined,
        requiresApproval: requiresApproval || false,
        requiresSignature: requiresSignature || false
      }, userId, username);

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error creating workflow:', error);
      next(error);
    }
  }

  /**
   * Update workflow status
   * PUT /api/workflows/:id/status
   */
  async updateWorkflowStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const user = (req as any).user;
      const userId = user?.userId || user?.user_id;
      
      if (!status) {
        res.status(400).json({ success: false, message: 'Status is required' });
        return;
      }

      const result = await workflowService.updateWorkflowStatus(id, status, userId);
      
      res.json(result);
    } catch (error) {
      logger.error('Error updating workflow status:', error);
      next(error);
    }
  }

  /**
   * Complete workflow task
   * POST /api/workflows/:id/complete
   */
  async completeWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { signature } = req.body;
      const user = (req as any).user;
      const userId = user?.userId || user?.user_id;
      
      const result = await workflowService.completeWorkflow(id, userId, signature);
      
      res.json(result);
    } catch (error) {
      logger.error('Error completing workflow:', error);
      next(error);
    }
  }

  /**
   * Approve workflow task
   * POST /api/workflows/:id/approve
   */
  async approveWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const user = (req as any).user;
      const userId = user?.userId || user?.user_id;
      
      if (!reason) {
        res.status(400).json({ success: false, message: 'Reason is required for approval' });
        return;
      }

      const result = await workflowService.approveWorkflow(id, userId, reason);
      
      res.json(result);
    } catch (error) {
      logger.error('Error approving workflow:', error);
      next(error);
    }
  }

  /**
   * Reject workflow task
   * POST /api/workflows/:id/reject
   */
  async rejectWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const user = (req as any).user;
      const userId = user?.userId || user?.user_id;
      
      if (!reason) {
        res.status(400).json({ success: false, message: 'Reason is required for rejection' });
        return;
      }

      const result = await workflowService.rejectWorkflow(id, userId, reason);
      
      res.json(result);
    } catch (error) {
      logger.error('Error rejecting workflow:', error);
      next(error);
    }
  }

  /**
   * Handoff workflow task to another user/role
   * POST /api/workflows/:id/handoff
   */
  async handoffWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { toUserId, reason } = req.body;
      const user = (req as any).user;
      const currentUserId = user?.userId || user?.user_id;
      
      if (!toUserId) {
        res.status(400).json({ success: false, message: 'Target user is required' });
        return;
      }

      const result = await workflowService.handoffWorkflow(id, toUserId, reason || 'Reassigned', currentUserId);
      
      res.json(result);
    } catch (error) {
      logger.error('Error handing off workflow:', error);
      next(error);
    }
  }
}

export default WorkflowController;
