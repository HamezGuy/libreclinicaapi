/**
 * SOAP Services Unit Tests
 * 
 * Comprehensive tests for all SOAP service modules
 * Uses mock SOAP client - no real server required
 * 
 * Tests cover:
 * - soapClient.ts - Base SOAP client
 * - studySoap.service.ts - Study metadata operations
 * - subjectSoap.service.ts - Subject enrollment operations
 * - eventSoap.service.ts - Event scheduling operations
 * - dataSoap.service.ts - Clinical data import operations
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import { MockSoapClient, mockStudyMetadataOdm, mockSubjectListOdm, mockStudyListResponse } from './mocks/soap-mock-client';

// =============================================================================
// Mock Setup
// =============================================================================

// Create mock client instance
const mockClient = new MockSoapClient();

// Mock the soapClient module
jest.mock('../src/services/soap/soapClient', () => ({
  getSoapClient: () => mockClient,
  resetSoapClient: jest.fn(),
  SoapClient: MockSoapClient
}));

// =============================================================================
// Import services AFTER mocking
// =============================================================================

import * as studySoapService from '../src/services/soap/studySoap.service';
import * as subjectSoapService from '../src/services/soap/subjectSoap.service';
import * as eventSoapService from '../src/services/soap/eventSoap.service';
import * as dataSoapService from '../src/services/soap/dataSoap.service';

// =============================================================================
// SOAP Client Tests
// =============================================================================

describe('SOAP Client (Mock)', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  describe('executeRequest', () => {
    it('should execute SOAP request successfully', async () => {
      const result = await mockClient.executeRequest({
        serviceName: 'study',
        methodName: 'getMetadata',
        parameters: { studyOid: 'S_1' },
        userId: 1,
        username: 'root'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return error when in fail mode', async () => {
      mockClient.setFailMode(true, 'Connection failed');

      const result = await mockClient.executeRequest({
        serviceName: 'study',
        methodName: 'getMetadata',
        parameters: { studyOid: 'S_1' },
        userId: 1,
        username: 'root'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    it('should use response override when set', async () => {
      const customResponse = { custom: 'data' };
      mockClient.setResponseOverride('study.getMetadata', customResponse);

      const result = await mockClient.executeRequest({
        serviceName: 'study',
        methodName: 'getMetadata',
        parameters: {},
        userId: 1,
        username: 'root'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(customResponse);
    });
  });

  describe('testConnection', () => {
    it('should return true when not in fail mode', async () => {
      const connected = await mockClient.testConnection('study');
      expect(connected).toBe(true);
    });

    it('should return false when in fail mode', async () => {
      mockClient.setFailMode(true);
      const connected = await mockClient.testConnection('study');
      expect(connected).toBe(false);
    });
  });

  describe('validateOdmResponse', () => {
    it('should validate non-empty ODM response', () => {
      const result = mockClient.validateOdmResponse(mockStudyMetadataOdm);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty ODM response', () => {
      const result = mockClient.validateOdmResponse('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Empty ODM response');
    });
  });
});

// =============================================================================
// Study SOAP Service Tests
// =============================================================================

describe('Study SOAP Service', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  describe('getStudyMetadata', () => {
    it('should fetch study metadata via SOAP', async () => {
      const result = await studySoapService.getStudyMetadata('S_1', 1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.message).toContain('successfully');
    });

    it('should parse ODM metadata correctly', async () => {
      mockClient.setResponseOverride('study.getMetadata', { odm: mockStudyMetadataOdm });

      const result = await studySoapService.getStudyMetadata('S_1', 1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Check metadata structure
      if (result.data) {
        expect(result.data.study).toBeDefined();
        expect(result.data.events).toBeDefined();
        expect(result.data.crfs).toBeDefined();
      }
    });

    it('should handle SOAP failure gracefully', async () => {
      mockClient.setFailMode(true, 'SOAP service unavailable');

      const result = await studySoapService.getStudyMetadata('S_1', 1, 'root');

      expect(result.success).toBe(false);
      expect(result.message).toContain('unavailable');
    });
  });

  describe('listStudies', () => {
    it('should list all studies via SOAP', async () => {
      mockClient.setResponseOverride('study.listAll', mockStudyListResponse);

      const result = await studySoapService.listStudies(1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should handle empty study list', async () => {
      mockClient.setResponseOverride('study.listAll', { studies: { study: [] } });

      const result = await studySoapService.listStudies(1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('parseOdmMetadata', () => {
    it('should parse valid ODM XML', async () => {
      const metadata = await studySoapService.parseOdmMetadata(mockStudyMetadataOdm);

      expect(metadata).toBeDefined();
      expect(metadata.study).toBeDefined();
      expect(metadata.events).toBeDefined();
      expect(metadata.crfs).toBeDefined();
    });

    it('should extract study events from ODM', async () => {
      const metadata = await studySoapService.parseOdmMetadata(mockStudyMetadataOdm);

      expect(metadata.events.length).toBeGreaterThan(0);
      expect(metadata.events[0]).toHaveProperty('name');
    });

    it('should extract CRFs from ODM', async () => {
      const metadata = await studySoapService.parseOdmMetadata(mockStudyMetadataOdm);

      expect(metadata.crfs.length).toBeGreaterThan(0);
      expect(metadata.crfs[0]).toHaveProperty('name');
    });

    it('should throw error for invalid ODM', async () => {
      await expect(
        studySoapService.parseOdmMetadata('invalid xml content')
      ).rejects.toThrow();
    });
  });

  describe('getStudyOid', () => {
    it('should convert study ID to OID format', () => {
      expect(studySoapService.getStudyOid(1)).toBe('S_1');
      expect(studySoapService.getStudyOid(123)).toBe('S_123');
    });
  });

  describe('extractStudyId', () => {
    it('should extract study ID from OID', () => {
      expect(studySoapService.extractStudyId('S_1')).toBe(1);
      expect(studySoapService.extractStudyId('S_123')).toBe(123);
    });

    it('should return 0 for empty OID', () => {
      expect(studySoapService.extractStudyId('')).toBe(0);
    });

    it('should handle malformed OID gracefully', () => {
      // 'invalid'.replace('S_', '') returns 'invalid', parseInt('invalid') returns NaN
      const result = studySoapService.extractStudyId('invalid');
      expect(Number.isNaN(result)).toBe(true);
    });
  });
});

// =============================================================================
// Subject SOAP Service Tests
// =============================================================================

describe('Subject SOAP Service', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  describe('createSubject', () => {
    it('should create subject via SOAP', async () => {
      const request = {
        studyId: 1,
        studySubjectId: 'SUBJ-TEST-001',
        enrollmentDate: '2024-01-15',
        gender: 'M'
      };

      const result = await subjectSoapService.createSubject(request, 1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.message).toContain('successfully');
    });

    it('should handle subject creation with minimal data', async () => {
      const request = {
        studyId: 1,
        studySubjectId: 'SUBJ-MINIMAL'
      };

      const result = await subjectSoapService.createSubject(request, 1, 'root');

      expect(result.success).toBe(true);
    });

    it('should handle SOAP failure gracefully', async () => {
      mockClient.setFailMode(true, 'Subject creation failed');

      const request = {
        studyId: 1,
        studySubjectId: 'SUBJ-FAIL'
      };

      const result = await subjectSoapService.createSubject(request, 1, 'root');

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed');
    });
  });

  describe('isSubjectExists', () => {
    it('should return true when subject exists', async () => {
      mockClient.setResponseOverride('studySubject.isStudySubject', { result: 'true' });

      const exists = await subjectSoapService.isSubjectExists('S_1', 'SUBJ-001', 1, 'root');

      expect(exists).toBe(true);
    });

    it('should return false when subject does not exist', async () => {
      mockClient.setResponseOverride('studySubject.isStudySubject', { result: 'false' });

      const exists = await subjectSoapService.isSubjectExists('S_1', 'NONEXISTENT', 1, 'root');

      expect(exists).toBe(false);
    });

    it('should return false on SOAP failure', async () => {
      mockClient.setFailMode(true);

      const exists = await subjectSoapService.isSubjectExists('S_1', 'SUBJ-001', 1, 'root');

      expect(exists).toBe(false);
    });
  });

  describe('listSubjects', () => {
    it('should list subjects via SOAP', async () => {
      mockClient.setResponseOverride('studySubject.listAll', { odm: mockSubjectListOdm });

      const result = await subjectSoapService.listSubjects('S_1', 1, 'root');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should handle empty subject list', async () => {
      mockClient.setResponseOverride('studySubject.listAll', { 
        odm: '<ODM><ClinicalData></ClinicalData></ODM>' 
      });

      const result = await subjectSoapService.listSubjects('S_1', 1, 'root');

      expect(result.success).toBe(true);
    });
  });

  describe('parseSubjectListOdm', () => {
    it('should parse subject list from ODM', () => {
      const subjects = subjectSoapService.parseSubjectListOdm(mockSubjectListOdm);

      expect(subjects.length).toBeGreaterThan(0);
      expect(subjects[0]).toHaveProperty('subjectKey');
      expect(subjects[0]).toHaveProperty('studySubjectId');
    });

    it('should return empty array for invalid ODM', () => {
      const subjects = subjectSoapService.parseSubjectListOdm('invalid');

      expect(subjects).toEqual([]);
    });
  });
});

// =============================================================================
// Event SOAP Service Tests
// =============================================================================

describe('Event SOAP Service', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  describe('scheduleEvent', () => {
    it('should schedule event via SOAP', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        startDate: '2024-01-15',
        location: 'Site A'
      };

      const result = await eventSoapService.scheduleEvent(request, 1, 'root');

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
    });

    it('should schedule event with minimal data', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1
      };

      const result = await eventSoapService.scheduleEvent(request, 1, 'root');

      expect(result.success).toBe(true);
    });

    it('should handle SOAP failure', async () => {
      mockClient.setFailMode(true, 'Event scheduling failed');

      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1
      };

      const result = await eventSoapService.scheduleEvent(request, 1, 'root');

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed');
    });
  });

  describe('createEvent', () => {
    it('should create event via SOAP', async () => {
      const result = await eventSoapService.createEvent(
        'S_1',
        'SS_1',
        'SE_SCREENING',
        1,
        'root'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
    });

    it('should handle event creation failure', async () => {
      mockClient.setFailMode(true, 'Event creation failed');

      const result = await eventSoapService.createEvent(
        'S_1',
        'SS_1',
        'SE_SCREENING',
        1,
        'root'
      );

      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Data SOAP Service Tests
// =============================================================================

describe('Data SOAP Service', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  describe('importData', () => {
    it('should import clinical data via SOAP', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: {
          'IG_DEMO': {
            'I_AGE': '35',
            'I_GENDER': 'M'
          }
        }
      };

      const result = await dataSoapService.importData(request, 1, 'root');

      expect(result.success).toBe(true);
    });

    it('should handle data import failure', async () => {
      mockClient.setFailMode(true, 'Data import failed');

      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: {}
      };

      const result = await dataSoapService.importData(request, 1, 'root');

      expect(result.success).toBe(false);
    });

    it('should handle validation errors in response', async () => {
      mockClient.setResponseOverride('data.importODM', {
        result: 'ValidationError',
        validationErrors: [
          { itemOid: 'I_AGE', message: 'Invalid value' }
        ]
      });

      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: { 'IG_DEMO': { 'I_AGE': 'invalid' } }
      };

      const result = await dataSoapService.importData(request, 1, 'root');

      // Should still succeed but may contain validation errors in data
      expect(result).toBeDefined();
    });
  });

  describe('buildOdmXml', () => {
    it('should build valid ODM XML from form data', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: {
          'IG_DEMO': {
            'I_AGE': '35',
            'I_GENDER': 'M'
          }
        }
      };

      const odmXml = await dataSoapService.buildOdmXml(request);

      expect(odmXml).toContain('<?xml');
      expect(odmXml).toContain('<ODM');
      expect(odmXml).toContain('StudyOID="S_1"');
      expect(odmXml).toContain('SubjectKey="SS_1"');
      expect(odmXml).toContain('I_AGE');
      expect(odmXml).toContain('35');
    });

    it('should include electronic signature when provided', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: { 'IG_TEST': { 'I_VALUE': 'test' } },
        electronicSignature: {
          username: 'investigator',
          password: 'securePassword123',
          meaning: 'Approval' as const
        }
      };

      const odmXml = await dataSoapService.buildOdmXml(request);

      expect(odmXml).toContain('AuditRecord');
      expect(odmXml).toContain('investigator');
      expect(odmXml).toContain('Electronic Signature');
    });

    it('should escape XML special characters', async () => {
      const request = {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: {
          'IG_TEST': {
            'I_NOTES': 'Value with <special> & "characters"'
          }
        }
      };

      const odmXml = await dataSoapService.buildOdmXml(request);

      expect(odmXml).toContain('&lt;special&gt;');
      expect(odmXml).toContain('&amp;');
      expect(odmXml).toContain('&quot;');
    });
  });

  describe('buildItemDataOdm', () => {
    it('should build ODM for single item', () => {
      const odmXml = dataSoapService.buildItemDataOdm(
        'S_1',
        'SS_1',
        'SE_SCREENING',
        'F_DEMO',
        'IG_DEMO',
        'I_AGE',
        '35'
      );

      expect(odmXml).toContain('<?xml');
      expect(odmXml).toContain('S_1');
      expect(odmXml).toContain('I_AGE');
      expect(odmXml).toContain('35');
    });
  });

  describe('validateOdmStructure', () => {
    it('should validate correct ODM structure', () => {
      const validOdm = `<?xml version="1.0"?>
        <ODM>
          <ClinicalData>
            <SubjectData SubjectKey="SS_1"/>
          </ClinicalData>
        </ODM>`;

      const result = dataSoapService.validateOdmStructure(validOdm);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject ODM without required elements', () => {
      const invalidOdm = '<data>not ODM</data>';

      const result = dataSoapService.validateOdmStructure(invalidOdm);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should check for ODM root element', () => {
      const noOdmRoot = '<ClinicalData><SubjectData/></ClinicalData>';

      const result = dataSoapService.validateOdmStructure(noOdmRoot);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing ODM root element');
    });

    it('should check for ClinicalData element', () => {
      const noClinicalData = '<ODM><Study/></ODM>';

      const result = dataSoapService.validateOdmStructure(noClinicalData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing ClinicalData element');
    });

    it('should check for SubjectData element', () => {
      const noSubjectData = '<ODM><ClinicalData/></ODM>';

      const result = dataSoapService.validateOdmStructure(noSubjectData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing SubjectData element');
    });
  });

  describe('parseImportResponse', () => {
    it('should parse successful import response', async () => {
      const response = { result: 'Success', eventCrfId: 123 };

      const parsed = await dataSoapService.parseImportResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.eventCrfId).toBe(123);
    });

    it('should parse ODM response string', async () => {
      const odmResponse = `<?xml version="1.0"?>
        <ODM>
          <ClinicalData>
            <SubjectData SubjectKey="SS_1">
              <StudyEventData>
                <FormData EventCRFOID="EC_456"/>
              </StudyEventData>
            </SubjectData>
          </ClinicalData>
        </ODM>`;

      const parsed = await dataSoapService.parseImportResponse(odmResponse);

      expect(parsed.odmResponse).toBeDefined();
    });
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('SOAP Error Handling', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  it('should handle network errors gracefully', async () => {
    mockClient.setFailMode(true, 'ECONNREFUSED');

    const result = await studySoapService.getStudyMetadata('S_1', 1, 'root');

    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
  });

  it('should handle authentication errors', async () => {
    mockClient.setFailMode(true, 'Authentication failed: Invalid credentials');

    const result = await subjectSoapService.createSubject(
      { studyId: 1, studySubjectId: 'TEST' },
      1,
      'invalid_user'
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Authentication');
  });

  it('should handle timeout errors', async () => {
    mockClient.setFailMode(true, 'Request timeout');

    const result = await eventSoapService.scheduleEvent(
      { studyId: 1, subjectId: 1, studyEventDefinitionId: 1 },
      1,
      'root'
    );

    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Integration Scenario Tests
// =============================================================================

describe('SOAP Integration Scenarios', () => {
  beforeEach(() => {
    mockClient.clearOverrides();
  });

  it('should complete full subject enrollment workflow', async () => {
    // Step 1: Check study exists
    const studyResult = await studySoapService.getStudyMetadata('S_1', 1, 'root');
    expect(studyResult.success).toBe(true);

    // Step 2: Check subject doesn't exist
    mockClient.setResponseOverride('studySubject.isStudySubject', { result: 'false' });
    const exists = await subjectSoapService.isSubjectExists('S_1', 'NEW-SUBJ-001', 1, 'root');
    expect(exists).toBe(false);

    // Step 3: Create subject
    const createResult = await subjectSoapService.createSubject(
      { studyId: 1, studySubjectId: 'NEW-SUBJ-001', gender: 'F' },
      1,
      'root'
    );
    expect(createResult.success).toBe(true);

    // Step 4: Schedule event
    const eventResult = await eventSoapService.scheduleEvent(
      { studyId: 1, subjectId: 1, studyEventDefinitionId: 1 },
      1,
      'root'
    );
    expect(eventResult.success).toBe(true);

    // Step 5: Submit form data
    const dataResult = await dataSoapService.importData(
      {
        studyId: 1,
        subjectId: 1,
        studyEventDefinitionId: 1,
        crfId: 1,
        formData: { 'IG_DEMO': { 'I_AGE': '28', 'I_GENDER': 'F' } }
      },
      1,
      'root'
    );
    expect(dataResult.success).toBe(true);
  });

  it('should handle failure at any point in workflow', async () => {
    // Start with success, then fail at event scheduling
    mockClient.setResponseOverride('event.schedule', null);
    mockClient.setFailMode(true, 'Event service unavailable');

    const eventResult = await eventSoapService.scheduleEvent(
      { studyId: 1, subjectId: 1, studyEventDefinitionId: 1 },
      1,
      'root'
    );

    expect(eventResult.success).toBe(false);
    expect(eventResult.message).toContain('unavailable');
  });
});

