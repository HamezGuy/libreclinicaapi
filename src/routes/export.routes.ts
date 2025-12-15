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

/**
 * POST /api/export/dataset
 * Create a saved dataset configuration (uses LibreClinica's dataset table)
 */
router.post('/dataset', asyncHandler(async (req: Request, res: Response) => {
  const { datasetConfig } = req.body;
  const userId = (req as any).user?.userId || 1;

  if (!datasetConfig?.studyOID) {
    return res.status(400).json({
      success: false,
      message: 'studyOID is required in datasetConfig'
    });
  }

  logger.info('Creating dataset', { studyOID: datasetConfig.studyOID });

  const result = await exportService.createDataset(datasetConfig, userId);

  if (!result.success) {
    return res.status(500).json({
      success: false,
      message: result.error || 'Failed to create dataset'
    });
  }

  res.json({
    success: true,
    data: {
      datasetId: result.datasetId
    }
  });
}));

/**
 * GET /api/export/datasets/:studyOID
 * Get all saved datasets for a study
 */
router.get('/datasets/:studyOID', asyncHandler(async (req: Request, res: Response) => {
  const { studyOID } = req.params;

  logger.info('Getting datasets', { studyOID });

  const datasets = await exportService.getDatasets(studyOID);

  res.json({
    success: true,
    data: datasets
  });
}));

/**
 * GET /api/export/archived/:datasetId
 * Get archived exports for a dataset
 */
router.get('/archived/:datasetId', asyncHandler(async (req: Request, res: Response) => {
  const datasetId = parseInt(req.params.datasetId);

  if (isNaN(datasetId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid datasetId'
    });
  }

  const archives = await exportService.getArchivedExports(datasetId);

  res.json({
    success: true,
    data: archives
  });
}));

/**
 * POST /api/export/cdisc
 * Full CDISC ODM export with all clinical data
 */
router.post('/cdisc', asyncHandler(async (req: Request, res: Response) => {
  const { datasetConfig } = req.body;
  const username = (req as any).user?.username || 'api';
  const userId = (req as any).user?.userId || 1;

  if (!datasetConfig?.studyOID) {
    return res.status(400).json({
      success: false,
      message: 'studyOID is required'
    });
  }

  logger.info('Full CDISC ODM export request', { studyOID: datasetConfig.studyOID });

  try {
    // Create dataset record for audit trail
    const datasetResult = await exportService.createDataset({
      ...datasetConfig,
      name: datasetConfig.name || `CDISC_Export_${Date.now()}`,
      description: 'CDISC ODM Export'
    }, userId);

    // Build full ODM
    const odmXml = await exportService.buildFullOdmExport(datasetConfig, username);
    const filename = `${datasetConfig.studyOID}_CDISC_${Date.now()}.xml`;

    // Archive the export if dataset was created
    if (datasetResult.success && datasetResult.datasetId) {
      await exportService.archiveExportedFile(
        datasetResult.datasetId,
        filename,
        '',
        'odm',
        userId
      );
    }

    // Return the ODM XML
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(odmXml);
  } catch (error: any) {
    logger.error('CDISC export failed', { error: error.message });
    res.status(500).json({
      success: false,
      message: error.message || 'CDISC export failed'
    });
  }
}));

export default router;

