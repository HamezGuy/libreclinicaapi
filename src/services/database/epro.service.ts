/**
 * ePRO (Electronic Patient-Reported Outcomes) Service
 *
 * All database operations for PRO instruments, assignments, responses,
 * patient accounts, and reminders.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ============================================================================
// Type Definitions
// ============================================================================

export interface DashboardStats {
  totalPatients: number;
  pendingAssignments: number;
  overdueAssignments: number;
  completedAssignments: number;
  completionRate: number;
}

export interface InstrumentRow {
  instrumentId: number;
  name: string;
  shortName: string;
  description: string;
  category: string;
  estimatedMinutes: number;
  statusId: number;
  content: any;
  languageCode: string;
  assignmentCount: number;
  dateCreated: string;
}

export interface CreateInstrumentParams {
  name: string;
  shortName?: string;
  description?: string;
  content?: any;
  category?: string;
  estimatedMinutes?: number;
  languageCode?: string;
}

export interface AssignmentRow {
  assignmentId: number;
  studySubjectId: number;
  subjectLabel: string;
  instrumentId: number;
  instrumentName: string;
  status: string;
  scheduledDate: string;
  completedAt: string;
  assignedBy: number;
  notes: string;
  dateCreated: string;
  dateUpdated: string;
}

export interface CreateAssignmentParams {
  subjectId: number;
  instrumentId: number;
  dueDate?: string | null;
  userId?: number;
}

export interface AssignmentWithPatient {
  assignmentId: number;
  studySubjectId: number;
  patientAccountId: number | null;
  email: string | null;
  instrumentName: string;
}

export interface ResponseRow {
  responseId: number;
  assignmentId: number;
  studySubjectId: number;
  instrumentId: number;
  answers: any;
  startedAt: string;
  completedAt: string;
  dateCreated: string;
}

export interface PatientAccountRow {
  patientAccountId: number;
  studySubjectId: number;
  subjectLabel: string;
  email: string;
  phone: string;
  status: string;
  lastLogin: string;
  pendingForms: number;
}

export interface ReminderRow {
  reminderId: number;
  assignmentId: number;
  patientAccountId: number;
  studySubjectId: number;
  subjectLabel: string;
  instrumentName: string;
  patientEmail: string;
  patientPhone: string;
  reminderType: string;
  scheduledFor: string;
  sentAt: string;
  status: string;
  messageSubject: string;
  messageBody: string;
  errorMessage: string;
  dateCreated: string;
}

export interface CreateReminderParams {
  assignmentId: number;
  patientAccountId: number;
  reminderType: string;
  scheduledFor: string;
  messageSubject?: string;
  messageBody?: string;
}

export interface AssignmentForScheduling {
  assignmentId: number;
  studySubjectId: number;
  patientAccountId: number | null;
  scheduledDate: string | null;
}

// ============================================================================
// Dashboard
// ============================================================================

export async function getDashboardStats(): Promise<DashboardStats> {
  const statsQuery = `
    SELECT
      (SELECT COUNT(DISTINCT study_subject_id) FROM acc_pro_assignment WHERE status != 'cancelled') as total_patients,
      (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'pending') as pending_assignments,
      (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'overdue') as overdue_assignments,
      (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'completed') as completed_assignments
  `;

  const result = await pool.query(statsQuery);
  const stats = result.rows[0] || {};

  const pending = parseInt(stats.pendingAssignments || 0);
  const completed = parseInt(stats.completedAssignments || 0);
  const overdue = parseInt(stats.overdueAssignments || 0);
  const total = pending + completed + overdue;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    totalPatients: parseInt(stats.totalPatients || 0),
    pendingAssignments: pending,
    overdueAssignments: overdue,
    completedAssignments: completed,
    completionRate,
  };
}

// ============================================================================
// Instruments
// ============================================================================

export async function listInstruments(filters: {
  status?: string;
}): Promise<InstrumentRow[]> {
  let query = `
    SELECT 
      i.*,
      (SELECT COUNT(*) FROM acc_pro_assignment WHERE instrument_id = i.instrument_id) as assignment_count
    FROM acc_pro_instrument i
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.status) {
    params.push(filters.status);
    query += ` AND i.status_id = $${params.length}`;
  }

  query += ' ORDER BY i.name ASC';

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    instrumentId: row.instrumentId,
    name: row.name,
    shortName: row.shortName,
    description: row.description,
    category: row.category,
    estimatedMinutes: row.estimatedMinutes,
    statusId: row.statusId,
    content: row.content,
    languageCode: row.languageCode,
    assignmentCount: parseInt(row.assignmentCount || 0),
    dateCreated: row.dateCreated,
  }));
}

export async function createInstrument(params: CreateInstrumentParams): Promise<{
  instrumentId: number;
  name: string;
  shortName: string;
}> {
  const { name, shortName, description, content, category, estimatedMinutes, languageCode } = params;

  const finalShortName = shortName || name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50).toLowerCase() + '_' + Date.now();

  const result = await pool.query(`
    INSERT INTO acc_pro_instrument (
      name, short_name, description, category, estimated_minutes,
      language_code, status_id, content, date_created
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW())
    RETURNING *
  `, [name, finalShortName, description, category || 'general', estimatedMinutes || 10, languageCode || 'en', content]);

  return {
    instrumentId: result.rows[0].instrumentId,
    name: result.rows[0].name,
    shortName: result.rows[0].shortName,
  };
}

export async function getInstrumentById(id: string | number): Promise<InstrumentRow | null> {
  const result = await pool.query(
    'SELECT * FROM acc_pro_instrument WHERE instrument_id = $1',
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    instrumentId: row.instrumentId,
    name: row.name,
    shortName: row.shortName,
    description: row.description,
    category: row.category,
    estimatedMinutes: row.estimatedMinutes,
    statusId: row.statusId,
    content: row.content,
    languageCode: row.languageCode,
    assignmentCount: 0,
    dateCreated: row.dateCreated,
  };
}

// ============================================================================
// Assignments
// ============================================================================

export async function listAssignments(filters: {
  studyId?: string;
  status?: string;
  subjectId?: string;
}): Promise<AssignmentRow[]> {
  let query = `
    SELECT 
      a.*,
      i.name as instrument_name,
      ss.label as subject_label
    FROM acc_pro_assignment a
    LEFT JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
    LEFT JOIN study_subject ss ON a.study_subject_id = ss.study_subject_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.studyId) {
    params.push(filters.studyId);
    query += ` AND ss.study_id = $${params.length}`;
  }

  if (filters.status) {
    params.push(filters.status);
    query += ` AND a.status = $${params.length}`;
  }

  if (filters.subjectId) {
    params.push(filters.subjectId);
    query += ` AND a.study_subject_id = $${params.length}`;
  }

  query += ' ORDER BY a.scheduled_date ASC NULLS LAST';

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    assignmentId: row.assignmentId,
    studySubjectId: row.studySubjectId,
    subjectLabel: row.subjectLabel,
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    status: row.status,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
    assignedBy: row.assignedBy,
    notes: row.notes,
    dateCreated: row.dateCreated,
    dateUpdated: row.dateUpdated,
  }));
}

export async function createAssignment(params: CreateAssignmentParams): Promise<AssignmentRow> {
  const { subjectId, instrumentId, dueDate, userId } = params;

  const result = await pool.query(`
    INSERT INTO acc_pro_assignment (
      study_subject_id, instrument_id, status, scheduled_date,
      assigned_by, date_created, date_updated
    ) VALUES ($1, $2, 'pending', $3, $4, NOW(), NOW())
    RETURNING *
  `, [subjectId, instrumentId, dueDate, userId]);

  const row = result.rows[0];
  return {
    assignmentId: row.assignmentId,
    studySubjectId: row.studySubjectId,
    subjectLabel: '',
    instrumentId: row.instrumentId,
    instrumentName: '',
    status: row.status,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
    assignedBy: row.assignedBy,
    notes: row.notes,
    dateCreated: row.dateCreated,
    dateUpdated: row.dateUpdated,
  };
}

export async function getAssignmentWithPatient(assignmentId: string | number): Promise<AssignmentWithPatient | null> {
  const result = await pool.query(`
    SELECT a.assignment_id, a.study_subject_id, pa.patient_account_id, pa.email, i.name as instrument_name
    FROM acc_pro_assignment a
    LEFT JOIN acc_patient_account pa ON a.study_subject_id = pa.study_subject_id
    LEFT JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
    WHERE a.assignment_id = $1
  `, [assignmentId]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    assignmentId: row.assignmentId,
    studySubjectId: row.studySubjectId,
    patientAccountId: row.patientAccountId,
    email: row.email,
    instrumentName: row.instrumentName,
  };
}

export async function getAssignmentForScheduling(assignmentId: string | number): Promise<AssignmentForScheduling | null> {
  const result = await pool.query(`
    SELECT a.*, pa.patient_account_id
    FROM acc_pro_assignment a
    LEFT JOIN acc_patient_account pa ON a.study_subject_id = pa.study_subject_id
    WHERE a.assignment_id = $1
  `, [assignmentId]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    assignmentId: row.assignmentId,
    studySubjectId: row.studySubjectId,
    patientAccountId: row.patientAccountId,
    scheduledDate: row.scheduledDate,
  };
}

// ============================================================================
// Responses
// ============================================================================

export async function submitResponse(
  assignmentId: string | number,
  responseData: { responses: any; startedAt?: string; completedAt?: string }
): Promise<{ responseRow: ResponseRow; oldStatus: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const assignmentResult = await client.query(
      'SELECT study_subject_id, instrument_id, status FROM acc_pro_assignment WHERE assignment_id = $1',
      [assignmentId]
    );

    if (assignmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const assignment = assignmentResult.rows[0];
    const oldStatus = assignment?.status;

    const responseResult = await client.query(`
      INSERT INTO acc_pro_response (
        assignment_id, study_subject_id, instrument_id, answers, started_at, completed_at, date_created
      ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), NOW())
      RETURNING *
    `, [
      assignmentId,
      assignment?.studySubjectId,
      assignment?.instrumentId,
      JSON.stringify(responseData.responses),
      responseData.startedAt || new Date(),
      responseData.completedAt,
    ]);

    await client.query(`
      UPDATE acc_pro_assignment 
      SET status = 'completed',
          completed_at = NOW(),
          date_updated = NOW()
      WHERE assignment_id = $1
    `, [assignmentId]);

    await client.query('COMMIT');

    const row = responseResult.rows[0];
    return {
      responseRow: {
        responseId: row.responseId,
        assignmentId: row.assignmentId,
        studySubjectId: row.studySubjectId,
        instrumentId: row.instrumentId,
        answers: row.answers,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        dateCreated: row.dateCreated,
      },
      oldStatus,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getResponseByAssignment(assignmentId: string | number): Promise<ResponseRow | null> {
  const result = await pool.query(
    'SELECT * FROM acc_pro_response WHERE assignment_id = $1 ORDER BY date_created DESC LIMIT 1',
    [assignmentId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    responseId: row.responseId,
    assignmentId: row.assignmentId,
    studySubjectId: row.studySubjectId,
    instrumentId: row.instrumentId,
    answers: row.answers,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    dateCreated: row.dateCreated,
  };
}

// ============================================================================
// Patient Accounts
// ============================================================================

export async function listPatientAccounts(filters: {
  studyId?: string;
  status?: string;
}): Promise<PatientAccountRow[]> {
  let query = `
    SELECT 
      p.*,
      ss.label as subject_label,
      (SELECT COUNT(*) FROM acc_pro_assignment a WHERE a.study_subject_id = p.study_subject_id AND a.status = 'pending') as pending_forms
    FROM acc_patient_account p
    LEFT JOIN study_subject ss ON p.study_subject_id = ss.study_subject_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.studyId) {
    params.push(filters.studyId);
    query += ` AND ss.study_id = $${params.length}`;
  }

  if (filters.status) {
    params.push(filters.status);
    query += ` AND p.status = $${params.length}`;
  }

  query += ' ORDER BY p.date_created DESC';

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    patientAccountId: row.patientAccountId,
    studySubjectId: row.studySubjectId,
    subjectLabel: row.subjectLabel,
    email: row.email,
    phone: row.phone,
    status: row.status,
    lastLogin: row.lastLogin,
    pendingForms: parseInt(row.pendingForms || 0),
  }));
}

// ============================================================================
// Reminders
// ============================================================================

const REMINDER_JOIN_QUERY = `
  SELECT 
    r.*,
    a.study_subject_id,
    ss.label as subject_label,
    i.name as instrument_name,
    pa.email as patient_email,
    pa.phone as patient_phone
  FROM acc_pro_reminder r
  LEFT JOIN acc_pro_assignment a ON r.assignment_id = a.assignment_id
  LEFT JOIN study_subject ss ON a.study_subject_id = ss.study_subject_id
  LEFT JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
  LEFT JOIN acc_patient_account pa ON r.patient_account_id = pa.patient_account_id
`;

function mapReminderRow(row: any): ReminderRow {
  return {
    reminderId: row.reminderId,
    assignmentId: row.assignmentId,
    patientAccountId: row.patientAccountId,
    studySubjectId: row.studySubjectId,
    subjectLabel: row.subjectLabel,
    instrumentName: row.instrumentName,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    reminderType: row.reminderType,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    status: row.status,
    messageSubject: row.messageSubject,
    messageBody: row.messageBody,
    errorMessage: row.errorMessage,
    dateCreated: row.dateCreated,
  };
}

export async function listReminders(filters: {
  assignmentId?: string;
  patientAccountId?: string;
  status?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
}): Promise<ReminderRow[]> {
  let query = REMINDER_JOIN_QUERY + ' WHERE 1=1';
  const params: any[] = [];

  if (filters.assignmentId) {
    params.push(filters.assignmentId);
    query += ` AND r.assignment_id = $${params.length}`;
  }

  if (filters.patientAccountId) {
    params.push(filters.patientAccountId);
    query += ` AND r.patient_account_id = $${params.length}`;
  }

  if (filters.status) {
    params.push(filters.status);
    query += ` AND r.status = $${params.length}`;
  }

  if (filters.scheduledFrom) {
    params.push(filters.scheduledFrom);
    query += ` AND r.scheduled_for >= $${params.length}`;
  }

  if (filters.scheduledTo) {
    params.push(filters.scheduledTo);
    query += ` AND r.scheduled_for <= $${params.length}`;
  }

  query += ' ORDER BY r.scheduled_for DESC';

  const result = await pool.query(query, params);
  return result.rows.map(mapReminderRow);
}

export async function getReminderById(id: string | number): Promise<ReminderRow | null> {
  const result = await pool.query(
    REMINDER_JOIN_QUERY + ' WHERE r.reminder_id = $1',
    [id]
  );

  if (result.rows.length === 0) return null;
  return mapReminderRow(result.rows[0]);
}

export async function createReminder(params: CreateReminderParams): Promise<{
  reminderId: number;
  assignmentId: number;
  scheduledFor: string;
  status: string;
}> {
  const { assignmentId, patientAccountId, reminderType, scheduledFor, messageSubject, messageBody } = params;

  const result = await pool.query(`
    INSERT INTO acc_pro_reminder (
      assignment_id, patient_account_id, reminder_type, scheduled_for,
      status, message_subject, message_body, date_created
    ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
    RETURNING *
  `, [assignmentId, patientAccountId, reminderType, scheduledFor, messageSubject, messageBody]);

  return {
    reminderId: result.rows[0].reminderId,
    assignmentId: result.rows[0].assignmentId,
    scheduledFor: result.rows[0].scheduledFor,
    status: result.rows[0].status,
  };
}

export async function createAssignmentReminder(
  assignmentId: string | number,
  patientAccountId: number,
  instrumentName: string | null
): Promise<number> {
  const result = await pool.query(`
    INSERT INTO acc_pro_reminder (
      assignment_id, patient_account_id, reminder_type, scheduled_for,
      status, sent_at, message_subject, message_body, date_created
    ) VALUES ($1, $2, 'email', NOW(), 'sent', NOW(), $3, $4, NOW())
    RETURNING reminder_id
  `, [
    assignmentId,
    patientAccountId,
    `Reminder: ${instrumentName || 'Questionnaire'}`,
    `This is a reminder to complete your questionnaire.`,
  ]);

  return result.rows[0].reminderId;
}

export async function getReminderStatus(id: string | number): Promise<{ status: string; patientAccountId: number } | null> {
  const result = await pool.query(
    'SELECT * FROM acc_pro_reminder WHERE reminder_id = $1',
    [id]
  );

  if (result.rows.length === 0) return null;
  return { status: result.rows[0].status, patientAccountId: result.rows[0].patientAccountId };
}

export async function getPatientContact(patientAccountId: number): Promise<{ email: string | null; phone: string | null } | null> {
  const result = await pool.query(
    'SELECT email, phone FROM acc_patient_account WHERE patient_account_id = $1',
    [patientAccountId]
  );

  if (result.rows.length === 0) return null;
  return { email: result.rows[0].email, phone: result.rows[0].phone };
}

export async function updateReminderSent(
  id: string | number,
  sent: boolean,
  errorMessage: string | null
): Promise<void> {
  await pool.query(`
    UPDATE acc_pro_reminder
    SET status = $1, sent_at = $2, error_message = $3
    WHERE reminder_id = $4
  `, [sent ? 'sent' : 'failed', sent ? new Date() : null, errorMessage, id]);
}

export async function cancelReminder(id: string | number): Promise<{ oldStatus: string } | null> {
  const currentResult = await pool.query(
    'SELECT status FROM acc_pro_reminder WHERE reminder_id = $1',
    [id]
  );

  if (currentResult.rows.length === 0) return null;

  const oldStatus = currentResult.rows[0].status;

  if (oldStatus !== 'pending') {
    return { oldStatus };
  }

  await pool.query(`
    UPDATE acc_pro_reminder
    SET status = 'cancelled'
    WHERE reminder_id = $1 AND status = 'pending'
  `, [id]);

  return { oldStatus };
}

export async function listPendingDueReminders(): Promise<ReminderRow[]> {
  const result = await pool.query(
    REMINDER_JOIN_QUERY + `
      WHERE r.status = 'pending' 
        AND r.scheduled_for <= NOW()
      ORDER BY r.scheduled_for ASC
    `
  );

  return result.rows.map(row => ({
    reminderId: row.reminderId,
    assignmentId: row.assignmentId,
    patientAccountId: row.patientAccountId,
    studySubjectId: row.studySubjectId,
    subjectLabel: row.subjectLabel,
    instrumentName: row.instrumentName,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    reminderType: row.reminderType,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    status: row.status,
    messageSubject: row.messageSubject,
    messageBody: row.messageBody,
    errorMessage: row.errorMessage,
    dateCreated: row.dateCreated,
  }));
}

export async function scheduleRemindersForAssignment(
  assignmentId: string | number,
  patientAccountId: number,
  scheduledDate: string,
  reminderSchedule?: Array<{ daysBefore: number; type: string }>
): Promise<number[]> {
  const defaultSchedule = reminderSchedule || [
    { daysBefore: 1, type: 'email' },
    { daysBefore: 0, type: 'email' },
  ];

  const createdReminders: number[] = [];

  for (const schedule of defaultSchedule) {
    const scheduledFor = new Date(scheduledDate);
    scheduledFor.setDate(scheduledFor.getDate() - (schedule.daysBefore || 0));

    if (scheduledFor <= new Date()) continue;

    const result = await pool.query(`
      INSERT INTO acc_pro_reminder (
        assignment_id, patient_account_id, reminder_type, scheduled_for,
        status, message_subject, message_body, date_created
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
      RETURNING reminder_id
    `, [
      assignmentId,
      patientAccountId,
      schedule.type || 'email',
      scheduledFor,
      `Reminder: Questionnaire Due`,
      `You have a questionnaire that is due on ${scheduledDate}. Please complete it at your earliest convenience.`,
    ]);

    createdReminders.push(result.rows[0].reminderId);
  }

  return createdReminders;
}
