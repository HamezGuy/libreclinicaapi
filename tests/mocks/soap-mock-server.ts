/**
 * SOAP Mock Server
 * 
 * Simulates LibreClinica SOAP Web Services for testing
 * Can be run standalone or embedded in tests
 * 
 * Endpoints simulated:
 * - /ws/study/v1 - Study metadata
 * - /ws/studySubject/v1 - Subject management
 * - /ws/data/v1 - Clinical data import
 * - /ws/event/v1 - Event scheduling
 */

import http from 'http';
import { parseString, Builder } from 'xml2js';

// =============================================================================
// Types
// =============================================================================

interface MockSoapRequest {
  action: string;
  body: any;
}

interface MockStudy {
  oid: string;
  identifier: string;
  name: string;
  description: string;
  status: string;
}

interface MockSubject {
  subjectKey: string;
  studySubjectId: string;
  studyOid: string;
  enrollmentDate: string;
  gender?: string;
}

// =============================================================================
// Mock Data Store
// =============================================================================

class MockDataStore {
  private studies: Map<string, MockStudy> = new Map();
  private subjects: Map<string, MockSubject> = new Map();
  private eventCounter: number = 1;

  constructor() {
    this.seedData();
  }

  private seedData(): void {
    // Add default test studies
    this.studies.set('S_1', {
      oid: 'S_1',
      identifier: 'TEST-STUDY-001',
      name: 'Test Study',
      description: 'Test study for automated tests',
      status: 'available'
    });

    this.studies.set('S_2', {
      oid: 'S_2',
      identifier: 'DEMO-STUDY',
      name: 'Demo Clinical Trial',
      description: 'Demonstration study',
      status: 'available'
    });

    // Add default test subjects
    this.subjects.set('SS_1', {
      subjectKey: 'SS_1',
      studySubjectId: 'SUBJ-001',
      studyOid: 'S_1',
      enrollmentDate: '2024-01-15',
      gender: 'M'
    });
  }

  public addStudy(study: MockStudy): void {
    this.studies.set(study.oid, study);
  }

  public getStudy(oid: string): MockStudy | undefined {
    return this.studies.get(oid);
  }

  public getAllStudies(): MockStudy[] {
    return Array.from(this.studies.values());
  }

  public addSubject(subject: MockSubject): void {
    this.subjects.set(subject.subjectKey, subject);
  }

  public getSubject(subjectKey: string): MockSubject | undefined {
    return this.subjects.get(subjectKey);
  }

  public getSubjectsByStudy(studyOid: string): MockSubject[] {
    return Array.from(this.subjects.values()).filter(s => s.studyOid === studyOid);
  }

  public subjectExists(studyOid: string, subjectId: string): boolean {
    return Array.from(this.subjects.values()).some(
      s => s.studyOid === studyOid && s.studySubjectId === subjectId
    );
  }

  public getNextEventId(): number {
    return this.eventCounter++;
  }

  public reset(): void {
    this.studies.clear();
    this.subjects.clear();
    this.eventCounter = 1;
    this.seedData();
  }
}

// =============================================================================
// SOAP Response Builders
// =============================================================================

class SoapResponseBuilder {
  private builder: Builder;

