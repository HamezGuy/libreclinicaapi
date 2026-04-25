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
import { safeXmlParse } from '../../utils/xml-safe-parse';

// Local interface for SOAP metadata response
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
    const result = await safeXmlParse(odmXml, {
      explicitArray: false,
      mergeAttrs: true
    }) as Record<string, any>;

    const metadata: SoapStudyMetadata = {
      study: {
        studyId: 0,
        identifier: '',
        name: '',
        dateCreated: new Date(),
        ownerId: 0,
        updateId: 0,
        typeId: 0,
        statusId: 0
      },
      events: [],
      crfs: []
    };

    // Parse study information
    if (result.ODM?.Study) {
      const study = Array.isArray(result.ODM.Study) ? result.ODM.Study[0] : result.ODM.Study;
      
      metadata.study = {
        studyId: parseInt(study.OID?.replace('S_', '') || '0'),
        identifier: study.OID || '',
        name: study.GlobalVariables?.StudyName || '',
        summary: study.GlobalVariables?.StudyDescription || '',
        protocolType: study.GlobalVariables?.ProtocolName || '',
        dateCreated: new Date(),
        ownerId: 0,
        updateId: 0,
        typeId: 0,
        statusId: 0
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
            studyEventDefinitionId: parseInt(event.OID?.replace('SE_', '') || '0'),
            studyId: metadata.study.studyId,
            name: event.Name || '',
            description: event.Description || '',
            repeating: event.Repeating === 'Yes',
            type: event.Type || 'Common',
            ordinal: index + 1,
            ownerId: 0,
            dateCreated: new Date(),
            updateId: 0
          }));
        }

        // Parse CRFs (FormDefs)
        if (metaDataVersion.FormDef) {
          const formDefs = Array.isArray(metaDataVersion.FormDef)
            ? metaDataVersion.FormDef
            : [metaDataVersion.FormDef];

          metadata.crfs = formDefs.map((form: any) => ({
            crfId: parseInt(form.OID?.replace('F_', '') || '0'),
            studyId: metadata.study.studyId,
            name: form.Name || '',
            description: form.Description || '',
            oid: form.OID || '',
            ownerId: 0,
            dateCreated: new Date(),
            updateId: 0,
            statusId: 0
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
    throw new Error(`Failed to parse study list: ${error.message}`);
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

