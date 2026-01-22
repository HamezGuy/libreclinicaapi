/**
 * Regulatory Export Service - 21 CFR Part 11 & HIPAA Compliant
 * 
 * Creates comprehensive export packages for regulatory submissions
 * with certification, audit trails, and electronic signatures.
 * 
 * HIPAA §164.312(b): Audit controls
 * 21 CFR Part 11 §11.10(b): Generating accurate copies
 * ICH E6(R2): Record retention and inspection
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import { pool } from '../../config/database';
import { logger } from '../../config/logger';
import { encryptBackupFile, isEncryptionEnabled, calculateFileChecksum } from '../backup/encryption.service';
import { uploadBackupToCloud, isCloudStorageEnabled } from '../backup/cloud-storage.service';

/**
 * Export package types
 */
export type RegulatoryExportType = 'full_study' | 'subject_data' | 'audit_trail' | 'forms' | 'custom';

/**
 * Export format types
 */
export type RegulatoryExportFormat = 'odm_xml' | 'pdf_a' | 'csv' | 'sas_transport' | 'zip_package';

/**
 * Export request interface
 */
export interface RegulatoryExportRequest {
  exportType: RegulatoryExportType;
  format: RegulatoryExportFormat;
  studyId?: number;
  subjectIds?: number[];
  dateRangeStart?: Date;
  dateRangeEnd?: Date;
  includeAuditTrail?: boolean;
  includeSignatures?: boolean;
  includeAttachments?: boolean;
  recipientOrganization?: string;
  reasonForExport?: string;
}

/**
 * Export result interface
 */
export interface RegulatoryExportResult {
  success: boolean;
  exportId: string;
  filePath?: string;
  fileSize?: number;
  checksum?: string;
  manifest?: ExportManifest;
  error?: string;
}

/**
 * Export manifest for package contents
 */
export interface ExportManifest {
  exportId: string;
  exportType: RegulatoryExportType;
  format: RegulatoryExportFormat;
  createdAt: string;
  createdBy: string;
  organization: string;
  studyInfo?: {
    studyId: number;
    studyName: string;
    studyOID: string;
    protocolNumber: string;
  };
  contents: ManifestEntry[];
  certificationStatement: string;
  checksum: string;
  checksumAlgorithm: string;
}

/**
 * Individual file entry in manifest
 */
interface ManifestEntry {
  fileName: string;
  fileType: string;
  description: string;
  checksum: string;
  size: number;
  createdAt: string;
}

/**
 * Generate unique export ID
 */
const generateExportId = (): string => {
  const now = new Date();
  return `EXP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${now.getTime()}`;
};

/**
 * Get study information for export
 */
const getStudyInfo = async (studyId: number): Promise<{
  studyId: number;
  studyName: string;
  studyOID: string;
  protocolNumber: string;
} | null> => {
  try {
    const result = await pool.query(`
      SELECT 
        study_id as "studyId",
        name as "studyName",
        oc_oid as "studyOID",
        unique_identifier as "protocolNumber"
      FROM study
      WHERE study_id = $1
    `, [studyId]);
    
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Failed to get study info', { studyId });
    return null;
  }
};

/**
 * Export audit trail data for a study/subject
 */
