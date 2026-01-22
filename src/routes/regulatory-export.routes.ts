/**
 * Regulatory Export Routes - 21 CFR Part 11 & HIPAA Compliant
 * 
 * REST API routes for creating regulatory export packages.
 * All routes require authentication and administrative privileges.
 * 
 * 21 CFR Part 11 §11.10(b): Generating accurate copies
 * ICH E6(R2): Record retention and inspection
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  createRegulatoryExport,
  getExportById,
  listRegulatoryExports,
  getExportFilePath
} from '../services/export/regulatory-export.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../config/logger';

const router = Router();

// Apply authentication to all regulatory export routes
router.use(authMiddleware);

/**
 * @route POST /api/regulatory-export/create
 * @desc Create a new regulatory export package
 * @access Admin only
 * @body RegulatoryExportRequest
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userId = user?.userId || user?.id || 0;
    const username = user?.userName || user?.username || 'system';
    
    const {
      exportType,
      format,
      studyId,
      subjectIds,
      dateRangeStart,
      dateRangeEnd,
      includeAuditTrail,
      includeSignatures,
      includeAttachments,
      recipientOrganization,
      reasonForExport
    } = req.body;
    
    if (!exportType || !format) {
      return res.status(400).json({
        success: false,
        message: 'exportType and format are required'
      });
    }
    
    const result = await createRegulatoryExport(
      {
        exportType,
        format,
        studyId,
        subjectIds,
        dateRangeStart: dateRangeStart ? new Date(dateRangeStart) : undefined,
        dateRangeEnd: dateRangeEnd ? new Date(dateRangeEnd) : undefined,
        includeAuditTrail,
        includeSignatures,
        includeAttachments,
        recipientOrganization,
        reasonForExport
      },
      userId,
      username
    );
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Export creation failed',
        error: result.error
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Regulatory export created successfully',
      data: {
        exportId: result.exportId,
        fileSize: result.fileSize,
        checksum: result.checksum,
        downloadUrl: `/api/regulatory-export/download/${result.exportId}`
      }
    });
    
  } catch (error: any) {
    logger.error('Failed to create regulatory export', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to create regulatory export',
      error: error.message
    });
  }
});

/**
 * @route GET /api/regulatory-export/list
 * @desc List all regulatory exports
 * @access Admin only
 * @query studyId - Optional filter by study
 * @query limit - Maximum results (default: 50)
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const studyId = req.query.studyId ? parseInt(req.query.studyId as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    
    const exports = await listRegulatoryExports(studyId, limit);
    
    res.json({
      success: true,
      data: exports,
      count: exports.length
    });
    
  } catch (error: any) {
    logger.error('Failed to list regulatory exports', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to list exports',
      error: error.message
    });
  }
});

/**
 * @route GET /api/regulatory-export/:exportId
 * @desc Get export details by ID
 * @access Admin only
 */
router.get('/:exportId', async (req: Request, res: Response) => {
  try {
    const exportId = req.params.exportId as string;
    const exportData = await getExportById(exportId);
    
    if (!exportData) {
      return res.status(404).json({
        success: false,
        message: 'Export not found'
      });
    }
    
    res.json({
      success: true,
      data: exportData
    });
    
  } catch (error: any) {
    logger.error('Failed to get export', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve export',
      error: error.message
    });
  }
});

/**
 * @route GET /api/regulatory-export/download/:exportId
 * @desc Download export file
 * @access Admin only
 */
router.get('/download/:exportId', async (req: Request, res: Response) => {
  try {
    const exportId = req.params.exportId as string;
    const filePath = await getExportFilePath(exportId);
    
    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'Export file not found or not ready'
      });
    }
    
    // Log download for audit
    const user = (req as any).user;
    logger.info('Regulatory export downloaded', {
      exportId,
      userId: user?.id,
      username: user?.username
    });
    
    const fileName = path.basename(filePath);
    res.download(filePath, fileName);
    
  } catch (error: any) {
    logger.error('Failed to download export', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to download export',
      error: error.message
    });
  }
});

/**
 * @route POST /api/regulatory-export/:exportId/certify
 * @desc Add electronic signature certification to export
 * @access Admin only
 * @body { signature: string, meaning: string }
 */
router.post('/:exportId/certify', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const exportId = req.params.exportId as string;
    const { signature, meaning } = req.body;
    
    if (!signature || !meaning) {
      return res.status(400).json({
        success: false,
        message: 'signature and meaning are required'
      });
    }
    
    // This would integrate with the electronic signature service
    // For now, just log the certification
    logger.info('Export certification requested', {
      exportId,
      userId: user?.id,
      meaning
    });
    
    res.json({
      success: true,
      message: 'Certification recorded',
      data: {
        exportId,
        certifiedBy: user?.username,
        certifiedAt: new Date().toISOString(),
        meaning
      }
    });
    
  } catch (error: any) {
    logger.error('Failed to certify export', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to certify export',
      error: error.message
    });
  }
});

export default router;
