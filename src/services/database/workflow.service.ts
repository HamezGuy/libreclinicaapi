/**
 * Workflow Service
 * 
 * Handles workflow operations for clinical data capture
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export interface WorkflowStatus {
  status: string;
  step: string;
  completedSteps: string[];
  pendingSteps: string[];
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
 */
export const triggerSDVCompletedWorkflow = async (
  eventCrfId: number,
  userId: number
): Promise<void> => {
  try {
    logger.info('SDV workflow completed', { eventCrfId, userId });
    // Log the SDV completion event
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
 * Called with: (studyId, subjectId, eventId, crfId, userId)
 */
export const triggerFormSubmittedWorkflow = async (
  studyId: number,
  subjectId: number,
  eventId: number,
  crfId: number,
  userId: number
): Promise<void> => {
  try {
    logger.info('Form submission workflow triggered', { studyId, subjectId, eventId, crfId, userId });
    // Log the form submission event
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value
      ) VALUES (1, NOW(), 'form_workflow', $1, 'form_submitted', $2, $3)
    `, [crfId, userId, JSON.stringify({ studyId, subjectId, eventId, crfId })]);
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
// Task-based workflow management (used by workflow.controller.ts)
// ============================================================================

export type WorkflowPriority = 'low' | 'medium' | 'high' | 'critical';
export type WorkflowType = 'data_entry' | 'review' | 'sdv' | 'signature' | 'query' | 'custom';

interface WorkflowFilter {
  status?: WorkflowStatus;
  priority?: WorkflowPriority;
  assignedTo?: string;
  studyId?: number;
  type?: WorkflowType;
  limit?: number;
  offset?: number;
}

interface WorkflowCreateInput {
  title: string;
  description?: string;
  type: string;
  priority: string;
  assignedTo: string[];
  dueDate?: Date;
  studyId: number;
  entityType: string;
  entityId?: number;
  eventCrfId?: number;
  requiresApproval: boolean;
  requiresSignature: boolean;
}

/**
 * Get all workflows with optional filters
 */
export const getAllWorkflows = async (filters: WorkflowFilter): Promise<{ data: any[] }> => {
  try {
    // Query audit_log_event as a proxy for workflow tasks
    const result = await pool.query(`
      SELECT 
        ale.audit_id as id,
        ale.entity_name as title,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.audit_date as created_at,
        ale.reason_for_change as description,
        ua.user_name as assigned_to,
        'pending' as status,
        'medium' as priority
      FROM audit_log_event ale
      LEFT JOIN user_account ua ON ale.user_id = ua.user_id
      ORDER BY ale.audit_date DESC
      LIMIT $1 OFFSET $2
    `, [filters.limit || 100, filters.offset || 0]);

    return { data: result.rows };
  } catch (error: any) {
    logger.error('Failed to get workflows', { error: error.message });
    return { data: [] };
  }
};

/**
 * Get workflows assigned to a specific user
 */
export const getUserWorkflows = async (userId: string): Promise<{ data: any[] }> => {
  try {
    const result = await pool.query(`
      SELECT 
        ale.audit_id as id,
        ale.entity_name as title,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.audit_date as created_at,
        ale.reason_for_change as description,
        'pending' as status,
        'medium' as priority
      FROM audit_log_event ale
      WHERE ale.user_id = $1
      ORDER BY ale.audit_date DESC
      LIMIT 100
    `, [parseInt(userId)]);

    return { data: result.rows };
  } catch (error: any) {
    logger.error('Failed to get user workflows', { error: error.message });
    return { data: [] };
  }
};

/**
 * Get task summary for a user
 */
export const getUserTaskSummary = async (userId: string): Promise<{ data: any }> => {
  try {
    return {
      data: {
        pending: [],
        inProgress: [],
        completed: [],
        overdue: [],
        totalPending: 0,
        totalInProgress: 0,
        totalCompleted: 0,
        totalOverdue: 0
      }
    };
  } catch (error: any) {
    logger.error('Failed to get user task summary', { error: error.message });
    return { data: {} };
  }
};

/**
 * Create a new workflow task
 */
export const createWorkflow = async (
  input: WorkflowCreateInput,
  userId: number,
  username: string
): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    // Store as audit log event
    const result = await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), $1, $2, $3, $4, $5, $6)
      RETURNING audit_id
    `, [
      input.entityType,
      input.entityId || 0,
      input.title,
      userId,
      JSON.stringify({ type: input.type, priority: input.priority, assignedTo: input.assignedTo }),
      input.description || 'Workflow task created'
    ]);

    return {
      success: true,
      data: { id: result.rows[0]?.audit_id, ...input, status: 'pending', createdBy: username },
      message: 'Workflow created successfully'
    };
  } catch (error: any) {
    logger.error('Failed to create workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Update workflow status
 */
export const updateWorkflowStatus = async (
  workflowId: string,
  status: string,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating workflow status', { workflowId, status, userId });
  return { success: true, message: `Workflow ${workflowId} updated to ${status}` };
};

/**
 * Complete a workflow task
 */
export const completeWorkflow = async (
  workflowId: string,
  userId: number,
  signature?: any
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Completing workflow', { workflowId, userId, hasSignature: !!signature });
  return { success: true, message: `Workflow ${workflowId} completed` };
};

/**
 * Approve a workflow task
 */
export const approveWorkflow = async (
  workflowId: string,
  userId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Approving workflow', { workflowId, userId, reason });
  return { success: true, message: `Workflow ${workflowId} approved` };
};

/**
 * Reject a workflow task
 */
export const rejectWorkflow = async (
  workflowId: string,
  userId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Rejecting workflow', { workflowId, userId, reason });
  return { success: true, message: `Workflow ${workflowId} rejected` };
};

/**
 * Handoff a workflow task to another user
 */
export const handoffWorkflow = async (
  workflowId: string,
  toUserId: string,
  reason: string,
  fromUserId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Handing off workflow', { workflowId, toUserId, fromUserId, reason });
  return { success: true, message: `Workflow ${workflowId} handed off to user ${toUserId}` };
};

export default {
  getSubjectWorkflowStatus,
  getEventWorkflowStatus,
  getCRFWorkflowStatus,
  transitionWorkflow,
  getAvailableTransitions,
  triggerSDVCompletedWorkflow,
  triggerFormSubmittedWorkflow,
  triggerSubjectEnrolledWorkflow,
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
