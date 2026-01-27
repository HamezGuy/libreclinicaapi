/**
 * Training Records Service
 * 
 * 21 CFR Part 11 §11.10(i) - Training Documentation
 * HIPAA §164.308(a)(5) - Security Awareness Training
 * 
 * This service manages:
 * - Training course definitions
 * - User training completion tracking
 * - Quiz/assessment management
 * - Training expiration monitoring
 * - Compliance reporting
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ApiResponse, PaginatedResponse } from '../../types';

// ============================================================================
// Types
// ============================================================================

export interface TrainingCourse {
  id: number;
  courseCode: string;
  courseName: string;
  description: string | null;
  version: string;
  durationMinutes: number | null;
  passingScore: number;
  requiredForRoles: string[];
  regulatoryReference: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainingRecord {
  id: number;
  userId: number;
  courseId: number;
  courseName?: string;
  courseCode?: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'expired';
  startedAt: Date | null;
  completedAt: Date | null;
  score: number | null;
  attempts: number;
  certificateNumber: string | null;
  expirationDate: Date | null;
  verifiedBy: number | null;
  verifiedByName?: string;
  verifiedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizQuestion {
  id: number;
  courseId: number;
  questionText: string;
  questionType: 'multiple_choice' | 'true_false' | 'multi_select';
  options: { text: string; isCorrect: boolean }[];
  explanation: string | null;
  orderIndex: number;
}

export interface QuizAttempt {
  id: number;
  userId: number;
  courseId: number;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date | null;
  answers: { questionId: number; selectedOptions: number[]; correct: boolean }[];
  score: number | null;
  passed: boolean | null;
}

export interface TrainingComplianceStatus {
  userId: number;
  username: string;
  userFullName: string;
  role: string;
  totalRequired: number;
  completed: number;
  expired: number;
  pending: number;
  compliancePercentage: number;
  isCompliant: boolean;
  missingCourses: { courseCode: string; courseName: string; requiredBy: string }[];
}

// ============================================================================
// Course Management
// ============================================================================

/**
 * Get all active training courses
 */
