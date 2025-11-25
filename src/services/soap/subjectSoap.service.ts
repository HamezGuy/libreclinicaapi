/**
 * Subject SOAP Service
 * 
 * Handles subject (patient) enrollment via LibreClinica SOAP API
 * - Create new subjects (study participants)
 * - List subjects via SOAP
 * - Check subject existence
 * - Schedule study events for subjects
 * 
 * SOAP Endpoint: http://localhost:8080/LibreClinica/ws/studySubject/v1
 */

import { getSoapClient } from './soapClient';
import { logger } from '../../config/logger';
import { SubjectCreateRequest, ApiResponse } from '../../types';

/**
 * SOAP Subject response
 */
interface SoapSubjectResponse {
  result: string;
  odm?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Subject enrollment via SOAP
 */
export const createSubject = async (
  request: SubjectCreateRequest,
  userId: number,
  username: string
): Promise<ApiResponse<SoapSubjectResponse>> => {
  logger.info('Creating subject via SOAP', {
    studyId: request.studyId,
    studySubjectId: request.studySubjectId,
    userId,
    username
  });

  try {
    const odmXml = buildCreateSubjectOdm(request);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'studySubject',
      methodName: 'create',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      logger.error('SOAP subject creation failed', {
        error: response.error,
        studySubjectId: request.studySubjectId
      });

      return {
        success: false,
        message: response.error || 'Failed to create subject via SOAP'
      };
    }

    logger.info('Subject created successfully via SOAP', {
      studySubjectId: request.studySubjectId,
      studyId: request.studyId
    });

    return {
      success: true,
      data: {
        result: 'success',
        odm: response.data?.odm || response.data
      },
      message: 'Subject created successfully'
    };
  } catch (error: any) {
    logger.error('Subject creation error', {
      error: error.message,
      studySubjectId: request.studySubjectId
    });

    return {
      success: false,
      message: `Subject creation failed: ${error.message}`
    };
  }
};

/**
 * Check if subject exists via SOAP
 */
export const isSubjectExists = async (
  studyOid: string,
  subjectLabel: string,
  userId: number,
  username: string
): Promise<boolean> => {
  logger.debug('Checking subject existence via SOAP', {
    studyOid,
    subjectLabel,
    userId
  });

  try {
    const odmXml = buildIsSubjectExistsOdm(studyOid, subjectLabel);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'studySubject',
      methodName: 'isStudySubject',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      logger.warn('Subject existence check failed', {
        error: response.error,
        subjectLabel
      });
      return false;
    }

    // Parse response to determine existence
    const exists = response.data?.result === 'true' || 
                   response.data?.toString().toLowerCase().includes('true');

    logger.debug('Subject existence check result', {
      subjectLabel,
      exists
    });

    return exists;
  } catch (error: any) {
    logger.error('Subject existence check error', {
      error: error.message,
      subjectLabel
    });
    return false;
  }
};

/**
 * List subjects via SOAP
 * Note: Direct database queries are more efficient for listing
 */
export const listSubjects = async (
  studyOid: string,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Listing subjects via SOAP', {
    studyOid,
    userId
  });

  try {
    const odmXml = buildListSubjectsOdm(studyOid);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'studySubject',
      methodName: 'listAll',
      parameters: {
        studyOid: studyOid,
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      return {
        success: false,
        message: response.error || 'Failed to list subjects'
      };
    }

    return {
      success: true,
      data: response.data,
      message: 'Subjects listed successfully'
    };
  } catch (error: any) {
    logger.error('Subject listing error', {
      error: error.message,
      studyOid
    });

    return {
      success: false,
      message: `Failed to list subjects: ${error.message}`
    };
  }
};

/**
 * Build ODM XML for subject creation
 * Follows ODM 1.3 standard
 */
function buildCreateSubjectOdm(request: SubjectCreateRequest): string {
  const {
    studyId,
    studySubjectId,
    secondaryId,
    enrollmentDate,
    gender,
    dateOfBirth
  } = request;

  const studyOid = `S_${studyId}`;
  const subjectOid = `SS_${studySubjectId}`;
  
  const enrollDate = enrollmentDate || new Date().toISOString().split('T')[0];
  const genderValue = gender ? (gender.toLowerCase() === 'm' || gender.toLowerCase() === 'male' ? 'm' : 'f') : '';

  let odmXml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" 
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="000-00-0000"
     CreationDateTime="${new Date().toISOString()}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectOid}">
      <StudySubjectID>${studySubjectId}</StudySubjectID>`;

  if (secondaryId) {
    odmXml += `
      <SecondaryID>${secondaryId}</SecondaryID>`;
  }

  odmXml += `
      <EnrollmentDate>${enrollDate}</EnrollmentDate>`;

  if (genderValue) {
    odmXml += `
      <Sex>${genderValue}</Sex>`;
  }

  if (dateOfBirth) {
    odmXml += `
      <DateOfBirth>${dateOfBirth}</DateOfBirth>`;
  }

  odmXml += `
    </SubjectData>
  </ClinicalData>
</ODM>`;

  return odmXml;
}

/**
 * Build ODM XML for subject existence check
 */
function buildIsSubjectExistsOdm(studyOid: string, subjectLabel: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="000-00-0000"
     CreationDateTime="${new Date().toISOString()}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectLabel}">
      <StudySubjectID>${subjectLabel}</StudySubjectID>
    </SubjectData>
  </ClinicalData>
</ODM>`;
}

/**
 * Build ODM XML for listing subjects
 */
function buildListSubjectsOdm(studyOid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="000-00-0000"
     CreationDateTime="${new Date().toISOString()}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
  </ClinicalData>
</ODM>`;
}

/**
 * Parse subject list from ODM response
 */
export const parseSubjectListOdm = (odmXml: string): any[] => {
  try {
    // Simple XML parsing (in production, use xml2js library)
    const subjects: any[] = [];
    const subjectDataMatches = odmXml.matchAll(/<SubjectData[^>]*SubjectKey="([^"]*)"[^>]*>/g);

    for (const match of subjectDataMatches) {
      const subjectKey = match[1];
      subjects.push({
        subjectKey,
        studySubjectId: subjectKey
      });
    }

    return subjects;
  } catch (error: any) {
    logger.error('Failed to parse subject list ODM', { error: error.message });
    return [];
  }
};

export default {
  createSubject,
  isSubjectExists,
  listSubjects,
  parseSubjectListOdm
};

