/**
 * Mock SOAP Client for Unit Testing
 * 
 * Provides a mock implementation of the SOAP client that can be used
 * to test SOAP services without requiring a real server connection.
 * 
 * Usage:
 *   import { mockSoapClient, setupSoapMocks } from './mocks/soap-mock-client';
 *   
 *   beforeAll(() => {
 *     setupSoapMocks();
 *   });
 */

import { jest } from '@jest/globals';

// =============================================================================
// Mock Response Data
// =============================================================================

export const mockStudyMetadataOdm = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" ODMVersion="1.3" FileType="Snapshot">
  <Study OID="S_1">
    <GlobalVariables>
      <StudyName>Test Study</StudyName>
      <StudyDescription>Test study for automated tests</StudyDescription>
      <ProtocolName>TEST-STUDY-001</ProtocolName>
    </GlobalVariables>
    <MetaDataVersion OID="v1.0.0" Name="Version 1.0">
      <StudyEventDef OID="SE_SCREENING" Name="Screening Visit" Repeating="No" Type="Scheduled"/>
      <StudyEventDef OID="SE_BASELINE" Name="Baseline Visit" Repeating="No" Type="Scheduled"/>
      <FormDef OID="F_DEMOGRAPHICS" Name="Demographics" Repeating="No"/>
      <FormDef OID="F_VITALS" Name="Vital Signs" Repeating="No"/>
    </MetaDataVersion>
  </Study>
</ODM>`;

export const mockStudyListResponse = {
  studies: {
    study: [
      { oid: 'S_1', identifier: 'TEST-STUDY-001', name: 'Test Study', status: 'available' },
      { oid: 'S_2', identifier: 'DEMO-STUDY', name: 'Demo Study', status: 'available' }
    ]
  }
};

export const mockSubjectListOdm = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" ODMVersion="1.3" FileType="Snapshot">
  <ClinicalData StudyOID="S_1" MetaDataVersionOID="v1.0.0">
    <SubjectData SubjectKey="SS_1">
      <StudySubjectID>SUBJ-001</StudySubjectID>
      <EnrollmentDate>2024-01-15</EnrollmentDate>
      <Sex>M</Sex>
    </SubjectData>
    <SubjectData SubjectKey="SS_2">
      <StudySubjectID>SUBJ-002</StudySubjectID>
      <EnrollmentDate>2024-01-20</EnrollmentDate>
      <Sex>F</Sex>
    </SubjectData>
  </ClinicalData>
</ODM>`;

// =============================================================================
// Mock SOAP Client Class
// =============================================================================

export class MockSoapClient {
  private config: any;
  private shouldFail: boolean = false;
  private failureMessage: string = '';
  private responseOverrides: Map<string, any> = new Map();

  constructor() {
    this.config = {
      baseUrl: 'http://localhost:8089/LibreClinica/ws',
      username: 'root',
      password: 'root',
      timeout: 30000,
      maxRetries: 1
    };
  }

  /**
   * Set mock to fail all requests
   */
  public setFailMode(fail: boolean, message: string = 'Mock SOAP error'): void {
    this.shouldFail = fail;
    this.failureMessage = message;
  }

  /**
   * Override response for specific service/method
   */
  public setResponseOverride(serviceMethod: string, response: any): void {
    this.responseOverrides.set(serviceMethod, response);
  }

  /**
   * Clear all response overrides
   */
  public clearOverrides(): void {
    this.responseOverrides.clear();
    this.shouldFail = false;
  }

