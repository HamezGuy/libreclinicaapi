/**
 * SOAP Client
 * 
 * Custom SOAP client for LibreClinica Web Services
 * - Uses raw HTTP with WS-Security headers (LibreClinica specific)
 * - Handles authentication with MD5-hashed passwords
 * - Provides retry logic and error handling
 * 
 * LibreClinica SOAP Web Services (at /libreclinica-ws/ws):
 * - Study Service: Uses v1:listAllRequest, v1:getMetadataRequest
 * - StudySubject Service: Uses v1:createRequest, v1:listAllByStudyRequest
 * - Data Service: Uses v1:importRequest
 * - Event Service: Uses v1:scheduleRequest
 * 
 * IMPORTANT: LibreClinica requires WS-Security UsernameToken with MD5-hashed password!
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../../config/environment';
import { logger } from '../../config/logger';
import { parseStringPromise } from 'xml2js';

/**
 * SOAP client configuration
 */
interface SoapClientConfig {
  baseUrl: string;
  username: string;
  password: string; // MD5 hash of actual password
  timeout: number;
  maxRetries: number;
}

/**
 * SOAP request options
 */
interface SoapRequestOptions {
  serviceName: 'study' | 'studySubject' | 'data' | 'event';
  methodName: string;
  parameters: any;
  userId?: number;
  username?: string;
}

/**
 * SOAP response wrapper
 */
interface SoapResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  soapFault?: any;
}

/**
 * Namespace mappings for LibreClinica SOAP services
 */
const SOAP_NAMESPACES: Record<string, string> = {
  study: 'http://openclinica.org/ws/study/v1',
  studySubject: 'http://openclinica.org/ws/studySubject/v1',
  data: 'http://openclinica.org/ws/data/v1',
  event: 'http://openclinica.org/ws/event/v1'
};

/**
 * SOAP Client Class
 * Custom implementation for LibreClinica's WS-Security requirements
 */
export class SoapClient {
  private config: SoapClientConfig;
  private httpClient: AxiosInstance;

  constructor() {
    // Configuration with MD5-hashed password for WS-Security
    // LibreClinica 1.4: WS-Security improved, reduced timeout/retries needed
    this.config = {
      baseUrl: config.libreclinica.soapUrl || 'http://localhost:8090/libreclinica-ws/ws',
      username: config.libreclinica.soapUsername || 'root',
      password: config.libreclinica.soapPassword || '25d55ad283aa400af464c76d713c07ad',
      timeout: 15000,  // Reduced - LC 1.4 is more responsive with fixed WS-Security
      maxRetries: 2    // Reduced - LC 1.4 WS-Security works reliably now
    };

    // Create HTTP client
    this.httpClient = axios.create({
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'Accept': 'text/xml, application/xml'
      }
    });
  }

  /**
   * Build WS-Security SOAP envelope
   */
  private buildSoapEnvelope(
    serviceName: string, 
    methodName: string, 
    parameters: any
  ): string {
    const namespace = SOAP_NAMESPACES[serviceName];
    
    // Convert parameters to XML elements
    const parametersXml = this.buildParametersXml(parameters);
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:v1="${namespace}"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
   <soapenv:Header>
      <wsse:Security soapenv:mustUnderstand="1">
         <wsse:UsernameToken>
            <wsse:Username>${this.config.username}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.config.password}</wsse:Password>
         </wsse:UsernameToken>
      </wsse:Security>
   </soapenv:Header>
   <soapenv:Body>
      <v1:${methodName}Request>
         ${parametersXml}
      </v1:${methodName}Request>
   </soapenv:Body>
