/**
 * File Uploads Service
 * 
 * Manages file uploads for CRF fields (response_type = 4)
 * Files are stored locally and referenced in the file_uploads table.
 * Also integrates with LibreClinica's crf_version_media table.
 * 
 * 21 CFR Part 11 Compliant:
 * - Audit trail for uploads/deletions
 * - File integrity verification (checksum)
 * - User tracking
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { UploadedFile } from '@accura-trial/shared-types';

// Track if table has been initialized
let tableInitialized = false;

/**
 * Initialize the file_uploads table if it doesn't exist
 */
export const initializeFileUploadsTable = async (): Promise<boolean> => {
  if (tableInitialized) {
    return true;
  }

  // Table is created by startup migrations (config/migrations.ts).
  // Just check if it exists.
  try {
    const checkResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'file_uploads'
      )
    `);
    if (checkResult.rows[0].exists) {
      tableInitialized = true;
      return true;
    }
    logger.warn('file_uploads table does not exist yet — run startup migrations');
    return false;
  } catch (error: any) {
    logger.error('Failed to check file_uploads table:', error.message);
    return false;
  }
};

/**
 * Get all files for an item
 */
export const getFilesForItem = async (itemId: number): Promise<UploadedFile[]> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT * FROM file_uploads
     WHERE item_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [itemId]
  );
  return result.rows.map(mapRow);
};

/**
 * Get all files for a CRF version
 */
export const getFilesForCrfVersion = async (crfVersionId: number): Promise<UploadedFile[]> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT * FROM file_uploads
     WHERE crf_version_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [crfVersionId]
  );
  return result.rows.map(mapRow);
};

/**
 * Get file by ID
 */
export const getFileById = async (fileId: string): Promise<UploadedFile | null> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT * FROM file_uploads
     WHERE file_id = $1 AND deleted_at IS NULL`,
    [fileId]
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
};

/**
 * Soft delete a file
 */
export const softDeleteFile = async (fileId: string, deletedBy: number): Promise<boolean> => {
  await initializeFileUploadsTable();
  
  const result = await pool.query(`
    UPDATE file_uploads
    SET deleted_at = NOW(), deleted_by = $2
    WHERE file_id = $1
    RETURNING file_id
  `, [fileId, deletedBy]);
  
  return result.rows.length > 0;
};

/**
 * Verify file integrity by checksum
 */
export const verifyFileIntegrity = async (fileId: string, checksum: string): Promise<boolean> => {
  await initializeFileUploadsTable();
  
  const result = await pool.query(`
    SELECT checksum FROM file_uploads
    WHERE file_id = $1 AND deleted_at IS NULL
  `, [fileId]);
  
  if (result.rows.length === 0) {
    return false;
  }
  
  return result.rows[0].checksum === checksum;
};

// ─── Write operations ──────────────────────────────────────────────────────

export interface InsertFileUploadParams {
  fileId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  crfVersionId?: number | null;
  itemId?: number | null;
  crfVersionMediaId?: number | null;
  eventCrfId?: number | null;
  studySubjectId?: number | null;
  consentId?: number | null;
  uploadedBy: number;
}

/**
 * Insert a record into crf_version_media and return its id.
 * Uses the provided transactional client so callers can wrap in BEGIN/COMMIT.
 */
export const insertCrfVersionMedia = async (
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  crfVersionId: number,
  name: string,
  filePath: string
): Promise<number | null> => {
  const result = await client.query(
    `INSERT INTO crf_version_media (crf_version_id, name, path)
     VALUES ($1, $2, $3)
     RETURNING crf_version_media_id`,
    [crfVersionId, name, filePath]
  );
  return result.rows[0]?.crfVersionMediaId as number | null;
};

/**
 * Insert a file_uploads record. Uses the provided transactional client.
 */
export const insertFileUpload = async (
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  params: InsertFileUploadParams
): Promise<void> => {
  await client.query(
    `INSERT INTO file_uploads (
       file_id, original_name, stored_name, file_path, mime_type,
       file_size, checksum, crf_version_id, item_id, crf_version_media_id,
       event_crf_id, study_subject_id, consent_id,
       uploaded_by, uploaded_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
     ON CONFLICT (file_id) DO NOTHING`,
    [
      params.fileId,
      params.originalName,
      params.storedName,
      params.storedName,
      params.mimeType,
      params.fileSize,
      params.checksum,
      params.crfVersionId ?? null,
      params.itemId ?? null,
      params.crfVersionMediaId ?? null,
      params.eventCrfId ?? null,
      params.studySubjectId ?? null,
      params.consentId ?? null,
      params.uploadedBy,
    ]
  );
};

// ─── Read operations (download / thumbnail) ────────────────────────────────

export interface FileDownloadRecord {
  storedName: string;
  originalName: string;
  mimeType: string;
  filePath: string;
}

/**
 * Get the stored-name, original-name and mime-type needed for a file download.
 */
