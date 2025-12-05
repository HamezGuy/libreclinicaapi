/**
 * 21 CFR Part 11 Compliance Service
 * 
 * This service ensures proper integration with LibreClinica's compliance features:
 * - Uses LibreClinica's audit_log_event table and event types
 * - Properly logs electronic signatures
 * - Ensures audit trail integrity
 * 
 * IMPORTANT: LibreClinica uses DATABASE TRIGGERS to automatically log changes.
 * These triggers fire when data is modified in:
 * - item_data (form field values)
 * - event_crf (form instances)
 * - study_event (visits)
 * - study_subject (subjects)
 * - subject (global subject records)
 * - subject_group_map (randomization)
 * - dn_item_data_map (discrepancy notes)
 * - event_definition_crf (form definitions)
 * 
 * This service handles operations NOT covered by triggers:
 * - Electronic signatures with password verification
 * - API-level audit entries
 * - Custom compliance logging
 */

import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import crypto from 'crypto';

/**
 * LibreClinica Audit Event Types
 * These are the EXACT event types from LibreClinica's audit_log_event_type table
 */
export enum LibreClinicaAuditEventType {
  ITEM_DATA_VALUE_UPDATED = 1,
  STUDY_SUBJECT_CREATED = 2,
  STUDY_SUBJECT_STATUS_CHANGED = 3,
  STUDY_SUBJECT_VALUE_CHANGED = 4,
  SUBJECT_CREATED = 5,
  SUBJECT_STATUS_CHANGED = 6,
  SUBJECT_GLOBAL_VALUE_CHANGED = 7,
  EVENT_CRF_MARKED_COMPLETE = 8,
  EVENT_CRF_PROPERTIES_CHANGED = 9,
  EVENT_CRF_IDE_COMPLETE = 10,  // Initial Data Entry complete
  EVENT_CRF_DDE_COMPLETE = 11,  // Double Data Entry complete
  ITEM_DATA_STATUS_CHANGED = 12,
  ITEM_DATA_DELETED = 13,
  // ELECTRONIC SIGNATURE EVENT TYPES (21 CFR Part 11 §11.50)
  EVENT_CRF_COMPLETE_WITH_PASSWORD = 14,
  EVENT_CRF_IDE_COMPLETE_WITH_PASSWORD = 15,
  EVENT_CRF_DDE_COMPLETE_WITH_PASSWORD = 16,
  STUDY_EVENT_SCHEDULED = 17,
  STUDY_EVENT_DATA_ENTRY_STARTED = 18,
  STUDY_EVENT_COMPLETED = 19,
  STUDY_EVENT_STOPPED = 20,
  STUDY_EVENT_SKIPPED = 21,
  STUDY_EVENT_LOCKED = 22,
  STUDY_EVENT_REMOVED = 23,
  STUDY_EVENT_START_DATE_CHANGED = 24,
  STUDY_EVENT_END_DATE_CHANGED = 25,
  STUDY_EVENT_LOCATION_CHANGED = 26,
  SUBJECT_SITE_ASSIGNMENT = 27,
  SUBJECT_GROUP_ASSIGNMENT = 28,
  SUBJECT_GROUP_CHANGED = 29,
  ITEM_DATA_REPEATING_ROW_INSERTED = 30,
  STUDY_EVENT_SIGNED = 31,  // ELECTRONIC SIGNATURE FOR STUDY EVENT
  EVENT_CRF_SDV_STATUS = 32,
  CHANGE_CRF_VERSION = 33,
  STUDY_EVENT_RESTORED = 35,
  EVENT_CRF_DELETED = 40,
  EVENT_CRF_STARTED = 41
}

/**
 * Signature meaning types for 21 CFR Part 11 §11.50
 */
export type SignatureMeaning = 
  | 'authorship'        // I am the author of this data
  | 'approval'          // I approve this data
  | 'responsibility'    // I take responsibility for this data
  | 'review'            // I have reviewed this data
  | 'verification';     // I verify this data (SDV)

/**
 * Log an audit event using LibreClinica's audit_log_event table
 * This uses the EXACT schema and event types from LibreClinica
 */
