/**
 * Wound Scanner Type Definitions
 * 
 * Types for WoundScanner iOS app integration
 * 21 CFR Part 11 compliant wound capture and measurement
 */

// ============================================================================
// SESSION TYPES
// ============================================================================

export type SessionStatus = 
  | 'draft'
  | 'captured'
  | 'signed'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export type CalibrationMethod = 
  | 'manual'
  | 'coin'
  | 'ruler'
  | 'credit_card'
  | 'lidar'
  | 'arkit';

export type SignatureMeaning = 
  | 'AUTHORSHIP'
  | 'APPROVAL'
  | 'REVIEW'
  | 'WITNESSING'
  | 'VERIFICATION';

export type SignatureAuthMethod = 
  | 'BIOMETRIC'
  | 'PASSWORD'
  | 'MFA';

// ============================================================================
// WOUND SESSION
// ============================================================================

export interface WoundSession {
  id: string;
  patientId: string;
  templateId: string;
  studyId?: string;
  studyEventId?: string;
  siteId?: string;
  deviceId?: string;
  source: 'ios_app' | 'app_clip' | 'web';
  status: SessionStatus;
  createdByUserId: string;
  createdByUserName: string;
  submittedByUserId?: string;
  submittedByUserName?: string;
  libreClinicaId?: string;
  studyEventDataId?: string;
  itemDataId?: string;
  createdAt: Date;
  updatedAt: Date;
  capturedAt?: Date;
  signedAt?: Date;
  submittedAt?: Date;
  confirmedAt?: Date;
  dataHash?: string;
}

export interface CreateSessionRequest {
  patientId: string;
  templateId: string;
  studyId?: string;
  studyEventId?: string;
  siteId?: string;
  deviceId?: string;
  source?: 'ios_app' | 'app_clip' | 'web';
}

export interface CreateSessionResponse {
  success: boolean;
  sessionId?: string;
  createdAt?: Date;
  status?: SessionStatus;
  message?: string;
}

// ============================================================================
// WOUND IMAGE
// ============================================================================

export interface WoundImage {
  id: string;
  sessionId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  storageType: 's3' | 'postgres_lo' | 'local';
  hash: string;
  hashVerified: boolean;
  capturedAt: Date;
  uploadCompletedAt?: Date;
  qualityScore?: number;
  qualityIssues?: Record<string, any>;
  createdAt: Date;
}

export interface ImageUploadRequest {
  sessionId: string;
  hash: string;
}

export interface ImageUploadResponse {
  success: boolean;
  imageId?: string;
  hash?: string;
  hashVerified?: boolean;
  size?: number;
  message?: string;
}

// ============================================================================
// WOUND MEASUREMENT
// ============================================================================

export interface WoundMeasurement {
  id: string;
  sessionId: string;
  imageId?: string;
  areaCm2: number;
  perimeterCm: number;
  maxLengthCm: number;
  maxWidthCm: number;
  maxDepthCm?: number;
  volumeCm3?: number;
  boundaryPoints: { x: number; y: number }[];
  pointCount: number;
  calibrationMethod: CalibrationMethod;
  pixelsPerCm: number;
  dataHash: string;
  notes?: string;
  measuredAt: Date;
  createdAt: Date;
}

export interface SubmitMeasurementsRequest {
  sessionId: string;
  measurements: Omit<WoundMeasurement, 'id' | 'sessionId' | 'createdAt'>[];
  dataHash: string;
}

export interface SubmitMeasurementsResponse {
  success: boolean;
  received?: boolean;
  count?: number;
  hashVerified?: boolean;
  message?: string;
}

// ============================================================================
// ELECTRONIC SIGNATURE
// ============================================================================

export interface ElectronicSignature {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  userRole: string;
  meaning: SignatureMeaning;
  manifestation: string;
  dataHash: string;
  signatureValue: string;
  authMethod: SignatureAuthMethod;
  deviceId?: string;
  signedAt: Date;
  isValid: boolean;
  verifiedAt?: Date;
  createdAt: Date;
}

export interface SignSessionRequest {
  sessionId: string;
  signature: {
    userId: string;
    userName: string;
    userRole: string;
    meaning: SignatureMeaning;
    manifestation: string;
    dataHash: string;
    signatureValue: string;
    authMethod: SignatureAuthMethod;
    deviceId?: string;
  };
}

