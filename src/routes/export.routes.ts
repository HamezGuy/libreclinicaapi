/**
 * Data Export Routes
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as exportService from '../services/export/export.service';
import { pool } from '../config/database';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/export/forms/:studyId
 * Get available forms for a study (used by export modal to select which forms to export)
 */
router.get('/forms/:studyId', asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;
  
  logger.info('Getting study forms for export', { studyId });

  try {
    const query = `
      SELECT DISTINCT c.crf_id, c.name, c.description, c.oc_oid,
        (SELECT COUNT(*) FROM crf_version cv WHERE cv.crf_id = c.crf_id AND cv.status_id = 1) as version_count
      FROM crf c
      WHERE c.source_study_id = $1 AND c.status_id = 1
      ORDER BY c.name
    `;
    const result = await pool.query(query, [parseInt(studyId)]);
    
    const forms = result.rows.map(row => ({
      crfId: row.crf_id,
      name: row.name,
      description: row.description || '',
      oid: row.oc_oid,
      versionCount: parseInt(row.version_count) || 0
    }));
    
    res.json({ success: true, data: forms });
  } catch (error: any) {
    logger.error('Error fetching study forms for export', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
}));

/**
 * GET /api/export/events/:studyId
 * Get available events for a study (used by export modal to select which events to export)
 */
router.get('/events/:studyId', asyncHandler(async (req: Request, res: Response) => {
  const { studyId } = req.params;
  
  logger.info('Getting study events for export', { studyId });

  try {
    const query = `
      SELECT sed.study_event_definition_id, sed.name, sed.description, sed.oc_oid,
        sed.ordinal, sed.type, sed.repeating,
        (SELECT COUNT(DISTINCT se.study_subject_id) 
         FROM study_event se WHERE se.study_event_definition_id = sed.study_event_definition_id) as subject_count
      FROM study_event_definition sed
      WHERE sed.study_id = $1 AND sed.status_id = 1
      ORDER BY sed.ordinal
    `;
    const result = await pool.query(query, [parseInt(studyId)]);
    
    const events = result.rows.map(row => ({
      eventDefinitionId: row.study_event_definition_id,
      name: row.name,
      description: row.description || '',
      oid: row.oc_oid,
      ordinal: row.ordinal,
      type: row.type || 'scheduled',
      repeating: row.repeating || false,
      subjectCount: parseInt(row.subject_count) || 0
    }));
    
    res.json({ success: true, data: events });
  } catch (error: any) {
    logger.error('Error fetching study events for export', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
}));

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
  const userId = (req as any).user?.userId || 1;

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

  // 21 CFR Part 11 audit trail: record the export
  try {
    const datasetResult = await exportService.createDataset({
      ...datasetConfig,
      name: datasetConfig.name || `Export_${format}_${Date.now()}`,
      description: `Data export in ${format} format by ${username}`
    }, userId);
    
    if (datasetResult.success && datasetResult.datasetId) {
      await exportService.archiveExportedFile(
        datasetResult.datasetId,
        result.data!.filename,
        '',
        format || 'csv',
        userId
      );
    }
  } catch (auditError: any) {
    // Don't block the export if audit logging fails, but log the error
    logger.error('Export audit trail failed', { error: auditError.message });
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

