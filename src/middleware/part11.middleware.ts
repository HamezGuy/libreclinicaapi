/**
 * 21 CFR Part 11 Compliance Middleware
 * 
 * Implements electronic signature requirements per 21 CFR Part 11:
 * - §11.50: Signature manifestations
 * - §11.100: General requirements for electronic signatures
 * - §11.200: Electronic signature components and controls
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../config/logger';

// Extend Request to include Part 11 signature data and user
export interface Part11Request extends Request {
  signatureVerified?: boolean;
  signatureMeaning?: string;
  signatureTimestamp?: Date;
  user?: {
    userId: number;
    username: string;
    userName?: string;
    role?: string;
    userType?: string;
    [key: string]: any;
  };
}

/**
 * Part 11 Event Types for audit logging
 */
export const Part11EventTypes = {
  // Core events
  ELECTRONIC_SIGNATURE: 'electronic_signature',
  DATA_ENTRY: 'data_entry',
  DATA_MODIFICATION: 'data_modification',
  SUBJECT_ENROLLMENT: 'subject_enrollment',
  FORM_SUBMISSION: 'form_submission',
  QUERY_ACTION: 'query_action',
  SDV_ACTION: 'sdv_action',
  TRANSFER_ACTION: 'transfer_action',
  SITE_ACTION: 'site_action',
  
  // Email events
  EMAIL_TEMPLATE_UPDATED: 'email_template_updated',
  EMAIL_SENT: 'email_sent',
  EMAIL_QUEUED: 'email_queued',
  
  // ePRO events
  PRO_INSTRUMENT_CREATED: 'pro_instrument_created',
  PRO_INSTRUMENT_UPDATED: 'pro_instrument_updated',
  PRO_ASSIGNMENT_CREATED: 'pro_assignment_created',
  PRO_ASSIGNMENT_UPDATED: 'pro_assignment_updated',
  PRO_REMINDER_SENT: 'pro_reminder_sent',
  PRO_RESPONSE_SUBMITTED: 'pro_response_submitted',
  
  // RTSM/IRT events
  KIT_REGISTERED: 'kit_registered',
  KIT_UPDATED: 'kit_updated',
  KIT_DISPENSED: 'kit_dispensed',
  SHIPMENT_CREATED: 'shipment_created',
  SHIPMENT_RECEIVED: 'shipment_received',
  SHIPMENT_CANCELLED: 'shipment_cancelled',
  
  // Transfer events
  TRANSFER_INITIATED: 'transfer_initiated',
  TRANSFER_APPROVED: 'transfer_approved',
  TRANSFER_COMPLETED: 'transfer_completed',
  TRANSFER_CANCELLED: 'transfer_cancelled',
  TRANSFER_REJECTED: 'transfer_rejected',
  
  // PRO Reminder events
  PRO_REMINDER_CREATED: 'pro_reminder_created',
  PRO_REMINDER_CANCELLED: 'pro_reminder_cancelled',
  
  // Inventory Alert events
  INVENTORY_ALERT_CREATED: 'inventory_alert_created',
  INVENTORY_ALERT_ACKNOWLEDGED: 'inventory_alert_acknowledged',
  INVENTORY_ALERT_RESOLVED: 'inventory_alert_resolved',
  
  // CRF/Item Flagging events
  FLAG_WORKFLOW_CREATED: 'flag_workflow_created',
  CRF_FLAG_CREATED: 'crf_flag_created',
  CRF_FLAG_UPDATED: 'crf_flag_updated',
  CRF_FLAG_DELETED: 'crf_flag_deleted',
  ITEM_FLAG_CREATED: 'item_flag_created',
  ITEM_FLAG_UPDATED: 'item_flag_updated',
  ITEM_FLAG_DELETED: 'item_flag_deleted'
} as const;

/**
 * Standard signature meanings for different operations
 * Per 21 CFR Part 11 §11.50
 */