export interface SignSessionResponse {
  success: boolean;
  signed?: boolean;
  signatureId?: string;
  message?: string;
}

// ============================================================================
// LIBRECLINICA SUBMISSION
// ============================================================================

export interface SubmitToLibreClinicaRequest {
  sessionId: string;
  auditTrail?: AuditEntry[];
}

export interface SubmitToLibreClinicaResponse {
  success: boolean;
  submitted?: boolean;
  libreClinicaId?: string;
  studyEventDataId?: string;
  itemDataId?: string;
  message?: string;
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

export type AuditAction =
  | 'USER_AUTHENTICATED'
  | 'USER_LOGGED_OUT'
  | 'BIOMETRIC_REAUTH'
  | 'SESSION_EXPIRED'
  | 'WOUND_CAPTURE_STARTED'
  | 'WOUND_IMAGE_CAPTURED'
  | 'WOUND_MEASUREMENT_CALCULATED'
  | 'WOUND_DATA_EDITED'
  | 'WOUND_DATA_DELETED'
  | 'ESIGNATURE_APPLIED'
  | 'DATA_SUBMITTED'
  | 'SUBMISSION_CONFIRMED'
  | 'SUBMISSION_FAILED'
  | 'PATIENT_DATA_ACCESSED'
  | 'DATA_EXPORTED'
  | 'SYNC_STARTED'
  | 'SYNC_COMPLETED'
  | 'OFFLINE_DATA_QUEUED'
  | 'OFFLINE_DATA_UPLOADED'
  | 'APP_LAUNCHED'
  | 'APP_BACKGROUNDED';

export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  category: string;
  severity: AuditSeverity;
  userId?: string;
  userName?: string;
  deviceId?: string;
  patientId?: string;
  sessionId?: string;
  details: Record<string, string>;
  checksum: string;
  previousChecksum?: string;
  source: 'ios_app' | 'app_clip' | 'web' | 'backend';
  ipAddress?: string;
}

export interface SubmitAuditEntriesRequest {
  entries: AuditEntry[];
}

export interface SubmitAuditEntriesResponse {
  success: boolean;
  received?: boolean;
  count?: number;
  message?: string;
}

// ============================================================================
// SYNC
// ============================================================================

export interface SyncBatchRequest {
  sessions: PendingSession[];
  deviceId: string;
}

export interface PendingSession {
  localId: string;
  patientId: string;
  templateId: string;
  measurements: Omit<WoundMeasurement, 'id' | 'sessionId' | 'createdAt'>[];
  signature?: Omit<ElectronicSignature, 'id' | 'sessionId' | 'createdAt'>;
  auditTrail: AuditEntry[];
  createdAt: Date;
}

export interface SyncBatchResponse {
  success: boolean;
  syncedSessions?: {
    localId: string;
    serverId: string;
    libreClinicaId?: string;
  }[];
  failedSessions?: {
    localId: string;
    error: string;
    retryable: boolean;
  }[];
  message?: string;
}

// ============================================================================
// CAPTURE TOKEN
// ============================================================================

export interface CaptureTokenRequest {
  patientId: string;
  templateId: string;
  studyId?: string;
  studyEventId?: string;
  expiresIn?: string;
}

export interface CaptureTokenResponse {
  success: boolean;
  token?: string;
  expiresAt?: Date;
  universalLink?: string;
  message?: string;
}

export interface ValidateTokenRequest {
  token: string;
  deviceId: string;
  deviceInfo?: {
    model?: string;
    osVersion?: string;
    appVersion?: string;
  };
}

export interface ValidateTokenResponse {
  valid: boolean;
  error?: string;
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    permissions: string[];
    siteId?: string;
    studyId?: string;
  };
  context?: {
    patientId: string;
    patientInitials?: string;
    templateId: string;
    templateName?: string;
    studyId?: string;
    studyEventId?: string;
    siteId?: string;
  };
  expiresAt?: Date;
}

// ============================================================================
// DEVICE
// ============================================================================

export interface Device {
  id: string;
  deviceId: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
  pushToken?: string;
  userId?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// TEMPLATE CACHE
// ============================================================================

export interface TemplateCache {
  id: string;
  templateId: string;
  name: string;
  version: string;
  definition: Record<string, any>;
  libreClinicaCrfId?: string;
  libreClinicaVersionId?: string;
  fetchedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// API RESPONSES
// ============================================================================

export interface WoundApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedWoundResponse<T = any> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

