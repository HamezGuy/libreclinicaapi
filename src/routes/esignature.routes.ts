/**
 * Electronic Signature Routes
 * 
 * 21 CFR Part 11 Compliant Electronic Signatures
 * 
 * §11.100 - General requirements:
 * (a) Each electronic signature shall be unique to one individual and shall not be reused
 * (b) Before establishing, assigning, certifying, or otherwise sanctioning electronic signatures,
 *     verify the identity of the individual
 * (c) Persons using electronic signatures shall, prior to or at the time of use, certify to the
 *     agency that the signatures are the legally binding equivalent of traditional handwritten signatures
 * 
 * §11.200 - Electronic signature components and controls:
 * (a)(1) Employ at least two distinct identification components such as identification code and password
 * (a)(2) Be used only by their genuine owners
 * (a)(3) Be administered and executed to ensure only the genuine owners can use them
 */

import express from 'express';
import * as controller from '../controllers/esignature.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';

const router = express.Router();

// All e-signature routes require authentication
router.use(authMiddleware);

/**
 * POST /api/esignature/verify-password
 * Verify user's password for e-signature (21 CFR Part 11 §11.200)
 * Used before applying electronic signature
 */
router.post('/verify-password', controller.verifyPassword);

/**
 * POST /api/esignature/sign
 * Apply electronic signature to an entity
 * Requires password re-entry per 21 CFR Part 11 §11.200
 */
router.post('/sign', controller.applySignature);

/**
 * GET /api/esignature/status/:entityType/:entityId
 * Get e-signature status for an entity
 */
router.get('/status/:entityType/:entityId', controller.getSignatureStatus);

/**
 * GET /api/esignature/history/:entityType/:entityId
 * Get signature history for an entity
 */
router.get('/history/:entityType/:entityId', controller.getSignatureHistory);

/**
 * GET /api/esignature/pending
 * Get all entities pending signature for current user
 */
router.get('/pending', controller.getPendingSignatures);

/**
 * POST /api/esignature/certify
 * User certification that e-signature is legally binding (21 CFR Part 11 §11.100(c))
 */
router.post('/certify', controller.certifySignature);

/**
 * GET /api/esignature/requirements/:studyId
 * Get e-signature requirements for a study (which forms require signatures)
 */
router.get('/requirements/:studyId', controller.getStudyRequirements);

/**
 * POST /api/esignature/invalidate
 * Invalidate a signature when the signed record is modified
 * 21 CFR Part 11 §11.70 - Signature/record linking
 */
router.post('/invalidate', controller.invalidateSignature);

/**
 * GET /api/esignature/certification-status
 * Check if current user has certified their e-signature
 * 21 CFR Part 11 §11.100(c)
 */
router.get('/certification-status', controller.getCertificationStatus);

/**
 * POST /api/esignature/audit/failed-attempt
 * Log a failed signature attempt from the frontend
 * 21 CFR Part 11 §11.10(e) - Audit trail
 */
router.post('/audit/failed-attempt', controller.logFailedAttempt);

export default router;

