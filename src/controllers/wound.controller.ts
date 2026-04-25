/**
 * Wound Controller
 * 
 * Handles HTTP requests for wound capture sessions
 * Integrates with WoundScanner iOS app
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware';
import * as woundService from '../services/hybrid/wound.service';
import { AuthRequest } from '../middleware/auth.middleware';
import multer from 'multer';
import type { ApiResponse } from '@accura-trial/shared-types';
import type { 
  WoundSession, WoundMeasurement, WoundApiResponse,
  CreateSessionResponse, ImageUploadResponse,
  SubmitMeasurementsResponse, SignSessionResponse,
  SubmitToLibreClinicaResponse, PaginatedWoundResponse,
  SyncBatchResponse
} from '../types/wound.types';

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  }
});

export const uploadMiddleware = upload.single('image');

// ============================================================================
// SESSION ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/sessions
 * Create a new wound capture session
 */
export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { patientId, templateId, studyId, studyEventId, siteId, deviceId, source } = req.body;

  if (!patientId || !templateId) {
    res.status(400).json({ 
      success: false, 
      message: 'patientId and templateId are required' 
    });
    return;
  }

  const result: CreateSessionResponse = await woundService.createSession(
    { patientId, templateId, studyId, studyEventId, siteId, deviceId, source },
    user.userId.toString(),
    user.userName
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * GET /api/wounds/sessions/:id
 * Get session by ID
 */
export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result: WoundApiResponse<WoundSession> = await woundService.getSession(id);

  if (!result.success) {
    res.status(404).json(result);
    return;
  }

  res.json(result);
});

/**
 * GET /api/wounds/patients/:patientId/sessions
 * Get all sessions for a patient
 */
export const getPatientSessions = asyncHandler(async (req: Request, res: Response) => {
  const { patientId } = req.params;
  const { page = '1', limit = '20' } = req.query;

  const result: PaginatedWoundResponse<WoundSession> = await woundService.getPatientSessions(
    patientId,
    parseInt(page as string),
    parseInt(limit as string)
  );

  res.json(result);
});

// ============================================================================
// IMAGE ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/sessions/:id/images
 * Upload wound image
 */
export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  const { id: sessionId } = req.params;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ success: false, message: 'No image file provided' });
    return;
  }

  const hash = req.body.hash || '';

  const result: ImageUploadResponse = await woundService.uploadImage(
    sessionId,
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    hash,
    user.userId.toString()
  );

  res.status(result.success ? 201 : 400).json(result);
});

/**
 * GET /api/wounds/sessions/:id/images
 * Get images for a session
 */
export const getSessionImages = asyncHandler(async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;

  const response: WoundApiResponse<never[]> = { success: true, data: [], message: 'Not implemented yet' };
  res.json(response);
});

// ============================================================================
// MEASUREMENT ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/sessions/:id/measurements
 * Submit wound measurements
 */
export const submitMeasurements = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  const { id: sessionId } = req.params;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { measurements, dataHash } = req.body;

  if (!measurements || !Array.isArray(measurements) || measurements.length === 0) {
    res.status(400).json({ 
      success: false, 
      message: 'measurements array is required' 
    });
    return;
  }

  const result: SubmitMeasurementsResponse = await woundService.submitMeasurements(
    { sessionId, measurements, dataHash: dataHash || '' },
    user.userId.toString(),
    user.userName
  );

  res.status(result.success ? 200 : 400).json(result);
});

/**
 * GET /api/wounds/sessions/:id/measurements
 * Get measurements for a session
 */
export const getSessionMeasurements = asyncHandler(async (req: Request, res: Response) => {
  const { id: sessionId } = req.params;

  const result: WoundApiResponse<WoundMeasurement[]> = await woundService.getSessionMeasurements(sessionId);

  res.json(result);
});

// ============================================================================
// SIGNATURE ENDPOINTS
// ============================================================================

/**
 * PUT /api/wounds/sessions/:id/sign
 * Apply electronic signature to session
 */