export const SignatureMeanings = {
  // Subject operations
  SUBJECT_ENROLL: 'I confirm this subject meets enrollment criteria and consent has been obtained',
  SUBJECT_UPDATE: 'I authorize this modification to subject information',
  SUBJECT_WITHDRAW: 'I confirm this subject withdrawal is documented and authorized',
  SUBJECT_DELETE: 'I authorize removal of this subject record',
  SUBJECT_TRANSFER: 'I authorize transfer of this subject between sites',
  
  // Study operations
  STUDY_CREATE: 'I authorize creation of this study',
  STUDY_UPDATE: 'I authorize modification of this study',
  STUDY_DELETE: 'I authorize deletion of this study',
  
  // Site operations
  SITE_CREATE: 'I authorize creation of this site',
  SITE_UPDATE: 'I authorize modification of this site',
  SITE_DELETE: 'I authorize deletion of this site',
  
  // Staff operations
  STAFF_ASSIGN: 'I authorize assignment of staff to this site/study',
  STAFF_REMOVE: 'I authorize removal of staff from this site/study',
  
  // Event operations
  EVENT_CREATE: 'I authorize creation of this study event definition',
  EVENT_UPDATE: 'I authorize modification of this study event',
  EVENT_DELETE: 'I authorize deletion of this study event',
  EVENT_SCHEDULE: 'I authorize scheduling of this study event',
  
  // Form/CRF operations
  CRF_CREATE: 'I authorize creation of this case report form',
  CRF_UPDATE: 'I authorize modification of this case report form',
  CRF_DELETE: 'I authorize deletion of this case report form',
  CRF_ASSIGN: 'I authorize assignment of this CRF to the study event',
  FORM_DATA_SAVE: 'I confirm the accuracy of this data entry',
  FORM_LOCK: 'I confirm this form data is complete and locked',
  
  // Query operations
  QUERY_CREATE: 'I authorize creation of this data query',
  QUERY_RESPOND: 'I authorize this response to the data query',
  QUERY_CLOSE: 'I authorize closure of this data query',
  
  // SDV operations
  VERIFY: 'I confirm source document verification is complete',
  
  // RTSM operations
  RANDOMIZE: 'I confirm this subject meets randomization criteria',
  UNBLIND: 'I authorize unblinding of treatment assignment',
  DISPENSE: 'I authorize dispensing of investigational product',
  
  // General
  AUTHORIZE: 'I authorize this action'
} as const;

export type SignatureMeaning = typeof SignatureMeanings[keyof typeof SignatureMeanings] | string;

/**
 * Format timestamp for Part 11 audit records (ISO 8601 UTC)
 */
export const formatPart11Timestamp = (date?: Date): string => {
  const d = date || new Date();
  return d.toISOString();
};

/**
 * Record Part 11 compliant audit entry
 * 
 * @param userId - User ID performing the action
 * @param userName - Username for audit display
 * @param eventType - Type of event (from Part11EventTypes)
 * @param tableName - Database table affected
 * @param entityId - ID of the entity being modified
 * @param entityName - Human-readable name of entity
 * @param oldValue - Previous state (object or null)
 * @param newValue - New state (object or null)
 * @param reason - Reason for the change
 * @param metadata - Additional metadata (ipAddress, etc.)
 */
export const recordPart11Audit = async (
  userId: number,
  userName: string,
  eventType: string,
  tableName: string,
  entityId: number,
  entityName: string,
  oldValue: Record<string, any> | null,
  newValue: Record<string, any> | null,
  reason: string,
  metadata?: Record<string, any>
): Promise<void> => {
  try {
    const auditData = {
      userName,
      eventType,
      entityName,
      timestamp: formatPart11Timestamp(),
      ...metadata
    };

    await pool.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7,
        COALESCE(
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%' || $8 || '%' LIMIT 1),
          1
        )
      )
    `, [
      tableName,
      userId,
      entityId,
      entityName,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      reason + (metadata ? ` | ${JSON.stringify(auditData)}` : ''),
      eventType
    ]);
    
    logger.debug('Part 11 audit recorded', { eventType, entityId, userId });
  } catch (error: any) {
    logger.error('Part 11 audit recording failed', { error: error.message, eventType, entityId });
  }
};

/**
 * Verify electronic signature (password-based)
 * 
 * Per 21 CFR Part 11 §11.200:
 * - Signature must be unique to one individual
 * - Identity must be verified before use
 * - Signature must be linked to electronic record
 */
export const verifyElectronicSignature = async (
  userId: number,
  password: string
): Promise<boolean> => {
  try {
    // Get user's password hash from database
    const result = await pool.query(
      `SELECT passwd FROM user_account WHERE user_id = $1 AND status_id = 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      logger.warn('User not found for signature verification', { userId });
      return false;
    }

    const storedHash = result.rows[0].passwd;
    
    // LibreClinica uses MD5 for password storage
    // Try MD5 comparison first (most common for LibreClinica)
    const crypto = require('crypto');
    const md5Hash = crypto.createHash('md5').update(password).digest('hex');
    
    if (storedHash === md5Hash) {
      logger.info('Electronic signature verified (MD5)', { userId });
      return true;
    }
    
    // Try bcrypt comparison for upgraded passwords
    try {
      const bcrypt = require('bcrypt');
      
      // Only try bcrypt if the hash looks like a bcrypt hash ($2a$, $2b$, etc.)
      if (storedHash.startsWith('$2')) {
        const isValid = await bcrypt.compare(password, storedHash);
        
        if (isValid) {
          logger.info('Electronic signature verified (bcrypt)', { userId });
          return true;
        }
      }
    } catch (bcryptError: any) {
      // bcrypt comparison failed, continue with fallback
      logger.debug('bcrypt comparison not available', { error: bcryptError.message });
    }
    
    // Fallback: direct comparison (for development/testing)
    if (storedHash === password) {
      logger.warn('Electronic signature verified (plaintext - NOT FOR PRODUCTION)', { userId });
      return true;
    }
    
    logger.warn('Electronic signature verification failed', { userId });
    return false;
  } catch (error: any) {
    logger.error('Signature verification error', { error: error.message, userId });
    return false;
  }
};

