/**
 * Randomization Routes
 * 
 * 21 CFR Part 11 Compliance:
 * - Randomization requires electronic signature (§11.50)
 * - Unblinding requires electronic signature (§11.50) 
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor } from '../middleware/part11.middleware';
import * as randomizationController from '../controllers/randomization.controller';

const router = express.Router();

router.use(authMiddleware);

// List and statistics (no signature required)
router.get('/', randomizationController.list);
router.get('/stats', randomizationController.getStats);
router.get('/groups/:studyId', randomizationController.getGroups);
router.get('/unblinding-events', randomizationController.getUnblindingEvents);

// Subject-specific (no signature required for reading)
router.get('/subject/:subjectId', randomizationController.getSubjectRandomization);
router.get('/subject/:subjectId/can-randomize', randomizationController.canRandomize);

// Actions (signature required)
router.post('/', 
  requireRole('investigator', 'coordinator', 'admin'), 
  requireSignatureFor('I confirm this subject meets randomization criteria'),
  randomizationController.create
);
router.delete('/subject/:subjectId', 
  requireRole('admin'), 
  requireSignatureFor('I authorize removal of this randomization assignment'),
  randomizationController.remove
);
router.post('/subject/:subjectId/unblind', 
  requireRole('investigator', 'admin'), 
  requireSignatureFor('I authorize unblinding of treatment assignment for this subject'),
  randomizationController.unblind
);

export default router;
