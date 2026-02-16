/**
 * Workflow Service
 * 
 * Handles workflow operations for clinical data capture
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { WorkflowType, WorkflowPriority, WorkflowStatus } from '../../types/libreclinica-models';

/**
 * CRF Lifecycle phases (ordered).
 */
export type CrfLifecyclePhase =
  | 'not_started'
  | 'data_entry'
  | 'data_entry_complete'
  | 'dde_verified'
  | 'sdv_complete'
  | 'signed'
  | 'locked';

export interface CrfLifecycleStatus {
  eventCrfId: number;
  currentPhase: CrfLifecyclePhase;
  completedPhases: CrfLifecyclePhase[];
  pendingPhases: CrfLifecyclePhase[];
  availableTransitions: CrfLifecyclePhase[];
  workflowConfig: {
    requiresSDV: boolean;
    requiresSignature: boolean;
    requiresDDE: boolean;
  };
  openQueryCount: number;
}

/**
 * Compute the full CRF lifecycle status for a form instance, respecting the
 * workflow configuration (SDV / Signature / DDE requirements).
 */
export const getCrfLifecycleStatus = async (
  eventCrfId: number
): Promise<CrfLifecycleStatus | null> => {
  try {
    // 1. Load event_crf status fields
    const ecResult = await pool.query(`
      SELECT 
        ec.event_crf_id,
        ec.status_id,
        ec.completion_status_id,
        COALESCE(ec.sdv_status, false) as sdv_verified,
        COALESCE(ec.electronic_signature_status, false) as is_signed,
        cv.crf_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (ecResult.rows.length === 0) return null;

    const row = ecResult.rows[0];
    const statusId = row.status_id;          // 1=available, 2=data_complete, 6=locked
    const completionStatusId = row.completion_status_id; // 1=not_started..5=signed
    const sdvVerified = row.sdv_verified;
    const isSigned = row.is_signed;
    const crfId = row.crf_id;

    // 2. Load workflow config for this CRF
    let requiresSDV = false;
    let requiresSignature = false;
    let requiresDDE = false;
    try {
      const cfgResult = await pool.query(`
        SELECT requires_sdv, requires_signature, requires_dde
        FROM acc_form_workflow_config
        WHERE crf_id = $1
        ORDER BY study_id DESC NULLS LAST
        LIMIT 1
      `, [crfId]);
      if (cfgResult.rows.length > 0) {
        requiresSDV = cfgResult.rows[0].requires_sdv;
        requiresSignature = cfgResult.rows[0].requires_signature;
        requiresDDE = cfgResult.rows[0].requires_dde;
      }
    } catch { /* table may not exist yet */ }

    // 3. Count open queries
    let openQueryCount = 0;
    try {
      const qResult = await pool.query(`
        SELECT COUNT(*) as cnt FROM discrepancy_note dn
        INNER JOIN dn_event_crf_map dem ON dn.discrepancy_note_id = dem.discrepancy_note_id
        WHERE dem.event_crf_id = $1
          AND dn.resolution_status_id IN (1, 2, 3)
          AND dn.parent_dn_id IS NULL
      `, [eventCrfId]);
      openQueryCount = parseInt(qResult.rows[0]?.cnt || '0');
    } catch { /* ignore */ }

    // 4. Determine current phase
    let currentPhase: CrfLifecyclePhase = 'not_started';
    if (statusId === 6) {
      currentPhase = 'locked';
    } else if (completionStatusId >= 5 || isSigned) {
      currentPhase = 'signed';
    } else if (sdvVerified) {
      currentPhase = 'sdv_complete';
    } else if (completionStatusId >= 4 || statusId === 2) {
      currentPhase = 'data_entry_complete';
    } else if (completionStatusId >= 2 || completionStatusId === 3) {
      currentPhase = 'data_entry';
    }

    // 5. Build ordered list of applicable phases for this CRF
    const allPhases: CrfLifecyclePhase[] = [
      'not_started',
      'data_entry',
      'data_entry_complete'
    ];
    if (requiresDDE) allPhases.push('dde_verified');
    if (requiresSDV) allPhases.push('sdv_complete');
    if (requiresSignature) allPhases.push('signed');
    allPhases.push('locked');

    const currentIdx = allPhases.indexOf(currentPhase);
    const completedPhases = allPhases.slice(0, Math.max(0, currentIdx));
    const pendingPhases = allPhases.slice(currentIdx + 1);

    // 6. Available transitions: next phase(s) the user can move to
    const availableTransitions: CrfLifecyclePhase[] = [];
    if (currentIdx >= 0 && currentIdx < allPhases.length - 1) {
      availableTransitions.push(allPhases[currentIdx + 1]);
    }
    // Admin can always unlock
    if (currentPhase === 'locked') {
      availableTransitions.push('data_entry');
    }

    return {
      eventCrfId,
      currentPhase,
      completedPhases,
      pendingPhases,
      availableTransitions,
      workflowConfig: { requiresSDV, requiresSignature, requiresDDE },
      openQueryCount
    };
  } catch (error: any) {
    logger.error('Failed to compute CRF lifecycle status', { eventCrfId, error: error.message });
    return null;
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
 * 
 * Called by form.service.ts after a form is successfully saved.
 * Logs the form submission event to the audit trail for workflow tracking.
 * 
 * @param eventCrfId - The event_crf_id (form instance ID)
 * @param studyId - The study ID
 * @param subjectId - The study_subject_id
 * @param formName - The CRF/form name (for logging)
 * @param userId - The user who submitted the form
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
    // Log the form submission event to audit trail
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
// Task-based workflow management (used by workflow.controller.ts)
// ============================================================================

// Re-export from types layer so controller can access via workflowService.WorkflowStatus etc.
export { WorkflowType, WorkflowPriority, WorkflowStatus };

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
 * Workflow-specific audit_table values.
 * Only rows with these values are real workflow tasks.
 * Audit trail entries (item_data, study_subject, etc.) are excluded.
 */
const WORKFLOW_AUDIT_TABLES = [
  'form_workflow',
  'sdv_workflow',
  'enrollment_workflow',
  'query_workflow',
  'signature_workflow',
  'custom_workflow'
];

/**
 * Get all workflows from acc_workflow_tasks (the real task table).
 * Falls back to audit_log_event if the tasks table doesn't exist yet.
 */
export const getAllWorkflows = async (filters: WorkflowFilter): Promise<{ data: any[] }> => {
  try {
    // Check if acc_workflow_tasks exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists
    `);

    if (tableCheck.rows[0].exists) {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (filters.status) {
        conditions.push(`wt.status = $${paramIdx++}`);
        params.push(filters.status);
      }
      if (filters.priority) {
        conditions.push(`wt.priority = $${paramIdx++}`);
        params.push(filters.priority);
      }
      if (filters.studyId) {
        conditions.push(`wt.study_id = $${paramIdx++}`);
        params.push(filters.studyId);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      const limit = filters.limit || 100;
      const offset = filters.offset || 0;

      const result = await pool.query(`
        SELECT 
          wt.task_id as id,
          wt.title,
          wt.description,
          wt.task_type as type,
          wt.status,
          wt.priority,
          wt.entity_type,
          wt.entity_id,
          wt.event_crf_id,
          wt.study_id,
          wt.assigned_to_user_ids,
          wt.created_by,
          wt.completed_by,
          wt.date_created as created_at,
          wt.date_updated as updated_at,
          wt.date_completed as completed_at,
          wt.due_date,
          wt.metadata,
          ua.user_name as created_by_name
        FROM acc_workflow_tasks wt
        LEFT JOIN user_account ua ON wt.created_by = ua.user_id
        ${whereClause}
        ORDER BY wt.date_created DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `, [...params, limit, offset]);

      // Resolve assigned user names
      const workflows = await Promise.all(result.rows.map(async (row: any) => {
        let assignedTo: string[] = [];
        if (row.assigned_to_user_ids?.length) {
          const userResult = await pool.query(
            `SELECT user_name FROM user_account WHERE user_id = ANY($1)`,
            [row.assigned_to_user_ids]
          );
          assignedTo = userResult.rows.map((u: any) => u.user_name);
        }
        return {
          ...row,
          assignedTo,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {})
        };
      }));

      return { data: workflows };
    }

    // Fallback: read from audit_log_event for backward compat
    const result = await pool.query(`
      SELECT 
        ale.audit_id as id,
        ale.entity_name as title,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.audit_date as created_at,
        ale.reason_for_change as description,
        ale.new_value as metadata,
        ua.user_name as assigned_to,
        'pending' as status,
        'medium' as priority
      FROM audit_log_event ale
      LEFT JOIN user_account ua ON ale.user_id = ua.user_id
      WHERE ale.audit_table = ANY($3)
      ORDER BY ale.audit_date DESC
      LIMIT $1 OFFSET $2
    `, [filters.limit || 100, filters.offset || 0, WORKFLOW_AUDIT_TABLES]);

    const workflows = result.rows.map(row => {
      let parsed: any = {};
      try { parsed = JSON.parse(row.metadata || '{}'); } catch { /* ignore */ }
      return {
        ...row,
        type: parsed.type || row.entity_type?.replace('_workflow', '') || 'custom',
        priority: parsed.priority || 'medium',
        assignedTo: parsed.assignedTo || (row.assigned_to ? [row.assigned_to] : [])
      };
    });

    return { data: workflows };
  } catch (error: any) {
    logger.error('Failed to get workflows', { error: error.message });
    return { data: [] };
  }
};

