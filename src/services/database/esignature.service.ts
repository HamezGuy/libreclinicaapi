/**
 * Electronic Signature Service
 * 
 * 21 CFR Part 11 Compliant Electronic Signature Implementation
 * 
 * This service provides:
 * - Password verification for signatures (§11.200)
 * - Signature application and tracking (§11.50)
 * - Audit trail of all signature events (§11.10(e))
 * - User certification management (§11.100(c))
 * 
 * Key database tables used:
 * - event_crf (electronic_signature_status column)
 * - event_definition_crf (electronic_signature column for requirements)
 * - audit_log_event (signature audit trail)
 * - user_account (password verification)
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import crypto from 'crypto';
import { 
  logElectronicSignature as logToLibreClinica, 
  LibreClinicaAuditEventType 
} from './compliance.service';

/**
 * Signature meaning types per 21 CFR Part 11 §11.50
 */
export type SignatureMeaning = 
  | 'authorship'        // I am the author of this data
  | 'approval'          // I approve this data
  | 'responsibility'    // I take responsibility for this data
  | 'review'            // I have reviewed this data
  | 'verification'      // I verify this data against source documents
  | 'acknowledgment';   // I acknowledge this information

/**
 * Entity types that can be signed
 */
export type SignableEntityType = 
  | 'event_crf'         // Form/CRF completion
  | 'study_event'       // Study event completion
  | 'study_subject'     // Subject enrollment
  | 'discrepancy_note'  // Query closure
  | 'data_lock';        // Data lock confirmation

export interface SignatureRequest {
  userId: number;
  username: string;
  userFullName: string;
  entityType: SignableEntityType;
  entityId: number;
  password: string;
  meaning: SignatureMeaning;
  reasonForSigning?: string;
}

export interface SignatureRecord {
  signatureId: number;
  entityType: string;
  entityId: number;
  signedBy: string;
  signedByFullName: string;
  signedAt: Date;
  meaning: SignatureMeaning;
  reasonForSigning: string;
  ipAddress?: string;
}

/**
 * Verify user's password for electronic signature
 * Uses MD5 hash like LibreClinica for compatibility
 * 
 * @param userId User ID
 * @param username Username for logging
 * @param password Plain text password to verify
 */
