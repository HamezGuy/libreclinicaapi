/**
 * Audit Routes
 */

import express from 'express';
import * as controller from '../controllers/audit.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, auditSchemas, commonSchemas } from '../middleware/validation.middleware';
import { auditExportRateLimiter } from '../middleware/rateLimiter.middleware';

const router = express.Router();

router.use(authMiddleware);

router.get('/', validate({ query: auditSchemas.query }), controller.get);
router.get('/export', requireRole('admin', 'monitor'), auditExportRateLimiter, validate({ query: auditSchemas.export }), controller.exportCsv);
router.get('/subject/:id', validate({ params: commonSchemas.idParam }), controller.getSubjectAudit);

export default router;