export const signSession = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  const { id: sessionId } = req.params;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { signature } = req.body;

  if (!signature) {
    res.status(400).json({ 
      success: false, 
      message: 'signature object is required' 
    });
    return;
  }

  const result: SignSessionResponse = await woundService.signSession(
    { sessionId, signature },
    user.userId.toString()
  );

  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================================
// SUBMISSION ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/sessions/:id/submit
 * Submit session to LibreClinica
 */
export const submitToLibreClinica = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  const { id: sessionId } = req.params;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { auditTrail } = req.body;

  const result: SubmitToLibreClinicaResponse = await woundService.submitToLibreClinica(
    { sessionId, auditTrail },
    user.userId,
    user.userName
  );

  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================================
// AUDIT ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/audit/log
 * Submit audit entries from iOS app
 */
export const submitAuditEntries = asyncHandler(async (req: Request, res: Response) => {
  const { entries } = req.body;

  if (!entries || !Array.isArray(entries)) {
    res.status(400).json({ 
      success: false, 
      message: 'entries array is required' 
    });
    return;
  }

  const result: { received: boolean; count: number } = await woundService.submitAuditEntries(entries);

  res.json({ success: true, ...result });
});

// ============================================================================
// SYNC ENDPOINTS
// ============================================================================

/**
 * POST /api/wounds/sync/batch
 * Batch sync offline sessions
 */
export const syncBatch = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthRequest).user;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { sessions, deviceId } = req.body;

  if (!sessions || !Array.isArray(sessions)) {
    res.status(400).json({ 
      success: false, 
      message: 'sessions array is required' 
    });
    return;
  }

  const syncedSessions: { localId: string; serverId: string; libreClinicaId?: string }[] = [];
  const failedSessions: { localId: string; error: string; retryable: boolean }[] = [];

  for (const pendingSession of sessions) {
    try {
      // Create session
      const createResult: CreateSessionResponse = await woundService.createSession(
        {
          patientId: pendingSession.patientId,
          templateId: pendingSession.templateId,
          deviceId,
          source: 'ios_app'
        },
        user.userId.toString(),
        user.userName
      );

      if (!createResult.success || !createResult.sessionId) {
        failedSessions.push({
          localId: pendingSession.localId,
          error: createResult.message || 'Failed to create session',
          retryable: true
        });
        continue;
      }

      const serverSessionId = createResult.sessionId;

      // Submit measurements
      if (pendingSession.measurements && pendingSession.measurements.length > 0) {
        await woundService.submitMeasurements(
          {
            sessionId: serverSessionId,
            measurements: pendingSession.measurements,
            dataHash: ''
          },
          user.userId.toString(),
          user.userName
        );
      }

      // Apply signature if present
      if (pendingSession.signature) {
        await woundService.signSession(
          {
            sessionId: serverSessionId,
            signature: pendingSession.signature
          },
          user.userId.toString()
        );
      }

      // Submit to LibreClinica
      const submitResult: SubmitToLibreClinicaResponse = await woundService.submitToLibreClinica(
        { sessionId: serverSessionId, auditTrail: pendingSession.auditTrail },
        user.userId,
        user.userName
      );

      syncedSessions.push({
        localId: pendingSession.localId,
        serverId: serverSessionId,
        libreClinicaId: submitResult.libreClinicaId
      });
    } catch (error: any) {
      failedSessions.push({
        localId: pendingSession.localId,
        error: error.message,
        retryable: true
      });
    }
  }

  const response: SyncBatchResponse = {
    success: true,
    syncedSessions,
    failedSessions
  };
  res.json(response);
});

/**
 * GET /api/wounds/sync/status
 * Get sync status
 */
export const getSyncStatus = asyncHandler(async (req: Request, res: Response) => {
  const response: WoundApiResponse<{ pendingCount: number; lastSync: Date }> = {
    success: true,
    data: {
      pendingCount: 0,
      lastSync: new Date()
    }
  };
  res.json(response);
});

export default {
  createSession,
  getSession,
  getPatientSessions,
  uploadImage,
  uploadMiddleware,
  getSessionImages,
  submitMeasurements,
  getSessionMeasurements,
  signSession,
  submitToLibreClinica,
  submitAuditEntries,
  syncBatch,
  getSyncStatus
};

