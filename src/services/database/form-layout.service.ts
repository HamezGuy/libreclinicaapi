/**
 * Form Layout Service
 * 
 * Manages form field layout for multi-column display in CRFs.
 * Uses LibreClinica's item_form_metadata.column_number for field positions.
 * 
 * Features:
 * - Configure forms for 1, 2, or 3 column layout
 * - Drag-and-drop field positioning
 * - Row-based grouping for alignment
 * - Persist layout in database
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

// ============================================================================
// INTERFACES
// ============================================================================

export interface FormLayoutConfig {
  crfVersionId: number;
  crfId: number;
  crfName: string;
  columnCount: 1 | 2 | 3;
  fields: FormFieldLayout[];
  sections: FormSectionLayout[];
}

export interface FormFieldLayout {
  itemId: number;
  itemFormMetadataId: number;
  name: string;
  label: string;
  type: string;
  
  // Layout properties
  columnNumber: number;  // 1, 2, or 3
  rowNumber: number;     // For alignment across columns
  ordinal: number;       // Order within column
  width: 'auto' | 'full' | 'half' | 'third';  // Width hint
  
  // Metadata
  required: boolean;
  sectionId?: number;
  sectionName?: string;
}

export interface FormSectionLayout {
  sectionId: number;
  label: string;
  title: string;
  ordinal: number;
  columnSpan: 1 | 2 | 3;  // How many columns the section header spans
}

export interface UpdateFieldLayoutRequest {
  itemFormMetadataId: number;
  columnNumber: number;
  rowNumber?: number;
  ordinal?: number;
}

export interface SaveLayoutRequest {
  crfVersionId: number;
  columnCount: 1 | 2 | 3;
  fields: UpdateFieldLayoutRequest[];
}

// ============================================================================
// GET LAYOUT
// ============================================================================

/**
 * Get the current layout configuration for a form (CRF version)
 */
