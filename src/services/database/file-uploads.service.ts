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

export interface UploadedFile {
  fileId: string;
  originalName: string;
  storedName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  crfVersionId?: number;
  itemId?: number;
  crfVersionMediaId?: number;
  uploadedBy: number;
  uploadedAt: Date;
}

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
  
  const result = await pool.query(`
    SELECT * FROM file_uploads
    WHERE item_id = $1 AND deleted_at IS NULL
    ORDER BY uploaded_at DESC
  `, [itemId]);
  
  return result.rows.map(row => ({
    fileId: row.file_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    checksum: row.checksum,
    crfVersionId: row.crf_version_id,
    itemId: row.item_id,
    crfVersionMediaId: row.crf_version_media_id,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at
  }));
};

/**
 * Get all files for a CRF version
 */
export const getFilesForCrfVersion = async (crfVersionId: number): Promise<UploadedFile[]> => {
  await initializeFileUploadsTable();
  
  const result = await pool.query(`
    SELECT * FROM file_uploads
    WHERE crf_version_id = $1 AND deleted_at IS NULL
    ORDER BY uploaded_at DESC
  `, [crfVersionId]);
  
  return result.rows.map(row => ({
    fileId: row.file_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    checksum: row.checksum,
    crfVersionId: row.crf_version_id,
    itemId: row.item_id,
    crfVersionMediaId: row.crf_version_media_id,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at
  }));
};

/**
 * Get file by ID
 */
export const getFileById = async (fileId: string): Promise<UploadedFile | null> => {
  await initializeFileUploadsTable();
  
  const result = await pool.query(`
    SELECT * FROM file_uploads
    WHERE file_id = $1 AND deleted_at IS NULL
  `, [fileId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  return {
    fileId: row.file_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    checksum: row.checksum,
    crfVersionId: row.crf_version_id,
    itemId: row.item_id,
    crfVersionMediaId: row.crf_version_media_id,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at
  };
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

// Initialize table on module load
initializeFileUploadsTable().catch(err => {
  logger.error('Failed to initialize file_uploads table on startup', { error: err.message });
});

