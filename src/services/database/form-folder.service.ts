/**
 * Form Folder Service
 * 
 * Visual-only folder organization for forms in the dashboard.
 * Does not affect form behavior, assignments, or clinical data.
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { ForbiddenError } from '../../middleware/errorHandler.middleware';

export interface FormFolder {
  folderId: number;
  name: string;
  description?: string;
  studyId?: number;
  ownerId: number;
  sortOrder: number;
  parentFolderId?: number | null;
  dateCreated: string;
  dateUpdated: string;
  formCount?: number;
  crfIds?: number[];
  childCount?: number;
}

export interface FormFolderItem {
  folderItemId: number;
  folderId: number;
  crfId: number;
  sortOrder: number;
  dateAdded: string;
}

export const getFolders = async (studyId?: number, userId?: number, parentFolderId?: number | null, organizationIds?: number[]): Promise<FormFolder[]> => {
  const conditions = ['($1::int IS NULL OR f.study_id = $1 OR f.study_id IS NULL)'];
  const params: any[] = [studyId || null];

  // Organization scoping: only return folders belonging to the caller's org(s)
  if (organizationIds && organizationIds.length > 0) {
    params.push(organizationIds);
    conditions.push(`(f.organization_id = ANY($${params.length}::int[]) OR f.organization_id IS NULL)`);
  }

  if (parentFolderId === null || parentFolderId === undefined) {
    // No filter on parent — return all folders
  } else if (parentFolderId === 0) {
    // Explicit root: only folders with no parent
    conditions.push('f.parent_folder_id IS NULL');
  } else {
    conditions.push(`f.parent_folder_id = $${params.length + 1}`);
    params.push(parentFolderId);
  }

  const result = await pool.query(`
    SELECT 
      f.folder_id, f.name, f.description, f.study_id, f.owner_id,
      f.sort_order, f.parent_folder_id, f.date_created, f.date_updated,
      COUNT(DISTINCT fi.crf_id)::int AS form_count,
      COALESCE(ARRAY_AGG(DISTINCT fi.crf_id ORDER BY fi.crf_id) FILTER (WHERE fi.crf_id IS NOT NULL), '{}') AS crf_ids,
      (SELECT COUNT(*)::int FROM acc_form_folder cf WHERE cf.parent_folder_id = f.folder_id) AS child_count
    FROM acc_form_folder f
    LEFT JOIN acc_form_folder_item fi ON f.folder_id = fi.folder_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY f.folder_id
    ORDER BY f.sort_order, f.name
  `, params);

  return result.rows;
};

export const getFolderById = async (folderId: number): Promise<FormFolder | null> => {
  const result = await pool.query(`
    SELECT 
      f.folder_id, f.name, f.description, f.study_id, f.owner_id,
      f.sort_order, f.parent_folder_id, f.organization_id, f.date_created, f.date_updated,
      COUNT(DISTINCT fi.crf_id)::int AS form_count,
      COALESCE(ARRAY_AGG(DISTINCT fi.crf_id ORDER BY fi.crf_id) FILTER (WHERE fi.crf_id IS NOT NULL), '{}') AS crf_ids,
      (SELECT COUNT(*)::int FROM acc_form_folder cf WHERE cf.parent_folder_id = f.folder_id) AS child_count
    FROM acc_form_folder f
    LEFT JOIN acc_form_folder_item fi ON f.folder_id = fi.folder_id
    WHERE f.folder_id = $1
    GROUP BY f.folder_id
  `, [folderId]);

  return result.rows[0] || null;
};

/**
 * Verify a folder belongs to one of the given organizationIds.
 * Throws if access is denied.
 */
export const assertFolderOrgAccess = async (folderId: number, organizationIds?: number[]): Promise<void> => {
  if (!organizationIds || organizationIds.length === 0) return;
  const result = await pool.query(
    `SELECT organization_id FROM acc_form_folder WHERE folder_id = $1`,
    [folderId]
  );
  if (result.rows.length === 0) return; // Will 404 downstream
  const folderOrgId = result.rows[0].organizationId;
  if (folderOrgId !== null && !organizationIds.includes(folderOrgId)) {
    throw new ForbiddenError('Folder belongs to a different organization');
  }
};

