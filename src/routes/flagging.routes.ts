/**
 * CRF/Item Flagging Routes
 * 
 * Uses LibreClinica native tables: event_crf_flag, item_data_flag
 * Allows monitors and coordinators to flag CRFs and individual items
 * for data review.
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, flaggingSchemas } from '../middleware/validation.middleware';
import * as flaggingController from '../controllers/flagging.controller';

const router = Router();

router.use(authMiddleware);

router.get('/crfs/:eventCrfId', flaggingController.getCrfFlags);

router.post(
  '/crfs/:eventCrfId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: flaggingSchemas.flagCrf }),
  flaggingController.flagCrf,
);

router.get('/items/:itemDataId', flaggingController.getItemFlags);

router.post(
  '/items/:itemDataId',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: flaggingSchemas.flagItem }),
  flaggingController.flagItem,
);

export default router;
