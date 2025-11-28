/**
 * Wound Scanner Routes
 * 
 * API routes for WoundScanner iOS app integration
 * 
 * Endpoints:
 * - GET    /health                      - Health check
 * - POST   /sessions                    - Create capture session
 * - GET    /sessions/:id                - Get session details
 * - POST   /sessions/:id/images         - Upload wound image
 * - GET    /sessions/:id/images         - Get session images
 * - POST   /sessions/:id/measurements   - Submit measurements
 * - GET    /sessions/:id/measurements   - Get measurements
 * - PUT    /sessions/:id/sign           - Apply e-signature
 * - POST   /sessions/:id/submit         - Submit to LibreClinica
 * - GET    /patients/:patientId/wounds  - Get patient wound history
 * - POST   /audit/log                   - Submit audit entries
 * - POST   /sync/batch                  - Batch sync offline data
 * - GET    /sync/status                 - Get sync status
 */

import express from 'express';
import * as controller from '../controllers/wound.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// ============================================================================
// HEALTH CHECK (No auth required)
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'wound-scanner',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// All routes require authentication
router.use(authMiddleware);

// ============================================================================
// SESSION ROUTES
// ============================================================================

// Create new wound capture session
router.post('/sessions', controller.createSession);

// Get session by ID
router.get('/sessions/:id', controller.getSession);

// ============================================================================
// IMAGE ROUTES
// ============================================================================

// Upload wound image (multipart/form-data)
router.post(
  '/sessions/:id/images',
  controller.uploadMiddleware,
  controller.uploadImage
);

// Get session images
router.get('/sessions/:id/images', controller.getSessionImages);

// ============================================================================
// MEASUREMENT ROUTES
// ============================================================================

// Submit measurements
router.post('/sessions/:id/measurements', controller.submitMeasurements);

// Get session measurements
router.get('/sessions/:id/measurements', controller.getSessionMeasurements);

// ============================================================================
// SIGNATURE ROUTES
// ============================================================================

// Apply electronic signature
router.put('/sessions/:id/sign', controller.signSession);

// ============================================================================
// SUBMISSION ROUTES
// ============================================================================

// Submit to LibreClinica
router.post('/sessions/:id/submit', controller.submitToLibreClinica);

// ============================================================================
// PATIENT ROUTES
// ============================================================================

// Get patient wound history
router.get('/patients/:patientId/wounds', controller.getPatientSessions);
router.get('/patients/:patientId/sessions', controller.getPatientSessions); // Alias

// ============================================================================
// AUDIT ROUTES
// ============================================================================

// Submit audit entries from iOS
router.post('/audit/log', controller.submitAuditEntries);

// ============================================================================
// SYNC ROUTES
// ============================================================================

// Batch sync offline data
router.post('/sync/batch', controller.syncBatch);

// Get sync status
router.get('/sync/status', controller.getSyncStatus);

export default router;

