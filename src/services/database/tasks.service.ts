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

// Task type enumeration matching LibreClinica data sources
export type TaskType = 
  | 'query'              // From discrepancy_note
  | 'scheduled_visit'    // From study_event (status = scheduled)
  | 'data_entry'         // From study_event (status = data entry started) + event_crf
  | 'form_completion'    // From event_crf (incomplete)
  | 'sdv_required'       // From event_crf (sdv_status = false)
  | 'signature_required' // From event_crf (needs e-signature)
  | 'overdue_visit';     // Scheduled visits past due

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type TaskStatus = 'pending' | 'in_progress' | 'overdue' | 'completed';

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdAt: Date;
  
  // Context information
  studyId: number;
  studyName: string;
  subjectId: number | null;
  subjectLabel: string | null;
  eventId: number | null;
  eventName: string | null;
  formId: number | null;
  formName: string | null;
  
  // Assignment
  assignedToUserId: number | null;
  assignedToUsername: string | null;
  ownerId: number | null;
  ownerUsername: string | null;
  
  // Source reference (for linking back to original record)
  sourceTable: string;
  sourceId: number;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

export interface TaskSummary {
  total: number;
  byType: {
    queries: number;
    scheduledVisits: number;
    dataEntry: number;
    formCompletion: number;
    sdvRequired: number;
    signatureRequired: number;
  };
  byStatus: {
    pending: number;
    inProgress: number;
    overdue: number;
  };
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface TaskFilters {
  userId?: number;
  username?: string;
  studyId?: number;
  types?: TaskType[];
  status?: TaskStatus;
  priority?: TaskPriority;
  includeQueries?: boolean;  // Toggle for queries
  limit?: number;
  offset?: number;
}

/**
 * Get user ID from username
 */
async function getUserId(username: string): Promise<number | null> {
  try {
    const result = await pool.query(
      'SELECT user_id FROM user_account WHERE user_name = $1',
      [username]
    );
    return result.rows[0]?.user_id || null;
  } catch (error) {
    logger.error('Error getting user ID', { username });
    return null;
  }
}

/**
 * Get studies the user has access to
 */
async function getUserStudyIds(userId: number): Promise<number[]> {
  try {
    const result = await pool.query(`
      SELECT DISTINCT study_id FROM study_user_role 
      WHERE owner_id = $1 AND status_id = 1
    `, [userId]);
    return result.rows.map((r: any) => r.study_id);
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
    
    // 1. QUERIES - From discrepancy_note (assigned_user_id or owner_id matches user)
    if (types.includes('query') && includeQueries) {
      const queries = await getQueryTasks(userId, filters.studyId, limit);
      tasks.push(...queries);
    }
    
    // 2. SCHEDULED VISITS - From study_event (owner_id matches user)
    if (types.includes('scheduled_visit')) {
      const scheduledVisits = await getScheduledVisitTasks(userId, filters.studyId, userStudyIds, limit);
      tasks.push(...scheduledVisits);
    }
    
    // 3. DATA ENTRY - Events with data entry started (owner_id matches)
    if (types.includes('data_entry')) {
      const dataEntryTasks = await getDataEntryTasks(userId, filters.studyId, userStudyIds, limit);
      tasks.push(...dataEntryTasks);
    }
    
    // 4. FORM COMPLETION - Incomplete event_crf records (owner_id matches)
    if (types.includes('form_completion')) {
      const formTasks = await getFormCompletionTasks(userId, filters.studyId, userStudyIds, limit);
      tasks.push(...formTasks);
    }
    
    // 5. SDV REQUIRED - event_crf with sdv_status = false (for CRAs with access)
    if (types.includes('sdv_required')) {
      const sdvTasks = await getSDVTasks(userId, filters.studyId, userStudyIds, limit);
      tasks.push(...sdvTasks);
    }
    
    // 6. SIGNATURE REQUIRED - Completed forms needing e-signature (owner_id matches)
    if (types.includes('signature_required')) {
      const signatureTasks = await getSignatureTasks(userId, filters.studyId, userStudyIds, limit);
      tasks.push(...signatureTasks);
    }
    
    // Filter by status if specified
    let filteredTasks = tasks;
    if (filters.status) {
      filteredTasks = filteredTasks.filter(t => t.status === filters.status);
    }
    
    // Filter by priority if specified
    if (filters.priority) {
      filteredTasks = filteredTasks.filter(t => t.priority === filters.priority);
    }
    
    // Sort by priority and due date
    filteredTasks.sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
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
    
    const summary: TaskSummary = {
      total: tasks.length,
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
        overdue: tasks.filter(t => t.status === 'overdue').length
      },
      byPriority: {
        critical: tasks.filter(t => t.priority === 'critical').length,
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

async function getQueryTasks(userId: number | undefined, studyId: number | undefined, limit: number): Promise<Task[]> {
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
      const createdAt = new Date(row.date_created);
      // Due date: 7 days from creation for queries
      const dueDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (row.resolution_status === 'Updated') status = 'in_progress';
      if (row.resolution_status === 'Resolution Proposed') status = 'in_progress';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        id: `query-${row.discrepancy_note_id}`,
        type: 'query' as TaskType,
        title: row.description || `Query #${row.discrepancy_note_id}`,
        description: row.detailed_notes || `${row.note_type} - ${row.resolution_status}`,
        status,
        priority,
        dueDate,
        createdAt,
        studyId: row.study_id || 0,
        studyName: row.study_name || 'Unknown Study',
        subjectId: row.study_subject_id || null,
        subjectLabel: row.subject_label || null,
        eventId: null,
        eventName: null,
        formId: null,
        formName: null,
        assignedToUserId: row.assigned_user_id || null,
        assignedToUsername: row.assigned_username || null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'discrepancy_note',
        sourceId: row.discrepancy_note_id,
        metadata: {
          noteType: row.note_type,
          noteTypeId: row.discrepancy_note_type_id,
          resolutionStatus: row.resolution_status,
          resolutionStatusId: row.resolution_status_id,
          entityType: row.entity_type,
          assignedName: row.assigned_first_name 
            ? `${row.assigned_first_name} ${row.assigned_last_name}`.trim()
            : row.assigned_username
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting query tasks', { error: error.message });
    return [];
  }
}

// ============ SCHEDULED VISIT TASKS (study_event) ============
// subject_event_status_id = 1 (Scheduled), filtered by owner_id or study access

async function getScheduledVisitTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number
): Promise<Task[]> {
  let query = `
    SELECT 
      se.study_event_id,
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
      ss.study_subject_id,
      ss.label as subject_label,
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
  
  query += ` ORDER BY se.date_start ASC NULLS LAST, sed.ordinal ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const dueDate = row.date_start ? new Date(row.date_start) : null;
      const now = new Date();
      
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
        id: `visit-${row.study_event_id}`,
        type: taskType,
        title: `${row.event_name}`,
        description: `Subject: ${row.subject_label}${row.location ? ` | Location: ${row.location}` : ''}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.date_created),
        studyId: row.study_id,
        studyName: row.study_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        eventId: row.study_event_id,
        eventName: row.event_name,
        formId: null,
        formName: null,
        assignedToUserId: row.owner_user_id || null,
        assignedToUsername: row.owner_username || null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'study_event',
        sourceId: row.study_event_id,
        metadata: {
          location: row.location,
          sampleOrdinal: row.sample_ordinal,
          eventStatus: row.event_status,
          eventOrdinal: row.event_ordinal,
          eventDescription: row.event_description
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting scheduled visit tasks', { error: error.message });
    return [];
  }
}

// ============ DATA ENTRY TASKS (study_event with data entry started) ============
// subject_event_status_id = 3 (Data Entry Started)

async function getDataEntryTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number
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
      ss.study_subject_id,
      ss.label as subject_label,
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
  
  query += ` ORDER BY se.date_start ASC NULLS LAST LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const totalForms = parseInt(row.total_forms) || 0;
      const incompleteForms = parseInt(row.incomplete_forms) || 0;
      const now = new Date();
      
      return {
        id: `dataentry-${row.study_event_id}`,
        type: 'data_entry' as TaskType,
        title: `Data Entry: ${row.event_name}`,
        description: `Subject: ${row.subject_label} | ${incompleteForms}/${totalForms} forms incomplete`,
        status: 'in_progress' as TaskStatus,
        priority: 'high' as TaskPriority,
        dueDate: row.date_start ? new Date(row.date_start) : null,
        createdAt: new Date(row.date_created),
        studyId: row.study_id,
        studyName: row.study_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        eventId: row.study_event_id,
        eventName: row.event_name,
        formId: null,
        formName: null,
        assignedToUserId: row.owner_user_id || null,
        assignedToUsername: row.owner_username || null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'study_event',
        sourceId: row.study_event_id,
        metadata: {
          totalForms,
          incompleteForms,
          completedForms: totalForms - incompleteForms,
          eventStatus: row.event_status,
          eventOrdinal: row.event_ordinal
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting data entry tasks', { error: error.message });
    return [];
  }
}

// ============ FORM COMPLETION TASKS (incomplete event_crf) ============

async function getFormCompletionTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
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
  
  query += ` ORDER BY ec.date_created ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const createdAt = new Date(row.date_created);
      // Forms should be completed within 3 days of creation
      const dueDate = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'in_progress';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        id: `form-${row.event_crf_id}`,
        type: 'form_completion' as TaskType,
        title: `Complete: ${row.crf_name}`,
        description: `${row.event_name} | Subject: ${row.subject_label}`,
        status,
        priority,
        dueDate,
        createdAt,
        studyId: row.study_id,
        studyName: row.study_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        eventId: null,
        eventName: row.event_name,
        formId: row.event_crf_id,
        formName: row.crf_name,
        assignedToUserId: row.owner_user_id || null,
        assignedToUsername: row.owner_username || null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'event_crf',
        sourceId: row.event_crf_id,
        metadata: {
          crfId: row.crf_id,
          crfVersion: row.crf_version,
          crfStatus: row.crf_status,
          dateInterviewed: row.date_interviewed,
          interviewerName: row.interviewer_name,
          eventOrdinal: row.event_ordinal
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting form completion tasks', { error: error.message });
    return [];
  }
}

// ============ SDV TASKS (event_crf with sdv_status = false) ============
// SDV is for CRAs with study access, not just form owners

async function getSDVTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
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
  
  query += ` ORDER BY ec.date_completed ASC LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const completedDate = new Date(row.date_completed);
      // SDV should be done within 7 days of form completion
      const dueDate = new Date(completedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        id: `sdv-${row.event_crf_id}`,
        type: 'sdv_required' as TaskType,
        title: `SDV: ${row.crf_name}`,
        description: `${row.event_name} | Subject: ${row.subject_label}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.date_created),
        studyId: row.study_id,
        studyName: row.study_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        eventId: null,
        eventName: row.event_name,
        formId: row.event_crf_id,
        formName: row.crf_name,
        assignedToUserId: null,  // SDV not assigned to specific user
        assignedToUsername: null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'event_crf',
        sourceId: row.event_crf_id,
        metadata: {
          crfId: row.crf_id,
          dateCompleted: row.date_completed
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting SDV tasks', { error: error.message });
    return [];
  }
}

// ============ SIGNATURE TASKS (event_crf needing e-signature) ============
// For completed/locked events where form owner needs to sign

async function getSignatureTasks(
  userId: number | undefined, 
  studyId: number | undefined, 
  userStudyIds: number[],
  limit: number
): Promise<Task[]> {
  let query = `
    SELECT 
      ec.event_crf_id,
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
  
  query += ` ORDER BY ec.date_completed ASC NULLS LAST LIMIT $${paramIdx}`;
  params.push(limit);
  
  try {
    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => {
      const completedDate = row.date_completed ? new Date(row.date_completed) : new Date(row.date_created);
      // Signatures should be obtained within 3 days
      const dueDate = new Date(completedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      let status: TaskStatus = 'pending';
      if (dueDate < now) status = 'overdue';
      
      const priority = calculatePriority(dueDate, now);
      
      return {
        id: `signature-${row.event_crf_id}`,
        type: 'signature_required' as TaskType,
        title: `Sign: ${row.crf_name}`,
        description: `${row.event_name} | Subject: ${row.subject_label}`,
        status,
        priority,
        dueDate,
        createdAt: new Date(row.date_created),
        studyId: row.study_id,
        studyName: row.study_name,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        eventId: null,
        eventName: row.event_name,
        formId: row.event_crf_id,
        formName: row.crf_name,
        assignedToUserId: row.owner_user_id || null,
        assignedToUsername: row.owner_username || null,
        ownerId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        sourceTable: 'event_crf',
        sourceId: row.event_crf_id,
        metadata: {
          crfId: row.crf_id,
          eventStatus: row.event_status,
          eventStatusId: row.subject_event_status_id,
          dateCompleted: row.date_completed
        }
      };
    });
  } catch (error: any) {
    logger.error('Error getting signature tasks', { error: error.message });
    return [];
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
 * Get a single task by ID
 */
export async function getTaskById(taskId: string): Promise<{ success: boolean; data: Task | null }> {
  const [type, id] = taskId.split('-');
  const sourceId = parseInt(id);
  
  if (isNaN(sourceId)) {
    return { success: false, data: null };
  }
  
  // Fetch all tasks and find the matching one
  const result = await getUserTasks({ limit: 1000 });
  const task = result.data.find(t => t.sourceId === sourceId && t.sourceTable === getTableForType(type));
  
  return { success: !!task, data: task || null };
}

function getTableForType(type: string): string {
  const tableMap: Record<string, string> = {
    'query': 'discrepancy_note',
    'visit': 'study_event',
    'dataentry': 'study_event',
    'form': 'event_crf',
    'sdv': 'event_crf',
    'signature': 'event_crf'
  };
  return tableMap[type] || '';
}
