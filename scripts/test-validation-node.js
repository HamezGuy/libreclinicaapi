/**
 * Test Validation Rules and Query Creation
 * This script tests that entering invalid form data triggers validation rules and creates queries
 */

const http = require('http');

const API_BASE = 'http://localhost:3001';

function makeRequest(method, path, data, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTest() {
  console.log('========================================');
  console.log('Testing Validation Rules & Query Creation');
  console.log('========================================\n');
  
  // Step 1: Login to get token
  console.log('Step 1: Logging in...');
  const loginResult = await makeRequest('POST', '/api/auth/login', {
    username: 'demo',
    password: 'demo'
  });
  
  if (!loginResult.data.accessToken) {
    console.log('Login failed:', loginResult.data);
    return;
  }
  
  const token = loginResult.data.accessToken;
  console.log('  ✅ Login successful, got token');
  
  // Step 2: Get current query count
  console.log('\nStep 2: Checking current query count...');
  const queriesBefore = await makeRequest('GET', '/api/queries?studyId=9', null, token);
  const beforeCount = queriesBefore.data.data?.length || 0;
  console.log(`  Current queries: ${beforeCount}`);
  
  // Step 3: Submit form with INVALID age (5 years - outside 18-65 range)
  console.log('\nStep 3: Submitting form with INVALID age (5 years)...');
  console.log('  Validation rule: Age must be between 18 and 65 years');
  
  const formResult = await makeRequest('POST', '/api/forms/save', {
    studyId: 9,
    subjectId: 6,
    eventId: 11,
    formId: 13,
    formData: {
      "Patient Initials": "XX",
      "Date of Birth": "2020-01-01",
      "Age (years)": 5,  // INVALID - outside 18-65 range
      "Gender": "M",
      "Informed Consent Obtained": "true",
      "Eligibility Confirmed": "true"
    }
  }, token);
  
  console.log(`  Response Status: ${formResult.status}`);
  
  if (formResult.status === 400 && formResult.data.message === 'Validation failed') {
    console.log('  ✅ VALIDATION TRIGGERED!');
    console.log('  Errors:');
    if (formResult.data.errors) {
      formResult.data.errors.forEach(err => {
        console.log(`    - ${err.field}: ${err.message}`);
      });
    }
    if (formResult.data.queriesCreated) {
      console.log(`  ✅ Queries Created: ${formResult.data.queriesCreated}`);
    }
  } else {
    console.log('  Response:', JSON.stringify(formResult.data, null, 2));
  }
  
  // Step 4: Check query count after
  console.log('\nStep 4: Checking query count after submission...');
  const queriesAfter = await makeRequest('GET', '/api/queries?studyId=9', null, token);
  const afterCount = queriesAfter.data.data?.length || 0;
  console.log(`  Queries now: ${afterCount}`);
  
  const newQueries = afterCount - beforeCount;
  if (newQueries > 0) {
    console.log(`  ✅ NEW QUERIES CREATED: ${newQueries}`);
    
    // Show the new queries
    console.log('\n  New queries:');
    const queries = queriesAfter.data.data?.slice(0, newQueries) || [];
    queries.forEach(q => {
      console.log(`    - ID: ${q.discrepancy_note_id || q.id}, Description: ${q.description}`);
    });
  } else {
    console.log('  ⚠️ No new queries created');
  }
  
  console.log('\n========================================');
  console.log('Test Complete!');
  console.log('========================================');
}

runTest().catch(console.error);

