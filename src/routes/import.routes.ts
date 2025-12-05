/**
 * Data Import Routes
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance
 * CSV is converted to ODM XML and imported via dataSoap.service
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as csvToOdm from '../services/import/csv-to-odm.service';
import { getSoapClient } from '../services/soap/soapClient';
import { logger } from '../config/logger';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

/**
 * POST /api/import/validate
 * Validate import file before execution
 */
router.post('/validate', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const content = file.buffer.toString('utf-8');
  const isODM = content.trim().startsWith('<?xml') || content.includes('<ODM');

  if (isODM) {
    // ODM XML - validate structure
    const hasStudyOID = content.includes('StudyOID=');
    const hasSubjectData = content.includes('<SubjectData');
    const hasClinicalData = content.includes('<ClinicalData');

    const errors: string[] = [];
    if (!hasStudyOID) errors.push('Missing StudyOID attribute');
    if (!hasClinicalData) errors.push('Missing ClinicalData element');
    if (!hasSubjectData) errors.push('Missing SubjectData element');

    return res.json({
      success: true,
      data: {
        format: 'odm',
        isValid: errors.length === 0,
        errors,
        warnings: []
      }
    });
  }

  // CSV - validate with mapping if provided
  let mapping;
  try {
    mapping = req.body.mapping ? JSON.parse(req.body.mapping) : null;
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid mapping JSON'
    });
  }

  if (!mapping) {
    // Return headers for mapping UI
    const { headers, rowCount } = csvToOdm.parseCSV(content);
    const suggestions = csvToOdm.suggestColumnMappings(headers);

    return res.json({
      success: true,
      data: {
        format: 'csv',
        needsMapping: true,
        headers,
        rowCount,
        suggestions
      }
    });
  }

  // Validate with mapping
  const validation = csvToOdm.validateCSV(content, mapping);

  res.json({
    success: true,
    data: {
      format: 'csv',
      ...validation
    }
  });
}));

/**
 * POST /api/import/preview
 * Get preview of data to be imported
 */
router.post('/preview', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const content = file.buffer.toString('utf-8');
  let mapping;
  
  try {
    mapping = req.body.mapping ? JSON.parse(req.body.mapping) : null;
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid mapping JSON'
    });
  }

  if (!mapping) {
    return res.status(400).json({
      success: false,
      message: 'Mapping is required for preview'
    });
  }

  const preview = csvToOdm.getImportPreview(content, mapping, 10);

  res.json({
    success: true,
    data: preview
  });
}));

/**
 * POST /api/import/convert
 * Convert CSV to ODM XML (for download/review)
 */
router.post('/convert', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const { studyOID, metaDataVersionOID, mapping } = req.body;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  if (!studyOID || !mapping) {
    return res.status(400).json({
      success: false,
      message: 'studyOID and mapping are required'
    });
  }

  let parsedMapping;
  try {
    parsedMapping = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid mapping JSON'
    });
  }

  const content = file.buffer.toString('utf-8');
  const odmXml = csvToOdm.convertCSVToODM(content, {
    studyOID,
    metaDataVersionOID: metaDataVersionOID || 'v1.0.0',
    mapping: parsedMapping
  });

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="import_${Date.now()}.xml"`);
  res.send(odmXml);
}));

/**
 * POST /api/import/execute
 * Execute import via LibreClinica SOAP
 */
router.post('/execute', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const { studyOID, metaDataVersionOID, mapping, odmXml: providedOdm } = req.body;
  const userId = (req as any).user?.userId || 1;
  const username = (req as any).user?.username || 'api';

  let odmXml: string;

  if (providedOdm) {
    // ODM XML provided directly
    odmXml = providedOdm;
  } else if (file) {
    const content = file.buffer.toString('utf-8');
    const isODM = content.trim().startsWith('<?xml') || content.includes('<ODM');

    if (isODM) {
      odmXml = content;
    } else {
      // CSV - convert to ODM
      if (!studyOID || !mapping) {
        return res.status(400).json({
          success: false,
          message: 'studyOID and mapping are required for CSV import'
        });
      }

      let parsedMapping;
      try {
        parsedMapping = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Invalid mapping JSON'
        });
      }

      odmXml = csvToOdm.convertCSVToODM(content, {
        studyOID,
        metaDataVersionOID: metaDataVersionOID || 'v1.0.0',
        mapping: parsedMapping
      });
    }
  } else {
    return res.status(400).json({
      success: false,
      message: 'No file or ODM data provided'
    });
  }

  logger.info('Executing import via LibreClinica SOAP', {
    username,
    odmLength: odmXml.length
  });

  // Import via EXISTING SOAP endpoint (Part 11 compliant!)
  const soapClient = getSoapClient();
  const result = await soapClient.executeRequest({
    serviceName: 'data',
    methodName: 'import',
    parameters: {
      odm: odmXml
    },
    userId,
    username
  });

  if (!result.success) {
    logger.error('Import failed', { error: result.error });
    return res.status(500).json({
      success: false,
      message: result.error || 'Import failed',
      soapFault: result.soapFault
    });
  }

  logger.info('Import successful', { result: result.data });

  res.json({
    success: true,
    message: 'Data imported successfully via LibreClinica',
    data: result.data
  });
}));

/**
 * POST /api/import/auto-map
 * Suggest column mappings based on headers
 */
router.post('/auto-map', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const content = file.buffer.toString('utf-8');
  const { headers } = csvToOdm.parseCSV(content);
  const suggestions = csvToOdm.suggestColumnMappings(headers);

  res.json({
    success: true,
    data: {
      headers,
      ...suggestions
    }
  });
}));

export default router;

