/**
 * 21 CFR Part 11 Compliance Middleware
 * 
 * Implements electronic signature requirements and audit trail logging
 * per 21 CFR Part 11:
 * - §11.50: Electronic signature manifestations
 * - §11.10(e): Audit trail for record changes
 * - §11.10(d): Access controls
 * - §11.300: Controls for identification codes/passwords
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { pool } from '../config/database';
import bcrypt from 'bcrypt';

/**
 * Extended Express Request with Part 11 audit information
 */
export interface Part11Request extends Request {
  user?: {
    userId: number;
    userName: string;
    email: string;
    userType: string;
    role: string;
    studyIds?: number[];
  };
  auditId?: string;
  signatureVerified?: boolean;
  signatureMeaning?: string;
}

/**
 * Signature meanings for electronic signatures per §11.50
 * Each meaning describes the intent of the signer
 */
export const SignatureMeanings = {
  // Study management
  STUDY_CREATE: 'I have reviewed and authorize the creation of this study',
  STUDY_UPDATE: 'I have reviewed and authorize the modification of this study',
  STUDY_DELETE: 'I authorize the deletion of this study and all associated data',

  // Subject/Patient management
  SUBJECT_ENROLL: 'I authorize the enrollment of this subject into the study',
  SUBJECT_UPDATE: 'I have reviewed and authorize the modification of this subject record',
  SUBJECT_WITHDRAW: 'I authorize the withdrawal of this subject from the study',
  SUBJECT_DELETE: 'I authorize the deletion of this subject record',

  // Event management
  EVENT_CREATE: 'I authorize the creation of this study event definition',
  EVENT_UPDATE: 'I authorize the modification of this study event definition',
  EVENT_DELETE: 'I authorize the deletion of this study event definition',
  EVENT_SCHEDULE: 'I authorize the scheduling of this event for the subject',

  // CRF/Form management
  CRF_CREATE: 'I authorize the creation of this case report form',
  CRF_UPDATE: 'I authorize the modification of this case report form',
  CRF_DELETE: 'I authorize the deletion of this case report form',
  CRF_ASSIGN: 'I authorize the assignment of this CRF to the study event',

  // Form data
  FORM_DATA_SAVE: 'I confirm the accuracy of the data entered in this form',
  FORM_LOCK: 'I authorize locking this form to prevent further modifications',

  // Query management
  QUERY_CREATE: 'I authorize the creation of this data query',
  QUERY_RESPOND: 'I confirm my response to this data query',
  QUERY_CLOSE: 'I authorize the closure of this data query',

  // SDV/Verification
  VERIFY: 'I have verified the source data for this record',

  // General authorization
  AUTHORIZE: 'I authorize this action',
} as const;

/**
 * Part 11 audit event types
 */
export const Part11EventTypes = {
  // Transfer events
  TRANSFER_INITIATED: 'TRANSFER_INITIATED',
  TRANSFER_APPROVED: 'TRANSFER_APPROVED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  TRANSFER_CANCELLED: 'TRANSFER_CANCELLED',

  // RTSM/Kit events
  KIT_REGISTERED: 'KIT_REGISTERED',
  KIT_DISPENSED: 'KIT_DISPENSED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPMENT_RECEIVED: 'SHIPMENT_RECEIVED',
  INVENTORY_ALERT_CREATED: 'INVENTORY_ALERT_CREATED',
  INVENTORY_ALERT_ACKNOWLEDGED: 'INVENTORY_ALERT_ACKNOWLEDGED',
  INVENTORY_ALERT_RESOLVED: 'INVENTORY_ALERT_RESOLVED',

  // ePRO events
  PRO_INSTRUMENT_CREATED: 'PRO_INSTRUMENT_CREATED',
  PRO_ASSIGNMENT_CREATED: 'PRO_ASSIGNMENT_CREATED',
  PRO_REMINDER_SENT: 'PRO_REMINDER_SENT',
  PRO_RESPONSE_SUBMITTED: 'PRO_RESPONSE_SUBMITTED',
  PRO_REMINDER_CREATED: 'PRO_REMINDER_CREATED',
  PRO_REMINDER_CANCELLED: 'PRO_REMINDER_CANCELLED',

  // Email events
  EMAIL_TEMPLATE_UPDATED: 'EMAIL_TEMPLATE_UPDATED',

  // Consent events
  CONSENT_DOCUMENT_CREATED: 'CONSENT_DOCUMENT_CREATED',
  CONSENT_SIGNED: 'CONSENT_SIGNED',
} as const;

