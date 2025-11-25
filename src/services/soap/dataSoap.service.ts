/**
 * Data SOAP Service
 * 
 * Handles clinical data entry via LibreClinica SOAP API
 * - Import CRF data using ODM XML
 * - Build ODM XML from form data
 * - Validate data entries
 * - Support electronic signatures
 * 
 * SOAP Endpoint: http://localhost:8080/LibreClinica/ws/data/v1
 * Uses ODM 1.3 standard for data interchange
 */

import { getSoapClient } from './soapClient';
import { logger } from '../../config/logger';
import { FormDataRequest, ApiResponse, ValidationError, ElectronicSignature } from '../../types';
import xml2js from 'xml2js';

/**
 * Data import response
 */
interface DataImportResponse {
  success: boolean;
  eventCrfId?: number;
  validationErrors?: ValidationError[];
  warnings?: string[];
  odmResponse?: string;
}

/**
 * Import clinical data via SOAP
 * Main method for saving CRF data
 */
export const importData = async (
  request: FormDataRequest,
  userId: number,
  username: string
): Promise<ApiResponse<DataImportResponse>> => {
  logger.info('Importing clinical data via SOAP', {
    studyId: request.studyId,
    subjectId: request.subjectId,
    crfId: request.crfId,
    userId,
    username
  });

  try {
    // Build ODM XML from form data
    const odmXml = await buildOdmXml(request);

    logger.debug('ODM XML built for data import', {
      subjectId: request.subjectId,
      odmLength: odmXml.length
    });

    // Execute SOAP request
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
      logger.error('Data import failed', {
        error: response.error,
        subjectId: request.subjectId
      });

      return {
        success: false,
        message: response.error || 'Data import failed'
      };
    }

    // Parse response for validation errors
    const parsedResponse = await parseImportResponse(response.data);

    if (parsedResponse.validationErrors && parsedResponse.validationErrors.length > 0) {
      logger.warn('Data import completed with validation errors', {
        subjectId: request.subjectId,
        errorCount: parsedResponse.validationErrors.length
      });

      return {
        success: false,
        message: 'Data import failed validation',
        data: parsedResponse
      };
    }

    logger.info('Data imported successfully', {
      subjectId: request.subjectId,
      eventCrfId: parsedResponse.eventCrfId
    });

    return {
      success: true,
      data: parsedResponse,
      message: 'Data imported successfully'
    };
  } catch (error: any) {
    logger.error('Data import error', {
      error: error.message,
      subjectId: request.subjectId
    });

    return {
      success: false,
      message: `Data import failed: ${error.message}`
    };
  }
};

/**
 * Build ODM XML from form data request
 * Converts JSON form data to ODM 1.3 XML format
 */
export const buildOdmXml = async (request: FormDataRequest): Promise<string> => {
  const {
    studyId,
    subjectId,
    studyEventDefinitionId,
    crfId,
    formData,
    electronicSignature
  } = request;

  // Get study and subject OIDs (you may need to query these from database)
  const studyOid = `S_${studyId}`;
  const subjectOid = `SS_${subjectId}`;
  const eventOid = `SE_${studyEventDefinitionId}`;
  const formOid = `F_${crfId}`;

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
      <StudyEventData StudyEventOID="${eventOid}" StudyEventRepeatKey="1">
        <FormData FormOID="${formOid}">`;

  // Build item groups and items from form data
  for (const [itemGroupOid, items] of Object.entries(formData)) {
    if (typeof items === 'object' && items !== null) {
      odmXml += `
          <ItemGroupData ItemGroupOID="${itemGroupOid}" ItemGroupRepeatKey="1">`;

      for (const [itemOid, value] of Object.entries(items)) {
        const escapedValue = escapeXml(String(value));
        odmXml += `
            <ItemData ItemOID="${itemOid}" Value="${escapedValue}"/>`;
      }

      odmXml += `
          </ItemGroupData>`;
    }
  }

  odmXml += `
        </FormData>`;

  // Add electronic signature if provided
  if (electronicSignature) {
    odmXml += buildElectronicSignatureXml(electronicSignature, timestamp);
  }

  odmXml += `
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

  return odmXml;
};

/**
 * Build electronic signature XML section
 */
function buildElectronicSignatureXml(
  signature: ElectronicSignature,
  timestamp: string
): string {
  const { username, meaning } = signature;

  return `
        <AuditRecord>
          <UserRef UserOID="${username}"/>
          <LocationRef LocationOID="API"/>
          <DateTimeStamp>${timestamp}</DateTimeStamp>
          <ReasonForChange>Electronic Signature: ${meaning}</ReasonForChange>
          <SourceID>${username}</SourceID>
        </AuditRecord>`;
}

/**
 * Parse data import response from SOAP
 */
