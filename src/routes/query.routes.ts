/**
 * Query Routes
 * 
 * 21 CFR Part 11 Compliance:
 * - Query creation requires electronic signature (§11.50)
 * - Query responses require electronic signature (§11.50)
 * - Query closure requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express from 'express';
import * as controller from '../controllers/query.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, querySchemas, commonSchemas } from '../middleware/validation.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

router.use(authMiddleware);

// List and statistics (no signature required)
router.get('/', validate({ query: querySchemas.list }), controller.list);
router.get('/stats', controller.stats);
router.get('/types', controller.getQueryTypes);
router.get('/statuses', controller.getResolutionStatuses);
router.get('/count-by-status', controller.countByStatus);
router.get('/count-by-type', controller.countByType);
router.get('/overdue', controller.getOverdue);
router.get('/my-assigned', controller.getMyAssigned);

// Form-specific queries (no signature required for reading)
router.get('/form/:eventCrfId', controller.getFormQueries);

// Field-specific queries (no signature required for reading)
// Get queries for a specific item_data_id
router.get('/item-data/:itemDataId', controller.getFieldQueries);

// Get queries by form and field name
router.get('/form/:eventCrfId/field/:fieldName', controller.getQueriesByField);

// Get open query counts for all fields in a form (for efficient UI rendering)
router.get('/form/:eventCrfId/field-counts', controller.getFormFieldQueryCounts);

// Single query operations (no signature required for reading)
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/thread', controller.getThread);
router.get('/:id/audit-trail', controller.getAuditTrail);

// Create and update operations (signature required per §11.50)
router.post('/', 
  requireRole('admin', 'data_manager', 'coordinator', 'investigator', 'monitor'), 
  validate({ body: querySchemas.create }), 
  requireSignatureFor(SignatureMeanings.QUERY_CREATE),
  controller.create
);
router.post('/:id/respond', 
  validate({ params: commonSchemas.idParam, body: querySchemas.respond }), 
  requireSignatureFor(SignatureMeanings.QUERY_RESPOND),
  controller.respond
);
router.put('/:id/status', 
  requireRole('monitor', 'data_manager', 'admin'), 
  validate({ params: commonSchemas.idParam, body: querySchemas.updateStatus }), 
  requireSignatureFor(SignatureMeanings.QUERY_CLOSE),
  controller.updateStatus
);
router.put('/:id/reassign', 
  requireRole('data_manager', 'admin'), 
  requireSignatureFor(SignatureMeanings.AUTHORIZE),
  controller.reassign
);

// Close with electronic signature (21 CFR Part 11 compliant)
router.post('/:id/close-with-signature', 
  requireRole('monitor', 'data_manager', 'admin', 'investigator'), 
  requireSignatureFor(SignatureMeanings.QUERY_CLOSE),
  controller.closeWithSignature
);

// Reopen a closed query
router.put('/:id/reopen',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor('I authorize reopening this query'),
  controller.reopenQuery
);

// ═══════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════

// Bulk update status (e.g., mass close)
router.post('/bulk/status',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor(SignatureMeanings.QUERY_CLOSE),
  controller.bulkUpdateStatus
);

// Bulk close queries
router.post('/bulk/close',
  requireRole('monitor', 'data_manager', 'admin'),
  requireSignatureFor(SignatureMeanings.QUERY_CLOSE),
  controller.bulkClose
);

// Bulk reassign queries
router.post('/bulk/reassign',
  requireRole('data_manager', 'admin'),
  requireSignatureFor(SignatureMeanings.AUTHORIZE),
  controller.bulkReassign
);

export default router;

