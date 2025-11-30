/**
 * Form Service (Hybrid)
 * 
 * Form data management combining SOAP and Database
 * - Use SOAP for saving form data (GxP compliant with validation)
 * - Use Database for reading form data (faster)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as dataSoap from '../soap/dataSoap.service';
import { FormDataRequest, ApiResponse } from '../../types';

/**
 * Save form data via SOAP (GxP compliant)
 */
export const saveFormData = async (
  request: FormDataRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Saving form data', { request, userId });

  // Use SOAP service for GxP-compliant data entry
  return await dataSoap.importData(request, userId, username);
};

/**
 * Get form data from database
 */
export const getFormData = async (eventCrfId: number): Promise<any> => {
  logger.info('Getting form data', { eventCrfId });

  try {
    const query = `
      SELECT 
        id.item_data_id,
        i.name as item_name,
        i.oc_oid as item_oid,
        id.value,
        id.status_id,
        id.date_created,
        id.date_updated,
        u.user_name as entered_by
      FROM item_data id
      INNER JOIN item i ON id.item_id = i.item_id
      LEFT JOIN user_account u ON id.owner_id = u.user_id
      WHERE id.event_crf_id = $1
        AND id.deleted = false
      ORDER BY i.name
    `;

    const result = await pool.query(query, [eventCrfId]);

    return result.rows;
  } catch (error: any) {
    logger.error('Get form data error', { error: error.message });
    throw error;
  }
};

/**
 * Get form metadata
 */
export const getFormMetadata = async (crfId: number): Promise<any> => {
  logger.info('Getting form metadata', { crfId });

  try {
    // Get CRF info
    const crfQuery = `
      SELECT * FROM crf WHERE crf_id = $1
    `;
    const crfResult = await pool.query(crfQuery, [crfId]);

    if (crfResult.rows.length === 0) {
      return null;
    }

    const crf = crfResult.rows[0];

    // Get latest version
    const versionQuery = `
      SELECT * FROM crf_version
      WHERE crf_id = $1
      ORDER BY crf_version_id DESC
      LIMIT 1
    `;
    const versionResult = await pool.query(versionQuery, [crfId]);
    const versionId = versionResult.rows[0]?.crf_version_id;

    // Get item groups
    const itemGroupsQuery = `
      SELECT DISTINCT
        ig.item_group_id,
        ig.name,
        ig.oc_oid
      FROM item_group ig
      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
      WHERE igm.crf_version_id = $1
      ORDER BY ig.name
    `;
    const itemGroupsResult = await pool.query(itemGroupsQuery, [versionId]);

    // Get items with their metadata
    const itemsQuery = `
      SELECT 
        i.item_id,
        i.name,
        i.description,
        i.units,
        i.oc_oid,
        idt.name as data_type,
        idt.code as data_type_code,
        igm.ordinal,
        ig.name as group_name
      FROM item i
      INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
      INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id
      INNER JOIN item_data_type idt ON i.item_data_type_id = idt.item_data_type_id
      WHERE igm.crf_version_id = $1
      ORDER BY igm.ordinal
    `;
    const itemsResult = await pool.query(itemsQuery, [versionId]);

    return {
      crf,
      version: versionResult.rows[0],
      itemGroups: itemGroupsResult.rows,
      items: itemsResult.rows
    };
  } catch (error: any) {
    logger.error('Get form metadata error', { error: error.message });
    throw error;
  }
};

/**
 * Get form status
 */