/**
 * Middleware factory that requires electronic signature for an operation
 * 
 * If password is provided in the request body, it will be verified.
 * If not provided, the operation proceeds (signature can be optional for some operations).
 */
export const requireSignatureFor = (meaning: SignatureMeaning) => {
  return async (req: Part11Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;
    const { password, signaturePassword } = req.body;
    const providedPassword = password || signaturePassword;

    logger.debug('Signature requirement check', { 
      meaning, 
      userId: user?.userId,
      hasPassword: !!providedPassword 
    });

    if (providedPassword && user?.userId) {
      try {
        const isValid = await verifyElectronicSignature(user.userId, providedPassword);
        
        if (!isValid) {
          res.status(401).json({
            success: false,
            message: 'Invalid electronic signature (incorrect password)',
            code: 'INVALID_SIGNATURE'
          });
          return;
        }

        req.signatureVerified = true;
        req.signatureMeaning = meaning;
        req.signatureTimestamp = new Date();

        delete req.body.password;
        delete req.body.signaturePassword;

        try {
          await pool.query(`
            INSERT INTO audit_log_event (
              audit_date, audit_table, user_id, entity_name, 
              reason_for_change, audit_log_event_type_id
            ) VALUES (
              NOW(), 'electronic_signature', $1, 'Signature',
              $2,
              COALESCE(
                (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name LIKE '%Sign%' LIMIT 1),
                1
              )
            )
          `, [user.userId, `Electronic signature applied: ${meaning}`]);
        } catch (auditError: any) {
          logger.warn('Failed to log signature audit', { error: auditError.message });
        }

      } catch (error: any) {
        logger.error('Signature verification error', { error: error.message });
        res.status(500).json({
          success: false,
          message: 'Signature verification failed',
          code: 'SIGNATURE_ERROR'
        });
        return;
      }
    } else {
      req.signatureVerified = false;
      req.signatureMeaning = meaning;
    }

    next();
  };
};

// Alias for backward compatibility
export const requireSignature = requireSignatureFor;

/**
 * Middleware factory that STRICTLY requires electronic signature
 */
export const requireStrictSignatureFor = (meaning: SignatureMeaning) => {
  return async (req: Part11Request, res: Response, next: NextFunction): Promise<void> => {
    const { password, signaturePassword } = req.body;
    const providedPassword = password || signaturePassword;

    if (!providedPassword) {
      res.status(400).json({
        success: false,
        message: 'Electronic signature (password) required for this operation',
        code: 'SIGNATURE_REQUIRED',
        signatureMeaning: meaning
      });
      return;
    }

    return requireSignatureFor(meaning)(req, res, next);
  };
};

/**
 * Log Part 11 compliant audit entry (simplified version)
 */
export const logPart11Audit = async (
  userId: number,
  entityType: string,
  entityId: number,
  action: string,
  oldValue?: string,
  newValue?: string,
  reason?: string
): Promise<void> => {
  try {
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        old_value, new_value, reason_for_change,
        audit_log_event_type_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7,
        COALESCE(
          (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = $4 LIMIT 1),
          1
        )
      )
    `, [entityType, userId, entityId, action, oldValue, newValue, reason]);
  } catch (error: any) {
    logger.error('Part 11 audit logging failed', { error: error.message });
  }
};

export default {
  SignatureMeanings,
  Part11EventTypes,
  verifyElectronicSignature,
  requireSignatureFor,
  requireSignature,
  requireStrictSignatureFor,
  logPart11Audit,
  recordPart11Audit,
  formatPart11Timestamp
};
