/**
 * CRF/Item Flagging Routes
 * 
 * API endpoints for managing flags on Event CRFs and Item Data.
 * Uses LibreClinica's native tables:
 * - event_crf_flag: Flags at the form level
 * - item_data_flag: Flags at the field level
 * - event_crf_flag_workflow: Workflow states for CRF flags
 * - item_data_flag_workflow: Workflow states for item flags
 * 
 * Flags are used for:
 * - Marking data for review
 * - Special handling requirements
 * - Data quality indicators
 * - Workflow tracking
 * 
 * 21 CFR Part 11 Compliance:
 * - §11.10(e): Full audit trail for all flagging operations
 * - §11.10(k): UTC timestamps for all events
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import {
  Part11EventTypes,
  recordPart11Audit,
  Part11Request,
  formatPart11Timestamp
} from '../middleware/part11.middleware';
import { pool } from '../config/database';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// ============================================================================
// Types
// ============================================================================

interface FlagPath {
  studySubjectOid: string;
  studyEventOid: string;
  eventOrdinal: number;
  crfOid: string;
  groupOid?: string;
  groupOrdinal?: number;
  itemOid?: string;
}

// ============================================================================
// Workflow Management
// ============================================================================

/**
 * GET /api/flagging/workflows
 * List available flag workflows
 */
router.get('/workflows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.query; // 'crf' or 'item'

    let results: any[] = [];

    if (!type || type === 'crf') {
      const crfWorkflows = await pool.query(`
        SELECT id, workflow_id, workflow_status, owner_id, date_created, date_updated
        FROM event_crf_flag_workflow
        ORDER BY workflow_id, workflow_status
      `);
      results.push(...crfWorkflows.rows.map(r => ({ ...r, type: 'crf' })));
    }

    if (!type || type === 'item') {
      const itemWorkflows = await pool.query(`
        SELECT id, workflow_id, workflow_status, owner_id, date_created, date_updated
        FROM item_data_flag_workflow
        ORDER BY workflow_id, workflow_status
      `);
      results.push(...itemWorkflows.rows.map(r => ({ ...r, type: 'item' })));
    }

    res.json({
      success: true,
      data: results.map(row => ({
        id: row.id,
        type: row.type,
        workflowId: row.workflow_id,
        workflowStatus: row.workflow_status,
        ownerId: row.owner_id,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }))
    });
  } catch (error) {
    logger.error('Failed to list flag workflows', { error });
    next(error);
  }
});

/**
 * POST /api/flagging/workflows
 * Create a new flag workflow status
 */
router.post('/workflows', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { type, workflowId, workflowStatus } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!type || !workflowId || !workflowStatus) {
      return res.status(400).json({
        success: false,
        message: 'type (crf/item), workflowId, and workflowStatus are required'
      });
    }

    const table = type === 'crf' ? 'event_crf_flag_workflow' : 'item_data_flag_workflow';

    const result = await pool.query(`
      INSERT INTO ${table} (workflow_id, workflow_status, owner_id, date_created, date_updated)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id
    `, [workflowId, workflowStatus, userId]);

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.FLAG_WORKFLOW_CREATED || 'FLAG_WORKFLOW_CREATED',
      table,
      result.rows[0].id,
      `${workflowId}:${workflowStatus}`,
      null,
      { type, workflowId, workflowStatus },
      'Flag workflow created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        type,
        workflowId,
        workflowStatus
      }
    });
  } catch (error) {
    logger.error('Failed to create flag workflow', { error });
    next(error);
  }
});

// ============================================================================
// Event CRF Flags (Form-level flags)
// ============================================================================

/**
 * GET /api/flagging/crf
 * List CRF flags with filtering
 */
