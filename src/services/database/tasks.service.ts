/**
 * Tasks Service - Aggregates Real LibreClinica Work Items
 * 
 * This service queries multiple tables to create a unified "My Tasks" view:
 * 
 * 1. QUERIES (discrepancy_note) - Assigned queries needing response
 * 2. SCHEDULED EVENTS (study_event) - Upcoming visits needing data entry
 * 3. FORMS TO COMPLETE (event_crf) - Started but incomplete forms
 * 4. SDV PENDING (event_crf) - Forms requiring source data verification
 * 5. SIGNATURES REQUIRED (event_crf) - Completed forms awaiting e-signature
 * 
 * Database Tables Used:
 * - discrepancy_note (queries) - assigned_user_id, owner_id
 * - study_event (scheduled visits) - owner_id
 * - event_crf (form data) - owner_id
 * - study_user_role (study access) - user_name, study_id
 * - subject_event_status (visit status values)
 * - resolution_status (query status values)
 * - status (general status: 1=available, 5=removed)
 * 
 * Resolution Status IDs:
 * 1 = New, 2 = Updated, 3 = Resolution Proposed, 4 = Closed, 5 = Not Applicable
 * 
 * Subject Event Status IDs:
 * 1 = Scheduled, 2 = Not Scheduled, 3 = Data Entry Started, 
 * 4 = Completed, 5 = Stopped, 6 = Skipped, 7 = Locked, 8 = Signed
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { parseDateLocal } from '../../utils/date.util';
import { updateFormQueryCounts } from './query.service';
import type { TaskType, TaskPriority, TaskStatus, Task, TaskSummary, TaskFilters } from '../../types';

/**
 * Helper: get org member user IDs for the caller.
 * Returns null if the caller has no org membership (root admin sees all).
 */
const getOrgMemberUserIds = async (_callerUserId: number): Promise<number[] | null> => {
  return null;
};

/**
 * Helper: get organization info for a user
 */
