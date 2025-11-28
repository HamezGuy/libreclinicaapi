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

// List and query
router.get('/', validate({ query: auditSchemas.query }), controller.get);
router.get('/recent', controller.getRecent);
router.get('/stats', controller.getStats);
router.get('/summary', controller.getSummary);

// Metadata
router.get('/event-types', controller.getEventTypes);
router.get('/tables', controller.getTables);

// Entity-specific audit
router.get('/subject/:id', validate({ params: commonSchemas.idParam }), controller.getSubjectAudit);
router.get('/form/:eventCrfId', controller.getFormAudit);

// Reports and exports
router.get('/export', requireRole('admin', 'monitor'), auditExportRateLimiter, validate({ query: auditSchemas.export }), controller.exportCsv);
router.get('/compliance-report', requireRole('admin', 'monitor'), controller.getComplianceReport);

export default router;

