/**
 * Randomization Routes
 * 
 * Provides endpoints for clinical trial randomization using a proper
 * server-side randomization engine with sealed lists.
 * 
 * 21 CFR Part 11 Compliance:
 * - Randomization requires electronic signature (§11.50)
 * - Unblinding requires electronic signature (§11.50) 
 * - All changes are logged to audit trail (§11.10(e))
 * - Sealed lists maintain allocation concealment (§11.10(d))
 * 
 * Endpoints:
 *   Configuration:
 *     GET    /api/randomization/config/:studyId       - Get config for study
 *     POST   /api/randomization/config                - Create config
 *     PUT    /api/randomization/config/:configId       - Update config (if not locked)
 *     POST   /api/randomization/config/:configId/generate  - Generate sealed list
 *     POST   /api/randomization/config/:configId/activate  - Activate scheme
 *     POST   /api/randomization/config/:configId/test      - Test/preview scheme
 *     GET    /api/randomization/config/:configId/stats     - List usage stats
 * 
 *   Randomization Actions:
 *     POST   /api/randomization/randomize             - Randomize a subject (server-assigned)
 *     GET    /api/randomization/                      - List randomizations
 *     GET    /api/randomization/stats                 - Stats
 *     GET    /api/randomization/groups/:studyId       - Get treatment groups
 * 
 *   Subject:
 *     GET    /api/randomization/subject/:subjectId    - Get subject randomization
 *     GET    /api/randomization/subject/:subjectId/can-randomize - Eligibility check
 *     POST   /api/randomization/subject/:subjectId/unblind      - Emergency unblind
 *     DELETE /api/randomization/subject/:subjectId    - Remove (admin only)
 * 
 *   Other:
 *     GET    /api/randomization/unblinding-events     - Unblinding audit log
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor } from '../middleware/part11.middleware';
import * as randomizationController from '../controllers/randomization.controller';

const router = express.Router();

router.use(authMiddleware);

// ============================================================================
// CONFIGURATION ENDPOINTS (admin/study builder)
// ============================================================================

// Get config for a study
router.get('/config/:studyId', randomizationController.getConfig);

// Create a new config
router.post('/config',
  requireRole('investigator', 'admin'),
  randomizationController.createConfig
);

// Update config (only if not locked)
router.put('/config/:configId',
  requireRole('investigator', 'admin'),
  randomizationController.updateConfig
);

// Generate the sealed randomization list
router.post('/config/:configId/generate',
  requireRole('admin'),
  requireSignatureFor('I authorize generation of the sealed randomization list'),
  randomizationController.generateList
);

// Activate the scheme (locks it permanently)
router.post('/config/:configId/activate',
  requireRole('admin'),
  requireSignatureFor('I confirm this randomization scheme is correct and authorize its activation'),
  randomizationController.activateConfig
);

// Test/preview a configuration (does not save)
router.post('/config/:configId/test',
  requireRole('investigator', 'admin'),
  randomizationController.testConfig
);

// Get list usage statistics
router.get('/config/:configId/stats',
  randomizationController.getListStats
);

// ============================================================================
// RANDOMIZATION ACTIONS
// ============================================================================

// List existing randomizations (read-only)
router.get('/', randomizationController.list);

// Get stats
router.get('/stats', randomizationController.getStats);

// Get treatment groups for a study
router.get('/groups/:studyId', randomizationController.getGroups);

// CORE: Randomize a subject (server-side assignment from sealed list)
router.post('/randomize',
  requireRole('investigator', 'coordinator', 'admin'),
  requireSignatureFor('I confirm this subject meets all eligibility criteria for randomization'),
  randomizationController.randomize
);

// Legacy endpoint: manual randomization (kept for backward compatibility)
router.post('/',
  requireRole('investigator', 'coordinator', 'admin'),
  requireSignatureFor('I confirm this subject meets randomization criteria'),
  randomizationController.create
);

// ============================================================================
// SUBJECT-SPECIFIC
// ============================================================================

router.get('/subject/:subjectId', randomizationController.getSubjectRandomization);
router.get('/subject/:subjectId/can-randomize', randomizationController.canRandomize);

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

// ============================================================================
// UNBLINDING LOG
// ============================================================================

router.get('/unblinding-events', randomizationController.getUnblindingEvents);

export default router;
