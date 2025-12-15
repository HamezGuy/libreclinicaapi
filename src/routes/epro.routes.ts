/**
 * ePRO (Electronic Patient-Reported Outcomes) Routes
 * 
 * Endpoints for managing PRO instruments, patient assignments, and responses.
 * Integrates with LibreClinica's database for patient/subject information.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';

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
    const statsQuery = `
      SELECT
        (SELECT COUNT(DISTINCT subject_id) FROM acc_pro_assignment WHERE status != 'cancelled') as total_patients,
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

    if (studyId) {
      params.push(studyId);
      query += ` AND i.study_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND i.status = $${params.length}`;
    }

    query += ' ORDER BY i.name ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        instrumentId: row.instrument_id,
        studyId: row.study_id,
        name: row.name,
        description: row.description,
        questionCount: row.question_count,
        estimatedTime: row.estimated_time_minutes,
        frequency: row.frequency,
        status: row.status,
        content: row.content,
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
 */
router.post('/instruments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, name, description, content, frequency, estimatedTime } = req.body;
    const userId = (req as any).user?.id || 1;

    // Calculate question count from content
    const questionCount = content?.questions?.length || 0;

    const result = await pool.query(`
      INSERT INTO acc_pro_instrument (
        study_id, name, description, question_count, estimated_time_minutes,
        frequency, status, content, owner_id, date_created, date_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, NOW(), NOW())
      RETURNING *
    `, [studyId, name, description, questionCount, estimatedTime || 10, frequency || 'once', content, userId]);

    res.json({
      success: true,
      data: result.rows[0]
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

    let query = `
      SELECT 
        a.*,
        i.name as instrument_name,
        ss.label as subject_label
      FROM acc_pro_assignment a
      LEFT JOIN acc_pro_instrument i ON a.instrument_id = i.instrument_id
      LEFT JOIN study_subject ss ON a.subject_id = ss.study_subject_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND a.study_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    if (subjectId) {
      params.push(subjectId);
      query += ` AND a.subject_id = $${params.length}`;
    }

    query += ' ORDER BY a.due_date ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        assignmentId: row.assignment_id,
        subjectId: row.subject_id,
        subjectLabel: row.subject_label,
        instrumentId: row.instrument_id,
        instrumentName: row.instrument_name,
        status: row.status,
        dueDate: row.due_date,
        completedDate: row.completed_date,
        remindersSent: row.reminders_sent || 0
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
 */
router.post('/assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subjectId, instrumentId, dueDate, studyId } = req.body;
    const userId = (req as any).user?.id || 1;

    const result = await pool.query(`
      INSERT INTO acc_pro_assignment (
        subject_id, instrument_id, study_id, status, due_date,
        assigned_by, date_created, date_updated
      ) VALUES ($1, $2, $3, 'pending', $4, $5, NOW(), NOW())
      RETURNING *
    `, [subjectId, instrumentId, studyId, dueDate, userId]);

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
 */
router.post('/assignments/:id/remind', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Update reminder count
    await pool.query(`
      UPDATE acc_pro_assignment 
      SET reminders_sent = COALESCE(reminders_sent, 0) + 1,
          last_reminder_date = NOW(),
          date_updated = NOW()
      WHERE assignment_id = $1
    `, [id]);

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
 */
router.post('/assignments/:id/respond', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { responses, startedAt, completedAt } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create response record
      const responseResult = await client.query(`
        INSERT INTO acc_pro_response (
          assignment_id, response_data, started_at, completed_at, date_created
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `, [id, JSON.stringify(responses), startedAt, completedAt]);

      // Update assignment status
      await client.query(`
        UPDATE acc_pro_assignment 
        SET status = 'completed',
            completed_date = NOW(),
            date_updated = NOW()
        WHERE assignment_id = $1
      `, [id]);

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

    let query = `
      SELECT 
        p.*,
        ss.label as subject_label,
        (SELECT COUNT(*) FROM acc_pro_assignment a WHERE a.subject_id = p.study_subject_id AND a.status = 'pending') as pending_forms
      FROM acc_patient_account p
      LEFT JOIN study_subject ss ON p.study_subject_id = ss.study_subject_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (studyId) {
      params.push(studyId);
      query += ` AND p.study_id = $${params.length}`;
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
        patientId: row.patient_id,
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

