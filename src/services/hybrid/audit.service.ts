/**
 * Hybrid Audit Service
 * 
 * Combines SOAP and Database operations for audit trail management
 * 21 CFR Part 11 §11.10(e) - Audit Trail Compliance
 * 
 * Strategy:
 * - SOAP: Used for recording audit events when LibreClinica is available
 *         Ensures native LibreClinica audit logging is maintained
 * - Database: Used for querying audit data and as fallback when SOAP unavailable
 *            Direct access is faster for reads
 * 
 * This dual-mode approach ensures:
 * 1. Full audit trail is maintained in LibreClinica's native format
 * 2. Fast query access for dashboard and reporting
 * 3. System continues to work when SOAP is unavailable
 */

import { config } from '../../config/environment';
import { logger } from '../../config/logger';
import * as auditSoap from '../soap/auditSoap.service';
import * as auditDb from '../database/audit.service';
import { ApiResponse } from '../../types';
import { AuditEventType, AuditRecord } from '../soap/auditSoap.service';

/**
 * Audit query parameters
 */
export interface AuditQueryParams {
  studyId?: number;
  subjectId?: number;
  eventCrfId?: number;
  userId?: number;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  page?: number;
}

/**
 * Record an audit event
 * Uses SOAP when available for GxP compliance, falls back to database
 */
export const recordAuditEvent = async (
  record: {
    auditTable: string;
    entityId: number;
    entityName?: string;
    userId: number;
    username: string;
    eventTypeId: number;
    oldValue?: string;
    newValue?: string;
    reasonForChange?: string;
  }
): Promise<ApiResponse<{ auditId: number }>> => {
  logger.info('Recording audit event (hybrid)', {
    auditTable: record.auditTable,
    entityId: record.entityId,
    eventTypeId: record.eventTypeId,
    soapEnabled: config.libreclinica.soapEnabled
  });

  // Always record in database first (fast, reliable)
  const dbResult = await auditDb.recordAuditEvent({
    audit_table: record.auditTable,
    entity_id: record.entityId,
    user_id: record.userId,
    user_name: record.username,
    audit_log_event_type_id: record.eventTypeId,
    old_value: record.oldValue,
    new_value: record.newValue,
    reason_for_change: record.reasonForChange
  });

  // If SOAP is enabled, also record via SOAP for LibreClinica native audit
  if (config.libreclinica.soapEnabled) {
    try {
      const soapRecord: AuditRecord = {
        auditDate: new Date(),
        auditTable: record.auditTable,
        entityId: record.entityId,
        entityName: record.entityName,
        userId: record.userId,
        username: record.username,
        eventTypeId: record.eventTypeId as AuditEventType,
        oldValue: record.oldValue,
        newValue: record.newValue,
        reasonForChange: record.reasonForChange
      };

      const soapResult = await auditSoap.recordAuditEvent(
        soapRecord,
        record.userId,
        record.username
      );

      if (!soapResult.success) {
        logger.warn('SOAP audit recording failed, database record maintained', {
          error: soapResult.message,
          entityId: record.entityId
        });
      } else {
        logger.info('Audit recorded via both SOAP and database', {
          dbAuditId: dbResult.data?.audit_id,
          soapAuditId: soapResult.data?.auditId
        });
      }
    } catch (error: any) {
      logger.warn('SOAP audit recording error, database record maintained', {
        error: error.message,
        entityId: record.entityId
      });
    }
  }

  return {
    success: dbResult.success,
    data: { auditId: dbResult.data?.audit_id || 0 },
    message: dbResult.message
  };
};

/**
 * Get audit logs with filtering
 * Uses database for fast queries
 */
export const getAuditLogs = async (
  params: AuditQueryParams
): Promise<ApiResponse<any>> => {
  logger.info('Fetching audit logs (hybrid)', params);

  // Use database for queries (faster, more flexible)
  const result = await auditDb.getAuditLogs({
    studyId: params.studyId,
    userId: params.userId,
    eventType: params.eventType,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: params.limit || 50,
    offset: params.offset || ((params.page || 1) - 1) * (params.limit || 50)
  });

  return result;
};

/**
 * Get subject audit trail
 * Tries SOAP first for complete ODM audit data, falls back to database
 */
export const getSubjectAuditTrail = async (
  studyId: number,
  subjectId: number,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Fetching subject audit trail (hybrid)', {
    studyId,
    subjectId,
    soapEnabled: config.libreclinica.soapEnabled
  });

  // Try SOAP first if enabled (gets complete ODM audit format)
  if (config.libreclinica.soapEnabled) {
    try {
      const soapResult = await auditSoap.getSubjectAuditTrail(
        studyId,
        subjectId,
        userId,
        username
      );

      if (soapResult.success && soapResult.data && soapResult.data.length > 0) {
        logger.info('Subject audit trail fetched via SOAP', {
          subjectId,
          recordCount: soapResult.data.length
        });
        return soapResult;
      }
    } catch (error: any) {
      logger.warn('SOAP subject audit trail failed, falling back to database', {
        error: error.message,
        subjectId
      });
    }
  }

  // Fallback to database
  const dbResult = await auditDb.getSubjectAuditTrail(subjectId);
  return dbResult;
};