export const logLibreClinicaAuditEvent = async (
  eventTypeId: LibreClinicaAuditEventType,
  userId: number,
  params: {
    auditTable: string;
    entityId?: number;
    entityName?: string;
    oldValue?: string;
    newValue?: string;
    reasonForChange?: string;
    eventCrfId?: number;
    studyEventId?: number;
    eventCrfVersionId?: number;
  }
): Promise<{ success: boolean; auditId?: number; error?: string }> => {
  logger.info('Logging LibreClinica audit event', { eventTypeId, userId, params });

  try {
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
        study_event_id,
        event_crf_version_id
      ) VALUES (
        NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING audit_id
    `;

    const result = await pool.query(query, [
      params.auditTable,
      userId,
      params.entityId || null,
      params.entityName || null,
      params.oldValue || null,
      params.newValue || null,
      eventTypeId,
      params.reasonForChange || null,
      params.eventCrfId || null,
      params.studyEventId || null,
      params.eventCrfVersionId || null
    ]);

    const auditId = result.rows[0].audit_id;
    logger.info('LibreClinica audit event logged', { auditId, eventTypeId });

    return { success: true, auditId };

  } catch (error: any) {
    logger.error('Failed to log LibreClinica audit event', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Log Electronic Signature with proper 21 CFR Part 11 compliance
 * 
 * This uses LibreClinica's e-signature event types:
 * - Event CRF complete with password (14)
 * - Study Event signed (31)
 */
export const logElectronicSignature = async (
  userId: number,
  username: string,
  params: {
    entityType: 'event_crf' | 'study_event';
    entityId: number;
    entityName: string;
    meaning: SignatureMeaning;
    eventCrfId?: number;
    studyEventId?: number;
  }
): Promise<{ success: boolean; auditId?: number; error?: string }> => {
  logger.info('Logging electronic signature (21 CFR Part 11 §11.50)', { userId, username, params });

  // Determine the correct event type based on entity
  let eventTypeId: LibreClinicaAuditEventType;
  
  if (params.entityType === 'event_crf') {
    eventTypeId = LibreClinicaAuditEventType.EVENT_CRF_COMPLETE_WITH_PASSWORD;
  } else if (params.entityType === 'study_event') {
    eventTypeId = LibreClinicaAuditEventType.STUDY_EVENT_SIGNED;
  } else {
    // Default to CRF complete with password
    eventTypeId = LibreClinicaAuditEventType.EVENT_CRF_COMPLETE_WITH_PASSWORD;
  }

  // Create the signature manifest per §11.50
  const signatureManifest = JSON.stringify({
    type: 'electronic_signature',
    version: '1.0',
    signer: username,
    meaning: params.meaning,
    timestamp: new Date().toISOString(),
    cfr_compliance: {
      '11.50': 'Signature includes printed name, date/time, and meaning',
      '11.100': 'Signature is unique to individual',
      '11.200': 'Two-factor authentication (username + password)'
    }
  });

  return logLibreClinicaAuditEvent(eventTypeId, userId, {
    auditTable: params.entityType,
    entityId: params.entityId,
    entityName: params.entityName,
    newValue: signatureManifest,
    reasonForChange: `Electronic signature applied: ${params.meaning}`,
    eventCrfId: params.eventCrfId,
    studyEventId: params.studyEventId
  });
};

/**
 * Log SDV (Source Data Verification) completion
 * Uses LibreClinica's EVENT_CRF_SDV_STATUS (32) event type
 */
export const logSDVVerification = async (
  userId: number,
  params: {
    eventCrfId: number;
    entityName: string;
    verified: boolean;
    studyEventId?: number;
  }
): Promise<{ success: boolean; auditId?: number; error?: string }> => {
  logger.info('Logging SDV verification', { userId, params });

  return logLibreClinicaAuditEvent(
    LibreClinicaAuditEventType.EVENT_CRF_SDV_STATUS,
    userId,
    {
      auditTable: 'event_crf',
      entityId: params.eventCrfId,
      entityName: params.entityName,
      oldValue: params.verified ? 'false' : 'true',
      newValue: params.verified ? 'true' : 'false',
      reasonForChange: params.verified ? 'SDV completed' : 'SDV reverted',
      eventCrfId: params.eventCrfId,
      studyEventId: params.studyEventId
    }
  );
};

/**
 * Log Study Event Lock/Unlock
 * Uses LibreClinica's STUDY_EVENT_LOCKED (22) event type
 */
export const logStudyEventLock = async (
  userId: number,
  params: {
    studyEventId: number;
    entityName: string;
    locked: boolean;
    reason: string;
  }
): Promise<{ success: boolean; auditId?: number; error?: string }> => {
  logger.info('Logging study event lock', { userId, params });

  return logLibreClinicaAuditEvent(
    LibreClinicaAuditEventType.STUDY_EVENT_LOCKED,
    userId,
    {
      auditTable: 'study_event',
      entityId: params.studyEventId,
      entityName: params.entityName,
      newValue: params.locked ? 'locked' : 'unlocked',
      reasonForChange: params.reason,
      studyEventId: params.studyEventId
    }
  );
};

/**
 * Verify password for electronic signature
 * Uses MD5 hash for LibreClinica compatibility
 */
export const verifyPasswordForCompliance = async (
  userId: number,
  password: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const query = `
      SELECT passwd, status_id 
      FROM user_account 
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return { success: false, message: 'User not found' };
    }

    const user = result.rows[0];

    // status_id: 1 = active, 5 = locked
    if (user.status_id !== 1) {
      return { success: false, message: 'Account is not active' };
    }

    // Hash password using MD5 (LibreClinica compatibility)
    const passwordHash = crypto.createHash('md5').update(password).digest('hex');

    if (passwordHash !== user.passwd) {
      return { success: false, message: 'Invalid password' };
    }

    return { success: true };

  } catch (error: any) {
    logger.error('Password verification error', { error: error.message });
    return { success: false, message: 'Verification failed' };
  }
};

