/**
 * Consent Routes
 * 
 * API endpoints for eConsent management.
 * 
 * 21 CFR Part 11 Compliance:
 * - Consent recording requires electronic signature (§11.50)
 * - Consent withdrawal requires electronic signature (§11.50)
 * - All changes are logged to audit trail (§11.10(e))
 */

import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { requirePart11, verifyElectronicSignature, type SignedRequest } from '../middleware/part11.middleware';
import { requireRole } from '../middleware/authorization.middleware';
import { logger } from '../config/logger';
import { pool } from '../config/database';
import {
  createConsentDocument,
  getConsentDocument,
  listConsentDocuments,
  updateConsentDocument,
  createConsentVersion,
  getConsentVersion,
  getActiveVersion,
  listConsentVersions,
  activateConsentVersion,
  recordConsent,
  getSubjectConsent,
  hasValidConsent,
  withdrawConsent,
  getConsentAuditTrail,
  requestReconsent,
  getPendingReconsents,
  getConsentDashboard
} from '../services/consent/consent.service';

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const consentSchemas = {
  createDocument: Joi.object({
    studyId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'studyId is required' }),
    name: Joi.string().required().max(500)
      .messages({ 'any.required': 'Document name is required' }),
    description: Joi.string().optional().max(5000).allow(''),
    documentType: Joi.string().optional().valid('main', 'assent', 'lar', 'optional', 'addendum'),
    languageCode: Joi.string().optional().max(10),
    requiresWitness: Joi.boolean().optional(),
    requiresLAR: Joi.boolean().optional(),
    ageOfMajority: Joi.number().integer().min(0).optional(),
    minReadingTime: Joi.number().integer().min(0).optional(),
  }),

  createVersion: Joi.object({
    versionNumber: Joi.string().required().max(50)
      .messages({ 'any.required': 'versionNumber is required' }),
    versionName: Joi.string().optional().max(255).allow(''),
    content: Joi.object().required()
      .messages({ 'any.required': 'content is required' }),
    pdfTemplate: Joi.string().optional().allow(''),
    effectiveDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional(),
    expirationDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
    irbApprovalDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
    irbApprovalNumber: Joi.string().optional().max(255).allow(''),
    changeSummary: Joi.string().optional().max(5000).allow(''),
  }),

  recordConsent: Joi.object({
    versionId: Joi.number().integer().positive().optional(),
    consentType: Joi.string().optional().valid('subject', 'witness', 'lar', 'reconsent'),
    subjectName: Joi.string().required().max(500)
      .messages({ 'any.required': 'subjectName is required' }),
    subjectSignatureData: Joi.any().required()
      .messages({ 'any.required': 'subjectSignatureData is required' }),
    witnessName: Joi.string().optional().max(500).allow(''),
    witnessRelationship: Joi.string().optional().max(255).allow(''),
    witnessSignatureData: Joi.any().optional(),
    larName: Joi.string().optional().max(500).allow(''),
    larRelationship: Joi.string().optional().max(255).allow(''),
    larSignatureData: Joi.any().optional(),
    larReason: Joi.string().optional().max(2000).allow(''),
    timeSpentReading: Joi.number().integer().min(0).required()
      .messages({ 'any.required': 'timeSpentReading is required' }),
    pagesViewed: Joi.any().required()
      .messages({ 'any.required': 'pagesViewed is required' }),
    acknowledgementsChecked: Joi.any().required()
      .messages({ 'any.required': 'acknowledgementsChecked is required' }),
    questionsAsked: Joi.string().optional().max(5000).allow(''),
    scannedConsentFileIds: Joi.array().items(Joi.string()).optional(),
    isScannedConsent: Joi.boolean().optional(),
    subjectSignatureId: Joi.number().integer().positive().optional(),
    witnessSignatureId: Joi.number().integer().positive().optional(),
    larSignatureId: Joi.number().integer().positive().optional(),
    investigatorSignatureId: Joi.number().integer().positive().optional(),
    contentHash: Joi.string().optional().max(256).allow(''),
    deviceInfo: Joi.any().optional(),
    pageViewRecords: Joi.any().optional(),
    formData: Joi.object().optional(),
    templateId: Joi.string().optional().max(255).allow(''),
    password: Joi.string().optional(),
    signaturePassword: Joi.string().optional(),
    signatureMeaning: Joi.string().optional().max(500),
  }),

  requestReconsent: Joi.object({
    versionId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'versionId is required' }),
    studySubjectId: Joi.number().integer().positive().required()
      .messages({ 'any.required': 'studySubjectId is required' }),
    reason: Joi.string().required().max(2000)
      .messages({ 'any.required': 'reason is required', 'string.empty': 'reason cannot be empty' }),
    dueDate: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate()).optional().allow(null),
  }),

  updateDocument: Joi.object({
    name: Joi.string().optional().max(500),
    description: Joi.string().optional().max(5000).allow(''),
    documentType: Joi.string().optional().valid('main', 'assent', 'lar', 'optional', 'addendum'),
    languageCode: Joi.string().optional().max(10),
    requiresWitness: Joi.boolean().optional(),
    requiresLAR: Joi.boolean().optional(),
    ageOfMajority: Joi.number().integer().min(0).optional(),
    minReadingTime: Joi.number().integer().min(0).optional(),
    status: Joi.string().optional().valid('draft', 'active', 'retired'),
  }),
};

