/**
 * Study SOAP Service
 * 
 * Handles study metadata retrieval via LibreClinica SOAP API
 * - Get study metadata (structure, events, CRFs)
 * - Parse ODM metadata responses
 * - Extract study definitions
 * 
 * SOAP Endpoint: http://localhost:8080/LibreClinica/ws/study/v1
 */

import { getSoapClient } from './soapClient';
import { logger } from '../../config/logger';
import { ApiResponse } from '../../types';
import xml2js from 'xml2js';

// Local interface for SOAP metadata response (uses snake_case to match raw data)
interface SoapStudyMetadata {
  study: Record<string, unknown>;
  events: Record<string, unknown>[];
  crfs: Record<string, unknown>[];
}

/**
 * Get study metadata via SOAP
 * Returns complete study structure including events and CRFs
 */
export const getStudyMetadata = async (
  studyOid: string,
  userId: number,
  username: string
): Promise<ApiResponse<SoapStudyMetadata>> => {
  logger.info('Fetching study metadata via SOAP', {
    studyOid,
    userId,
    username
  });

  try {
    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'study',
      methodName: 'getMetadata',
      parameters: {
        studyOid: studyOid
      },
      userId,
      username
    });

    if (!response.success) {
      logger.error('Failed to fetch study metadata', {
        error: response.error,
        studyOid
      });

      return {
        success: false,
        message: response.error || 'Failed to fetch study metadata'
      };
    }

    // Parse ODM metadata
    const metadata = await parseOdmMetadata(response.data.odm || response.data);

    logger.info('Study metadata fetched successfully', {
      studyOid,
      eventCount: metadata.events?.length,
      crfCount: metadata.crfs?.length
    });

    return {
      success: true,
      data: metadata,
      message: 'Study metadata fetched successfully'
    };
  } catch (error: any) {
    logger.error('Study metadata fetch error', {
      error: error.message,
      studyOid
    });

    return {
      success: false,
      message: `Failed to fetch study metadata: ${error.message}`
    };
  }
};

/**
 * List all studies via SOAP
 */
export const listStudies = async (
  userId: number,
  username: string
): Promise<ApiResponse<any[]>> => {
  logger.info('Listing studies via SOAP', { userId, username });

  try {
    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'study',
      methodName: 'listAll',
      parameters: {},
      userId,
      username
    });

    if (!response.success) {
      return {
        success: false,
        message: response.error || 'Failed to list studies'
      };
    }

    const studies = parseStudyList(response.data);

    logger.info('Studies listed successfully', {
      studyCount: studies.length
    });

    return {
      success: true,
      data: studies,
      message: 'Studies listed successfully'
    };
  } catch (error: any) {
    logger.error('Study listing error', {
      error: error.message
    });

    return {
      success: false,
      message: `Failed to list studies: ${error.message}`
    };
  }
};

/**
 * Parse ODM metadata XML to structured format
 */
export const parseOdmMetadata = async (odmXml: string): Promise<SoapStudyMetadata> => {
  try {
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true
    });

    const result = await parser.parseStringPromise(odmXml);

    const metadata: SoapStudyMetadata = {
      study: {
        study_id: 0,
        unique_identifier: '',
        name: '',
        date_created: new Date(),
        owner_id: 0,
        update_id: 0,
        type_id: 0,
        status_id: 0
      },
      events: [],
      crfs: []
    };

    // Parse study information
    if (result.ODM?.Study) {
      const study = Array.isArray(result.ODM.Study) ? result.ODM.Study[0] : result.ODM.Study;
      
      metadata.study = {
        study_id: parseInt(study.OID?.replace('S_', '') || '0'),
        unique_identifier: study.OID || '',
        name: study.GlobalVariables?.StudyName || '',
        summary: study.GlobalVariables?.StudyDescription || '',
        protocol_type: study.GlobalVariables?.ProtocolName || '',
        date_created: new Date(),
        owner_id: 0,
        update_id: 0,
        type_id: 0,
        status_id: 0
      };

      // Parse metadata version
      if (study.MetaDataVersion) {
        const metaDataVersion = Array.isArray(study.MetaDataVersion) 
          ? study.MetaDataVersion[0] 
          : study.MetaDataVersion;

        // Parse study events
        if (metaDataVersion.StudyEventDef) {
          const eventDefs = Array.isArray(metaDataVersion.StudyEventDef)
            ? metaDataVersion.StudyEventDef
            : [metaDataVersion.StudyEventDef];

          metadata.events = eventDefs.map((event: any, index: number) => ({
            study_event_definition_id: parseInt(event.OID?.replace('SE_', '') || '0'),
            study_id: metadata.study.study_id,
            name: event.Name || '',
            description: event.Description || '',
            repeating: event.Repeating === 'Yes',
            type: event.Type || 'Common',
            ordinal: index + 1,
            owner_id: 0,
            date_created: new Date(),
            update_id: 0
          }));
        }

        // Parse CRFs (FormDefs)
        if (metaDataVersion.FormDef) {
          const formDefs = Array.isArray(metaDataVersion.FormDef)
            ? metaDataVersion.FormDef
            : [metaDataVersion.FormDef];

          metadata.crfs = formDefs.map((form: any) => ({
            crf_id: parseInt(form.OID?.replace('F_', '') || '0'),
            study_id: metadata.study.study_id,
            name: form.Name || '',
            description: form.Description || '',
            oc_oid: form.OID || '',
            owner_id: 0,
            date_created: new Date(),
            update_id: 0,
            status_id: 0
          }));
        }
      }
    }

    return metadata;
  } catch (error: any) {
    logger.error('Failed to parse ODM metadata', {
      error: error.message
    });

    throw new Error(`ODM metadata parsing failed: ${error.message}`);
  }
};

/**
 * Parse study list from SOAP response
 * LibreClinica 1.4: Now includes child studies/sites for monitor users
 */
function parseStudyList(responseData: any): any[] {
  try {
    const studies: any[] = [];

    if (responseData.studies?.study) {
      const studyList = Array.isArray(responseData.studies.study)
        ? responseData.studies.study
        : [responseData.studies.study];

      for (const study of studyList) {
        // Parse main study
        const parsedStudy: any = {
          oid: study.oid || study.OID,
          identifier: study.identifier,
          name: study.name,
          status: study.status,
          parentStudyOid: study.parentStudyOID || study.parentStudyOid || null,
          isParent: !study.parentStudyOID && !study.parentStudyOid
        };

        studies.push(parsedStudy);

        // LibreClinica 1.4: Parse child sites if present (for monitors)
        if (study.sites?.site) {
          const siteList = Array.isArray(study.sites.site)
            ? study.sites.site
            : [study.sites.site];

          for (const site of siteList) {
            studies.push({
              oid: site.oid || site.OID,
              identifier: site.identifier,
              name: site.name,
              status: site.status,
              parentStudyOid: parsedStudy.oid,
              isParent: false,
              isSite: true
            });
          }
        }
      }
    }

    return studies;
  } catch (error: any) {
    logger.error('Failed to parse study list', {
      error: error.message
    });
    return [];
  }
}

/**
 * Get study OID by study ID
 * Helper function to convert study ID to OID format
 */
export const getStudyOid = (studyId: number): string => {
  return `S_${studyId}`;
};

/**
 * Extract study ID from OID
 */
export const extractStudyId = (studyOid: string): number => {
  return parseInt(studyOid.replace('S_', '') || '0');
};

export default {
  getStudyMetadata,
  listStudies,
  parseOdmMetadata,
  getStudyOid,
  extractStudyId
};

