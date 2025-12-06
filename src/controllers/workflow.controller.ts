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
          COALESCE(ua.first_name || ' ' || ua.last_name, ua.user_name, 'Unassigned') as assigned_to_name,
          owner.user_name as created_by,
          s.name as study_name,
          ss.label as subject_label,
          dn.owner_id,
          dn.assigned_user_id
        FROM discrepancy_note dn
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        LEFT JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        LEFT JOIN user_account owner ON dn.owner_id = owner.user_id
        LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
        LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
        LEFT JOIN study s ON dn.study_id = s.study_id
        WHERE dn.parent_dn_id IS NULL
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
        title: row.title || 'Untitled Workflow',
        description: row.description || '',
        type: this.mapTypeFromDiscrepancyNote(row.type),
        status: this.mapStatus(row.status),
        priority: row.priority || 'medium',
        assignedTo: row.assigned_to ? [row.assigned_to] : [],
        assignedToName: row.assigned_to_name || 'Unassigned',
        assignedUserId: row.assigned_user_id,
        currentOwner: row.assigned_to || row.created_by,
        createdBy: row.created_by,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        dueDate: row.created_at ? new Date(new Date(row.created_at).getTime() + 7 * 24 * 60 * 60 * 1000) : null,
        requiredActions: [],
        completedActions: [],
        studyName: row.study_name,
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
          dn.date_created as updated_at,
          rs.name as status,
          dnt.name as type,
          ua.user_name as assigned_to,
          ua.first_name || ' ' || ' ' || ua.last_name as assigned_to_name,
          ss.label as subject_label,
          s.name as study_name
        FROM discrepancy_note dn
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        LEFT JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
        LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
        LEFT JOIN study s ON dn.study_id = s.study_id
        WHERE (ua.user_name = $1 OR dn.owner_id = (SELECT user_id FROM user_account WHERE user_name = $1))
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
          dn.date_created as updated_at,
          rs.name as status,
          dnt.name as type,
          ua.user_name as assigned_to,
          ua.first_name || ' ' || ua.last_name as assigned_to_name,
          ss.label as subject_label,
          s.name as study_name
        FROM discrepancy_note dn
        LEFT JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
        LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
        LEFT JOIN study s ON dn.study_id = s.study_id
        WHERE (ua.user_name = $1 OR dn.owner_id = (SELECT user_id FROM user_account WHERE user_name = $1))
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
      
      // Count completed today (using date_created as date_updated doesn't exist in LibreClinica schema)
      const completedTodayQuery = `
        SELECT COUNT(*) as count
        FROM discrepancy_note dn
        LEFT JOIN user_account ua ON dn.assigned_user_id = ua.user_id
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        WHERE (ua.user_name = $1 OR dn.owner_id = (SELECT user_id FROM user_account WHERE user_name = $1))
        AND rs.name = 'Closed'
        AND dn.date_created::date = CURRENT_DATE
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
      const { title, description, studyId, entityType, entityId, assignedTo, type, priority } = req.body;
      const userId = (req as any).user.userId;
      
      // Get assigned user ID - handle array or string
      const assigneeUsername = Array.isArray(assignedTo) ? assignedTo[0] : assignedTo;
      
      let assignedUserId = userId; // Default to current user
      if (assigneeUsername) {
        const userResult = await pool.query(
          'SELECT user_id FROM user_account WHERE user_name = $1',
          [assigneeUsername]
        );
        
        if (userResult.rows.length > 0) {
          assignedUserId = userResult.rows[0].user_id;
        }
      }
      
      // Map workflow type to discrepancy_note_type_id
      const typeMap: Record<string, number> = {
        'data_query': 3,           // Query
        'form_review': 2,          // Annotation
        'change_request': 4,       // Reason for Change
        'protocol_deviation': 1,   // Failed Validation Check
        'adverse_event': 3,        // Query
        'visit_completion': 2,     // Annotation
        'patient_enrollment': 2,   // Annotation
        'electronic_signature': 2, // Annotation
        'study_milestone': 2,      // Annotation
        'custom': 3                // Query
      };
      
      const discrepancyNoteTypeId = typeMap[type] || 3;
      
      // Map entity type to LibreClinica format
      const entityTypeMap: Record<string, string> = {
        'patient': 'studySub',
        'subject': 'studySub',
        'form': 'itemData',
        'event': 'studyEvent',
        'study': 'study'
      };
      
      const lcEntityType = entityTypeMap[entityType] || 'studySub';
      
      // Create discrepancy note (without entity_id - that's handled via mapping tables)
      const insertQuery = `
        INSERT INTO discrepancy_note (
          description, detailed_notes, discrepancy_note_type_id,
          resolution_status_id, study_id, assigned_user_id,
          owner_id, entity_type, date_created
        )
        VALUES ($1, $2, $3, 1, $4, $5, $6, $7, NOW())
        RETURNING discrepancy_note_id
      `;
      
      logger.info('Creating workflow with params', {
        title,
        description: description || '',
        discrepancyNoteTypeId,
        studyId: studyId || 1,
        assignedUserId,
        ownerId: userId,
        entityType: lcEntityType,
        assigneeUsername
      });
      
      const result = await pool.query(insertQuery, [
        title,
        description || '',
        discrepancyNoteTypeId,
        studyId || 1,
        assignedUserId,
        userId,
        lcEntityType
      ]);
      
      const discrepancyNoteId = result.rows[0].discrepancy_note_id;
      
      logger.info('Workflow created successfully', { discrepancyNoteId, assignedUserId, ownerId: userId });
      
      // If entityId provided and it's a subject, link via mapping table
      if (entityId && (entityType === 'patient' || entityType === 'subject')) {
        try {
          // Try to parse entityId as a number or find by label
          let subjectId = parseInt(entityId);
          
          if (isNaN(subjectId)) {
            // Try to find by label
            const subjectResult = await pool.query(
              'SELECT study_subject_id FROM study_subject WHERE label = $1 LIMIT 1',
              [entityId]
            );
            if (subjectResult.rows.length > 0) {
              subjectId = subjectResult.rows[0].study_subject_id;
            }
          }
          
          if (!isNaN(subjectId) && subjectId > 0) {
            await pool.query(
              'INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name) VALUES ($1, $2, $3)',
              [discrepancyNoteId, subjectId, 'label']
            );
          }
        } catch (mapError) {
          logger.warn('Could not link workflow to subject', { entityId, error: mapError });
        }
      }
      
      const response: ApiResponse = {
        success: true,
        data: { 
          id: discrepancyNoteId,
          title,
          type: type || 'custom',
          status: 'pending',
          assignedTo: assigneeUsername
        },
        message: 'Workflow task created successfully'
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