const requireConsentManagement = requireRole('admin', 'investigator', 'data_manager', 'coordinator');

// ============================================================================
// Document Management
// ============================================================================

/**
 * POST /api/consent/documents
 * Create a consent document
 */
router.post('/documents', authMiddleware, requireConsentManagement, validate({ body: consentSchemas.createDocument }), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const doc = await createConsentDocument({ ...req.body, createdBy: userId });
    res.json({ success: true, data: doc });
  } catch (error: any) {
    logger.error('Error creating consent document', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/studies/:studyId/documents
 * List consent documents for a study
 */
router.get('/studies/:studyId/documents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const documents = await listConsentDocuments(studyId);
    res.json({ success: true, data: documents });
  } catch (error: any) {
    logger.error('Error listing consent documents', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/documents/:id
 * Get a consent document
 */
router.get('/documents/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const doc = await getConsentDocument(documentId);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    res.json({ success: true, data: doc });
  } catch (error: any) {
    logger.error('Error getting consent document', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/consent/documents/:id
 * Update a consent document
 */
router.put('/documents/:id', authMiddleware, requireConsentManagement, validate({ body: consentSchemas.updateDocument }), async (req: Request, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const doc = await updateConsentDocument(documentId, req.body);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    res.json({ success: true, data: doc });
  } catch (error: any) {
    logger.error('Error updating consent document', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Version Management
// ============================================================================

/**
 * POST /api/consent/documents/:id/versions
 * Create a new version
 */
router.post('/documents/:id/versions', authMiddleware, requireConsentManagement, validate({ body: consentSchemas.createVersion }), async (req: Request, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const userId = (req as any).user?.userId;
    const version = await createConsentVersion({ ...req.body, documentId, createdBy: userId });
    res.json({ success: true, data: version });
  } catch (error: any) {
    logger.error('Error creating consent version', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/documents/:id/versions
 * List all versions for a document
 */
router.get('/documents/:id/versions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const versions = await listConsentVersions(documentId);
    res.json({ success: true, data: versions });
  } catch (error: any) {
    logger.error('Error listing consent versions', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/versions/:id
 * Get a version
 */
router.get('/versions/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const versionId = parseInt(req.params.id);
    const version = await getConsentVersion(versionId);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Version not found' });
    }
    res.json({ success: true, data: version });
  } catch (error: any) {
    logger.error('Error getting consent version', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/documents/:id/active-version
 * Get active version for a document
 */
router.get('/documents/:id/active-version', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const version = await getActiveVersion(documentId);
    if (!version) {
      return res.status(404).json({ success: false, message: 'No active version' });
    }
    res.json({ success: true, data: version });
  } catch (error: any) {
    logger.error('Error getting active version', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/consent/versions/:id/activate
 * Activate a version (requires electronic signature per §11.50)
 */
router.post('/versions/:id/activate', 
  authMiddleware, 
  requireConsentManagement, 
  requirePart11({ meaning: 'I authorize activation of this consent document version' }),
  async (req: Request, res: Response) => {
    try {
      const signed = req as SignedRequest;
      if (!signed.signature?.verified) {
        res.status(403).json({ success: false, message: 'Electronic signature required to activate consent version (21 CFR Part 11 §11.50)' });
        return;
      }
      const versionId = parseInt(req.params.id);
      const userId = (req as any).user?.userId;
      const version = await activateConsentVersion(versionId, userId);
      res.json({ success: true, data: version });
    } catch (error: any) {
      logger.error('Error activating consent version', { error: error.message });
      res.status(400).json({ success: false, message: error.message });
    }
  }
);

// ============================================================================
// Subject Consent
// ============================================================================

/**
 * POST /api/consent/subjects/:studySubjectId/consent
 * Record subject consent (requires electronic signature per §11.50)
 *
 * Signature verification accepts TWO modes:
 *   1. Inline password via requirePart11 middleware (sets req.signature.verified)
 *   2. Pre-authenticated signature IDs (investigatorSignatureId, subjectSignatureId)
 *      — these were already password-verified when created via the e-signature service
 */
router.post('/subjects/:studySubjectId/consent', 
  authMiddleware, 
  validate({ body: consentSchemas.recordConsent }),
  requirePart11({ meaning: 'I confirm informed consent has been obtained from this subject' }),
  async (req: Request, res: Response) => {
    try {
      const signed = req as SignedRequest;
      const hasInlineSignature = signed.signature?.verified === true;
      const hasPreAuthSignature = !!(req.body.investigatorSignatureId || req.body.subjectSignatureId);

      if (!hasInlineSignature && !hasPreAuthSignature) {
        res.status(403).json({ success: false, message: 'Electronic signature required to record consent (21 CFR Part 11 §11.50)' });
        return;
      }

      if (hasPreAuthSignature && !hasInlineSignature) {
        const sigId = req.body.investigatorSignatureId || req.body.subjectSignatureId;
        const sigCheck = await pool.query(
          `SELECT audit_id FROM audit_log_event
           WHERE audit_id = $1
             AND entity_name = 'Electronic Signature Applied'
           LIMIT 1`,
          [sigId]
        );
        if (sigCheck.rows.length === 0) {
          res.status(403).json({ success: false, message: 'Invalid electronic signature: signature record not found' });
          return;
        }
      }

      const studySubjectId = parseInt(req.params.studySubjectId);
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ success: false, message: 'User authentication required to record consent' });
        return;
      }

      if (isNaN(studySubjectId) || studySubjectId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid study subject ID' });
        return;
      }

      const consent = await recordConsent({
        ...req.body,
        studySubjectId,
        consentedBy: userId,
        subjectIpAddress: req.ip,
        subjectUserAgent: req.get('User-Agent')
      });

      res.json({ success: true, data: consent });
    } catch (error: any) {
      logger.error('Error recording consent', { 
        error: error.message,
        stack: error.stack,
        studySubjectId: req.params.studySubjectId,
        bodyKeys: Object.keys(req.body || {})
      });
      res.status(400).json({ success: false, message: error.message });
    }
  }
);

/**
 * GET /api/consent/subjects/:studySubjectId/consent
 * Get subject consent history
 */
router.get('/subjects/:studySubjectId/consent', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const consents = await getSubjectConsent(studySubjectId);
    res.json({ success: true, data: consents });
  } catch (error: any) {
    logger.error('Error getting subject consent', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/subjects/:studySubjectId/has-consent
 * Check if subject has valid consent
 */
router.get('/subjects/:studySubjectId/has-consent', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const hasConsent = await hasValidConsent(studySubjectId);
    res.json({ success: true, data: { hasValidConsent: hasConsent } });
  } catch (error: any) {
    logger.error('Error checking consent', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/subjects/:studySubjectId/consent-gate
 * Consent gate — checks if data entry should be allowed for this subject.
 * Returns a gate decision (none / soft_warning / hard_block) based on consent status.
 */
router.get('/subjects/:studySubjectId/consent-gate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studySubjectId = parseInt(req.params.studySubjectId);
    const hasConsent = await hasValidConsent(studySubjectId);

    res.json({
      success: true,
      data: {
        allowed: true,
        hasValidConsent: hasConsent,
        consentStatus: hasConsent ? 'valid' : 'missing',
        message: hasConsent ? undefined : 'Subject does not have valid informed consent on file.',
        gateType: hasConsent ? 'none' : 'soft_warning'
      }
    });
  } catch (error: any) {
    logger.error('Error checking consent gate', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/consent/:consentId/withdraw
 * Withdraw consent (requires electronic signature per §11.50)
 */
router.post('/:consentId/withdraw', 
  authMiddleware, 
  requirePart11({ meaning: 'I confirm withdrawal of consent for this subject' }),
  async (req: Request, res: Response) => {
    try {
      const signed = req as SignedRequest;
      if (!signed.signature?.verified) {
        res.status(403).json({ success: false, message: 'Electronic signature required to withdraw consent (21 CFR Part 11 §11.50)' });
        return;
      }
      const consentId = parseInt(req.params.consentId);
      const { reason } = req.body;
      const userId = (req as any).user?.userId;

      if (!reason) {
        return res.status(400).json({ success: false, message: 'Reason is required' });
      }

      const consent = await withdrawConsent(consentId, reason, userId);
      res.json({ success: true, data: consent });
    } catch (error: any) {
      logger.error('Error withdrawing consent', { error: error.message });
      res.status(400).json({ success: false, message: error.message });
    }
  }
);

// ============================================================================
// Audit Trail
// ============================================================================

/**
 * GET /api/consent/:consentId/audit-trail
 * Get audit trail for a consent record
 */
router.get('/:consentId/audit-trail', authMiddleware, requireRole('admin', 'monitor', 'investigator', 'data_manager', 'coordinator'), async (req: Request, res: Response) => {
  try {
    const consentId = parseInt(req.params.consentId);
    const trail = await getConsentAuditTrail(consentId);
    res.json({ success: true, data: trail });
  } catch (error: any) {
    logger.error('Error getting consent audit trail', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Re-consent
// ============================================================================

/**
 * POST /api/consent/reconsent/request
 * Request re-consent for a subject
 */
router.post('/reconsent/request', authMiddleware, requireConsentManagement, validate({ body: consentSchemas.requestReconsent }), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const request = await requestReconsent({ ...req.body, requestedBy: userId });
    res.json({ success: true, data: request });
  } catch (error: any) {
    logger.error('Error requesting re-consent', { error: error.message });
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/consent/studies/:studyId/reconsent/pending
 * Get pending re-consent requests
 */
router.get('/studies/:studyId/reconsent/pending', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const requests = await getPendingReconsents(studyId);
    res.json({ success: true, data: requests });
  } catch (error: any) {
    logger.error('Error getting pending re-consents', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Study Consents
// ============================================================================

/**
 * GET /api/consent/studies/:studyId/consents
 * List all subject consents for a study
 */
router.get('/studies/:studyId/consents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const { status, limit } = req.query;
    
    // Get dashboard which includes recent consents
    const dashboard = await getConsentDashboard(studyId);
    
    // Return recent consents (which include the needed fields)
    // In a full implementation, this would query acc_subject_consent table
    let consents = dashboard.recentConsents || [];
    
    if (status) {
      consents = consents.filter((c: any) => c.consentStatus === status);
    }
    
    if (limit) {
      consents = consents.slice(0, parseInt(limit as string));
    }
    
    res.json({ success: true, data: consents });
  } catch (error: any) {
    logger.error('Error listing study consents', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Expired Consents
// ============================================================================

/**
 * GET /api/consent/studies/:studyId/expired-consents
 * Get expired consents for a study (consent_expiry_date < now)
 */
router.get('/studies/:studyId/expired-consents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    // Query the dashboard for recent consents and filter for expired ones
    const dashboard = await getConsentDashboard(studyId);
    const now = new Date();
    const expired = (dashboard.recentConsents || []).filter((c: any) => {
      if (!c.consentExpiryDate) return false;
      return new Date(c.consentExpiryDate) < now && c.consentStatus !== 'withdrawn';
    });
    res.json({ success: true, data: expired });
  } catch (error: any) {
    logger.error('Error getting expired consents', { error: error.message, studyId: req.params.studyId });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// Dashboard
// ============================================================================

/**
 * GET /api/consent/studies/:studyId/dashboard
 * Get consent dashboard
 */
router.get('/studies/:studyId/dashboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const studyId = parseInt(req.params.studyId);
    const dashboard = await getConsentDashboard(studyId);
    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    logger.error('Error getting consent dashboard', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