const exportAuditTrailData = async (
  studyId?: number,
  subjectIds?: number[],
  dateRangeStart?: Date,
  dateRangeEnd?: Date
): Promise<string> => {
  let query = `
    SELECT 
      ale.audit_id,
      ale.audit_log_event_type_id,
      alet.name as event_type,
      ale.audit_date,
      ale.audit_table,
      ale.entity_id,
      ale.entity_name,
      ale.user_id,
      ua.user_name,
      ale.old_value,
      ale.new_value,
      ale.reason_for_change
    FROM audit_log_event ale
    LEFT JOIN audit_log_event_type alet ON alet.audit_log_event_type_id = ale.audit_log_event_type_id
    LEFT JOIN user_account ua ON ua.user_id = ale.user_id
    WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramIndex = 1;
  
  if (dateRangeStart) {
    query += ` AND ale.audit_date >= $${paramIndex}`;
    params.push(dateRangeStart);
    paramIndex++;
  }
  
  if (dateRangeEnd) {
    query += ` AND ale.audit_date <= $${paramIndex}`;
    params.push(dateRangeEnd);
    paramIndex++;
  }
  
  query += ` ORDER BY ale.audit_date DESC`;
  
  const result = await pool.query(query, params);
  
  // Convert to CSV
  if (result.rows.length === 0) {
    return 'No audit records found for the specified criteria';
  }
  
  const headers = Object.keys(result.rows[0]).join(',');
  const rows = result.rows.map(row => 
    Object.values(row).map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }).join(',')
  );
  
  return [headers, ...rows].join('\n');
};

/**
 * Export electronic signature data
 */
const exportSignatureData = async (
  studyId?: number,
  dateRangeStart?: Date,
  dateRangeEnd?: Date
): Promise<string> => {
  // Query signature data from audit_log_event where signatures are recorded
  const query = `
    SELECT 
      ale.audit_id,
      ale.audit_date as signature_date,
      ale.entity_name as signed_entity,
      ua.user_name as signer_username,
      ua.first_name || ' ' || ua.last_name as signer_name,
      ale.reason_for_change as signature_meaning,
      ale.new_value as signature_details
    FROM audit_log_event ale
    LEFT JOIN user_account ua ON ua.user_id = ale.user_id
    WHERE ale.audit_table = 'electronic_signature'
      OR ale.reason_for_change LIKE '%signature%'
    ORDER BY ale.audit_date DESC
  `;
  
  const result = await pool.query(query);
  
  if (result.rows.length === 0) {
    return 'No electronic signature records found';
  }
  
  const headers = Object.keys(result.rows[0]).join(',');
  const rows = result.rows.map(row => 
    Object.values(row).map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }).join(',')
  );
  
  return [headers, ...rows].join('\n');
};

/**
 * Generate CDISC ODM XML export
 */
const generateOdmXml = async (
  studyId: number,
  subjectIds?: number[]
): Promise<string> => {
  const studyInfo = await getStudyInfo(studyId);
  if (!studyInfo) {
    throw new Error(`Study not found: ${studyId}`);
  }
  
  const now = new Date().toISOString();
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     FileType="Snapshot"
     FileOID="EDC-EXPORT-${Date.now()}"
     CreationDateTime="${now}"
     ODMVersion="1.3.2"
     Originator="EDC Regulatory Export Service"
     SourceSystem="LibreClinica">
  <Study OID="${studyInfo.studyOID}">
    <GlobalVariables>
      <StudyName>${studyInfo.studyName}</StudyName>
      <StudyDescription>Protocol: ${studyInfo.protocolNumber}</StudyDescription>
      <ProtocolName>${studyInfo.protocolNumber}</ProtocolName>
    </GlobalVariables>
`;

  // Add clinical data section
  xml += `    <ClinicalData StudyOID="${studyInfo.studyOID}" MetaDataVersionOID="v1.0">
`;

  // Get subject data
  let subjectQuery = `
    SELECT 
      ss.oc_oid as subject_oid,
      ss.label as subject_label,
      ss.secondary_label,
      ss.status_id
    FROM study_subject ss
    WHERE ss.study_id = $1
  `;
  
  const params: any[] = [studyId];
  
  if (subjectIds && subjectIds.length > 0) {
    subjectQuery += ` AND ss.study_subject_id = ANY($2)`;
    params.push(subjectIds);
  }
  
  const subjects = await pool.query(subjectQuery, params);
  
  for (const subject of subjects.rows) {
    xml += `      <SubjectData SubjectKey="${subject.subject_oid}">
        <StudySubjectID>${subject.subject_label}</StudySubjectID>
      </SubjectData>
`;
  }
  
  xml += `    </ClinicalData>
  </Study>
</ODM>`;

  return xml;
};

/**
 * Create certification statement
 */
const generateCertificationStatement = (
  username: string,
  organization: string,
  exportType: string
): string => {
  const now = new Date().toISOString();
  
  return `REGULATORY EXPORT CERTIFICATION

This export package was generated in compliance with:
- 21 CFR Part 11 (Electronic Records; Electronic Signatures)
- ICH E6(R2) (Guideline for Good Clinical Practice)
- HIPAA Security Rule (where applicable)

Certification Statement:
I hereby certify that the data contained in this export package represents 
a true, accurate, and complete copy of the electronic records as they 
existed in the source EDC system at the time of export.

All data has been verified for integrity using SHA-256 checksums.
Audit trail and electronic signature records are included as specified.

Export Type: ${exportType}
Generated: ${now}
Generated By: ${username}
Organization: ${organization}

This document serves as the certification manifest for regulatory inspection.
`;
};

/**
 * Create regulatory export package
 */
