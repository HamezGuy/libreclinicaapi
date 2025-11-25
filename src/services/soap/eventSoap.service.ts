/**
 * Event SOAP Service
 * 
 * Handles study event operations via LibreClinica SOAP API
 * - Schedule study events for subjects
 * - Create event instances
 * - Update event status
 * 
 * SOAP Endpoint: http://localhost:8080/LibreClinica/ws/studyEvent/v1
 */

import { getSoapClient } from './soapClient';
import { logger } from '../../config/logger';
import { ApiResponse } from '../../types';

/**
 * Event schedule request
 */
interface EventScheduleRequest {
  studyId: number;
  subjectId: number;
  studyEventDefinitionId: number;
  startDate?: string;
  endDate?: string;
  location?: string;
}

/**
 * Schedule a study event for a subject
 */
export const scheduleEvent = async (
  request: EventScheduleRequest,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Scheduling study event via SOAP', {
    studyId: request.studyId,
    subjectId: request.subjectId,
    eventDefinitionId: request.studyEventDefinitionId,
    userId,
    username
  });

  try {
    const odmXml = buildScheduleEventOdm(request);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'event',
      methodName: 'schedule',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      logger.error('Event scheduling failed', {
        error: response.error,
        subjectId: request.subjectId,
        eventDefinitionId: request.studyEventDefinitionId
      });

      return {
        success: false,
        message: response.error || 'Failed to schedule event'
      };
    }

    logger.info('Event scheduled successfully', {
      subjectId: request.subjectId,
      eventDefinitionId: request.studyEventDefinitionId
    });

    return {
      success: true,
      data: response.data,
      message: 'Event scheduled successfully'
    };
  } catch (error: any) {
    logger.error('Event scheduling error', {
      error: error.message,
      subjectId: request.subjectId
    });

    return {
      success: false,
      message: `Event scheduling failed: ${error.message}`
    };
  }
};

/**
 * Create a new event instance
 */
export const createEvent = async (
  studyOid: string,
  subjectOid: string,
  eventOid: string,
  userId: number,
  username: string
): Promise<ApiResponse<any>> => {
  logger.info('Creating study event via SOAP', {
    studyOid,
    subjectOid,
    eventOid,
    userId
  });

  try {
    const odmXml = buildCreateEventOdm(studyOid, subjectOid, eventOid);

    const soapClient = getSoapClient();
    const response = await soapClient.executeRequest<any>({
      serviceName: 'event',
      methodName: 'create',
      parameters: {
        odm: odmXml
      },
      userId,
      username
    });

    if (!response.success) {
      return {
        success: false,
        message: response.error || 'Failed to create event'
      };
    }

    logger.info('Event created successfully', {
      eventOid
    });

    return {
      success: true,
      data: response.data,
      message: 'Event created successfully'
    };
  } catch (error: any) {
    logger.error('Event creation error', {
      error: error.message,
      eventOid
    });

    return {
      success: false,
      message: `Event creation failed: ${error.message}`
    };
  }
};

/**
 * Build ODM XML for event scheduling
 */
function buildScheduleEventOdm(request: EventScheduleRequest): string {
  const {
    studyId,
    subjectId,
    studyEventDefinitionId,
    startDate,
    endDate,
    location
  } = request;

  const studyOid = `S_${studyId}`;
  const subjectOid = `SS_${subjectId}`;
  const eventOid = `SE_${studyEventDefinitionId}`;
  const timestamp = new Date().toISOString();

  let odmXml = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="ODM-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectOid}">
      <StudyEventData StudyEventOID="${eventOid}" StudyEventRepeatKey="1">`;

  if (startDate) {
    odmXml += `
        <OpenClinica:StartDate>${startDate}</OpenClinica:StartDate>`;
  }

  if (endDate) {
    odmXml += `
        <OpenClinica:EndDate>${endDate}</OpenClinica:EndDate>`;
  }

  if (location) {
    odmXml += `
        <OpenClinica:Location>${escapeXml(location)}</OpenClinica:Location>`;
  }

  odmXml += `
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

  return odmXml;
}

/**
 * Build ODM XML for event creation
 */
function buildCreateEventOdm(
  studyOid: string,
  subjectOid: string,
  eventOid: string
): string {
  const timestamp = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="ODM-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectOid}">
      <StudyEventData StudyEventOID="${eventOid}" StudyEventRepeatKey="1">
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;
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
  scheduleEvent,
  createEvent
};

