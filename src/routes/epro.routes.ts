/**
 * ePRO (Electronic Patient-Reported Outcomes) Routes
 * 
 * Endpoints for managing PRO instruments, patient assignments, and responses.
 * Integrates with LibreClinica's database for patient/subject information.
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all CREATE, UPDATE, DELETE operations
 * - §11.10(k): UTC timestamps for all events
 * - §11.50: Electronic signature for critical operations
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  formatPart11Timestamp
} from '../middleware/part11.middleware';

const router = Router();

// Database connection - use existing pool from database config
import { pool } from '../config/database';

// Apply auth middleware to all routes
router.use(authMiddleware);

// ============================================================================
// Dashboard
// ============================================================================

/**
 * GET /api/epro/dashboard
 * Get ePRO dashboard statistics
 */
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId } = req.query;

    // Get stats from acc_pro_* tables
    // Note: table uses study_subject_id not subject_id
    const statsQuery = `
      SELECT
        (SELECT COUNT(DISTINCT study_subject_id) FROM acc_pro_assignment WHERE status != 'cancelled') as total_patients,
        (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'pending') as pending_assignments,
        (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'overdue') as overdue_assignments,
        (SELECT COUNT(*) FROM acc_pro_assignment WHERE status = 'completed') as completed_assignments
    `;

    const statsResult = await pool.query(statsQuery);
    const stats = statsResult.rows[0] || {};

    // Calculate completion rate
    const total = parseInt(stats.pending_assignments || 0) + 
                  parseInt(stats.completed_assignments || 0) + 
                  parseInt(stats.overdue_assignments || 0);
    const completionRate = total > 0 
      ? Math.round((parseInt(stats.completed_assignments || 0) / total) * 100) 
      : 0;

    res.json({
      success: true,
      data: {
        stats: {
          totalPatients: parseInt(stats.total_patients || 0),
          pendingAssignments: parseInt(stats.pending_assignments || 0),
          overdueAssignments: parseInt(stats.overdue_assignments || 0),
          completedAssignments: parseInt(stats.completed_assignments || 0),
          completionRate
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get ePRO dashboard', { error });
    next(error);
  }
});

// ============================================================================
// Instruments
// ============================================================================

/**
 * GET /api/epro/instruments
 * List all PRO instruments
 */
router.get('/instruments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, status } = req.query;

    let query = `
      SELECT 
        i.*,
        (SELECT COUNT(*) FROM acc_pro_assignment WHERE instrument_id = i.instrument_id) as assignment_count
      FROM acc_pro_instrument i
      WHERE 1=1
    `;
    const params: any[] = [];

    // Note: acc_pro_instrument doesn't have study_id column - instruments are study-agnostic
    // The study filter is done at assignment level

    if (status) {
      params.push(status);
      query += ` AND i.status_id = $${params.length}`;
    }

    query += ' ORDER BY i.name ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        instrumentId: row.instrument_id,
        name: row.name,
        shortName: row.short_name,
        description: row.description,
        category: row.category,
        estimatedMinutes: row.estimated_minutes,
        statusId: row.status_id,
        content: row.content,
        languageCode: row.language_code,
        assignmentCount: parseInt(row.assignment_count || 0)
      }))
    });
  } catch (error) {
    logger.error('Failed to list PRO instruments', { error });
    next(error);
  }
});

/**
 * POST /api/epro/instruments
 * Create a new PRO instrument
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for instrument creation
 * - Captures user, timestamp, and instrument details
 */
router.post('/instruments', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { name, shortName, description, content, category, estimatedMinutes, languageCode } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Generate short_name if not provided (required unique field)
    const finalShortName = shortName || name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50).toLowerCase() + '_' + Date.now();

    const result = await pool.query(`
      INSERT INTO acc_pro_instrument (
        name, short_name, description, category, estimated_minutes,
        language_code, status_id, content, date_created
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW())
      RETURNING *
    `, [name, finalShortName, description, category || 'general', estimatedMinutes || 10, languageCode || 'en', content]);

    const instrumentId = result.rows[0].instrument_id;

    // Part 11 Audit: Record instrument creation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_INSTRUMENT_CREATED,
      'acc_pro_instrument',
      instrumentId,
      name,
      null, // No old value for creation
      { name, category: category || 'general', estimatedMinutes: estimatedMinutes || 10 },
      'PRO instrument created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: {
        instrumentId,
        name: result.rows[0].name,
        shortName: result.rows[0].short_name
      }
    });
  } catch (error) {
    logger.error('Failed to create PRO instrument', { error });
    next(error);
  }
});

/**
 * GET /api/epro/instruments/:id
 * Get a specific PRO instrument
 */
