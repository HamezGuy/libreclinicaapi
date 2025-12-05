/**
 * Data Export Routes
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as exportService from '../services/export/export.service';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/export/metadata/:studyOID
 * Get study metadata for export configuration
 */
router.get('/metadata/:studyOID', asyncHandler(async (req: Request, res: Response) => {
  const { studyOID } = req.params;
  const username = (req as any).user?.username || 'api';

  logger.info('Export metadata request', { studyOID, username });

  const metadata = await exportService.getStudyMetadataForExport(studyOID, username);

  res.json({
    success: true,
    data: metadata
  });
}));

/**
 * GET /api/export/subjects/:studyOID
 * Get subject list for export preview
 */
router.get('/subjects/:studyOID', asyncHandler(async (req: Request, res: Response) => {
  const { studyOID } = req.params;
  const username = (req as any).user?.username || 'api';

  const subjects = await exportService.getSubjectsForExport(studyOID, username);

  res.json({
    success: true,
    data: {
      subjects,
      count: subjects.length
    }
  });
}));

/**
 * POST /api/export/execute
 * Execute data export
 */
router.post('/execute', asyncHandler(async (req: Request, res: Response) => {
  const { datasetConfig, format } = req.body;
  const username = (req as any).user?.username || 'api';

  if (!datasetConfig?.studyOID) {
    return res.status(400).json({
      success: false,
      message: 'studyOID is required in datasetConfig'
    });
  }

  logger.info('Export execute request', { 
    studyOID: datasetConfig.studyOID, 
    format,
    username 
  });

  const result = await exportService.executeExport(
    datasetConfig,
    format || 'csv',
    username
  );

  if (!result.success) {
    return res.status(500).json({
      success: false,
      message: result.error || 'Export failed'
    });
  }

  // Set headers for file download
  res.setHeader('Content-Type', result.data!.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.data!.filename}"`);
  res.send(result.data!.content);
}));

/**
 * POST /api/export/preview
 * Preview export data (first N records)
 */
router.post('/preview', asyncHandler(async (req: Request, res: Response) => {
  const { datasetConfig, format, limit = 10 } = req.body;
  const username = (req as any).user?.username || 'api';

  if (!datasetConfig?.studyOID) {
    return res.status(400).json({
      success: false,
      message: 'studyOID is required in datasetConfig'
    });
  }

  const result = await exportService.executeExport(
    datasetConfig,
    format || 'csv',
    username
  );

  if (!result.success) {
    return res.status(500).json(result);
  }

  // Return preview (limited content)
  const content = result.data!.content.toString();
  const lines = content.split('\n');
  const previewLines = lines.slice(0, limit + 1); // +1 for header

  res.json({
    success: true,
    data: {
      preview: previewLines.join('\n'),
      totalRecords: result.data!.recordCount,
      format,
      filename: result.data!.filename
    }
  });
}));

export default router;

