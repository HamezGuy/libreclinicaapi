/**
 * Form Layout Routes
 * 
 * Manages column layout configuration for CRF form rendering.
 * Uses LibreClinica native tables: item_form_metadata (column_number), section
 */

import express from 'express';
import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { pool } from '../config/database';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/form-layout/:crfVersionId
 * Get form layout configuration for a CRF version
 */
router.get('/:crfVersionId', asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId } = req.params;

  // Get sections and items with their layout metadata
  const result = await pool.query(`
    SELECT 
      s.section_id, s.label as section_label, s.title as section_title, s.ordinal as section_ordinal,
      ifm.item_form_metadata_id, ifm.item_id, ifm.column_number,
      ifm.left_item_text, ifm.right_item_text, ifm.header, ifm.subheader,
      ifm.ordinal as item_ordinal, ifm.required, ifm.default_value, ifm.show_item,
      ifm.response_layout, ifm.width_decimal,
      i.name as item_name, i.description as item_description, i.units,
      i.item_data_type_id, i.phi_status,
      rs.response_type_id, rs.options_text, rs.options_values
    FROM item_form_metadata ifm
    INNER JOIN item i ON ifm.item_id = i.item_id
    INNER JOIN section s ON ifm.section_id = s.section_id
    LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
    WHERE ifm.crf_version_id = $1 AND (ifm.show_item IS NULL OR ifm.show_item = true)
    ORDER BY s.ordinal, ifm.ordinal
  `, [crfVersionId]);

  // Determine max column count
  const maxColumns = Math.max(1, ...result.rows.map(r => r.column_number || 1));

  res.json({
    success: true,
    data: {
      crfVersionId: parseInt(crfVersionId),
      columnCount: maxColumns,
      sections: groupBySections(result.rows),
      items: result.rows.map(r => ({
        itemFormMetadataId: r.item_form_metadata_id,
        itemId: r.item_id,
        itemName: r.item_name,
        columnNumber: r.column_number || 1,
        sectionId: r.section_id,
        ordinal: r.item_ordinal,
        leftItemText: r.left_item_text,
        rightItemText: r.right_item_text,
        required: r.required,
        showItem: r.show_item !== false,
        responseTypeId: r.response_type_id,
        widthDecimal: r.width_decimal
      }))
    }
  });
}));

/**
 * GET /api/form-layout/:crfVersionId/render
 * Get rendered form layout (rows and columns)
 */
router.get('/:crfVersionId/render', asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId } = req.params;

  const result = await pool.query(`
    SELECT ifm.*, i.name as item_name, s.label as section_label, s.ordinal as section_ordinal
    FROM item_form_metadata ifm
    INNER JOIN item i ON ifm.item_id = i.item_id
    INNER JOIN section s ON ifm.section_id = s.section_id
    WHERE ifm.crf_version_id = $1 AND (ifm.show_item IS NULL OR ifm.show_item = true)
    ORDER BY s.ordinal, ifm.ordinal
  `, [crfVersionId]);

  const maxColumns = Math.max(1, ...result.rows.map(r => r.column_number || 1));

  // Group items into rows based on column_number
  const rows: any[] = [];
  let currentRow: any[] = [];
  let currentOrdinal = -1;

  for (const item of result.rows) {
    const colNum = item.column_number || 1;
    if (colNum === 1 && currentRow.length > 0) {
      rows.push({ items: currentRow });
      currentRow = [];
    }
    currentRow.push({
      itemFormMetadataId: item.item_form_metadata_id,
      itemId: item.item_id,
      itemName: item.item_name,
      columnNumber: colNum,
      leftItemText: item.left_item_text,
      required: item.required
    });
  }
  if (currentRow.length > 0) rows.push({ items: currentRow });

  res.json({ success: true, data: { columnCount: maxColumns, rows } });
}));

/**
 * POST /api/form-layout
 * Save form layout configuration (admin only)
 */
router.post('/', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const { crfVersionId, items } = req.body;
  const user = (req as any).user;

  if (!crfVersionId || !items || !Array.isArray(items)) {
    res.status(400).json({ success: false, message: 'crfVersionId and items array required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(`
        UPDATE item_form_metadata SET column_number = $1, ordinal = COALESCE($2, ordinal)
        WHERE item_form_metadata_id = $3 AND crf_version_id = $4
      `, [item.columnNumber || 1, item.ordinal, item.itemFormMetadataId, crfVersionId]);
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Layout saved' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
}));

/**
 * PUT /api/form-layout/field/:itemFormMetadataId
 * Update a single field's layout
 */
router.put('/field/:itemFormMetadataId', requireRole('admin', 'data_manager'), asyncHandler(async (req: Request, res: Response) => {
  const { itemFormMetadataId } = req.params;
  const { columnNumber, ordinal } = req.body;

  await pool.query(`
    UPDATE item_form_metadata SET column_number = COALESCE($1, column_number), ordinal = COALESCE($2, ordinal)
    WHERE item_form_metadata_id = $3
  `, [columnNumber, ordinal, itemFormMetadataId]);

  res.json({ success: true, message: 'Field layout updated' });
}));

function groupBySections(rows: any[]): any[] {
  const sections: Record<number, any> = {};
  for (const row of rows) {
    if (!sections[row.section_id]) {
      sections[row.section_id] = {
        sectionId: row.section_id,
        label: row.section_label,
        title: row.section_title,
        ordinal: row.section_ordinal,
        itemCount: 0
      };
    }
    sections[row.section_id].itemCount++;
  }
  return Object.values(sections).sort((a, b) => a.ordinal - b.ordinal);
}

export default router;