const getUserOrganizations = async (userId: number): Promise<{ id: number; name: string }[]> => {
  try {
    const result = await pool.query(`
      SELECT o.organization_id as id, o.name
      FROM acc_organization o
      JOIN acc_organization_member m ON o.organization_id = m.organization_id
      WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
    `, [userId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Error getting user organizations', { userId, error: error.message });
    throw error;
  }
};

/**
 * Helper: get dismissed/completed task IDs from acc_task_status
 */
const getDismissedTaskIds = async (organizationId?: number): Promise<Set<string>> => {
  try {
    let query = `SELECT task_id FROM acc_task_status WHERE status IN ('dismissed', 'completed')`;
    const params: any[] = [];
    if (organizationId) {
      query += ` AND (organization_id = $1 OR organization_id IS NULL)`;
      params.push(organizationId);
    }
    const result = await pool.query(query, params);
    return new Set(result.rows.map((r: any) => r.taskId));
  } catch {
    return new Set();
  }
};

/**
 * Helper: get visit window data for a study event definition
 * Used for proper timeframe calculation based on schedule_day, min_day, max_day
 */
const getVisitWindowForEvent = async (studyEventDefinitionId: number): Promise<{
  scheduleDay: number | null;
  minDay: number | null;
  maxDay: number | null;
} | null> => {
  try {
    const result = await pool.query(
      `SELECT schedule_day, min_day, max_day FROM study_event_definition WHERE study_event_definition_id = $1`,
      [studyEventDefinitionId]
    );
    if (result.rows.length === 0) return null;
    return {
      scheduleDay: result.rows[0].scheduleDay,
      minDay: result.rows[0].minDay,
      maxDay: result.rows[0].maxDay
    };
  } catch {
    return null;
  }
};

/**
 * Get user ID from username
 */
async function getUserId(username: string): Promise<number | null> {
  try {
    const result = await pool.query(
      'SELECT user_id FROM user_account WHERE user_name = $1',
      [username]
    );
    return result.rows[0]?.userId || null;
  } catch (error) {
    logger.error('Error getting user ID', { username });
    return null;
  }
}

/**
 * Get studies the user has access to
 * Note: study_user_role links via user_name, not user_id or owner_id
 * (owner_id is the user who created the role assignment, not the assignee)
 */
async function getUserStudyIds(userId: number): Promise<number[]> {
  try {
    const result = await pool.query(`
      SELECT DISTINCT sur.study_id FROM study_user_role sur
      INNER JOIN user_account ua ON sur.user_name = ua.user_name
      WHERE ua.user_id = $1 AND sur.status_id = 1
    `, [userId]);
    return result.rows.map((r: any) => r.studyId);
  } catch (error) {
    logger.error('Error getting user studies', { userId });
    return [];
  }
}

/**
 * Get all tasks for a user, aggregating from multiple sources
 */
export async function getUserTasks(filters: TaskFilters): Promise<{ success: boolean; data: Task[]; total: number }> {
  logger.info('Getting user tasks', filters);
  
  const tasks: Task[] = [];
  const limit = filters.limit || 100;
  const includeQueries = filters.includeQueries !== false; // Default to true
  const defaultTypes: TaskType[] = includeQueries 
    ? ['query', 'scheduled_visit', 'data_entry', 'form_completion', 'sdv_required', 'signature_required']
    : ['scheduled_visit', 'data_entry', 'form_completion', 'sdv_required', 'signature_required'];
  const types = filters.types || defaultTypes;
  
  try {
    // Get user ID if username provided
    let userId = filters.userId;
    if (filters.username && !userId) {
      userId = await getUserId(filters.username) || undefined;
    }
    
    // Get studies the user has access to (for filtering)
    let userStudyIds: number[] = [];
    if (userId) {
      userStudyIds = await getUserStudyIds(userId);
    }
    
    // Org-scoping: resolve the set of user IDs in the caller's organization
    // If caller has no org (root admin), orgUserIds will be null => no org filter applied
    let orgUserIds: number[] | null = null;
    let userOrgs: { id: number; name: string }[] = [];
    const callerUserId = filters.callerUserId || userId;
    if (callerUserId) {
      orgUserIds = await getOrgMemberUserIds(callerUserId);
      userOrgs = await getUserOrganizations(callerUserId);
      if (orgUserIds) {
        logger.info('Org-scoping tasks', { callerUserId, orgMemberCount: orgUserIds.length });
      }
    }
    
    // Get dismissed/completed task IDs to filter them out
    const primaryOrgId = userOrgs.length > 0 ? userOrgs[0].id : undefined;
    const dismissedTaskIds = await getDismissedTaskIds(primaryOrgId);
    
    // 1. QUERIES - From discrepancy_note (assigned_user_id or owner_id matches user)
    if (types.includes('query') && includeQueries) {
      const queries = await getQueryTasks(userId, filters.studyId, limit, orgUserIds);
      tasks.push(...queries);
    }
    
    // 2. SCHEDULED VISITS - From study_event (owner_id matches user)
    if (types.includes('scheduled_visit')) {
      const scheduledVisits = await getScheduledVisitTasks(userId, filters.studyId, userStudyIds, limit, orgUserIds);
      tasks.push(...scheduledVisits);
    }
    
    // 3. DATA ENTRY - Events with data entry started (owner_id matches)
    if (types.includes('data_entry')) {
      const dataEntryTasks = await getDataEntryTasks(userId, filters.studyId, userStudyIds, limit, orgUserIds);
      tasks.push(...dataEntryTasks);
    }
    
    // 4. FORM COMPLETION - Incomplete event_crf records (owner_id matches)
    if (types.includes('form_completion')) {
      const formTasks = await getFormCompletionTasks(userId, filters.studyId, userStudyIds, limit, orgUserIds);
      tasks.push(...formTasks);
    }
    
    // 5. SDV REQUIRED - event_crf with sdv_status = false (for CRAs with access)
    if (types.includes('sdv_required')) {
      const sdvTasks = await getSDVTasks(userId, filters.studyId, userStudyIds, limit, orgUserIds);
      tasks.push(...sdvTasks);
    }
    
    // 6. SIGNATURE REQUIRED - Completed forms needing e-signature (owner_id matches)
    if (types.includes('signature_required')) {
      const signatureTasks = await getSignatureTasks(userId, filters.studyId, userStudyIds, limit, orgUserIds);
      tasks.push(...signatureTasks);
    }
    
    // Filter out dismissed/completed tasks
    let filteredTasks = tasks.filter(t => !dismissedTaskIds.has(t.taskId));
    
    // Filter by status if specified
    if (filters.status) {
      filteredTasks = filteredTasks.filter(t => t.status === filters.status);
    }
    
    // Filter by priority if specified (cast via query param, not on TaskFilters)
    const priorityFilter = (filters as any).priority as TaskPriority | undefined;
    if (priorityFilter) {
      filteredTasks = filteredTasks.filter(t => t.priority === priorityFilter);
    }
    
    // Sort by priority and due date
    filteredTasks.sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
    
    return {
      success: true,
      data: filteredTasks.slice(0, limit),
      total: filteredTasks.length
    };
  } catch (error: any) {
    logger.error('Error getting user tasks', { error: error.message });
    throw error;
  }
}

/**
 * Get task summary counts
 */
export async function getTaskSummary(filters: TaskFilters): Promise<{ success: boolean; data: TaskSummary }> {
  logger.info('Getting task summary', filters);
  
  try {
    const tasksResult = await getUserTasks({ ...filters, limit: 1000 });
    const tasks = tasksResult.data;
    
    const overdue = tasks.filter(t => t.status === 'overdue').length;
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const dueSoon = tasks.filter(t => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d > now && d <= threeDaysFromNow;
    }).length;
    
    const summary: TaskSummary = {
      totalPending: tasks.filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'overdue').length,
      overdue,
      dueSoon,
      byType: {
        queries: tasks.filter(t => t.type === 'query').length,
        scheduledVisits: tasks.filter(t => t.type === 'scheduled_visit' || t.type === 'overdue_visit').length,
        dataEntry: tasks.filter(t => t.type === 'data_entry').length,
        formCompletion: tasks.filter(t => t.type === 'form_completion').length,
        sdvRequired: tasks.filter(t => t.type === 'sdv_required').length,
        signatureRequired: tasks.filter(t => t.type === 'signature_required').length
      },
      byStatus: {
        pending: tasks.filter(t => t.status === 'pending').length,
        inProgress: tasks.filter(t => t.status === 'in_progress').length,
        overdue
      },
      byPriority: {
        critical: tasks.filter(t => t.priority === 'critical').length,
        urgent: tasks.filter(t => t.priority === 'urgent').length,
        high: tasks.filter(t => t.priority === 'high').length,
        medium: tasks.filter(t => t.priority === 'medium').length,
        low: tasks.filter(t => t.priority === 'low').length
      }
    };
    
    return { success: true, data: summary };
  } catch (error: any) {
    logger.error('Error getting task summary', { error: error.message });
    throw error;
  }
}

// ============ QUERY TASKS (discrepancy_note) ============
// Queries where user is assigned_user_id OR owner_id