export const getFormLayout = async (
  crfVersionId: number
): Promise<{ success: boolean; data?: FormLayoutConfig; message?: string }> => {
  logger.info('Getting form layout', { crfVersionId });

  try {
    // Get CRF info
    const crfResult = await pool.query(`
      SELECT cv.crf_version_id, cv.crf_id, c.name as crf_name
      FROM crf_version cv
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      WHERE cv.crf_version_id = $1
    `, [crfVersionId]);

    if (crfResult.rows.length === 0) {
      return { success: false, message: 'CRF version not found' };
    }

    const crf = crfResult.rows[0];

    // Get layout configuration from acc_form_layout if it exists
    let columnCount: 1 | 2 | 3 = 1;
    try {
      const layoutConfigResult = await pool.query(`
        SELECT column_count FROM acc_form_layout 
        WHERE crf_version_id = $1
      `, [crfVersionId]);
      
      if (layoutConfigResult.rows.length > 0) {
        columnCount = layoutConfigResult.rows[0].column_count as 1 | 2 | 3;
      }
    } catch (e) {
      // Table might not exist yet, use default
      logger.debug('acc_form_layout table not found, using default column count');
    }

    // Get all fields with their layout metadata
    const fieldsResult = await pool.query(`
      SELECT 
        i.item_id,
        i.name,
        i.description as label,
        idt.code as data_type_code,
        ifm.item_form_metadata_id,
        ifm.column_number,
        ifm.ordinal,
        ifm.required,
        ifm.section_id,
        s.label as section_name,
        rs.response_type_id
      FROM item i
      INNER JOIN item_form_metadata ifm ON i.item_id = ifm.item_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      LEFT JOIN section s ON ifm.section_id = s.section_id
      LEFT JOIN response_set rs ON ifm.response_set_id = rs.response_set_id
      WHERE ifm.crf_version_id = $1
      ORDER BY COALESCE(ifm.ordinal, 0), i.item_id
    `, [crfVersionId]);

    // Map to FormFieldLayout
    const fields: FormFieldLayout[] = fieldsResult.rows.map((row, index) => ({
      itemId: row.item_id,
      itemFormMetadataId: row.item_form_metadata_id,
      name: row.name,
      label: row.label || row.name,
      type: mapDataTypeToFieldType(row.data_type_code, row.response_type_id),
      columnNumber: row.column_number || 1,
      rowNumber: Math.floor(index / columnCount) + 1,
      ordinal: row.ordinal || index + 1,
      width: 'auto',
      required: row.required || false,
      sectionId: row.section_id,
      sectionName: row.section_name
    }));

    // Get sections
    const sectionsResult = await pool.query(`
      SELECT section_id, label, title, ordinal
      FROM section
      WHERE crf_version_id = $1
      ORDER BY ordinal
    `, [crfVersionId]);

    const sections: FormSectionLayout[] = sectionsResult.rows.map(row => ({
      sectionId: row.section_id,
      label: row.label || '',
      title: row.title || '',
      ordinal: row.ordinal || 0,
      columnSpan: columnCount
    }));

    const layoutConfig: FormLayoutConfig = {
      crfVersionId,
      crfId: crf.crf_id,
      crfName: crf.crf_name,
      columnCount,
      fields,
      sections
    };

    return { success: true, data: layoutConfig };
  } catch (error: any) {
    logger.error('Get form layout error', { error: error.message, crfVersionId });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// SAVE LAYOUT
// ============================================================================

/**
 * Save layout configuration for a form
 */
export const saveFormLayout = async (
  request: SaveLayoutRequest,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Saving form layout', { 
    crfVersionId: request.crfVersionId, 
    columnCount: request.columnCount,
    fieldCount: request.fields.length,
    userId 
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ensure acc_form_layout table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS acc_form_layout (
        form_layout_id SERIAL PRIMARY KEY,
        crf_version_id INTEGER NOT NULL REFERENCES crf_version(crf_version_id),
        column_count INTEGER NOT NULL DEFAULT 1 CHECK (column_count IN (1, 2, 3)),
        date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        owner_id INTEGER REFERENCES user_account(user_id),
        update_id INTEGER REFERENCES user_account(user_id),
        UNIQUE(crf_version_id)
      )
    `);

    // Upsert layout configuration
    await client.query(`
      INSERT INTO acc_form_layout (crf_version_id, column_count, owner_id, date_created)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (crf_version_id) 
      DO UPDATE SET 
        column_count = EXCLUDED.column_count,
        date_updated = NOW(),
        update_id = $3
    `, [request.crfVersionId, request.columnCount, userId]);

    // Update each field's column position
    for (const field of request.fields) {
      await client.query(`
        UPDATE item_form_metadata 
        SET column_number = $1, ordinal = $2
        WHERE item_form_metadata_id = $3
      `, [field.columnNumber, field.ordinal || 0, field.itemFormMetadataId]);
    }

    // Log audit event
    await client.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id, new_value
      ) VALUES (
        NOW(), 'crf_version', $1, $2, 'Form Layout Updated', 2, $3
      )
    `, [userId, request.crfVersionId, JSON.stringify({ columnCount: request.columnCount })]);

    await client.query('COMMIT');

    logger.info('Form layout saved successfully', { crfVersionId: request.crfVersionId });
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Save form layout error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Update a single field's layout position
 */
export const updateFieldLayout = async (
  itemFormMetadataId: number,
  columnNumber: number,
  ordinal: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating field layout', { itemFormMetadataId, columnNumber, ordinal, userId });

  try {
    const result = await pool.query(`
      UPDATE item_form_metadata 
      SET column_number = $1, ordinal = $2
      WHERE item_form_metadata_id = $3
      RETURNING item_id
    `, [columnNumber, ordinal, itemFormMetadataId]);

    if (result.rowCount === 0) {
      return { success: false, message: 'Field not found' };
    }

    return { success: true };
  } catch (error: any) {
    logger.error('Update field layout error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// HELPERS
// ============================================================================

function mapDataTypeToFieldType(dataTypeCode: string, responseTypeId?: number): string {
  // Handle response types first
  if (responseTypeId) {
    const responseTypeMap: Record<number, string> = {
      1: 'text',      // text
      2: 'textarea',  // textarea
      3: 'checkbox',  // checkbox
      4: 'file',      // file
      5: 'radio',     // radio
      6: 'select',    // single-select
      7: 'multiselect', // multi-select
      8: 'calculation', // calculation
      9: 'calculation', // group-calculation
      10: 'barcode'   // instant-calculation
    };
    return responseTypeMap[responseTypeId] || 'text';
  }

  // Fall back to data type
  const dataTypeMap: Record<string, string> = {
    'ST': 'text',
    'INT': 'number',
    'REAL': 'decimal',
    'DATE': 'date',
    'PDATE': 'date',
    'FILE': 'file',
    'BL': 'checkbox',
    'BN': 'checkbox'
  };

  return dataTypeMap[dataTypeCode?.toUpperCase()] || 'text';
}

/**
 * Get layout for rendering a form (used by form preview/fill)
 * Returns fields organized by columns and rows
 */
export const getFormLayoutForRendering = async (
  crfVersionId: number
): Promise<{ 
  success: boolean; 
  data?: { 
    columnCount: number; 
    rows: Array<{
      rowNumber: number;
      columns: Array<FormFieldLayout | null>;
    }>;
  }; 
  message?: string 
}> => {
  const layoutResult = await getFormLayout(crfVersionId);
  
  if (!layoutResult.success || !layoutResult.data) {
    return { success: false, message: layoutResult.message };
  }

  const { columnCount, fields } = layoutResult.data;

  // Group fields by row
  const rowMap = new Map<number, FormFieldLayout[]>();
  
  fields.forEach(field => {
    const rowNum = field.rowNumber || 1;
    if (!rowMap.has(rowNum)) {
      rowMap.set(rowNum, []);
    }
    rowMap.get(rowNum)!.push(field);
  });

  // Build rows array
  const rows: Array<{ rowNumber: number; columns: Array<FormFieldLayout | null> }> = [];
  
  const sortedRowNumbers = Array.from(rowMap.keys()).sort((a, b) => a - b);
  
  for (const rowNumber of sortedRowNumbers) {
    const rowFields = rowMap.get(rowNumber) || [];
    const columns: Array<FormFieldLayout | null> = new Array(columnCount).fill(null);
    
    rowFields.forEach(field => {
      const colIndex = Math.min(field.columnNumber - 1, columnCount - 1);
      columns[colIndex] = field;
    });
    
    rows.push({ rowNumber, columns });
  }

  return {
    success: true,
    data: { columnCount, rows }
  };
};

export default {
  getFormLayout,
  saveFormLayout,
  updateFieldLayout,
  getFormLayoutForRendering
};

