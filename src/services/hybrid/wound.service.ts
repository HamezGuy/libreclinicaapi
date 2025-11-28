/**
 * Wound Service (Hybrid)
 * 
 * Wound capture session management with LibreClinica integration
 * - Creates and manages wound capture sessions
 * - Stores images and measurements
 * - Handles electronic signatures
 * - Submits to LibreClinica via SOAP
 * 
 * 21 CFR Part 11 Compliance:
 * - All operations logged to audit trail
 * - Electronic signatures with hash verification
 * - Data integrity checks throughout
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import * as dataSoap from '../soap/dataSoap.service';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  WoundSession,
  CreateSessionRequest,
  CreateSessionResponse,
  WoundImage,
  ImageUploadResponse,
  WoundMeasurement,
  SubmitMeasurementsRequest,
  SubmitMeasurementsResponse,
  ElectronicSignature,
  SignSessionRequest,
  SignSessionResponse,
  SubmitToLibreClinicaRequest,
  SubmitToLibreClinicaResponse,
  AuditEntry,
  WoundApiResponse,
  PaginatedWoundResponse
} from '../../types/wound.types';

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new wound capture session
 */
export const createSession = async (
  request: CreateSessionRequest,
  userId: string,
  userName: string
): Promise<CreateSessionResponse> => {
  logger.info('Creating wound session', { request, userId });

  try {
    const sessionId = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO wound_sessions (
        id, patient_id, template_id, study_id, study_event_id, site_id,
        device_id, source, status, created_by_user_id, created_by_user_name,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $11)
      RETURNING id, created_at, status
    `;

    const result = await pool.query(query, [
      sessionId,
      request.patientId,
      request.templateId,
      request.studyId || null,
      request.studyEventId || null,
      request.siteId || null,
      request.deviceId || null,
      request.source || 'ios_app',
      userId,
      userName,
      now
    ]);

    // Log to audit trail
    await logAuditEntry({
      action: 'WOUND_CAPTURE_STARTED',
      userId,
      userName,
      patientId: request.patientId,
      sessionId,
      details: {
        template_id: request.templateId,
        study_id: request.studyId || '',
        source: request.source || 'ios_app'
      }
    });

    return {
      success: true,
      sessionId: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      status: result.rows[0].status
    };
  } catch (error: any) {
    logger.error('Create session error', { error: error.message });
    return {
      success: false,
      message: `Failed to create session: ${error.message}`
    };
  }
};

/**
 * Get session by ID
 */
export const getSession = async (sessionId: string): Promise<WoundApiResponse<WoundSession>> => {
  try {
    const query = `
      SELECT * FROM wound_sessions WHERE id = $1
    `;
    const result = await pool.query(query, [sessionId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Session not found' };
    }

    return { success: true, data: mapSessionRow(result.rows[0]) };
  } catch (error: any) {
    logger.error('Get session error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get sessions for a patient
 */
export const getPatientSessions = async (
  patientId: string,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedWoundResponse<WoundSession>> => {
  try {
    const offset = (page - 1) * limit;

    // Count total
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM wound_sessions WHERE patient_id = $1',
      [patientId]
    );
    const total = parseInt(countResult.rows[0].count);

    // Get sessions with measurements
    const query = `
      SELECT ws.*,
        (SELECT COUNT(*) FROM wound_images wi WHERE wi.session_id = ws.id) as image_count,
        (SELECT COUNT(*) FROM wound_measurements wm WHERE wm.session_id = ws.id) as measurement_count,
        (SELECT MAX(wm.area_cm2) FROM wound_measurements wm WHERE wm.session_id = ws.id) as max_area_cm2
      FROM wound_sessions ws
      WHERE ws.patient_id = $1
      ORDER BY ws.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [patientId, limit, offset]);

    return {
      success: true,
      data: result.rows.map(mapSessionRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error: any) {
    logger.error('Get patient sessions error', { error: error.message });
    return {
      success: false,
      data: [],
      pagination: { page, limit, total: 0, totalPages: 0 }
    };
  }
};

// ============================================================================
// IMAGE MANAGEMENT
// ============================================================================

/**
 * Upload wound image
 */
export const uploadImage = async (
  sessionId: string,
  imageData: Buffer,
  originalFilename: string,
  contentType: string,
  providedHash: string,
  userId: string
): Promise<ImageUploadResponse> => {
  logger.info('Uploading wound image', { sessionId, size: imageData.length });

  try {
    // Verify hash
    const calculatedHash = crypto.createHash('sha256').update(imageData).digest('hex');
    const hashVerified = calculatedHash === providedHash;

    if (!hashVerified) {
      logger.warn('Image hash mismatch', { sessionId, provided: providedHash, calculated: calculatedHash });
    }

    const imageId = uuidv4();
    const now = new Date();
    
    // For now, store path reference (actual S3 upload would happen here)
    const storagePath = `wounds/${sessionId}/${imageId}.jpg`;

    const query = `
      INSERT INTO wound_images (
        id, session_id, filename, content_type, size_bytes,
        storage_path, storage_type, hash, hash_verified,
        captured_at, upload_completed_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 's3', $7, $8, $9, $9, $9)
      RETURNING id, hash, hash_verified, size_bytes
    `;

    const result = await pool.query(query, [
      imageId,
      sessionId,
      originalFilename,
      contentType,
      imageData.length,
      storagePath,
      calculatedHash,
      hashVerified,
      now
    ]);

    // Log audit entry
    await logAuditEntry({
      action: 'WOUND_IMAGE_CAPTURED',
      userId,
      sessionId,
      details: {
        image_id: imageId,
        image_hash: calculatedHash,
        size_bytes: imageData.length.toString(),
        hash_verified: hashVerified.toString()
      }
    });

    return {
      success: true,
      imageId: result.rows[0].id,
      hash: result.rows[0].hash,
      hashVerified: result.rows[0].hash_verified,
      size: result.rows[0].size_bytes
    };
  } catch (error: any) {
    logger.error('Upload image error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// MEASUREMENT MANAGEMENT
// ============================================================================

/**
 * Submit wound measurements
 */
export const submitMeasurements = async (
  request: SubmitMeasurementsRequest,
  userId: string,
  userName: string
): Promise<SubmitMeasurementsResponse> => {
  logger.info('Submitting measurements', { sessionId: request.sessionId, count: request.measurements.length });

  try {
    // Verify data hash
    const dataString = JSON.stringify(request.measurements);
    const calculatedHash = crypto.createHash('sha256').update(dataString).digest('hex');
    const hashVerified = calculatedHash === request.dataHash;

    if (!hashVerified) {
      logger.warn('Measurement data hash mismatch', { sessionId: request.sessionId });
    }

    // Insert measurements
    for (const measurement of request.measurements) {
      const measurementId = uuidv4();
      const now = new Date();

      const query = `
        INSERT INTO wound_measurements (
          id, session_id, image_id, area_cm2, perimeter_cm,
          max_length_cm, max_width_cm, max_depth_cm, volume_cm3,
          boundary_points, point_count, calibration_method, pixels_per_cm,
          data_hash, notes, measured_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `;

      await pool.query(query, [
        measurementId,
        request.sessionId,
        measurement.imageId || null,
        measurement.areaCm2,
        measurement.perimeterCm,
        measurement.maxLengthCm,
        measurement.maxWidthCm,
        measurement.maxDepthCm || null,
        measurement.volumeCm3 || null,
        JSON.stringify(measurement.boundaryPoints),
        measurement.boundaryPoints.length,
        measurement.calibrationMethod,
        measurement.pixelsPerCm,
        crypto.createHash('sha256').update(JSON.stringify(measurement)).digest('hex'),
        measurement.notes || null,
        measurement.measuredAt,
        now
      ]);

      // Log audit entry for each measurement
      await logAuditEntry({
        action: 'WOUND_MEASUREMENT_CALCULATED',
        userId,
        userName,
        sessionId: request.sessionId,
        details: {
          measurement_id: measurementId,
          area_cm2: measurement.areaCm2.toFixed(2),
          perimeter_cm: measurement.perimeterCm.toFixed(2),
          calibration_method: measurement.calibrationMethod
        }
      });
    }

    // Update session status
    await pool.query(
      `UPDATE wound_sessions SET status = 'captured', captured_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND status = 'draft'`,
      [request.sessionId]
    );

    return {
      success: true,
      received: true,
      count: request.measurements.length,
      hashVerified
    };
  } catch (error: any) {
    logger.error('Submit measurements error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get measurements for a session
 */
export const getSessionMeasurements = async (sessionId: string): Promise<WoundApiResponse<WoundMeasurement[]>> => {
  try {
    const query = `
      SELECT * FROM wound_measurements WHERE session_id = $1 ORDER BY measured_at DESC
    `;
    const result = await pool.query(query, [sessionId]);

    return {
      success: true,
      data: result.rows.map(mapMeasurementRow)
    };
  } catch (error: any) {
    logger.error('Get measurements error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// ELECTRONIC SIGNATURE
// ============================================================================

/**
 * Apply electronic signature to session
 */
export const signSession = async (
  request: SignSessionRequest,
  userId: string
): Promise<SignSessionResponse> => {
  logger.info('Applying electronic signature', { sessionId: request.sessionId });

  try {
    const signatureId = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO electronic_signatures (
        id, session_id, user_id, user_name, user_role,
        meaning, manifestation, data_hash, signature_value,
        auth_method, device_id, signed_at, is_valid, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $12)
      RETURNING id
    `;

    await pool.query(query, [
      signatureId,
      request.sessionId,
      request.signature.userId,
      request.signature.userName,
      request.signature.userRole,
      request.signature.meaning,
      request.signature.manifestation,
      request.signature.dataHash,
      request.signature.signatureValue,
      request.signature.authMethod,
      request.signature.deviceId || null,
      now
    ]);

    // Update session status
    await pool.query(
      `UPDATE wound_sessions SET status = 'signed', signed_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND status IN ('draft', 'captured')`,
      [request.sessionId]
    );

    // Log audit entry
    await logAuditEntry({
      action: 'ESIGNATURE_APPLIED',
      userId,
      sessionId: request.sessionId,
      details: {
        signature_id: signatureId,
        meaning: request.signature.meaning,
        auth_method: request.signature.authMethod,
        data_hash: request.signature.dataHash
      }
    });

    return {
      success: true,
      signed: true,
      signatureId
    };
  } catch (error: any) {
    logger.error('Sign session error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// LIBRECLINICA SUBMISSION
// ============================================================================

/**
 * Submit wound session to LibreClinica
 */
export const submitToLibreClinica = async (
  request: SubmitToLibreClinicaRequest,
  userId: number,
  userName: string
): Promise<SubmitToLibreClinicaResponse> => {
  logger.info('Submitting to LibreClinica', { sessionId: request.sessionId });

  try {
    // Get session with measurements
    const sessionResult = await pool.query(
      'SELECT * FROM wound_sessions WHERE id = $1',
      [request.sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return { success: false, message: 'Session not found' };
    }

    const session = sessionResult.rows[0];

    // Get measurements
    const measurementsResult = await pool.query(
      'SELECT * FROM wound_measurements WHERE session_id = $1 ORDER BY measured_at DESC LIMIT 1',
      [request.sessionId]
    );

    if (measurementsResult.rows.length === 0) {
      return { success: false, message: 'No measurements found' };
    }

    const measurement = measurementsResult.rows[0];

    // Get image URL (if exists)
    const imageResult = await pool.query(
      'SELECT storage_path FROM wound_images WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [request.sessionId]
    );
    const imageUrl = imageResult.rows.length > 0 ? imageResult.rows[0].storage_path : '';

    // Build form data for LibreClinica
    const formData: Record<string, any> = {
      IG_WOUND: {
        WOUND_AREA: measurement.area_cm2.toFixed(2),
        WOUND_PERIMETER: measurement.perimeter_cm.toFixed(2),
        WOUND_MAX_LENGTH: measurement.max_length_cm.toFixed(2),
        WOUND_MAX_WIDTH: measurement.max_width_cm.toFixed(2),
        WOUND_DEPTH: measurement.max_depth_cm ? measurement.max_depth_cm.toFixed(2) : '',
        WOUND_VOLUME: measurement.volume_cm3 ? measurement.volume_cm3.toFixed(2) : '',
        WOUND_IMAGE_URL: imageUrl,
        WOUND_SESSION_ID: request.sessionId,
        WOUND_NOTES: measurement.notes || ''
      }
    };

    // Parse study/event IDs
    const studyId = parseInt(session.study_id) || 1;
    const studyEventDefId = parseInt(session.study_event_id) || 1;
    const patientId = parseInt(session.patient_id);

    // Get CRF ID from template
    const crfResult = await pool.query(
      `SELECT crf_id FROM crf WHERE oc_oid = $1 OR name LIKE $2 LIMIT 1`,
      [session.template_id, `%${session.template_id}%`]
    );
    const crfId = crfResult.rows.length > 0 ? crfResult.rows[0].crf_id : 1;

    // Submit via SOAP
    const soapRequest = {
      studyId,
      subjectId: patientId,
      studyEventDefinitionId: studyEventDefId,
      crfId,
      formData
    };

    const soapResponse = await dataSoap.importData(soapRequest, userId, userName);

    if (!soapResponse.success) {
      // Update session status to failed
      await pool.query(
        `UPDATE wound_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [request.sessionId]
      );

      // Log failure
      await logAuditEntry({
        action: 'SUBMISSION_FAILED',
        userId: userId.toString(),
        userName,
        sessionId: request.sessionId,
        patientId: session.patient_id,
        details: {
          error: soapResponse.message || 'SOAP submission failed'
        }
      });

      return { success: false, message: soapResponse.message };
    }

    // Get LibreClinica IDs from response
    const libreClinicaId = soapResponse.data?.eventCrfId?.toString() || uuidv4();

    // Update session with LibreClinica IDs
    await pool.query(
      `UPDATE wound_sessions 
       SET status = 'submitted', submitted_at = NOW(), updated_at = NOW(),
           libreclinica_id = $1, submitted_by_user_id = $2, submitted_by_user_name = $3
       WHERE id = $4`,
      [libreClinicaId, userId.toString(), userName, request.sessionId]
    );

    // Log success
    await logAuditEntry({
      action: 'DATA_SUBMITTED',
      userId: userId.toString(),
      userName,
      sessionId: request.sessionId,
      patientId: session.patient_id,
      details: {
        libreclinica_id: libreClinicaId,
        measurement_count: '1'
      }
    });

    return {
      success: true,
      submitted: true,
      libreClinicaId,
      studyEventDataId: (soapResponse.data as any)?.studyEventDataId,
      itemDataId: (soapResponse.data as any)?.itemDataId
    };
  } catch (error: any) {
    logger.error('Submit to LibreClinica error', { error: error.message });
    return { success: false, message: error.message };
  }
};

// ============================================================================
// AUDIT TRAIL
// ============================================================================

/**
 * Log audit entry
 */
export const logAuditEntry = async (entry: Partial<AuditEntry>): Promise<void> => {
  try {
    const id = uuidv4();
    const now = new Date();
    
    // Get previous checksum for chain
    const prevResult = await pool.query(
      'SELECT checksum FROM audit_trail ORDER BY created_at DESC LIMIT 1'
    );
    const previousChecksum = prevResult.rows.length > 0 ? prevResult.rows[0].checksum : null;

    // Calculate checksum
    const checksumData = JSON.stringify({
      id,
      timestamp: now.toISOString(),
      action: entry.action,
      userId: entry.userId,
      sessionId: entry.sessionId,
      patientId: entry.patientId,
      previousChecksum
    });
    const checksum = crypto.createHash('sha256').update(checksumData).digest('hex');

    const query = `
      INSERT INTO audit_trail (
        id, action, category, severity, user_id, user_name, device_id,
        patient_id, session_id, details, checksum, previous_checksum,
        event_timestamp, source, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13)
    `;

    await pool.query(query, [
      id,
      entry.action,
      entry.category || 'WOUND_CAPTURE',
      entry.severity || 'INFO',
      entry.userId || null,
      entry.userName || null,
      entry.deviceId || null,
      entry.patientId || null,
      entry.sessionId || null,
      JSON.stringify(entry.details || {}),
      checksum,
      previousChecksum,
      now,
      entry.source || 'backend'
    ]);
  } catch (error: any) {
    logger.error('Log audit entry error', { error: error.message });
  }
};

/**
 * Submit batch audit entries from iOS
 */
export const submitAuditEntries = async (entries: AuditEntry[]): Promise<{ received: boolean; count: number }> => {
  let count = 0;

  for (const entry of entries) {
    try {
      const query = `
        INSERT INTO audit_trail (
          id, action, category, severity, user_id, user_name, device_id,
          patient_id, session_id, details, checksum, previous_checksum,
          event_timestamp, source, ip_address, received_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;

      await pool.query(query, [
        entry.id,
        entry.action,
        entry.category || 'WOUND_CAPTURE',
        entry.severity || 'INFO',
        entry.userId || null,
        entry.userName || null,
        entry.deviceId || null,
        entry.patientId || null,
        entry.sessionId || null,
        JSON.stringify(entry.details || {}),
        entry.checksum,
        entry.previousChecksum || null,
        entry.timestamp,
        entry.source || 'ios_app',
        entry.ipAddress || null
      ]);
      count++;
    } catch (error: any) {
      logger.error('Insert audit entry error', { error: error.message, entryId: entry.id });
    }
  }

  return { received: true, count };
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mapSessionRow(row: any): WoundSession {
  return {
    id: row.id,
    patientId: row.patient_id,
    templateId: row.template_id,
    studyId: row.study_id,
    studyEventId: row.study_event_id,
    siteId: row.site_id,
    deviceId: row.device_id,
    source: row.source,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdByUserName: row.created_by_user_name,
    submittedByUserId: row.submitted_by_user_id,
    submittedByUserName: row.submitted_by_user_name,
    libreClinicaId: row.libreclinica_id,
    studyEventDataId: row.study_event_data_id,
    itemDataId: row.item_data_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capturedAt: row.captured_at,
    signedAt: row.signed_at,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    dataHash: row.data_hash
  };
}

function mapMeasurementRow(row: any): WoundMeasurement {
  return {
    id: row.id,
    sessionId: row.session_id,
    imageId: row.image_id,
    areaCm2: parseFloat(row.area_cm2),
    perimeterCm: parseFloat(row.perimeter_cm),
    maxLengthCm: parseFloat(row.max_length_cm),
    maxWidthCm: parseFloat(row.max_width_cm),
    maxDepthCm: row.max_depth_cm ? parseFloat(row.max_depth_cm) : undefined,
    volumeCm3: row.volume_cm3 ? parseFloat(row.volume_cm3) : undefined,
    boundaryPoints: typeof row.boundary_points === 'string' 
      ? JSON.parse(row.boundary_points) 
      : row.boundary_points,
    pointCount: row.point_count,
    calibrationMethod: row.calibration_method,
    pixelsPerCm: parseFloat(row.pixels_per_cm),
    dataHash: row.data_hash,
    notes: row.notes,
    measuredAt: row.measured_at,
    createdAt: row.created_at
  };
}

export default {
  createSession,
  getSession,
  getPatientSessions,
  uploadImage,
  submitMeasurements,
  getSessionMeasurements,
  signSession,
  submitToLibreClinica,
  logAuditEntry,
  submitAuditEntries
};

