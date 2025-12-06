/**
 * Subject SOAP Service
 * 
 * Handles subject (patient) enrollment via LibreClinica SOAP API
 * - Create new subjects (study participants)
 * - List subjects via SOAP
 * - Check subject existence
 * 
 * SOAP Endpoint: http://localhost:8090/libreclinica-ws/ws/studySubject/v1
 * Service: studySubject (v1)
 * 
 * CRITICAL: LibreClinica requires:
 * - WS-Security UsernameToken with MD5-hashed password
 * - Specific XML element structure for studySubject service
 * - Full service path including /studySubject/v1
 */

import axios from 'axios';
import { config } from '../../config/environment';
import { logger } from '../../config/logger';
import { SubjectCreateRequest, ApiResponse } from '../../types';
import { parseStringPromise } from 'xml2js';

/**
 * SOAP Subject response
 */
interface SoapSubjectResponse {
  result: string;
  label?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Build WS-Security SOAP envelope for studySubject service
 */
function buildSubjectSoapEnvelope(methodName: string, bodyContent: string): string {
  const username = config.libreclinica.soapUsername || 'root';
  const password = config.libreclinica.soapPassword || '25d55ad283aa400af464c76d713c07ad';
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:v1="http://openclinica.org/ws/studySubject/v1"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
   <soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1">
         <wsse:UsernameToken>
            <wsse:Username>${username}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
         </wsse:UsernameToken>
      </wsse:Security>
   </soapenv:Header>
   <soapenv:Body>
      ${bodyContent}
   </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Execute SOAP request to LibreClinica studySubject service
 * FIXED: Now includes the correct service path /studySubject/v1
 */
async function executeSoapRequest(envelope: string): Promise<any> {
  const baseUrl = config.libreclinica.soapUrl || 'http://localhost:8090/libreclinica-ws/ws';
  // CRITICAL FIX: Append the studySubject service path
  const serviceUrl = `${baseUrl}/studySubject/v1`;
  
  logger.debug('Executing SOAP request to studySubject service', { url: serviceUrl });
  
  // LibreClinica 1.4: WS-Security improved, reduced timeout works better
  const response = await axios.post(serviceUrl, envelope, {
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      'Accept': 'text/xml, application/xml'
    },
    timeout: 15000
  });
  
  // Parse XML response
  const result = await parseStringPromise(response.data, {
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [(name) => name.replace(/^.*:/, '')]
  });
  
  // Extract body content
  const envelope_response = result.Envelope || result['SOAP-ENV:Envelope'];
  const body = envelope_response?.Body || envelope_response?.['SOAP-ENV:Body'];
  
  return body;
}

/**
 * Get study OID from study ID or identifier
 */
async function getStudyIdentifier(studyId: number): Promise<string> {
  // For now, use the default study identifier
  // In production, query the database to get the correct identifier
  return 'default-study';
}

/**
 * Subject enrollment via SOAP
 * Uses the studySubject/create operation
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
    // Get study identifier
    const studyIdentifier = await getStudyIdentifier(request.studyId);
    
    // Build subject create request body
    const gender = request.gender === 'Male' || request.gender === 'm' ? 'm' : 
                   request.gender === 'Female' || request.gender === 'f' ? 'f' : '';
    
    const bodyContent = `
      <v1:createRequest>
         <v1:studySubject>
            <v1:label>${escapeXml(request.studySubjectId)}</v1:label>
            <v1:secondaryLabel>${escapeXml(request.secondaryId || '')}</v1:secondaryLabel>
            <v1:enrollmentDate>${request.enrollmentDate || new Date().toISOString().split('T')[0]}</v1:enrollmentDate>
            <v1:subject>
               <v1:uniqueIdentifier>${escapeXml(request.studySubjectId)}</v1:uniqueIdentifier>
               ${gender ? `<v1:gender>${gender}</v1:gender>` : ''}
               ${request.dateOfBirth ? `<v1:dateOfBirth>${request.dateOfBirth}</v1:dateOfBirth>` : ''}
            </v1:subject>
            <v1:studyRef>
               <v1:identifier>${escapeXml(studyIdentifier)}</v1:identifier>
            </v1:studyRef>
         </v1:studySubject>
      </v1:createRequest>`;

    const envelope = buildSubjectSoapEnvelope('create', bodyContent);
    
    logger.debug('SOAP createSubject request built');
    
    const body = await executeSoapRequest(envelope);
    
    // Parse response
    const createResponse = body.createResponse || body['createResponse'];
    
    if (!createResponse) {
      logger.error('No createResponse in SOAP body', { body });
      return {
        success: false,
        message: 'Invalid SOAP response format'
      };
    }
    
    const result = createResponse.result || createResponse['result'];
    const label = createResponse.label || createResponse['label'];
    const error = createResponse.error || createResponse['error'];
    
    if (result === 'Success') {
      logger.info('Subject created successfully via SOAP', {
        studySubjectId: request.studySubjectId,
        label
      });

      return {
        success: true,
        data: {
          result: 'success',
          label: label || request.studySubjectId
        },
        message: 'Subject created successfully via SOAP'
      };
    } else {
      logger.warn('SOAP subject creation returned failure', { result, error });
      
      return {
        success: false,
        data: { result: 'fail', error },
        message: error || 'SOAP subject creation failed'
      };
    }
  } catch (error: any) {
    logger.error('Subject creation SOAP error', {
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
    const bodyContent = `
      <v1:isStudySubjectRequest>
         <v1:studySubject>
            <v1:label>${escapeXml(subjectLabel)}</v1:label>
            <v1:studyRef>
               <v1:identifier>${escapeXml(studyOid)}</v1:identifier>
            </v1:studyRef>
         </v1:studySubject>
      </v1:isStudySubjectRequest>`;

    const envelope = buildSubjectSoapEnvelope('isStudySubject', bodyContent);
    const body = await executeSoapRequest(envelope);
    
    const response = body.isStudySubjectResponse || body['isStudySubjectResponse'];
    const result = response?.result;
    
    const exists = result === 'true' || result === true;

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
 * List subjects in study via SOAP
 */
export const listSubjects = async (
  studyIdentifier: string,
  userId: number,
  username: string
): Promise<ApiResponse<any[]>> => {
  logger.info('Listing subjects via SOAP', {
    studyIdentifier,
    userId
  });

  try {
    const bodyContent = `
      <v1:listAllByStudyRequest>
         <v1:studyRef>
            <v1:identifier>${escapeXml(studyIdentifier)}</v1:identifier>
         </v1:studyRef>
      </v1:listAllByStudyRequest>`;

    const envelope = buildSubjectSoapEnvelope('listAllByStudy', bodyContent);
    const body = await executeSoapRequest(envelope);
    
    const response = body.listAllByStudyResponse || body['listAllByStudyResponse'];
    
    if (!response) {
      return {
        success: false,
        message: 'Invalid SOAP response'
      };
    }
    
    const result = response.result;
    
    if (result === 'Success') {
      // Parse subjects from response
      const subjects = parseSubjectsFromResponse(response);
      
      return {
        success: true,
        data: subjects,
        message: 'Subjects listed successfully'
      };
    }
    
    return {
      success: false,
      message: response.error || 'Failed to list subjects'
    };
  } catch (error: any) {
    logger.error('Subject listing error', {
      error: error.message,
      studyIdentifier
    });

    return {
      success: false,
      message: `Failed to list subjects: ${error.message}`
    };
  }
};

/**
 * Parse subjects from SOAP response
 */
function parseSubjectsFromResponse(response: any): any[] {
  const subjects: any[] = [];
  
  try {
    const studySubjects = response.studySubjects?.studySubject || response.studySubject;
    
    if (studySubjects) {
      const subjectArray = Array.isArray(studySubjects) ? studySubjects : [studySubjects];
      
      for (const subject of subjectArray) {
        subjects.push({
          label: subject.label,
          secondaryLabel: subject.secondaryLabel,
          enrollmentDate: subject.enrollmentDate,
          status: subject.status,
          studyRef: subject.studyRef?.identifier
        });
      }
    }
  } catch (error: any) {
    logger.warn('Failed to parse subjects from SOAP response', { error: error.message });
  }
  
  return subjects;
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse subject list from ODM XML response
 */
export function parseSubjectListOdm(odmXml: string): any[] {
  const subjects: any[] = [];
  
  try {
    // Simple XML parsing for subject data
    const subjectMatches = odmXml.match(/<SubjectData[^>]*SubjectKey="([^"]*)"[^>]*>/g);
    
    if (subjectMatches) {
      for (const match of subjectMatches) {
        const keyMatch = match.match(/SubjectKey="([^"]*)"/);
        if (keyMatch) {
          subjects.push({
            label: keyMatch[1],
            studySubjectId: keyMatch[1]
          });
        }
      }
    }
  } catch (error: any) {
    logger.warn('Failed to parse ODM XML', { error: error.message });
  }
  
  return subjects;
}

export default {
  createSubject,
  isSubjectExists,
  listSubjects,
  parseSubjectListOdm
};
