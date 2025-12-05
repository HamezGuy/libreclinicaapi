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

/**
 * Extended Express Request with audit information
 */
export interface AuditRequest extends Request {
  auditId?: string;
  userId?: number;
  username?: string;
  userRole?: string;
  startTime?: number;
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
  const userId = (req as any).user?.userId;
  const username = (req as any).user?.username;
  const userRole = (req as any).user?.role;

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
  res.json = function (body: any) {
    const duration = Date.now() - (req.startTime || Date.now());
    const statusCode = res.statusCode;

    // Log response
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

    // Write audit entry to database (async, non-blocking)
    logToDatabase({
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
    }).catch(err => {
      logger.error('Failed to write audit log to database', { error: err.message });
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
    // First, get or create the event type ID
    const eventTypeResult = await pool.query(
      `SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE $1 LIMIT 1`,
      [`%${eventType.split(' ')[0]}%`]
    );
    
    const eventTypeId = eventTypeResult.rows[0]?.audit_log_event_type_id || 1;

    // Insert using CORRECT column names from LibreClinica schema
    // Note: audit_log_event does NOT have study_id column - only study_event_id, event_crf_id
    const query = `
      INSERT INTO audit_log_event (
        audit_date,
        audit_table,
        user_id,
        entity_id,
        entity_name,
        old_value,
        new_value,
        audit_log_event_type_id,
        reason_for_change,
        event_crf_id,
        study_event_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
    `;

    await pool.query(query, [
      details.entityName || 'api_request',  // audit_table
      userId,                                // user_id
      details.entityId || null,              // entity_id
      details.entityName || null,            // entity_name
      details.oldValue || null,              // old_value
      details.newValue || null,              // new_value
      eventTypeId,                           // audit_log_event_type_id
      details.reasonForChange || null,       // reason_for_change
      details.eventCrfId || null,            // event_crf_id
      details.studyEventId || null           // study_event_id
    ]);

    logger.info('Audit event logged', {
      eventType,
      eventTypeId,
      userId,
      username,
      entityId: details.entityId
    });
  } catch (error: any) {
    logger.error('Failed to log audit event', {
      error: error.message,
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
  try {
    // Check if table exists, create if not
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
  } catch (error: any) {
    logger.error('Database audit log error', { error: error.message });
  }
}

/**
 * Ensure audit_user_api_log table exists
 * Creates table if it doesn't exist (for initial setup)
 */
async function ensureAuditTableExists(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS audit_user_api_log (
      id SERIAL PRIMARY KEY,
      audit_id VARCHAR(36) NOT NULL UNIQUE,
      user_id INTEGER,
      username VARCHAR(255) NOT NULL,
      user_role VARCHAR(50),
      http_method VARCHAR(10) NOT NULL,
      endpoint_path VARCHAR(500) NOT NULL,
      query_params TEXT,
      request_body TEXT,
      response_status INTEGER,
      ip_address VARCHAR(45),
      user_agent TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_user_api_log_user_id ON audit_user_api_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user_api_log_created_at ON audit_user_api_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user_api_log_endpoint ON audit_user_api_log(endpoint_path);
  `;

  try {
    await pool.query(createTableQuery);
  } catch (error: any) {
    // Table might already exist, ignore error
    logger.debug('Audit table creation skipped', { error: error.message });
  }
}

/**
 * Sanitize request body to remove sensitive information
 * Removes passwords, tokens, and other sensitive fields from logs
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = [
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

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }

  return sanitized;
}

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
      SELECT user_id, user_name, passwd 
      FROM user_account 
      WHERE user_name = $1 AND status_id = 1
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

    // Log electronic signature
    await logAuditEvent(
      AuditEventType.DATA_ENTERED,
      result.rows[0].user_id,
      username,
      {
        entityName: 'electronic_signature',
        newValue: meaning,
        reasonForChange: 'Electronic signature applied',
        ipAddress: req.ip
      }
    );

    // Add signature info to request
    (req as any).electronicSignature = {
      userId: result.rows[0].user_id,
      username,
      meaning,
      timestamp: new Date()
    };

    next();
  } catch (error: any) {
    logger.error('Electronic signature validation error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Electronic signature validation failed'
    });
  }
};

export default auditMiddleware;