async function getQueryTasks(userId: number | undefined, studyId: number | undefined, limit: number, orgUserIds: number[] | null = null): Promise<Task[]> {
  // Get the user's accessible study IDs to filter out legacy/foreign queries
  let userStudyIds: number[] = [];
  if (userId) {
    userStudyIds = await getUserStudyIds(userId);
  }

  let query = `
    SELECT 
      dn.discrepancy_note_id,
      dn.description,
      dn.detailed_notes,
      dn.date_created,
      dn.entity_type,
      dn.study_id,
      dn.owner_id,
      dn.assigned_user_id,
      rs.name as resolution_status,
      rs.resolution_status_id,
      dnt.name as note_type,
      dnt.discrepancy_note_type_id,
      s.name as study_name,
      ss.study_subject_id,
      ss.label as subject_label,
      assigned.user_id as assigned_user_id,
      assigned.user_name as assigned_username,
      assigned.first_name as assigned_first_name,
      assigned.last_name as assigned_last_name,
      owner.user_id as owner_user_id,
      owner.user_name as owner_username
    FROM discrepancy_note dn
    JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
    JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
    LEFT JOIN study s ON dn.study_id = s.study_id
    LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
    LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
    LEFT JOIN user_account assigned ON dn.assigned_user_id = assigned.user_id
    LEFT JOIN user_account owner ON dn.owner_id = owner.user_id
    WHERE rs.resolution_status_id IN (1, 2, 3)  -- New, Updated, Resolution Proposed (not Closed/NA)
    AND dn.parent_dn_id IS NULL  -- Only parent notes (not responses)
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  // Filter by user - assigned to them OR they own it
  if (userId) {
    query += ` AND (dn.assigned_user_id = $${paramIdx} OR dn.owner_id = $${paramIdx})`;
    params.push(userId);
    paramIdx++;
  }
  
  if (studyId) {
    query += ` AND dn.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  } else if (userStudyIds.length > 0) {
    // Only show queries from the user's accessible studies (excludes legacy/foreign queries)
    query += ` AND (dn.study_id = ANY($${paramIdx}::int[]) OR dn.study_id IS NULL)`;
    params.push(userStudyIds);
    paramIdx++;
  }
  
  // Org-scoping: only show queries owned by users in the same org
  if (orgUserIds) {
    query += ` AND dn.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY 
    CASE rs.resolution_status_id 
      WHEN 1 THEN 1  -- New first
      WHEN 2 THEN 2  -- Updated
      WHEN 3 THEN 3  -- Resolution Proposed
    END,
    dn.date_created DESC 
    LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const createdAt = new Date(row.dateCreated);
      // Due date: 7 days from creation for queries
      const dueDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (row.resolutionStatus === 'Updated') status = 'in_progress';
      if (row.resolutionStatus === 'Resolution Proposed') status = 'in_progress';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        taskId: `query-${row.discrepancyNoteId}`,
        id: `query-${row.discrepancyNoteId}`,
        type: 'query' as TaskType,
        title: row.description || `Query #${row.discrepancyNoteId}`,
        description: row.detailedNotes || `${row.noteType} - ${row.resolutionStatus}`,
        status,
        priority,
        dueDate,
        createdAt,
        studyId: row.studyId || 0,
        studyName: row.studyName || 'Unknown Study',
        studySubjectId: row.studySubjectId || undefined,
        subjectLabel: row.subjectLabel || undefined,
        eventId: undefined,
        formId: undefined,
        formName: undefined,
        assignedToUserId: row.assignedUserId || undefined,
        assignedToUsername: row.assignedUsername || undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'discrepancy_note',
        sourceId: row.discrepancyNoteId
      };
    });
  } catch (error: any) {
    logger.error('Error getting query tasks', { error: error.message });
    throw error;
  }
}

// ============ SCHEDULED VISIT TASKS (study_event) ============
// subject_event_status_id = 1 (Scheduled), filtered by owner_id or study access

