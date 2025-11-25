/**
 * LibreClinica Integration Test Setup
 * 
 * Sets up and manages a real LibreClinica instance for integration testing
 * Required for 21 CFR Part 11 compliance verification
 * 
 * This module:
 * - Waits for LibreClinica to be ready
 * - Creates test users with SOAP access
 * - Provides utilities for test data management
 * - Handles cleanup after tests
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import http from 'http';
import https from 'https';
import { Pool } from 'pg';

// =============================================================================
// Configuration
// =============================================================================

export interface LibreClinicaConfig {
  baseUrl: string;
  soapUrl: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  adminUsername: string;
  adminPassword: string;
}

export const DEFAULT_CONFIG: LibreClinicaConfig = {
  baseUrl: process.env.LIBRECLINICA_URL || 'http://localhost:8090/LibreClinica',
  soapUrl: process.env.LIBRECLINICA_SOAP_URL || 'http://localhost:8090/LibreClinica/ws',
  dbHost: process.env.LIBRECLINICA_DB_HOST || 'localhost',
  dbPort: parseInt(process.env.LIBRECLINICA_DB_PORT || '5434'),
  dbName: process.env.LIBRECLINICA_DB_NAME || 'libreclinica',
  dbUser: process.env.LIBRECLINICA_DB_USER || 'clinica',
  dbPassword: process.env.LIBRECLINICA_DB_PASSWORD || 'clinica',
  adminUsername: 'root',
  adminPassword: 'root'
};

// =============================================================================
// LibreClinica Health Check
// =============================================================================

/**
 * Check if LibreClinica is responding
 */