export const verifyPasswordForSignature = async (
  userId: number,
  username: string,
  password: string
): Promise<{ success: boolean; message?: string }> => {
  logger.info('Verifying password for e-signature', { userId, username });

  try {
    // Get user's stored password hash from database
    const query = `
      SELECT passwd, enabled
      FROM user_account
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      await logSignatureAttempt(userId, username, 'password_verification', 0, false, 'User not found');
      return { success: false, message: 'User not found' };
    }

    const user = result.rows[0];

    // Check if user account is enabled
    if (!user.enabled) {
      await logSignatureAttempt(userId, username, 'password_verification', 0, false, 'Account disabled');
      return { success: false, message: 'Account is disabled' };
    }

    // Hash the provided password using MD5 (LibreClinica compatibility)
    const passwordHash = crypto.createHash('md5').update(password).digest('hex');

    // Compare with stored hash
    if (passwordHash !== user.passwd) {
      await logSignatureAttempt(userId, username, 'password_verification', 0, false, 'Invalid password');
      return { success: false, message: 'Invalid password' };
    }

    // Log successful verification
    await logSignatureAttempt(userId, username, 'password_verification', 0, true, 'Password verified');

    return { success: true, message: 'Password verified successfully' };

  } catch (error: any) {
    logger.error('Password verification error', { error: error.message, userId });
    return { success: false, message: 'Verification failed' };
  }
};

/**
 * Apply electronic signature to an entity
 * 21 CFR Part 11 compliant signature application
 */
export const applyElectronicSignature = async (
  request: SignatureRequest
): Promise<{ success: boolean; data?: { signatureId: number }; message?: string }> => {
  logger.info('Applying electronic signature', {
    userId: request.userId,
    username: request.username,
    entityType: request.entityType,
    entityId: request.entityId,
    meaning: request.meaning
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Verify password first
    const passwordVerification = await verifyPasswordForSignature(
      request.userId,
      request.username,
      request.password
    );

    if (!passwordVerification.success) {
      await client.query('ROLLBACK');
      return { success: false, message: passwordVerification.message };
    }

    // Step 2: Update the entity's electronic signature status
    let updateQuery: string;
    let updateParams: any[];

    switch (request.entityType) {
      case 'event_crf':
        updateQuery = `
          UPDATE event_crf 
          SET electronic_signature_status = true,
              date_updated = CURRENT_TIMESTAMP,
              update_id = $2
          WHERE event_crf_id = $1
          RETURNING event_crf_id as entity_id
        `;
        updateParams = [request.entityId, request.userId];
        break;

      case 'study_event':
        updateQuery = `
          UPDATE study_event
          SET date_updated = CURRENT_TIMESTAMP,
              update_id = $2
          WHERE study_event_id = $1
          RETURNING study_event_id as entity_id
        `;
        updateParams = [request.entityId, request.userId];
        break;

      case 'study_subject':
        updateQuery = `
          UPDATE study_subject
          SET date_updated = CURRENT_TIMESTAMP,
              update_id = $2
          WHERE study_subject_id = $1
          RETURNING study_subject_id as entity_id
        `;
        updateParams = [request.entityId, request.userId];
        break;

      default:
        // For other entity types, we just record the signature in audit
        updateQuery = '';
        updateParams = [];
    }

    // Execute update if applicable
    if (updateQuery) {
      const updateResult = await client.query(updateQuery, updateParams);
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: `${request.entityType} not found` };
      }
    }

    // Step 3: Record signature in audit trail
    // Format signature data per 21 CFR Part 11 §11.50
    const signatureManifest = JSON.stringify({
      type: 'electronic_signature',
      version: '1.0',
      meaning: request.meaning,
      signed_by: request.username,
      signed_by_full_name: request.userFullName,
      signed_at: new Date().toISOString(),
      entity_type: request.entityType,
      entity_id: request.entityId,
      reason: request.reasonForSigning || `Electronic signature: ${request.meaning}`,
      cfr_compliance: {
        '11.50': 'Signature manifestations included',
        '11.100': 'Unique identification verified',
        '11.200': 'Two-factor authentication (username + password)'
      }
    });

    // Determine the correct LibreClinica e-signature event type
    // 14 = Event CRF complete with password
    // 15 = Event CRF IDE complete with password  
    // 16 = Event CRF DDE complete with password
    // 31 = Study Event signed
    let eventTypeId: number;
    switch (request.entityType) {
      case 'event_crf':
        eventTypeId = LibreClinicaAuditEventType.EVENT_CRF_COMPLETE_WITH_PASSWORD; // 14
        break;
      case 'study_event':
        eventTypeId = LibreClinicaAuditEventType.STUDY_EVENT_SIGNED; // 31
        break;
      default:
        eventTypeId = LibreClinicaAuditEventType.EVENT_CRF_COMPLETE_WITH_PASSWORD; // 14
    }

    const auditQuery = `
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
      )
      VALUES (
        CURRENT_TIMESTAMP,
        $1,
        $2,
        $3,
        'Electronic Signature Applied',
        NULL,
        $4,
        $5,
        $6,
        $7,
        $8
      )
      RETURNING audit_id
    `;

    const auditResult = await client.query(auditQuery, [
      request.entityType,
      request.userId,
      request.entityId,
      signatureManifest,
      eventTypeId,
      request.reasonForSigning || `Electronic signature: ${request.meaning}`,
      request.entityType === 'event_crf' ? request.entityId : null,
      request.entityType === 'study_event' ? request.entityId : null
    ]);

    const signatureId = auditResult.rows[0].audit_id;

    await client.query('COMMIT');

    logger.info('Electronic signature applied successfully', {
      signatureId,
      entityType: request.entityType,
      entityId: request.entityId,
      signedBy: request.username
    });

    return {
      success: true,
      data: { signatureId },
      message: 'Electronic signature applied successfully'
    };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Failed to apply electronic signature', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get signature status for an entity
 */
export const getSignatureStatus = async (
  entityType: string,
  entityId: number
): Promise<{ success: boolean; data?: any; message?: string }> => {
  logger.info('Getting signature status', { entityType, entityId });

  try {
    let query: string;
    let params: any[] = [entityId];

    switch (entityType) {
      case 'event_crf':
        query = `
          SELECT 
            ec.event_crf_id,
            ec.electronic_signature_status as is_signed,
            ec.date_updated as last_updated,
            u.user_name as updated_by,
            edc.electronic_signature as signature_required,
            c.name as crf_name,
            sed.name as event_name,
            ss.label as subject_label
          FROM event_crf ec
          LEFT JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
          LEFT JOIN crf c ON cv.crf_id = c.crf_id
          LEFT JOIN study_event se ON ec.study_event_id = se.study_event_id
          LEFT JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
          LEFT JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
          LEFT JOIN user_account u ON ec.update_id = u.user_id
          LEFT JOIN event_definition_crf edc ON (
            sed.study_event_definition_id = edc.study_event_definition_id 
            AND c.crf_id = edc.crf_id
          )
          WHERE ec.event_crf_id = $1
        `;
        break;

      default:
        // Generic query for audit-based signature
        query = `
          SELECT 
            ale.audit_id,
            ale.new_value as signature_data,
            ale.audit_date as signed_at,
            u.user_name as signed_by,
            u.first_name || ' ' || u.last_name as signed_by_full_name
          FROM audit_log_event ale
          LEFT JOIN user_account u ON ale.user_id = u.user_id
          WHERE ale.audit_table = $2
            AND ale.entity_id = $1
            AND ale.entity_name = 'Electronic Signature Applied'
          ORDER BY ale.audit_date DESC
          LIMIT 1
        `;
        params = [entityId, entityType];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        success: true,
        data: {
          entityType,
          entityId,
          isSigned: false,
          signatureRequired: false
        }
      };
    }

    const row = result.rows[0];

    // Parse signature data if available
    let signatureDetails = null;
    if (row.signature_data) {
      try {
        signatureDetails = JSON.parse(row.signature_data);
      } catch (e) {
        signatureDetails = null;
      }
    }

    return {
      success: true,
      data: {
        entityType,
        entityId,
        isSigned: row.is_signed === true || !!signatureDetails,
        signatureRequired: row.signature_required === true,
        signedAt: row.signed_at || row.last_updated,
        signedBy: row.signed_by || row.updated_by,
        signedByFullName: row.signed_by_full_name,
        signatureDetails,
        crfName: row.crf_name,
        eventName: row.event_name,
        subjectLabel: row.subject_label
      }
    };

  } catch (error: any) {
    logger.error('Get signature status error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get signature history for an entity
 */
export const getSignatureHistory = async (
  entityType: string,
  entityId: number
): Promise<{ success: boolean; data?: SignatureRecord[]; message?: string }> => {
  logger.info('Getting signature history', { entityType, entityId });

  try {
    const query = `
      SELECT 
        ale.audit_id as signature_id,
        ale.audit_table as entity_type,
        ale.entity_id,
        ale.audit_date as signed_at,
        ale.new_value as signature_data,
        ale.reason_for_change as reason,
        u.user_name as signed_by,
        u.first_name || ' ' || u.last_name as signed_by_full_name
      FROM audit_log_event ale
      LEFT JOIN user_account u ON ale.user_id = u.user_id
      WHERE ale.audit_table = $1
        AND ale.entity_id = $2
        AND ale.entity_name = 'Electronic Signature Applied'
      ORDER BY ale.audit_date DESC
    `;

    const result = await pool.query(query, [entityType, entityId]);

    const history: SignatureRecord[] = result.rows.map(row => {
      let signatureData: any = {};
      try {
        signatureData = JSON.parse(row.signature_data || '{}');
      } catch (e) {
        signatureData = {};
      }

      return {
        signatureId: row.signature_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        signedBy: row.signed_by,
        signedByFullName: row.signed_by_full_name,
        signedAt: row.signed_at,
        meaning: signatureData.meaning || 'unknown',
        reasonForSigning: row.reason || signatureData.reason
      };
    });

    return { success: true, data: history };

  } catch (error: any) {
    logger.error('Get signature history error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Get pending signatures for a user
 */
export const getPendingSignatures = async (
  userId: number,
  studyId?: number
): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  logger.info('Getting pending signatures', { userId, studyId });

  try {
    // Get forms that require signature but haven't been signed
    const query = `
      SELECT 
        ec.event_crf_id,
        c.name as crf_name,
        sed.name as event_name,
        ss.label as subject_label,
        s.name as study_name,
        ec.date_created,
        ec.status_id,
        'event_crf' as entity_type
      FROM event_crf ec
      INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
      INNER JOIN crf c ON cv.crf_id = c.crf_id
      INNER JOIN study_event se ON ec.study_event_id = se.study_event_id
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      INNER JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
      INNER JOIN study s ON ss.study_id = s.study_id
      INNER JOIN event_definition_crf edc ON (
        sed.study_event_definition_id = edc.study_event_definition_id 
        AND c.crf_id = edc.crf_id
        AND (edc.study_id = s.study_id OR edc.study_id = s.parent_study_id)
      )
      WHERE edc.electronic_signature = true
        AND (ec.electronic_signature_status = false OR ec.electronic_signature_status IS NULL)
        AND ec.status_id IN (4, 6)  -- Unavailable (complete) or Locked
        ${studyId ? 'AND (s.study_id = $1 OR s.parent_study_id = $1)' : ''}
      ORDER BY ec.date_created DESC
      LIMIT 50
    `;

    const params = studyId ? [studyId] : [];
    const result = await pool.query(query, params);

    return {
      success: true,
      data: result.rows.map(row => ({
        entityId: row.event_crf_id,
        entityType: row.entity_type,
        crfName: row.crf_name,
        eventName: row.event_name,
        subjectLabel: row.subject_label,
        studyName: row.study_name,
        dateCreated: row.date_created,
        status: row.status_id
      }))
    };

  } catch (error: any) {
    logger.error('Get pending signatures error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Certify user for electronic signatures
 * 21 CFR Part 11 §11.100(c)
 */
export const certifyUser = async (
  userId: number,
  username: string,
  password: string,
  acknowledgment: string
): Promise<{ success: boolean; data?: any; message?: string }> => {
  logger.info('Certifying user for e-signatures', { userId, username });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify password first
    const passwordVerification = await verifyPasswordForSignature(userId, username, password);
    if (!passwordVerification.success) {
      await client.query('ROLLBACK');
      return { success: false, message: passwordVerification.message };
    }

    // Record certification in audit trail
    const certificationData = JSON.stringify({
      type: 'esignature_certification',
      version: '1.0',
      certified_by: username,
      certified_at: new Date().toISOString(),
      acknowledgment: acknowledgment,
      cfr_compliance: {
        '11.100(c)': 'User certification that electronic signature is legally binding'
      }
    });

    const auditQuery = `
      INSERT INTO audit_log_event (
        audit_date,
        audit_table,
        user_id,
        entity_id,
        entity_name,
        new_value,
        audit_log_event_type_id,
        reason_for_change
      )
      VALUES (
        CURRENT_TIMESTAMP,
        'user_account',
        $1,
        $1,
        'E-Signature Certification',
        $2,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Updated' LIMIT 1),
        'User certified electronic signature as legally binding equivalent'
      )
      RETURNING audit_id
    `;

    const result = await client.query(auditQuery, [userId, certificationData]);

    await client.query('COMMIT');

    return {
      success: true,
      data: {
        certificationId: result.rows[0].audit_id,
        certifiedAt: new Date().toISOString()
      },
      message: 'E-signature certification recorded successfully'
    };

  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('User certification error', { error: error.message });
    return { success: false, message: error.message };
  } finally {
    client.release();
  }
};

/**
 * Get study e-signature requirements
 */
export const getStudySignatureRequirements = async (
  studyId: number
): Promise<{ success: boolean; data?: any[]; message?: string }> => {
  logger.info('Getting study signature requirements', { studyId });

  try {
    const query = `
      SELECT 
        edc.event_definition_crf_id,
        c.crf_id,
        c.name as crf_name,
        sed.study_event_definition_id,
        sed.name as event_name,
        edc.electronic_signature as requires_signature,
        edc.required_crf,
        edc.hide_crf,
        edc.source_data_verification_code
      FROM event_definition_crf edc
      INNER JOIN crf c ON edc.crf_id = c.crf_id
      INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id
      WHERE (edc.study_id = $1 OR sed.study_id = $1)
        AND edc.status_id = 1
      ORDER BY sed.ordinal, c.name
    `;

    const result = await pool.query(query, [studyId]);

    return {
      success: true,
      data: result.rows.map(row => ({
        eventDefinitionCrfId: row.event_definition_crf_id,
        crfId: row.crf_id,
        crfName: row.crf_name,
        eventId: row.study_event_definition_id,
        eventName: row.event_name,
        requiresSignature: row.requires_signature === true,
        required: row.required_crf === true,
        hidden: row.hide_crf === true,
        sdvCode: row.source_data_verification_code
      }))
    };

  } catch (error: any) {
    logger.error('Get study requirements error', { error: error.message });
    return { success: false, message: error.message };
  }
};

/**
 * Log signature attempt for audit trail
 */
const logSignatureAttempt = async (
  userId: number,
  username: string,
  action: string,
  entityId: number,
  success: boolean,
  details: string
): Promise<void> => {
  try {
    const query = `
      INSERT INTO audit_log_event (
        audit_date,
        audit_table,
        user_id,
        entity_id,
        entity_name,
        new_value,
        audit_log_event_type_id
      )
      VALUES (
        CURRENT_TIMESTAMP,
        'electronic_signature',
        $1,
        $2,
        $3,
        $4,
        (SELECT audit_log_event_type_id FROM audit_log_event_type WHERE name = 'Entity Created' LIMIT 1)
      )
    `;

    const logData = JSON.stringify({
      action,
      username,
      success,
      details,
      timestamp: new Date().toISOString()
    });

    await pool.query(query, [userId, entityId, `Signature Attempt: ${action}`, logData]);
  } catch (error: any) {
    logger.error('Failed to log signature attempt', { error: error.message });
  }
};

export default {
  verifyPasswordForSignature,
  applyElectronicSignature,
  getSignatureStatus,
  getSignatureHistory,
  getPendingSignatures,
  certifyUser,
  getStudySignatureRequirements
};