</soapenv:Envelope>`;
  }

  /**
   * Convert parameters object to XML elements
   */
  private buildParametersXml(params: any, prefix: string = 'v1'): string {
    if (!params || Object.keys(params).length === 0) {
      return '';
    }

    let xml = '';
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        // Nested object
        xml += `<${prefix}:${key}>${this.buildParametersXml(value, prefix)}</${prefix}:${key}>`;
      } else if (Array.isArray(value)) {
        // Array - repeat the element
        for (const item of value) {
          if (typeof item === 'object') {
            xml += `<${prefix}:${key}>${this.buildParametersXml(item, prefix)}</${prefix}:${key}>`;
          } else {
            xml += `<${prefix}:${key}>${this.escapeXml(String(item))}</${prefix}:${key}>`;
          }
        }
      } else {
        const strValue = String(value);
        // If the value looks like raw XML (starts with <?xml or <ODM), wrap in CDATA
        // to prevent double-escaping. This is critical for ODM XML import payloads.
        if (strValue.trimStart().startsWith('<?xml') || strValue.trimStart().startsWith('<ODM') || strValue.trimStart().startsWith('<odm')) {
          xml += `<${prefix}:${key}><![CDATA[${strValue}]]></${prefix}:${key}>`;
        } else {
          xml += `<${prefix}:${key}>${this.escapeXml(strValue)}</${prefix}:${key}>`;
        }
      }
    }
    return xml;
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Parse SOAP response
   */
  private async parseSoapResponse(xmlResponse: string): Promise<any> {
    try {
      const result = await parseStringPromise(xmlResponse, {
        explicitArray: false,
        ignoreAttrs: false,
        tagNameProcessors: [(name) => name.replace(/^.*:/, '')]
      });
      
      // Extract body content
      const envelope = result.Envelope || result['SOAP-ENV:Envelope'] || result;
      const body = envelope.Body || envelope['SOAP-ENV:Body'];
      
      if (!body) {
        throw new Error('No SOAP Body found in response');
      }

      // Check for fault
      const fault = body.Fault || body['SOAP-ENV:Fault'];
      if (fault) {
        throw new Error(fault.faultstring || fault.faultcode || 'SOAP Fault');
      }

      // Return first child of body (the response element)
      const bodyKeys = Object.keys(body).filter(k => k !== '$');
      if (bodyKeys.length > 0) {
        return body[bodyKeys[0]];
      }

      return body;
    } catch (error: any) {
      logger.error('Failed to parse SOAP response', { error: error.message });
      throw error;
    }
  }

  /**
   * Execute SOAP request with retry logic
   */
  public async executeRequest<T>(options: SoapRequestOptions): Promise<SoapResponse<T>> {
    const { serviceName, methodName, parameters, userId, username } = options;

    logger.info('Executing SOAP request', {
      serviceName,
      methodName,
      userId,
      username: username || 'system'
    });

    let lastError: any;

    // Retry logic
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const soapEnvelope = this.buildSoapEnvelope(serviceName, methodName, parameters);
        
        // Build the full service URL (e.g., /libreclinica-ws/ws/study/v1)
        const serviceUrl = `${this.config.baseUrl}/${serviceName}/v1`;
        
        logger.debug('SOAP Request', { 
          url: serviceUrl,
          serviceName,
          methodName
        });

        const startTime = Date.now();
        const response = await this.httpClient.post(serviceUrl, soapEnvelope);
        const duration = Date.now() - startTime;

        logger.info('SOAP request successful', {
          serviceName,
          methodName,
          duration,
          attempt,
          status: response.status
        });

        const parsedResponse = await this.parseSoapResponse(response.data);

        return {
          success: true,
          data: parsedResponse
        };
      } catch (error: any) {
        lastError = error;

        const statusCode = error.response?.status;
        const responseData = error.response?.data;

        logger.warn(`SOAP request failed (attempt ${attempt}/${this.config.maxRetries})`, {
          serviceName,
          methodName,
          error: error.message,
          statusCode,
          attempt
        });

        // Don't retry on authentication errors
        if (statusCode === 401 || statusCode === 403) {
          break;
        }

        // Try to parse fault from response
        if (responseData) {
          try {
            const fault = await this.parseSoapResponse(responseData);
            logger.debug('SOAP Fault details', { fault });
          } catch {
            // Ignore parsing errors for fault
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries) {
          await this.delay(attempt * 1000);
        }
      }
    }

    logger.error('SOAP request failed after all retries', {
      serviceName,
      methodName,
      error: lastError.message
    });

    return {
      success: false,
      error: lastError.message,
      soapFault: lastError.response?.data
    };
  }

  /**
   * Test SOAP connection
   * Uses appropriate method for each service type
   */
  public async testConnection(serviceName: string = 'study'): Promise<boolean> {
    try {
      logger.debug('Testing SOAP connection', { serviceName });
      
      // Use 'study' service for testing - it has a simple listAll method
      // studySubject requires study reference which makes it unsuitable for connection testing
      const testService = 'study';
      
      const result = await this.executeRequest({
        serviceName: testService as any,
        methodName: 'listAll',
        parameters: {}
      });

      logger.info(`SOAP connection test: ${result.success ? 'SUCCESS' : 'FAILED'}`, {
        serviceName: testService,
        success: result.success
      });

      return result.success;
    } catch (error: any) {
      logger.error(`SOAP connection test failed`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Clear any cached state (for reconnection)
   */
  public clearClients(): void {
    logger.info('SOAP client state cleared');
    // Nothing to clear with our stateless HTTP approach
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse SOAP error
   */
  public parseSoapError(error: any): string {
    if (error.response?.data) {
      const data = error.response.data;
      if (typeof data === 'string' && data.includes('faultstring')) {
        const match = data.match(/<faultstring>([^<]+)<\/faultstring>/);
        if (match) {
          return match[1];
        }
      }
    }
    return error.message || 'Unknown SOAP error';
  }

  /**
   * Get configuration (for diagnostics)
   */
  public getConfig(): { baseUrl: string; username: string; passwordSet: boolean } {
    return {
      baseUrl: this.config.baseUrl,
      username: this.config.username,
      passwordSet: !!this.config.password
    };
  }
}

/**
 * Singleton instance
 */
let soapClientInstance: SoapClient | null = null;

/**
 * Get SOAP client singleton
 */
export const getSoapClient = (): SoapClient => {
  if (!soapClientInstance) {
    soapClientInstance = new SoapClient();
  }
  return soapClientInstance;
};

/**
 * Reset SOAP client singleton (useful for testing/reconnection)
 */
export const resetSoapClient = (): void => {
  soapClientInstance = null;
};

export default getSoapClient;
