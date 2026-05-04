/**
 * Audit Middleware
 * 
 * Implements comprehensive audit logging for 21 CFR Part 11 compliance
 * - Logs all API requests to database
 * - Tracks user actions, timestamps, IP addresses
 * - Captures request/response data for audit trail
 * - Supports electronic signature requirements
 * 
 * Compliance: 21 CFR Part 11 §11.10(e) - Audit Trail
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { pool } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { verifyAndUpgrade } from '../utils/password.util';
import { trackUserAction } from '../services/database/audit.service';

/**
 * Extended Express Request with audit information
 */
export interface AuditRequest extends Request {
  auditId?: string;
  userId?: number;
  username?: string;
  userRole?: string;
  startTime?: number;
  reasonForChange?: string;
}

/**
 * Audit event types based on LibreClinica audit_log_event table
 */
export enum AuditEventType {
  LOGIN = 'User Login',
  LOGOUT = 'User Logout',
  SUBJECT_CREATED = 'Subject Created',
  SUBJECT_UPDATED = 'Subject Updated',
  DATA_ENTERED = 'Data Entry',
  DATA_UPDATED = 'Data Updated',
  QUERY_CREATED = 'Query Created',
  QUERY_RESPONDED = 'Query Responded',
  QUERY_CLOSED = 'Query Closed',
  FORM_SUBMITTED = 'Form Submitted',
  STUDY_ACCESSED = 'Study Accessed',
  REPORT_GENERATED = 'Report Generated',
  USER_CREATED = 'User Created',
  USER_UPDATED = 'User Updated',
  ROLE_CHANGED = 'Role Changed',
  PASSWORD_CHANGED = 'Password Changed',
  FAILED_LOGIN = 'Failed Login Attempt'
}

/**
 * Main audit logging middleware
 * Logs all incoming requests and responses to database and file
 */
export const auditMiddleware = async (
  req: AuditRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Generate unique audit ID for this request
  req.auditId = uuidv4();
  req.startTime = Date.now();

  // Extract user information from JWT (set by auth middleware)
  const authedReq = req as AuditRequest & { user?: { userId?: number; username?: string; role?: string } };
  const userId = authedReq.user?.userId;
  const username = authedReq.user?.username;
  const userRole = authedReq.user?.role;

  req.userId = userId;
  req.username = username;
  req.userRole = userRole;

  // Extract request metadata
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  const method = req.method;
  const path = req.path;
  const query = JSON.stringify(req.query);
  
  // Sanitize request body (remove sensitive data like passwords)
  const sanitizedBody = sanitizeRequestBody(req.body);
  const bodyString = JSON.stringify(sanitizedBody);

  // Log to Winston (file-based audit log)
  logger.info('API Request', {
    auditId: req.auditId,
    userId,
    username,
    userRole,
    method,
    path,
    query,
    body: sanitizedBody,
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString()
  });

  // Capture the original res.json to log responses
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const duration = Date.now() - (req.startTime || Date.now());
    const statusCode = res.statusCode;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    logger.info('API Response', {
      auditId: req.auditId,
      userId,
      username,
      method,
      path,
      statusCode,
      duration,
      timestamp: new Date().toISOString()
    });

    const auditPayload = {
      auditId: req.auditId!,
      userId,
      username: username || 'anonymous',
      userRole,
      method,
      path,
      query,
      requestBody: bodyString,
      responseStatus: statusCode,
      ipAddress,
      userAgent,
      duration
    };

    if (isMutation) {
      logToDatabase(auditPayload)
        .then(() => originalJson(body))
        .catch((err: Error) => {
          logger.error('CRITICAL: Audit log write failed for mutation', { error: err.message, method, path });
          res.status(503);
          originalJson({ success: false, message: 'Audit system unavailable — mutation cannot be completed' });
        });
      return res;
    }

    logToDatabase(auditPayload).catch((err: Error) => {
      logger.error('Failed to write audit log for read operation', { error: err.message });
    });
    return originalJson(body);
  };

  next();
};

