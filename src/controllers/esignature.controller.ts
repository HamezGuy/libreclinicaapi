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
import type { ApiResponse, SignatureRequest, SignatureRecord } from '@accura-trial/shared-types';

/**
 * Verify user's password for electronic signature
 * 21 CFR Part 11 §11.200(a)(1) - Two distinct identification components
 */
export const verifyPassword = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { password, username } = req.body;

  if (!username || !password) {
    res.status(400).json({
      success: false,
      message: 'Both username and password are required for electronic signature verification (§11.200(a)(1))'
    });
    return;
  }

  const jwtUsername = user.userName || user.username;
  if (username !== jwtUsername) {
    res.status(403).json({
      success: false,
      message: 'Username does not match authenticated session. Electronic signatures must be executed by their genuine owner (§11.200(a)(2)).'
    });
    return;
  }

  const result = await esignatureService.verifyPasswordForSignature(
    user.userId,
    username,
    password
  );

  logger.info('E-signature password verification attempt', {
    userId: user.userId,
    username,
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
    username,
    password,
    meaning,
    reasonForSigning
  } = req.body;

  if (!entityType || entityId === undefined || entityId === null || !password || !meaning || !username) {
    res.status(400).json({
      success: false,
      message: 'entityType, entityId, username, password, and meaning are required (§11.200(a)(1))'
    });
    return;
  }

  const jwtUsername = user.userName || user.username;
  if (username !== jwtUsername) {
    res.status(403).json({
      success: false,
      message: 'Username does not match authenticated session. Electronic signatures must be executed by their genuine owner (§11.200(a)(2)).'
    });
    return;
  }

  const validEntityTypes = [
    'event_crf', 'study_event', 'study_subject', 'discrepancy_note', 'data_lock', 'consent', 'study',
    'eventCrf', 'studyEvent', 'studySubject', 'discrepancyNote', 'dataLock',
    'validationRule', 'validationRuleBatch', 'validation_rule', 'validation_rule_batch'
  ];
  if (!validEntityTypes.includes(entityType)) {
    res.status(400).json({
      success: false,
      message: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}`
    });
    return;
  }

  const validMeanings = [
    'authorship',
    'approval',
    'responsibility',
    'review',
    'verification',
    'acknowledgment',
    'rule_authorship',
    'rule_modification',
    'rule_retirement',
    'rule_batch_authorship'
  ];
  
  if (!validMeanings.includes(meaning)) {
    res.status(400).json({
      success: false,
      message: `Invalid meaning. Must be one of: ${validMeanings.join(', ')}`
    });
    return;
  }

  const certStatus = await esignatureService.getCertificationStatus(user.userId);
  if (!certStatus.data?.isCertified) {
    res.status(403).json({
      success: false,
      code: 'CERTIFICATION_REQUIRED',
      message: 'You must certify that your electronic signature is the legally binding equivalent of a handwritten signature before signing (§11.100(c)). Use POST /api/esignature/certify first.'
    });
    return;
  }

  const result = await esignatureService.applyElectronicSignature({
    userId: user.userId,
    username,
    userFullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || username,
    entityType,
    entityId: parseInt(entityId),
    password,
    meaning,
    reasonForSigning: reasonForSigning || `Electronic signature: ${meaning}`
  });

  if (result.success) {
    logger.info('Electronic signature applied', {
      userId: user.userId,
      username,
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

  const result: ApiResponse<SignatureRecord> = await esignatureService.getSignatureStatus(
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

  const result: ApiResponse<SignatureRecord[]> = await esignatureService.getSignatureHistory(
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
  const { username, password, acknowledgment } = req.body;

  const requiredAcknowledgment = 'I certify that my electronic signature is the legally binding equivalent of my traditional handwritten signature';

  if (!username || !password || !acknowledgment) {
    res.status(400).json({
      success: false,
      message: 'Username, password, and acknowledgment are required (§11.100(c), §11.200(a)(1))'
    });
    return;
  }

  const jwtUsername = user.userName || user.username;
  if (username !== jwtUsername) {
    res.status(403).json({
      success: false,
      message: 'Username does not match authenticated session. Certification must be performed by the account owner (§11.200(a)(2)).'
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
    username,
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

/**
 * Invalidate a signature when the signed record is modified
 * 21 CFR Part 11 §11.70 - Signature/record linking
 */
export const invalidateSignature = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { entityType, entityId, reason } = req.body;

  if (!entityType || !entityId) {
    res.status(400).json({
      success: false,
      message: 'entityType and entityId are required'
    });
    return;
  }

  const resolvedReason = reason || 'Record modified (auto-invalidation)';

  const result = await esignatureService.invalidateSignature(
    entityType,
    parseInt(entityId),
    resolvedReason,
    user.userName || user.username
  );

  if (result.success) {
    logger.info('Signature invalidated', {
      userId: user.userId,
      entityType,
      entityId,
      reason: resolvedReason,
      timestamp: new Date().toISOString()
    });
  }

  res.json(result);
});

/**
 * Get certification status for current user
 * 21 CFR Part 11 §11.100(c)
 */
export const getCertificationStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;

  const result = await esignatureService.getCertificationStatus(user.userId);

  res.json(result);
});

/**
 * Log a failed signature attempt from the frontend
 * 21 CFR Part 11 §11.10(e) - Audit trail for failed attempts
 */
export const logFailedAttempt = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId, username, reason, userAgent, timestamp } = req.body;

  // Prefer authenticated user's real username to prevent spoofing
  // Rate limiting should be applied at the route level for this endpoint
  const effectiveUsername = (req as any).user?.userName || username;

  if (!entityType || !entityId || !effectiveUsername) {
    res.status(400).json({
      success: false,
      message: 'entityType, entityId, and username are required'
    });
    return;
  }

  const result: ApiResponse<SignatureRecord> = await esignatureService.logFailedSignatureAttempt(
    entityType,
    parseInt(entityId),
    effectiveUsername,
    reason || 'Unknown failure',
    userAgent,
    timestamp
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
  getStudyRequirements,
  invalidateSignature,
  getCertificationStatus,
  logFailedAttempt
};