export const getFormStatus = async (eventCrfId: number): Promise<any> => {
  logger.info('Getting form status', { eventCrfId });

  try {
    const query = `
      SELECT 
        ec.event_crf_id,
        ec.completion_status_id,
        cs.name as completion_status,
        ec.date_created,
        ec.date_updated,
        u1.user_name as created_by,
        u2.user_name as updated_by,
        ec.validator_id,
        u3.user_name as validated_by,
        ec.date_validate,
        ec.sdv_status
      FROM event_crf ec
      INNER JOIN completion_status cs ON ec.completion_status_id = cs.completion_status_id
      LEFT JOIN user_account u1 ON ec.owner_id = u1.user_id
      LEFT JOIN user_account u2 ON ec.update_id = u2.user_id
      LEFT JOIN user_account u3 ON ec.validator_id = u3.user_id
      WHERE ec.event_crf_id = $1
    `;

    const result = await pool.query(query, [eventCrfId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get form status error', { error: error.message });
    throw error;
  }
};

/**
 * Validate form data (business rules)
 */
export const validateFormData = (formData: Record<string, any>): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Basic validation (extend as needed)
  if (!formData || Object.keys(formData).length === 0) {
    errors.push('Form data is empty');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get all CRFs (Form Templates) for a study
 */
export const getStudyForms = async (studyId: number): Promise<any[]> => {
  logger.info('Getting study forms', { studyId });

  try {
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        c.oc_oid,
        c.status_id,
        s.name as status_name,
        c.date_created,
        c.date_updated,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count,
        (SELECT name FROM crf_version WHERE crf_id = c.crf_id ORDER BY crf_version_id DESC LIMIT 1) as latest_version
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      WHERE c.source_study_id = $1
      ORDER BY c.name
    `;

    const result = await pool.query(query, [studyId]);
    return result.rows;
  } catch (error: any) {
    logger.error('Get study forms error', { error: error.message });
    throw error;
  }
};

/**
 * Get all available CRFs (templates)
 */
export const getAllForms = async (): Promise<any[]> => {
  logger.info('Getting all forms');

  try {
    const query = `
      SELECT 
        c.crf_id,
        c.name,
        c.description,
        c.oc_oid,
        c.status_id,
        s.name as status_name,
        st.name as study_name,
        c.date_created,
        c.date_updated,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.status_id = 1
      ORDER BY c.name
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error: any) {
    logger.error('Get all forms error', { error: error.message });
    throw error;
  }
};

/**
 * Get CRF by ID
 */
export const getFormById = async (crfId: number): Promise<any> => {
  logger.info('Getting form by ID', { crfId });

  try {
    const query = `
      SELECT 
        c.*,
        s.name as status_name,
        st.name as study_name,
        (SELECT COUNT(*) FROM crf_version WHERE crf_id = c.crf_id) as version_count
      FROM crf c
      INNER JOIN status s ON c.status_id = s.status_id
      LEFT JOIN study st ON c.source_study_id = st.study_id
      WHERE c.crf_id = $1
    `;

    const result = await pool.query(query, [crfId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('Get form by ID error', { error: error.message });
    throw error;
  }
};

/**
 * Create a new form template (CRF)
 */
export const createForm = async (
  data: {
    name: string;
    description?: string;
    studyId?: number;
  },
  userId: number
): Promise<{ success: boolean; crfId?: number; message?: string }> => {
  logger.info('Creating form template', { name: data.name, userId });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate OC OID
    const ocOid = `F_${data.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 30)}`;

    // Check if OC OID exists
    const existsCheck = await client.query(
      `SELECT crf_id FROM crf WHERE oc_oid = $1`,
      [ocOid]
    );

    if (existsCheck.rows.length > 0) {
      return {
        success: false,
        message: 'A form with this name already exists'
      };
    }

    // Insert CRF
    const crfResult = await client.query(`
      INSERT INTO crf (
        name, description, status_id, owner_id, date_created, oc_oid, source_study_id
      ) VALUES (
        $1, $2, 1, $3, NOW(), $4, $5
      )
      RETURNING crf_id
    `, [
      data.name,
      data.description || '',
      userId,
      ocOid,
      data.studyId || null
    ]);

    const crfId = crfResult.rows[0].crf_id;

    // Create initial version
    const versionOid = `${ocOid}_V1`;
    await client.query(`
      INSERT INTO crf_version (
        crf_id, name, description, status_id, owner_id, date_created, oc_oid
      ) VALUES (
        $1, 'v1.0', $2, 1, $3, NOW(), $4
      )
    `, [
      crfId,
      data.description || 'Initial version',
      userId,
      versionOid
    ]);

    await client.query('COMMIT');

    logger.info('Form template created successfully', { crfId, name: data.name });

    return {
      success: true,
      crfId,
      message: 'Form template created successfully'
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Create form error', { error: error.message });

    return {
      success: false,
      message: `Failed to create form: ${error.message}`
    };
  } finally {
    client.release();
  }
};

/**
 * Update a form template
 */
export const updateForm = async (
  crfId: number,
  data: {
    name?: string;
    description?: string;
  },
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Updating form template', { crfId, userId });

  try {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(data.description);
    }

    updates.push(`date_updated = NOW()`);
    updates.push(`update_id = $${paramIndex++}`);
    params.push(userId);

    params.push(crfId);

    const query = `
      UPDATE crf
      SET ${updates.join(', ')}
      WHERE crf_id = $${paramIndex}
    `;

    await pool.query(query, params);

    logger.info('Form template updated successfully', { crfId });

    return {
      success: true,
      message: 'Form template updated successfully'
    };
  } catch (error: any) {
    logger.error('Update form error', { error: error.message });

    return {
      success: false,
      message: `Failed to update form: ${error.message}`
    };
  }
};

/**
 * Delete a form template (soft delete by changing status)
 */
export const deleteForm = async (
  crfId: number,
  userId: number
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Deleting form template', { crfId, userId });

  try {
    // Check if form is in use
    const usageCheck = await pool.query(`
      SELECT COUNT(*) as count FROM event_crf ec
      JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      WHERE cv.crf_id = $1
    `, [crfId]);

    if (parseInt(usageCheck.rows[0].count) > 0) {
      return {
        success: false,
        message: 'Cannot delete form - it is being used by subjects'
      };
    }

    // Set status to removed (status_id = 5 typically)
    await pool.query(`
      UPDATE crf
      SET status_id = 5, date_updated = NOW(), update_id = $1
      WHERE crf_id = $2
    `, [userId, crfId]);

    logger.info('Form template deleted successfully', { crfId });

    return {
      success: true,
      message: 'Form template deleted successfully'
    };
  } catch (error: any) {
    logger.error('Delete form error', { error: error.message });

    return {
      success: false,
      message: `Failed to delete form: ${error.message}`
    };
  }
};

export default {
  saveFormData,
  getFormData,
  getFormMetadata,
  getFormStatus,
  validateFormData,
  getStudyForms,
  getAllForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm
};

