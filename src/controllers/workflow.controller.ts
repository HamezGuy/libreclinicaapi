import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../config/logger';
import { ApiResponse } from '../types';

export class WorkflowController {
  /**
   * Get all workflows
   */
  async getAllWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, priority, assignedTo, studyId } = req.query;
      
      let query = `
        SELECT 
          dn.discrepancy_note_id as id,
          dn.description as title,
          dn.detailed_notes as description,
          dn.date_created as created_at,
          dn.resolution_status_id as status_id,
          rs.name as status,
          dnt.name as type,
          'medium' as priority,
          ua.user_name as assigned_to,
          ua.first_name || ' ' || last_name as assigned_to_name,
          s.name as study_name,
          ss.label as subject_label
        FROM discrepancy_note dn
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        LEFT JOIN study_subject ss ON dn.entity_id = ss.study_subject_id
        LEFT JOIN study s ON ss.study_id = s.study_id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramCount = 1;
      
      if (status) {
        query += ` AND rs.name = $${paramCount++}`;
        params.push(status);
      }
      
      if (assignedTo) {
        query += ` AND ua.user_name = $${paramCount++}`;
        params.push(assignedTo);
      }
      
      if (studyId) {
        query += ` AND s.study_id = $${paramCount++}`;
        params.push(studyId);
      }
      
      query += ' ORDER BY dn.date_created DESC LIMIT 100';
      
      const result = await pool.query(query, params);
      
      const workflows = result.rows.map((row: any) => ({
        id: row.id.toString(),
        title: row.title,
        description: row.description,
        type: this.mapTypeFromDiscrepancyNote(row.type),
        status: this.mapStatus(row.status),
        priority: row.priority,
        assignedTo: [row.assigned_to],
        assignedToName: row.assigned_to_name,
        currentOwner: row.assigned_to,
        createdAt: row.created_at,
        dueDate: null,
        requiredActions: [],
        completedActions: [],
        relatedEntity: row.subject_label ? {
          type: 'subject',
          id: row.subject_label,
          name: row.subject_label
        } : undefined
      }));
      
      const response: ApiResponse = {
        success: true,
        data: workflows,
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
   */
  async getUserWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      
      const query = `
        SELECT 
          dn.discrepancy_note_id as id,
          dn.description as title,
          dn.detailed_notes as description,
          dn.date_created as created_at,
          dn.date_updated as updated_at,
          rs.name as status,
          dnt.name as type,
          ua.user_name as assigned_to,
          ua.first_name || ' ' || ' ' || ua.last_name as assigned_to_name,
          ss.label as subject_label,
          s.name as study_name
        FROM discrepancy_note dn
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        LEFT JOIN study_subject ss ON dn.entity_id = ss.study_subject_id
        LEFT JOIN study s ON ss.study_id = s.study_id
        WHERE ua.user_name = $1
        AND rs.name IN ('New', 'Updated', 'Resolution Proposed')
        ORDER BY dn.date_created DESC
      `;
      
      const result = await pool.query(query, [userId]);
      
      const workflows = result.rows.map((row: any) => ({
        id: row.id.toString(),
        title: row.title,
        description: row.description,
        type: this.mapTypeFromDiscrepancyNote(row.type),
        status: this.mapStatus(row.status),
        priority: 'medium',
        assignedTo: [row.assigned_to],
        currentOwner: row.assigned_to,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        relatedEntity: row.subject_label ? {
          type: 'subject',
          id: row.subject_label,
          name: row.subject_label
        } : undefined
      }));
      
      const response: ApiResponse = {
        success: true,
        data: workflows
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error fetching user workflows:', error);
      next(error);
    }
  }

  /**
   * Get user task summary with organized task arrays
   */
  async getUserTaskSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      
      // Get counts
      const countQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE rs.name = 'New') as pending,
          COUNT(*) FILTER (WHERE rs.name = 'Updated') as in_progress,
          COUNT(*) FILTER (WHERE rs.name = 'Resolution Proposed') as awaiting_approval,
          COUNT(*) FILTER (WHERE rs.name = 'Closed') as completed,
          COUNT(*) as total
        FROM discrepancy_note dn
        JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE ua.user_name = $1
      `;
      
      const countResult = await pool.query(countQuery, [userId]);
      const counts = countResult.rows[0];
      
      // Get all tasks with full details for organization
      const tasksQuery = `
        SELECT 
          dn.discrepancy_note_id as id,
          dn.description as title,
          dn.detailed_notes as description,
          dn.date_created as created_at,
          dn.date_updated as updated_at,
          rs.name as status,
          dnt.name as type,
          ua.user_name as assigned_to,
          ua.first_name || ' ' || ua.last_name as assigned_to_name,
          ss.label as subject_label,
          s.name as study_name
        FROM discrepancy_note dn
        JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        LEFT JOIN study_subject ss ON dn.entity_id = ss.study_subject_id
        LEFT JOIN study s ON ss.study_id = s.study_id
        WHERE ua.user_name = $1
        AND rs.name IN ('New', 'Updated', 'Resolution Proposed')
        ORDER BY dn.date_created DESC
        LIMIT 100
      `;
      
      const tasksResult = await pool.query(tasksQuery, [userId]);
      
      // Map and organize tasks
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const mappedTasks = tasksResult.rows.map((row: any) => {
        // Create a due date based on creation date + 7 days (configurable)
        const createdAt = new Date(row.created_at);
        const dueDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        return {
          id: row.id.toString(),
          title: row.title || 'Task',
          description: row.description || '',
          type: this.mapTypeFromDiscrepancyNote(row.type),
          status: this.mapStatus(row.status),
          priority: this.calculatePriority(dueDate, now),
          assignedTo: [row.assigned_to],
          assignedToName: row.assigned_to_name,
          currentOwner: row.assigned_to,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          dueDate: dueDate,
          requiredActions: [{ name: 'Review', completed: false }, { name: 'Respond', completed: false }],
          completedActions: [],
          relatedEntity: row.subject_label ? {
            type: 'subject',
            id: row.subject_label,
            name: row.subject_label
          } : undefined
        };
      });
      
      // Organize tasks into categories
      const overdue: any[] = [];
      const dueToday: any[] = [];
      const inProgress: any[] = [];
      const pending: any[] = [];
      
      mappedTasks.forEach((task: any) => {
        const taskDue = new Date(task.dueDate);
        
        if (taskDue < today) {
          overdue.push({ ...task, priority: 'critical' });
        } else if (taskDue.toDateString() === today.toDateString()) {
          dueToday.push(task);
        } else if (task.status === 'in_progress') {
          inProgress.push(task);
        } else if (task.status === 'pending') {
          pending.push(task);
        }
      });
      
      // Count completed today
      const completedTodayQuery = `
        SELECT COUNT(*) as count
        FROM discrepancy_note dn
        JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE ua.user_name = $1 
        AND rs.name = 'Closed'
        AND dn.date_updated::date = CURRENT_DATE
      `;
      const completedTodayResult = await pool.query(completedTodayQuery, [userId]);
      const completedToday = parseInt(completedTodayResult.rows[0]?.count) || 0;
      
      const summary = {
        totalTasks: parseInt(counts.total) || 0,
        pendingTasks: parseInt(counts.pending) || 0,
        inProgressTasks: parseInt(counts.in_progress) || 0,
        awaitingApprovalTasks: parseInt(counts.awaiting_approval) || 0,
        completedTasks: parseInt(counts.completed) || 0,
        overdueTasks: overdue.length,
        statistics: {
          overdueCount: overdue.length,
          totalActive: (parseInt(counts.pending) || 0) + (parseInt(counts.in_progress) || 0),
          completedToday: completedToday,
          completedThisWeek: parseInt(counts.completed) || 0,
          avgCompletionTime: 0
        },
        tasks: {
          overdue,
          dueToday,
          inProgress,
          pending
        }
      };
      
      const response: ApiResponse = {
        success: true,
        data: summary
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error fetching user task summary:', error);
      next(error);
    }
  }
  
  /**
   * Calculate task priority based on due date
   */
  private calculatePriority(dueDate: Date, now: Date): string {
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'critical';
    if (diffDays === 0) return 'high';
    if (diffDays <= 3) return 'medium';
    return 'low';
  }

  /**
   * Create new workflow (create discrepancy note)
   */
  async createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, description, studyId, entityType, entityId, assignedTo } = req.body;
      const userId = (req as any).user.userId;
      
      // Get assigned user ID
      const userResult = await pool.query(
        'SELECT user_id FROM user_account WHERE user_name = $1',
        [assignedTo[0] || assignedTo]
      );
      
      if (userResult.rows.length === 0) {
        res.status(400).json({ success: false, message: 'Assigned user not found' });
        return;
      }
      
      const assignedUserId = userResult.rows[0].user_id;
      
      // Create discrepancy note
      const insertQuery = `
        INSERT INTO discrepancy_note (
          description, detailed_notes, discrepancy_note_type_id,
          resolution_status_id, study_id, assigned_user_id,
          owner_id, entity_type, entity_id, date_created
        )
        VALUES ($1, $2, 3, 1, $3, $4, $5, $6, $7, NOW())
        RETURNING discrepancy_note_id
      `;
      
      const result = await pool.query(insertQuery, [
        title,
        description,
        studyId || 1,
        assignedUserId,
        userId,
        entityType || 'studySub',
        entityId || 0
      ]);
      
      const response: ApiResponse = {
        success: true,
        data: { id: result.rows[0].discrepancy_note_id },
        message: 'Workflow created successfully'
      };
      
      res.status(201).json(response);
    } catch (error) {
      logger.error('Error creating workflow:', error);
      next(error);
    }
  }

  /**
   * Update workflow status
   */
  async updateWorkflowStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      const statusMap: Record<string, number> = {
        'pending': 1, // New
        'in_progress': 2, // Updated
        'awaiting_approval': 3, // Resolution Proposed
        'completed': 4, // Closed
        'cancelled': 5  // Not Available
      };
      
      const statusId = statusMap[status] || 1;
      
      await pool.query(
        'UPDATE discrepancy_note SET resolution_status_id = $1, date_updated = NOW() WHERE discrepancy_note_id = $2',
        [statusId, id]
      );
      
      const response: ApiResponse = {
        success: true,
        message: 'Workflow status updated successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error updating workflow status:', error);
      next(error);
    }
  }

  /**
   * Complete workflow
   */
  async completeWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      
      await pool.query(
        'UPDATE discrepancy_note SET resolution_status_id = 4, date_updated = NOW() WHERE discrepancy_note_id = $1',
        [id]
      );
      
      const response: ApiResponse = {
        success: true,
        message: 'Workflow completed successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error completing workflow:', error);
      next(error);
    }
  }

  /**
   * Approve workflow
   */
  async approveWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      await pool.query(
        'UPDATE discrepancy_note SET resolution_status_id = 4, detailed_notes = detailed_notes || $1, date_updated = NOW() WHERE discrepancy_note_id = $2',
        [`\n\nApproved: ${reason}`, id]
      );
      
      const response: ApiResponse = {
        success: true,
        message: 'Workflow approved successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error approving workflow:', error);
      next(error);
    }
  }

  /**
   * Reject workflow
   */
  async rejectWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      await pool.query(
        'UPDATE discrepancy_note SET resolution_status_id = 5, detailed_notes = detailed_notes || $1, date_updated = NOW() WHERE discrepancy_note_id = $2',
        [`\n\nRejected: ${reason}`, id]
      );
      
      const response: ApiResponse = {
        success: true,
        message: 'Workflow rejected successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error rejecting workflow:', error);
      next(error);
    }
  }

  /**
   * Handoff workflow to another user
   */
  async handoffWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { toUserId, reason } = req.body;
      
      // Get new assigned user ID
      const userResult = await pool.query(
        'SELECT user_id FROM user_account WHERE user_name = $1',
        [toUserId]
      );
      
      if (userResult.rows.length === 0) {
        res.status(400).json({ success: false, message: 'Target user not found' });
        return;
      }
      
      const newAssignedUserId = userResult.rows[0].user_id;
      
      await pool.query(
        'UPDATE discrepancy_note SET assigned_user_id = $1, detailed_notes = detailed_notes || $2, date_updated = NOW() WHERE discrepancy_note_id = $3',
        [newAssignedUserId, `\n\nHandoff: ${reason}`, id]
      );
      
      const response: ApiResponse = {
        success: true,
        message: 'Workflow handed off successfully'
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Error handing off workflow:', error);
      next(error);
    }
  }

  // Helper methods
  private mapTypeFromDiscrepancyNote(type: string): string {
    const typeMap: Record<string, string> = {
      'Failed Validation Check': 'data_query',
      'Query': 'data_query',
      'Annotation': 'form_review',
      'Reason for Change': 'change_request'
    };
    return typeMap[type] || 'custom';
  }

  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'New': 'pending',
      'Updated': 'in_progress',
      'Resolution Proposed': 'awaiting_approval',
      'Closed': 'completed',
      'Not Applicable': 'cancelled'
    };
    return statusMap[status] || 'pending';
  }
}