/**
 * Log specific audit events to database
 * Uses LibreClinica's ACTUAL audit_log_event schema:
 * - audit_id (SERIAL - auto-generated)
 * - audit_date, audit_table, user_id, entity_id, entity_name
 * - old_value, new_value, reason_for_change
 * - audit_log_event_type_id (FK to audit_log_event_type)
 * - study_id, event_crf_id, study_event_id
 */
export const logAuditEvent = async (
  eventType: AuditEventType,
  userId: number,
  username: string,
  details: {
    entityName?: string;
    entityId?: number;
    oldValue?: string;
    newValue?: string;
    reasonForChange?: string;
    studyId?: number;
    eventCrfId?: number;
    studyEventId?: number;
    ipAddress?: string;
  }
): Promise<void> => {
  try {
    await trackUserAction({
      userId,
      username,
      action: eventType,
      entityType: details.entityName || 'api_request',
      entityId: details.entityId,
      entityName: details.entityName,
      oldValue: details.oldValue,
      newValue: details.newValue,
      details: details.reasonForChange,
      studyId: details.studyId,
      eventCrfId: details.eventCrfId,
      studyEventId: details.studyEventId
    });

    logger.info('Audit event logged', {
      eventType,
      userId,
      username,
      entityId: details.entityId
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to log audit event', {
      error: message,
      eventType,
      userId
    });
  }
};

/**
 * Write audit log entry to database
 * Inserts into custom audit_user_api_log table
 */
async function logToDatabase(data: {
  auditId: string;
  userId?: number;
  username: string;
  userRole?: string;
  method: string;
  path: string;
  query: string;
  requestBody: string;
  responseStatus: number;
  ipAddress: string;
  userAgent: string;
  duration: number;
}): Promise<void> {
  await ensureAuditTableExists();

  const query = `
    INSERT INTO audit_user_api_log (
      audit_id,
      user_id,
      username,
      user_role,
      http_method,
      endpoint_path,
      query_params,
      request_body,
      response_status,
      ip_address,
      user_agent,
      duration_ms,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
  `;

  await pool.query(query, [
    data.auditId,
    data.userId || null,
    data.username,
    data.userRole || null,
    data.method,
    data.path,
    data.query,
    data.requestBody,
    data.responseStatus,
    data.ipAddress,
    data.userAgent,
    data.duration
  ]);
}

/**
 * Ensure audit_user_api_log table exists
 * Creates table if it doesn't exist (for initial setup)
 */