/**
 * Get form audit trail
 * Tries SOAP first, falls back to database
 */
export const getFormAuditTrail = async (
  eventCrfId: number,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Fetching form audit trail (hybrid)', {
    eventCrfId,
    soapEnabled: config.libreclinica.soapEnabled
  });

  // Try SOAP first if enabled
  if (config.libreclinica.soapEnabled) {
    try {
      const soapResult = await auditSoap.getFormAuditTrail(
        eventCrfId,
        userId,
        username
      );

      if (soapResult.success && soapResult.data && soapResult.data.length > 0) {
        logger.info('Form audit trail fetched via SOAP', {
          eventCrfId,
          recordCount: soapResult.data.length
        });
        return soapResult;
      }
    } catch (error: any) {
      logger.warn('SOAP form audit trail failed, falling back to database', {
        error: error.message,
        eventCrfId
      });
    }
  }

  // Fallback to database
  const dbResult = await auditDb.getFormAuditTrail(eventCrfId);
  return dbResult;
};

/**
 * Record electronic signature
 * Must use SOAP for proper LibreClinica integration (falls back to database)
 */
export const recordElectronicSignature = async (
  entityType: 'crf' | 'subject' | 'event',
  entityId: number,
  signature: {
    username: string;
    password: string;
    meaning: string;
    reasonForChange?: string;
  },
  userId: number,
  authenticatedUsername: string
): Promise<ApiResponse<{ signatureId: number }>> => {
  logger.info('Recording electronic signature (hybrid)', {
    entityType,
    entityId,
    signerUsername: signature.username,
    soapEnabled: config.libreclinica.soapEnabled
  });

  // Try SOAP first if enabled (preferred for GxP compliance)
  if (config.libreclinica.soapEnabled) {
    try {
      const soapResult = await auditSoap.recordElectronicSignature(
        entityType,
        entityId,
        signature,
        userId,
        authenticatedUsername
      );

      if (soapResult.success) {
        // Also record in database for backup
        await auditDb.recordElectronicSignature({
          entity_type: entityType,
          entity_id: entityId,
          signer_username: signature.username,
          meaning: signature.meaning,
          reason_for_change: signature.reasonForChange,
          signed_at: new Date()
        });

        logger.info('Electronic signature recorded via SOAP and database', {
          entityId,
          signerUsername: signature.username
        });

        return soapResult;
      }
    } catch (error: any) {
      logger.warn('SOAP signature failed, falling back to database', {
        error: error.message,
        entityId
      });
    }
  }

  // Fallback to database-only recording
  const dbResult = await auditDb.recordElectronicSignature({
    entity_type: entityType,
    entity_id: entityId,
    signer_username: signature.username,
    meaning: signature.meaning,
    reason_for_change: signature.reasonForChange,
    signed_at: new Date()
  });

  if (dbResult.success) {
    logger.info('Electronic signature recorded via database (SOAP unavailable)', {
      entityId,
      signerUsername: signature.username
    });
  }

  return {
    success: dbResult.success,
    data: { signatureId: dbResult.data?.signature_id || entityId },
    message: dbResult.message
  };
};

/**
 * Get audit statistics
 * Uses database for aggregation queries
 */
export const getAuditStats = async (
  days: number = 30
): Promise<ApiResponse<any>> => {
  return auditDb.getAuditStats(days);
};

/**
 * Export audit logs
 * Uses database for complete data export
 */
export const exportAuditLogs = async (
  params: AuditQueryParams,
  format: 'csv' | 'json' = 'csv'
): Promise<ApiResponse<any>> => {
  return auditDb.exportAuditLogs(params, format);
};

/**
 * Get compliance report
 * Uses database for report generation
 */
export const getComplianceReport = async (
  studyId: number,
  startDate: string,
  endDate: string
): Promise<ApiResponse<any>> => {
  return auditDb.getComplianceReport({
    studyId,
    startDate,
    endDate
  });
};

/**
 * Get SOAP/Database mode status
 */
export const getServiceStatus = (): {
  soapEnabled: boolean;
  mode: 'soap_primary' | 'database_only';
  description: string;
} => {
  const soapEnabled = config.libreclinica.soapEnabled;
  return {
    soapEnabled,
    mode: soapEnabled ? 'soap_primary' : 'database_only',
    description: soapEnabled
      ? 'SOAP primary with database backup (GxP compliant mode)'
      : 'Database only mode (SOAP disabled)'
  };
};

export default {
  recordAuditEvent,
  getAuditLogs,
  getSubjectAuditTrail,
  getFormAuditTrail,
  recordElectronicSignature,
  getAuditStats,
  exportAuditLogs,
  getComplianceReport,
  getServiceStatus
};

