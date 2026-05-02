/**
 * Query Routes
 * 
 * Role restrictions aligned with industry-standard EDC practices
 * (Medidata Rave, Oracle Clinical One, OpenClinica, Castor EDC):
 *
 *   RAISE queries:   Monitor, Data Manager, Admin
 *   RESPOND:         All clinical roles (CRC, Investigator, Monitor, DM, Admin, Viewer/Sponsor)
 *   CLOSE / ACCEPT:  Monitor, Data Manager, Admin  (site staff cannot self-close)
 *   RE-QUERY:        Monitor, Data Manager, Admin  (send answered query back for clarification)
 *
 * 21 CFR Part 11 Compliance:
 * - All changes are logged to audit trail (§11.10(e))
 * - Electronic signatures are NOT enforced on query operations for now
 */

import express from 'express';
import * as controller from '../controllers/query.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { validate, querySchemas, commonSchemas } from '../middleware/validation.middleware';
import { requirePart11 } from '../middleware/part11.middleware';
import { SIGNATURE_MEANINGS } from '@accura-trial/shared-types';

const router = express.Router();

router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
// READ OPERATIONS (no role restriction beyond auth)
// ═══════════════════════════════════════════════════════════════════

router.get('/', validate({ query: querySchemas.list }), controller.list);
router.get('/stats', controller.stats);
router.get('/types', controller.getQueryTypes);
router.get('/statuses', controller.getResolutionStatuses);
router.get('/count-by-status', controller.countByStatus);
router.get('/count-by-type', controller.countByType);
router.get('/overdue', controller.getOverdue);
router.get('/my-assigned', controller.getMyAssigned);
router.get('/subject-counts', controller.subjectCounts);
router.get('/subject/:studySubjectId/form-query-counts', controller.formQueryCountsBySubject);
router.get('/event/:studyEventId/form-query-status', controller.formQueryStatusByEvent);
router.get('/form/:eventCrfId', controller.getFormQueries);
router.get('/item-data/:itemDataId', controller.getFieldQueries);
router.get('/form/:eventCrfId/field/:fieldName', controller.getQueriesByField);
router.get('/form/:eventCrfId/field-counts', controller.getFormFieldQueryCounts);

// Preview who will receive a query before creating it (must be before /:id)
router.get('/resolve-recipients', controller.resolveRecipients);

router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);
router.get('/:id/thread', validate({ params: commonSchemas.idParam }), controller.getThread);
router.get('/:id/audit-trail', validate({ params: commonSchemas.idParam }), controller.getAuditTrail);

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS — role-restricted per EDC industry standards
// ═══════════════════════════════════════════════════════════════════

// Create query: all clinical roles can raise queries
router.post('/', 
  requireRole('admin', 'data_manager', 'monitor', 'coordinator', 'investigator'), 
  validate({ body: querySchemas.create }), 
  controller.create
);

// Respond to query: all clinical roles including Viewer/Sponsor
router.post('/:id/respond', 
  requireRole('admin', 'data_manager', 'coordinator', 'investigator', 'monitor', 'viewer'),
  validate({ params: commonSchemas.idParam, body: querySchemas.respond }), 
  controller.respond
);

// Update status: Monitor / DM / Admin only
router.put('/:id/status', 
  requireRole('monitor', 'data_manager', 'admin'), 
  validate({ params: commonSchemas.idParam, body: querySchemas.updateStatus }), 
  controller.updateStatus
);

// Reassign: Monitor / DM / Admin (monitors can reassign queries they raised)
router.put('/:id/reassign', 
  requireRole('data_manager', 'admin', 'monitor'),
  validate({ params: commonSchemas.idParam, body: querySchemas.reassign }),
  controller.reassign
);

// Close with e-signature: Monitor / DM / Admin only (PI cannot self-close)
router.post('/:id/close-with-signature', 
  requireRole('monitor', 'data_manager', 'admin'), 
  validate({ params: commonSchemas.idParam, body: querySchemas.closeWithSignature }),
  requirePart11({ meaning: SIGNATURE_MEANINGS.QUERY_CLOSE, required: true }),
  controller.closeWithSignature
);

// Accept resolution: Monitor / DM / Admin only (PI cannot self-approve corrections)
router.post('/:id/accept-resolution',
  requireRole('monitor', 'admin', 'data_manager'),
  validate({ params: commonSchemas.idParam, body: querySchemas.acceptResolution }),
  controller.acceptResolution
);

// Reject resolution: Monitor / DM / Admin only
router.post('/:id/reject-resolution',
  requireRole('monitor', 'admin', 'data_manager'),
  validate({ params: commonSchemas.idParam, body: querySchemas.rejectResolution }),
  controller.rejectResolution
);

// Re-query: send an answered query back for further clarification (Monitor / DM / Admin)
router.post('/:id/requery',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: commonSchemas.idParam, body: querySchemas.respond }),
  controller.requery
);

// Reopen a closed query
router.put('/:id/reopen',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ params: commonSchemas.idParam, body: querySchemas.reopen }),
  controller.reopenQuery
);

// ═══════════════════════════════════════════════════════════════════
// BULK OPERATIONS — Monitor / DM / Admin only
// ═══════════════════════════════════════════════════════════════════

router.post('/bulk/status',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: querySchemas.bulkStatus }),
  controller.bulkUpdateStatus
);

router.post('/bulk/close',
  requireRole('monitor', 'data_manager', 'admin'),
  validate({ body: querySchemas.bulkClose }),
  controller.bulkClose
);

router.post('/bulk/reassign',
  requireRole('data_manager', 'admin', 'monitor'),
  validate({ body: querySchemas.bulkReassign }),
  controller.bulkReassign
);

export default router;

