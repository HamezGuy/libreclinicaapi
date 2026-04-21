/**
 * Data Import Routes
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance
 * CSV is converted to ODM XML and imported via dataSoap.service
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import * as csvToOdm from '../services/import/csv-to-odm.service';
import { buildOdmFromSubjectData } from '../services/import/odm-builder.service';
import { getSoapClient } from '../services/soap/soapClient';
import { logger } from '../config/logger';
import type { ImportSubjectData } from '@accura-trial/shared-types';

const router = Router();

// All import routes require authentication
router.use(authMiddleware);
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
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
        isValid: true,
        needsMapping: true,
        headers,
        rowCount,
        suggestions,
        validRecords: rowCount,
        invalidRecords: 0,
        errors: [],
        warnings: rowCount > 0 ? [] : ['File appears to be empty']
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
router.post('/execute', requireRole('admin', 'data_manager'), upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const { studyOID, metaDataVersionOID, mapping, odmXml: providedOdm } = req.body;
  const userId = (req as any).user?.userId;
  const username = (req as any).user?.userName || (req as any).user?.username;

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
 * POST /api/import/from-json
 *
 * Import clinical data supplied as `ImportSubjectData[]` JSON (canonical
 * `@accura-trial/shared-types` shape). Built primarily for the
 * interop-middleware FHIR → EDC bridge, which prefers structured JSON
 * over assembling ODM XML on the bridge side.
 *
 * Internally this route:
 *   1. Validates the request shape
 *   2. Builds ODM 1.3 XML via `buildOdmFromSubjectData` (the SHARED
 *      builder used by the CSV path too — no parallel formats)
 *   3. Submits the XML through the same `dataSoap.import` SOAP call as
 *      `POST /api/import/execute`, attributed to the JWT-authenticated
 *      caller (so 21 CFR Part 11 §11.10(e) audit and §11.50 signature
 *      semantics are identical to every other write path)
 *
 * Optional body fields:
 *   - signatureUsername / signaturePassword / signatureMeaning
 *     Forwarded verbatim if present; the SOAP layer + part11 middleware
 *     verify them using the existing libreclinicaapi flow.
 *
 * Returns: same shape as `/api/import/execute` so callers can swap.
 */
router.post(
  '/from-json',
  requireRole('admin', 'data_manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.userId;
    const username =
      (req as any).user?.userName || (req as any).user?.username;

    const {
      studyOID,
      metaDataVersionOID,
      subjects,
      fileOID,
      creationDateTimeIso,
    } = req.body as {
      studyOID?: string;
      metaDataVersionOID?: string;
      subjects?: ImportSubjectData[];
      fileOID?: string;
      creationDateTimeIso?: string;
    };

    if (!studyOID || typeof studyOID !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'studyOID is required (string)',
      });
    }
    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'subjects (ImportSubjectData[]) is required and non-empty',
      });
    }

    // Minimal structural validation: each subject must declare subjectOID
    // and at least one studyEventData entry. Deeper validation is the
    // SOAP layer's job; this just rejects obviously-bad payloads early.
    const malformed = subjects.findIndex(
      (s) =>
        !s ||
        typeof s.subjectOID !== 'string' ||
        s.subjectOID.length === 0 ||
        !Array.isArray(s.studyEventData),
    );
    if (malformed !== -1) {
      return res.status(400).json({
        success: false,
        message: `subjects[${malformed}] is missing subjectOID or studyEventData`,
      });
    }

    const odmXml = buildOdmFromSubjectData(subjects, {
      studyOID,
      metaDataVersionOID: metaDataVersionOID || 'v1.0.0',
      fileOID,
      creationDateTimeIso,
    });

    logger.info('Executing JSON import via LibreClinica SOAP', {
      username,
      subjectCount: subjects.length,
      odmLength: odmXml.length,
    });

    const soapClient = getSoapClient();
    const result = await soapClient.executeRequest({
      serviceName: 'data',
      methodName: 'import',
      parameters: { odm: odmXml },
      userId,
      username,
    });

    if (!result.success) {
      logger.error('JSON import failed', { error: result.error });
      return res.status(500).json({
        success: false,
        message: result.error || 'Import failed',
        soapFault: result.soapFault,
      });
    }

    logger.info('JSON import successful', {
      subjectCount: subjects.length,
    });

    res.json({
      success: true,
      message: 'Data imported successfully via LibreClinica',
      data: result.data,
    });
  }),
);

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

