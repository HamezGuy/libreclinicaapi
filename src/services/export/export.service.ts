/**
 * Data Export Service
 * 
 * Uses EXISTING LibreClinica SOAP APIs for Part 11 compliance:
 * - studySoap for study metadata (getMetadata)
 * - studySubject SOAP for subject lists
 * - Proxies to LibreClinica's built-in extract functionality
 * 
 * Also integrates with LibreClinica's dataset_* tables:
 * - dataset: Main dataset configuration
 * - dataset_crf_version_map: Links datasets to CRF versions
 * - dataset_filter_map: Dataset filters
 * - dataset_item_status: Item status filters
 * - dataset_study_group_class_map: Study group filters
 * - archived_dataset_file: Previously exported files
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
import { pool } from '../../config/database';

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

/**
 * Create a dataset in LibreClinica's dataset table
 * This stores the export configuration for re-use and audit trail
 */
export const createDataset = async (
  datasetConfig: DatasetConfig,
  userId: number
): Promise<{ datasetId: number; success: boolean; error?: string }> => {
  logger.info('Creating dataset', { studyOID: datasetConfig.studyOID, userId });
  
  try {
    // Get study_id from study OID
    const studyResult = await pool.query(`
      SELECT study_id FROM study WHERE oc_oid = $1 LIMIT 1
    `, [datasetConfig.studyOID]);
    
    if (studyResult.rows.length === 0) {
      return { datasetId: 0, success: false, error: 'Study not found' };
    }
    
    const studyId = studyResult.rows[0].study_id;
    
    // Insert into LibreClinica's dataset table
    const datasetResult = await pool.query(`
      INSERT INTO dataset (
        study_id, 
        name, 
        description, 
        sql_statement,
        num_runs,
        date_start,
        date_end,
        show_event_location,
        show_event_start,
        show_event_end,
        show_subject_dob,
        show_subject_gender,
        show_subject_status,
        show_crf_status,
        show_crf_version,
        owner_id,
        date_created,
        status_id
      ) VALUES (
        $1, $2, $3, '', 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), 1
      )
      RETURNING dataset_id
    `, [
      studyId,
      datasetConfig.name || `Export_${Date.now()}`,
      datasetConfig.description || 'Automated export',
      datasetConfig.dateStart || null,
      datasetConfig.dateEnd || null,
      datasetConfig.showEventLocation || false,
      datasetConfig.showEventStart || false,
      datasetConfig.showEventEnd || false,
      datasetConfig.showSubjectDob || false,
      datasetConfig.showSubjectGender || false,
      datasetConfig.showSubjectStatus || false,
      datasetConfig.showCRFstatus || false,
      datasetConfig.showCRFversion || false,
      userId
    ]);
    
    const datasetId = datasetResult.rows[0].dataset_id;
    
    // If CRF OIDs specified, insert into dataset_crf_version_map
    if (datasetConfig.crfOIDs && datasetConfig.crfOIDs.length > 0) {
      for (const crfOID of datasetConfig.crfOIDs) {
        // Get event_definition_crf_id for this CRF
        const edcResult = await pool.query(`
          SELECT edc.event_definition_crf_id, cv.crf_version_id
          FROM event_definition_crf edc
          INNER JOIN crf_version cv ON edc.default_version_id = cv.crf_version_id
          INNER JOIN crf c ON cv.crf_id = c.crf_id
          WHERE c.oc_oid = $1
          LIMIT 1
        `, [crfOID]);
        
        if (edcResult.rows.length > 0) {
          await pool.query(`
            INSERT INTO dataset_crf_version_map (dataset_id, event_definition_crf_id)
            VALUES ($1, $2)
          `, [datasetId, edcResult.rows[0].event_definition_crf_id]);
        }
      }
    }
    
    logger.info('Dataset created', { datasetId, studyId });
    return { datasetId, success: true };
    
  } catch (error: any) {
    logger.error('Failed to create dataset', { error: error.message });
    return { datasetId: 0, success: false, error: error.message };
  }
};

/**
 * Get saved datasets for a study
 */
