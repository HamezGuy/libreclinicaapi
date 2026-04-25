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
 * - GET /api/files/event-crf/:eventCrfId - Get files for a form instance
 * - GET /api/files/consent/:consentId - Get files for a consent record
 * - DELETE /api/files/:id - Delete a file
 * 
 * 21 CFR Part 11 Compliant:
 * - Audit trail for uploads/deletions
 * - User authentication required
 * - File integrity verification
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { initializeFileUploadsTable } from '../services/database/file-uploads.service';
import { logger } from '../config/logger';
import * as fileController from '../controllers/file.controller';

// Initialize table on module load
initializeFileUploadsTable().catch(err => {
  logger.warn('Failed to initialize file_uploads table', { error: err.message });
});

const router = Router();

// ─── Multer configuration ─────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/dicom',
  'application/zip', 'application/x-zip-compressed', 'application/x-zip',
];

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.txt', '.csv', '.dcm', '.zip',
];

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.includes(file.mimetype) || ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} (${ext}) not allowed`));
    }
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/',      authMiddleware, upload.single('file'),       fileController.upload);
router.post('/batch', authMiddleware, upload.array('files', 20),   fileController.uploadBatch);

router.get('/item/:itemId',                 authMiddleware, fileController.listByItem);
router.get('/crf-version/:crfVersionId',    authMiddleware, fileController.listByCrfVersion);
router.get('/event-crf/:eventCrfId',        authMiddleware, fileController.listByEventCrf);
router.get('/consent/:consentId',           authMiddleware, fileController.listByConsent);

router.get('/:id',           authMiddleware, fileController.getById);
router.get('/:id/download',  authMiddleware, fileController.download);
router.get('/:id/thumbnail', authMiddleware, fileController.thumbnail);

router.delete('/:id', authMiddleware, requireRole('admin', 'data_manager'), fileController.deleteFile);

export default router;
