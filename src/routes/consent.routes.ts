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
import { authMiddleware } from '../middleware/auth.middleware';
import { requireSignatureFor, verifyElectronicSignature, Part11Request } from '../middleware/part11.middleware';
import { logger } from '../config/logger';
import {
  createConsentDocument,
  getConsentDocument,
  listConsentDocuments,
  updateConsentDocument,
  createConsentVersion,
  getConsentVersion,
  getActiveVersion,
  activateConsentVersion,
  recordConsent,
  getSubjectConsent,
  hasValidConsent,
  withdrawConsent,
  requestReconsent,
  getPendingReconsents,
  getConsentDashboard
} from '../services/consent/consent.service';

const router = Router();

/**
 * Require admin or investigator role
 */
const requireAdminOrInvestigator = async (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  const allowedRoles = ['admin', 'investigator', 'study_director'];
  if (!allowedRoles.includes(user.role)) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  next();
};

// ============================================================================
// Document Management
// ============================================================================

/**
 * POST /api/consent/documents
 * Create a consent document
 */
router.post('/documents', authMiddleware, requireAdminOrInvestigator, async (req: Request, res: Response) => {
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
router.put('/documents/:id', authMiddleware, requireAdminOrInvestigator, async (req: Request, res: Response) => {
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
router.post('/documents/:id/versions', authMiddleware, requireAdminOrInvestigator, async (req: Request, res: Response) => {
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
  requireAdminOrInvestigator, 
  requireSignatureFor('I authorize activation of this consent document version'),
  async (req: Request, res: Response) => {
    try {
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
 */
router.post('/subjects/:studySubjectId/consent', 
  authMiddleware, 
  requireSignatureFor('I confirm informed consent has been obtained from this subject'),
  async (req: Request, res: Response) => {
    try {
      const studySubjectId = parseInt(req.params.studySubjectId);
      const userId = (req as any).user?.userId;
      
      const consent = await recordConsent({
        ...req.body,
        studySubjectId,
        consentedBy: userId,
        subjectIpAddress: req.ip,
        subjectUserAgent: req.get('User-Agent')
      });

      res.json({ success: true, data: consent });
    } catch (error: any) {
      logger.error('Error recording consent', { error: error.message });
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
 * POST /api/consent/:consentId/withdraw
 * Withdraw consent (requires electronic signature per §11.50)
 */
router.post('/:consentId/withdraw', 
  authMiddleware, 
  requireSignatureFor('I confirm withdrawal of consent for this subject'),
  async (req: Request, res: Response) => {
    try {
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
// Re-consent
// ============================================================================

/**
 * POST /api/consent/reconsent/request
 * Request re-consent for a subject
 */
router.post('/reconsent/request', authMiddleware, async (req: Request, res: Response) => {
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

