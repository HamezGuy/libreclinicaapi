/**
 * Workflow Service
 * 
 * Handles workflow operations for clinical data capture
 * Includes both entity-level workflows (subject/event/CRF) and task management workflows
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../types';

// ============================================================================
// Entity Workflow Types (Subject/Event/CRF)
// ============================================================================

export interface WorkflowStatus {
  status: string;
  step: string;
  completedSteps: string[];
  pendingSteps: string[];
}

// ============================================================================
// Task Management Types
// ============================================================================

export type WorkflowPriority = 'low' | 'medium' | 'high' | 'critical';
export type WorkflowType = 'data_entry' | 'review' | 'approval' | 'signature' | 'sdv' | 'query' | 'custom';

/**
 * Task status values aligned with frontend WorkflowStatus type
 * for consistency across the application
 * 
 * 21 CFR Part 11 Workflow States:
 * - pending: Task created, awaiting action
 * - in_progress: Task actively being worked on
 * - awaiting_approval: Task completed, awaiting approval/signature
 * - approved: Task approved by authorized user
 * - rejected: Task rejected, requires rework
 * - completed: Task fully completed
 * - cancelled: Task cancelled (with audit reason)
 * - overdue: Task past due date (computed status)
 * - on_hold: Task temporarily paused
 */
export type TaskStatus = 
  | 'pending' 
  | 'in_progress' 
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed' 
  | 'cancelled' 
  | 'overdue'
  | 'on_hold';

export interface WorkflowTask {
  id: number;
  title: string;
  description?: string;
  type: WorkflowType;
  priority: WorkflowPriority;
  status: TaskStatus;
  assignedTo: string[];
  createdBy: number;
  createdByUsername: string;
  dueDate?: Date;
  studyId: number;
  entityType?: string;
  entityId?: number;
  eventCrfId?: number;
  requiresApproval: boolean;
  requiresSignature: boolean;
  completedAt?: Date;
  completedBy?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowParams {
  title: string;
  description?: string;
  type: WorkflowType;
  priority: WorkflowPriority;
  assignedTo: string[];
  dueDate?: Date;
  studyId: number;
  entityType?: string;
  entityId?: number;
  eventCrfId?: number;
  requiresApproval: boolean;
  requiresSignature: boolean;
}

export interface WorkflowFilters {
  status?: string;
  priority?: WorkflowPriority;
  assignedTo?: string;
  studyId?: number;
  type?: WorkflowType;
  limit?: number;
  offset?: number;
}

export interface TaskSummary {
  pendingTasks: WorkflowTask[];
  inProgressTasks: WorkflowTask[];
  completedTasks: WorkflowTask[];
  overdueTasks: WorkflowTask[];
  totalCount: number;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  action: string;
  userId: number;
  timestamp: Date;
}

/**
 * Get workflow status for a subject
 */
export const getSubjectWorkflowStatus = async (
  studySubjectId: number
): Promise<WorkflowStatus | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        ss.status_id,
        s.name as status_name
      FROM study_subject ss
      LEFT JOIN status s ON ss.status_id = s.status_id
      WHERE ss.study_subject_id = $1
    `, [studySubjectId]);

    if (result.rows.length === 0) {
      return null;
    }

    const statusId = result.rows[0].status_id;
    const statusName = result.rows[0].status_name || 'unknown';

    return {
      status: statusName,
      step: statusName,
      completedSteps: [],
      pendingSteps: []
    };
  } catch (error: any) {
    logger.error('Failed to get subject workflow status', { 
      studySubjectId, 
      error: error.message 
    });
    return null;
  }
};

/**
 * Get workflow status for an event
 */
export const getEventWorkflowStatus = async (
  studyEventId: number
): Promise<WorkflowStatus | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        se.subject_event_status_id,
        ses.name as status_name
      FROM study_event se
      LEFT JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
      WHERE se.study_event_id = $1
    `, [studyEventId]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      status: result.rows[0].status_name || 'unknown',
      step: result.rows[0].status_name || 'unknown',
      completedSteps: [],
      pendingSteps: []
    };
  } catch (error: any) {
    logger.error('Failed to get event workflow status', { 
      studyEventId, 
      error: error.message 
    });
    return null;
  }
};

