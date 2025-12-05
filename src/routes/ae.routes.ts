/**
 * Adverse Event (AE/SAE) Routes
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance
 * AEs are CRF forms - imported via dataSoap.service
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as aeService from '../services/ae/adverse-event.service';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/ae/summary/:studyId
 * Get AE summary statistics for dashboard
 */
router.get('/summary/:studyId', asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);

  if (isNaN(studyId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid studyId'
    });
  }

  const summary = await aeService.getAESummary(studyId);

  res.json({
    success: true,
    data: summary
  });
}));

/**
 * GET /api/ae/subject/:studyId/:subjectId
 * Get AEs for a specific subject
 */
router.get('/subject/:studyId/:subjectId', asyncHandler(async (req: Request, res: Response) => {
  const studyId = parseInt(req.params.studyId);
  const subjectId = parseInt(req.params.subjectId);

  if (isNaN(studyId) || isNaN(subjectId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid studyId or subjectId'
    });
  }

  const aes = await aeService.getSubjectAEs(studyId, subjectId);

  res.json({
    success: true,
    data: aes
  });
}));

/**
 * POST /api/ae/report
 * Report a new Adverse Event via LibreClinica SOAP
 */
router.post('/report', asyncHandler(async (req: Request, res: Response) => {
  const { 
    studyOID, 
    subjectOID,
    aeTerm,
    meddraCode,
    onsetDate,
    resolutionDate,
    severity,
    isSerious,
    seriousnessCriteria,
    causalityAssessment,
    outcome,
    actionTaken,
    aeConfig
  } = req.body;

  const userId = (req as any).user?.userId || 1;
  const username = (req as any).user?.username || 'api';

  // Validation
  if (!studyOID || !subjectOID || !aeTerm || !onsetDate || !severity) {
    return res.status(400).json({
      success: false,
      message: 'Required fields: studyOID, subjectOID, aeTerm, onsetDate, severity'
    });
  }

  const validSeverities = ['Mild', 'Moderate', 'Severe'];
  if (!validSeverities.includes(severity)) {
    return res.status(400).json({
      success: false,
      message: `severity must be one of: ${validSeverities.join(', ')}`
    });
  }

  logger.info('AE report request', {
    studyOID,
    subjectOID,
    aeTerm,
    isSerious,
    username
  });

  const result = await aeService.reportAdverseEvent(
    studyOID,
    {
      subjectOID,
      aeTerm,
      meddraCode,
      onsetDate,
      resolutionDate,
      severity,
      isSerious: isSerious === true || isSerious === 'true',
      seriousnessCriteria,
      causalityAssessment,
      outcome,
      actionTaken
    },
    userId,
    username,
    aeConfig
  );

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.json(result);
}));

/**
 * GET /api/ae/config
 * Get default AE form configuration
 */
router.get('/config', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      defaultConfig: aeService.DEFAULT_AE_CONFIG,
      severityOptions: ['Mild', 'Moderate', 'Severe'],
      causalityOptions: ['Not Related', 'Unlikely', 'Possible', 'Probable', 'Definite'],
      outcomeOptions: ['Recovered', 'Recovering', 'Not Recovered', 'Recovered with Sequelae', 'Fatal', 'Unknown'],
      actionOptions: ['None', 'Dose Reduced', 'Drug Interrupted', 'Drug Withdrawn', 'Other']
    }
  });
}));

export default router;

