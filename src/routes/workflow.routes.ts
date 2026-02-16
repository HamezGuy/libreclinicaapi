import { Router, Request, Response } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as workflowService from '../services/database/workflow.service';

const router = Router();
const controller = new WorkflowController();

// All workflow routes require authentication
router.use(authMiddleware);

// Get all workflows (admin only)
router.get(
  '/',
  requireRole('admin', 'data_manager', 'coordinator'),
  controller.getAllWorkflows.bind(controller)
);

// Get workflows for specific user
router.get(
  '/user/:userId',
  controller.getUserWorkflows.bind(controller)
);

// Get user task summary
router.get(
  '/user/:userId/summary',
  controller.getUserTaskSummary.bind(controller)
);

// Create new workflow task
router.post(
  '/',
  requireRole('admin', 'data_manager'),
  controller.createWorkflow.bind(controller)
);

// Update workflow status
router.put(
  '/:id/status',
  controller.updateWorkflowStatus.bind(controller)
);

// Complete workflow task
router.post(
  '/:id/complete',
  controller.completeWorkflow.bind(controller)
);

// Approve workflow task
router.post(
  '/:id/approve',
  requireRole('admin', 'investigator'),
  controller.approveWorkflow.bind(controller)
);

// Reject workflow task
router.post(
  '/:id/reject',
  requireRole('admin', 'investigator'),
  controller.rejectWorkflow.bind(controller)
);

// Handoff workflow task to another user/role
router.post(
  '/:id/handoff',
  controller.handoffWorkflow.bind(controller)
);

// ── CRF Lifecycle Status ──────────────────────────────────────────────

// Get lifecycle status for a single CRF instance
router.get('/crf-lifecycle/:eventCrfId', async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const status = await workflowService.getCrfLifecycleStatus(eventCrfId);
    if (!status) {
      res.status(404).json({ success: false, message: 'CRF instance not found' });
      return;
    }
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get lifecycle status for all patient CRF instances in a study (dashboard data).
// This is the core endpoint for tracking each form per patient — NOT the base template.
router.get('/crf-lifecycle-summary/:studyId', async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const { pool } = require('../config/database');
    
    // Single batched query: get all event_crf records with patient + form info
    const ecResult = await pool.query(`
      SELECT 
        ec.event_crf_id,
        ec.status_id,
        ec.completion_status_id,
        COALESCE(ec.sdv_status, false) as sdv_verified,
        COALESCE(ec.electronic_signature_status, false) as is_signed,
        ec.date_created as form_started,
        ec.date_updated as form_updated,
        cv.crf_id,
        c.name as form_name,
        cv.name as version_name,
        ss.study_subject_id as subject_id,
        ss.label as subject_label,
        sed.name as visit_name,
        se.study_event_id
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ss.study_id = $1
        AND ec.status_id NOT IN (5, 7)
      ORDER BY ss.label, sed.ordinal, c.name
    `, [studyId]);

    // Load workflow configs in bulk
    let configMap: Record<number, any> = {};
    try {
      const cfgResult = await pool.query(`
        SELECT crf_id, requires_sdv, requires_signature, requires_dde
        FROM acc_form_workflow_config
        WHERE study_id = $1 OR study_id IS NULL
      `, [studyId]);
      for (const row of cfgResult.rows) {
        configMap[row.crf_id] = row;
      }
    } catch { /* table may not exist */ }

    // Count open queries per event_crf in bulk
    let queryCountMap: Record<number, number> = {};
    try {
      const qResult = await pool.query(`
        SELECT dem.event_crf_id, COUNT(*) as cnt
        FROM discrepancy_note dn
        INNER JOIN dn_event_crf_map dem ON dn.discrepancy_note_id = dem.discrepancy_note_id
        INNER JOIN event_crf ec ON dem.event_crf_id = ec.event_crf_id
        INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
        INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        WHERE ss.study_id = $1
          AND dn.resolution_status_id IN (1, 2, 3)
          AND dn.parent_dn_id IS NULL
        GROUP BY dem.event_crf_id
      `, [studyId]);
      for (const row of qResult.rows) {
        queryCountMap[row.event_crf_id] = parseInt(row.cnt);
      }
    } catch { /* ignore */ }

    // Compute lifecycle status for each instance
    const items = ecResult.rows.map((row: any) => {
      const cfg = configMap[row.crf_id] || {};
      const requiresSDV = cfg.requires_sdv || false;
      const requiresSignature = cfg.requires_signature || false;
      const requiresDDE = cfg.requires_dde || false;

      // Determine current phase
      let currentPhase = 'not_started';
      if (row.status_id === 6) {
        currentPhase = 'locked';
      } else if (row.completion_status_id >= 5 || row.is_signed) {
        currentPhase = 'signed';
      } else if (row.sdv_verified) {
        currentPhase = 'sdv_complete';
      } else if (row.completion_status_id >= 4 || row.status_id === 2) {
        currentPhase = 'data_entry_complete';
      } else if (row.completion_status_id >= 2) {
        currentPhase = 'data_entry';
      }

      return {
        eventCrfId: row.event_crf_id,
        crfId: row.crf_id,
        formName: row.form_name,
        versionName: row.version_name,
        subjectId: row.subject_id,
        subjectLabel: row.subject_label,
        visitName: row.visit_name,
        studyEventId: row.study_event_id,
        currentPhase,
        formStarted: row.form_started,
        formUpdated: row.form_updated,
        openQueryCount: queryCountMap[row.event_crf_id] || 0,
        workflowConfig: { requiresSDV, requiresSignature, requiresDDE }
      };
    });

    // Aggregate counts by phase
    const summary: Record<string, number> = {};
    for (const item of items) {
      summary[item.currentPhase] = (summary[item.currentPhase] || 0) + 1;
    }

    res.json({ success: true, data: { items, summary, totalInstances: items.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
