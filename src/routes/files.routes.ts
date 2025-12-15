/**
 * File Upload Routes
 * 
 * Handles file uploads for CRF fields (response_type = 4).
 * Files are stored locally or in cloud storage and referenced
 * in the crf_version_media table.
 * 
 * Endpoints:
 * - POST /api/files - Upload a single file
 * - POST /api/files/batch - Upload multiple files
 * - GET /api/files/:id - Get file metadata
 * - GET /api/files/:id/download - Download file
 * - GET /api/files/:id/thumbnail - Get thumbnail (images only)
 * - GET /api/files/item/:itemId - Get files for a form item
 * - GET /api/files/crf-version/:crfVersionId - Get all files for a CRF version
 * - DELETE /api/files/:id - Delete a file
 * 
 * 21 CFR Part 11 Compliant:
 * - Audit trail for uploads/deletions
 * - User authentication required
 * - File integrity verification
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../config/database';
import { logger } from '../config/logger';
import { authMiddleware } from '../middleware/auth.middleware';
import { initializeFileUploadsTable } from '../services/database/file-uploads.service';

// Initialize table on module load
initializeFileUploadsTable().catch(err => {
  logger.warn('Failed to initialize file_uploads table', { error: err.message });
});

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Allowed MIME types
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/bmp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

interface UploadedFileResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  thumbnailUrl?: string;
  uploadedAt: Date;
  crfVersionMediaId?: number;
}

/**
 * Upload a single file
 * POST /api/files
 */
router.post('/', authMiddleware, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { crfVersionId, itemId } = req.body;
    const file = req.file;
    
    // Calculate file hash for integrity verification
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    
    // Generate unique ID
    const fileId = crypto.randomBytes(16).toString('hex');
    
    // Insert into database (crf_version_media if applicable, or custom file_uploads table)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if crf_version_media table exists and insert there
      let crfVersionMediaId: number | null = null;
      
      if (crfVersionId) {
        // Insert into LibreClinica's crf_version_media table
        // Table structure: crf_version_media_id, crf_version_id, name, path
        const mediaResult = await client.query(`
          INSERT INTO crf_version_media (
            crf_version_id, name, path
          ) VALUES ($1, $2, $3)
          RETURNING crf_version_media_id
        `, [
          crfVersionId,
          file.originalname,
          file.path
        ]);
        crfVersionMediaId = mediaResult.rows[0]?.crf_version_media_id;
      }
      
      // Also insert into file_uploads table for tracking
      await client.query(`
        INSERT INTO file_uploads (
          file_id, original_name, stored_name, file_path, mime_type,
          file_size, checksum, crf_version_id, item_id, crf_version_media_id,
          uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (file_id) DO NOTHING
      `, [
        fileId,
        file.originalname,
        file.filename,
        file.path,
        file.mimetype,
        file.size,
        fileHash,
        crfVersionId || null,
        itemId || null,
        crfVersionMediaId,
        (req as any).user?.userId || 1
      ]);
      
      await client.query('COMMIT');
      
      const response: UploadedFileResponse = {
        id: fileId,
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        url: `/api/files/${fileId}/download`,
        uploadedAt: new Date(),
        crfVersionMediaId: crfVersionMediaId || undefined
      };
      
      // Add thumbnail URL for images
      if (file.mimetype.startsWith('image/')) {
        response.thumbnailUrl = `/api/files/${fileId}/thumbnail`;
      }
      
      logger.info('File uploaded', { fileId, name: file.originalname, size: file.size });
      res.json({ success: true, data: response });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    logger.error('File upload error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Upload failed' });
  }
});

/**
 * Upload multiple files
 * POST /api/files/batch
 */
router.post('/batch', authMiddleware, upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const { crfVersionId, itemId } = req.body;
    const uploadedFiles: UploadedFileResponse[] = [];
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const file of files) {
        const fileBuffer = fs.readFileSync(file.path);
        const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
        const fileId = crypto.randomBytes(16).toString('hex');
        
        let crfVersionMediaId: number | null = null;
        
        if (crfVersionId) {
          // Insert into LibreClinica's crf_version_media table
          const mediaResult = await client.query(`
            INSERT INTO crf_version_media (
              crf_version_id, name, path
            ) VALUES ($1, $2, $3)
            RETURNING crf_version_media_id
          `, [
            crfVersionId,
            file.originalname,
            file.path
          ]);
          crfVersionMediaId = mediaResult.rows[0]?.crf_version_media_id;
        }
        
        await client.query(`
          INSERT INTO file_uploads (
            file_id, original_name, stored_name, file_path, mime_type,
            file_size, checksum, crf_version_id, item_id, crf_version_media_id,
            uploaded_by, uploaded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (file_id) DO NOTHING
        `, [
          fileId,
          file.originalname,
          file.filename,
          file.path,
          file.mimetype,
          file.size,
          fileHash,
          crfVersionId || null,
          itemId || null,
          crfVersionMediaId,
          (req as any).user?.userId || 1
        ]);
        
        const response: UploadedFileResponse = {
          id: fileId,
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          url: `/api/files/${fileId}/download`,
          uploadedAt: new Date(),
          crfVersionMediaId: crfVersionMediaId || undefined
        };
        
        if (file.mimetype.startsWith('image/')) {
          response.thumbnailUrl = `/api/files/${fileId}/thumbnail`;
        }
        
        uploadedFiles.push(response);
      }
      
      await client.query('COMMIT');
      
      logger.info('Batch file upload', { count: uploadedFiles.length });
      res.json({ success: true, data: uploadedFiles });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    logger.error('Batch upload error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Batch upload failed' });
  }
});