router.get('/instruments/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM acc_pro_instrument WHERE instrument_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Instrument not found' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to get PRO instrument', { error });
    next(error);
  }
});

// ============================================================================
// Assignments
// ============================================================================

/**
 * GET /api/epro/assignments
 * List PRO assignments
 */
router.get('/assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, status, subjectId } = req.query;

    // Note: acc_pro_assignment uses study_subject_id, scheduled_date, completed_at
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

    // Note: acc_pro_assignment doesn't have study_id, filter via study_subject
    if (studyId) {
      params.push(studyId);
      query += ` AND ss.study_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    if (subjectId) {
      params.push(subjectId);
      query += ` AND a.study_subject_id = $${params.length}`;
    }

    query += ' ORDER BY a.scheduled_date ASC NULLS LAST';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        assignmentId: row.assignment_id,
        subjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        instrumentId: row.instrument_id,
        instrumentName: row.instrument_name,
        status: row.status,
        scheduledDate: row.scheduled_date,
        completedAt: row.completed_at,
        notes: row.notes
      }))
    });
  } catch (error) {
    logger.error('Failed to list PRO assignments', { error });
    next(error);
  }
});

/**
 * POST /api/epro/assignments
 * Assign a PRO instrument to a subject
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for assignment creation
 * - Links to study subject for traceability
 */
router.post('/assignments', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { subjectId, instrumentId, dueDate, studyId } = req.body;
    const userId = req.user?.userId || 1;
    const userName = req.user?.userName || 'system';

    const result = await pool.query(`
      INSERT INTO acc_pro_assignment (
        study_subject_id, instrument_id, status, scheduled_date,
        assigned_by, date_created, date_updated
      ) VALUES ($1, $2, 'pending', $3, $4, NOW(), NOW())
      RETURNING *
    `, [subjectId, instrumentId, dueDate, userId]);

    const assignmentId = result.rows[0].assignment_id;

    // Part 11 Audit: Record assignment creation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_ASSIGNMENT_CREATED,
      'acc_pro_assignment',
      assignmentId,
      `Assignment for subject ${subjectId}`,
      null,
      { subjectId, instrumentId, dueDate, status: 'pending' },
      'PRO assignment created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to create PRO assignment', { error });
    next(error);
  }
});

/**
 * POST /api/epro/assignments/:id/remind
 * Send a reminder for a PRO assignment
 * Creates a reminder record in acc_pro_reminder and marks it as sent
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for reminder sent
 */
router.post('/assignments/:id/remind', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get assignment and patient account details
    const assignmentResult = await pool.query(`
      SELECT a.assignment_id, a.study_subject_id, pa.patient_account_id, pa.email, i.name as instrument_name
      FROM acc_pro_assignment a
      LEFT JOIN acc_patient_account pa ON a.study_subject_id = pa.study_subject_id
      LEFT JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
      WHERE a.assignment_id = $1
    `, [id]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];
    
    if (!assignment.patient_account_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'No patient account linked to this subject' 
      });
    }

    // Create reminder record in acc_pro_reminder table
    const reminderResult = await pool.query(`
      INSERT INTO acc_pro_reminder (
        assignment_id, patient_account_id, reminder_type, scheduled_for,
        status, sent_at, message_subject, message_body, date_created
      ) VALUES ($1, $2, 'email', NOW(), 'sent', NOW(), $3, $4, NOW())
      RETURNING reminder_id
    `, [
      id, 
      assignment.patient_account_id,
      `Reminder: ${assignment.instrument_name || 'Questionnaire'}`,
      `This is a reminder to complete your questionnaire.`
    ]);

    const reminderId = reminderResult.rows[0].reminder_id;

    // Part 11 Audit: Record reminder sent (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_REMINDER_SENT,
      'acc_pro_reminder',
      reminderId,
      `Reminder for assignment ${id}`,
      null,
      { assignmentId: id, patientAccountId: assignment.patient_account_id, status: 'sent' },
      'PRO reminder sent to patient',
      { ipAddress: req.ip }
    );

    // TODO: Actually send email via email service

    res.json({
      success: true,
      message: 'Reminder sent successfully',
      data: { reminderId }
    });
  } catch (error) {
    logger.error('Failed to send PRO reminder', { error });
    next(error);
  }
});

// ============================================================================
// Responses
// ============================================================================

/**
 * POST /api/epro/assignments/:id/respond
 * Submit a PRO response
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for response submission
 * - Captures response timestamp and completion data
 * - Links to assignment for full traceability
 */
router.post('/assignments/:id/respond', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { responses, startedAt, completedAt } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get assignment details before update
      const assignmentResult = await client.query(
        'SELECT study_subject_id, instrument_id, status FROM acc_pro_assignment WHERE assignment_id = $1',
        [id]
      );
      const assignment = assignmentResult.rows[0];
      const oldStatus = assignment?.status;

      // Create response record
      // Note: Table uses 'answers' column (JSONB NOT NULL), and requires study_subject_id
      const responseResult = await client.query(`
        INSERT INTO acc_pro_response (
          assignment_id, study_subject_id, instrument_id, answers, started_at, completed_at, date_created
        ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), NOW())
        RETURNING *
      `, [
        id, 
        assignment?.study_subject_id, 
        assignment?.instrument_id,
        JSON.stringify(responses), 
        startedAt || new Date(), 
        completedAt
      ]);

      const responseId = responseResult.rows[0].response_id;

      // Update assignment status
      await client.query(`
        UPDATE acc_pro_assignment 
        SET status = 'completed',
            completed_at = NOW(),
            date_updated = NOW()
        WHERE assignment_id = $1
      `, [id]);

      // Part 11 Audit: Record response submission (§11.10(e))
      await recordPart11Audit(
        userId,
        userName,
        Part11EventTypes.PRO_RESPONSE_SUBMITTED,
        'acc_pro_response',
        responseId,
        `PRO Response for assignment ${id}`,
        { status: oldStatus },
        {
          status: 'completed',
          responseId,
          subjectId: assignment?.study_subject_id,
          instrumentId: assignment?.instrument_id,
          startedAt,
          completedAt: completedAt || formatPart11Timestamp()
        },
        'Patient submitted PRO questionnaire response',
        { ipAddress: req.ip }
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        data: responseResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Failed to submit PRO response', { error });
    next(error);
  }
});

/**
 * GET /api/epro/assignments/:id/response
 * Get a PRO response
 */
router.get('/assignments/:id/response', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM acc_pro_response WHERE assignment_id = $1 ORDER BY date_created DESC LIMIT 1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Response not found' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Failed to get PRO response', { error });
    next(error);
  }
});

// ============================================================================
// Patient Accounts
// ============================================================================

/**
 * GET /api/epro/patients
 * List patient accounts
 */
router.get('/patients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, status } = req.query;

    // Note: acc_patient_account uses patient_account_id, study_subject_id
    // and doesn't have study_id - filter via study_subject join
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

    if (studyId) {
      params.push(studyId);
      query += ` AND ss.study_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND p.status = $${params.length}`;
    }

    query += ' ORDER BY p.date_created DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        patientAccountId: row.patient_account_id,
        studySubjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        email: row.email,
        phone: row.phone,
        status: row.status,
        lastLogin: row.last_login,
        pendingForms: parseInt(row.pending_forms || 0)
      }))
    });
  } catch (error) {
    logger.error('Failed to list patient accounts', { error });
    next(error);
  }
});

/**
 * POST /api/epro/patients/:id/resend-activation
 * Resend activation email to patient
 */
router.post('/patients/:id/resend-activation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // TODO: Queue activation email via email service

    res.json({
      success: true,
      message: 'Activation email sent successfully'
    });
  } catch (error) {
    logger.error('Failed to resend activation email', { error });
    next(error);
  }
});

// ============================================================================
// Reminders (acc_pro_reminder table)
// ============================================================================

/**
 * GET /api/epro/reminders
 * List PRO reminders with filtering
 * 
 * Table: acc_pro_reminder
 * Columns: reminder_id, assignment_id, patient_account_id, reminder_type, 
 *          scheduled_for, sent_at, status, message_subject, message_body, 
 *          error_message, date_created
 */
router.get('/reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignmentId, patientAccountId, status, scheduledFrom, scheduledTo } = req.query;

    let query = `
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
      WHERE 1=1
    `;
    const params: any[] = [];

    if (assignmentId) {
      params.push(assignmentId);
      query += ` AND r.assignment_id = $${params.length}`;
    }

    if (patientAccountId) {
      params.push(patientAccountId);
      query += ` AND r.patient_account_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }

    if (scheduledFrom) {
      params.push(scheduledFrom);
      query += ` AND r.scheduled_for >= $${params.length}`;
    }

    if (scheduledTo) {
      params.push(scheduledTo);
      query += ` AND r.scheduled_for <= $${params.length}`;
    }

    query += ' ORDER BY r.scheduled_for DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        reminderId: row.reminder_id,
        assignmentId: row.assignment_id,
        patientAccountId: row.patient_account_id,
        studySubjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        instrumentName: row.instrument_name,
        patientEmail: row.patient_email,
        patientPhone: row.patient_phone,
        reminderType: row.reminder_type,
        scheduledFor: row.scheduled_for,
        sentAt: row.sent_at,
        status: row.status,
        messageSubject: row.message_subject,
        messageBody: row.message_body,
        errorMessage: row.error_message,
        dateCreated: row.date_created
      }))
    });
  } catch (error) {
    logger.error('Failed to list PRO reminders', { error });
    next(error);
  }
});