router.get('/crf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId, subjectOid, eventOid, crfOid, tagId, workflowStatus } = req.query;

    let query = `
      SELECT 
        f.id as flag_id,
        f.path,
        f.tag_id,
        f.flag_workflow_id,
        f.owner_id,
        f.update_id,
        f.date_created,
        f.date_updated,
        w.workflow_id,
        w.workflow_status,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name
      FROM event_crf_flag f
      LEFT JOIN event_crf_flag_workflow w ON f.flag_workflow_id = w.id
      LEFT JOIN user_account u ON f.owner_id = u.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (subjectOid) {
      params.push(`${subjectOid}.%`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (eventOid) {
      params.push(`%.${eventOid}.%`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (crfOid) {
      params.push(`%.${crfOid}`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (tagId) {
      params.push(tagId);
      query += ` AND f.tag_id = $${params.length}`;
    }

    if (workflowStatus) {
      params.push(workflowStatus);
      query += ` AND w.workflow_status = $${params.length}`;
    }

    query += ' ORDER BY f.date_created DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        flagId: row.flag_id,
        path: row.path,
        parsedPath: parseFlagPath(row.path),
        tagId: row.tag_id,
        flagWorkflowId: row.flag_workflow_id,
        workflowId: row.workflow_id,
        workflowStatus: row.workflow_status,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }))
    });
  } catch (error) {
    logger.error('Failed to list CRF flags', { error });
    next(error);
  }
});

/**
 * GET /api/flagging/crf/:id
 * Get a specific CRF flag
 */
router.get('/crf/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        f.*,
        w.workflow_id,
        w.workflow_status,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name,
        CONCAT(u2.first_name, ' ', u2.last_name) as updater_name
      FROM event_crf_flag f
      LEFT JOIN event_crf_flag_workflow w ON f.flag_workflow_id = w.id
      LEFT JOIN user_account u ON f.owner_id = u.user_id
      LEFT JOIN user_account u2 ON f.update_id = u2.user_id
      WHERE f.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        flagId: row.id,
        path: row.path,
        parsedPath: parseFlagPath(row.path),
        tagId: row.tag_id,
        flagWorkflowId: row.flag_workflow_id,
        workflowId: row.workflow_id,
        workflowStatus: row.workflow_status,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        updateId: row.update_id,
        updaterName: row.updater_name,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }
    });
  } catch (error) {
    logger.error('Failed to get CRF flag', { error });
    next(error);
  }
});

/**
 * POST /api/flagging/crf
 * Create a CRF flag
 * 
 * Path format: {subjectOid}.{eventOid}.{eventOrdinal}.{crfOid}
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag creation
 */
router.post('/crf', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { path, tagId, flagWorkflowId } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!path) {
      return res.status(400).json({
        success: false,
        message: 'path is required (format: subjectOid.eventOid.eventOrdinal.crfOid)'
      });
    }

    // Check if flag already exists for this path and tag
    const existing = await pool.query(
      'SELECT id FROM event_crf_flag WHERE path = $1 AND COALESCE(tag_id, 0) = COALESCE($2, 0)',
      [path, tagId || null]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Flag already exists for this path',
        data: { existingFlagId: existing.rows[0].id }
      });
    }

    const result = await pool.query(`
      INSERT INTO event_crf_flag (path, tag_id, flag_workflow_id, owner_id, date_created, date_updated)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id
    `, [path, tagId || null, flagWorkflowId || null, userId]);

    const flagId = result.rows[0].id;

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.CRF_FLAG_CREATED || 'CRF_FLAG_CREATED',
      'event_crf_flag',
      flagId,
      path,
      null,
      { path, tagId, flagWorkflowId },
      'CRF flag created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: { flagId, path }
    });
  } catch (error) {
    logger.error('Failed to create CRF flag', { error });
    next(error);
  }
});

/**
 * PUT /api/flagging/crf/:id
 * Update a CRF flag (change workflow status)
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag update
 */
router.put('/crf/:id', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { tagId, flagWorkflowId } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current state
    const currentResult = await pool.query(
      'SELECT * FROM event_crf_flag WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const oldData = currentResult.rows[0];

    await pool.query(`
      UPDATE event_crf_flag
      SET tag_id = COALESCE($1, tag_id),
          flag_workflow_id = COALESCE($2, flag_workflow_id),
          update_id = $3,
          date_updated = NOW()
      WHERE id = $4
    `, [tagId, flagWorkflowId, userId, id]);

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.CRF_FLAG_UPDATED || 'CRF_FLAG_UPDATED',
      'event_crf_flag',
      parseInt(id),
      oldData.path,
      { tagId: oldData.tag_id, flagWorkflowId: oldData.flag_workflow_id },
      { tagId: tagId ?? oldData.tag_id, flagWorkflowId: flagWorkflowId ?? oldData.flag_workflow_id },
      'CRF flag updated',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Flag updated successfully'
    });
  } catch (error) {
    logger.error('Failed to update CRF flag', { error });
    next(error);
  }
});

/**
 * DELETE /api/flagging/crf/:id
 * Remove a CRF flag
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag deletion
 */
router.delete('/crf/:id', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current state for audit
    const currentResult = await pool.query(
      'SELECT * FROM event_crf_flag WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const oldData = currentResult.rows[0];

    await pool.query('DELETE FROM event_crf_flag WHERE id = $1', [id]);

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.CRF_FLAG_DELETED || 'CRF_FLAG_DELETED',
      'event_crf_flag',
      parseInt(id),
      oldData.path,
      oldData,
      null,
      'CRF flag removed',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Flag removed successfully'
    });
  } catch (error) {
    logger.error('Failed to delete CRF flag', { error });
    next(error);
  }
});

// ============================================================================
// Item Data Flags (Field-level flags)
// ============================================================================

/**
 * GET /api/flagging/item
 * List item data flags with filtering
 */
router.get('/item', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subjectOid, eventOid, crfOid, itemOid, tagId, workflowStatus } = req.query;

    let query = `
      SELECT 
        f.id as flag_id,
        f.path,
        f.tag_id,
        f.flag_workflow_id,
        f.owner_id,
        f.update_id,
        f.date_created,
        f.date_updated,
        w.workflow_id,
        w.workflow_status,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name
      FROM item_data_flag f
      LEFT JOIN item_data_flag_workflow w ON f.flag_workflow_id = w.id
      LEFT JOIN user_account u ON f.owner_id = u.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (subjectOid) {
      params.push(`${subjectOid}.%`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (eventOid) {
      params.push(`%.${eventOid}.%`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (crfOid) {
      params.push(`%.${crfOid}.%`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (itemOid) {
      params.push(`%.${itemOid}`);
      query += ` AND f.path LIKE $${params.length}`;
    }

    if (tagId) {
      params.push(tagId);
      query += ` AND f.tag_id = $${params.length}`;
    }

    if (workflowStatus) {
      params.push(workflowStatus);
      query += ` AND w.workflow_status = $${params.length}`;
    }

    query += ' ORDER BY f.date_created DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        flagId: row.flag_id,
        path: row.path,
        parsedPath: parseFlagPath(row.path),
        tagId: row.tag_id,
        flagWorkflowId: row.flag_workflow_id,
        workflowId: row.workflow_id,
        workflowStatus: row.workflow_status,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }))
    });
  } catch (error) {
    logger.error('Failed to list item flags', { error });
    next(error);
  }
});