  constructor() {
    this.builder = new Builder({
      rootName: 'soap:Envelope',
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true }
    });
  }

  /**
   * Build SOAP envelope wrapper
   */
  public wrapInEnvelope(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"/>
  </soap:Header>
  <soap:Body>
${body}
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Build study metadata ODM response
   */
  public buildStudyMetadata(study: MockStudy): string {
    const odm = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" 
     xmlns:OpenClinica="http://www.openclinica.org/ns/odm_ext_v130/v3.1"
     ODMVersion="1.3"
     FileType="Snapshot"
     FileOID="M_${study.oid}"
     CreationDateTime="${new Date().toISOString()}">
  <Study OID="${study.oid}">
    <GlobalVariables>
      <StudyName>${study.name}</StudyName>
      <StudyDescription>${study.description}</StudyDescription>
      <ProtocolName>${study.identifier}</ProtocolName>
    </GlobalVariables>
    <MetaDataVersion OID="v1.0.0" Name="Version 1.0">
      <StudyEventDef OID="SE_SCREENING" Name="Screening Visit" Repeating="No" Type="Scheduled">
        <FormRef FormOID="F_DEMOGRAPHICS" Mandatory="Yes"/>
        <FormRef FormOID="F_VITALS" Mandatory="Yes"/>
      </StudyEventDef>
      <StudyEventDef OID="SE_BASELINE" Name="Baseline Visit" Repeating="No" Type="Scheduled">
        <FormRef FormOID="F_VITALS" Mandatory="Yes"/>
        <FormRef FormOID="F_LABS" Mandatory="No"/>
      </StudyEventDef>
      <FormDef OID="F_DEMOGRAPHICS" Name="Demographics" Repeating="No">
        <ItemGroupRef ItemGroupOID="IG_DEMO" Mandatory="Yes"/>
      </FormDef>
      <FormDef OID="F_VITALS" Name="Vital Signs" Repeating="No">
        <ItemGroupRef ItemGroupOID="IG_VITALS" Mandatory="Yes"/>
      </FormDef>
      <FormDef OID="F_LABS" Name="Laboratory Tests" Repeating="No">
        <ItemGroupRef ItemGroupOID="IG_LABS" Mandatory="Yes"/>
      </FormDef>
      <ItemGroupDef OID="IG_DEMO" Name="Demographics" Repeating="No">
        <ItemRef ItemOID="I_AGE" Mandatory="Yes"/>
        <ItemRef ItemOID="I_GENDER" Mandatory="Yes"/>
      </ItemGroupDef>
      <ItemGroupDef OID="IG_VITALS" Name="Vital Signs" Repeating="No">
        <ItemRef ItemOID="I_HEIGHT" Mandatory="Yes"/>
        <ItemRef ItemOID="I_WEIGHT" Mandatory="Yes"/>
        <ItemRef ItemOID="I_BP_SYS" Mandatory="Yes"/>
        <ItemRef ItemOID="I_BP_DIA" Mandatory="Yes"/>
      </ItemGroupDef>
      <ItemDef OID="I_AGE" Name="Age" DataType="integer"/>
      <ItemDef OID="I_GENDER" Name="Gender" DataType="text"/>
      <ItemDef OID="I_HEIGHT" Name="Height (cm)" DataType="float"/>
      <ItemDef OID="I_WEIGHT" Name="Weight (kg)" DataType="float"/>
      <ItemDef OID="I_BP_SYS" Name="Systolic BP" DataType="integer"/>
      <ItemDef OID="I_BP_DIA" Name="Diastolic BP" DataType="integer"/>
    </MetaDataVersion>
  </Study>
</ODM>`;

    return `    <getMetadataResponse xmlns="http://openclinica.org/ws/study/v1">
      <result>Success</result>
      <odm><![CDATA[${odm}]]></odm>
    </getMetadataResponse>`;
  }

  /**
   * Build study list response
   */
  public buildStudyList(studies: MockStudy[]): string {
    const studyItems = studies.map(s => 
      `      <study>
        <oid>${s.oid}</oid>
        <identifier>${s.identifier}</identifier>
        <name>${s.name}</name>
        <status>${s.status}</status>
      </study>`
    ).join('\n');

    return `    <listAllResponse xmlns="http://openclinica.org/ws/study/v1">
      <result>Success</result>
      <studies>
${studyItems}
      </studies>
    </listAllResponse>`;
  }

  /**
   * Build subject creation response
   */
  public buildSubjectCreated(subjectKey: string): string {
    return `    <createResponse xmlns="http://openclinica.org/ws/studySubject/v1">
      <result>Success</result>
      <subjectKey>${subjectKey}</subjectKey>
    </createResponse>`;
  }

  /**
   * Build subject exists check response
   */
  public buildSubjectExists(exists: boolean): string {
    return `    <isStudySubjectResponse xmlns="http://openclinica.org/ws/studySubject/v1">
      <result>${exists}</result>
    </isStudySubjectResponse>`;
  }

  /**
   * Build subject list response
   */
  public buildSubjectList(subjects: MockSubject[]): string {
    const odmSubjects = subjects.map(s => 
      `    <SubjectData SubjectKey="${s.subjectKey}">
      <StudySubjectID>${s.studySubjectId}</StudySubjectID>
      <EnrollmentDate>${s.enrollmentDate}</EnrollmentDate>
      ${s.gender ? `<Sex>${s.gender}</Sex>` : ''}
    </SubjectData>`
    ).join('\n');

    const odm = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" ODMVersion="1.3" FileType="Snapshot">
  <ClinicalData StudyOID="${subjects[0]?.studyOid || 'S_1'}" MetaDataVersionOID="v1.0.0">
${odmSubjects}
  </ClinicalData>
</ODM>`;

    return `    <listAllResponse xmlns="http://openclinica.org/ws/studySubject/v1">
      <result>Success</result>
      <odm><![CDATA[${odm}]]></odm>
    </listAllResponse>`;
  }

  /**
   * Build event scheduled response
   */
  public buildEventScheduled(eventId: number): string {
    return `    <scheduleResponse xmlns="http://openclinica.org/ws/event/v1">
      <result>Success</result>
      <eventId>${eventId}</eventId>
    </scheduleResponse>`;
  }

  /**
   * Build data import response
   */
  public buildDataImported(eventCrfId: number): string {
    return `    <importODMResponse xmlns="http://openclinica.org/ws/data/v1">
      <result>Success</result>
      <eventCrfId>EC_${eventCrfId}</eventCrfId>
    </importODMResponse>`;
  }

  /**
   * Build SOAP fault response
   */
  public buildFault(faultCode: string, faultString: string): string {
    return `    <soap:Fault>
      <faultcode>${faultCode}</faultcode>
      <faultstring>${faultString}</faultstring>
    </soap:Fault>`;
  }
}