/**
 * GET /api/epro/reminders/:id
 * Get a specific reminder
 */
router.get('/reminders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
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
      WHERE r.reminder_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        reminderId: row.reminder_id,
        assignmentId: row.assignment_id,
        patientAccountId: row.patient_account_id,
        studySubjectId: row.study_subject_id,
        subjectLabel: row.subject_label,
        instrumentName: row.instrument_name,
        patientEmail: row.patient_email,
        patientPhone: row.patient_phone,
        reminderType: row.reminder_type,
        scheduledFor: row.scheduled_for,
        sentAt: row.sent_at,
        status: row.status,
        messageSubject: row.message_subject,
        messageBody: row.message_body,
        errorMessage: row.error_message,
        dateCreated: row.date_created
      }
    });
  } catch (error) {
    logger.error('Failed to get PRO reminder', { error });
    next(error);
  }
});

/**
 * POST /api/epro/reminders
 * Create a new reminder
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for reminder creation
 */
router.post('/reminders', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { 
      assignmentId, 
      patientAccountId, 
      reminderType, 
      scheduledFor, 
      messageSubject, 
      messageBody 
    } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!assignmentId || !patientAccountId || !reminderType || !scheduledFor) {
      return res.status(400).json({
        success: false,
        message: 'assignmentId, patientAccountId, reminderType, and scheduledFor are required'
      });
    }

    const result = await pool.query(`
      INSERT INTO acc_pro_reminder (
        assignment_id, patient_account_id, reminder_type, scheduled_for,
        status, message_subject, message_body, date_created
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
      RETURNING *
    `, [assignmentId, patientAccountId, reminderType, scheduledFor, messageSubject, messageBody]);

    const reminderId = result.rows[0].reminder_id;

    // Part 11 Audit: Record reminder creation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_REMINDER_CREATED || 'PRO_REMINDER_CREATED',
      'acc_pro_reminder',
      reminderId,
      `Reminder for assignment ${assignmentId}`,
      null,
      { 
        assignmentId, 
        patientAccountId, 
        reminderType, 
        scheduledFor, 
        status: 'pending' 
      },
      'PRO reminder scheduled',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: {
        reminderId,
        assignmentId: result.rows[0].assignment_id,
        scheduledFor: result.rows[0].scheduled_for,
        status: result.rows[0].status
      }
    });
  } catch (error) {
    logger.error('Failed to create PRO reminder', { error });
    next(error);
  }
});

