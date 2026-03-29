/**
 * Form Folder Service
 * 
 * Visual-only folder organization for forms in the dashboard.
 * Does not affect form behavior, assignments, or clinical data.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';

export interface FormFolder {
  folder_id: number;
  name: string;
  description?: string;
  study_id?: number;
  owner_id: number;
  sort_order: number;
  date_created: string;
  date_updated: string;
  form_count?: number;
  crf_ids?: number[];
}

export interface FormFolderItem {
  folder_item_id: number;
  folder_id: number;
  crf_id: number;
  sort_order: number;
  date_added: string;
}

export const getFolders = async (studyId?: number, userId?: number): Promise<FormFolder[]> => {
  const result = await pool.query(`
    SELECT 
      f.folder_id, f.name, f.description, f.study_id, f.owner_id,
      f.sort_order, f.date_created, f.date_updated,
      COUNT(DISTINCT fi.crf_id)::int AS form_count,
      COALESCE(ARRAY_AGG(DISTINCT fi.crf_id ORDER BY fi.crf_id) FILTER (WHERE fi.crf_id IS NOT NULL), '{}') AS crf_ids
    FROM acc_form_folder f
    LEFT JOIN acc_form_folder_item fi ON f.folder_id = fi.folder_id
    WHERE ($1::int IS NULL OR f.study_id = $1 OR f.study_id IS NULL)
    GROUP BY f.folder_id
    ORDER BY f.sort_order, f.name
  `, [studyId || null]);

  return result.rows;
};

export const getFolderById = async (folderId: number): Promise<FormFolder | null> => {
  const result = await pool.query(`
    SELECT 
      f.folder_id, f.name, f.description, f.study_id, f.owner_id,
      f.sort_order, f.date_created, f.date_updated,
      COUNT(DISTINCT fi.crf_id)::int AS form_count,
      COALESCE(ARRAY_AGG(DISTINCT fi.crf_id ORDER BY fi.crf_id) FILTER (WHERE fi.crf_id IS NOT NULL), '{}') AS crf_ids
    FROM acc_form_folder f
    LEFT JOIN acc_form_folder_item fi ON f.folder_id = fi.folder_id
    WHERE f.folder_id = $1
    GROUP BY f.folder_id
  `, [folderId]);

  return result.rows[0] || null;
};

export const createFolder = async (
  name: string,
  userId: number,
  studyId?: number,
  description?: string
): Promise<FormFolder> => {
  logger.info('Creating form folder', { name, userId, studyId });

  const maxOrder = await pool.query(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM acc_form_folder
    WHERE ($1::int IS NULL OR study_id = $1 OR study_id IS NULL)
  `, [studyId || null]);

  const result = await pool.query(`
    INSERT INTO acc_form_folder (name, description, study_id, owner_id, sort_order)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING folder_id, name, description, study_id, owner_id, sort_order, date_created, date_updated
  `, [name, description || null, studyId || null, userId, maxOrder.rows[0].next_order]);

  return { ...result.rows[0], form_count: 0, crf_ids: [] };
};

export const updateFolder = async (
  folderId: number,
  data: { name?: string; description?: string }
): Promise<FormFolder | null> => {
  logger.info('Updating form folder', { folderId, data });

  const setClauses: string[] = ['date_updated = NOW()'];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    values.push(data.description);
  }

  values.push(folderId);

  await pool.query(
    `UPDATE acc_form_folder SET ${setClauses.join(', ')} WHERE folder_id = $${paramIndex}`,
    values
  );

  return getFolderById(folderId);
};

export const deleteFolder = async (folderId: number): Promise<{ success: boolean; message: string }> => {
  logger.info('Deleting form folder', { folderId });

  // CASCADE on the FK will remove folder items automatically
  const result = await pool.query(
    `DELETE FROM acc_form_folder WHERE folder_id = $1`,
    [folderId]
  );

  if (result.rowCount === 0) {
    return { success: false, message: 'Folder not found' };
  }

  return { success: true, message: 'Folder deleted' };
};

export const addFormToFolder = async (folderId: number, crfId: number): Promise<FormFolderItem> => {
  logger.info('Adding form to folder', { folderId, crfId });

  const maxOrder = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM acc_form_folder_item WHERE folder_id = $1`,
    [folderId]
  );

  const result = await pool.query(`
    INSERT INTO acc_form_folder_item (folder_id, crf_id, sort_order)
    VALUES ($1, $2, $3)
    ON CONFLICT (folder_id, crf_id) DO NOTHING
    RETURNING folder_item_id, folder_id, crf_id, sort_order, date_added
  `, [folderId, crfId, maxOrder.rows[0].next_order]);

  return result.rows[0];
};

export const removeFormFromFolder = async (folderId: number, crfId: number): Promise<boolean> => {
  logger.info('Removing form from folder', { folderId, crfId });

  const result = await pool.query(
    `DELETE FROM acc_form_folder_item WHERE folder_id = $1 AND crf_id = $2`,
    [folderId, crfId]
  );

  return (result.rowCount || 0) > 0;
};

export const moveAllFormsOut = async (folderId: number): Promise<number> => {
  logger.info('Moving all forms out of folder', { folderId });

  const result = await pool.query(
    `DELETE FROM acc_form_folder_item WHERE folder_id = $1`,
    [folderId]
  );

  return result.rowCount || 0;
};