async function getScheduledVisitTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number,
  orgUserIds: number[] | null = null
): Promise<Task[]> {
  let query = `
    SELECT 
      se.study_event_id,
      se.study_event_definition_id,
      se.date_start,
      se.date_end,
      se.location,
      se.sample_ordinal,
      se.date_created,
      se.owner_id,
      ses.name as event_status,
      ses.subject_event_status_id,
      sed.name as event_name,
      sed.description as event_description,
      sed.ordinal as event_ordinal,
      sed.schedule_day,
      sed.min_day,
      sed.max_day,
      ss.study_subject_id,
      ss.label as subject_label,
      ss.enrollment_date,
      s.study_id,
      s.name as study_name,
      ua.user_id as owner_user_id,
      ua.user_name as owner_username
    FROM study_event se
    JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
    JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    JOIN study s ON ss.study_id = s.study_id
    LEFT JOIN user_account ua ON se.owner_id = ua.user_id
    WHERE ses.subject_event_status_id = 1  -- Scheduled
    AND se.status_id = 1  -- Available (not removed)
    AND ss.status_id = 1  -- Subject is available
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  // Filter by user ownership OR user's study access
  if (userId) {
    if (userStudyIds.length > 0) {
      query += ` AND (se.owner_id = $${paramIdx} OR s.study_id = ANY($${paramIdx + 1}::int[]))`;
      params.push(userId, userStudyIds);
      paramIdx += 2;
    } else {
      query += ` AND se.owner_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    }
  }
  
  if (studyId) {
    query += ` AND s.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  }
  
  // Org-scoping: only show visits owned by users in the same org
  if (orgUserIds) {
    query += ` AND se.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY se.date_start ASC NULLS LAST, sed.ordinal ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const now = new Date();
      
      // Calculate due date from visit window if available, otherwise use date_start
      let dueDate: Date | null = null;
      let windowInfo = '';
      
      if (row.maxDay !== null && row.maxDay !== undefined && row.enrollmentDate) {
        // Use visit window: due date = enrollment_date + max_day
        const enrollDate = parseDateLocal(row.enrollmentDate) || new Date(row.enrollmentDate);
        dueDate = new Date(enrollDate.getTime() + row.maxDay * 24 * 60 * 60 * 1000);
        
        if (row.scheduleDay !== null) {
          const windowMinus = row.scheduleDay - (row.minDay || row.scheduleDay);
          const windowPlus = (row.maxDay || row.scheduleDay) - row.scheduleDay;
          windowInfo = `Day ${row.scheduleDay} (${windowMinus > 0 ? '-' + windowMinus : '0'}/+${windowPlus})`;
        }
      } else if (row.dateStart) {
        dueDate = parseDateLocal(row.dateStart) || new Date(row.dateStart);
      }
      
      let status: TaskStatus = 'pending';
      let taskType: TaskType = 'scheduled_visit';
      let priority: TaskPriority = 'medium';
      
      if (dueDate) {
        if (dueDate < now) {
          status = 'overdue';
          taskType = 'overdue_visit';
          priority = 'critical';
        } else {
          priority = calculatePriority(dueDate, now);
        }
      }
      
      return {
        taskId: `visit-${row.studyEventId}`,
        id: `visit-${row.studyEventId}`,
        type: taskType,
        title: `${row.eventName}`,
        description: `Subject: ${row.subjectLabel}${row.location ? ` | Location: ${row.location}` : ''}${windowInfo ? ` | ${windowInfo}` : ''}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.dateCreated),
        studyId: row.studyId,
        studyName: row.studyName,
        studySubjectId: row.studySubjectId,
        subjectLabel: row.subjectLabel,
        eventId: row.studyEventId,
        visitName: row.eventName,
        formId: undefined,
        formName: undefined,
        assignedToUserId: row.ownerUserId || undefined,
        assignedToUsername: row.ownerUsername || undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'study_event',
        sourceId: row.studyEventId
      };
    });
  } catch (error: any) {
    logger.error('Error getting scheduled visit tasks', { error: error.message });
    throw error;
  }
}

// ============ DATA ENTRY TASKS (study_event with data entry started) ============
// subject_event_status_id = 3 (Data Entry Started)

async function getDataEntryTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number,
  orgUserIds: number[] | null = null
): Promise<Task[]> {
  let query = `
    SELECT 
      se.study_event_id,
      se.date_start,
      se.date_created,
      se.owner_id,
      ses.name as event_status,
      sed.name as event_name,
      sed.ordinal as event_ordinal,
      sed.schedule_day,
      sed.min_day,
      sed.max_day,
      ss.study_subject_id,
      ss.label as subject_label,
      ss.enrollment_date,
      s.study_id,
      s.name as study_name,
      ua.user_id as owner_user_id,
      ua.user_name as owner_username,
      (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.status_id = 1) as total_forms,
      (SELECT COUNT(*) FROM event_crf ec WHERE ec.study_event_id = se.study_event_id AND ec.status_id = 1 AND ec.date_completed IS NULL) as incomplete_forms
    FROM study_event se
    JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
    JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
    JOIN study s ON ss.study_id = s.study_id
    LEFT JOIN user_account ua ON se.owner_id = ua.user_id
    WHERE ses.subject_event_status_id = 3  -- Data entry started
    AND se.status_id = 1  -- Available
    AND ss.status_id = 1  -- Subject available
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  if (userId) {
    if (userStudyIds.length > 0) {
      query += ` AND (se.owner_id = $${paramIdx} OR s.study_id = ANY($${paramIdx + 1}::int[]))`;
      params.push(userId, userStudyIds);
      paramIdx += 2;
    } else {
      query += ` AND se.owner_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    }
  }
  
  if (studyId) {
    query += ` AND s.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  }
  
  // Org-scoping: only show data entry tasks owned by users in the same org
  if (orgUserIds) {
    query += ` AND se.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY se.date_start ASC NULLS LAST LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const totalForms = parseInt(row.totalForms) || 0;
      const incompleteForms = parseInt(row.incompleteForms) || 0;
      const now = new Date();
      
      // Calculate due date from visit window if available
      let dueDate: Date | null = null;
      let windowInfo = '';
      
      if (row.maxDay !== null && row.maxDay !== undefined && row.enrollmentDate) {
        const enrollDate = parseDateLocal(row.enrollmentDate) || new Date(row.enrollmentDate);
        dueDate = new Date(enrollDate.getTime() + row.maxDay * 24 * 60 * 60 * 1000);
        
        if (row.scheduleDay !== null) {
          const wMinus = row.scheduleDay - (row.minDay || row.scheduleDay);
          const wPlus = (row.maxDay || row.scheduleDay) - row.scheduleDay;
          windowInfo = `Day ${row.scheduleDay} (-${wMinus}/+${wPlus})`;
        }
      } else if (row.dateStart) {
        dueDate = parseDateLocal(row.dateStart) || new Date(row.dateStart);
      }
      
      let priority: TaskPriority = 'high';
      if (dueDate && dueDate < now) {
        priority = 'critical';
      }
      
      return {
        taskId: `dataentry-${row.studyEventId}`,
        id: `dataentry-${row.studyEventId}`,
        type: 'data_entry' as TaskType,
        title: `Data Entry: ${row.eventName}`,
        description: `Subject: ${row.subjectLabel} | ${incompleteForms}/${totalForms} forms incomplete${windowInfo ? ' | ' + windowInfo : ''}`,
        status: (dueDate && dueDate < now) ? 'overdue' as TaskStatus : 'in_progress' as TaskStatus,
        priority,
        dueDate,
        createdAt: new Date(row.dateCreated),
        studyId: row.studyId,
        studyName: row.studyName,
        studySubjectId: row.studySubjectId,
        subjectLabel: row.subjectLabel,
        eventId: row.studyEventId,
        visitName: row.eventName,
        formId: undefined,
        formName: undefined,
        assignedToUserId: row.ownerUserId || undefined,
        assignedToUsername: row.ownerUsername || undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'study_event',
        sourceId: row.studyEventId
      };
    });
  } catch (error: any) {
    logger.error('Error getting data entry tasks', { error: error.message });
    throw error;
  }
}

// ============ FORM COMPLETION TASKS (incomplete event_crf) ============

async function getFormCompletionTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number,
  orgUserIds: number[] | null = null
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
      ec.study_event_id,
      ec.date_created,
      ec.date_interviewed,
      ec.interviewer_name,
      ec.owner_id,
      st.name as crf_status,
      st.status_id,
      c.name as crf_name,
      c.crf_id,
      cv.name as crf_version,
      sed.name as event_name,
      sed.ordinal as event_ordinal,
      ss.study_subject_id,
      ss.label as subject_label,
      s.study_id,
      s.name as study_name,
      ua.user_id as owner_user_id,
      ua.user_name as owner_username
    FROM event_crf ec
    JOIN status st ON ec.status_id = st.status_id
    JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    JOIN crf c ON cv.crf_id = c.crf_id
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
    JOIN study s ON ss.study_id = s.study_id
    LEFT JOIN user_account ua ON ec.owner_id = ua.user_id
    WHERE ec.status_id = 1  -- Available (in progress, not completed)
    AND ec.date_completed IS NULL  -- Not yet completed
    AND ss.status_id = 1  -- Subject available
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  // Filter by owner or study access
  if (userId) {
    if (userStudyIds.length > 0) {
      query += ` AND (ec.owner_id = $${paramIdx} OR s.study_id = ANY($${paramIdx + 1}::int[]))`;
      params.push(userId, userStudyIds);
      paramIdx += 2;
    } else {
      query += ` AND ec.owner_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    }
  }
  
  if (studyId) {
    query += ` AND s.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  }
  
  // Org-scoping: only show form completion tasks owned by users in the same org
  if (orgUserIds) {
    query += ` AND ec.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY ec.date_created ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const createdAt = new Date(row.dateCreated);
      // Forms should be completed within 3 days of creation
      const dueDate = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'in_progress';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        taskId: `form-${row.eventCrfId}`,
        id: `form-${row.eventCrfId}`,
        type: 'form_completion' as TaskType,
        title: `Complete: ${row.crfName}`,
        description: `${row.eventName} | Subject: ${row.subjectLabel}`,
        status,
        priority,
        dueDate,
        createdAt,
        studyId: row.studyId,
        studyName: row.studyName,
        studySubjectId: row.studySubjectId,
        subjectLabel: row.subjectLabel,
        eventId: row.studyEventId,
        visitName: row.eventName,
        eventCrfId: row.eventCrfId,
        formId: row.crfId,
        formName: row.crfName,
        assignedToUserId: row.ownerUserId || undefined,
        assignedToUsername: row.ownerUsername || undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'event_crf',
        sourceId: row.eventCrfId
      };
    });
  } catch (error: any) {
    logger.error('Error getting form completion tasks', { error: error.message });
    throw error;
  }
}