/**
 * Format a Part 11 compliant timestamp (ISO 8601)
 */
export function formatPart11Timestamp(date?: Date): string {
  return (date || new Date()).toISOString();
}

/**
 * Record a Part 11 audit event to the database
 * §11.10(e) - Use of secure, computer-generated, time-stamped audit trails
 */
export async function recordPart11Audit(
  userId: number,
  username: string,
  eventType: string,
  tableName: string,
  entityId: number | string,
  entityName: string,
  oldValue: any,
  newValue: any,
  reasonForChange?: string,
  metadata?: { ipAddress?: string; [key: string]: any }
): Promise<void> {
  try {
    // Try to insert into audit_log_event (LibreClinica native table)
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_date,
        audit_table,
        user_id,
        entity_id,
        entity_name,
        old_value,
        new_value,
        audit_log_event_type_id,
        reason_for_change
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, 
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name ILIKE $7 LIMIT 1),
        $8
      )
    `, [
      tableName,
      userId,
      typeof entityId === 'string' ? null : entityId,
      entityName,
      typeof oldValue === 'object' ? JSON.stringify(oldValue) : (oldValue || ''),
      typeof newValue === 'object' ? JSON.stringify(newValue) : (newValue || ''),
      eventType.split('_')[0] || 'data',
      reasonForChange || ''
    ]);

    logger.info('Part 11 audit event recorded', {
      eventType,
      userId,
      username,
      tableName,
      entityId,
      entityName,
      ipAddress: metadata?.ipAddress
    });
  } catch (error: any) {
    // Fall back to logging if database insert fails
    logger.error('Failed to record Part 11 audit event to database', {
      error: error.message,
      eventType,
      userId,
      username,
      tableName,
      entityId
    });

    // Always log to file as backup (Part 11 requires audit trail integrity)
    logger.info('Part 11 audit event (file fallback)', {
      eventType,
      userId,
      username,
      tableName,
      entityId,
      entityName,
      oldValue: typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue,
      newValue: typeof newValue === 'object' ? JSON.stringify(newValue) : newValue,
      reasonForChange,
      timestamp: formatPart11Timestamp(),
      ipAddress: metadata?.ipAddress
    });
  }
}

/**
 * Middleware: Require electronic signature for an action
 * §11.50 - Signature manifestations
 * 
 * If the request includes signature fields (signatureUsername, signaturePassword),
 * they are verified. If not present, the action proceeds without signature
 * (signature is optional but logged when provided).
 */
export function requireSignatureFor(meaning: string) {
  return async (req: Part11Request, res: Response, next: NextFunction): Promise<void> => {
    const { signatureUsername, signaturePassword, signatureMeaning } = req.body;

    // If no signature fields provided, proceed without signature
    // The route handler can check req.signatureVerified if it needs to enforce
    if (!signatureUsername && !signaturePassword) {
      req.signatureVerified = false;
      req.signatureMeaning = meaning;
      next();
      return;
    }

    // If partial signature provided, reject
    if (!signatureUsername || !signaturePassword) {
      res.status(400).json({
        success: false,
        message: 'Electronic signature requires both username and password (21 CFR Part 11 §11.50)'
      });
      return;
    }

    try {
      // Verify the signer's credentials against the database
      const result = await pool.query(
        'SELECT user_id, user_name, passwd FROM user_account WHERE user_name = $1 AND status_id = 1',
        [signatureUsername]
      );

      if (result.rows.length === 0) {
        logger.warn('Electronic signature failed - user not found', {
          signatureUsername,
          requestedBy: req.user?.userName,
          path: req.path
        });
        res.status(401).json({
          success: false,
          message: 'Invalid electronic signature credentials'
        });
        return;
      }

      const signer = result.rows[0];

      // Verify password (LibreClinica stores passwords as bcrypt or MD5 hashes)
      let passwordValid = false;
      if (signer.passwd) {
        if (signer.passwd.startsWith('$2')) {
          // bcrypt hash
          passwordValid = await bcrypt.compare(signaturePassword, signer.passwd);
        } else {
          // MD5 hash comparison (legacy LibreClinica)
          const md5 = require('md5');
          passwordValid = md5(signaturePassword) === signer.passwd;
        }
      }

      if (!passwordValid) {
        logger.warn('Electronic signature failed - invalid password', {
          signatureUsername,
          requestedBy: req.user?.userName,
          path: req.path
        });
        res.status(401).json({
          success: false,
          message: 'Invalid electronic signature credentials'
        });
        return;
      }

      // Signature verified
      req.signatureVerified = true;
      req.signatureMeaning = signatureMeaning || meaning;

      logger.info('Electronic signature verified', {
        signerId: signer.user_id,
        signerUsername: signatureUsername,
        meaning: req.signatureMeaning,
        path: req.path,
        requestedBy: req.user?.userName
      });

      next();
    } catch (error: any) {
      logger.error('Electronic signature verification error', {
        error: error.message,
        signatureUsername,
        path: req.path
      });
      res.status(500).json({
        success: false,
        message: 'Electronic signature verification failed'
      });
    }
  };
}

/**
 * Middleware: Require electronic signature (strict - blocks if not provided)
 * Used for high-risk operations like dispensing, approvals
 * §11.50 - Signature manifestations
 */
export async function requireSignature(
  req: Part11Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { password, signaturePassword, signatureMeaning } = req.body;
  const sigPassword = password || signaturePassword;

  if (!sigPassword) {
    res.status(400).json({
      success: false,
      message: 'Electronic signature (password) is required for this action (21 CFR Part 11 §11.50)'
    });
    return;
  }

  // Verify the current user's password
  const userId = req.user?.userId;
  const userName = req.user?.userName;

  if (!userId || !userName) {
    res.status(401).json({
      success: false,
      message: 'Authentication required for electronic signature'
    });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT passwd FROM user_account WHERE user_id = $1 AND status_id = 1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: 'User account not found or inactive'
      });
      return;
    }

    const storedPassword = result.rows[0].passwd;
    let passwordValid = false;

    if (storedPassword) {
      if (storedPassword.startsWith('$2')) {
        passwordValid = await bcrypt.compare(sigPassword, storedPassword);
      } else {
        const md5 = require('md5');
        passwordValid = md5(sigPassword) === storedPassword;
      }
    }

    if (!passwordValid) {
      logger.warn('Electronic signature failed - invalid password (strict)', {
        userId,
        userName,
        path: req.path
      });
      res.status(401).json({
        success: false,
        message: 'Invalid password for electronic signature'
      });
      return;
    }

    req.signatureVerified = true;
    req.signatureMeaning = signatureMeaning || 'Authorized action';

    logger.info('Electronic signature verified (strict)', {
      userId,
      userName,
      meaning: req.signatureMeaning,
      path: req.path
    });

    next();
  } catch (error: any) {
    logger.error('Electronic signature verification error (strict)', {
      error: error.message,
      userId,
      path: req.path
    });
    res.status(500).json({
      success: false,
      message: 'Electronic signature verification failed'
    });
  }
}

/**
 * Verify electronic signature credentials (standalone function)
 * Can be called from route handlers directly
 */
export async function verifyElectronicSignature(
  username: string,
  password: string
): Promise<{ valid: boolean; userId?: number; message?: string }> {
  try {
    const result = await pool.query(
      'SELECT user_id, passwd FROM user_account WHERE user_name = $1 AND status_id = 1',
      [username]
    );

    if (result.rows.length === 0) {
      return { valid: false, message: 'User not found or inactive' };
    }

    const storedPassword = result.rows[0].passwd;
    let passwordValid = false;

    if (storedPassword) {
      if (storedPassword.startsWith('$2')) {
        passwordValid = await bcrypt.compare(password, storedPassword);
      } else {
        const md5 = require('md5');
        passwordValid = md5(password) === storedPassword;
      }
    }

    if (!passwordValid) {
      return { valid: false, message: 'Invalid password' };
    }

    return { valid: true, userId: result.rows[0].user_id };
  } catch (error: any) {
    logger.error('Electronic signature verification error', { error: error.message });
    return { valid: false, message: 'Verification failed' };
  }
}