export async function isLibreClinicaReady(config: LibreClinicaConfig = DEFAULT_CONFIG): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(config.baseUrl + '/pages/login/login');
    const protocol = url.protocol === 'https:' ? https : http;

    const req = protocol.get(url.href, { timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Check if SOAP services are available
 */
export async function isSoapReady(config: LibreClinicaConfig = DEFAULT_CONFIG): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(config.soapUrl + '/studySubject/v1?wsdl');
    const protocol = url.protocol === 'https:' ? https : http;

    const req = protocol.get(url.href, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Check if we got a WSDL response
        resolve(data.includes('definitions') || data.includes('wsdl'));
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for LibreClinica to be fully ready
 */
export async function waitForLibreClinica(
  config: LibreClinicaConfig = DEFAULT_CONFIG,
  maxWaitMs: number = 180000, // 3 minutes
  checkIntervalMs: number = 5000
): Promise<boolean> {
  console.log('⏳ Waiting for LibreClinica to be ready...');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const appReady = await isLibreClinicaReady(config);
    
    if (appReady) {
      console.log('✅ LibreClinica web UI is ready');
      
      // Also check SOAP
      const soapReady = await isSoapReady(config);
      if (soapReady) {
        console.log('✅ LibreClinica SOAP services are ready');
        return true;
      } else {
        console.log('⏳ SOAP services not yet available...');
      }
    } else {
      console.log('⏳ LibreClinica not yet responding...');
    }

    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  console.error('❌ LibreClinica did not become ready within timeout');
  return false;
}

// =============================================================================
// Docker Management
// =============================================================================

/**
 * Start LibreClinica Docker containers
 */
export async function startLibreClinica(): Promise<boolean> {
  console.log('🐳 Starting LibreClinica Docker containers...');
  
  try {
    execSync(
      'docker-compose -f docker-compose.libreclinica.yml up -d',
      { 
        cwd: process.cwd(),
        stdio: 'inherit'
      }
    );
    
    console.log('✅ Docker containers started');
    return true;
  } catch (error: any) {
    console.error('❌ Failed to start Docker containers:', error.message);
    return false;
  }
}

/**
 * Stop LibreClinica Docker containers
 */
export async function stopLibreClinica(): Promise<void> {
  console.log('🐳 Stopping LibreClinica Docker containers...');
  
  try {
    execSync(
      'docker-compose -f docker-compose.libreclinica.yml down',
      { 
        cwd: process.cwd(),
        stdio: 'inherit'
      }
    );
    console.log('✅ Docker containers stopped');
  } catch (error: any) {
    console.error('⚠️ Failed to stop containers:', error.message);
  }
}

/**
 * Check if Docker containers are running
 */
export function isDockerRunning(): boolean {
  try {
    const output = execSync(
      'docker-compose -f docker-compose.libreclinica.yml ps -q libreclinica',
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// Database Access (Direct to LibreClinica DB)
// =============================================================================

let lcDbPool: Pool | null = null;

/**
 * Get connection pool to LibreClinica database
 */
export function getLibreClinicaDb(config: LibreClinicaConfig = DEFAULT_CONFIG): Pool {
  if (!lcDbPool) {
    lcDbPool = new Pool({
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
      max: 5
    });
  }
  return lcDbPool;
}

/**
 * Close LibreClinica database connection
 */
export async function closeLibreClinicaDb(): Promise<void> {
  if (lcDbPool) {
    await lcDbPool.end();
    lcDbPool = null;
  }
}

// =============================================================================
// Test User Management
// =============================================================================

export interface TestUser {
  userId: number;
  username: string;
  password: string;
  email: string;
  userTypeId: number;
}

/**
 * Create a test user with SOAP access in LibreClinica database
 */
export async function createTestUser(
  username: string,
  password: string,
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<TestUser> {
  const db = getLibreClinicaDb(config);
  
  // Check if user already exists
  const existingUser = await db.query(
    'SELECT user_id FROM user_account WHERE user_name = $1',
    [username]
  );

  if (existingUser.rows.length > 0) {
    console.log(`ℹ️ Test user '${username}' already exists`);
    return {
      userId: existingUser.rows[0].user_id,
      username,
      password,
      email: `${username}@test.local`,
      userTypeId: 1
    };
  }

  // Create MD5 hash of password (LibreClinica uses MD5 for passwords)
  const crypto = require('crypto');
  const passwordHash = crypto.createHash('md5').update(password).digest('hex');

  // Insert user
  const result = await db.query(`
    INSERT INTO user_account (
      user_name, passwd, first_name, last_name, email,
      user_type_id, status_id, owner_id, date_created,
      enabled, account_non_locked, lock_counter, passwd_timestamp
    ) VALUES (
      $1, $2, 'Test', 'User', $3,
      1, 1, 1, NOW(),
      true, true, 0, NOW()
    )
    RETURNING user_id
  `, [username, passwordHash, `${username}@test.local`]);

  const userId = result.rows[0].user_id;

  console.log(`✅ Created test user '${username}' with ID ${userId}`);

  return {
    userId,
    username,
    password,
    email: `${username}@test.local`,
    userTypeId: 1
  };
}

/**
 * Grant study access to a test user
 */
export async function grantStudyAccess(
  username: string,
  studyId: number,
  roleName: string = 'admin',
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<void> {
  const db = getLibreClinicaDb(config);

  // Check if role already exists
  const existingRole = await db.query(`
    SELECT * FROM study_user_role 
    WHERE user_name = $1 AND study_id = $2
  `, [username, studyId]);

  if (existingRole.rows.length > 0) {
    return; // Already has access
  }

  await db.query(`
    INSERT INTO study_user_role (
      role_name, study_id, status_id, owner_id, date_created, user_name
    ) VALUES ($1, $2, 1, 1, NOW(), $3)
  `, [roleName, studyId, username]);

  console.log(`✅ Granted '${roleName}' access to study ${studyId} for user '${username}'`);
}

/**
 * Delete a test user
 */
export async function deleteTestUser(
  username: string,
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<void> {
  const db = getLibreClinicaDb(config);

  // Delete study roles first
  await db.query('DELETE FROM study_user_role WHERE user_name = $1', [username]);
  
  // Delete user
  await db.query('DELETE FROM user_account WHERE user_name = $1', [username]);

  console.log(`🗑️ Deleted test user '${username}'`);
}

// =============================================================================
// Test Study Management
// =============================================================================

export interface TestStudy {
  studyId: number;
  uniqueIdentifier: string;
  name: string;
  ocOid: string;
}

/**
 * Create a test study in LibreClinica
 */
export async function createTestStudy(
  identifier: string,
  name: string,
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<TestStudy> {
  const db = getLibreClinicaDb(config);

  // Check if study already exists
  const existingStudy = await db.query(
    'SELECT study_id, oc_oid FROM study WHERE unique_identifier = $1',
    [identifier]
  );

  if (existingStudy.rows.length > 0) {
    console.log(`ℹ️ Test study '${identifier}' already exists`);
    return {
      studyId: existingStudy.rows[0].study_id,
      uniqueIdentifier: identifier,
      name,
      ocOid: existingStudy.rows[0].oc_oid
    };
  }

  const ocOid = `S_${identifier.replace(/[^a-zA-Z0-9]/g, '_')}`;

  const result = await db.query(`
    INSERT INTO study (
      unique_identifier, name, summary, status_id, owner_id,
      date_created, oc_oid, protocol_type
    ) VALUES (
      $1, $2, 'Integration test study', 1, 1,
      NOW(), $3, 'interventional'
    )
    RETURNING study_id
  `, [identifier, name, ocOid]);

  const studyId = result.rows[0].study_id;

  console.log(`✅ Created test study '${identifier}' with ID ${studyId}`);

  return {
    studyId,
    uniqueIdentifier: identifier,
    name,
    ocOid
  };
}

/**
 * Delete a test study
 */
export async function deleteTestStudy(
  identifier: string,
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<void> {
  const db = getLibreClinicaDb(config);

  // Get study ID
  const study = await db.query(
    'SELECT study_id FROM study WHERE unique_identifier = $1',
    [identifier]
  );

  if (study.rows.length === 0) return;

  const studyId = study.rows[0].study_id;

  // Delete in order of dependencies
  await db.query('DELETE FROM study_user_role WHERE study_id = $1', [studyId]);
  await db.query('DELETE FROM study_event_definition WHERE study_id = $1', [studyId]);
  await db.query('DELETE FROM study_subject WHERE study_id = $1', [studyId]);
  await db.query('DELETE FROM study WHERE study_id = $1', [studyId]);

  console.log(`🗑️ Deleted test study '${identifier}'`);
}

// =============================================================================
// Test Fixtures
// =============================================================================

export interface IntegrationTestFixtures {
  config: LibreClinicaConfig;
  testUser: TestUser;
  testStudy: TestStudy;
}

/**
 * Set up all fixtures for integration testing
 */
export async function setupIntegrationTestFixtures(
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<IntegrationTestFixtures> {
  console.log('\n📦 Setting up integration test fixtures...\n');

  // Create test user
  const testUser = await createTestUser('soap_test_user', 'SoapTest123!', config);

  // Create test study
  const testStudy = await createTestStudy('SOAP-INT-TEST', 'SOAP Integration Test Study', config);

  // Grant study access
  await grantStudyAccess(testUser.username, testStudy.studyId, 'admin', config);

  console.log('\n✅ Integration test fixtures ready\n');

  return {
    config,
    testUser,
    testStudy
  };
}

/**
 * Tear down integration test fixtures
 */
export async function teardownIntegrationTestFixtures(
  config: LibreClinicaConfig = DEFAULT_CONFIG
): Promise<void> {
  console.log('\n🧹 Cleaning up integration test fixtures...\n');

  try {
    await deleteTestStudy('SOAP-INT-TEST', config);
    await deleteTestUser('soap_test_user', config);
  } catch (error: any) {
    console.warn('⚠️ Cleanup warning:', error.message);
  }

  await closeLibreClinicaDb();

  console.log('\n✅ Cleanup complete\n');
}

// =============================================================================
// Exports
// =============================================================================

export default {
  DEFAULT_CONFIG,
  isLibreClinicaReady,
  isSoapReady,
  waitForLibreClinica,
  startLibreClinica,
  stopLibreClinica,
  isDockerRunning,
  getLibreClinicaDb,
  closeLibreClinicaDb,
  createTestUser,
  grantStudyAccess,
  deleteTestUser,
  createTestStudy,
  deleteTestStudy,
  setupIntegrationTestFixtures,
  teardownIntegrationTestFixtures
};

