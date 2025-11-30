/**
 * Audit SOAP Service
 * 
 * Handles audit trail operations via LibreClinica SOAP API
 * CRITICAL for 21 CFR Part 11 compliance - maintains tamper-evident audit trail
 * 
 * SOAP Operations:
 * - Record audit events in LibreClinica's native audit log
 * - Retrieve audit trail for subjects, CRFs, and data changes
 * - Support electronic signature recording
 * 
 * The audit trail in LibreClinica maintains:
 * - WHO: User performing action
 * - WHAT: Nature of the change
 * - WHEN: Timestamp (system-generated, cannot be modified)
 * - WHY: Reason for change (required for modifications)
 */

import { getSoapClient } from './soapClient';
import { logger } from '../../config/logger';
import { config } from '../../config/environment';
import { ApiResponse } from '../../types';
import xml2js from 'xml2js';

/**
 * Audit event types matching LibreClinica's audit_log_event_type table
 */
export enum AuditEventType {
  // Subject events
  SUBJECT_CREATED = 1,
  SUBJECT_UPDATED = 2,
  SUBJECT_STATUS_CHANGED = 3,
  SUBJECT_REASSIGNED = 4,
  SUBJECT_REMOVED = 5,
  
  // Study event events
  STUDY_EVENT_SCHEDULED = 6,
  STUDY_EVENT_STARTED = 7,
  STUDY_EVENT_COMPLETED = 8,
  STUDY_EVENT_SKIPPED = 9,
  STUDY_EVENT_STOPPED = 10,
  
  // CRF/Form events
  CRF_INITIAL_DATA_ENTRY = 11,
  CRF_UPDATED = 12,
  CRF_MARKED_COMPLETE = 13,
  CRF_SDV_VERIFIED = 14,
  CRF_LOCKED = 15,
  CRF_SIGNED = 16,
  
  // Item data events
  ITEM_DATA_INSERTED = 17,
  ITEM_DATA_UPDATED = 18,
  ITEM_DATA_DELETED = 19,
  
  // Query/Discrepancy events
  QUERY_OPENED = 20,
  QUERY_UPDATED = 21,
  QUERY_RESOLVED = 22,
  QUERY_CLOSED = 23,
  
  // Electronic signature events
  ESIGNATURE_ADDED = 30,
  ESIGNATURE_REMOVED = 31,
  
  // Login events
  USER_LOGIN = 40,
  USER_LOGOUT = 41,
  LOGIN_FAILED = 42,
  PASSWORD_CHANGED = 43,
  ACCOUNT_LOCKED = 44
}

/**
 * Audit record structure for SOAP operations
 */
export interface AuditRecord {
  auditId?: number;
  auditDate: Date;
  auditTable: string;
  entityId: number;
  entityName?: string;
  userId: number;
  username: string;
  eventTypeId: AuditEventType;
  eventTypeName?: string;
  oldValue?: string;
  newValue?: string;
  reasonForChange?: string;
  electronicSignature?: {
    username: string;
    meaning: string;
    timestamp: Date;
  };
}

/**
 * Audit query parameters
 */
export interface AuditQueryParams {
  studyId?: number;
  subjectId?: number;
  eventCrfId?: number;
  userId?: number;
  eventTypeId?: AuditEventType;
  startDate?: string;
  endDate?: string;
  entityType?: 'study' | 'subject' | 'event' | 'crf' | 'item';
  limit?: number;
  offset?: number;
}

/**
 * Record an audit event via SOAP
 * This ensures the audit entry is recorded in LibreClinica's native audit system
 */
export const recordAuditEvent = async (
  record: AuditRecord,
  userId: number,
  username: string
): Promise<ApiResponse<{ auditId: number }>> => {
  // Skip SOAP if disabled
  if (!config.libreclinica.soapEnabled) {
    logger.debug('SOAP disabled - audit will be recorded via direct database');
    return { success: false, message: 'SOAP disabled - use database service' };
  }

  logger.info('Recording audit event via SOAP', {
    auditTable: record.auditTable,
    entityId: record.entityId,
    eventTypeId: record.eventTypeId,
    userId
  });

  try {
    const odmXml = buildAuditOdm(record);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'data',
      methodName: 'importODM',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      logger.error('SOAP audit recording failed', {
        error: response.error,
        entityId: record.entityId
      });

      return {
        success: false,
        message: response.error || 'Failed to record audit via SOAP'
      };
    }

    // Parse response to get audit ID
    const auditId = parseAuditResponse(response.data);

    logger.info('Audit event recorded via SOAP', {
      auditId,
      entityId: record.entityId,
      eventTypeId: record.eventTypeId
    });

    return {
      success: true,
      data: { auditId },
      message: 'Audit event recorded successfully'
    };
  } catch (error: any) {
    logger.error('Audit recording error', {
      error: error.message,
      entityId: record.entityId
    });

    return {
      success: false,
      message: `Audit recording failed: ${error.message}`
    };
  }
};