/**
 * Get workflows assigned to or created by a specific user.
 */
export const getUserWorkflows = async (userId: string): Promise<{ data: any[] }> => {
  try {
    const uid = parseInt(userId);

    const tableCheck = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists
    `);

    if (tableCheck.rows[0].exists) {
      const result = await pool.query(`
        SELECT 
          wt.task_id as id,
          wt.title,
          wt.description,
          wt.task_type as type,
          wt.status,
          wt.priority,
          wt.entity_type,
          wt.entity_id,
          wt.event_crf_id,
          wt.study_id,
          wt.assigned_to_user_ids,
          wt.date_created as created_at,
          wt.date_updated as updated_at,
          wt.date_completed as completed_at,
          wt.due_date,
          wt.metadata
        FROM acc_workflow_tasks wt
        WHERE $1 = ANY(wt.assigned_to_user_ids) OR wt.created_by = $1
        ORDER BY wt.date_created DESC
        LIMIT 100
      `, [uid]);

      return { data: result.rows };
    }

    // Fallback
    const result = await pool.query(`
      SELECT 
        ale.audit_id as id,
        ale.entity_name as title,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.audit_date as created_at,
        ale.reason_for_change as description,
        ale.new_value as metadata,
        'pending' as status,
        'medium' as priority
      FROM audit_log_event ale
      WHERE ale.user_id = $1
        AND ale.audit_table = ANY($2)
      ORDER BY ale.audit_date DESC
      LIMIT 100
    `, [uid, WORKFLOW_AUDIT_TABLES]);

    return { data: result.rows };
  } catch (error: any) {
    logger.error('Failed to get user workflows', { error: error.message });
    return { data: [] };
  }
};

/**
 * Get task summary for a user from acc_workflow_tasks.
 */
export const getUserTaskSummary = async (userId: string): Promise<{ data: any }> => {
  try {
    const uid = parseInt(userId);

    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_workflow_tasks') as exists
    `);
    if (!tableCheck.rows[0].exists) {
      return { data: { totalPending: 0, totalInProgress: 0, totalCompleted: 0, totalOverdue: 0 } };
    }

    // Count by status for tasks assigned to this user
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as cnt
      FROM acc_workflow_tasks
      WHERE $1 = ANY(assigned_to_user_ids) OR created_by = $1
      GROUP BY status
    `, [uid]);

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.cnt);
    }

    // Overdue: pending or in_progress tasks past their due date
    const overdueResult = await pool.query(`
      SELECT COUNT(*) as cnt FROM acc_workflow_tasks
      WHERE ($1 = ANY(assigned_to_user_ids) OR created_by = $1)
        AND status IN ('pending', 'in_progress')
        AND due_date IS NOT NULL AND due_date < NOW()
    `, [uid]);
    const totalOverdue = parseInt(overdueResult.rows[0]?.cnt || '0');

    return {
      data: {
        totalPending: counts['pending'] || 0,
        totalInProgress: counts['in_progress'] || 0,
        totalCompleted: counts['completed'] || 0,
        totalOverdue
      }
    };
  } catch (error: any) {
    logger.error('Failed to get user task summary', { error: error.message });
    return { data: { totalPending: 0, totalInProgress: 0, totalCompleted: 0, totalOverdue: 0 } };
  }
};

/**
 * Create a new workflow task.
 * Inserts into acc_workflow_tasks (primary) and audit_log_event (audit trail).
 */
export const createWorkflow = async (
  input: WorkflowCreateInput,
  userId: number,
  username: string
): Promise<{ success: boolean; data?: any; message?: string }> => {
  try {
    // Resolve assignee usernames to user IDs
    let assigneeIds: number[] = [];
    if (input.assignedTo?.length) {
      const userResult = await pool.query(
        `SELECT user_id FROM user_account WHERE user_name = ANY($1) AND enabled = true`,
        [input.assignedTo]
      );
      assigneeIds = userResult.rows.map((r: any) => r.user_id);
    }

    // Insert into the dedicated tasks table
    const taskResult = await pool.query(`
      INSERT INTO acc_workflow_tasks (
        task_type, title, description, status, priority,
        entity_type, entity_id, event_crf_id, study_id,
        assigned_to_user_ids, created_by, due_date, metadata
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING task_id
    `, [
      input.type,
      input.title,
      input.description || '',
      input.priority || 'medium',
      input.entityType,
      input.entityId || null,
      input.eventCrfId || null,
      input.studyId,
      assigneeIds,
      userId,
      input.dueDate || null,
      JSON.stringify({
        requiresApproval: input.requiresApproval,
        requiresSignature: input.requiresSignature,
        assignedUsernames: input.assignedTo
      })
    ]);

    const taskId = taskResult.rows[0]?.task_id;

    // Also log to audit trail for compliance
    const auditTable = input.type === 'query' ? 'query_workflow'
      : input.type === 'sdv' ? 'sdv_workflow'
      : input.type === 'signature' ? 'signature_workflow'
      : 'custom_workflow';

    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), $1, $2, $3, $4, $5, $6)
    `, [
      auditTable,
      input.entityId || 0,
      input.title,
      userId,
      JSON.stringify({ taskId, type: input.type, priority: input.priority, assignedTo: input.assignedTo }),
      input.description || 'Workflow task created'
    ]);

    return {
      success: true,
      data: { id: taskId, ...input, status: 'pending', createdBy: username },
      message: 'Workflow created successfully'
    };
  } catch (error: any) {
    logger.error('Failed to create workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Update workflow task status in acc_workflow_tasks.
 */
export const updateWorkflowStatus = async (
  workflowId: string,
  status: string,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    const taskId = parseInt(workflowId);
    if (isNaN(taskId)) return { success: false, message: 'Invalid workflow ID' };

    await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = $1, date_updated = NOW()
      WHERE task_id = $2
    `, [status, taskId]);

    logger.info('Workflow status updated', { taskId, status, userId });
    return { success: true, message: `Workflow ${workflowId} updated to ${status}` };
  } catch (error: any) {
    logger.error('Failed to update workflow status', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Complete a workflow task.
 */
export const completeWorkflow = async (
  workflowId: string,
  userId: number,
  signature?: any
): Promise<{ success: boolean; message?: string }> => {
  try {
    const taskId = parseInt(workflowId);
    if (isNaN(taskId)) return { success: false, message: 'Invalid workflow ID' };

    await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'completed', completed_by = $1, date_completed = NOW(), date_updated = NOW(),
          metadata = metadata || $2
      WHERE task_id = $3
    `, [userId, JSON.stringify({ signedBy: signature ? userId : null }), taskId]);

    logger.info('Workflow completed', { taskId, userId });
    return { success: true, message: `Workflow ${workflowId} completed` };
  } catch (error: any) {
    logger.error('Failed to complete workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Approve a workflow task.
 */
export const approveWorkflow = async (
  workflowId: string,
  userId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const taskId = parseInt(workflowId);
    if (isNaN(taskId)) return { success: false, message: 'Invalid workflow ID' };

    await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'approved', completed_by = $1, date_completed = NOW(), date_updated = NOW(),
          metadata = metadata || $2
      WHERE task_id = $3
    `, [userId, JSON.stringify({ approvedBy: userId, approvalReason: reason }), taskId]);

    logger.info('Workflow approved', { taskId, userId, reason });
    return { success: true, message: `Workflow ${workflowId} approved` };
  } catch (error: any) {
    logger.error('Failed to approve workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Reject a workflow task.
 */
export const rejectWorkflow = async (
  workflowId: string,
  userId: number,
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const taskId = parseInt(workflowId);
    if (isNaN(taskId)) return { success: false, message: 'Invalid workflow ID' };

    await pool.query(`
      UPDATE acc_workflow_tasks
      SET status = 'rejected', date_updated = NOW(),
          metadata = metadata || $1
      WHERE task_id = $2
    `, [JSON.stringify({ rejectedBy: userId, rejectionReason: reason }), taskId]);

    logger.info('Workflow rejected', { taskId, userId, reason });
    return { success: true, message: `Workflow ${workflowId} rejected` };
  } catch (error: any) {
    logger.error('Failed to reject workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Handoff a workflow task to another user.
 */
export const handoffWorkflow = async (
  workflowId: string,
  toUserId: string,
  reason: string,
  fromUserId: number
): Promise<{ success: boolean; message?: string }> => {
  try {
    const taskId = parseInt(workflowId);
    const targetUserId = parseInt(toUserId);
    if (isNaN(taskId) || isNaN(targetUserId)) return { success: false, message: 'Invalid IDs' };

    await pool.query(`
      UPDATE acc_workflow_tasks
      SET assigned_to_user_ids = array_append(
            array_remove(assigned_to_user_ids, $1), $2
          ),
          date_updated = NOW(),
          metadata = metadata || $3
      WHERE task_id = $4
    `, [fromUserId, targetUserId, JSON.stringify({ handoffFrom: fromUserId, handoffTo: targetUserId, handoffReason: reason }), taskId]);

    logger.info('Workflow handed off', { taskId, fromUserId, toUserId, reason });
    return { success: true, message: `Workflow ${workflowId} handed off to user ${toUserId}` };
  } catch (error: any) {
    logger.error('Failed to handoff workflow', { error: error.message });
    return { success: false, message: error.message };
  }
};

export default {
  getCrfLifecycleStatus,
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