// ============ SDV TASKS (event_crf with sdv_status = false) ============
// SDV is for CRAs with study access, not just form owners

async function getSDVTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number,
  orgUserIds: number[] | null = null
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
      ec.study_event_id,
      ec.date_created,
      ec.date_completed,
      ec.owner_id,
      ec.sdv_status,
      c.name as crf_name,
      c.crf_id,
      sed.name as event_name,
      ss.study_subject_id,
      ss.label as subject_label,
      s.study_id,
      s.name as study_name,
      ua.user_id as owner_user_id,
      ua.user_name as owner_username
    FROM event_crf ec
    JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    JOIN crf c ON cv.crf_id = c.crf_id
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
    JOIN study s ON ss.study_id = s.study_id
    LEFT JOIN user_account ua ON ec.owner_id = ua.user_id
    WHERE ec.sdv_status = false
    AND ec.status_id NOT IN (5, 7)  -- Not removed
    AND ec.date_completed IS NOT NULL  -- Only completed forms need SDV
    AND ss.status_id = 1  -- Subject available
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  // SDV tasks are visible to users with study access (CRAs)
  if (userStudyIds.length > 0) {
    query += ` AND s.study_id = ANY($${paramIdx}::int[])`;
    params.push(userStudyIds);
    paramIdx++;
  } else if (studyId) {
    query += ` AND s.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  }
  
  // Org-scoping: only show SDV tasks for forms owned by users in the same org
  if (orgUserIds) {
    query += ` AND ec.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY ec.date_completed ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const completedDate = new Date(row.dateCompleted);
      // SDV should be done within 7 days of form completion
      const dueDate = new Date(completedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        taskId: `sdv-${row.eventCrfId}`,
        id: `sdv-${row.eventCrfId}`,
        type: 'sdv_required' as TaskType,
        title: `SDV: ${row.crfName}`,
        description: `${row.eventName} | Subject: ${row.subjectLabel}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.dateCreated),
        studyId: row.studyId,
        studyName: row.studyName,
        studySubjectId: row.studySubjectId,
        subjectLabel: row.subjectLabel,
        eventId: row.studyEventId,
        visitName: row.eventName,
        eventCrfId: row.eventCrfId,
        formId: row.crfId,
        formName: row.crfName,
        assignedToUserId: undefined,
        assignedToUsername: undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'event_crf',
        sourceId: row.eventCrfId
      };
    });
  } catch (error: any) {
    logger.error('Error getting SDV tasks', { error: error.message });
    throw error;
  }
}

// ============ SIGNATURE TASKS (event_crf needing e-signature) ============
// For completed/locked events where form owner needs to sign

async function getSignatureTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number,
  orgUserIds: number[] | null = null
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
      ec.study_event_id,
      ec.date_created,
      ec.date_completed,
      ec.electronic_signature_status,
      ec.owner_id,
      c.name as crf_name,
      c.crf_id,
      sed.name as event_name,
      ses.name as event_status,
      ses.subject_event_status_id,
      ss.study_subject_id,
      ss.label as subject_label,
      s.study_id,
      s.name as study_name,
      ua.user_id as owner_user_id,
      ua.user_name as owner_username
    FROM event_crf ec
    JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
    JOIN crf c ON cv.crf_id = c.crf_id
    JOIN study_event se ON ec.study_event_id = se.study_event_id
    JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
    JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
    JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
    JOIN study s ON ss.study_id = s.study_id
    LEFT JOIN user_account ua ON ec.owner_id = ua.user_id
    WHERE (ec.electronic_signature_status = false OR ec.electronic_signature_status IS NULL)
    AND ses.subject_event_status_id IN (4, 7)  -- Completed or Locked (need signing)
    AND ec.status_id NOT IN (5, 7)  -- Not removed
    AND ss.status_id = 1  -- Subject available
  `;
  
  const params: any[] = [];
  let paramIdx = 1;
  
  // Signatures are for the form owner
  if (userId) {
    query += ` AND ec.owner_id = $${paramIdx}`;
    params.push(userId);
    paramIdx++;
  }
  
  if (studyId) {
    query += ` AND s.study_id = $${paramIdx}`;
    params.push(studyId);
    paramIdx++;
  }
  
  // Org-scoping: only show signature tasks for forms owned by users in the same org
  if (orgUserIds) {
    query += ` AND ec.owner_id = ANY($${paramIdx}::int[])`;
    params.push(orgUserIds);
    paramIdx++;
  }
  
  query += ` ORDER BY ec.date_completed ASC NULLS LAST LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const completedDate = row.dateCompleted ? new Date(row.dateCompleted) : new Date(row.dateCreated);
      // Signatures should be obtained within 3 days
      const dueDate = new Date(completedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        taskId: `signature-${row.eventCrfId}`,
        id: `signature-${row.eventCrfId}`,
        type: 'signature_required' as TaskType,
        title: `Sign: ${row.crfName}`,
        description: `${row.eventName} | Subject: ${row.subjectLabel}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.dateCreated),
        studyId: row.studyId,
        studyName: row.studyName,
        studySubjectId: row.studySubjectId,
        subjectLabel: row.subjectLabel,
        eventId: row.studyEventId,
        visitName: row.eventName,
        eventCrfId: row.eventCrfId,
        formId: row.crfId,
        formName: row.crfName,
        assignedToUserId: row.ownerUserId || undefined,
        assignedToUsername: row.ownerUsername || undefined,
        ownerUsername: row.ownerUsername || undefined,
        sourceTable: 'event_crf',
        sourceId: row.eventCrfId
      };
    });
  } catch (error: any) {
    logger.error('Error getting signature tasks', { error: error.message });
    throw error;
  }
}

// ============ UTILITY FUNCTIONS ============