/**
 * GET /api/flagging/item/:id
 * Get a specific item data flag
 */
router.get('/item/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        f.*,
        w.workflow_id,
        w.workflow_status,
        CONCAT(u.first_name, ' ', u.last_name) as owner_name,
        CONCAT(u2.first_name, ' ', u2.last_name) as updater_name
      FROM item_data_flag f
      LEFT JOIN item_data_flag_workflow w ON f.flag_workflow_id = w.id
      LEFT JOIN user_account u ON f.owner_id = u.user_id
      LEFT JOIN user_account u2 ON f.update_id = u2.user_id
      WHERE f.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        flagId: row.id,
        path: row.path,
        parsedPath: parseFlagPath(row.path),
        tagId: row.tag_id,
        flagWorkflowId: row.flag_workflow_id,
        workflowId: row.workflow_id,
        workflowStatus: row.workflow_status,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        updateId: row.update_id,
        updaterName: row.updater_name,
        dateCreated: row.date_created,
        dateUpdated: row.date_updated
      }
    });
  } catch (error) {
    logger.error('Failed to get item flag', { error });
    next(error);
  }
});

/**
 * POST /api/flagging/item
 * Create an item data flag
 * 
 * Path format: {subjectOid}.{eventOid}.{eventOrdinal}.{crfOid}.{groupOid}.{groupOrdinal}.{itemOid}
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag creation
 */