  /**
   * Execute mock SOAP request
   */
  public async executeRequest<T>(options: {
    serviceName: string;
    methodName: string;
    parameters: any;
    userId?: number;
    username?: string;
  }): Promise<{ success: boolean; data?: T; error?: string }> {
    const { serviceName, methodName, parameters } = options;
    const key = `${serviceName}.${methodName}`;

    // Check for failure mode
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureMessage
      };
    }

    // Check for override
    if (this.responseOverrides.has(key)) {
      return {
        success: true,
        data: this.responseOverrides.get(key)
      };
    }

    // Return default mock responses based on service/method
    return this.getDefaultResponse(serviceName, methodName, parameters);
  }

  /**
   * Get default mock response for service/method
   */
  private getDefaultResponse(serviceName: string, methodName: string, parameters: any): any {
    switch (serviceName) {
      case 'study':
        return this.getStudyResponse(methodName, parameters);
      case 'studySubject':
        return this.getSubjectResponse(methodName, parameters);
      case 'event':
        return this.getEventResponse(methodName, parameters);
      case 'data':
        return this.getDataResponse(methodName, parameters);
      default:
        return { success: true, data: {} };
    }
  }

  private getStudyResponse(methodName: string, parameters: any): any {
    switch (methodName) {
      case 'getMetadata':
        return {
          success: true,
          data: { odm: mockStudyMetadataOdm }
        };
      case 'listAll':
        return {
          success: true,
          data: mockStudyListResponse
        };
      default:
        return { success: true, data: {} };
    }
  }

  private getSubjectResponse(methodName: string, parameters: any): any {
    switch (methodName) {
      case 'create':
        return {
          success: true,
          data: { result: 'success', subjectKey: `SS_${Date.now()}` }
        };
      case 'isStudySubject':
        return {
          success: true,
          data: { result: 'true' }
        };
      case 'listAll':
        return {
          success: true,
          data: { odm: mockSubjectListOdm }
        };
      default:
        return { success: true, data: {} };
    }
  }

  private getEventResponse(methodName: string, parameters: any): any {
    switch (methodName) {
      case 'schedule':
      case 'create':
        return {
          success: true,
          data: { result: 'success', eventId: Math.floor(Math.random() * 1000) + 1 }
        };
      default:
        return { success: true, data: {} };
    }
  }

  private getDataResponse(methodName: string, parameters: any): any {
    switch (methodName) {
      case 'importODM':
        return {
          success: true,
          data: { result: 'Success', eventCrfId: Math.floor(Math.random() * 10000) + 1 }
        };
      default:
        return { success: true, data: {} };
    }
  }

  /**
   * Test connection (always succeeds in mock)
   */
  public async testConnection(serviceName: string = 'study'): Promise<boolean> {
    return !this.shouldFail;
  }

  /**
   * Clear clients (no-op in mock)
   */
  public clearClients(): void {
    // No-op
  }

  /**
   * Parse SOAP error
   */
  public parseSoapError(error: any): string {
    return error?.message || 'Mock SOAP error';
  }

  /**
   * Validate ODM response
   */
  public validateOdmResponse(odmXml: string): { isValid: boolean; errors: string[] } {
    if (!odmXml || odmXml.trim() === '') {
      return { isValid: false, errors: ['Empty ODM response'] };
    }
    return { isValid: true, errors: [] };
  }
}

// =============================================================================
// Singleton & Setup Functions
// =============================================================================

// Mock instance for direct use
export const mockSoapClient = new MockSoapClient();

// Original module reference for mocking
let originalSoapClientModule: any = null;

/**
 * Setup SOAP mocks by replacing the real SOAP client module
 * Call this in beforeAll() of your test
 */
export function setupSoapMocks(): void {
  // Mock the getSoapClient function to return our mock
  jest.mock('../../src/services/soap/soapClient', () => ({
    getSoapClient: () => mockSoapClient,
    resetSoapClient: () => mockSoapClient.clearOverrides(),
    SoapClient: MockSoapClient
  }));
}

/**
 * Reset mock state between tests
 */
export function resetSoapMocks(): void {
  mockSoapClient.clearOverrides();
}

/**
 * Configure mock to simulate failures
 */
export function setSoapFailure(shouldFail: boolean, message?: string): void {
  mockSoapClient.setFailMode(shouldFail, message);
}

/**
 * Set custom response for a specific SOAP call
 */
export function setSoapResponse(service: string, method: string, response: any): void {
  mockSoapClient.setResponseOverride(`${service}.${method}`, response);
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a test study in the mock
 */
export function createMockStudy(studyId: number, name: string): void {
  const studyOid = `S_${studyId}`;
  setSoapResponse('study', 'getMetadata', {
    odm: mockStudyMetadataOdm.replace('S_1', studyOid).replace('Test Study', name)
  });
}

/**
 * Create a test subject in the mock
 */
export function createMockSubject(studyId: number, subjectId: string): void {
  setSoapResponse('studySubject', 'create', {
    result: 'success',
    subjectKey: `SS_${subjectId}`
  });
}

/**
 * Simulate SOAP connection failure
 */
export function simulateConnectionFailure(): void {
  setSoapFailure(true, 'SOAP connection failed: ECONNREFUSED');
}

/**
 * Simulate authentication failure
 */
export function simulateAuthFailure(): void {
  setSoapFailure(true, 'Authentication failed: Invalid credentials');
}

export default mockSoapClient;