export const getDatasets = async (studyOID: string): Promise<any[]> => {
  logger.info('Getting datasets', { studyOID });
  
  try {
    const result = await pool.query(`
      SELECT 
        d.dataset_id,
        d.name,
        d.description,
        d.num_runs,
        d.date_start,
        d.date_end,
        d.show_event_location,
        d.show_event_start,
        d.show_event_end,
        d.show_subject_dob,
        d.show_subject_gender,
        d.show_subject_status,
        d.show_crf_status,
        d.show_crf_version,
        d.date_created,
        s.oc_oid as study_oid,
        s.name as study_name
      FROM dataset d
      INNER JOIN study s ON d.study_id = s.study_id
      WHERE s.oc_oid = $1 AND d.status_id = 1
      ORDER BY d.date_created DESC
    `, [studyOID]);
    
    return result.rows;
  } catch (error: any) {
    logger.error('Failed to get datasets', { error: error.message });
    return [];
  }
};

/**
 * Archive an exported file in LibreClinica's archived_dataset_file table
 */
export const archiveExportedFile = async (
  datasetId: number,
  filename: string,
  filepath: string,
  format: string,
  userId: number
): Promise<boolean> => {
  try {
    // First get or create export_format_id
    let formatResult = await pool.query(`
      SELECT export_format_id FROM export_format WHERE name = $1 LIMIT 1
    `, [format.toUpperCase()]);
    
    let exportFormatId = 1; // Default
    if (formatResult.rows.length > 0) {
      exportFormatId = formatResult.rows[0].export_format_id;
    }
    
    await pool.query(`
      INSERT INTO archived_dataset_file (
        dataset_id, name, export_format_id, date_created, owner_id
      ) VALUES ($1, $2, $3, NOW(), $4)
    `, [datasetId, filename, exportFormatId, userId]);
    
    return true;
  } catch (error: any) {
    logger.warn('Failed to archive exported file', { error: error.message });
    return false;
  }
};

/**
 * Get archived exports for a dataset
 */
export const getArchivedExports = async (datasetId: number): Promise<any[]> => {
  try {
    const result = await pool.query(`
      SELECT 
        adf.archived_dataset_file_id,
        adf.name as filename,
        adf.date_created,
        ef.name as format
      FROM archived_dataset_file adf
      LEFT JOIN export_format ef ON adf.export_format_id = ef.export_format_id
      WHERE adf.dataset_id = $1
      ORDER BY adf.date_created DESC
    `, [datasetId]);
    
    return result.rows;
  } catch (error: any) {
    logger.error('Failed to get archived exports', { error: error.message });
    return [];
  }
};

/**
 * Build full CDISC ODM export with all clinical data
 * Uses LibreClinica's dataset tables and item_data for complete export
 */
