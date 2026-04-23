/**
 * Form Routes
 * 
 * CRUD operations for form templates (CRFs) and form data
 * 
 * 21 CFR Part 11 Compliance:
 * - All data modifications require electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import express, { Request, Response } from 'express';
import * as controller from '../controllers/form.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { pool } from '../config/database';
import Joi from 'joi';
import { validate, formSchemas, commonSchemas } from '../middleware/validation.middleware';
import { soapRateLimiter } from '../middleware/rateLimiter.middleware';
import { requireSignatureFor, SignatureMeanings } from '../middleware/part11.middleware';

const router = express.Router();

router.use(authMiddleware);

// ============================================================================
// 21 CFR PART 11 ARCHIVE OPERATIONS (must be before /:id routes)
// Forms are NEVER permanently deleted - they are archived for compliance
// ============================================================================

// Get archived forms (admin only) - MUST be before /:id route to avoid parameter matching
router.get('/archived', 
  requireRole('admin'),
  controller.getArchivedForms
);

// Reference data endpoints (MUST be before /:id to avoid parameter matching)
router.get('/null-value-types', controller.getNullValueTypes);
router.get('/measurement-units', controller.getMeasurementUnits);

// ============================================================================
// Form Workflow Configuration (CRF lifecycle settings)
// MUST be before /:id routes — Express matches routes in declaration order,
// so /workflow-config would otherwise be captured by /:id and fail validation.
// ============================================================================

// Helper: parse query_route_to_users JSON from DB row
function parseRouteUsers(row: any): string[] {
  try {
    const raw = row.queryRouteToUsers;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore parse errors */ }
  return [];
}

const defaultConfig = { requiresSDV: false, requiresSignature: false, requiresDDE: false, queryRouteToUsers: [] };

