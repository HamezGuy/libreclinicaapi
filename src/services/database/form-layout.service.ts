/**
 * Form Layout Service
 *
 * Queries item_form_metadata / section tables for CRF form rendering layout.
 */

import { pool } from '../../config/database';

interface SectionSummary {
  sectionId: number;
  label: string;
  title: string;
  ordinal: number;
  itemCount: number;
}

interface LayoutItem {
  itemFormMetadataId: number;
  itemId: number;
  itemName: string;
  columnNumber: number;
  sectionId: number;
  ordinal: number;
  leftItemText: string;
  rightItemText: string;
  required: boolean;
  showItem: boolean;
  responseTypeId: number;
  widthDecimal: number;
}

interface RenderRow {
  items: RenderRowItem[];
}

interface RenderRowItem {
  itemFormMetadataId: number;
  itemId: number;
  itemName: string;
  columnNumber: number;
  leftItemText: string;
  required: boolean;
}

function groupBySections(rows: any[]): SectionSummary[] {
  const sections: Record<number, SectionSummary> = {};
  for (const row of rows) {
    if (!sections[row.sectionId]) {
      sections[row.sectionId] = {
        sectionId: row.sectionId,
        label: row.sectionLabel,
        title: row.sectionTitle,
        ordinal: row.sectionOrdinal,
        itemCount: 0,
      };
    }
    sections[row.sectionId].itemCount++;
  }
  return Object.values(sections).sort((a, b) => a.ordinal - b.ordinal);
}

export async function getFormLayout(crfVersionId: number) {
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

  const maxColumns = Math.max(1, ...result.rows.map((r: any) => r.columnNumber || 1));
  const sections = groupBySections(result.rows);
  const items: LayoutItem[] = result.rows.map((r: any) => ({
    itemFormMetadataId: r.itemFormMetadataId,
    itemId: r.itemId,
    itemName: r.itemName,
    columnNumber: r.columnNumber || 1,
    sectionId: r.sectionId,
    ordinal: r.itemOrdinal,
    leftItemText: r.leftItemText,
    rightItemText: r.rightItemText,
    required: r.required,
    showItem: r.showItem !== false,
    responseTypeId: r.responseTypeId,
    widthDecimal: r.widthDecimal,
  }));

  return { crfVersionId, columnCount: maxColumns, sections, items };
}

export async function getRenderedLayout(crfVersionId: number) {
  const result = await pool.query(`
    SELECT ifm.*, i.name as item_name, s.label as section_label, s.ordinal as section_ordinal
    FROM item_form_metadata ifm
    INNER JOIN item i ON ifm.item_id = i.item_id
    INNER JOIN section s ON ifm.section_id = s.section_id
    WHERE ifm.crf_version_id = $1 AND (ifm.show_item IS NULL OR ifm.show_item = true)
    ORDER BY s.ordinal, ifm.ordinal
  `, [crfVersionId]);

  const maxColumns = Math.max(1, ...result.rows.map((r: any) => r.columnNumber || 1));

  const rows: RenderRow[] = [];
  let currentRow: RenderRowItem[] = [];

  for (const item of result.rows) {
    const colNum = item.columnNumber || 1;
    if (colNum === 1 && currentRow.length > 0) {
      rows.push({ items: currentRow });
      currentRow = [];
    }
    currentRow.push({
      itemFormMetadataId: item.itemFormMetadataId,
      itemId: item.itemId,
      itemName: item.itemName,
      columnNumber: colNum,
      leftItemText: item.leftItemText,
      required: item.required,
    });
  }
  if (currentRow.length > 0) rows.push({ items: currentRow });

  return { columnCount: maxColumns, rows };
}

export async function saveFormLayout(
  crfVersionId: number,
  items: Array<{ itemFormMetadataId: number; columnNumber?: number; ordinal?: number }>,
): Promise<void> {
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
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateFieldLayout(
  itemFormMetadataId: number,
  columnNumber?: number,
  ordinal?: number,
): Promise<void> {
  await pool.query(`
    UPDATE item_form_metadata SET column_number = COALESCE($1, column_number), ordinal = COALESCE($2, ordinal)
    WHERE item_form_metadata_id = $3
  `, [columnNumber, ordinal, itemFormMetadataId]);
}