export const buildFullOdmExport = async (
  datasetConfig: DatasetConfig,
  username: string
): Promise<string> => {
  logger.info('Building full ODM export with clinical data', { studyOID: datasetConfig.studyOID });
  
  // Get study info
  const studyResult = await pool.query(`
    SELECT study_id, name, oc_oid, unique_identifier FROM study WHERE oc_oid = $1 LIMIT 1
  `, [datasetConfig.studyOID]);
  
  if (studyResult.rows.length === 0) {
    throw new Error('Study not found');
  }
  
  const study = studyResult.rows[0];
  const timestamp = new Date().toISOString();
  
  // Build ODM XML with full study data
  let odmXml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     FileOID="Export_${Date.now()}"
     FileType="Snapshot"
     Description="CDISC ODM Export"
     CreationDateTime="${timestamp}"
     ODMVersion="1.3">
  <Study OID="${escapeXml(study.oc_oid)}">
    <GlobalVariables>
      <StudyName>${escapeXml(study.name)}</StudyName>
      <StudyDescription>Exported from LibreClinica EDC</StudyDescription>
      <ProtocolName>${escapeXml(study.unique_identifier || study.name)}</ProtocolName>
    </GlobalVariables>
    <MetaDataVersion OID="v1.0.0" Name="Version 1.0.0">`;
  
  // Get all CRFs for this study
  const crfsResult = await pool.query(`
    SELECT DISTINCT c.crf_id, c.name, c.oc_oid, cv.crf_version_id, cv.oc_oid as version_oid
    FROM crf c
    INNER JOIN crf_version cv ON c.crf_id = cv.crf_id
    WHERE c.source_study_id = $1
    ORDER BY c.name
  `, [study.study_id]);
  
  // Add FormDef elements
  for (const crf of crfsResult.rows) {
    odmXml += `
      <FormDef OID="${escapeXml(crf.oc_oid)}" Name="${escapeXml(crf.name)}" Repeating="No">`;
    
    // Get item groups for this CRF
    const itemGroupsResult = await pool.query(`
      SELECT DISTINCT ig.item_group_id, ig.name, ig.oc_oid
      FROM item_group ig
      INNER JOIN item_group_metadata igm ON ig.item_group_id = igm.item_group_id
      WHERE igm.crf_version_id = $1
    `, [crf.crf_version_id]);
    
    for (const ig of itemGroupsResult.rows) {
      odmXml += `
        <ItemGroupRef ItemGroupOID="${escapeXml(ig.oc_oid)}" Mandatory="No"/>`;
    }
    
    odmXml += `
      </FormDef>`;
  }
  
  odmXml += `
    </MetaDataVersion>
  </Study>
  <ClinicalData StudyOID="${escapeXml(study.oc_oid)}" MetaDataVersionOID="v1.0.0">`;
  
  // Get all subjects with their data
  const subjectsResult = await pool.query(`
    SELECT 
      ss.study_subject_id,
      ss.label as study_subject_id_label,
      ss.oc_oid,
      s.unique_identifier as subject_id,
      s.gender,
      s.date_of_birth,
      ss.status_id
    FROM study_subject ss
    INNER JOIN subject s ON ss.subject_id = s.subject_id
    WHERE ss.study_id = $1
    ORDER BY ss.label
  `, [study.study_id]);
  
  for (const subject of subjectsResult.rows) {
    odmXml += `
    <SubjectData SubjectKey="${escapeXml(subject.oc_oid)}" OpenClinica:StudySubjectID="${escapeXml(subject.study_subject_id_label)}">`;
    
    // Get study events for this subject
    const eventsResult = await pool.query(`
      SELECT 
        se.study_event_id,
        sed.oc_oid as event_oid,
        sed.name as event_name,
        se.sample_ordinal,
        se.date_start,
        se.date_end,
        se.location
      FROM study_event se
      INNER JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
      WHERE se.study_subject_id = $1
      ORDER BY se.sample_ordinal
    `, [subject.study_subject_id]);
    
    for (const event of eventsResult.rows) {
      odmXml += `
      <StudyEventData StudyEventOID="${escapeXml(event.event_oid)}" StudyEventRepeatKey="${event.sample_ordinal}">`;
      
      // Get CRF data for this event
      const eventCrfsResult = await pool.query(`
        SELECT 
          ec.event_crf_id,
          cv.oc_oid as form_oid,
          c.name as form_name
        FROM event_crf ec
        INNER JOIN crf_version cv ON ec.crf_version_id = cv.crf_version_id
        INNER JOIN crf c ON cv.crf_id = c.crf_id
        WHERE ec.study_event_id = $1
      `, [event.study_event_id]);
      
      for (const eventCrf of eventCrfsResult.rows) {
        odmXml += `
        <FormData FormOID="${escapeXml(eventCrf.form_oid)}">`;
        
        // Get item data
        const itemDataResult = await pool.query(`
          SELECT 
            id.item_data_id,
            i.oc_oid as item_oid,
            i.name as item_name,
            id.value,
            ig.oc_oid as item_group_oid
          FROM item_data id
          INNER JOIN item i ON id.item_id = i.item_id
          INNER JOIN item_group_metadata igm ON i.item_id = igm.item_id
          INNER JOIN item_group ig ON igm.item_group_id = ig.item_group_id
          WHERE id.event_crf_id = $1 AND id.deleted = false
        `, [eventCrf.event_crf_id]);
        
        // Group items by item_group
        const itemsByGroup = new Map<string, any[]>();
        for (const item of itemDataResult.rows) {
          const groupItems = itemsByGroup.get(item.item_group_oid) || [];
          groupItems.push(item);
          itemsByGroup.set(item.item_group_oid, groupItems);
        }
        
        for (const [groupOid, items] of itemsByGroup) {
          odmXml += `
          <ItemGroupData ItemGroupOID="${escapeXml(groupOid)}" ItemGroupRepeatKey="1">`;
          
          for (const item of items) {
            odmXml += `
            <ItemData ItemOID="${escapeXml(item.item_oid)}" Value="${escapeXml(item.value || '')}"/>`;
          }
          
          odmXml += `
          </ItemGroupData>`;
        }
        
        odmXml += `
        </FormData>`;
      }
      
      odmXml += `
      </StudyEventData>`;
    }
    
    odmXml += `
    </SubjectData>`;
  }
  
  odmXml += `
  </ClinicalData>
</ODM>`;
  
  return odmXml;
};

export default {
  getStudyMetadataForExport,
  getSubjectsForExport,
  buildOdmExport,
  buildCsvExport,
  buildFullOdmExport,
  executeExport,
  createDataset,
  getDatasets,
  archiveExportedFile,
  getArchivedExports
};

