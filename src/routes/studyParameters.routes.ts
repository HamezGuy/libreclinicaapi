/**
 * Study Parameters Routes
 * 
 * API endpoints for managing study configuration parameters.
 * These control enrollment behavior, subject ID generation, etc.
 */

import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as studyParamsService from '../services/database/studyParameters.service';
import { logger } from '../config/logger';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/study-parameters/available
 * Get all available study parameter definitions (reference data)
 */
router.get('/available', async (req: Request, res: Response) => {
  try {
    const parameters = await studyParamsService.getAvailableParameters();
    res.json({ success: true, data: parameters });
  } catch (error: any) {
    logger.error('Failed to get available parameters', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-parameters/:studyId
 * Get study parameters for a specific study
 */
router.get('/:studyId', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    const config = await studyParamsService.getStudyParameters(studyId);
    res.json({ success: true, data: config });
  } catch (error: any) {
    logger.error('Failed to get study parameters', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-parameters/:studyId/raw
 * Get raw parameter values for editing
 */
router.get('/:studyId/raw', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    const params = await studyParamsService.getRawStudyParameters(studyId);
    res.json({ success: true, data: params });
  } catch (error: any) {
    logger.error('Failed to get raw study parameters', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/study-parameters/:studyId
 * Update study parameters (admin/coordinator only)
 */
router.put('/:studyId', requireRole('admin', 'coordinator'), async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const user = (req as any).user;
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    const parameters = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      res.status(400).json({ success: false, message: 'Parameters object required' });
      return;
    }

    await studyParamsService.saveStudyParameters(studyId, parameters, user.userId);
    
    // Return the updated config
    const updatedConfig = await studyParamsService.getStudyParameters(studyId);
    res.json({ success: true, data: updatedConfig, message: 'Parameters saved successfully' });
  } catch (error: any) {
    logger.error('Failed to save study parameters', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/study-parameters/:studyId/initialize
 * Initialize default parameters for a new study (admin only)
 */
router.post('/:studyId/initialize', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const user = (req as any).user;
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    await studyParamsService.initializeStudyParameters(studyId, user.userId);
    
    const config = await studyParamsService.getStudyParameters(studyId);
    res.json({ success: true, data: config, message: 'Parameters initialized' });
  } catch (error: any) {
    logger.error('Failed to initialize study parameters', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/study-parameters/:studyId/next-subject-id
 * Generate next subject ID based on study settings
 */
router.get('/:studyId/next-subject-id', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    
    if (isNaN(studyId)) {
      res.status(400).json({ success: false, message: 'Invalid study ID' });
      return;
    }

    const nextId = await studyParamsService.generateNextSubjectId(studyId);
    res.json({ success: true, data: { nextSubjectId: nextId } });
  } catch (error: any) {
    logger.error('Failed to generate next subject ID', { 
      studyId: req.params.studyId, 
      error: error.message 
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