/**
 * Get workflow status for a CRF
 */
export const getCRFWorkflowStatus = async (
  eventCrfId: number
): Promise<WorkflowStatus | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        ec.status_id,
        s.name as status_name
      FROM event_crf ec
      LEFT JOIN status s ON ec.status_id = s.status_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      status: result.rows[0].status_name || 'unknown',
      step: result.rows[0].status_name || 'unknown',
      completedSteps: [],
      pendingSteps: []
    };
  } catch (error: any) {
    logger.error('Failed to get CRF workflow status', { 
      eventCrfId, 
      error: error.message 
    });
    return null;
  }
};

/**
 * Transition workflow state
 */
export const transitionWorkflow = async (
  entityType: 'subject' | 'event' | 'crf',
  entityId: number,
  newStatus: string,
  userId: number,
  reason?: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Transitioning workflow', { entityType, entityId, newStatus, userId });

  try {
    let table: string;
    let idColumn: string;
    
    switch (entityType) {
      case 'subject':
        table = 'study_subject';
        idColumn = 'study_subject_id';
        break;
      case 'event':
        table = 'study_event';
        idColumn = 'study_event_id';
        break;
      case 'crf':
        table = 'event_crf';
        idColumn = 'event_crf_id';
        break;
      default:
        return { success: false, message: 'Invalid entity type' };
    }

    // Get status ID from name
    const statusResult = await pool.query(
      'SELECT status_id FROM status WHERE name ILIKE $1 LIMIT 1',
      [newStatus]
    );

    if (statusResult.rows.length === 0) {
      return { success: false, message: `Unknown status: ${newStatus}` };
    }

    const statusId = statusResult.rows[0].status_id;

    // Update entity status
    await pool.query(
      `UPDATE ${table} SET status_id = $1, update_id = $2, date_updated = NOW() WHERE ${idColumn} = $3`,
      [statusId, userId, entityId]
    );

    // Log audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table, 
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), $1, $2, $3, $4, $5, $6)
    `, [
      table,
      entityId,
      `${entityType}_workflow_transition`,
      userId,
      JSON.stringify({ newStatus, statusId }),
      reason || 'Workflow transition'
    ]);

    logger.info('Workflow transitioned successfully', { 
      entityType, 
      entityId, 
      newStatus 
    });

    return { success: true, message: `Workflow transitioned to ${newStatus}` };
  } catch (error: any) {
    logger.error('Workflow transition failed', { 
      entityType, 
      entityId, 
      error: error.message 
    });
    return { success: false, message: error.message };
  }
};

/**
 * Get available workflow transitions for an entity
 */
export const getAvailableTransitions = async (
  entityType: 'subject' | 'event' | 'crf',
  entityId: number
): Promise<string[]> => {
  // For now, return common transitions based on entity type
  // In a full implementation, this would be configurable
  switch (entityType) {
    case 'subject':
      return ['available', 'signed', 'locked', 'removed'];
    case 'event':
      return ['scheduled', 'data_entry_started', 'completed', 'signed', 'locked'];
    case 'crf':
      return ['initial_data_entry', 'double_data_entry', 'complete', 'locked'];
    default:
      return [];
  }
};

/**
 * Trigger workflow for SDV completion
 * Called with: (eventCrfId, userId)
 * 
 * When SDV is completed, auto-complete any pending SDV workflow tasks
 * This follows real EDC patterns - completing SDV closes the SDV task
 * 
 * 21 CFR Part 11 §11.10(e) - Audit trail for completed actions
 */
export const triggerSDVCompletedWorkflow = async (
  eventCrfId: number,
  userId: number
): Promise<void> => {
  try {
    logger.info('SDV workflow completed', { eventCrfId, userId });
    
    // Auto-complete any pending SDV tasks for this event_crf
    try {
      await pool.query(`
        UPDATE acc_workflow_tasks
        SET status = 'completed', 
            completed_at = NOW(), 
            completed_by = $1,
            updated_at = NOW()
        WHERE event_crf_id = $2 
          AND type = 'sdv' 
          AND status IN ('pending', 'in_progress')
      `, [userId, eventCrfId]);
      logger.info('Auto-completed SDV workflow tasks', { eventCrfId });
    } catch (taskError: any) {
      if (taskError.code !== '42P01') {
        throw taskError;
      }
    }

    // Log the SDV completion event in audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value
      ) VALUES (1, NOW(), 'sdv_workflow', $1, 'sdv_completed', $2, $3)
    `, [eventCrfId, userId, JSON.stringify({ eventCrfId })]);
  } catch (error: any) {
    logger.error('Failed to trigger SDV workflow', { error: error.message });
  }
};

