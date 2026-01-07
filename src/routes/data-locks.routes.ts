/**
 * Data Locks Routes
 * 
 * 21 CFR Part 11 Compliance:
 * - Locking/unlocking data requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';
import * as dataLocksController from '../controllers/data-locks.controller';

const router = express.Router();

router.use(authMiddleware);

router.get('/', dataLocksController.list);
router.post('/', 
  requireRole('monitor', 'coordinator', 'admin'), 
  requireSignatureFor(SignatureMeanings.FORM_LOCK),
  dataLocksController.lock
);
router.delete('/:eventCrfId', 
  requireRole('admin'), 
  requireSignatureFor('I authorize unlocking this form for editing'),
  dataLocksController.unlock
);

export default router;
