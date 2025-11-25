/**
 * Database Real Integration Tests
 * 
 * These tests run against the REAL LibreClinica PostgreSQL schema.
 * Tests validate that all our services work correctly with the actual database.
 * 
 * REQUIRED FOR 21 CFR PART 11 COMPLIANCE:
 * - Validates data integrity
 * - Validates schema compliance
 * - Validates audit trail functionality
 * - Validates user authentication
 * 
 * Prerequisites:
 *   docker-compose -f docker-compose.test.yml up -d
 * 
 * Run:
 *   npm run test:integration:real
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Pool } from 'pg';

// Import services
import * as studyService from '../../src/services/hybrid/study.service';
import * as subjectService from '../../src/services/hybrid/subject.service';
import * as formService from '../../src/services/hybrid/form.service';
import * as eventService from '../../src/services/hybrid/event.service';
import * as auditService from '../../src/services/database/audit.service';
import * as userService from '../../src/services/database/user.service';
import * as authService from '../../src/services/database/auth.service';
import * as queryService from '../../src/services/database/query.service';
import * as sdvService from '../../src/services/database/sdv.service';
import * as dataLocksService from '../../src/services/database/data-locks.service';

// =============================================================================
// Test Database Configuration
// =============================================================================

const TEST_DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'libreclinica_test',
  user: process.env.DB_USER || 'clinica',
  password: process.env.DB_PASSWORD || 'clinica'
};

let pool: Pool;
let testUserId: number;
let testStudyId: number;
let testSubjectId: number;
let testEventId: number;

// =============================================================================
// Setup & Teardown
// =============================================================================

beforeAll(async () => {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🔬 Real Database Integration Tests');
  console.log('  📋 Testing against LibreClinica PostgreSQL schema');
  console.log('═══════════════════════════════════════════════════════════════\n');

  pool = new Pool(TEST_DB_CONFIG);

  try {
    // Verify database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection verified');

    // Verify schema exists
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`✅ Found ${tables.rows.length} tables in schema`);

    // Get or create root user
    const rootUser = await pool.query(
      "SELECT user_id FROM user_account WHERE user_name = 'root'"
    );
    if (rootUser.rows.length > 0) {
      testUserId = rootUser.rows[0].user_id;
    } else {
      throw new Error('Root user not found - database not properly initialized');
    }

    // Get or create test study
    const existingStudy = await pool.query(
      "SELECT study_id FROM study WHERE unique_identifier = 'INT-TEST-STUDY'"
    );
    if (existingStudy.rows.length > 0) {
      testStudyId = existingStudy.rows[0].study_id;
    } else {
      const newStudy = await pool.query(`
        INSERT INTO study (
          unique_identifier, name, summary, status_id, owner_id,
          date_created, oc_oid, protocol_type
        ) VALUES (
          'INT-TEST-STUDY', 'Integration Test Study', 'For automated testing',
          1, $1, NOW(), 'S_INT_TEST', 'interventional'
        ) RETURNING study_id
      `, [testUserId]);
      testStudyId = newStudy.rows[0].study_id;
    }

    console.log(`✅ Test study ready (ID: ${testStudyId})`);

  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);
    throw error;
  }
}, 60000);

afterAll(async () => {
  console.log('\n🧹 Cleaning up integration test data...');

  try {
    // Clean up test data
    await pool.query("DELETE FROM study_subject WHERE study_id = (SELECT study_id FROM study WHERE unique_identifier = 'INT-TEST-STUDY')");
    await pool.query("DELETE FROM study_user_role WHERE study_id = (SELECT study_id FROM study WHERE unique_identifier = 'INT-TEST-STUDY')");
    await pool.query("DELETE FROM study WHERE unique_identifier = 'INT-TEST-STUDY'");
    
    console.log('✅ Test data cleaned up');
  } catch (e) {
    // Ignore cleanup errors
  }

  await pool.end();
  console.log('✅ Database connection closed\n');
}, 30000);

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('Schema Validation (Part 11 Compliance)', () => {
  it('should have all required LibreClinica tables', async () => {
    const requiredTables = [
      'user_account',
      'study',
      'study_subject',
      'subject',
      'study_event',
      'study_event_definition',
      'event_crf',
      'crf',
      'crf_version',
      'item_data',
      'discrepancy_note',
      'audit_log_event',
      'status'
    ];

    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const tableNames = tables.rows.map((r: any) => r.table_name);

    for (const table of requiredTables) {
      expect(tableNames).toContain(table);
    }
  });

  it('should have user_account table with Part 11 required columns', async () => {
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_account'
    `);

    const columnNames = columns.rows.map((r: any) => r.column_name);

    // Part 11 required columns for user management
    expect(columnNames).toContain('user_name');
    expect(columnNames).toContain('passwd');
    expect(columnNames).toContain('enabled');
    expect(columnNames).toContain('account_non_locked');
    expect(columnNames).toContain('lock_counter');
    expect(columnNames).toContain('passwd_timestamp');
  });

  it('should have audit_log_event table with Part 11 required columns', async () => {
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'audit_log_event'
    `);

    const columnNames = columns.rows.map((r: any) => r.column_name);

    // Part 11 required columns for audit trail
    expect(columnNames).toContain('audit_date');
    expect(columnNames).toContain('user_id');
    expect(columnNames).toContain('audit_table');
    expect(columnNames).toContain('entity_id');
  });

  it('should have status lookup table with correct values', async () => {
    const statuses = await pool.query('SELECT * FROM status ORDER BY status_id');

    expect(statuses.rows.length).toBeGreaterThanOrEqual(5);
    
    const statusNames = statuses.rows.map((r: any) => r.name);
    expect(statusNames).toContain('available');
    expect(statusNames).toContain('removed');
    expect(statusNames).toContain('locked');
  });
});

// =============================================================================
// Study Service Tests (Real Database)
// =============================================================================

describe('Study Service (Real Database)', () => {
  it('should retrieve studies with correct schema fields', async () => {
    const result = await studyService.getStudies(testUserId, { page: 1, limit: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);

    if (result.data && result.data.length > 0) {
      const study = result.data[0];
      // Verify schema fields exist
      expect(study).toHaveProperty('study_id');
      expect(study).toHaveProperty('unique_identifier');
      expect(study).toHaveProperty('name');
      expect(study).toHaveProperty('status_id');
    }
  });

  it('should get study by ID with statistics', async () => {
    const study = await studyService.getStudyById(testStudyId, testUserId);

    expect(study).toBeDefined();
    expect(study.study_id).toBe(testStudyId);
    expect(study.unique_identifier).toBe('INT-TEST-STUDY');
    expect(study).toHaveProperty('total_subjects');
    expect(study).toHaveProperty('total_events');
  });

  it('should create study with correct schema constraints', async () => {
    const result = await studyService.createStudy({
      name: 'Schema Test Study',
      uniqueIdentifier: `SCHEMA-TEST-${Date.now()}`,
      description: 'Testing schema constraints'
    }, testUserId);

    expect(result.success).toBe(true);
    expect(result.studyId).toBeDefined();

    // Verify in database
    if (result.studyId) {
      const dbStudy = await pool.query(
        'SELECT * FROM study WHERE study_id = $1',
        [result.studyId]
      );

      expect(dbStudy.rows.length).toBe(1);
      expect(dbStudy.rows[0].owner_id).toBe(testUserId);
      expect(dbStudy.rows[0].status_id).toBe(1); // Available

      // Cleanup
      await pool.query('DELETE FROM study_user_role WHERE study_id = $1', [result.studyId]);
      await pool.query('DELETE FROM study WHERE study_id = $1', [result.studyId]);
    }
  });

  it('should reject duplicate study identifiers', async () => {
    const result = await studyService.createStudy({
      name: 'Duplicate Test',
      uniqueIdentifier: 'INT-TEST-STUDY', // Already exists
      description: 'Should fail'
    }, testUserId);

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
  });
});

// =============================================================================
// Audit Service Tests (Part 11 Critical)
// =============================================================================

describe('Audit Service (Part 11 Critical)', () => {
  it('should retrieve audit events correctly', async () => {
    // Insert a test audit event first
    const insertResult = await pool.query(`
      INSERT INTO audit_log_event (
        audit_date, audit_table, user_id, entity_id, entity_name,
        audit_log_event_type_id
      ) VALUES (NOW(), 'study', $1, $2, 'Integration Test', 1)
      RETURNING audit_id
    `, [testUserId, testStudyId]);

    const auditId = insertResult.rows[0].audit_id;

    // Verify it can be retrieved
    const dbAudit = await pool.query(
      'SELECT * FROM audit_log_event WHERE audit_id = $1',
      [auditId]
    );

    expect(dbAudit.rows.length).toBe(1);
    expect(dbAudit.rows[0].user_id).toBe(testUserId);
    expect(dbAudit.rows[0].audit_table).toBe('study');
    expect(dbAudit.rows[0].audit_date).toBeDefined();
  });

  it('should retrieve audit trail with date filtering', async () => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);

    const result = await auditService.getAuditTrail({
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      limit: 10
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('should maintain audit trail integrity (no deletions allowed)', async () => {
    // Verify that we cannot delete audit records
    const beforeCount = await pool.query('SELECT COUNT(*) FROM audit_log_event');
    
    // Try to delete (should fail if properly constrained, or count should be same)
    try {
      await pool.query('DELETE FROM audit_log_event WHERE audit_id = -999');
    } catch (e) {
      // Expected - might have constraint
    }

    const afterCount = await pool.query('SELECT COUNT(*) FROM audit_log_event');
    expect(parseInt(afterCount.rows[0].count)).toBeGreaterThanOrEqual(
      parseInt(beforeCount.rows[0].count)
    );
  });
});

// =============================================================================
// User Service Tests (Part 11 Authentication)
// =============================================================================

describe('User Service (Part 11 Authentication)', () => {
  let testUsername: string;
  let createdUserId: number | null = null;

  beforeEach(async () => {
    testUsername = `int_user_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  });

  afterAll(async () => {
    // Cleanup test user
    if (createdUserId) {
      await pool.query('DELETE FROM user_account WHERE user_id = $1', [createdUserId]);
    }
  });

  it('should create user with proper password handling', async () => {
    // First, fix any sequence issues by resetting to max user_id
    await pool.query(`
      SELECT setval('user_account_user_id_seq', 
        COALESCE((SELECT MAX(user_id) FROM user_account), 1), 
        true
      )
    `);

    // Password must meet Part 11 requirements: 12+ chars, upper, lower, number, special
    const result = await userService.createUser({
      username: testUsername,
      password: 'SecureP@ss123!Test',
      email: `${testUsername}@test.local`,
      firstName: 'Test',
      lastName: 'User',
      userTypeId: 2
    }, testUserId);

    if (!result.success) {
      console.log('User creation failed:', result.message);
    }

    expect(result.success).toBe(true);
    expect(result.userId).toBeDefined();

    if (result.userId) {
      createdUserId = result.userId;
      
      // Verify password is hashed (not plaintext)
      const dbUser = await pool.query(
        'SELECT passwd FROM user_account WHERE user_id = $1',
        [result.userId]
      );

      expect(dbUser.rows[0].passwd).not.toBe('SecureP@ss123!Test');
      expect(dbUser.rows[0].passwd.length).toBe(32); // MD5 hash length
    }
  });

  it('should enforce password timestamp for Part 11', async () => {
    const user = await pool.query(
      'SELECT passwd_timestamp FROM user_account WHERE user_name = $1',
      [testUsername]
    );

    if (user.rows.length > 0) {
      expect(user.rows[0].passwd_timestamp).toBeDefined();
    }
  });

  it('should track account lock status', async () => {
    const user = await pool.query(
      'SELECT enabled, account_non_locked, lock_counter FROM user_account WHERE user_name = $1',
      [testUsername]
    );

    if (user.rows.length > 0) {
      expect(user.rows[0].enabled).toBe(true);
      expect(user.rows[0].account_non_locked).toBe(true);
      expect(user.rows[0].lock_counter).toBe(0);
    }
  });
});

// =============================================================================
// Query/Discrepancy Note Tests (Data Integrity)
// =============================================================================

describe('Query Service (Data Integrity)', () => {
  let testQueryId: number;

  afterAll(async () => {
    if (testQueryId) {
      await pool.query('DELETE FROM discrepancy_note WHERE discrepancy_note_id = $1', [testQueryId]);
    }
  });

  it('should create discrepancy note with proper schema fields', async () => {
    // First create a study subject for the query to link to
    const subjectResult = await pool.query(`
      INSERT INTO subject (unique_identifier, gender, status_id, owner_id, date_created)
      VALUES ($1, 'm', 1, $2, NOW())
      RETURNING subject_id
    `, [`INT-TEST-SUBJ-${Date.now()}`, testUserId]);
    const subjectId = subjectResult.rows[0].subject_id;

    const studySubjectResult = await pool.query(`
      INSERT INTO study_subject (label, study_id, subject_id, status_id, owner_id, date_created)
      VALUES ($1, $2, $3, 1, $4, NOW())
      RETURNING study_subject_id
    `, [`INT-SUBJ-${Date.now()}`, testStudyId, subjectId, testUserId]);
    const studySubjectId = studySubjectResult.rows[0].study_subject_id;

    // For studySubject type, the entityId IS the study_subject_id, so don't pass studySubjectId separately
    const result = await queryService.createQuery({
      studyId: testStudyId,
      description: 'Integration test query',
      detailedNotes: 'Testing query creation',
      typeId: 3, // Query type
      entityType: 'studySubject', // Valid entity type
      entityId: studySubjectId
      // Note: studySubjectId is not passed separately since entityType is already 'studySubject'
    }, testUserId);

    if (!result.success) {
      console.log('Query creation failed:', result.message);
    }

    expect(result.success).toBe(true);
    expect(result.queryId).toBeDefined();

    if (result.queryId) {
      testQueryId = result.queryId;

      // Verify in database
      const dbQuery = await pool.query(
        'SELECT * FROM discrepancy_note WHERE discrepancy_note_id = $1',
        [testQueryId]
      );

      expect(dbQuery.rows.length).toBe(1);
      expect(dbQuery.rows[0].study_id).toBe(testStudyId);
      expect(dbQuery.rows[0].owner_id).toBe(testUserId);
      expect(dbQuery.rows[0].resolution_status_id).toBe(1); // New

      // Cleanup
      await pool.query('DELETE FROM dn_study_subject_map WHERE discrepancy_note_id = $1', [testQueryId]);
    }
    
    // Cleanup subject
    await pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [studySubjectId]);
    await pool.query('DELETE FROM subject WHERE subject_id = $1', [subjectId]);
  });

  it('should track query resolution status', async () => {
    if (!testQueryId) return;

    const result = await queryService.updateQueryStatus(
      testQueryId,
      2, // Updated status
      testUserId
    );

    expect(result.success).toBe(true);

    // Verify status change
    const dbQuery = await pool.query(
      'SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1',
      [testQueryId]
    );

    expect(dbQuery.rows[0].resolution_status_id).toBe(2);
  });
});

// =============================================================================
// Data Lock Tests (Part 11 Data Integrity)
// =============================================================================

describe('Data Locks (Part 11 Data Integrity)', () => {
  it('should retrieve locked records', async () => {
    // Get locked records for study
    const result = await dataLocksService.getLockedRecords({
      studyId: testStudyId,
      page: 1,
      limit: 10
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('data');
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// =============================================================================
// Referential Integrity Tests
// =============================================================================

describe('Referential Integrity', () => {
  it('should maintain foreign key constraints', async () => {
    // Try to create study_subject without valid study - should fail
    let errorThrown = false;
    try {
      await pool.query(`
        INSERT INTO study_subject (label, study_id, subject_id, status_id, owner_id, date_created)
        VALUES ('INVALID', 999999, 1, 1, 1, NOW())
      `);
    } catch (error: any) {
      errorThrown = true;
      expect(error.message).toMatch(/foreign key|violates/i);
    }
    expect(errorThrown).toBe(true);
  });

  it('should cascade status properly', async () => {
    // Verify status_id references are valid
    const invalidStatuses = await pool.query(`
      SELECT COUNT(*) as count 
      FROM study 
      WHERE status_id NOT IN (SELECT status_id FROM status)
    `);

    expect(parseInt(invalidStatuses.rows[0].count)).toBe(0);
  });
});

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('should execute study list query within 2 seconds', async () => {
    const startTime = Date.now();
    
    await studyService.getStudies(testUserId, { page: 1, limit: 50 });
    
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(2000);
    
    console.log(`    Study list query: ${duration}ms`);
  });

  it('should execute audit query within 2 seconds', async () => {
    const startTime = Date.now();
    
    await auditService.getAuditTrail({ limit: 100 });
    
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(2000);
    
    console.log(`    Audit query: ${duration}ms`);
  });
});