/**
 * Trigger workflow for form submission
 * Called from form.service.ts with: (eventCrfId, studyId, subjectId, formName, userId)
 * 
 * Creates an SDV workflow task automatically when a form is submitted
 * This follows real EDC patterns - form submission triggers SDV requirement
 * 
 * 21 CFR Part 11 §11.10(f) - Operational checks to enforce permitted sequencing
 */
export const triggerFormSubmittedWorkflow = async (
  eventCrfId: number,
  studyId: number,
  subjectId: number,
  formName: string,
  userId: number
): Promise<void> => {
  try {
    logger.info('Form submission workflow triggered', { eventCrfId, studyId, subjectId, formName, userId });
    
    // Get username for audit trail
    const userResult = await pool.query(
      'SELECT user_name FROM user_account WHERE user_id = $1',
      [userId]
    );
    const username = userResult.rows[0]?.user_name || 'system';

    // Get subject label for workflow title
    const subjectResult = await pool.query(
      'SELECT label FROM study_subject WHERE study_subject_id = $1',
      [subjectId]
    );
    const subjectLabel = subjectResult.rows[0]?.label || `Subject ${subjectId}`;

    // Create SDV workflow task in acc_workflow_tasks table
    try {
      await pool.query(`
        INSERT INTO acc_workflow_tasks (
          title, description, type, priority, status,
          assigned_to, study_id, entity_type, entity_id, event_crf_id,
          requires_approval, requires_signature,
          created_by, created_by_username, created_at, updated_at
        ) VALUES (
          $1, $2, 'sdv', 'medium', 'pending',
          ARRAY[]::TEXT[], $3, 'event_crf', $4, $5,
          false, false,
          $6, $7, NOW(), NOW()
        )
      `, [
        `SDV Required: ${formName} - ${subjectLabel}`,
        `Source data verification required for ${formName} submitted by ${username}`,
        studyId,
        eventCrfId,
        eventCrfId,
        userId,
        username
      ]);
      logger.info('Created SDV workflow task', { eventCrfId, formName });
    } catch (taskError: any) {
      // If acc_workflow_tasks doesn't exist, fall through to audit log only
      if (taskError.code !== '42P01') {
        throw taskError;
      }
      logger.warn('acc_workflow_tasks table not found, skipping task creation');
    }

    // Log the form submission event in audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value
      ) VALUES (1, NOW(), 'form_workflow', $1, 'form_submitted', $2, $3)
    `, [eventCrfId, userId, JSON.stringify({ eventCrfId, studyId, subjectId, formName })]);
    
  } catch (error: any) {
    logger.error('Failed to trigger form workflow', { error: error.message });
  }
};

/**
 * Trigger workflow for subject enrollment
 * Called with: (studySubjectId, studyId, subjectLabel, userId)
 */
export const triggerSubjectEnrolledWorkflow = async (
  studySubjectId: number,
  studyId: number,
  subjectLabel: string,
  userId: number
): Promise<void> => {
  try {
    logger.info('Subject enrollment workflow triggered', { studySubjectId, studyId, subjectLabel, userId });
    // Log the enrollment event
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value
      ) VALUES (1, NOW(), 'enrollment_workflow', $1, 'subject_enrolled', $2, $3)
    `, [studySubjectId, userId, JSON.stringify({ studySubjectId, studyId, subjectLabel })]);
  } catch (error: any) {
    logger.error('Failed to trigger enrollment workflow', { error: error.message });
  }
};

