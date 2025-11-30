/**
 * SOAP Diagnostics Tool
 * 
 * Run this script to diagnose SOAP connection issues:
 * npx ts-node scripts/soap-diagnostics.ts
 * 
 * Checks:
 * - SOAP URL accessibility
 * - WSDL endpoint availability
 * - Authentication
 * - Individual service status
 */

import http from 'http';
import https from 'https';
import * as soap from 'soap';

// Configuration
const config = {
  soapUrl: process.env.LIBRECLINICA_SOAP_URL || 'http://localhost:8080/LibreClinica/ws',
  username: process.env.SOAP_USERNAME || 'root',
  password: process.env.SOAP_PASSWORD || 'root'
};

const SERVICES = [
  { name: 'Study Subject', path: '/studySubject/v1' },
  { name: 'Study', path: '/study/v1' },
  { name: 'Event', path: '/event/v1' },
  { name: 'CRF/Data', path: '/crf/v1' }
];

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║        LibreClinica SOAP Diagnostics Tool                  ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

console.log('Configuration:');
console.log(`  SOAP URL: ${config.soapUrl}`);
console.log(`  Username: ${config.username}`);
console.log(`  Password: ${'*'.repeat(config.password.length)}`);
console.log('');

async function checkUrlAccessible(url: string): Promise<{ accessible: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      resolve({ accessible: true, statusCode: res.statusCode });
    });
    req.on('error', (error) => {
      resolve({ accessible: false, error: error.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ accessible: false, error: 'Connection timeout' });
    });
  });
}

async function checkWsdl(servicePath: string): Promise<{ available: boolean; error?: string }> {
  const wsdlUrl = `${config.soapUrl}${servicePath}?wsdl`;
  
  return new Promise((resolve) => {
    const client = wsdlUrl.startsWith('https') ? https : http;
    const req = client.get(wsdlUrl, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const isWsdl = data.includes('definitions') || data.includes('wsdl:definitions');
        resolve({ available: isWsdl, error: isWsdl ? undefined : 'Response is not valid WSDL' });
      });
    });
    req.on('error', (error) => {
      resolve({ available: false, error: error.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ available: false, error: 'WSDL fetch timeout' });
    });
  });
}

async function testSoapClient(servicePath: string): Promise<{ connected: boolean; methods?: string[]; error?: string }> {
  const wsdlUrl = `${config.soapUrl}${servicePath}?wsdl`;
  
  try {
    const client = await soap.createClientAsync(wsdlUrl, {
      wsdl_options: { timeout: 10000 }
    });
    
    // Add security
    client.setSecurity(new soap.WSSecurity(config.username, config.password));
    
    // Get available methods
    const description = client.describe();
    const methods: string[] = [];
    
    for (const service of Object.values(description)) {
      for (const port of Object.values(service as any)) {
        methods.push(...Object.keys(port as any));
      }
    }
    
    return { connected: true, methods };
  } catch (error: any) {
    return { connected: false, error: error.message };
  }
}

async function runDiagnostics() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Step 1: Checking Base URL Accessibility');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Check base LibreClinica URL
  const baseUrl = config.soapUrl.replace('/ws', '');
  const baseCheck = await checkUrlAccessible(baseUrl);
  
  if (baseCheck.accessible) {
    console.log(`✓ LibreClinica is accessible at ${baseUrl}`);
    console.log(`  Status Code: ${baseCheck.statusCode}`);
  } else {
    console.log(`✗ Cannot reach LibreClinica at ${baseUrl}`);
    console.log(`  Error: ${baseCheck.error}`);
    console.log('');
    console.log('TROUBLESHOOTING:');
    console.log('  1. Ensure LibreClinica Docker container is running');
    console.log('  2. Check if port 8080 is not blocked');
    console.log('  3. Verify the LIBRECLINICA_SOAP_URL environment variable');
    console.log('  4. Try: docker ps | grep libreclinica');
    return;
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Step 2: Checking WSDL Endpoints');
  console.log('═══════════════════════════════════════════════════════════');
  
  const wsdlResults: { name: string; available: boolean; error?: string }[] = [];
  
  for (const service of SERVICES) {
    process.stdout.write(`Checking ${service.name}... `);
    const result = await checkWsdl(service.path);
    wsdlResults.push({ name: service.name, ...result });
    
    if (result.available) {
      console.log('✓ WSDL available');
    } else {
      console.log(`✗ ${result.error}`);
    }
  }
  
  const availableCount = wsdlResults.filter(r => r.available).length;
  console.log('');
  console.log(`Summary: ${availableCount}/${SERVICES.length} WSDL endpoints available`);
  
  if (availableCount === 0) {
    console.log('');
    console.log('TROUBLESHOOTING:');
    console.log('  LibreClinica SOAP services may not be enabled');
    console.log('  1. Check LibreClinica configuration');
    console.log('  2. Ensure webservices are enabled in LibreClinica admin');
    console.log('  3. Restart LibreClinica after enabling webservices');
    return;
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Step 3: Testing SOAP Client Connections');
  console.log('═══════════════════════════════════════════════════════════');
  
  for (const service of SERVICES) {
    const wsdlResult = wsdlResults.find(r => r.name === service.name);
    if (!wsdlResult?.available) {
      console.log(`Skipping ${service.name} (WSDL not available)`);
      continue;
    }
    
    process.stdout.write(`Connecting to ${service.name}... `);
    const result = await testSoapClient(service.path);
    
    if (result.connected) {
      console.log('✓ Connected');
      console.log(`  Available methods: ${result.methods?.join(', ') || 'none'}`);
    } else {
      console.log(`✗ ${result.error}`);
    }
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Diagnostics Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('For full SOAP functionality:');
  console.log('  1. Start LibreClinica: docker-compose up -d');
  console.log('  2. Enable SOAP: Set DISABLE_SOAP=false');
  console.log('  3. Start API: npm run dev or ./START_WITH_SOAP.ps1');
  console.log('');
  console.log('API SOAP Status Endpoint:');
  console.log('  GET http://localhost:3001/api/soap/status');
  console.log('  GET http://localhost:3001/api/soap/diagnostics');
}

runDiagnostics().catch(console.error);

