const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5434,
  database: 'libreclinica',
  user: 'libreclinica',
  password: 'libreclinica'
});

const http = require('http');

// Helper function to make HTTP requests
function httpRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function testFullApiCrud() {
  console.log('=== Testing Full API CRUD for Study ===\n');
  
  // First login to get token
  console.log('1. Logging in...');
  const loginRes = await httpRequest({
    hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: 'root', password: '12345678' });
  
  console.log('Login response:', JSON.stringify(loginRes.data, null, 2));
  if (!loginRes.data.success) {
    console.error('Login failed:', loginRes.data);
    return;
  }
  
  const token = loginRes.data.accessToken || loginRes.data.data?.token || loginRes.data.token;
  console.log('Login successful! Token:', token ? token.substring(0, 30) + '...' : 'MISSING');
  
  // 2. Get study list
  console.log('\n2. Getting study list...');
  const studiesRes = await httpRequest({
    hostname: 'localhost', port: 3001, path: '/api/studies?limit=100', method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Studies:', studiesRes.data.data?.length || 0, 'found');
  if (studiesRes.data.data && studiesRes.data.data[0]) {
    console.log('First study:', studiesRes.data.data[0].name, '(ID:', studiesRes.data.data[0].study_id, ')');
  }
  
  // 3. Get study by ID
  console.log('\n3. Getting study ID 1 details...');
  const studyRes = await httpRequest({
    hostname: 'localhost', port: 3001, path: '/api/studies/1', method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Study details:');
  const study = studyRes.data.data;
  if (study) {
    console.log('  Name:', study.name);
    console.log('  Facility:', study.facility_name || '(empty)');
    console.log('  City:', study.facility_city || '(empty)');
    console.log('  PI:', study.principal_investigator || '(empty)');
    console.log('  Sponsor:', study.sponsor || '(empty)');
    console.log('  Events:', study.eventDefinitions?.length || 0);
    console.log('  Groups:', study.groupClasses?.length || 0);
    console.log('  Sites:', study.sites?.length || 0);
  }
  
  // 4. Update study with all fields
  console.log('\n4. Updating study with FULL data...');
  const updateData = {
    // Basic Info
    name: 'Comprehensive Test Study',
    officialTitle: 'A Comprehensive Multi-Center Clinical Trial',
    secondaryIdentifier: 'COMP-2026-001',
    summary: 'This is a comprehensive clinical study for testing all fields.',
    principalInvestigator: 'Dr. James Wilson, MD, PhD',
    sponsor: 'AccuraTrial Pharmaceuticals',
    collaborators: 'University of Maryland, Johns Hopkins',
    phase: 'PHASE_III',
    protocolType: 'interventional',
    expectedTotalEnrollment: 1000,
    datePlannedStart: '2026-02-01',
    datePlannedEnd: '2028-02-01',
    
    // Facility
    facilityName: 'Johns Hopkins University Hospital',
    facilityCity: 'Baltimore',
    facilityState: 'Maryland',
    facilityZip: '21287',
    facilityCountry: 'United States',
    facilityRecruitmentStatus: 'Recruiting',
    facilityContactName: 'Dr. Sarah Connor',
    facilityContactDegree: 'MD, PhD',
    facilityContactPhone: '+1-410-955-5000',
    facilityContactEmail: 'sarah.connor@jhmi.edu',
    
    // Protocol
    protocolDescription: 'This protocol evaluates the efficacy and safety of treatment XYZ.',
    conditions: 'Type 2 Diabetes, Hypertension',
    keywords: 'diabetes, hypertension, clinical trial',
    
    // Eligibility
    eligibility: 'Adults aged 18-75 years with diagnosed Type 2 Diabetes.',
    gender: 'all',
    ageMin: '18',
    ageMax: '75',
    healthyVolunteerAccepted: false,
    
    // Design
    purpose: 'treatment',
    allocation: 'randomized',
    masking: 'double_blind',
    control: 'placebo',
    assignment: 'parallel',
    endpoint: 'safety_efficacy',
    duration: 'months_12',
    selection: 'random',
    timing: 'prospective',
    
    // Nested: Event Definitions (Visits)
    eventDefinitions: [
      { name: 'Screening Visit', description: 'Initial screening and consent', ordinal: 1, repeating: false },
      { name: 'Baseline Visit', description: 'Baseline assessments', ordinal: 2, repeating: false },
      { name: 'Treatment Visit 1', description: 'First treatment administration', ordinal: 3, repeating: false },
      { name: 'Follow-up Visit', description: 'Follow-up assessments', ordinal: 4, repeating: true }
    ],
    
    // Nested: Group Classes
    groupClasses: [
      { name: 'Treatment Group', type: 'Arm', description: 'Active treatment arm' },
      { name: 'Placebo Group', type: 'Arm', description: 'Placebo control arm' }
    ],
    
    // Nested: Sites
    sites: [
      { 
        name: 'Baltimore Main Site', 
        uniqueIdentifier: 'SITE-001', 
        facilityName: 'Johns Hopkins Hospital',
        facilityCity: 'Baltimore',
        facilityState: 'Maryland',
        facilityCountry: 'United States',
        principalInvestigator: 'Dr. Sarah Connor',
        expectedTotalEnrollment: 500,
        facilityRecruitmentStatus: 'Recruiting'
      },
      { 
        name: 'Washington Satellite Site', 
        uniqueIdentifier: 'SITE-002', 
        facilityName: 'Georgetown University Hospital',
        facilityCity: 'Washington DC',
        facilityState: 'DC',
        facilityCountry: 'United States',
        principalInvestigator: 'Dr. Michael Smith',
        expectedTotalEnrollment: 300,
        facilityRecruitmentStatus: 'Not yet recruiting'
      },
      { 
        name: 'Philadelphia Site', 
        uniqueIdentifier: 'SITE-003', 
        facilityName: 'University of Pennsylvania Hospital',
        facilityCity: 'Philadelphia',
        facilityState: 'Pennsylvania',
        facilityCountry: 'United States',
        principalInvestigator: 'Dr. Lisa Chen',
        expectedTotalEnrollment: 200,
        facilityRecruitmentStatus: 'Recruiting'
      }
    ],
    
    // Nested: Study Parameters (Settings)
    studyParameters: {
      collectDob: 'full',
      discrepancyManagement: true,
      subjectIdGeneration: 'auto',
      subjectIdPrefix: 'SUBJ-',
      personIdShownOnCRF: false,
      secondaryLabelViewable: true,
      adminForcedReasonForChange: true
    }
  };
  
  const updateRes = await httpRequest({
    hostname: 'localhost', port: 3001, path: '/api/studies/1', method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }, updateData);
  
  console.log('Update response:', updateRes.data.success ? 'SUCCESS' : 'FAILED');
  if (!updateRes.data.success) {
    console.log('Error:', updateRes.data.message);
  }
  
  // 5. Get updated study to verify
  console.log('\n5. Verifying updated study...');
  const verifyRes = await httpRequest({
    hostname: 'localhost', port: 3001, path: '/api/studies/1', method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  
  const updated = verifyRes.data.data;
  if (updated) {
    console.log('=== VERIFICATION RESULTS ===');
    console.log('Basic Info:');
    console.log('  Name:', updated.name, updated.name === 'Comprehensive Test Study' ? '✓' : '✗');
    console.log('  Official Title:', updated.official_title || '(empty)');
    console.log('  PI:', updated.principal_investigator || '(empty)');
    console.log('  Sponsor:', updated.sponsor || '(empty)');
    console.log('  Phase:', updated.phase || '(empty)');
    console.log('  Enrollment:', updated.expected_total_enrollment || '(empty)');
    
    console.log('\nFacility Info:');
    console.log('  Facility:', updated.facility_name || '(empty)');
    console.log('  City:', updated.facility_city || '(empty)');
    console.log('  State:', updated.facility_state || '(empty)');
    console.log('  Country:', updated.facility_country || '(empty)');
    console.log('  Contact:', updated.facility_contact_name || '(empty)');
    
    console.log('\nProtocol Info:');
    console.log('  Description:', (updated.protocol_description || '').substring(0, 50) + '...');
    console.log('  Conditions:', updated.conditions || '(empty)');
    
    console.log('\nEligibility:');
    console.log('  Gender:', updated.gender || '(empty)');
    console.log('  Age Range:', (updated.age_min || '?') + '-' + (updated.age_max || '?'));
    console.log('  Eligibility:', (updated.eligibility || '').substring(0, 50) + '...');
    
    console.log('\nDesign:');
    console.log('  Purpose:', updated.purpose || '(empty)');
    console.log('  Allocation:', updated.allocation || '(empty)');
    console.log('  Masking:', updated.masking || '(empty)');
    
    console.log('\nNested Data:');
    console.log('  Events:', updated.eventDefinitions?.length || 0);
    if (updated.eventDefinitions && updated.eventDefinitions.length > 0) {
      updated.eventDefinitions.forEach((e, i) => console.log(`    [${i+1}] ${e.name}: ${e.description || '(no desc)'}`));
    }
    console.log('  Groups:', updated.groupClasses?.length || 0);
    if (updated.groupClasses && updated.groupClasses.length > 0) {
      updated.groupClasses.forEach((g, i) => console.log(`    [${i+1}] ${g.name}: ${g.description || '(no desc)'}`));
    }
    console.log('  Sites:', updated.sites?.length || 0);
    if (updated.sites && updated.sites.length > 0) {
      updated.sites.forEach((s, i) => console.log(`    [${i+1}] ${s.name} (${s.uniqueIdentifier}): ${s.facilityCity || '?'}, ${s.facilityCountry || '?'}`));
    }
    console.log('  Parameters:', Object.keys(updated.studyParameters || {}).length);
    
    // Detailed parameter check
    if (updated.studyParameters) {
      console.log('\n  Parameter Values:');
      for (const [key, val] of Object.entries(updated.studyParameters)) {
        console.log(`    ${key}: ${val}`);
      }
    }
    
    console.log('\n=== TEST COMPLETE ===');
  }
  
  pool.end();
}

testFullApiCrud().catch(console.error);