export const parseImportResponse = async (
  responseData: any
): Promise<DataImportResponse> => {
  try {
    const result: DataImportResponse = {
      success: true,
      validationErrors: [],
      warnings: []
    };

    // If response is string (ODM XML), parse it
    if (typeof responseData === 'string') {
      result.odmResponse = responseData;

      // Parse for errors and warnings
      const parser = new xml2js.Parser();
      const parsed = await parser.parseStringPromise(responseData);

      // Check for validation errors in response
      if (parsed.ODM?.ClinicalData) {
        const clinicalData = parsed.ODM.ClinicalData[0];

        // Extract event CRF ID if available
        if (clinicalData.SubjectData?.[0]?.StudyEventData?.[0]?.FormData?.[0]?.$?.EventCRFOID) {
          result.eventCrfId = parseInt(
            clinicalData.SubjectData[0].StudyEventData[0].FormData[0].$.EventCRFOID.replace('EC_', '')
          );
        }

        // Check for errors
        if (clinicalData.Errors) {
          result.validationErrors = parseValidationErrors(clinicalData.Errors);
        }

        // Check for warnings
        if (clinicalData.Warnings) {
          result.warnings = parseWarnings(clinicalData.Warnings);
        }
      }
    } else if (responseData.result) {
      result.success = responseData.result === 'Success';
      result.eventCrfId = responseData.eventCrfId;
    }

    return result;
  } catch (error: any) {
    logger.error('Failed to parse import response', { error: error.message });
    return {
      success: false,
      validationErrors: [{
        itemOid: 'unknown',
        message: 'Failed to parse response',
        severity: 'error'
      }]
    };
  }
};

/**
 * Parse validation errors from ODM response
 */
function parseValidationErrors(errors: any): ValidationError[] {
  const validationErrors: ValidationError[] = [];

  try {
    if (Array.isArray(errors)) {
      for (const error of errors) {
        validationErrors.push({
          itemOid: error.ItemOID || 'unknown',
          message: error.Message || error.message || 'Validation error',
          severity: 'error'
        });
      }
    } else if (errors.Error) {
      const errorList = Array.isArray(errors.Error) ? errors.Error : [errors.Error];
      for (const error of errorList) {
        validationErrors.push({
          itemOid: error.$.ItemOID || 'unknown',
          message: error._ || error.Message || 'Validation error',
          severity: 'error'
        });
      }
    }
  } catch (error: any) {
    logger.error('Failed to parse validation errors', { error: error.message });
  }

  return validationErrors;
}

/**
 * Parse warnings from ODM response
 */
function parseWarnings(warnings: any): string[] {
  const warningList: string[] = [];

  try {
    if (Array.isArray(warnings)) {
      warningList.push(...warnings.map(w => w.Message || w.toString()));
    } else if (warnings.Warning) {
      const warnArray = Array.isArray(warnings.Warning) ? warnings.Warning : [warnings.Warning];
      warningList.push(...warnArray.map((w: any) => w._ || w.Message || w.toString()));
    }
  } catch (error: any) {
    logger.error('Failed to parse warnings', { error: error.message });
  }

  return warningList;
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

/**
 * Build ODM XML for a single item data entry
 */
export const buildItemDataOdm = (
  studyOid: string,
  subjectOid: string,
  eventOid: string,
  formOid: string,
  itemGroupOid: string,
  itemOid: string,
  value: string
): string => {
  const timestamp = new Date().toISOString();
  const escapedValue = escapeXml(value);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     ODMVersion="1.3"
     FileType="Transactional"
     FileOID="ODM-${Date.now()}"
     CreationDateTime="${timestamp}">
  <ClinicalData StudyOID="${studyOid}" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="${subjectOid}">
      <StudyEventData StudyEventOID="${eventOid}" StudyEventRepeatKey="1">
        <FormData FormOID="${formOid}">
          <ItemGroupData ItemGroupOID="${itemGroupOid}" ItemGroupRepeatKey="1">
            <ItemData ItemOID="${itemOid}" Value="${escapedValue}"/>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;
};

/**
 * Validate ODM XML structure
 */
export const validateOdmStructure = (odmXml: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check for required elements
  if (!odmXml.includes('<ODM')) {
    errors.push('Missing ODM root element');
  }

  if (!odmXml.includes('<ClinicalData')) {
    errors.push('Missing ClinicalData element');
  }

  if (!odmXml.includes('<SubjectData')) {
    errors.push('Missing SubjectData element');
  }

  // Check for well-formed XML
  try {
    const parser = new xml2js.Parser();
    parser.parseString(odmXml, (err) => {
      if (err) {
        errors.push(`XML parsing error: ${err.message}`);
      }
    });
  } catch (error: any) {
    errors.push(`Invalid XML structure: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export default {
  importData,
  buildOdmXml,
  parseImportResponse,
  buildItemDataOdm,
  validateOdmStructure
};

