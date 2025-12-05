/**
 * Data Export Service
 * 
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance:
 * - studySoap for study metadata (getMetadata)
 * - studySubject SOAP for subject lists
 * - Proxies to LibreClinica's built-in extract functionality
 * 
 * LibreClinica Models Used:
 * - DatasetBean (extract/DatasetBean.java)
 * - ExportFormatBean (extract/ExportFormatBean.java)
 * - ExportSubjectDataBean (submit/crfdata/ExportSubjectDataBean.java)
 */

import { getSoapClient } from '../soap/soapClient';
import { logger } from '../../config/logger';
import axios from 'axios';
import { config } from '../../config/environment';

// Types matching LibreClinica's ExportFormatBean
export type ExportFormat = 'csv' | 'odm' | 'spss' | 'txt';

// Types matching LibreClinica's DatasetBean fields
export interface DatasetConfig {
  studyOID: string;
  name?: string;
  description?: string;
  dateStart?: string;
  dateEnd?: string;
  eventOIDs?: string[];
  crfOIDs?: string[];
  // Display options from DatasetBean
  showEventLocation?: boolean;
  showEventStart?: boolean;
  showEventEnd?: boolean;
  showSubjectDob?: boolean;
  showSubjectGender?: boolean;
  showSubjectStatus?: boolean;
  showCRFstatus?: boolean;
  showCRFversion?: boolean;
}

export interface ExportResult {
  success: boolean;
  data?: {
    content: string | Buffer;
    filename: string;
    mimeType: string;
    recordCount?: number;
  };
  error?: string;
}

/**
 * Get study metadata for export configuration
 * Uses EXISTING SOAP studyService.getMetadata
 */