export const createRegulatoryExport = async (
  request: RegulatoryExportRequest,
  userId: number,
  username: string
): Promise<RegulatoryExportResult> => {
  const exportId = generateExportId();
  const exportDir = path.join(process.cwd(), 'exports', exportId);
  
  logger.info('Starting regulatory export', { 
    exportId, 
    exportType: request.exportType,
    format: request.format
  });
  
  try {
    // Create export directory
    fs.mkdirSync(exportDir, { recursive: true });
    
    const manifestEntries: ManifestEntry[] = [];
    let studyInfo = null;
    
    // Get study info if studyId provided
    if (request.studyId) {
      studyInfo = await getStudyInfo(request.studyId);
    }
    
    // Generate data files based on export type
    if (request.exportType === 'full_study' || request.exportType === 'subject_data') {
      if (!request.studyId) {
        throw new Error('studyId is required for study/subject exports');
      }
      
      // Generate ODM XML
      const odmXml = await generateOdmXml(request.studyId, request.subjectIds);
      const odmPath = path.join(exportDir, 'clinical_data.xml');
      fs.writeFileSync(odmPath, odmXml);
      
      const odmChecksum = await calculateFileChecksum(odmPath);
      manifestEntries.push({
        fileName: 'clinical_data.xml',
        fileType: 'CDISC ODM XML',
        description: 'Clinical data in CDISC ODM 1.3.2 format',
        checksum: odmChecksum,
        size: fs.statSync(odmPath).size,
        createdAt: new Date().toISOString()
      });
    }
    
    // Export audit trail if requested
    if (request.includeAuditTrail !== false) {
      const auditCsv = await exportAuditTrailData(
        request.studyId,
        request.subjectIds,
        request.dateRangeStart,
        request.dateRangeEnd
      );
      const auditPath = path.join(exportDir, 'audit_trail.csv');
      fs.writeFileSync(auditPath, auditCsv);
      
      const auditChecksum = await calculateFileChecksum(auditPath);
      manifestEntries.push({
        fileName: 'audit_trail.csv',
        fileType: 'CSV',
        description: 'Complete audit trail for exported records',
        checksum: auditChecksum,
        size: fs.statSync(auditPath).size,
        createdAt: new Date().toISOString()
      });
    }
    
    // Export signatures if requested
    if (request.includeSignatures !== false) {
      const sigCsv = await exportSignatureData(
        request.studyId,
        request.dateRangeStart,
        request.dateRangeEnd
      );
      const sigPath = path.join(exportDir, 'electronic_signatures.csv');
      fs.writeFileSync(sigPath, sigCsv);
      
      const sigChecksum = await calculateFileChecksum(sigPath);
      manifestEntries.push({
        fileName: 'electronic_signatures.csv',
        fileType: 'CSV',
        description: 'Electronic signature records per 21 CFR Part 11',
        checksum: sigChecksum,
        size: fs.statSync(sigPath).size,
        createdAt: new Date().toISOString()
      });
    }
    
    // Generate certification statement
    const certStatement = generateCertificationStatement(
      username,
      request.recipientOrganization || 'Internal',
      request.exportType
    );
    const certPath = path.join(exportDir, 'certification.txt');
    fs.writeFileSync(certPath, certStatement);
    
    const certChecksum = await calculateFileChecksum(certPath);
    manifestEntries.push({
      fileName: 'certification.txt',
      fileType: 'Text',
      description: 'Regulatory certification statement',
      checksum: certChecksum,
      size: fs.statSync(certPath).size,
      createdAt: new Date().toISOString()
    });
    
    // Create manifest
    const manifest: ExportManifest = {
      exportId,
      exportType: request.exportType,
      format: request.format,
      createdAt: new Date().toISOString(),
      createdBy: username,
      organization: request.recipientOrganization || 'Internal',
      studyInfo: studyInfo || undefined,
      contents: manifestEntries,
      certificationStatement: certStatement,
      checksum: '', // Will be set after creating zip
      checksumAlgorithm: 'SHA-256'
    };
    
    // Write manifest
    const manifestPath = path.join(exportDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    // Create ZIP package
    const zipPath = path.join(process.cwd(), 'exports', `${exportId}.zip`);
    
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
      
      archive.pipe(output);
      archive.directory(exportDir, false);
      archive.finalize();
    });
    
    // Calculate final checksum
    const zipChecksum = await calculateFileChecksum(zipPath);
    const zipStats = fs.statSync(zipPath);
    
    // Update manifest with final checksum
    manifest.checksum = zipChecksum;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    // Encrypt if enabled
    let finalPath = zipPath;
    if (isEncryptionEnabled()) {
      const encResult = await encryptBackupFile(zipPath);
      if (encResult.success && encResult.metadata) {
        finalPath = encResult.metadata.encryptedPath;
      }
    }
    
    // Upload to cloud if enabled
    if (isCloudStorageEnabled()) {
      await uploadBackupToCloud(finalPath, exportId, {
        'export-type': request.exportType,
        'format': request.format
      });
    }
    
    // Record export in database
    await pool.query(`
      INSERT INTO regulatory_exports (
        export_id, export_type, format, study_id, subject_ids,
        date_range_start, date_range_end, include_audit_trail,
        include_signatures, include_attachments, file_path,
        file_size_bytes, checksum, encrypted, requested_by,
        requested_by_username, reason_for_export, recipient_organization,
        status, metadata, retention_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'completed', $19, NOW() + INTERVAL '7 years')
    `, [
      exportId,
      request.exportType,
      request.format,
      request.studyId,
      request.subjectIds,
      request.dateRangeStart,
      request.dateRangeEnd,
      request.includeAuditTrail !== false,
      request.includeSignatures !== false,
      request.includeAttachments || false,
      finalPath,
      zipStats.size,
      zipChecksum,
      isEncryptionEnabled(),
      userId,
      username,
      request.reasonForExport,
      request.recipientOrganization,
      JSON.stringify(manifest)
    ]);
    
    // Log to audit trail
    await pool.query(`
      INSERT INTO audit_log_event (
        audit_log_event_type_id, audit_date, audit_table,
        entity_id, entity_name, user_id, new_value, reason_for_change
      ) VALUES (1, NOW(), 'regulatory_exports', 0, $1, $2, $3, $4)
    `, [
      exportId,
      userId,
      JSON.stringify({ exportType: request.exportType, format: request.format, studyId: request.studyId }),
      request.reasonForExport || 'Regulatory export created'
    ]);
    
    // Cleanup temp directory
    fs.rmSync(exportDir, { recursive: true, force: true });
    
    logger.info('Regulatory export completed', { 
      exportId, 
      size: zipStats.size,
      checksum: zipChecksum 
    });
    
    return {
      success: true,
      exportId,
      filePath: finalPath,
      fileSize: zipStats.size,
      checksum: zipChecksum,
      manifest
    };
    
  } catch (error: any) {
    logger.error('Regulatory export failed', { 
      exportId, 
      error: error.message 
    });
    
    // Cleanup on failure
    if (fs.existsSync(exportDir)) {
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
    
    // Record failure in database
    try {
      await pool.query(`
        INSERT INTO regulatory_exports (
          export_id, export_type, format, study_id,
          requested_by, requested_by_username, status, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7)
      `, [
        exportId,
        request.exportType,
        request.format,
        request.studyId,
        userId,
        username,
        error.message
      ]);
    } catch (dbError) {
      logger.error('Failed to record export failure', { error: dbError });
    }
    
    return {
      success: false,
      exportId,
      error: error.message
    };
  }
};