function calculatePriority(dueDate: Date, now: Date): TaskPriority {
  const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'critical';
  if (diffDays === 0) return 'high';
  if (diffDays <= 3) return 'medium';
  return 'low';
}

/**
 * Parse a composite taskId like "query-123" into { type, sourceId }.
 */
function parseTaskId(taskId: string): { type: string; sourceId: number } | null {
  const dashIdx = taskId.indexOf('-');
  if (dashIdx === -1) return null;
  const type = taskId.substring(0, dashIdx);
  const sourceId = parseInt(taskId.substring(dashIdx + 1), 10);
  if (isNaN(sourceId)) return null;
  return { type, sourceId };
}

/**
 * Get a single task by ID via direct query against the source table.
 */
export async function getTaskById(taskId: string): Promise<{ success: boolean; data: Task | null }> {
  const parsed = parseTaskId(taskId);
  if (!parsed) return { success: false, data: null };

  const { type, sourceId } = parsed;

  try {
    let task: Task | null = null;

    if (type === 'query') {
      const r = await pool.query(`
        SELECT dn.discrepancy_note_id, dn.description, dn.detailed_notes, dn.date_created,
               dn.entity_type, dn.study_id, dn.owner_id, dn.assigned_user_id,
               rs.name as resolution_status, rs.resolution_status_id,
               dnt.name as note_type, dnt.discrepancy_note_type_id,
               s.name as study_name,
               ss.study_subject_id, ss.label as subject_label,
               assigned.user_name as assigned_username,
               owner.user_name as owner_username
        FROM discrepancy_note dn
        JOIN resolution_status rs ON dn.resolution_status_id = rs.resolution_status_id
        JOIN discrepancy_note_type dnt ON dn.discrepancy_note_type_id = dnt.discrepancy_note_type_id
        LEFT JOIN study s ON dn.study_id = s.study_id
        LEFT JOIN dn_study_subject_map dssm ON dn.discrepancy_note_id = dssm.discrepancy_note_id
        LEFT JOIN study_subject ss ON dssm.study_subject_id = ss.study_subject_id
        LEFT JOIN user_account assigned ON dn.assigned_user_id = assigned.user_id
        LEFT JOIN user_account owner ON dn.owner_id = owner.user_id
        WHERE dn.discrepancy_note_id = $1
      `, [sourceId]);
      if (r.rows.length > 0) {
        const row = r.rows[0];
        const createdAt = new Date(row.dateCreated);
        const dueDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        const now = new Date();
        let status: TaskStatus = 'pending';
        if (row.resolutionStatus === 'Updated' || row.resolutionStatus === 'Resolution Proposed') status = 'in_progress';
        if (dueDate < now) status = 'overdue';
        task = {
          taskId: taskId, id: taskId, type: 'query', title: row.description || `Query #${sourceId}`,
          description: row.detailedNotes || `${row.noteType} - ${row.resolutionStatus}`,
          status, priority: calculatePriority(dueDate, now), dueDate, createdAt,
          studyId: row.studyId || 0, studyName: row.studyName || 'Unknown Study',
          studySubjectId: row.studySubjectId || undefined, subjectLabel: row.subjectLabel || undefined,
          formId: undefined, formName: undefined,
          assignedToUserId: row.assignedUserId || undefined, assignedToUsername: row.assignedUsername || undefined,
          ownerUsername: row.ownerUsername || undefined,
          sourceTable: 'discrepancy_note', sourceId
        };
      }
    } else if (type === 'visit' || type === 'dataentry') {
      const r = await pool.query(`
        SELECT se.study_event_id, se.date_start, se.date_created, se.owner_id,
               ses.name as event_status, ses.subject_event_status_id,
               sed.name as event_name, sed.schedule_day, sed.min_day, sed.max_day,
               ss.study_subject_id, ss.label as subject_label, ss.enrollment_date,
               s.study_id, s.name as study_name,
               ua.user_name as owner_username
        FROM study_event se
        JOIN subject_event_status ses ON se.subject_event_status_id = ses.subject_event_status_id
        JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
        JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        JOIN study s ON ss.study_id = s.study_id
        LEFT JOIN user_account ua ON se.owner_id = ua.user_id
        WHERE se.study_event_id = $1
      `, [sourceId]);
      if (r.rows.length > 0) {
        const row = r.rows[0];
        const now = new Date();
        let dueDate: Date | null = row.dateStart ? new Date(row.dateStart) : null;
        if (row.maxDay != null && row.enrollmentDate) {
          const enroll = parseDateLocal(row.enrollmentDate) || new Date(row.enrollmentDate);
          dueDate = new Date(enroll.getTime() + row.maxDay * 24 * 60 * 60 * 1000);
        }
        const isDataEntry = type === 'dataentry';
        const taskType: TaskType = isDataEntry ? 'data_entry' : (dueDate && dueDate < now ? 'overdue_visit' : 'scheduled_visit');
        const status: TaskStatus = dueDate && dueDate < now ? 'overdue' : (isDataEntry ? 'in_progress' : 'pending');
        task = {
          taskId: taskId, id: taskId, type: taskType, title: isDataEntry ? `Data Entry: ${row.eventName}` : row.eventName,
          description: `Subject: ${row.subjectLabel}`, status,
          priority: dueDate ? calculatePriority(dueDate, now) : 'medium', dueDate,
          createdAt: new Date(row.dateCreated), studyId: row.studyId, studyName: row.studyName,
          studySubjectId: row.studySubjectId, subjectLabel: row.subjectLabel,
          eventId: row.studyEventId, visitName: row.eventName,
          formId: undefined, formName: undefined,
          assignedToUserId: row.ownerId || undefined, assignedToUsername: row.ownerUsername || undefined,
          ownerUsername: row.ownerUsername || undefined,
          sourceTable: 'study_event', sourceId
        };
      }
    } else if (type === 'form' || type === 'sdv' || type === 'signature') {
      const r = await pool.query(`
        SELECT ec.event_crf_id, ec.study_event_id, ec.date_created, ec.date_completed,
               ec.owner_id, ec.sdv_status, ec.electronic_signature_status,
               c.name as crf_name, c.crf_id,
               sed.name as event_name,
               ss.study_subject_id, ss.label as subject_label,
               s.study_id, s.name as study_name,
               ua.user_name as owner_username
        FROM event_crf ec
        JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        JOIN crf c ON cv.crf_id = c.crf_id
        JOIN study_event se ON ec.study_event_id = se.study_event_id
        JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
        JOIN study_subject ss ON ec.study_subject_id = ss.study_subject_id
        JOIN study s ON ss.study_id = s.study_id
        LEFT JOIN user_account ua ON ec.owner_id = ua.user_id
        WHERE ec.event_crf_id = $1
      `, [sourceId]);
      if (r.rows.length > 0) {
        const row = r.rows[0];
        const now = new Date();
        const createdAt = new Date(row.dateCreated);
        let taskType: TaskType;
        let title: string;
        let dueDate: Date;
        let status: TaskStatus;
        if (type === 'sdv') {
          taskType = 'sdv_required'; title = `SDV: ${row.crfName}`;
          dueDate = new Date((row.dateCompleted ? new Date(row.dateCompleted) : createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
          status = dueDate < now ? 'overdue' : 'pending';
        } else if (type === 'signature') {
          taskType = 'signature_required'; title = `Sign: ${row.crfName}`;
          dueDate = new Date((row.dateCompleted ? new Date(row.dateCompleted) : createdAt).getTime() + 3 * 24 * 60 * 60 * 1000);
          status = dueDate < now ? 'overdue' : 'pending';
        } else {
          taskType = 'form_completion'; title = `Complete: ${row.crfName}`;
          dueDate = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
          status = dueDate < now ? 'overdue' : 'in_progress';
        }
        task = {
          taskId: taskId, id: taskId, type: taskType, title,
          description: `${row.eventName} | Subject: ${row.subjectLabel}`,
          status, priority: calculatePriority(dueDate, now), dueDate, createdAt,
          studyId: row.studyId, studyName: row.studyName,
          studySubjectId: row.studySubjectId, subjectLabel: row.subjectLabel,
          eventId: row.studyEventId, visitName: row.eventName,
          eventCrfId: row.eventCrfId,
          formId: row.crfId, formName: row.crfName,
          assignedToUserId: row.ownerId || undefined, assignedToUsername: row.ownerUsername || undefined,
          ownerUsername: row.ownerUsername || undefined,
          sourceTable: 'event_crf', sourceId
        };
      }
    }

    return { success: !!task, data: task };
  } catch (error: any) {
    logger.error('Error getting task by ID', { taskId, error: error.message });
    return { success: false, data: null };
  }
}

/**
 * Write an audit trail entry for a task completion action.
 */
async function writeTaskAuditLog(
  userId: number,
  entityName: string,
  entityId: number,
  reasonForChange: string,
  oldValue: string,
  newValue: string
): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO audit_log_event
        (audit_log_event_type_id, audit_date, user_id, audit_table, entity_id,
         entity_name, reason_for_change, old_value, new_value)
      VALUES (54, NOW(), $1, $2, $3, $4, $5, $6, $7)
    `, [userId, entityName, entityId, entityName, reasonForChange, oldValue, newValue]);
  } catch (err: any) {
    logger.warn('Could not write audit_log_event for task completion', { entityName, entityId, error: err.message });
  }
}

/**
 * Complete a task - performs the ACTUAL database operation on the
 * underlying LibreClinica table, then records it in acc_task_status.
 */
export async function completeTask(
  taskId: string, 
  userId: number, 
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const parsed = parseTaskId(taskId);
  if (!parsed) {
    return { success: false, message: `Invalid task ID format: ${taskId}` };
  }

  const { type, sourceId } = parsed;

  try {
    return await pool.transaction(async (client) => {
      // 1. Perform the real database operation based on task type
      switch (type) {
        case 'query': {
          const before = await client.query(
            `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1 FOR UPDATE`, [sourceId]);
          if (before.rows.length === 0) return { success: false, message: `Query ${sourceId} not found` };
          const oldStatusId = before.rows[0].resolutionStatusId;
          if (oldStatusId === 4) return { success: false, message: `Query ${sourceId} is already closed` };

          await client.query(
            `UPDATE discrepancy_note SET resolution_status_id = 4 WHERE discrepancy_note_id = $1`,
            [sourceId]
          );
          await writeTaskAuditLog(userId, 'discrepancy_note', sourceId,
            reason || 'Query closed via task completion',
            `resolution_status_id=${oldStatusId}`, 'resolution_status_id=4');

          // Update denormalized query counts on patient_event_form
          try {
            const ecIds = await client.query(`
              SELECT DISTINCT ec_id FROM (
                SELECT id.event_crf_id AS ec_id FROM dn_item_data_map didm
                INNER JOIN item_data id ON didm.item_data_id = id.item_data_id
                WHERE didm.discrepancy_note_id = $1
                UNION
                SELECT decm.event_crf_id AS ec_id FROM dn_event_crf_map decm
                WHERE decm.discrepancy_note_id = $1
              ) t WHERE ec_id IS NOT NULL
            `, [sourceId]);
            for (const row of ecIds.rows) {
              await updateFormQueryCounts(client, row.ecId);
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn('Failed to update form query counts after task completion', { error: msg });
          }
          break;
        }

        case 'sdv': {
          const before = await client.query(
            `SELECT sdv_status FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`, [sourceId]);
          if (before.rows.length === 0) return { success: false, message: `Event CRF ${sourceId} not found` };
          if (before.rows[0].sdvStatus === true) return { success: false, message: `SDV already verified for event_crf ${sourceId}` };

          await client.query(
            `UPDATE event_crf SET sdv_status = true WHERE event_crf_id = $1`,
            [sourceId]
          );
          await writeTaskAuditLog(userId, 'event_crf', sourceId,
            reason || 'SDV verified via task completion',
            'sdv_status=false', 'sdv_status=true');
          break;
        }

        case 'signature': {
          const before = await client.query(
            `SELECT electronic_signature_status FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`, [sourceId]);
          if (before.rows.length === 0) return { success: false, message: `Event CRF ${sourceId} not found` };
          if (before.rows[0].electronicSignatureStatus === true) {
            return { success: false, message: `E-signature already applied for event_crf ${sourceId}` };
          }

          await client.query(
            `UPDATE event_crf SET electronic_signature_status = true WHERE event_crf_id = $1`,
            [sourceId]
          );
          await writeTaskAuditLog(userId, 'event_crf', sourceId,
            reason || 'E-signature applied via task completion',
            'electronic_signature_status=false', 'electronic_signature_status=true');
          break;
        }

        case 'form': {
          const before = await client.query(
            `SELECT date_completed, completion_status_id FROM event_crf WHERE event_crf_id = $1 FOR UPDATE`, [sourceId]);
          if (before.rows.length === 0) return { success: false, message: `Event CRF ${sourceId} not found` };
          if (before.rows[0].dateCompleted != null) {
            return { success: false, message: `Form ${sourceId} is already completed` };
          }

          await client.query(
            `UPDATE event_crf SET date_completed = NOW(), completion_status_id = 1 WHERE event_crf_id = $1 AND date_completed IS NULL`,
            [sourceId]
          );
          await writeTaskAuditLog(userId, 'event_crf', sourceId,
            reason || 'Form completed via task completion',
            'date_completed=NULL', 'date_completed=NOW(), completion_status_id=1');
          break;
        }

        case 'visit':
        case 'dataentry': {
          const before = await client.query(
            `SELECT subject_event_status_id FROM study_event WHERE study_event_id = $1 FOR UPDATE`, [sourceId]);
          if (before.rows.length === 0) return { success: false, message: `Study event ${sourceId} not found` };
          const oldStatus = before.rows[0].subjectEventStatusId;

          await client.query(
            `UPDATE study_event SET subject_event_status_id = 2 WHERE study_event_id = $1`,
            [sourceId]
          );
          await writeTaskAuditLog(userId, 'study_event', sourceId,
            reason || 'Visit marked completed via task completion',
            `subject_event_status_id=${oldStatus}`, 'subject_event_status_id=2');
          break;
        }

        default:
          return { success: false, message: `Unknown task type: ${type}` };
      }

      // 2. Record completion in acc_task_status for tracking / history
      const orgResult = await client.query(
        `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );
      const orgId = orgResult.rows[0]?.organizationId || null;

      await client.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, completed_at, reason, organization_id)
        VALUES ($1, 'completed', $2, NOW(), $3, $4)
        ON CONFLICT (task_id) DO UPDATE SET 
          status = 'completed', completed_by = $2, completed_at = NOW(), 
          reason = $3, date_updated = NOW()
      `, [taskId, userId, reason || 'Task completed', orgId]);

      logger.info('Task completed with underlying data update', { taskId, type, sourceId, userId });
      return { success: true, message: `Task ${type}-${sourceId} completed successfully` };
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Error completing task', { taskId, type, sourceId, error: msg });
    return { success: false, message: `Failed to complete task: ${msg}` };
  }
}

/**
 * Dismiss a task as uncompletable (won't show up anymore)
 */
export async function dismissTask(
  taskId: string, 
  userId: number, 
  reason: string
): Promise<{ success: boolean; message: string }> {
  if (!reason || reason.trim().length === 0) {
    return { success: false, message: 'A reason is required when dismissing a task' };
  }
  
  try {
    const orgResult = await pool.query(
      `SELECT organization_id FROM acc_organization_member WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId]
    );
    const orgId = orgResult.rows[0]?.organizationId || null;
    
    await pool.query(`
      INSERT INTO acc_task_status (task_id, status, completed_by, completed_at, reason, organization_id)
      VALUES ($1, 'dismissed', $2, NOW(), $3, $4)
      ON CONFLICT (task_id) DO UPDATE SET 
        status = 'dismissed', completed_by = $2, completed_at = NOW(), 
        reason = $3, date_updated = NOW()
    `, [taskId, userId, reason, orgId]);
    
    logger.info('Task dismissed as uncompletable', { taskId, userId, reason });
    return { success: true, message: 'Task dismissed as uncompletable' };
  } catch (error: any) {
    logger.error('Error dismissing task', { taskId, error: error.message });
    return { success: false, message: `Failed to dismiss task: ${error.message}` };
  }
}