router.post('/item', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { path, tagId, flagWorkflowId } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    if (!path) {
      return res.status(400).json({
        success: false,
        message: 'path is required (format: subjectOid.eventOid.eventOrdinal.crfOid.groupOid.groupOrdinal.itemOid)'
      });
    }

    // Check if flag already exists for this path and tag
    const existing = await pool.query(
      'SELECT id FROM item_data_flag WHERE path = $1 AND COALESCE(tag_id, 0) = COALESCE($2, 0)',
      [path, tagId || null]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Flag already exists for this path',
        data: { existingFlagId: existing.rows[0].id }
      });
    }

    const result = await pool.query(`
      INSERT INTO item_data_flag (path, tag_id, flag_workflow_id, owner_id, date_created, date_updated)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id
    `, [path, tagId || null, flagWorkflowId || null, userId]);

    const flagId = result.rows[0].id;

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.ITEM_FLAG_CREATED || 'ITEM_FLAG_CREATED',
      'item_data_flag',
      flagId,
      path,
      null,
      { path, tagId, flagWorkflowId },
      'Item data flag created',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      data: { flagId, path }
    });
  } catch (error) {
    logger.error('Failed to create item flag', { error });
    next(error);
  }
});

/**
 * PUT /api/flagging/item/:id
 * Update an item data flag
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag update
 */
router.put('/item/:id', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { tagId, flagWorkflowId } = req.body;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current state
    const currentResult = await pool.query(
      'SELECT * FROM item_data_flag WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const oldData = currentResult.rows[0];

    await pool.query(`
      UPDATE item_data_flag
      SET tag_id = COALESCE($1, tag_id),
          flag_workflow_id = COALESCE($2, flag_workflow_id),
          update_id = $3,
          date_updated = NOW()
      WHERE id = $4
    `, [tagId, flagWorkflowId, userId, id]);

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.ITEM_FLAG_UPDATED || 'ITEM_FLAG_UPDATED',
      'item_data_flag',
      parseInt(id),
      oldData.path,
      { tagId: oldData.tag_id, flagWorkflowId: oldData.flag_workflow_id },
      { tagId: tagId ?? oldData.tag_id, flagWorkflowId: flagWorkflowId ?? oldData.flag_workflow_id },
      'Item data flag updated',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Flag updated successfully'
    });
  } catch (error) {
    logger.error('Failed to update item flag', { error });
    next(error);
  }
});

/**
 * DELETE /api/flagging/item/:id
 * Remove an item data flag
 * 
 * 21 CFR Part 11 Compliance:
 * - Records audit event for flag deletion
 */
router.delete('/item/:id', async (req: Part11Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || 0;
    const userName = req.user?.userName || 'system';

    // Get current state for audit
    const currentResult = await pool.query(
      'SELECT * FROM item_data_flag WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    const oldData = currentResult.rows[0];

    await pool.query('DELETE FROM item_data_flag WHERE id = $1', [id]);

    // Part 11 Audit
    await recordPart11Audit(
      userId,
      userName,
      Part11EventTypes.ITEM_FLAG_DELETED || 'ITEM_FLAG_DELETED',
      'item_data_flag',
      parseInt(id),
      oldData.path,
      oldData,
      null,
      'Item data flag removed',
      { ipAddress: req.ip }
    );

    res.json({
      success: true,
      message: 'Flag removed successfully'
    });
  } catch (error) {
    logger.error('Failed to delete item flag', { error });
    next(error);
  }
});

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * GET /api/flagging/by-crf/:eventCrfId
 * Get all flags for a specific event CRF (both CRF-level and item-level)
 */