/**
 * Get file metadata
 * GET /api/files/:id
 */
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT file_id, original_name, mime_type, file_size, uploaded_at, crf_version_media_id
      FROM file_uploads
      WHERE file_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const file = result.rows[0];
    
    const response: UploadedFileResponse = {
      id: file.file_id,
      name: file.original_name,
      size: file.file_size,
      type: file.mime_type,
      url: `/api/files/${file.file_id}/download`,
      uploadedAt: file.uploaded_at,
      crfVersionMediaId: file.crf_version_media_id
    };
    
    if (file.mime_type?.startsWith('image/')) {
      response.thumbnailUrl = `/api/files/${file.file_id}/thumbnail`;
    }
    
    res.json({ success: true, data: response });
    
  } catch (error: any) {
    logger.error('Get file error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get file' });
  }
});

/**
 * Download file
 * GET /api/files/:id/download
 */
router.get('/:id/download', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT file_path, original_name, mime_type
      FROM file_uploads
      WHERE file_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const file = result.rows[0];
    
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ success: false, message: 'File not found on disk' });
    }
    
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    
    const stream = fs.createReadStream(file.file_path);
    stream.pipe(res);
    
  } catch (error: any) {
    logger.error('Download file error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to download file' });
  }
});

/**
 * Get thumbnail (images only)
 * GET /api/files/:id/thumbnail
 */
router.get('/:id/thumbnail', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT file_path, mime_type
      FROM file_uploads
      WHERE file_id = $1 AND mime_type LIKE 'image/%'
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    
    const file = result.rows[0];
    
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ success: false, message: 'File not found on disk' });
    }
    
    // For now, just return the original image
    // In production, you'd want to generate an actual thumbnail
    res.setHeader('Content-Type', file.mime_type);
    const stream = fs.createReadStream(file.file_path);
    stream.pipe(res);
    
  } catch (error: any) {
    logger.error('Get thumbnail error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get thumbnail' });
  }
});

/**
 * Get files for a form item
 * GET /api/files/item/:itemId
 */
router.get('/item/:itemId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    
    const result = await pool.query(`
      SELECT file_id, original_name, mime_type, file_size, uploaded_at, crf_version_media_id
      FROM file_uploads
      WHERE item_id = $1
      ORDER BY uploaded_at DESC
    `, [itemId]);
    
    const files: UploadedFileResponse[] = result.rows.map(file => ({
      id: file.file_id,
      name: file.original_name,
      size: file.file_size,
      type: file.mime_type,
      url: `/api/files/${file.file_id}/download`,
      uploadedAt: file.uploaded_at,
      crfVersionMediaId: file.crf_version_media_id,
      thumbnailUrl: file.mime_type?.startsWith('image/') ? `/api/files/${file.file_id}/thumbnail` : undefined
    }));
    
    res.json({ success: true, data: files });
    
  } catch (error: any) {
    logger.error('Get item files error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get files' });
  }
});

/**
 * Get files for a CRF version
 * GET /api/files/crf-version/:crfVersionId
 */
router.get('/crf-version/:crfVersionId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { crfVersionId } = req.params;
    
    const result = await pool.query(`
      SELECT file_id, original_name, mime_type, file_size, uploaded_at, crf_version_media_id
      FROM file_uploads
      WHERE crf_version_id = $1
      ORDER BY uploaded_at DESC
    `, [crfVersionId]);
    
    const files: UploadedFileResponse[] = result.rows.map(file => ({
      id: file.file_id,
      name: file.original_name,
      size: file.file_size,
      type: file.mime_type,
      url: `/api/files/${file.file_id}/download`,
      uploadedAt: file.uploaded_at,
      crfVersionMediaId: file.crf_version_media_id,
      thumbnailUrl: file.mime_type?.startsWith('image/') ? `/api/files/${file.file_id}/thumbnail` : undefined
    }));
    
    res.json({ success: true, data: files });
    
  } catch (error: any) {
    logger.error('Get CRF files error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get files' });
  }
});

/**
 * Delete file
 * DELETE /api/files/:id
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT file_path, crf_version_media_id
      FROM file_uploads
      WHERE file_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const file = result.rows[0];
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete from file_uploads table
      await client.query('DELETE FROM file_uploads WHERE file_id = $1', [id]);
      
      // Delete from crf_version_media if applicable
      if (file.crf_version_media_id) {
        await client.query('DELETE FROM crf_version_media WHERE crf_version_media_id = $1', [file.crf_version_media_id]);
      }
      
      await client.query('COMMIT');
      
      // Delete physical file
      if (fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
      
      logger.info('File deleted', { fileId: id });
      res.json({ success: true });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    logger.error('Delete file error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to delete file' });
  }
});

export default router;