export const getCourses = async (
  options: { activeOnly?: boolean; roleFilter?: string } = {}
): Promise<ApiResponse<TrainingCourse[]>> => {
  logger.info('Getting training courses', options);

  try {
    let query = `
      SELECT 
        id, course_code, course_name, description, version,
        duration_minutes, passing_score, required_for_roles,
        regulatory_reference, active, created_at, updated_at
      FROM training_courses
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.activeOnly !== false) {
      query += ` AND active = true`;
    }

    if (options.roleFilter) {
      params.push(options.roleFilter);
      query += ` AND $${params.length} = ANY(required_for_roles)`;
    }

    query += ` ORDER BY course_code`;

    const result = await pool.query(query, params);

    const courses: TrainingCourse[] = result.rows.map(row => ({
      id: row.id,
      courseCode: row.course_code,
      courseName: row.course_name,
      description: row.description,
      version: row.version,
      durationMinutes: row.duration_minutes,
      passingScore: row.passing_score,
      requiredForRoles: row.required_for_roles || [],
      regulatoryReference: row.regulatory_reference,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return { success: true, data: courses };

  } catch (error: any) {
    logger.error('Error getting training courses', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get course by ID with quiz questions
 */
export const getCourseById = async (
  courseId: number,
  includeQuestions: boolean = false
): Promise<ApiResponse<TrainingCourse & { questions?: QuizQuestion[] }>> => {
  logger.info('Getting course by ID', { courseId, includeQuestions });

  try {
    const courseQuery = `
      SELECT 
        id, course_code, course_name, description, version,
        duration_minutes, passing_score, required_for_roles,
        regulatory_reference, active, created_at, updated_at
      FROM training_courses
      WHERE id = $1
    `;

    const courseResult = await pool.query(courseQuery, [courseId]);

    if (courseResult.rows.length === 0) {
      return { success: false, message: 'Course not found' };
    }

    const row = courseResult.rows[0];
    const course: TrainingCourse & { questions?: QuizQuestion[] } = {
      id: row.id,
      courseCode: row.course_code,
      courseName: row.course_name,
      description: row.description,
      version: row.version,
      durationMinutes: row.duration_minutes,
      passingScore: row.passing_score,
      requiredForRoles: row.required_for_roles || [],
      regulatoryReference: row.regulatory_reference,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    if (includeQuestions) {
      const questionsQuery = `
        SELECT 
          id, course_id, question_text, question_type,
          options, explanation, order_index
        FROM training_quiz_questions
        WHERE course_id = $1 AND active = true
        ORDER BY order_index
      `;

      const questionsResult = await pool.query(questionsQuery, [courseId]);

      course.questions = questionsResult.rows.map(q => ({
        id: q.id,
        courseId: q.course_id,
        questionText: q.question_text,
        questionType: q.question_type,
        options: q.options,
        explanation: q.explanation,
        orderIndex: q.order_index
      }));
    }

    return { success: true, data: course };

  } catch (error: any) {
    logger.error('Error getting course', { error: error.message, courseId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Training Record Management
// ============================================================================

/**
 * Get training records for a user
 */
export const getUserTrainingRecords = async (
  userId: number
): Promise<ApiResponse<TrainingRecord[]>> => {
  logger.info('Getting user training records', { userId });

  try {
    const query = `
      SELECT 
        tr.id, tr.user_id, tr.course_id, tr.status,
        tr.started_at, tr.completed_at, tr.score, tr.attempts,
        tr.certificate_number, tr.expiration_date,
        tr.verified_by, tr.verified_at, tr.notes,
        tr.created_at, tr.updated_at,
        tc.course_name, tc.course_code,
        vb.user_name as verified_by_name
      FROM training_records tr
      INNER JOIN training_courses tc ON tr.course_id = tc.id
      LEFT JOIN user_account vb ON tr.verified_by = vb.user_id
      WHERE tr.user_id = $1
      ORDER BY tc.course_code
    `;

    const result = await pool.query(query, [userId]);

    const records: TrainingRecord[] = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      courseId: row.course_id,
      courseName: row.course_name,
      courseCode: row.course_code,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      score: row.score,
      attempts: row.attempts,
      certificateNumber: row.certificate_number,
      expirationDate: row.expiration_date,
      verifiedBy: row.verified_by,
      verifiedByName: row.verified_by_name,
      verifiedAt: row.verified_at,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return { success: true, data: records };

  } catch (error: any) {
    logger.error('Error getting user training records', { error: error.message, userId });
    return { success: false, message: error.message };
  }
};

/**
 * Start training for a course
 */
export const startTraining = async (
  userId: number,
  courseId: number
): Promise<ApiResponse<TrainingRecord>> => {
  logger.info('Starting training', { userId, courseId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if record exists
    const existingQuery = `
      SELECT id, status FROM training_records
      WHERE user_id = $1 AND course_id = $2
    `;
    const existing = await client.query(existingQuery, [userId, courseId]);

    let recordId: number;

    if (existing.rows.length > 0) {
      // Update existing record
      const updateQuery = `
        UPDATE training_records
        SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `;
      const updateResult = await client.query(updateQuery, [existing.rows[0].id]);
      recordId = updateResult.rows[0].id;
    } else {
      // Create new record
      const insertQuery = `
        INSERT INTO training_records (user_id, course_id, status, started_at, created_at, updated_at)
        VALUES ($1, $2, 'in_progress', NOW(), NOW(), NOW())
        RETURNING id
      `;
      const insertResult = await client.query(insertQuery, [userId, courseId]);
      recordId = insertResult.rows[0].id;
    }

    await client.query('COMMIT');

    // Fetch the updated record
    const recordResult = await getUserTrainingRecords(userId);
    const record = recordResult.data?.find(r => r.id === recordId);

    return { success: true, data: record };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error starting training', { error: error.message, userId, courseId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Submit quiz answers and complete training
 */
export const submitQuiz = async (
  userId: number,
  courseId: number,
  answers: { questionId: number; selectedOptions: number[] }[]
): Promise<ApiResponse<{ passed: boolean; score: number; certificateNumber?: string }>> => {
  logger.info('Submitting quiz', { userId, courseId, answerCount: answers.length });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get course passing score and questions
    const courseQuery = `
      SELECT passing_score FROM training_courses WHERE id = $1
    `;
    const courseResult = await client.query(courseQuery, [courseId]);
    
    if (courseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Course not found' };
    }

    const passingScore = courseResult.rows[0].passing_score;

    // Get correct answers
    const questionsQuery = `
      SELECT id, options FROM training_quiz_questions
      WHERE course_id = $1 AND active = true
    `;
    const questionsResult = await client.query(questionsQuery, [courseId]);

    // Calculate score
    let correctCount = 0;
    const gradedAnswers = answers.map(answer => {
      const question = questionsResult.rows.find(q => q.id === answer.questionId);
      if (!question) return { ...answer, correct: false };

      const correctOptions = question.options
        .map((opt: any, idx: number) => opt.isCorrect ? idx : -1)
        .filter((idx: number) => idx >= 0);

      const isCorrect = 
        answer.selectedOptions.length === correctOptions.length &&
        answer.selectedOptions.every(opt => correctOptions.includes(opt));

      if (isCorrect) correctCount++;

      return { ...answer, correct: isCorrect };
    });

    const score = Math.round((correctCount / questionsResult.rows.length) * 100);
    const passed = score >= passingScore;

    // Get current attempt count
    const recordQuery = `
      SELECT id, attempts FROM training_records
      WHERE user_id = $1 AND course_id = $2
    `;
    const recordResult = await client.query(recordQuery, [userId, courseId]);
    
    if (recordResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Training record not found. Start training first.' };
    }

    const recordId = recordResult.rows[0].id;
    const attemptNumber = (recordResult.rows[0].attempts || 0) + 1;

    // Record quiz attempt
    const attemptQuery = `
      INSERT INTO training_quiz_attempts (
        user_id, course_id, attempt_number, started_at, completed_at,
        answers, score, passed, created_at
      ) VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, NOW())
      RETURNING id
    `;
    await client.query(attemptQuery, [
      userId, courseId, attemptNumber,
      JSON.stringify(gradedAnswers), score, passed
    ]);

    // Update training record
    let certificateNumber: string | undefined;
    
    if (passed) {
      certificateNumber = `CERT-${courseId}-${userId}-${Date.now()}`;
      
      // Calculate expiration (1 year from completion for most courses)
      const expirationQuery = `
        UPDATE training_records
        SET status = 'completed',
            completed_at = NOW(),
            score = $1,
            attempts = $2,
            certificate_number = $3,
            expiration_date = NOW() + INTERVAL '1 year',
            updated_at = NOW()
        WHERE id = $4
      `;
      await client.query(expirationQuery, [score, attemptNumber, certificateNumber, recordId]);
    } else {
      // Update attempt count only
      const updateQuery = `
        UPDATE training_records
        SET attempts = $1, score = GREATEST(COALESCE(score, 0), $2), updated_at = NOW()
        WHERE id = $3
      `;
      await client.query(updateQuery, [attemptNumber, score, recordId]);
    }

    await client.query('COMMIT');

    return {
      success: true,
      data: { passed, score, certificateNumber }
    };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Error submitting quiz', { error: error.message, userId, courseId });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Verify training completion (supervisor verification)
 */
export const verifyTrainingCompletion = async (
  recordId: number,
  verifierId: number,
  notes?: string
): Promise<ApiResponse<{ verified: boolean }>> => {
  logger.info('Verifying training completion', { recordId, verifierId });

  try {
    const query = `
      UPDATE training_records
      SET verified_by = $1, verified_at = NOW(), notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $3 AND status = 'completed'
      RETURNING id
    `;

    const result = await pool.query(query, [verifierId, notes, recordId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Training record not found or not completed' };
    }

    return { success: true, data: { verified: true } };

  } catch (error: any) {
    logger.error('Error verifying training', { error: error.message, recordId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// Compliance Reporting
// ============================================================================

/**
 * Get training compliance status for all users or specific user
 */
export const getTrainingComplianceStatus = async (
  options: { userId?: number; studyId?: number } = {}
): Promise<ApiResponse<TrainingComplianceStatus[]>> => {
  logger.info('Getting training compliance status', options);

  try {
    // Get users with their roles
    let usersQuery = `
      SELECT DISTINCT
        ua.user_id,
        ua.user_name,
        ua.first_name || ' ' || ua.last_name as full_name,
        sur.role_name
      FROM user_account ua
      LEFT JOIN study_user_role sur ON ua.user_name = sur.user_name AND sur.status_id = 1
      WHERE ua.status_id = 1
    `;
    const userParams: any[] = [];

    if (options.userId) {
      userParams.push(options.userId);
      usersQuery += ` AND ua.user_id = $${userParams.length}`;
    }

    if (options.studyId) {
      userParams.push(options.studyId);
      usersQuery += ` AND sur.study_id = $${userParams.length}`;
    }

    const usersResult = await pool.query(usersQuery, userParams);

    // Get all active courses with role requirements
    const coursesResult = await pool.query(`
      SELECT id, course_code, course_name, required_for_roles, regulatory_reference
      FROM training_courses WHERE active = true
    `);

    const complianceStatuses: TrainingComplianceStatus[] = [];

    for (const user of usersResult.rows) {
      // Find courses required for this user's role
      const requiredCourses = coursesResult.rows.filter(course => {
        if (!course.required_for_roles || course.required_for_roles.length === 0) {
          return false;
        }
        return course.required_for_roles.some((role: string) => 
          user.role_name?.toLowerCase().includes(role.toLowerCase())
        );
      });

      // Get user's training records
      const recordsQuery = `
        SELECT course_id, status, expiration_date
        FROM training_records
        WHERE user_id = $1
      `;
      const recordsResult = await pool.query(recordsQuery, [user.user_id]);
      const records = new Map(recordsResult.rows.map(r => [r.course_id, r]));

      let completed = 0;
      let expired = 0;
      const missingCourses: { courseCode: string; courseName: string; requiredBy: string }[] = [];

      for (const course of requiredCourses) {
        const record = records.get(course.id);
        
        if (!record || record.status === 'not_started') {
          missingCourses.push({
            courseCode: course.course_code,
            courseName: course.course_name,
            requiredBy: course.regulatory_reference || 'Policy'
          });
        } else if (record.status === 'completed') {
          if (record.expiration_date && new Date(record.expiration_date) < new Date()) {
            expired++;
            missingCourses.push({
              courseCode: course.course_code,
              courseName: course.course_name + ' (EXPIRED)',
              requiredBy: course.regulatory_reference || 'Policy'
            });
          } else {
            completed++;
          }
        } else if (record.status === 'expired') {
          expired++;
          missingCourses.push({
            courseCode: course.course_code,
            courseName: course.course_name + ' (EXPIRED)',
            requiredBy: course.regulatory_reference || 'Policy'
          });
        }
      }

      const totalRequired = requiredCourses.length;
      const pending = totalRequired - completed - expired;
      const compliancePercentage = totalRequired > 0 
        ? Math.round((completed / totalRequired) * 100) 
        : 100;

      complianceStatuses.push({
        userId: user.user_id,
        username: user.user_name,
        userFullName: user.full_name,
        role: user.role_name || 'No Role',
        totalRequired,
        completed,
        expired,
        pending,
        compliancePercentage,
        isCompliant: missingCourses.length === 0,
        missingCourses
      });
    }

    return { success: true, data: complianceStatuses };

  } catch (error: any) {
    logger.error('Error getting compliance status', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get expiring training records (within next 30 days)
 */
export const getExpiringTraining = async (
  daysAhead: number = 30
): Promise<ApiResponse<TrainingRecord[]>> => {
  logger.info('Getting expiring training', { daysAhead });

  try {
    const query = `
      SELECT 
        tr.id, tr.user_id, tr.course_id, tr.status,
        tr.started_at, tr.completed_at, tr.score, tr.attempts,
        tr.certificate_number, tr.expiration_date,
        tr.verified_by, tr.verified_at, tr.notes,
        tr.created_at, tr.updated_at,
        tc.course_name, tc.course_code,
        ua.user_name, ua.first_name || ' ' || ua.last_name as user_full_name
      FROM training_records tr
      INNER JOIN training_courses tc ON tr.course_id = tc.id
      INNER JOIN user_account ua ON tr.user_id = ua.user_id
      WHERE tr.status = 'completed'
        AND tr.expiration_date IS NOT NULL
        AND tr.expiration_date <= NOW() + INTERVAL '${daysAhead} days'
        AND tr.expiration_date > NOW()
      ORDER BY tr.expiration_date ASC
    `;

    const result = await pool.query(query);

    const records: (TrainingRecord & { userName?: string; userFullName?: string })[] = 
      result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        courseId: row.course_id,
        courseName: row.course_name,
        courseCode: row.course_code,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        score: row.score,
        attempts: row.attempts,
        certificateNumber: row.certificate_number,
        expirationDate: row.expiration_date,
        verifiedBy: row.verified_by,
        verifiedAt: row.verified_at,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        userName: row.user_name,
        userFullName: row.user_full_name
      }));

    return { success: true, data: records };

  } catch (error: any) {
    logger.error('Error getting expiring training', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Update expired training records (run periodically)
 */
export const updateExpiredTraining = async (): Promise<{ updated: number }> => {
  logger.info('Updating expired training records');

  try {
    const query = `
      UPDATE training_records
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'completed'
        AND expiration_date IS NOT NULL
        AND expiration_date < NOW()
      RETURNING id
    `;

    const result = await pool.query(query);

    logger.info('Updated expired training records', { count: result.rowCount });

    return { updated: result.rowCount || 0 };

  } catch (error: any) {
    logger.error('Error updating expired training', { error: error.message });
    return { updated: 0 };
  }
};

