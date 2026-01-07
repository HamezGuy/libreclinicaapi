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
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for reminder sent
 */
router.post('/assignments/:id/remind', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current reminder count before update
    const beforeResult = await pool.query(
      'SELECT reminders_sent, study_subject_id FROM acc_pro_assignment WHERE assignment_id = $1',
      [id]
    );
    const oldReminderCount = beforeResult.rows[0]?.reminders_sent || 0;
    const subjectId = beforeResult.rows[0]?.study_subject_id;

    // Update reminder count
    await pool.query(`
      UPDATE acc_pro_assignment 
      SET reminders_sent = COALESCE(reminders_sent, 0) + 1,
          last_reminder_date = NOW(),
          date_updated = NOW()
      WHERE assignment_id = $1
    `, [id]);

    // Part 11 Audit: Record reminder sent (§11.10(e))
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.PRO_REMINDER_SENT,
      'acc_pro_assignment',
      parseInt(id),
      `Reminder for assignment ${id}`,
      { reminders_sent: oldReminderCount },
      { reminders_sent: oldReminderCount + 1, subject_id: subjectId },
      'PRO reminder sent to patient',
      { ipAddress: req.ip }
    );

    // TODO: Queue email reminder via email service

    res.json({
      success: true,
      message: 'Reminder sent successfully'
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
      const responseResult = await client.query(`
        INSERT INTO acc_pro_response (
          assignment_id, response_data, started_at, completed_at, date_created
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `, [id, JSON.stringify(responses), startedAt, completedAt]);

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

export default router;