// ============================================================================
// Task Management Functions (for WorkflowController)
// ============================================================================

/**
 * Get all workflow tasks with filters
 */
export const getAllWorkflows = async (
  filters: WorkflowFilters
): Promise<ApiResponse<WorkflowTask[]>> => {
  try {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters.priority) {
      conditions.push(`priority = $${paramIndex++}`);
      params.push(filters.priority);
    }
    if (filters.studyId) {
      conditions.push(`study_id = $${paramIndex++}`);
      params.push(filters.studyId);
    }
    if (filters.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(filters.type);
    }
    if (filters.assignedTo) {
      conditions.push(`$${paramIndex++} = ANY(assigned_to)`);
      params.push(filters.assignedTo);
    }

    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const query = `
      SELECT * FROM acc_workflow_tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY 
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        due_date ASC NULLS LAST,
        created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(mapRowToTask)
    };
  } catch (error: any) {
    // If table doesn't exist, return empty array
    if (error.code === '42P01') {
      logger.warn('acc_workflow_tasks table does not exist, returning empty array');
      return { success: true, data: [] };
    }
    logger.error('Failed to get all workflows', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get workflows for a specific user
 */
export const getUserWorkflows = async (
  userId: string
): Promise<ApiResponse<WorkflowTask[]>> => {
  try {
    const result = await pool.query(`
      SELECT * FROM acc_workflow_tasks
      WHERE $1 = ANY(assigned_to) AND status NOT IN ('completed', 'cancelled')
      ORDER BY 
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        due_date ASC NULLS LAST
    `, [userId]);

    return {
      success: true,
      data: result.rows.map(mapRowToTask)
    };
  } catch (error: any) {
    if (error.code === '42P01') {
      return { success: true, data: [] };
    }
    logger.error('Failed to get user workflows', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get user task summary with categorized tasks
 */
export const getUserTaskSummary = async (
  userId: string
): Promise<ApiResponse<TaskSummary>> => {
  try {
    const result = await pool.query(`
      SELECT * FROM acc_workflow_tasks
      WHERE $1 = ANY(assigned_to)
      ORDER BY created_at DESC
    `, [userId]);

    const tasks = result.rows.map(mapRowToTask);
    const now = new Date();

    const summary: TaskSummary = {
      pendingTasks: tasks.filter(t => t.status === 'pending'),
      inProgressTasks: tasks.filter(t => t.status === 'in_progress'),
      completedTasks: tasks.filter(t => t.status === 'completed'),
      overdueTasks: tasks.filter(t => 
        t.dueDate && new Date(t.dueDate) < now && 
        t.status !== 'completed' && t.status !== 'cancelled'
      ),
      totalCount: tasks.length
    };

    return { success: true, data: summary };
  } catch (error: any) {
    if (error.code === '42P01') {
      return { 
        success: true, 
        data: { 
          pendingTasks: [], 
          inProgressTasks: [], 
          completedTasks: [], 
          overdueTasks: [],
          totalCount: 0 
        } 
      };
    }
    logger.error('Failed to get user task summary', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Create a new workflow task
 */
export const createWorkflow = async (
  params: CreateWorkflowParams,
  userId: number,
  username: string
): Promise<ApiResponse<WorkflowTask>> => {
  try {
    const result = await pool.query(`
      INSERT INTO acc_workflow_tasks (
        title, description, type, priority, status,
        assigned_to, due_date, study_id, entity_type, entity_id,
        event_crf_id, requires_approval, requires_signature,
        created_by, created_by_username, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'pending',
        $5, $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, NOW(), NOW()
      )
      RETURNING *
    `, [
      params.title,
      params.description || null,
      params.type,
      params.priority,
      params.assignedTo,
      params.dueDate || null,
      params.studyId,
      params.entityType || null,
      params.entityId || null,
      params.eventCrfId || null,
      params.requiresApproval,
      params.requiresSignature,
      userId,
      username
    ]);

    logger.info('Workflow task created', { taskId: result.rows[0].id, title: params.title });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    logger.error('Failed to create workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Update workflow status with 21 CFR Part 11 transition validation
 * 
 * §11.10(f) - Operational checks to enforce permitted sequencing of steps
 * §11.10(e) - Audit trail for status changes
 */
export const updateWorkflowStatus = async (
  taskId: string,
  status: TaskStatus,
  userId: number,
  reason?: string
): Promise<ApiResponse<WorkflowTask>> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current task status for validation
    const currentTask = await client.query(
      'SELECT id, status, type FROM acc_workflow_tasks WHERE id = $1',
      [taskId]
    );

    if (currentTask.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Workflow task not found' };
    }

    const currentStatus = currentTask.rows[0].status;
    const workflowType = currentTask.rows[0].type;

    // No change needed if status is the same
    if (currentStatus === status) {
      await client.query('ROLLBACK');
      return { 
        success: true, 
        data: mapRowToTask(currentTask.rows[0]),
        message: 'Status unchanged' 
      };
    }

    // Validate transition is allowed (21 CFR Part 11 §11.10(f))
    const transitionCheck = await client.query(`
      SELECT requires_reason, requires_signature, description
      FROM acc_workflow_transition_rules
      WHERE from_status = $1 
        AND to_status = $2
        AND (workflow_type IS NULL OR workflow_type = $3)
      LIMIT 1
    `, [currentStatus, status, workflowType]);

    // If transition rules table doesn't exist or no rules found, allow with warning
    let requiresReason = false;
    if (transitionCheck.rows.length > 0) {
      requiresReason = transitionCheck.rows[0].requires_reason;
      
      // Check if reason is required but not provided
      if (requiresReason && (!reason || reason.trim() === '')) {
        await client.query('ROLLBACK');
        return { 
          success: false, 
          message: `Transition from ${currentStatus} to ${status} requires a reason` 
        };
      }
    } else {
      // Log warning for unmapped transition but allow it
      logger.warn('Workflow transition not in rules table', { 
        from: currentStatus, 
        to: status, 
        workflowType 
      });
    }

    // Update the status
    const result = await client.query(`
      UPDATE acc_workflow_tasks
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, taskId]);

    // Log transition in acc_workflow_transitions if table exists
    try {
      const userResult = await client.query(
        'SELECT user_name FROM user_account WHERE user_id = $1',
        [userId]
      );
      const username = userResult.rows[0]?.user_name || 'unknown';

      await client.query(`
        INSERT INTO acc_workflow_transitions (
          workflow_task_id, from_status, to_status, 
          transition_reason, user_id, username, transition_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [taskId, currentStatus, status, reason || null, userId, username]);
    } catch (transitionError: any) {
      // Table might not exist yet - that's OK
      if (transitionError.code !== '42P01') {
        throw transitionError;
      }
    }

    // Log to main audit trail
    await client.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, old_value, new_value, reason_for_change
      ) VALUES (1, NOW(), 'acc_workflow_tasks', $1, 'workflow_status_change', $2, $3, $4, $5)
    `, [taskId, userId, currentStatus, status, reason || 'Status transition']);

    await client.query('COMMIT');

    logger.info('Workflow status updated', { 
      taskId, 
      from: currentStatus, 
      to: status, 
      userId,
      reason 
    });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to update workflow status', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Complete a workflow task
 */
export const completeWorkflow = async (
  taskId: string,
  userId: number,
  signature?: string
): Promise<ApiResponse<WorkflowTask>> => {
  try {
    const result = await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'completed', completed_at = NOW(), completed_by = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [userId, taskId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Workflow task not found' };
    }

    logger.info('Workflow completed', { taskId, userId });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    logger.error('Failed to complete workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Approve a workflow task
 */
export const approveWorkflow = async (
  taskId: string,
  userId: number,
  reason: string
): Promise<ApiResponse<WorkflowTask>> => {
  try {
    const result = await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'completed', completed_at = NOW(), completed_by = $1, updated_at = NOW()
      WHERE id = $2 AND requires_approval = true
      RETURNING *
    `, [userId, taskId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Workflow task not found or does not require approval' };
    }

    // Log approval in audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'acc_workflow_tasks', $1, 'workflow_approved', $2, $3, $4)
    `, [taskId, userId, JSON.stringify({ status: 'approved' }), reason]);

    logger.info('Workflow approved', { taskId, userId, reason });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    logger.error('Failed to approve workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Reject a workflow task
 */
export const rejectWorkflow = async (
  taskId: string,
  userId: number,
  reason: string
): Promise<ApiResponse<WorkflowTask>> => {
  try {
    const result = await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [taskId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Workflow task not found' };
    }

    // Log rejection in audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'acc_workflow_tasks', $1, 'workflow_rejected', $2, $3, $4)
    `, [taskId, userId, JSON.stringify({ status: 'rejected' }), reason]);

    logger.info('Workflow rejected', { taskId, userId, reason });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    logger.error('Failed to reject workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Handoff workflow to another user
 */
export const handoffWorkflow = async (
  taskId: string,
  toUserId: string,
  reason: string,
  currentUserId: number
): Promise<ApiResponse<WorkflowTask>> => {
  try {
    // Get current task to preserve existing assignees
    const currentTask = await pool.query(
      'SELECT assigned_to FROM acc_workflow_tasks WHERE id = $1',
      [taskId]
    );

    if (currentTask.rows.length === 0) {
      return { success: false, message: 'Workflow task not found' };
    }

    const result = await pool.query(`
      UPDATE acc_workflow_tasks
      SET assigned_to = array_append(
        array_remove(assigned_to, $1::text),
        $2::text
      ), updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [String(currentUserId), toUserId, taskId]);

    // Log handoff in audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'acc_workflow_tasks', $1, 'workflow_handoff', $2, $3, $4)
    `, [taskId, currentUserId, JSON.stringify({ fromUser: currentUserId, toUser: toUserId }), reason]);

    logger.info('Workflow handed off', { taskId, fromUserId: currentUserId, toUserId, reason });

    return {
      success: true,
      data: mapRowToTask(result.rows[0])
    };
  } catch (error: any) {
    logger.error('Failed to handoff workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Map database row to WorkflowTask interface
 */
function mapRowToTask(row: any): WorkflowTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to || [],
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    dueDate: row.due_date,
    studyId: row.study_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventCrfId: row.event_crf_id,
    requiresApproval: row.requires_approval,
    requiresSignature: row.requires_signature,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export default {
  // Entity workflow functions
  getSubjectWorkflowStatus,
  getEventWorkflowStatus,
  getCRFWorkflowStatus,
  transitionWorkflow,
  getAvailableTransitions,
  triggerSDVCompletedWorkflow,
  triggerFormSubmittedWorkflow,
  triggerSubjectEnrolledWorkflow,
  // Task management functions
  getAllWorkflows,
  getUserWorkflows,
  getUserTaskSummary,
  createWorkflow,
  updateWorkflowStatus,
  completeWorkflow,
  approveWorkflow,
  rejectWorkflow,
  handoffWorkflow
};