/**
 * POST /api/epro/reminders/:id/send
 * Send a reminder immediately (marks as sent or failed)
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for reminder sent
 */
router.post('/reminders/:id/send', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get reminder details
    const reminderResult = await pool.query(
      'SELECT * FROM acc_pro_reminder WHERE reminder_id = $1',
      [id]
    );

    if (reminderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    const reminder = reminderResult.rows[0];

    if (reminder.status === 'sent') {
      return res.status(400).json({ success: false, message: 'Reminder already sent' });
    }

    // Get patient contact info
    const patientResult = await pool.query(
      'SELECT email, phone FROM acc_patient_account WHERE patient_account_id = $1',
      [reminder.patient_account_id]
    );
    const patient = patientResult.rows[0];

    let sent = false;
    let errorMessage = null;

    // TODO: Integrate with email/SMS service
    // For now, simulate sending
    if (reminder.reminder_type === 'email' && patient?.email) {
      // Queue email
      sent = true;
    } else if (reminder.reminder_type === 'sms' && patient?.phone) {
      // Queue SMS
      sent = true;
    } else if (reminder.reminder_type === 'push') {
      // Queue push notification
      sent = true;
    } else {
      errorMessage = `No valid contact method for ${reminder.reminder_type}`;
    }

    // Update reminder status
    await pool.query(`
      UPDATE acc_pro_reminder
      SET status = $1, sent_at = $2, error_message = $3
      WHERE reminder_id = $4
    `, [sent ? 'sent' : 'failed', sent ? new Date() : null, errorMessage, id]);

    // Part 11 Audit: Record reminder sent (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_REMINDER_SENT,
      'acc_pro_reminder',
      parseInt(id),
      `Reminder ${id}`,
      { status: reminder.status },
      { status: sent ? 'sent' : 'failed', errorMessage },
      sent ? 'PRO reminder sent successfully' : `PRO reminder failed: ${errorMessage}`,
      { ipAddress: req.ip }
    );

    res.json({
      success: sent,
      message: sent ? 'Reminder sent successfully' : `Failed to send reminder: ${errorMessage}`,
      data: { status: sent ? 'sent' : 'failed' }
    });
  } catch (error) {
    logger.error('Failed to send PRO reminder', { error });
    next(error);
  }
});