export const createFolder = async (
  name: string,
  userId: number,
  studyId?: number,
  description?: string,
  parentFolderId?: number | null,
  organizationId?: number
): Promise<FormFolder> => {
  logger.info('Creating form folder', { name, userId, studyId, parentFolderId, organizationId });

  // Validate depth limit (max 4 levels)
  if (parentFolderId) {
    const depth = await getFolderDepth(parentFolderId);
    if (depth >= 4) {
      throw new Error('Maximum folder depth (4 levels) reached. Cannot create a subfolder here.');
    }
  }

  const maxOrder = await pool.query(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM acc_form_folder
    WHERE ($1::int IS NULL OR study_id = $1 OR study_id IS NULL)
  `, [studyId || null]);

  const result = await pool.query(`
    INSERT INTO acc_form_folder (name, description, study_id, owner_id, sort_order, parent_folder_id, organization_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING folder_id, name, description, study_id, owner_id, sort_order, parent_folder_id, organization_id, date_created, date_updated
  `, [name, description || null, studyId || null, userId, maxOrder.rows[0].nextOrder, parentFolderId || null, organizationId || null]);

  return { ...result.rows[0], formCount: 0, crfIds: [], childCount: 0 };
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
  `, [folderId, crfId, maxOrder.rows[0].nextOrder]);

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

/**
 * Get the depth of a folder (1-based: root children are depth 1).
 * Uses a recursive CTE to walk up the ancestor chain.
 */
export const getFolderDepth = async (folderId: number): Promise<number> => {
  const result = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT folder_id, parent_folder_id, 1 AS depth
      FROM acc_form_folder WHERE folder_id = $1
      UNION ALL
      SELECT f.folder_id, f.parent_folder_id, a.depth + 1
      FROM acc_form_folder f
      JOIN ancestors a ON f.folder_id = a.parent_folder_id
    )
    SELECT MAX(depth) AS current_depth FROM ancestors
  `, [folderId]);
  return parseInt(result.rows[0]?.currentDepth) || 0;
};

/**
 * Move a folder to a new parent. Validates depth limit and circular refs.
 * parentFolderId=null moves the folder to root.
 */
export const moveFolder = async (
  folderId: number,
  parentFolderId: number | null
): Promise<FormFolder | null> => {
  logger.info('Moving folder', { folderId, parentFolderId });

  if (parentFolderId === folderId) {
    throw new Error('A folder cannot be its own parent.');
  }

  // Prevent circular reference: target parent must not be a descendant of this folder
  if (parentFolderId) {
    const descCheck = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT folder_id FROM acc_form_folder WHERE parent_folder_id = $1
        UNION ALL
        SELECT f.folder_id FROM acc_form_folder f
        JOIN descendants d ON f.parent_folder_id = d.folder_id
      )
      SELECT 1 FROM descendants WHERE folder_id = $2 LIMIT 1
    `, [folderId, parentFolderId]);
    if (descCheck.rows.length > 0) {
      throw new Error('Cannot move a folder into one of its own descendants.');
    }

    // Validate depth: target parent depth + this folder's subtree depth must be <= 4
    const parentDepth = await getFolderDepth(parentFolderId);
    const subtreeDepth = await getSubtreeDepth(folderId);
    if (parentDepth + subtreeDepth > 4) {
      throw new Error(`Move would exceed the maximum folder depth (4 levels). Parent is at level ${parentDepth}, subtree is ${subtreeDepth} levels deep.`);
    }
  }

  await pool.query(
    `UPDATE acc_form_folder SET parent_folder_id = $1, date_updated = NOW() WHERE folder_id = $2`,
    [parentFolderId, folderId]
  );

  return getFolderById(folderId);
};

/**
 * Get the maximum depth of a folder's subtree (1 = no children, 2 = has children, etc.)
 */
export const getSubtreeDepth = async (folderId: number): Promise<number> => {
  const result = await pool.query(`
    WITH RECURSIVE subtree AS (
      SELECT folder_id, 1 AS depth FROM acc_form_folder WHERE folder_id = $1
      UNION ALL
      SELECT f.folder_id, s.depth + 1
      FROM acc_form_folder f
      JOIN subtree s ON f.parent_folder_id = s.folder_id
    )
    SELECT MAX(depth) AS max_depth FROM subtree
  `, [folderId]);
  return parseInt(result.rows[0]?.maxDepth) || 1;
};

/**
 * Move all subfolders of a folder to its parent (or root if parent is null).
 * Used before deleting a non-empty folder.
 */
export const moveChildrenToParent = async (folderId: number): Promise<number> => {
  const folder = await getFolderById(folderId);
  const targetParent = folder?.parentFolderId || null;

  const result = await pool.query(
    `UPDATE acc_form_folder SET parent_folder_id = $1, date_updated = NOW() WHERE parent_folder_id = $2`,
    [targetParent, folderId]
  );
  return result.rowCount || 0;
};