// =============================================================================
// Request Handlers
// =============================================================================

class SoapRequestHandler {
  private dataStore: MockDataStore;
  private responseBuilder: SoapResponseBuilder;

  constructor(dataStore: MockDataStore) {
    this.dataStore = dataStore;
    this.responseBuilder = new SoapResponseBuilder();
  }

  /**
   * Parse SOAP request and extract action/body
   */
  public async parseRequest(xmlBody: string): Promise<MockSoapRequest> {
    return new Promise((resolve, reject) => {
      parseString(xmlBody, { explicitArray: false }, (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const envelope = result['soap:Envelope'] || result['soapenv:Envelope'] || result.Envelope;
          const body = envelope?.['soap:Body'] || envelope?.['soapenv:Body'] || envelope?.Body;
          
          // Get the first operation in the body
          const operations = Object.keys(body).filter(k => !k.startsWith('$'));
          const action = operations[0] || 'unknown';
          
          resolve({
            action,
            body: body[action]
          });
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  /**
   * Handle study service requests
   */
  public handleStudyRequest(action: string, body: any): string {
    let responseBody: string;

    switch (action) {
      case 'getMetadata':
      case 'getMetadataRequest':
        const studyOid = body?.studyOid || body?.['ns2:studyOid'] || 'S_1';
        const study = this.dataStore.getStudy(studyOid);
        if (study) {
          responseBody = this.responseBuilder.buildStudyMetadata(study);
        } else {
          responseBody = this.responseBuilder.buildFault('Client', `Study ${studyOid} not found`);
        }
        break;

      case 'listAll':
      case 'listAllRequest':
        const studies = this.dataStore.getAllStudies();
        responseBody = this.responseBuilder.buildStudyList(studies);
        break;

      default:
        responseBody = this.responseBuilder.buildFault('Client', `Unknown study operation: ${action}`);
    }

    return this.responseBuilder.wrapInEnvelope(responseBody);
  }

  /**
   * Handle subject service requests
   */
  public handleSubjectRequest(action: string, body: any): string {
    let responseBody: string;

    switch (action) {
      case 'create':
      case 'createRequest':
        // Extract subject info from ODM in request
        const odmXml = body?.odm || body?.['ns2:odm'] || '';
        const subjectMatch = odmXml.match(/StudySubjectID>([^<]+)</);
        const studyMatch = odmXml.match(/StudyOID="([^"]+)"/);
        
        if (subjectMatch && studyMatch) {
          const subjectId = subjectMatch[1];
          const studyOid = studyMatch[1];
          const subjectKey = `SS_${Date.now()}`;
          
          this.dataStore.addSubject({
            subjectKey,
            studySubjectId: subjectId,
            studyOid,
            enrollmentDate: new Date().toISOString().split('T')[0]
          });
          
          responseBody = this.responseBuilder.buildSubjectCreated(subjectKey);
        } else {
          responseBody = this.responseBuilder.buildFault('Client', 'Invalid subject creation request');
        }
        break;

      case 'isStudySubject':
      case 'isStudySubjectRequest':
        const checkOdm = body?.odm || '';
        const checkSubjectMatch = checkOdm.match(/StudySubjectID>([^<]+)</);
        const checkStudyMatch = checkOdm.match(/StudyOID="([^"]+)"/);
        
        if (checkSubjectMatch && checkStudyMatch) {
          const exists = this.dataStore.subjectExists(checkStudyMatch[1], checkSubjectMatch[1]);
          responseBody = this.responseBuilder.buildSubjectExists(exists);
        } else {
          responseBody = this.responseBuilder.buildSubjectExists(false);
        }
        break;

      case 'listAll':
      case 'listAllRequest':
        const listStudyOid = body?.studyOid || body?.['ns2:studyOid'] || 'S_1';
        const subjects = this.dataStore.getSubjectsByStudy(listStudyOid);
        responseBody = this.responseBuilder.buildSubjectList(subjects);
        break;

      default:
        responseBody = this.responseBuilder.buildFault('Client', `Unknown subject operation: ${action}`);
    }

    return this.responseBuilder.wrapInEnvelope(responseBody);
  }

  /**
   * Handle event service requests
   */
  public handleEventRequest(action: string, body: any): string {
    let responseBody: string;

    switch (action) {
      case 'schedule':
      case 'scheduleRequest':
      case 'create':
      case 'createRequest':
        const eventId = this.dataStore.getNextEventId();
        responseBody = this.responseBuilder.buildEventScheduled(eventId);
        break;

      default:
        responseBody = this.responseBuilder.buildFault('Client', `Unknown event operation: ${action}`);
    }

    return this.responseBuilder.wrapInEnvelope(responseBody);
  }

  /**
   * Handle data service requests
   */
  public handleDataRequest(action: string, body: any): string {
    let responseBody: string;

    switch (action) {
      case 'importODM':
      case 'importODMRequest':
      case 'import':
        const eventCrfId = Math.floor(Math.random() * 10000) + 1;
        responseBody = this.responseBuilder.buildDataImported(eventCrfId);
        break;

      default:
        responseBody = this.responseBuilder.buildFault('Client', `Unknown data operation: ${action}`);
    }

    return this.responseBuilder.wrapInEnvelope(responseBody);
  }
}

// =============================================================================
// Mock SOAP Server
// =============================================================================

export class MockSoapServer {
  private server: http.Server | null = null;
  private dataStore: MockDataStore;
  private requestHandler: SoapRequestHandler;
  private port: number;

  constructor(port: number = 8089) {
    this.port = port;
    this.dataStore = new MockDataStore();
    this.requestHandler = new SoapRequestHandler(this.dataStore);
  }

  /**
   * Start the mock SOAP server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        console.log(`🧼 Mock SOAP Server running on port ${this.port}`);
        console.log(`   Study Service:   http://localhost:${this.port}/ws/study/v1?wsdl`);
        console.log(`   Subject Service: http://localhost:${this.port}/ws/studySubject/v1?wsdl`);
        console.log(`   Event Service:   http://localhost:${this.port}/ws/event/v1?wsdl`);
        console.log(`   Data Service:    http://localhost:${this.port}/ws/data/v1?wsdl`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the mock SOAP server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🧼 Mock SOAP Server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Reset mock data to initial state
   */
  public reset(): void {
    this.dataStore.reset();
  }

  /**
   * Add a mock study
   */
  public addStudy(study: MockStudy): void {
    this.dataStore.addStudy(study);
  }

  /**
   * Add a mock subject
   */
  public addSubject(subject: MockSubject): void {
    this.dataStore.addSubject(subject);
  }

  /**
   * Handle incoming SOAP request
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '';

    // Handle WSDL requests
    if (url.includes('?wsdl')) {
      res.setHeader('Content-Type', 'application/xml');
      res.end(this.getWsdl(url));
      return;
    }

    // Handle POST (SOAP) requests
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const response = await this.processSoapRequest(url, body);
          res.setHeader('Content-Type', 'application/xml');
          res.end(response);
        } catch (error: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/xml');
          res.end(this.buildErrorResponse(error.message));
        }
      });
    } else {
      res.statusCode = 405;
      res.end('Method not allowed');
    }
  }

  /**
   * Process SOAP request and return response
   */
  private async processSoapRequest(url: string, body: string): Promise<string> {
    const parsed = await this.requestHandler.parseRequest(body);

    // Route to appropriate handler based on URL
    if (url.includes('/study/') || url.includes('/studySubject/')) {
      if (url.includes('/studySubject/')) {
        return this.requestHandler.handleSubjectRequest(parsed.action, parsed.body);
      }
      return this.requestHandler.handleStudyRequest(parsed.action, parsed.body);
    } else if (url.includes('/event/')) {
      return this.requestHandler.handleEventRequest(parsed.action, parsed.body);
    } else if (url.includes('/data/') || url.includes('/crf/')) {
      return this.requestHandler.handleDataRequest(parsed.action, parsed.body);
    }

    // Default to study handler
    return this.requestHandler.handleStudyRequest(parsed.action, parsed.body);
  }

  /**
   * Get WSDL for service
   */
  private getWsdl(url: string): string {
    // Simplified WSDL - enough for the soap library to work
    const serviceName = url.includes('studySubject') ? 'StudySubjectService' :
                       url.includes('study') ? 'StudyService' :
                       url.includes('event') ? 'EventService' : 'DataService';

    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://openclinica.org/ws/${serviceName.toLowerCase()}/v1"
             name="${serviceName}"
             targetNamespace="http://openclinica.org/ws/${serviceName.toLowerCase()}/v1">
  <types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema">
      <element name="odm" type="string"/>
      <element name="result" type="string"/>
      <element name="studyOid" type="string"/>
    </schema>
  </types>
  <message name="getMetadataRequest">
    <part name="studyOid" element="tns:studyOid"/>
  </message>
  <message name="getMetadataResponse">
    <part name="odm" element="tns:odm"/>
  </message>
  <message name="listAllRequest"/>
  <message name="listAllResponse">
    <part name="result" element="tns:result"/>
  </message>
  <message name="createRequest">
    <part name="odm" element="tns:odm"/>
  </message>
  <message name="createResponse">
    <part name="result" element="tns:result"/>
  </message>
  <message name="importODMRequest">
    <part name="odm" element="tns:odm"/>
  </message>
  <message name="importODMResponse">
    <part name="result" element="tns:result"/>
  </message>
  <portType name="${serviceName}PortType">
    <operation name="getMetadata">
      <input message="tns:getMetadataRequest"/>
      <output message="tns:getMetadataResponse"/>
    </operation>
    <operation name="listAll">
      <input message="tns:listAllRequest"/>
      <output message="tns:listAllResponse"/>
    </operation>
    <operation name="create">
      <input message="tns:createRequest"/>
      <output message="tns:createResponse"/>
    </operation>
    <operation name="schedule">
      <input message="tns:createRequest"/>
      <output message="tns:createResponse"/>
    </operation>
    <operation name="importODM">
      <input message="tns:importODMRequest"/>
      <output message="tns:importODMResponse"/>
    </operation>
  </portType>
  <binding name="${serviceName}Binding" type="tns:${serviceName}PortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getMetadata">
      <soap:operation soapAction="getMetadata"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="listAll">
      <soap:operation soapAction="listAll"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="create">
      <soap:operation soapAction="create"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="schedule">
      <soap:operation soapAction="schedule"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
    <operation name="importODM">
      <soap:operation soapAction="importODM"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
  </binding>
  <service name="${serviceName}">
    <port name="${serviceName}Port" binding="tns:${serviceName}Binding">
      <soap:address location="http://localhost:${this.port}/ws/${serviceName.toLowerCase()}/v1"/>
    </port>
  </service>
</definitions>`;
  }

  /**
   * Build error response
   */
  private buildErrorResponse(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>Server</faultcode>
      <faultstring>${message}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
  }
}

// Export default instance for convenience
export default MockSoapServer;