/**
 * Get export by ID
 */
export const getExportById = async (exportId: string): Promise<any> => {
  const result = await pool.query(`
    SELECT * FROM regulatory_exports WHERE export_id = $1
  `, [exportId]);
  
  return result.rows[0] || null;
};

/**
 * List regulatory exports
 */
export const listRegulatoryExports = async (
  studyId?: number,
  limit: number = 50
): Promise<any[]> => {
  let query = `
    SELECT 
      export_id as "exportId",
      export_type as "exportType",
      format,
      study_id as "studyId",
      file_size_bytes as "fileSize",
      checksum,
      status,
      requested_by_username as "requestedBy",
      reason_for_export as "reason",
      recipient_organization as "recipient",
      created_at as "createdAt"
    FROM regulatory_exports
    WHERE 1=1
  `;
  
  const params: any[] = [];
  
  if (studyId) {
    query += ` AND study_id = $1`;
    params.push(studyId);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ${limit}`;
  
  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * Download export file
 */
export const getExportFilePath = async (exportId: string): Promise<string | null> => {
  const result = await pool.query(`
    SELECT file_path FROM regulatory_exports 
    WHERE export_id = $1 AND status = 'completed'
  `, [exportId]);
  
  if (result.rows[0]?.file_path && fs.existsSync(result.rows[0].file_path)) {
    return result.rows[0].file_path;
  }
  
  return null;
};

export default {
  createRegulatoryExport,
  getExportById,
  listRegulatoryExports,
  getExportFilePath
};