async function ensureAuditTableExists(): Promise<void> {
  // Table is created by startup migrations (config/migrations.ts).
  // Just verify it exists.
  try {
    const result = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_user_api_log') as exists
    `);
    if (!result.rows[0].exists) {
      logger.warn('audit_user_api_log table not found — startup migrations may not have run');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('Audit table creation skipped', { error: message });
  }
}

/**
 * Sanitize request body to remove sensitive information
 * Removes passwords, tokens, and other sensitive fields from logs
 */
function sanitizeRequestBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const source = body as Record<string, unknown>;
  const sanitized: Record<string, unknown> = { ...source };

  const secretFields = [
    'password',
    'newPassword',
    'oldPassword',
    'confirmPassword',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'secret',
    'privateKey'
  ];

  const phiFields = [
    'firstName', 'lastName', 'first_name', 'last_name',
    'dateOfBirth', 'date_of_birth', 'dob', 'birthDate',
    'ssn', 'socialSecurityNumber', 'social_security_number',
    'medicalRecordNumber', 'medical_record_number', 'mrn',
    'diagnosis', 'diagnoses', 'medicalHistory', 'medical_history',
    'phoneNumber', 'phone_number', 'phone',
    'address', 'streetAddress', 'street_address',
    'emailAddress', 'patientEmail', 'patient_email',
    'insuranceId', 'insurance_id',
  ];

  for (const field of secretFields) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }

  for (const field of phiFields) {
    if (field in sanitized) {
      sanitized[field] = '***PHI_REDACTED***';
    }
  }

  return sanitized;
}

/**
 * Requires a reasonForChange field on clinical data mutation requests.
 * 21 CFR Part 11 §11.10(e) — audit trails must include reason for change.
 */
export const requireReasonForChange = (
  req: AuditRequest,
  res: Response,
  next: NextFunction
): void => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.reasonForChange !== 'string' || body.reasonForChange.trim() === '') {
    res.status(400).json({
      success: false,
      message: 'A reason for change is required for clinical data modifications per 21 CFR Part 11 §11.10(e)'
    });
    return;
  }
  req.reasonForChange = body.reasonForChange.trim();
  next();
};

/**
 * Audit middleware for electronic signatures
 * Validates and logs electronic signatures per 21 CFR Part 11 §11.50
 */
export const electronicSignatureMiddleware = async (
  req: AuditRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { username, password, meaning } = req.body;

  if (!username || !password || !meaning) {
    res.status(400).json({
      success: false,
      message: 'Electronic signature requires username, password, and meaning'
    });
    return;
  }

  try {
    // Verify credentials (password check)
    const authQuery = `
      SELECT ua.user_id, ua.user_name, ua.passwd, uae.bcrypt_passwd
      FROM user_account ua
      LEFT JOIN user_account_extended uae ON ua.user_id = uae.user_id
      WHERE ua.user_name = $1 AND ua.status_id = 1
    `;
    
    const result = await pool.query(authQuery, [username]);

    if (result.rows.length === 0) {
      await logAuditEvent(
        AuditEventType.FAILED_LOGIN,
        0,
        username,
        { 
          entityName: 'electronic_signature',
          reasonForChange: 'Invalid credentials for electronic signature',
          ipAddress: req.ip
        }
      );

      res.status(401).json({
        success: false,
        message: 'Invalid electronic signature credentials'
      });
      return;
    }

    const user = result.rows[0];

    // Verify the submitted password against stored hash
    const verification = await verifyAndUpgrade(
      password,
      user.passwd,
      user.bcryptPasswd || null
    );

    if (!verification.valid) {
      await logAuditEvent(
        AuditEventType.FAILED_LOGIN,
        user.userId,
        username,
        {
          entityName: 'electronic_signature',
          reasonForChange: 'Invalid password for electronic signature',
          ipAddress: req.ip
        }
      );

      res.status(401).json({
        success: false,
        message: 'Invalid electronic signature credentials'
      });
      return;
    }

    // Upgrade hash to bcrypt if needed (non-blocking)
    if (verification.shouldUpdateDatabase && verification.upgradedBcryptHash) {
      pool.query(`
        INSERT INTO user_account_extended (user_id, bcrypt_passwd, passwd_upgraded_at, password_version)
        VALUES ($1, $2, NOW(), 2)
        ON CONFLICT (user_id) DO UPDATE SET bcrypt_passwd = $2, passwd_upgraded_at = NOW(), password_version = 2
      `, [user.userId, verification.upgradedBcryptHash]).catch(() => {});
    }

    // Log electronic signature
    await logAuditEvent(
      AuditEventType.DATA_ENTERED,
      user.userId,
      username,
      {
        entityName: 'electronic_signature',
        newValue: meaning,
        reasonForChange: 'Electronic signature applied',
        ipAddress: req.ip
      }
    );

    // Add signature info to request
    (req as AuditRequest & { electronicSignature?: { userId: number; username: string; meaning: string; timestamp: Date } }).electronicSignature = {
      userId: user.userId,
      username,
      meaning,
      timestamp: new Date()
    };

    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Electronic signature validation error', { error: message });
    res.status(500).json({
      success: false,
      message: 'Electronic signature validation failed'
    });
  }
};

export default auditMiddleware;

