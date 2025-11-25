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
      ORDER BY revision_notes DESC
      LIMIT 1
    `;
    const versionResult = await pool.query(versionQuery, [crfId]);

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
    const itemGroupsResult = await pool.query(itemGroupsQuery, [versionResult.rows[0]?.crf_version_id]);

    return {
      crf,
      version: versionResult.rows[0],
      itemGroups: itemGroupsResult.rows
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

export default {
  saveFormData,
  getFormData,
  getFormMetadata,
  getFormStatus,
  validateFormData,
  getStudyForms,
  getAllForms,
  getFormById
};

