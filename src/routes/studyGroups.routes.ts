/**
 * Study Groups Routes
 * 
 * API endpoints for managing study group classes and subject group assignments.
 * Used for randomization, treatment arms, demographics grouping, etc.
 */

import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as studyGroupsService from '../services/database/studyGroups.service';
import { logger } from '../config/logger';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/study-groups/class-types
 * Get available group class types (Arm, Family/Pedigree, Demographic, Other)
 */
router.get('/class-types', async (req: Request, res: Response) => {
  try {
    const types = await studyGroupsService.getGroupClassTypes();
    res.json({ success: true, data: types });
  } catch (error: any) {
    logger.error('Failed to get group class types', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-groups/study/:studyId
 * Get all group classes and their groups for a study
 */
router.get('/study/:studyId', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    const groupClasses = await studyGroupsService.getStudyGroupClasses(studyId);
    res.json({ success: true, data: groupClasses });
  } catch (error: any) {
    logger.error('Failed to get study group classes', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/study-groups/class
 * Create a new study group class (admin/coordinator only)
 */
router.post('/class', requireRole('admin', 'data_manager'), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { studyId, name, groupClassTypeId, subjectAssignment } = req.body;
    
    if (!studyId || !name || !groupClassTypeId) {
      res.status(400).json({ 
        success: false, 
        message: 'studyId, name, and groupClassTypeId are required' 
      });
      return;
    }

    const result = await studyGroupsService.createStudyGroupClass({
      studyId: parseInt(studyId),
      name,
      groupClassTypeId: parseInt(groupClassTypeId),
      subjectAssignment: subjectAssignment || 'Optional'
    }, user.userId);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Failed to create study group class', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/study-groups/group
 * Create a new group within a class (admin/coordinator only)
 */
router.post('/group', requireRole('admin', 'data_manager'), async (req: Request, res: Response) => {
  try {
    const { studyGroupClassId, name, description } = req.body;
    
    if (!studyGroupClassId || !name) {
      res.status(400).json({ 
        success: false, 
        message: 'studyGroupClassId and name are required' 
      });
      return;
    }

    const result = await studyGroupsService.createStudyGroup({
      studyGroupClassId: parseInt(studyGroupClassId),
      name,
      description
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Failed to create study group', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-groups/subject/:studySubjectId
 * Get group assignments for a subject
 */
router.get('/subject/:studySubjectId', async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    
    if (isNaN(studySubjectId)) {
      res.status(400).json({ success: false, message: 'Invalid study subject ID' });
      return;
    }

    const assignments = await studyGroupsService.getSubjectGroupAssignments(studySubjectId);
    res.json({ success: true, data: assignments });
  } catch (error: any) {
    logger.error('Failed to get subject group assignments', { 
      studySubjectId: req.params.studySubjectId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/study-groups/subject/:studySubjectId/assign
 * Assign a subject to groups
 */
router.post('/subject/:studySubjectId/assign', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const studySubjectId = parseInt(req.params.studySubjectId);
    const { assignments } = req.body;
    
    if (isNaN(studySubjectId)) {
      res.status(400).json({ success: false, message: 'Invalid study subject ID' });
      return;
    }

    if (!assignments || !Array.isArray(assignments)) {
      res.status(400).json({ 
        success: false, 
        message: 'assignments array is required' 
      });
      return;
    }

    const result = await studyGroupsService.assignSubjectToGroups(
      studySubjectId,
      assignments,
      user.userId
    );

    if (result.success) {
      // Return updated assignments
      const updatedAssignments = await studyGroupsService.getSubjectGroupAssignments(studySubjectId);
      res.json({ success: true, data: updatedAssignments });
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Failed to assign subject to groups', { 
      studySubjectId: req.params.studySubjectId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-groups/group/:studyGroupId/subjects
 * Get all subjects in a group
 */
router.get('/group/:studyGroupId/subjects', async (req: Request, res: Response) => {
  try {
    const studyGroupId = parseInt(req.params.studyGroupId);
    
    if (isNaN(studyGroupId)) {
      res.status(400).json({ success: false, message: 'Invalid study group ID' });
      return;
    }

    const subjects = await studyGroupsService.getSubjectsInGroup(studyGroupId);
    res.json({ success: true, data: subjects });
  } catch (error: any) {
    logger.error('Failed to get subjects in group', { 
      studyGroupId: req.params.studyGroupId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

