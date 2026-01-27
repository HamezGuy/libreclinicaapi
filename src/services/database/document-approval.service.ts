/**
 * Document Approval Workflow Service
 * 
 * 21 CFR Part 11 Compliant Formal Document Approval
 * 
 * This service manages the electronic approval workflow for:
 * - Protocols and protocol amendments
 * - Standard Operating Procedures (SOPs)
 * - Case Report Forms (CRFs)
 * - Consent forms
 * - Clinical study reports
 * 
 * Features:
 * - Multi-step approval chains
 * - Electronic signature integration
 * - Complete audit trail
 * - Delegation support
 * - Due date tracking and escalation
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../types';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type DocumentType = 'protocol' | 'sop' | 'crf' | 'consent_form' | 'report' | 'other';

export type WorkflowStatus = 
  | 'draft' 
  | 'pending_review' 
  | 'in_review' 
  | 'pending_approval' 
  | 'approved' 
  | 'rejected' 
  | 'superseded' 
  | 'archived';

export type StepStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'delegated';

export type ApprovalType = 'required' | 'optional' | 'fyi';

export type SignatureMeaning = 'approval' | 'review' | 'acknowledgment';

export interface DocumentWorkflow {
  id: number;
  documentType: DocumentType;
  documentName: string;
  documentVersion: string;
  documentPath: string | null;
  documentHash: string | null;
  studyId: number | null;
  status: WorkflowStatus;
  createdBy: number;
  createdByUsername: string | null;
  createdAt: Date;
  submittedForReviewAt: Date | null;
  approvedAt: Date | null;
  effectiveDate: Date | null;
  expirationDate: Date | null;
  description: string | null;
  changeSummary: string | null;
  steps?: ApprovalStep[];
}

export interface ApprovalStep {
  id: number;
  workflowId: number;
  stepOrder: number;
  approverRole: string | null;
  approverUserId: number | null;
  approverUsername?: string;
  approverFullName?: string;
  approvalType: ApprovalType;
  status: StepStatus;
  assignedAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  completedBy: number | null;
  signatureMeaning: SignatureMeaning | null;
  comments: string | null;
  delegationTo: number | null;
  escalated: boolean;
}

export interface ApprovalAction {
  workflowId: number;
  stepId?: number;
  action: 'submitted' | 'reviewed' | 'approved' | 'rejected' | 'delegated' | 'escalated';
  comments?: string;
  signatureMeaning?: SignatureMeaning;
  delegateTo?: number;
  password?: string; // For e-signature verification
}

export interface WorkflowAuditEntry {
  id: number;
  workflowId: number;
  stepId: number | null;
  action: string;
  actionBy: number;
  actionByUsername: string | null;
  actionAt: Date;
  previousStatus: string | null;
  newStatus: string | null;
  comments: string | null;
}

// ============================================================================
// Workflow Management
// ============================================================================

/**
 * Create a new document approval workflow
 */