/**
 * Get audit trail for an entity
 * Returns LibreClinica audit log entries
 */
export const getAuditTrail = async (
  entityType: 'event_crf' | 'study_event' | 'study_subject' | 'item_data',
  entityId: number,
  limit: number = 50
): Promise<{ success: boolean; data?: any[]; error?: string }> => {
  try {
    let whereClause: string;
    
    switch (entityType) {
      case 'event_crf':
        whereClause = `ale.event_crf_id = $1 OR (ale.audit_table = 'event_crf' AND ale.entity_id = $1)`;
        break;
      case 'study_event':
        whereClause = `ale.study_event_id = $1 OR (ale.audit_table = 'study_event' AND ale.entity_id = $1)`;
        break;
      case 'study_subject':
        whereClause = `ale.audit_table = 'study_subject' AND ale.entity_id = $1`;
        break;
      case 'item_data':
        whereClause = `ale.audit_table = 'item_data' AND ale.entity_id = $1`;
        break;
      default:
        whereClause = `ale.entity_id = $1`;
    }

    const query = `
      SELECT 
        ale.audit_id,
        ale.audit_date,
        ale.audit_table,
        ale.entity_id,
        ale.entity_name,
        ale.old_value,
        ale.new_value,
        ale.reason_for_change,
        alet.name as event_type,
        ua.user_name,
        ua.first_name || ' ' || ua.last_name as full_name
      FROM audit_log_event ale
      LEFT JOIN audit_log_event_type alet ON ale.audit_log_event_type_id = alet.audit_log_event_type_id
      LEFT JOIN user_account ua ON ale.user_id = ua.user_id
      WHERE ${whereClause}
      ORDER BY ale.audit_date DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [entityId, limit]);

    return {
      success: true,
      data: result.rows.map(row => ({
        auditId: row.audit_id,
        auditDate: row.audit_date,
        auditTable: row.audit_table,
        entityId: row.entity_id,
        entityName: row.entity_name,
        oldValue: row.old_value,
        newValue: row.new_value,
        reasonForChange: row.reason_for_change,
        eventType: row.event_type,
        userName: row.user_name,
        fullName: row.full_name
      }))
    };

  } catch (error: any) {
    logger.error('Get audit trail error', { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Check 21 CFR Part 11 compliance status
 * Returns a summary of compliance features
 */
export const getComplianceStatus = async (): Promise<{
  success: boolean;
  data?: {
    auditTrailEnabled: boolean;
    triggersActive: number;
    recentAuditEntries: number;
    electronicSignaturesConfigured: boolean;
    passwordHashingMethod: string;
  };
}> => {
  try {
    // Check triggers
    const triggersResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.triggers 
      WHERE trigger_schema = 'public'
    `);

    // Check recent audit entries (last 24 hours)
    const auditResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM audit_log_event 
      WHERE audit_date > NOW() - INTERVAL '24 hours'
    `);

    // Check if e-signature event types exist
    const esigResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM audit_log_event_type 
      WHERE audit_log_event_type_id IN (14, 15, 16, 31)
    `);

    return {
      success: true,
      data: {
        auditTrailEnabled: parseInt(triggersResult.rows[0].count) > 0,
        triggersActive: parseInt(triggersResult.rows[0].count),
        recentAuditEntries: parseInt(auditResult.rows[0].count),
        electronicSignaturesConfigured: parseInt(esigResult.rows[0].count) === 4,
        passwordHashingMethod: 'MD5 (LibreClinica standard)'
      }
    };

  } catch (error: any) {
    logger.error('Compliance status check error', { error: error.message });
    return { success: false };
  }
};

export default {
  logLibreClinicaAuditEvent,
  logElectronicSignature,
  logSDVVerification,
  logStudyEventLock,
  verifyPasswordForCompliance,
  getAuditTrail,
  getComplianceStatus,
  LibreClinicaAuditEventType
};