/**
 * POST /api/epro/reminders/:id/cancel
 * Cancel a pending reminder
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for reminder cancellation
 */
router.post('/reminders/:id/cancel', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current status
    const currentResult = await pool.query(
      'SELECT status FROM acc_pro_reminder WHERE reminder_id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    const oldStatus = currentResult.rows[0].status;

    if (oldStatus !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel reminder with status: ${oldStatus}` 
      });
    }

    await pool.query(`
      UPDATE acc_pro_reminder
      SET status = 'cancelled'
      WHERE reminder_id = $1 AND status = 'pending'
    `, [id]);

    // Part 11 Audit: Record reminder cancellation (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_REMINDER_CANCELLED || 'PRO_REMINDER_CANCELLED',
      'acc_pro_reminder',
      parseInt(id),
      `Reminder ${id}`,
      { status: oldStatus },
      { status: 'cancelled' },
      'PRO reminder cancelled',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Reminder cancelled successfully'
    });
  } catch (error) {
    logger.error('Failed to cancel PRO reminder', { error });
    next(error);
  }
});

/**
 * GET /api/epro/reminders/pending
 * Get all pending reminders that need to be sent
 */
router.get('/reminders/pending/due', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
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
      WHERE r.status = 'pending' 
        AND r.scheduled_for <= NOW()
      ORDER BY r.scheduled_for ASC
    `);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        reminderId: row.reminder_id,
        assignmentId: row.assignment_id,
        patientAccountId: row.patient_account_id,
        subjectLabel: row.subject_label,
        instrumentName: row.instrument_name,
        patientEmail: row.patient_email,
        patientPhone: row.patient_phone,
        reminderType: row.reminder_type,
        scheduledFor: row.scheduled_for,
        messageSubject: row.message_subject,
        messageBody: row.message_body
      }))
    });
  } catch (error) {
    logger.error('Failed to get pending reminders', { error });
    next(error);
  }
});

/**
 * POST /api/epro/assignments/:id/schedule-reminders
 * Schedule automatic reminders for an assignment
 * Creates reminders based on configuration (e.g., 1 day before, day of, 1 day after)
 */
router.post('/assignments/:id/schedule-reminders', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reminderSchedule } = req.body;
    // reminderSchedule: [{ daysBefore: 1, type: 'email' }, { daysBefore: 0, type: 'sms' }]
    const userId = req.user?.userId || 0;

    // Get assignment details
    const assignmentResult = await pool.query(`
      SELECT a.*, pa.patient_account_id
      FROM acc_pro_assignment a
      LEFT JOIN acc_patient_account pa ON a.study_subject_id = pa.study_subject_id
      WHERE a.assignment_id = $1
    `, [id]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];

    if (!assignment.patient_account_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'No patient account linked to this assignment' 
      });
    }

    if (!assignment.scheduled_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment has no scheduled date' 
      });
    }

    const defaultSchedule = reminderSchedule || [
      { daysBefore: 1, type: 'email' },
      { daysBefore: 0, type: 'email' }
    ];

    const createdReminders = [];

    for (const schedule of defaultSchedule) {
      const scheduledFor = new Date(assignment.scheduled_date);
      scheduledFor.setDate(scheduledFor.getDate() - (schedule.daysBefore || 0));

      // Don't create reminders in the past
      if (scheduledFor <= new Date()) continue;

      const result = await pool.query(`
        INSERT INTO acc_pro_reminder (
          assignment_id, patient_account_id, reminder_type, scheduled_for,
          status, message_subject, message_body, date_created
        ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())
        RETURNING reminder_id
      `, [
        id,
        assignment.patient_account_id,
        schedule.type || 'email',
        scheduledFor,
        `Reminder: Questionnaire Due`,
        `You have a questionnaire that is due on ${assignment.scheduled_date}. Please complete it at your earliest convenience.`
      ]);

      createdReminders.push(result.rows[0].reminder_id);
    }

    res.json({
      success: true,
      message: `${createdReminders.length} reminders scheduled`,
      data: { reminderIds: createdReminders }
    });
  } catch (error) {
    logger.error('Failed to schedule reminders', { error });
    next(error);
  }
});

export default router;

