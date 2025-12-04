/**
 * Electronic Signature Controller
 * 
 * Implements 21 CFR Part 11 compliant electronic signature functionality
 * 
 * Key compliance requirements:
 * - §11.10(e) - Use of audit trails
 * - §11.50 - Signature manifestations
 * - §11.100 - General requirements for electronic signatures
 * - §11.200 - Electronic signature components and controls
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as esignatureService from '../services/database/esignature.service';
import { logger } from '../config/logger';

/**
 * Verify user's password for electronic signature
 * 21 CFR Part 11 §11.200(a)(1) - Two distinct identification components
 */
export const verifyPassword = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { password } = req.body;

  if (!password) {
    res.status(400).json({
      success: false,
      message: 'Password is required for electronic signature verification'
    });
    return;
  }

  const result = await esignatureService.verifyPasswordForSignature(
    user.userId,
    user.username,
    password
  );

  // Log verification attempt (success or failure) for audit trail
  logger.info('E-signature password verification attempt', {
    userId: user.userId,
    username: user.username,
    success: result.success,
    timestamp: new Date().toISOString()
  });

  res.json(result);
});

/**
 * Apply electronic signature to an entity
 * 21 CFR Part 11 §11.50 - Signature manifestations
 */
export const applySignature = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const {
    entityType,
    entityId,
    password,
    meaning,
    reasonForSigning
  } = req.body;

  // Validate required fields
  if (!entityType || !entityId || !password || !meaning) {
    res.status(400).json({
      success: false,
      message: 'entityType, entityId, password, and meaning are required'
    });
    return;
  }

  // Validate entity type
  const validEntityTypes = ['event_crf', 'study_event', 'study_subject', 'discrepancy_note', 'data_lock'];
  if (!validEntityTypes.includes(entityType)) {
    res.status(400).json({
      success: false,
      message: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}`
    });
    return;
  }

  // Validate meaning (21 CFR Part 11 §11.50)
  const validMeanings = [
    'authorship',           // I am the author of this data
    'approval',             // I approve this data
    'responsibility',       // I take responsibility for this data
    'review',               // I have reviewed this data
    'verification',         // I verify this data against source documents
    'acknowledgment'        // I acknowledge this information
  ];
  
  if (!validMeanings.includes(meaning)) {
    res.status(400).json({
      success: false,
      message: `Invalid meaning. Must be one of: ${validMeanings.join(', ')}`
    });
    return;
  }

  const result = await esignatureService.applyElectronicSignature({
    userId: user.userId,
    username: user.username,
    userFullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
    entityType,
    entityId: parseInt(entityId),
    password,
    meaning,
    reasonForSigning: reasonForSigning || `Electronic signature: ${meaning}`
  });

  if (result.success) {
    logger.info('Electronic signature applied', {
      userId: user.userId,
      username: user.username,
      entityType,
      entityId,
      meaning,
      signatureId: result.data?.signatureId,
      timestamp: new Date().toISOString()
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * Get signature status for an entity
 */
export const getSignatureStatus = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId } = req.params;

  if (!entityType || !entityId) {
    res.status(400).json({
      success: false,
      message: 'entityType and entityId are required'
    });
    return;
  }

  const result = await esignatureService.getSignatureStatus(
    entityType,
    parseInt(entityId)
  );

  res.json(result);
});

/**
 * Get signature history for an entity
 */
export const getSignatureHistory = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId } = req.params;

  if (!entityType || !entityId) {
    res.status(400).json({
      success: false,
      message: 'entityType and entityId are required'
    });
    return;
  }

  const result = await esignatureService.getSignatureHistory(
    entityType,
    parseInt(entityId)
  );

  res.json(result);
});

/**
 * Get pending signatures for current user
 */
export const getPendingSignatures = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { studyId } = req.query;

  const result = await esignatureService.getPendingSignatures(
    user.userId,
    studyId ? parseInt(studyId as string) : undefined
  );

  res.json(result);
});

/**
 * User certification that electronic signature is legally binding
 * 21 CFR Part 11 §11.100(c)
 */
export const certifySignature = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { password, acknowledgment } = req.body;

  // Required acknowledgment text per 21 CFR Part 11 §11.100(c)
  const requiredAcknowledgment = 'I certify that my electronic signature is the legally binding equivalent of my traditional handwritten signature';

  if (!password || !acknowledgment) {
    res.status(400).json({
      success: false,
      message: 'Password and acknowledgment are required'
    });
    return;
  }

  if (acknowledgment !== requiredAcknowledgment) {
    res.status(400).json({
      success: false,
      message: 'Acknowledgment text must match the required certification statement'
    });
    return;
  }

  const result = await esignatureService.certifyUser(
    user.userId,
    user.username,
    password,
    acknowledgment
  );

  res.json(result);
});

/**
 * Get e-signature requirements for a study
 * Returns which forms/events require electronic signatures
 */
export const getStudyRequirements = asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;

  if (!studyId) {
    res.status(400).json({
      success: false,
      message: 'studyId is required'
    });
    return;
  }

  const result = await esignatureService.getStudySignatureRequirements(
    parseInt(studyId)
  );

  res.json(result);
});

export default {
  verifyPassword,
  applySignature,
  getSignatureStatus,
  getSignatureHistory,
  getPendingSignatures,
  certifySignature,
  getStudyRequirements
};

