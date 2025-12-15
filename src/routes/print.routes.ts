/**
 * Print Routes
 * 
 * API endpoints for PDF generation and printing:
 * - Form PDF generation (completed forms)
 * - Blank form PDF generation (templates)
 * - Casebook generation (all forms for a subject)
 * - Audit trail PDF generation
 * 
 * 21 CFR Part 11: All print events are logged to audit trail
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';
import * as pdfService from '../services/pdf/pdf.service';
import { PDFGenerationOptions } from '../services/pdf/pdf.types';

const router = Router();

/**
 * Parse PDF options from query parameters
 */
function parsePdfOptions(query: any): Partial<PDFGenerationOptions> {
  return {
    pageSize: query.pageSize === 'A4' ? 'A4' : 'Letter',
    orientation: query.orientation === 'landscape' ? 'landscape' : 'portrait',
    watermark: query.watermark as PDFGenerationOptions['watermark'],
    includeHeader: query.includeHeader !== 'false',
    includeFooter: query.includeFooter !== 'false',
    includeAuditTrail: query.includeAuditTrail === 'true',
    includeSignatures: query.includeSignatures !== 'false'
  };
}

/**
 * GET /api/print/forms/:eventCrfId/pdf
 * Generate PDF for a completed form
 */
router.get('/forms/:eventCrfId/pdf', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const options = parsePdfOptions(req.query);
    const user = (req as any).user;

    if (isNaN(eventCrfId)) {
      return res.status(400).json({ success: false, message: 'Invalid event CRF ID' });
    }

    logger.info('Generating form PDF', { eventCrfId, userId: user.userId });

    const result = await pdfService.generateFormPDF(eventCrfId, options, user.userId, user.username);

    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.setHeader('Content-Type', result.contentType || 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error: any) {
    logger.error('Error generating form PDF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/forms/:eventCrfId/download
 * Download PDF for a completed form
 */
router.get('/forms/:eventCrfId/download', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);
    const options = parsePdfOptions(req.query);
    const user = (req as any).user;

    if (isNaN(eventCrfId)) {
      return res.status(400).json({ success: false, message: 'Invalid event CRF ID' });
    }

    const result = await pdfService.generateFormPDF(eventCrfId, options, user.userId, user.username);

    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.setHeader('Content-Type', result.contentType || 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error: any) {
    logger.error('Error downloading form PDF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/templates/:crfVersionId/blank-pdf
 * Generate blank form PDF (template)
 */
router.get('/templates/:crfVersionId/blank-pdf', authMiddleware, async (req: Request, res: Response) => {
  try {
    const crfVersionId = parseInt(req.params.crfVersionId);
    const options = parsePdfOptions(req.query);
    const user = (req as any).user;

    if (isNaN(crfVersionId)) {
      return res.status(400).json({ success: false, message: 'Invalid CRF version ID' });
    }

    logger.info('Generating blank form PDF', { crfVersionId, userId: user.userId });

    const result = await pdfService.generateBlankFormPDF(crfVersionId, options, user.userId, user.username);

    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.setHeader('Content-Type', result.contentType || 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error: any) {
    logger.error('Error generating blank form PDF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/subjects/:studySubjectId/casebook
 * Generate casebook PDF (all forms for a subject)
 */
router.get('/subjects/:studySubjectId/casebook', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const options = parsePdfOptions(req.query);
    const user = (req as any).user;

    if (isNaN(studySubjectId)) {
      return res.status(400).json({ success: false, message: 'Invalid study subject ID' });
    }

    logger.info('Generating casebook PDF', { studySubjectId, userId: user.userId });

    const result = await pdfService.generateCasebookPDF(studySubjectId, options, user.userId, user.username);

    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.setHeader('Content-Type', result.contentType || 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error: any) {
    logger.error('Error generating casebook PDF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/audit/:entityType/:entityId/pdf
 * Generate audit trail PDF
 */
router.get('/audit/:entityType/:entityId/pdf', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { entityType } = req.params;
    const entityId = parseInt(req.params.entityId);
    const options = parsePdfOptions(req.query);
    const user = (req as any).user;

    if (isNaN(entityId)) {
      return res.status(400).json({ success: false, message: 'Invalid entity ID' });
    }

    // Validate entity type
    const validEntityTypes = ['event_crf', 'study_subject', 'study_event', 'study'];
    if (!validEntityTypes.includes(entityType)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid entity type. Must be one of: ${validEntityTypes.join(', ')}` 
      });
    }

    logger.info('Generating audit trail PDF', { entityType, entityId, userId: user.userId });

    const result = await pdfService.generateAuditTrailPDF(entityType, entityId, options, user.userId, user.username);

    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }

    res.setHeader('Content-Type', result.contentType || 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error: any) {
    logger.error('Error generating audit trail PDF', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/forms/:eventCrfId/data
 * Get form data for client-side rendering (used by frontend print preview)
 */
router.get('/forms/:eventCrfId/data', authMiddleware, async (req: Request, res: Response) => {
  try {
    const eventCrfId = parseInt(req.params.eventCrfId);

    if (isNaN(eventCrfId)) {
      return res.status(400).json({ success: false, message: 'Invalid event CRF ID' });
    }

    const formData = await pdfService.getFormDataForPrint(eventCrfId);

    if (!formData) {
      return res.status(404).json({ success: false, message: 'Form not found' });
    }

    res.json({ success: true, data: formData });
  } catch (error: any) {
    logger.error('Error getting form print data', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/templates/:crfVersionId/data
 * Get blank form data for client-side rendering
 */
router.get('/templates/:crfVersionId/data', authMiddleware, async (req: Request, res: Response) => {
  try {
    const crfVersionId = parseInt(req.params.crfVersionId);

    if (isNaN(crfVersionId)) {
      return res.status(400).json({ success: false, message: 'Invalid CRF version ID' });
    }

    const formData = await pdfService.getBlankFormDataForPrint(crfVersionId);

    if (!formData) {
      return res.status(404).json({ success: false, message: 'Form template not found' });
    }

    res.json({ success: true, data: formData });
  } catch (error: any) {
    logger.error('Error getting blank form print data', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/subjects/:studySubjectId/casebook/data
 * Get casebook data for client-side rendering
 */
router.get('/subjects/:studySubjectId/casebook/data', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const user = (req as any).user;

    if (isNaN(studySubjectId)) {
      return res.status(400).json({ success: false, message: 'Invalid study subject ID' });
    }

    const casebookData = await pdfService.getCasebookDataForPrint(studySubjectId, user.username);

    if (!casebookData) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    res.json({ success: true, data: casebookData });
  } catch (error: any) {
    logger.error('Error getting casebook print data', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/print/audit/:entityType/:entityId/data
 * Get audit trail data for client-side rendering
 */
router.get('/audit/:entityType/:entityId/data', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { entityType } = req.params;
    const entityId = parseInt(req.params.entityId);
    const user = (req as any).user;

    if (isNaN(entityId)) {
      return res.status(400).json({ success: false, message: 'Invalid entity ID' });
    }

    const auditData = await pdfService.getAuditTrailForPrint(entityType, entityId, user.username);

    if (!auditData) {
      return res.status(404).json({ success: false, message: 'Audit trail not found' });
    }

    res.json({ success: true, data: auditData });
  } catch (error: any) {
    logger.error('Error getting audit trail print data', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

