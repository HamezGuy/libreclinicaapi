/**
 * SOAP Client
 * 
 * Base SOAP client for LibreClinica Web Services
 * - Handles SOAP authentication (WS-Security)
 * - Provides retry logic and error handling
 * - Supports ODM 1.3 standard
 * - Logs all SOAP operations for audit
 * 
 * LibreClinica SOAP Web Services (at /ws/ - confirmed from web.xml):
 * - Study Service: http://localhost:8080/LibreClinica/ws/study/v1
 * - StudySubject Service: http://localhost:8080/LibreClinica/ws/studySubject/v1
 * - Data Service: http://localhost:8080/LibreClinica/ws/data/v1
 * - Event Service: http://localhost:8080/LibreClinica/ws/event/v1
 * - CRF Service: http://localhost:8080/LibreClinica/ws/crf/v1
 */

import * as soap from 'soap';
import { config } from '../../config/environment';
import { logger } from '../../config/logger';

/**
 * SOAP client configuration
 */
interface SoapClientConfig {
  baseUrl: string;
  username: string;
  password: string;
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
 * SOAP Client Class
 */
export class SoapClient {
  private config: SoapClientConfig;
  private clients: Map<string, any> = new Map();

  constructor() {
    this.config = {
      // LibreClinica SOAP is at /ws/ (confirmed from web.xml servlet mapping)
      baseUrl: config.libreclinica.soapUrl || 'http://localhost:8080/LibreClinica/ws',
      username: config.libreclinica.soapUsername || 'root',
      password: config.libreclinica.soapPassword || 'root',
      timeout: 30000, // 30 seconds
      maxRetries: 3
    };
  }

  /**
   * Get WSDL URL for a service
   * LibreClinica SOAP endpoints (at /ws/ - from web.xml):
   * - study/v1 - Study metadata
   * - studySubject/v1 - Subject enrollment
   * - event/v1 - Event scheduling  
   * - crf/v1 - CRF/Form data import
   */
  private getWsdlUrl(serviceName: string): string {
    const wsdlUrls: Record<string, string> = {
      study: `${this.config.baseUrl}/study/v1?wsdl`,
      studySubject: `${this.config.baseUrl}/studySubject/v1?wsdl`,
      event: `${this.config.baseUrl}/event/v1?wsdl`,
      data: `${this.config.baseUrl}/data/v1?wsdl`,
      studyEventDefinition: `${this.config.baseUrl}/studyEventDefinition/v1?wsdl`,
      // Legacy aliases
      subject: `${this.config.baseUrl}/studySubject/v1?wsdl`,
      crf: `${this.config.baseUrl}/data/v1?wsdl`
    };

    return wsdlUrls[serviceName] || wsdlUrls.studySubject;
  }

  /**
   * Create or get cached SOAP client for a service
   */
  private async getClient(serviceName: string): Promise<any> {
    // Return cached client if available
    if (this.clients.has(serviceName)) {
      return this.clients.get(serviceName);
    }

    const wsdlUrl = this.getWsdlUrl(serviceName);

    try {
      logger.debug(`Creating SOAP client for ${serviceName}`, { wsdlUrl });

      // WSDL fetch requires HTTP Basic Auth
      const basicAuth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      
      const client = await soap.createClientAsync(wsdlUrl, {
        endpoint: wsdlUrl.replace('?wsdl', ''),
        wsdl_options: {
          timeout: this.config.timeout
        },
        wsdl_headers: {
          Authorization: `Basic ${basicAuth}`
        }
      });

      // Add WS-Security header for SOAP requests
      const wsSecurity = new soap.WSSecurity(
        this.config.username,
        this.config.password,
        {
          hasTimeStamp: false,
          hasTokenCreated: false
        }
      );

      client.setSecurity(wsSecurity);

      // Cache the client
      this.clients.set(serviceName, client);

      logger.info(`SOAP client created for ${serviceName}`);

      return client;
    } catch (error: any) {
      logger.error(`Failed to create SOAP client for ${serviceName}`, {
        error: error.message,
        wsdlUrl
      });
      throw new Error(`SOAP client creation failed: ${error.message}`);
    }
  }

  /**
   * Execute SOAP request with retry logic
   */
  public async executeRequest<T>(
    options: SoapRequestOptions
  ): Promise<SoapResponse<T>> {
    const { serviceName, methodName, parameters, userId, username } = options;

    logger.info('Executing SOAP request', {
      serviceName,
      methodName,
      userId,
      username
    });

    let lastError: any;

    // Retry logic
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const client = await this.getClient(serviceName);

        // Execute SOAP method
        const startTime = Date.now();
        const [result] = await client[`${methodName}Async`](parameters);
        const duration = Date.now() - startTime;

        logger.info('SOAP request successful', {
          serviceName,
          methodName,
          duration,
          attempt
        });

        return {
          success: true,
          data: result
        };
      } catch (error: any) {
        lastError = error;

        logger.warn(`SOAP request failed (attempt ${attempt}/${this.config.maxRetries})`, {
          serviceName,
          methodName,
          error: error.message,
          attempt
        });

        // Don't retry on certain errors
        if (error.message.includes('Authentication') || error.message.includes('Authorization')) {
          break;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries) {
          await this.delay(attempt * 1000);
        }
      }
    }

    // All retries failed
    logger.error('SOAP request failed after all retries', {
      serviceName,
      methodName,
      error: lastError.message
    });

    return {
      success: false,
      error: lastError.message,
      soapFault: lastError.root
    };
  }

  /**
   * Test SOAP connection
   */
  public async testConnection(serviceName: string = 'study'): Promise<boolean> {
    try {
      const client = await this.getClient(serviceName);
      logger.info(`SOAP connection test successful for ${serviceName}`);
      return true;
    } catch (error: any) {
      logger.error(`SOAP connection test failed for ${serviceName}`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Clear cached clients (useful for reconnection)
   */
  public clearClients(): void {
    this.clients.clear();
    logger.info('SOAP clients cache cleared');
  }

  /**
   * Build WS-Security header manually (alternative authentication)
   */
  private buildAuthHeader(): string {
    const timestamp = new Date().toISOString();
    
    return `
      <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
        <wsse:UsernameToken>
          <wsse:Username>${this.config.username}</wsse:Username>
          <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">
            ${this.config.password}
          </wsse:Password>
        </wsse:UsernameToken>
      </wsse:Security>
    `;
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse SOAP fault/error
   */
  public parseSoapError(error: any): string {
    if (error.root?.Envelope?.Body?.Fault) {
      const fault = error.root.Envelope.Body.Fault;
      return fault.faultstring || fault.faultcode || 'SOAP Fault occurred';
    }

    if (error.message) {
      return error.message;
    }

    return 'Unknown SOAP error occurred';
  }

  /**
   * Validate ODM response
   * Checks for errors in ODM XML response
   */
  public validateOdmResponse(odmXml: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for empty response
    if (!odmXml || odmXml.trim() === '') {
      errors.push('Empty ODM response received');
      return { isValid: false, errors };
    }

    // Check for error messages in ODM
    if (odmXml.includes('<Error>') || odmXml.includes('<error>')) {
      errors.push('ODM contains error elements');
    }

    // Check for validation errors
    if (odmXml.includes('ValidationError')) {
      errors.push('ODM validation errors present');
    }

    return {
      isValid: errors.length === 0,
      errors
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
 * Reset SOAP client singleton (useful for testing)
 */
export const resetSoapClient = (): void => {
  if (soapClientInstance) {
    soapClientInstance.clearClients();
  }
  soapClientInstance = null;
};

export default getSoapClient;