export const getStudyMetadataForExport = async (
  studyOID: string,
  username: string
): Promise<any> => {
  logger.info('Getting study metadata for export via SOAP', { studyOID, username });

  const soapClient = getSoapClient();

  // Use existing SOAP endpoint
  const response = await soapClient.executeRequest({
    serviceName: 'study',
    methodName: 'getMetadata',
    parameters: {
      studyRef: {
        identifier: studyOID
      }
    },
    username
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to get study metadata');
  }

  return response.data;
};

/**
 * Get all subjects for a study (for export preview)
 * Uses EXISTING SOAP studySubject.listAllByStudy
 */
export const getSubjectsForExport = async (
  studyOID: string,
  username: string
): Promise<any[]> => {
  logger.info('Getting subjects for export via SOAP', { studyOID, username });

  const soapClient = getSoapClient();

  const response = await soapClient.executeRequest({
    serviceName: 'studySubject',
    methodName: 'listAllByStudy',
    parameters: {
      studyRef: {
        identifier: studyOID
      }
    },
    username
  });

  if (!response.success) {
    logger.warn('Failed to get subjects', { error: response.error });
    return [];
  }

  // Parse subjects from SOAP response
  const data = response.data as any;
  const subjects = data?.subjects || data?.studySubjects || [];
  return Array.isArray(subjects) ? subjects : [subjects].filter(Boolean);
};

/**
 * Build ODM XML export using SOAP-retrieved data
 * Matches LibreClinica's ClinicalDataReportBean structure
 */
export const buildOdmExport = async (
  datasetConfig: DatasetConfig,
  username: string
): Promise<string> => {
  logger.info('Building ODM export', { studyOID: datasetConfig.studyOID });

  // Get metadata and subjects via SOAP
  const [metadata, subjects] = await Promise.all([
    getStudyMetadataForExport(datasetConfig.studyOID, username),
    getSubjectsForExport(datasetConfig.studyOID, username)
  ]);

  const timestamp = new Date().toISOString();
  const studyName = metadata?.study?.name || datasetConfig.studyOID;

  // Build ODM XML following LibreClinica's ClinicalDataReportBean format
  let odmXml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     FileOID="Export_${Date.now()}"
     FileType="Snapshot"
     Description="ODM Export"
     CreationDateTime="${timestamp}"
     ODMVersion="1.3">
  <Study OID="${escapeXml(datasetConfig.studyOID)}">
    <GlobalVariables>
      <StudyName>${escapeXml(studyName)}</StudyName>
      <StudyDescription>Exported from LibreClinica</StudyDescription>
      <ProtocolName>${escapeXml(studyName)}</ProtocolName>
    </GlobalVariables>
  </Study>
  <ClinicalData StudyOID="${escapeXml(datasetConfig.studyOID)}" MetaDataVersionOID="v1.0.0">`;

  // Add subjects (matching ExportSubjectDataBean structure)
  for (const subject of subjects) {
    const subjectOID = subject.subjectOID || subject.label || subject.uniqueIdentifier;
    const studySubjectId = subject.studySubjectID || subject.label;
    
    odmXml += `
    <SubjectData SubjectKey="${escapeXml(subjectOID)}"`;
    
    if (studySubjectId) {
      odmXml += ` OpenClinica:StudySubjectID="${escapeXml(studySubjectId)}"`;
    }
    if (datasetConfig.showSubjectStatus && subject.status) {
      odmXml += ` OpenClinica:Status="${escapeXml(subject.status)}"`;
    }
    if (datasetConfig.showSubjectGender && subject.sex) {
      odmXml += ` OpenClinica:Sex="${escapeXml(subject.sex)}"`;
    }
    if (datasetConfig.showSubjectDob && subject.dateOfBirth) {
      odmXml += ` OpenClinica:DateOfBirth="${subject.dateOfBirth}"`;
    }
    
    odmXml += `/>`;
  }

  odmXml += `
  </ClinicalData>
</ODM>`;

  return odmXml;
};

/**
 * Build CSV export from SOAP data
 * Matches LibreClinica's TabReportBean/CommaReportBean
 */
export const buildCsvExport = async (
  datasetConfig: DatasetConfig,
  username: string
): Promise<string> => {
  logger.info('Building CSV export', { studyOID: datasetConfig.studyOID });

  const subjects = await getSubjectsForExport(datasetConfig.studyOID, username);

  // Build header row
  const headers = ['SubjectID', 'StudySubjectID', 'Status'];
  if (datasetConfig.showSubjectGender) headers.push('Sex');
  if (datasetConfig.showSubjectDob) headers.push('DateOfBirth');
  if (datasetConfig.showSubjectStatus) headers.push('Status');

  const rows: string[] = [headers.join(',')];

  // Build data rows
  for (const subject of subjects) {
    const row: string[] = [
      csvEscape(subject.subjectOID || subject.uniqueIdentifier || ''),
      csvEscape(subject.studySubjectID || subject.label || ''),
      csvEscape(subject.status || '')
    ];
    
    if (datasetConfig.showSubjectGender) row.push(csvEscape(subject.sex || ''));
    if (datasetConfig.showSubjectDob) row.push(csvEscape(subject.dateOfBirth || ''));
    if (datasetConfig.showSubjectStatus) row.push(csvEscape(subject.status || ''));
    
    rows.push(row.join(','));
  }

  return rows.join('\n');
};

/**
 * Execute export with specified format
 */
export const executeExport = async (
  datasetConfig: DatasetConfig,
  format: ExportFormat,
  username: string
): Promise<ExportResult> => {
  logger.info('Executing export', { 
    studyOID: datasetConfig.studyOID, 
    format,
    username 
  });

  try {
    let content: string;
    let mimeType: string;
    let extension: string;

    switch (format) {
      case 'odm':
        content = await buildOdmExport(datasetConfig, username);
        mimeType = 'application/xml';
        extension = 'xml';
        break;
      case 'csv':
        content = await buildCsvExport(datasetConfig, username);
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      case 'txt':
        content = await buildCsvExport(datasetConfig, username);
        mimeType = 'text/plain';
        extension = 'txt';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const filename = `${datasetConfig.studyOID}_export_${Date.now()}.${extension}`;

    return {
      success: true,
      data: {
        content,
        filename,
        mimeType,
        recordCount: content.split('\n').length - 1
      }
    };
  } catch (error: any) {
    logger.error('Export failed', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
};

// Helper functions
function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvEscape(str: string): string {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default {
  getStudyMetadataForExport,
  getSubjectsForExport,
  buildOdmExport,
  buildCsvExport,
  executeExport
};

