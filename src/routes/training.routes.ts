/**
 * Training Routes
 * 
 * 21 CFR Part 11 §11.10(i) - Training Documentation
 * HIPAA §164.308(a)(5) - Security Awareness Training
 * 
 * API endpoints for managing training records and compliance
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  getCourses,
  getCourseById,
  getUserTrainingRecords,
  startTraining,
  submitQuiz,
  verifyTrainingCompletion,
  getTrainingComplianceStatus,
  getExpiringTraining,
  updateExpiredTraining
} from '../services/database/training.service';

const router = Router();

// ============================================================================
// Course Management
// ============================================================================

/**
 * @route GET /api/training/courses
 * @desc Get all training courses
 * @access Private
 */
router.get('/courses', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { activeOnly, role } = req.query;

    const result = await getCourses({
      activeOnly: activeOnly !== 'false',
      roleFilter: role as string
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting courses', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/training/courses/:id
 * @desc Get course by ID with optional quiz questions
 * @access Private
 */
router.get('/courses/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const courseId = parseInt(req.params.id, 10);
    const includeQuestions = req.query.includeQuestions === 'true';

    const result = await getCourseById(courseId, includeQuestions);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting course', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// User Training Records
// ============================================================================

/**
 * @route GET /api/training/my-records
 * @desc Get current user's training records
 * @access Private
 */
router.get('/my-records', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await getUserTrainingRecords(userId);

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting user training records', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/training/user/:userId/records
 * @desc Get training records for a specific user (admin only)
 * @access Private (Admin)
 */
router.get('/user/:userId/records', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    const result = await getUserTrainingRecords(userId);

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting user training records', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/training/start/:courseId
 * @desc Start training for a course
 * @access Private
 */
router.post('/start/:courseId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const courseId = parseInt(req.params.courseId, 10);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await startTraining(userId, courseId);

    res.json(result);
  } catch (error: any) {
    logger.error('Error starting training', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/training/submit-quiz/:courseId
 * @desc Submit quiz answers for a course
 * @access Private
 */
router.post('/submit-quiz/:courseId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const courseId = parseInt(req.params.courseId, 10);
    const { answers } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: 'Answers array required' });
    }

    const result = await submitQuiz(userId, courseId, answers);

    res.json(result);
  } catch (error: any) {
    logger.error('Error submitting quiz', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/training/verify/:recordId
 * @desc Verify training completion (supervisor verification)
 * @access Private (Admin/Supervisor)
 */
router.post('/verify/:recordId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const verifierId = authReq.user?.userId;
    const recordId = parseInt(req.params.recordId, 10);
    const { notes } = req.body;

    if (!verifierId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await verifyTrainingCompletion(recordId, verifierId, notes);

    res.json(result);
  } catch (error: any) {
    logger.error('Error verifying training', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================================
// Compliance Reporting
// ============================================================================

/**
 * @route GET /api/training/compliance
 * @desc Get training compliance status for all users
 * @access Private (Admin)
 */
router.get('/compliance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, studyId } = req.query;

    const result = await getTrainingComplianceStatus({
      userId: userId ? parseInt(userId as string, 10) : undefined,
      studyId: studyId ? parseInt(studyId as string, 10) : undefined
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting compliance status', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route GET /api/training/expiring
 * @desc Get training records expiring soon
 * @access Private (Admin)
 */
router.get('/expiring', authMiddleware, async (req: Request, res: Response) => {
  try {
    const daysAhead = parseInt(req.query.days as string, 10) || 30;

    const result = await getExpiringTraining(daysAhead);

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting expiring training', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route POST /api/training/update-expired
 * @desc Update expired training records (scheduled job)
 * @access Private (System/Admin)
 */
router.post('/update-expired', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await updateExpiredTraining();

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Error updating expired training', { error: error.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;