router.get('/by-crf/:eventCrfId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { eventCrfId } = req.params;

    // Get the path components for this event_crf
    const eventCrfResult = await pool.query(`
      SELECT 
        ss.oc_oid as subject_oid,
        sed.oc_oid as event_oid,
        se.sample_ordinal as event_ordinal,
        cv.oc_oid as crf_oid
      FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      JOIN study_event se ON ec.study_event_id = se.study_event_id
      JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      WHERE ec.event_crf_id = $1
    `, [eventCrfId]);

    if (eventCrfResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Event CRF not found' });
    }

    const ecrf = eventCrfResult.rows[0];
    const crfPathPrefix = `${ecrf.subject_oid}.${ecrf.event_oid}.${ecrf.event_ordinal}.${ecrf.crf_oid}`;

    // Get CRF-level flags
    const crfFlags = await pool.query(`
      SELECT f.*, w.workflow_id, w.workflow_status
      FROM event_crf_flag f
      LEFT JOIN event_crf_flag_workflow w ON f.flag_workflow_id = w.id
      WHERE f.path = $1
    `, [crfPathPrefix]);

    // Get item-level flags (path starts with crf path)
    const itemFlags = await pool.query(`
      SELECT f.*, w.workflow_id, w.workflow_status
      FROM item_data_flag f
      LEFT JOIN item_data_flag_workflow w ON f.flag_workflow_id = w.id
      WHERE f.path LIKE $1
    `, [crfPathPrefix + '.%']);

    res.json({
      success: true,
      data: {
        eventCrfId: parseInt(eventCrfId),
        crfPath: crfPathPrefix,
        crfFlags: crfFlags.rows.map(row => ({
          flagId: row.id,
          path: row.path,
          tagId: row.tag_id,
          workflowId: row.workflow_id,
          workflowStatus: row.workflow_status,
          dateCreated: row.date_created
        })),
        itemFlags: itemFlags.rows.map(row => ({
          flagId: row.id,
          path: row.path,
          itemOid: row.path.split('.').pop(),
          tagId: row.tag_id,
          workflowId: row.workflow_id,
          workflowStatus: row.workflow_status,
          dateCreated: row.date_created
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to get flags by CRF', { error });
    next(error);
  }
});

/**
 * GET /api/flagging/summary
 * Get flag summary statistics
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { studyId } = req.query;

    // Get CRF flag counts by workflow status
    const crfStats = await pool.query(`
      SELECT 
        COALESCE(w.workflow_status, 'no_workflow') as status,
        COUNT(*) as count
      FROM event_crf_flag f
      LEFT JOIN event_crf_flag_workflow w ON f.flag_workflow_id = w.id
      GROUP BY w.workflow_status
    `);

    // Get item flag counts by workflow status
    const itemStats = await pool.query(`
      SELECT 
        COALESCE(w.workflow_status, 'no_workflow') as status,
        COUNT(*) as count
      FROM item_data_flag f
      LEFT JOIN item_data_flag_workflow w ON f.flag_workflow_id = w.id
      GROUP BY w.workflow_status
    `);

    const crfByStatus: Record<string, number> = {};
    for (const row of crfStats.rows) {
      crfByStatus[row.status] = parseInt(row.count);
    }

    const itemByStatus: Record<string, number> = {};
    for (const row of itemStats.rows) {
      itemByStatus[row.status] = parseInt(row.count);
    }

    res.json({
      success: true,
      data: {
        crfFlags: {
          total: Object.values(crfByStatus).reduce((a, b) => a + b, 0),
          byStatus: crfByStatus
        },
        itemFlags: {
          total: Object.values(itemByStatus).reduce((a, b) => a + b, 0),
          byStatus: itemByStatus
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get flags summary', { error });
    next(error);
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a flag path into its components
 * CRF path: subjectOid.eventOid.eventOrdinal.crfOid
 * Item path: subjectOid.eventOid.eventOrdinal.crfOid.groupOid.groupOrdinal.itemOid
 */
function parseFlagPath(path: string): FlagPath | null {
  if (!path) return null;

  const parts = path.split('.');

  if (parts.length < 4) return null;

  const result: FlagPath = {
    studySubjectOid: parts[0],
    studyEventOid: parts[1],
    eventOrdinal: parseInt(parts[2]) || 1,
    crfOid: parts[3]
  };

  if (parts.length >= 7) {
    result.groupOid = parts[4];
    result.groupOrdinal = parseInt(parts[5]) || 1;
    result.itemOid = parts[6];
  }

  return result;
}

export default router;