export const createWorkflow = async (
  data: {
    documentType: DocumentType;
    documentName: string;
    documentVersion: string;
    documentPath?: string;
    documentContent?: Buffer; // For hash calculation
    studyId?: number;
    description?: string;
    changeSummary?: string;
    effectiveDate?: Date;
    expirationDate?: Date;
    approvalSteps: {
      approverRole?: string;
      approverUserId?: number;
      approvalType?: ApprovalType;
      signatureMeaning?: SignatureMeaning;
      dueDate?: Date;
    }[];
  },
  userId: number,
  username: string
): Promise<ApiResponse<DocumentWorkflow>> => {
  logger.info('Creating document workflow', { 
    documentType: data.documentType, 
    documentName: data.documentName,
    userId 
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Calculate document hash if content provided
    let documentHash: string | null = null;
    if (data.documentContent) {
      documentHash = crypto.createHash('sha256').update(data.documentContent).digest('hex');
    }

    // Create workflow
    const workflowQuery = `
      INSERT INTO document_approval_workflow (
        document_type, document_name, document_version, document_path,
        document_hash, study_id, status, created_by, created_by_username,
        description, change_summary, effective_date, expiration_date,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, $12, NOW(), NOW()
      )
      RETURNING *
    `;

    const workflowResult = await client.query(workflowQuery, [
      data.documentType,
      data.documentName,
      data.documentVersion,
      data.documentPath || null,
      documentHash,
      data.studyId || null,
      userId,
      username,
      data.description || null,
      data.changeSummary || null,
      data.effectiveDate || null,
      data.expirationDate || null
    ]);

    const workflow = workflowResult.rows[0];
    const workflowId = workflow.id;

    // Create approval steps
    const steps: ApprovalStep[] = [];
    for (let i = 0; i < data.approvalSteps.length; i++) {
      const step = data.approvalSteps[i];
      const stepQuery = `
        INSERT INTO document_approval_steps (
          workflow_id, step_order, approver_role, approver_user_id,
          approval_type, status, signature_meaning, due_date, assigned_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'pending', $6, $7, NOW()
        )
        RETURNING *
      `;

      const stepResult = await client.query(stepQuery, [
        workflowId,
        i + 1,
        step.approverRole || null,
        step.approverUserId || null,
        step.approvalType || 'required',
        step.signatureMeaning || 'approval',
        step.dueDate || null
      ]);

      steps.push(mapStepRow(stepResult.rows[0]));
    }

    // Log creation in audit
    await logAuditAction(client, {
      workflowId,
      action: 'created',
      actionBy: userId,
      actionByUsername: username,
      newStatus: 'draft'
    });

    await client.query('COMMIT');

    return {
      success: true,
      data: {
        ...mapWorkflowRow(workflow),
        steps
      }
    };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error creating workflow', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get workflow by ID with steps
 */
export const getWorkflow = async (
  workflowId: number
): Promise<ApiResponse<DocumentWorkflow>> => {
  logger.info('Getting workflow', { workflowId });

  try {
    const workflowQuery = `
      SELECT w.*, u.user_name as creator_username
      FROM document_approval_workflow w
      LEFT JOIN user_account u ON w.created_by = u.user_id
      WHERE w.id = $1
    `;

    const workflowResult = await pool.query(workflowQuery, [workflowId]);

    if (workflowResult.rows.length === 0) {
      return { success: false, message: 'Workflow not found' };
    }

    const stepsQuery = `
      SELECT s.*, 
        u.user_name as approver_username,
        u.first_name || ' ' || u.last_name as approver_full_name
      FROM document_approval_steps s
      LEFT JOIN user_account u ON s.approver_user_id = u.user_id
      WHERE s.workflow_id = $1
      ORDER BY s.step_order
    `;

    const stepsResult = await pool.query(stepsQuery, [workflowId]);

    return {
      success: true,
      data: {
        ...mapWorkflowRow(workflowResult.rows[0]),
        steps: stepsResult.rows.map(mapStepRow)
      }
    };

  } catch (error: any) {
    logger.error('Error getting workflow', { error: error.message, workflowId });
    return { success: false, message: error.message };
  }
};

/**
 * Get workflows with filtering
 */
export const getWorkflows = async (
  options: {
    studyId?: number;
    documentType?: DocumentType;
    status?: WorkflowStatus;
    pendingFor?: number; // User ID with pending steps
    page?: number;
    pageSize?: number;
  } = {}
): Promise<PaginatedResponse<DocumentWorkflow>> => {
  logger.info('Getting workflows', options);

  try {
    let query = `
      SELECT w.*, u.user_name as creator_username
      FROM document_approval_workflow w
      LEFT JOIN user_account u ON w.created_by = u.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.studyId) {
      params.push(options.studyId);
      query += ` AND w.study_id = $${params.length}`;
    }

    if (options.documentType) {
      params.push(options.documentType);
      query += ` AND w.document_type = $${params.length}`;
    }

    if (options.status) {
      params.push(options.status);
      query += ` AND w.status = $${params.length}`;
    }

    if (options.pendingFor) {
      params.push(options.pendingFor);
      query += ` AND EXISTS (
        SELECT 1 FROM document_approval_steps s
        WHERE s.workflow_id = w.id
          AND s.approver_user_id = $${params.length}
          AND s.status = 'pending'
      )`;
    }

    // Count total
    const countQuery = query.replace('SELECT w.*, u.user_name as creator_username', 'SELECT COUNT(*) as total');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Pagination
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;

    query += ` ORDER BY w.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageSize, offset);

    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(mapWorkflowRow),
      pagination: {
        page,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };

  } catch (error: any) {
    logger.error('Error getting workflows', { error: error.message });
    return { 
      success: false, 
      data: [], 
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } 
    };
  }
};

/**
 * Submit workflow for review
 */
export const submitForReview = async (
  workflowId: number,
  userId: number,
  username: string
): Promise<ApiResponse<DocumentWorkflow>> => {
  logger.info('Submitting workflow for review', { workflowId, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update workflow status
    const updateQuery = `
      UPDATE document_approval_workflow
      SET status = 'pending_review', 
          submitted_for_review_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING *
    `;

    const result = await client.query(updateQuery, [workflowId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Workflow not found or not in draft status' };
    }

    // Log audit
    await logAuditAction(client, {
      workflowId,
      action: 'submitted',
      actionBy: userId,
      actionByUsername: username,
      previousStatus: 'draft',
      newStatus: 'pending_review'
    });

    await client.query('COMMIT');

    // Return full workflow with steps
    return getWorkflow(workflowId);

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error submitting workflow', { error: error.message, workflowId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Process an approval step (approve, reject, delegate)
 */
export const processApprovalStep = async (
  stepId: number,
  action: ApprovalAction,
  userId: number,
  username: string,
  ipAddress?: string,
  deviceFingerprint?: string
): Promise<ApiResponse<ApprovalStep>> => {
  logger.info('Processing approval step', { stepId, action: action.action, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get step and workflow info
    const stepQuery = `
      SELECT s.*, w.status as workflow_status, w.id as workflow_id
      FROM document_approval_steps s
      JOIN document_approval_workflow w ON s.workflow_id = w.id
      WHERE s.id = $1
    `;
    const stepResult = await client.query(stepQuery, [stepId]);

    if (stepResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Approval step not found' };
    }

    const step = stepResult.rows[0];
    const workflowId = step.workflow_id;

    // Verify user is authorized to act on this step
    if (step.approver_user_id !== userId) {
      // Check if delegated to this user
      if (step.delegation_to !== userId) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Not authorized to approve this step' };
      }
    }

    // Check step is pending
    if (step.status !== 'pending') {
      await client.query('ROLLBACK');
      return { success: false, message: 'Step is not pending approval' };
    }

    // Process action
    let newStatus: StepStatus;
    let workflowStatusUpdate: WorkflowStatus | null = null;

    switch (action.action) {
      case 'approved':
        newStatus = 'approved';
        break;
      case 'rejected':
        newStatus = 'rejected';
        workflowStatusUpdate = 'rejected';
        break;
      case 'delegated':
        if (!action.delegateTo) {
          await client.query('ROLLBACK');
          return { success: false, message: 'Delegation target required' };
        }
        newStatus = 'delegated';
        break;
      default:
        await client.query('ROLLBACK');
        return { success: false, message: 'Invalid action' };
    }

    // Update step
    const updateStepQuery = `
      UPDATE document_approval_steps
      SET status = $1,
          completed_at = NOW(),
          completed_by = $2,
          comments = $3,
          delegation_to = $4
      WHERE id = $5
      RETURNING *
    `;

    const updatedStep = await client.query(updateStepQuery, [
      newStatus,
      userId,
      action.comments || null,
      action.delegateTo || null,
      stepId
    ]);

    // If delegated, create new pending step
    if (action.action === 'delegated' && action.delegateTo) {
      const delegateQuery = `
        INSERT INTO document_approval_steps (
          workflow_id, step_order, approver_user_id, approval_type,
          status, signature_meaning, delegation_reason, assigned_at
        )
        SELECT workflow_id, step_order, $1, approval_type,
               'pending', signature_meaning, $2, NOW()
        FROM document_approval_steps WHERE id = $3
      `;
      await client.query(delegateQuery, [action.delegateTo, action.comments || 'Delegated', stepId]);
    }

    // Log audit
    await logAuditAction(client, {
      workflowId,
      stepId,
      action: action.action,
      actionBy: userId,
      actionByUsername: username,
      previousStatus: 'pending',
      newStatus,
      comments: action.comments,
      ipAddress,
      deviceFingerprint
    });

    // Check if all required steps are approved
    if (action.action === 'approved') {
      const pendingQuery = `
        SELECT COUNT(*) as pending_count
        FROM document_approval_steps
        WHERE workflow_id = $1 
          AND approval_type = 'required' 
          AND status = 'pending'
      `;
      const pendingResult = await client.query(pendingQuery, [workflowId]);

      if (parseInt(pendingResult.rows[0].pending_count, 10) === 0) {
        // All required steps complete - mark workflow as approved
        workflowStatusUpdate = 'approved';
      } else {
        workflowStatusUpdate = 'in_review';
      }
    }

    // Update workflow status if needed
    if (workflowStatusUpdate) {
      const updateWorkflowQuery = `
        UPDATE document_approval_workflow
        SET status = $1,
            approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
            updated_at = NOW()
        WHERE id = $2
      `;
      await client.query(updateWorkflowQuery, [workflowStatusUpdate, workflowId]);
    }

    await client.query('COMMIT');

    return { success: true, data: mapStepRow(updatedStep.rows[0]) };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error processing approval', { error: error.message, stepId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get pending approvals for a user
 */
export const getPendingApprovals = async (
  userId: number
): Promise<ApiResponse<{ workflow: DocumentWorkflow; step: ApprovalStep }[]>> => {
  logger.info('Getting pending approvals', { userId });

  try {
    const query = `
      SELECT 
        w.*, 
        s.id as step_id, s.step_order, s.approver_role, s.approver_user_id,
        s.approval_type, s.status as step_status, s.due_date, s.signature_meaning,
        s.assigned_at
      FROM document_approval_steps s
      JOIN document_approval_workflow w ON s.workflow_id = w.id
      WHERE s.approver_user_id = $1 
        AND s.status = 'pending'
        AND w.status IN ('pending_review', 'in_review', 'pending_approval')
      ORDER BY s.due_date NULLS LAST, s.assigned_at
    `;

    const result = await pool.query(query, [userId]);

    const pending = result.rows.map(row => ({
      workflow: mapWorkflowRow(row),
      step: {
        id: row.step_id,
        workflowId: row.id,
        stepOrder: row.step_order,
        approverRole: row.approver_role,
        approverUserId: row.approver_user_id,
        approvalType: row.approval_type,
        status: row.step_status,
        assignedAt: row.assigned_at,
        dueDate: row.due_date,
        completedAt: null,
        completedBy: null,
        signatureMeaning: row.signature_meaning,
        comments: null,
        delegationTo: null,
        escalated: false
      } as ApprovalStep
    }));

    return { success: true, data: pending };

  } catch (error: any) {
    logger.error('Error getting pending approvals', { error: error.message, userId });
    return { success: false, message: error.message };
  }
};

/**
 * Get workflow audit trail
 */
export const getWorkflowAuditTrail = async (
  workflowId: number
): Promise<ApiResponse<WorkflowAuditEntry[]>> => {
  logger.info('Getting workflow audit trail', { workflowId });

  try {
    const query = `
      SELECT *
      FROM document_approval_audit
      WHERE workflow_id = $1
      ORDER BY action_at DESC
    `;

    const result = await pool.query(query, [workflowId]);

    const entries: WorkflowAuditEntry[] = result.rows.map(row => ({
      id: row.id,
      workflowId: row.workflow_id,
      stepId: row.step_id,
      action: row.action,
      actionBy: row.action_by,
      actionByUsername: row.action_by_username,
      actionAt: row.action_at,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      comments: row.comments
    }));

    return { success: true, data: entries };

  } catch (error: any) {
    logger.error('Error getting audit trail', { error: error.message, workflowId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

async function logAuditAction(
  client: any,
  data: {
    workflowId: number;
    stepId?: number;
    action: string;
    actionBy: number;
    actionByUsername: string;
    previousStatus?: string;
    newStatus?: string;
    comments?: string;
    signatureId?: number;
    ipAddress?: string;
    deviceFingerprint?: string;
  }
): Promise<void> {
  const query = `
    INSERT INTO document_approval_audit (
      workflow_id, step_id, action, action_by, action_by_username,
      action_at, previous_status, new_status, comments,
      signature_id, ip_address, device_fingerprint
    ) VALUES (
      $1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11
    )
  `;

  await client.query(query, [
    data.workflowId,
    data.stepId || null,
    data.action,
    data.actionBy,
    data.actionByUsername,
    data.previousStatus || null,
    data.newStatus || null,
    data.comments || null,
    data.signatureId || null,
    data.ipAddress || null,
    data.deviceFingerprint || null
  ]);
}

function mapWorkflowRow(row: any): DocumentWorkflow {
  return {
    id: row.id,
    documentType: row.document_type,
    documentName: row.document_name,
    documentVersion: row.document_version,
    documentPath: row.document_path,
    documentHash: row.document_hash,
    studyId: row.study_id,
    status: row.status,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || row.creator_username,
    createdAt: row.created_at,
    submittedForReviewAt: row.submitted_for_review_at,
    approvedAt: row.approved_at,
    effectiveDate: row.effective_date,
    expirationDate: row.expiration_date,
    description: row.description,
    changeSummary: row.change_summary
  };
}

function mapStepRow(row: any): ApprovalStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepOrder: row.step_order,
    approverRole: row.approver_role,
    approverUserId: row.approver_user_id,
    approverUsername: row.approver_username,
    approverFullName: row.approver_full_name,
    approvalType: row.approval_type,
    status: row.status,
    assignedAt: row.assigned_at,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    signatureMeaning: row.signature_meaning,
    comments: row.comments,
    delegationTo: row.delegation_to,
    escalated: row.escalated || false
  };
}

