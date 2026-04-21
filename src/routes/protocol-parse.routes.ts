/**
 * Protocol Parse Routes — Async Job-Based
 */

import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as controller from '../controllers/protocol-parse.controller';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

router.use(authMiddleware);

// Submit protocol PDF (returns job_id immediately)
router.post('/upload', requireRole('admin', 'data_manager'), upload.single('file'), controller.uploadProtocol);

// Poll job status
router.get('/jobs/:jobId', requireRole('admin', 'data_manager'), controller.getJobStatus);

// Get completed job results
router.get('/jobs/:jobId/result', requireRole('admin', 'data_manager'), controller.getJobResult);

// Re-compile edited blueprint
router.post('/recompile', requireRole('admin', 'data_manager'), controller.recompile);

// List uploaded protocol documents
router.get('/documents', requireRole('admin', 'data_manager'), controller.listDocuments);

// Import visit definitions (after forms are imported)
router.post('/import-visits', requireRole('admin', 'data_manager'), controller.importVisitDefinitions);

// Health check
router.get('/health', controller.healthCheck);

export default router;