/**
 * Get audit trail for a subject via SOAP
 * Returns complete audit history for 21 CFR Part 11 compliance
 */
export const getSubjectAuditTrail = async (
  studyId: number,
  subjectId: number,
  userId: number,
  username: string
): Promise<ApiResponse<AuditRecord[]>> => {
  if (!config.libreclinica.soapEnabled) {
    logger.debug('SOAP disabled - fetching audit via database');
    return { success: false, message: 'SOAP disabled - use database service' };
  }

  logger.info('Fetching subject audit trail via SOAP', {
    studyId,
    subjectId,
    userId
  });

  try {
    const studyOid = `S_${studyId}`;
    const subjectOid = `SS_${subjectId}`;
    
    const odmXml = buildAuditQueryOdm(studyOid, subjectOid);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'data',
      methodName: 'extractODM',
      parameters: {
        odm: odmXml,
        includeAudit: true
      },
      userId,
      username
    });

    if (!response.success) {
      return {
        success: false,
        message: response.error || 'Failed to fetch audit trail'
      };
    }

    const auditRecords = await parseAuditTrailOdm(response.data);

    logger.info('Subject audit trail fetched via SOAP', {
      subjectId,
      recordCount: auditRecords.length
    });

    return {
      success: true,
      data: auditRecords,
      message: 'Audit trail fetched successfully'
    };
  } catch (error: any) {
    logger.error('Audit trail fetch error', {
      error: error.message,
      subjectId
    });

    return {
      success: false,
      message: `Audit trail fetch failed: ${error.message}`
    };
  }
};

/**
 * Get form-level audit trail via SOAP
 */
export const getFormAuditTrail = async (
  eventCrfId: number,
  userId: number,
  username: string
): Promise<ApiResponse<AuditRecord[]>> => {
  if (!config.libreclinica.soapEnabled) {
    return { success: false, message: 'SOAP disabled - use database service' };
  }

  logger.info('Fetching form audit trail via SOAP', {
    eventCrfId,
    userId
  });

  try {
    const odmXml = buildFormAuditQueryOdm(eventCrfId);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'data',
      methodName: 'extractODM',
      parameters: {
        odm: odmXml,
        eventCrfId: eventCrfId,
        includeAudit: true
      },
      userId,
      username
    });

    if (!response.success) {
      return {
        success: false,
        message: response.error || 'Failed to fetch form audit trail'
      };
    }

    const auditRecords = await parseAuditTrailOdm(response.data);

    return {
      success: true,
      data: auditRecords,
      message: 'Form audit trail fetched successfully'
    };
  } catch (error: any) {
    logger.error('Form audit trail fetch error', {
      error: error.message,
      eventCrfId
    });

    return {
      success: false,
      message: `Form audit trail fetch failed: ${error.message}`
    };
  }
};

/**
 * Record electronic signature via SOAP
 * 21 CFR Part 11 §11.100 - Electronic signature must be linked to record
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
  username: string
): Promise<ApiResponse<{ signatureId: number }>> => {
  if (!config.libreclinica.soapEnabled) {
    return { success: false, message: 'SOAP disabled - use database service' };
  }

  logger.info('Recording electronic signature via SOAP', {
    entityType,
    entityId,
    signerUsername: signature.username,
    meaning: signature.meaning
  });

  try {
    const odmXml = buildSignatureOdm(entityType, entityId, signature);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'data',
      methodName: 'importODM',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      logger.error('Electronic signature recording failed', {
        error: response.error,
        entityId
      });

      return {
        success: false,
        message: response.error || 'Failed to record electronic signature'
      };
    }

    logger.info('Electronic signature recorded via SOAP', {
      entityType,
      entityId,
      signerUsername: signature.username
    });

    return {
      success: true,
      data: { signatureId: entityId },
      message: 'Electronic signature recorded successfully'
    };
  } catch (error: any) {
    logger.error('Electronic signature error', {
      error: error.message,
      entityId
    });

    return {
      success: false,
      message: `Electronic signature failed: ${error.message}`
    };
  }
};

/**
 * Build ODM XML for audit record
 */