export const getFileForDownload = async (fileId: string): Promise<FileDownloadRecord | null> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT stored_name, original_name, mime_type, file_path
     FROM file_uploads
     WHERE file_id = $1 AND deleted_at IS NULL`,
    [fileId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    storedName: row.storedName as string,
    originalName: row.originalName as string,
    mimeType: row.mimeType as string,
    filePath: row.filePath as string,
  };
};

/**
 * Get image file info for thumbnail generation.
 */
export const getImageFile = async (fileId: string): Promise<FileDownloadRecord | null> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT stored_name, file_path, mime_type, original_name
     FROM file_uploads
     WHERE file_id = $1 AND deleted_at IS NULL AND mime_type LIKE 'image/%'`,
    [fileId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    storedName: row.storedName as string,
    originalName: row.originalName as string,
    mimeType: row.mimeType as string,
    filePath: row.filePath as string,
  };
};

// ─── List queries by foreign key ───────────────────────────────────────────

export const getFilesByEventCrf = async (eventCrfId: number): Promise<UploadedFile[]> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT * FROM file_uploads
     WHERE event_crf_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [eventCrfId]
  );
  return result.rows.map(mapRow);
};

export const getFilesByConsent = async (consentId: number): Promise<UploadedFile[]> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT * FROM file_uploads
     WHERE consent_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [consentId]
  );
  return result.rows.map(mapRow);
};

// ─── Delete helpers ────────────────────────────────────────────────────────

export interface FileDeleteRecord {
  storedName: string;
  filePath: string;
  crfVersionMediaId: number | null;
}

/**
 * Fetch just the fields needed before deleting a file.
 */
export const getFileForDeletion = async (fileId: string): Promise<FileDeleteRecord | null> => {
  await initializeFileUploadsTable();
  const result = await pool.query(
    `SELECT stored_name, file_path, crf_version_media_id
     FROM file_uploads
     WHERE file_id = $1 AND deleted_at IS NULL`,
    [fileId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    storedName: row.storedName as string,
    filePath: row.filePath as string,
    crfVersionMediaId: (row.crfVersionMediaId as number) ?? null,
  };
};

/**
 * Soft-delete a file and optionally remove the CRF version media record.
 * Uses the provided transactional client.
 */
export const deleteFileAndMedia = async (
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  fileId: string,
  deletedBy: number,
  crfVersionMediaId: number | null
): Promise<void> => {
  await client.query(
    `UPDATE file_uploads SET deleted_at = NOW(), deleted_by = $2
     WHERE file_id = $1`,
    [fileId, deletedBy]
  );
  if (crfVersionMediaId) {
    await client.query(
      'DELETE FROM crf_version_media WHERE crf_version_media_id = $1',
      [crfVersionMediaId]
    );
  }
};

/**
 * Transactional single-file upload: inserts CRF media + file record in one tx.
 */
export const uploadFileTransaction = async (
  params: InsertFileUploadParams,
  crfVersionId: number | null,
  originalName: string,
  storedName: string,
): Promise<number | null> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let crfVersionMediaId: number | null = null;
    if (crfVersionId) {
      crfVersionMediaId = await insertCrfVersionMedia(client, crfVersionId, originalName, storedName);
    }

    await insertFileUpload(client, { ...params, crfVersionMediaId });
    await client.query('COMMIT');
    return crfVersionMediaId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Transactional batch file upload.
 */
export const uploadBatchTransaction = async (
  files: Array<{ params: InsertFileUploadParams; crfVersionId: number | null; originalName: string; storedName: string }>,
): Promise<Array<number | null>> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mediaIds: Array<number | null> = [];

    for (const file of files) {
      let crfVersionMediaId: number | null = null;
      if (file.crfVersionId) {
        crfVersionMediaId = await insertCrfVersionMedia(client, file.crfVersionId, file.originalName, file.storedName);
      }
      await insertFileUpload(client, { ...file.params, crfVersionMediaId });
      mediaIds.push(crfVersionMediaId);
    }

    await client.query('COMMIT');
    return mediaIds;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Transactional file deletion: soft-deletes record + removes CRF media row.
 */
export const deleteFileTransaction = async (
  fileId: string,
  deletedBy: number,
  crfVersionMediaId: number | null,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteFileAndMedia(client, fileId, deletedBy, crfVersionMediaId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ─── Shared row mapper ─────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): UploadedFile {
  return {
    fileId: row.fileId as string,
    originalName: row.originalName as string,
    storedName: row.storedName as string,
    filePath: row.filePath as string,
    mimeType: row.mimeType as string,
    fileSize: row.fileSize as number,
    checksum: row.checksum as string,
    crfVersionId: row.crfVersionId as number | undefined,
    itemId: row.itemId as number | undefined,
    crfVersionMediaId: row.crfVersionMediaId as number | undefined,
    uploadedBy: row.uploadedBy as number,
    uploadedAt: row.uploadedAt as Date,
  };
}

// Initialize table on module load
initializeFileUploadsTable().catch(err => {
  logger.error('Failed to initialize file_uploads table on startup', { error: err.message });
});