/**
 * Reopen a previously completed or dismissed task
 */
export async function reopenTask(
  taskId: string, 
  userId: number
): Promise<{ success: boolean; message: string }> {
  try {
    await pool.query(
      `DELETE FROM acc_task_status WHERE task_id = $1`,
      [taskId]
    );
    
    logger.info('Task reopened', { taskId, userId });
    return { success: true, message: 'Task reopened' };
  } catch (error: any) {
    logger.error('Error reopening task', { taskId, error: error.message });
    return { success: false, message: `Failed to reopen task: ${error.message}` };
  }
}

/**
 * Get completed/dismissed tasks from acc_task_status.
 * Powers the "Show Completed" toggle in the task list UI.
 */
export async function getCompletedTasks(filters: {
  userId?: number;
  organizationId?: number;
  status?: 'completed' | 'dismissed';
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; data: any[]; total: number }> {
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  try {
    let where = `WHERE ats.status IN ('completed', 'dismissed')`;
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.status) {
      where += ` AND ats.status = $${paramIdx}`;
      params.push(filters.status);
      paramIdx++;
    }

    if (filters.organizationId) {
      where += ` AND (ats.organization_id = $${paramIdx} OR ats.organization_id IS NULL)`;
      params.push(filters.organizationId);
      paramIdx++;
    }

    if (filters.userId) {
      where += ` AND ats.completed_by = $${paramIdx}`;
      params.push(filters.userId);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM acc_task_status ats ${where}`, params
    );
    const total = parseInt(countResult.rows[0].cnt, 10);

    const dataResult = await pool.query(`
      SELECT ats.task_id, ats.status, ats.completed_by, ats.completed_at,
             ats.reason, ats.organization_id, ats.date_updated,
             ua.user_name as completed_by_username,
             ua.first_name as completed_by_first_name,
             ua.last_name as completed_by_last_name
      FROM acc_task_status ats
      LEFT JOIN user_account ua ON ats.completed_by = ua.user_id
      ${where}
      ORDER BY ats.completed_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    const data = dataResult.rows.map((row: any) => ({
      taskId: row.taskId,
      status: row.status,
      completedBy: row.completedBy,
      completedByUsername: row.completedByUsername,
      completedByName: row.completedByFirstName
        ? `${row.completedByFirstName} ${row.completedByLastName}`.trim()
        : row.completedByUsername,
      completedAt: row.completedAt,
      reason: row.reason,
      organizationId: row.organizationId,
      dateUpdated: row.dateUpdated
    }));

    return { success: true, data, total };
  } catch (error: any) {
    logger.error('Error getting completed tasks', { error: error.message });
    return { success: false, data: [], total: 0 };
  }
}