// GET /api/forms/workflow-config - Get workflow config for ALL forms (bulk)
router.get('/workflow-config', async (req: Request, res: Response) => {
  try {
    const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : null;

    const tableCheck = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_form_workflow_config') as exists
    `);
    if (!tableCheck.rows[0].exists) {
      res.json({ success: true, data: {} });
      return;
    }

    let result;
    if (studyId) {
      result = await pool.query(`
        SELECT crf_id, requires_sdv, requires_signature, requires_dde, query_route_to_users
        FROM acc_form_workflow_config
        WHERE study_id = $1 OR study_id IS NULL
        ORDER BY crf_id, study_id DESC NULLS LAST
      `, [studyId]);
    } else {
      result = await pool.query(`
        SELECT crf_id, requires_sdv, requires_signature, requires_dde, query_route_to_users
        FROM acc_form_workflow_config
        WHERE study_id IS NULL
        ORDER BY crf_id
      `);
    }

    const configMap: Record<string, any> = {};
    for (const row of result.rows) {
      if (configMap[String(row.crfId)]) continue;
      configMap[String(row.crfId)] = {
        requiresSDV: row.requiresSdv,
        requiresSignature: row.requiresSignature,
        requiresDDE: row.requiresDde,
        queryRouteToUsers: parseRouteUsers(row)
      };
    }

    res.json({ success: true, data: configMap });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/forms/workflow-config/:crfId - Get workflow config for a single form
router.get('/workflow-config/:crfId', async (req: Request, res: Response) => {
  try {
    const crfId = parseInt(req.params.crfId);
    const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : null;

    const tableCheck = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'acc_form_workflow_config') as exists
    `);
    if (!tableCheck.rows[0].exists) {
      res.json({ success: true, data: { ...defaultConfig } });
      return;
    }

    const result = await pool.query(`
      SELECT requires_sdv, requires_signature, requires_dde, query_route_to_users
      FROM acc_form_workflow_config
      WHERE crf_id = $1 AND (study_id = $2 OR study_id IS NULL)
      ORDER BY study_id DESC NULLS LAST
      LIMIT 1
    `, [crfId, studyId]);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      res.json({
        success: true,
        data: {
          requiresSDV: row.requiresSdv,
          requiresSignature: row.requiresSignature,
          requiresDDE: row.requiresDde,
          queryRouteToUsers: parseRouteUsers(row)
        }
      });
    } else {
      res.json({ success: true, data: { ...defaultConfig } });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/forms/workflow-config/:crfId - Save workflow config for a form
router.put('/workflow-config/:crfId',
  requireRole('admin', 'data_manager'),
  validate({ body: formSchemas.workflowConfig }),
  async (req: Request, res: Response) => {
    try {
      const crfId = parseInt(req.params.crfId);
      const { requiresSDV, requiresSignature, requiresDDE, queryRouteToUsers, studyId } = req.body;
      const userId = (req as any).user?.userId;

      const usersJson = JSON.stringify(queryRouteToUsers || []);
      const resolvedStudyId = studyId || null;

      await pool.query(`
        INSERT INTO acc_form_workflow_config
          (crf_id, study_id, requires_sdv, requires_signature, requires_dde, query_route_to_users, updated_by, date_updated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (crf_id, COALESCE(study_id, 0))
        DO UPDATE SET
          requires_sdv = EXCLUDED.requires_sdv,
          requires_signature = EXCLUDED.requires_signature,
          requires_dde = EXCLUDED.requires_dde,
          query_route_to_users = EXCLUDED.query_route_to_users,
          updated_by = EXCLUDED.updated_by,
          date_updated = NOW()
      `, [crfId, resolvedStudyId, requiresSDV || false, requiresSignature || false, requiresDDE || false, usersJson, userId]);

      res.json({ success: true, message: 'Workflow configuration saved' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Form templates (CRFs) - read operations (no signature required)
// IMPORTANT: More-specific routes (with path suffixes like /metadata, /versions) MUST be
// registered before the generic /:id route so Express matches them first.
router.get('/', controller.list);
router.get('/by-study', controller.getByStudy);

// Template bundle export/import (must be before /:id to avoid parameter matching)
router.post('/export-bundle',
  requireRole('admin', 'data_manager'),
  controller.exportBundle
);
router.post('/import-bundle',
  requireRole('admin', 'data_manager'),
  controller.importBundle
);
// /data and /status routes are registered later but also benefit from specificity order
router.get('/:crfId/metadata', controller.getMetadata);          // Must be before /:id
router.get('/:id/versions', validate({ params: commonSchemas.idParam }), controller.getVersions); // Must be before /:id
router.get('/:id', validate({ params: commonSchemas.idParam }), controller.get);

// Form templates (CRFs) - write operations (signature required per §11.50)
router.post('/', 
  requireRole('admin', 'data_manager'), 
  validate({ body: formSchemas.create }),
  requireSignatureFor(SignatureMeanings.CRF_CREATE),
  controller.create
);
router.put('/:id', 
  requireRole('admin', 'data_manager'), 
  validate({ params: commonSchemas.idParam, body: formSchemas.update }), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.update
);
router.delete('/:id', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.remove
);

// Archive a form (admin only) - replaces delete for compliance
router.post('/:id/archive', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_DELETE),
  controller.archive
);

// Restore an archived form (admin only)
router.post('/:id/restore', 
  requireRole('admin'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.restore
);

// Template Forking/Versioning - write operations (signature required per §11.50)
// Create new version of existing CRF
router.post('/:id/versions', 
  requireRole('admin', 'data_manager'), 
  validate({ params: commonSchemas.idParam }), 
  requireSignatureFor(SignatureMeanings.CRF_CREATE),
  controller.createVersion
);

// Fork (copy) entire CRF to new independent form. Uses CRF_FORK signature
// meaning so the §11.50 manifest accurately states what the user signed for
// (a copy, not a brand-new form). Org-isolation on source and target is
// enforced inside controller.fork → forkForm.
router.post('/:id/fork', 
  requireRole('admin', 'data_manager'), 
  validate({ params: commonSchemas.idParam, body: formSchemas.fork }),
  requireSignatureFor(SignatureMeanings.CRF_FORK),
  controller.fork
);

// Relink broken form-link references after a fork. When a form that branches
// to another form is copied, and the linked form wasn't present in the target
// study at copy time, the links are temporarily disabled. Once the linked form
// is also copied, the user calls this endpoint to reconnect them.
router.patch('/:id/relink',
  requireRole('admin', 'data_manager'),
  validate({
    params: commonSchemas.idParam,
    body: Joi.object({
      relinks: Joi.array().items(Joi.object({
        oldFormId: Joi.number().integer().positive().required(),
        newFormId: Joi.number().integer().positive().required(),
        newFormName: Joi.string().optional().max(2000),
      })).min(1).required(),
      signaturePassword: Joi.string().optional(),
      signatureUsername: Joi.string().optional(),
      signatureMeaning: Joi.string().optional().max(500),
    }),
  }),
  requireSignatureFor(SignatureMeanings.CRF_UPDATE),
  controller.relinkFormLinks
);

// Batch-fork multiple forms with automatic cross-form relinking.
// When Form A links to Form B and both are in the batch, the link in the
// copied Form A automatically points at the copied Form B.
router.post('/batch-fork',
  requireRole('admin', 'data_manager'),
  validate({
    body: Joi.object({
      sourceCrfIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
      targetStudyId: Joi.number().integer().positive().required(),
      nameMap: Joi.object().pattern(Joi.string(), Joi.string().max(2000)).optional(),
      signaturePassword: Joi.string().optional(),
      signatureUsername: Joi.string().optional(),
      signatureMeaning: Joi.string().optional().max(500),
    }),
  }),
  requireSignatureFor(SignatureMeanings.CRF_FORK),
  controller.batchFork
);

// Form data operations (signature required for data entry per §11.50)
router.post('/save', 
  requireRole('data_manager', 'coordinator', 'investigator'), 
  soapRateLimiter, 
  validate({ body: formSchemas.saveData }), 
  requireSignatureFor(SignatureMeanings.FORM_DATA_SAVE),
  controller.saveData
);
router.get('/data/:eventCrfId', controller.getData);
router.get('/status/:eventCrfId', controller.getStatus);

// Single field update with validation (for real-time validation on field change)
// This endpoint:
// 1. Validates the field value against all applicable rules
// 2. Optionally creates queries for validation failures
// 3. Updates the field data if validation passes (or if validateOnly=false)
router.patch('/field/:eventCrfId', 
  requireRole('data_manager', 'coordinator', 'investigator'),
  validate({ body: formSchemas.fieldPatch }),
  requireSignatureFor(SignatureMeanings.FORM_DATA_SAVE),
  controller.updateField
);

// Validate only (no data update) - for real-time validation feedback
router.post('/validate-field/:eventCrfId',
  requireRole('data_manager', 'coordinator', 'investigator'),
  validate({ body: formSchemas.validateField }),
  controller.validateField
);

// Mark a form instance as data-entry complete (prerequisite for data lock)
// POST /api/forms/:eventCrfId/complete
router.post('/:eventCrfId/complete',
  requireRole('data_manager', 'coordinator', 'investigator', 'admin'),
  validate({
    params: Joi.object({ eventCrfId: Joi.number().integer().positive().required() }),
    body: Joi.object({
      password: Joi.string().optional(),
      signatureUsername: Joi.string().optional(),
      signaturePassword: Joi.string().optional(),
      signatureMeaning: Joi.string().optional(),
      hiddenFieldIds: Joi.array().items(Joi.number().integer().positive()).optional(),
      hiddenFields: Joi.array().items(Joi.string()).optional()
    })
  }),
  requireSignatureFor('I confirm this form\'s data entry is complete and accurate'),
  controller.markComplete
);

export default router;