function buildAuditOdm(record: AuditRecord): string {
  const timestamp = record.auditDate.toISOString();
  const reasonXml = record.reasonForChange ? 
    `<ReasonForChange>${escapeXml(record.reasonForChange)}</ReasonForChange>` : '';

  let signatureXml = '';
  if (record.electronicSignature) {
    signatureXml = `
      <Signature>
        <UserRef UserOID="${record.electronicSignature.username}"/>
        <SignatureOID>SIG_${Date.now()}</SignatureOID>
        <DateTimeStamp>${record.electronicSignature.timestamp.toISOString()}</DateTimeStamp>
        <CryptoBindingManifest>
          <SignatureMethod>digital</SignatureMethod>
          <Meaning>${escapeXml(record.electronicSignature.meaning)}</Meaning>
        </CryptoBindingManifest>
      </Signature>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="AUDIT-${Date.now()}"
     CreationDateTime="${timestamp}">
  <AdminData>
    <AuditRecords>
      <AuditRecord>
        <UserRef UserOID="${record.username}"/>
        <LocationRef LocationOID="API"/>
        <DateTimeStamp>${timestamp}</DateTimeStamp>
        <EntityRef EntityOID="${record.auditTable}_${record.entityId}"/>
        <AuditEventType>${record.eventTypeId}</AuditEventType>
        ${record.oldValue ? `<OldValue>${escapeXml(record.oldValue)}</OldValue>` : ''}
        ${record.newValue ? `<NewValue>${escapeXml(record.newValue)}</NewValue>` : ''}
        ${reasonXml}
        <SourceID>${record.username}</SourceID>
      </AuditRecord>
    </AuditRecords>
    ${signatureXml}
  </AdminData>
</ODM>`;
}

/**
 * Build ODM XML for audit query
 */
function buildAuditQueryOdm(studyOid: string, subjectOid: string): string {
  const timestamp = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="AUDIT-QUERY-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectOid}">
      <OpenClinica:AuditTrail Include="Yes"/>
    </SubjectData>
  </ClinicalData>
</ODM>`;
}

/**
 * Build ODM XML for form audit query
 */
function buildFormAuditQueryOdm(eventCrfId: number): string {
  const timestamp = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="FORM-AUDIT-${Date.now()}"
     CreationDateTime="${timestamp}">
  <AdminData>
    <AuditQuery>
      <EventCRFRef EventCRFOID="EC_${eventCrfId}"/>
      <IncludeAudit>true</IncludeAudit>
    </AuditQuery>
  </AdminData>
</ODM>`;
}

/**
 * Build ODM XML for electronic signature
 */
function buildSignatureOdm(
  entityType: 'crf' | 'subject' | 'event',
  entityId: number,
  signature: {
    username: string;
    password: string;
    meaning: string;
    reasonForChange?: string;
  }
): string {
  const timestamp = new Date().toISOString();
  const entityOid = `${entityType.toUpperCase()}_${entityId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="ESIG-${Date.now()}"
     CreationDateTime="${timestamp}">
  <AdminData>
    <Signature ID="SIG_${Date.now()}">
      <UserRef UserOID="${signature.username}"/>
      <LocationRef LocationOID="API"/>
      <SignatureRef SignatureOID="${entityOid}"/>
      <DateTimeStamp>${timestamp}</DateTimeStamp>
      <CryptoBindingManifest>
        <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#dsa-sha1">
          digital
        </SignatureMethod>
        <Meaning>${escapeXml(signature.meaning)}</Meaning>
      </CryptoBindingManifest>
    </Signature>
    <User OID="${signature.username}">
      <UserRef UserOID="${signature.username}"/>
      <OpenClinica:Password>${escapeXml(signature.password)}</OpenClinica:Password>
    </User>
  </AdminData>
</ODM>`;
}

/**
 * Parse audit response to get audit ID
 */
function parseAuditResponse(responseData: any): number {
  try {
    if (typeof responseData === 'object' && responseData.auditId) {
      return responseData.auditId;
    }
    
    if (typeof responseData === 'string') {
      const match = responseData.match(/AuditID[="](\d+)/i);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    return Date.now(); // Fallback to timestamp-based ID
  } catch (error) {
    logger.warn('Could not parse audit ID from response');
    return Date.now();
  }
}

/**
 * Parse audit trail from ODM response
 */
async function parseAuditTrailOdm(odmXml: string | any): Promise<AuditRecord[]> {
  try {
    const auditRecords: AuditRecord[] = [];
    
    let xmlString = odmXml;
    if (typeof odmXml === 'object') {
      xmlString = odmXml.odm || odmXml.toString();
    }

    if (typeof xmlString !== 'string') {
      return auditRecords;
    }

    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true
    });

    const result = await parser.parseStringPromise(xmlString);

    // Parse AuditRecords from AdminData
    if (result.ODM?.AdminData?.AuditRecords?.AuditRecord) {
      const records = Array.isArray(result.ODM.AdminData.AuditRecords.AuditRecord)
        ? result.ODM.AdminData.AuditRecords.AuditRecord
        : [result.ODM.AdminData.AuditRecords.AuditRecord];

      for (const record of records) {
        auditRecords.push({
          auditId: parseInt(record.AuditID || record.ID || '0'),
          auditDate: new Date(record.DateTimeStamp),
          auditTable: record.EntityRef?.EntityOID?.split('_')[0] || 'unknown',
          entityId: parseInt(record.EntityRef?.EntityOID?.split('_')[1] || '0'),
          userId: parseInt(record.UserRef?.UserOID || '0'),
          username: record.UserRef?.UserOID || 'unknown',
          eventTypeId: parseInt(record.AuditEventType || '0'),
          oldValue: record.OldValue,
          newValue: record.NewValue,
          reasonForChange: record.ReasonForChange
        });
      }
    }

    // Parse AuditRecords from ClinicalData (item-level changes)
    if (result.ODM?.ClinicalData?.SubjectData) {
      // Extract inline audit records from subject/event/form data
      const subjectData = result.ODM.ClinicalData.SubjectData;
      extractInlineAuditRecords(subjectData, auditRecords);
    }

    return auditRecords;
  } catch (error: any) {
    logger.error('Failed to parse audit trail ODM', { error: error.message });
    return [];
  }
}

/**
 * Extract inline audit records from clinical data
 */
function extractInlineAuditRecords(data: any, records: AuditRecord[]): void {
  try {
    // Check for AuditRecord elements at any level
    if (data.AuditRecord) {
      const auditRecordData = Array.isArray(data.AuditRecord) 
        ? data.AuditRecord 
        : [data.AuditRecord];
      
      for (const ar of auditRecordData) {
        records.push({
          auditDate: new Date(ar.DateTimeStamp),
          auditTable: 'inline',
          entityId: 0,
          userId: 0,
          username: ar.UserRef?.UserOID || ar.SourceID || 'unknown',
          eventTypeId: parseInt(ar.AuditEventType || '0'),
          oldValue: ar.OldValue,
          newValue: ar.NewValue,
          reasonForChange: ar.ReasonForChange
        });
      }
    }

    // Recursively check nested elements
    if (data.StudyEventData) {
      const events = Array.isArray(data.StudyEventData) ? data.StudyEventData : [data.StudyEventData];
      events.forEach((e: any) => extractInlineAuditRecords(e, records));
    }

    if (data.FormData) {
      const forms = Array.isArray(data.FormData) ? data.FormData : [data.FormData];
      forms.forEach((f: any) => extractInlineAuditRecords(f, records));
    }

    if (data.ItemGroupData) {
      const groups = Array.isArray(data.ItemGroupData) ? data.ItemGroupData : [data.ItemGroupData];
      groups.forEach((g: any) => extractInlineAuditRecords(g, records));
    }

    if (data.ItemData) {
      const items = Array.isArray(data.ItemData) ? data.ItemData : [data.ItemData];
      items.forEach((i: any) => extractInlineAuditRecords(i, records));
    }
  } catch (error: any) {
    logger.debug('Error extracting inline audit records', { error: error.message });
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default {
  recordAuditEvent,
  getSubjectAuditTrail,
  getFormAuditTrail,
  recordElectronicSignature,
  AuditEventType
};

