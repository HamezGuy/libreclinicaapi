/**
 * Test Data Fixtures
 * Helper functions to create test data for unit tests
 */

import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

/**
 * Create a test user
 */
export const createTestUser = async (
  pool: Pool,
  overrides?: {
    username?: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    userTypeId?: number;
  }
): Promise<number> => {
  const username = overrides?.username || `testuser_${Date.now()}`;
  const email = overrides?.email || `${username}@test.com`;
  const password = overrides?.password || 'Test123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(`
    INSERT INTO user_account (
      user_name, passwd, first_name, last_name, email, user_type_id, status_id, enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, true)
    RETURNING user_id
  `, [
    username,
    hashedPassword,
    overrides?.firstName || 'Test',
    overrides?.lastName || 'User',
    email,
    overrides?.userTypeId || 2 // Regular user
  ]);

  return result.rows[0].user_id;
};

/**
 * Create a test study
 */
export const createTestStudy = async (
  pool: Pool,
  userId: number,
  overrides?: {
    name?: string;
    uniqueIdentifier?: string;
    description?: string;
    principalInvestigator?: string;
    sponsor?: string;
    statusId?: number;
  }
): Promise<number> => {
  const uniqueId = overrides?.uniqueIdentifier || `TEST-STUDY-${Date.now()}`;

  // Note: study table does NOT have type_id column - using protocol_type instead
  const result = await pool.query(`
    INSERT INTO study (
      unique_identifier, name, summary, principal_investigator, sponsor,
      status_id, owner_id, date_created, oc_oid, protocol_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, 'interventional')
    RETURNING study_id
  `, [
    uniqueId,
    overrides?.name || 'Test Study',
    overrides?.description || 'Test study description',
    overrides?.principalInvestigator || 'Dr. Test',
    overrides?.sponsor || 'Test Sponsor',
    overrides?.statusId || 1,
    userId,
    `S_${uniqueId.replace(/[^a-zA-Z0-9]/g, '_')}`
  ]);

  const studyId = result.rows[0].study_id;

  // Assign user to study with admin role
  const userResult = await pool.query('SELECT user_name FROM user_account WHERE user_id = $1', [userId]);
  if (userResult.rows.length > 0) {
    await pool.query(`
      INSERT INTO study_user_role (role_name, study_id, status_id, owner_id, user_name, date_created)
      VALUES ('admin', $1, 1, $2, $3, NOW())
    `, [studyId, userId, userResult.rows[0].user_name]);
  }

  return studyId;
};

/**
 * Create a test subject
 */
export const createTestSubject = async (
  pool: Pool,
  studyId: number,
  overrides?: {
    label?: string;
    secondaryLabel?: string;
    statusId?: number;
  }
): Promise<number> => {
  const label = overrides?.label || `SUB-${Date.now().toString(36)}`;
  const ocOid = `SS_${label.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`;

  // First create the subject record
  const subjectResult = await pool.query(`
    INSERT INTO subject (status_id, date_created, owner_id, unique_identifier)
    VALUES ($1, NOW(), 1, $2)
    RETURNING subject_id
  `, [overrides?.statusId || 1, label]);

  const subjectId = subjectResult.rows[0].subject_id;

  // Then create the study_subject record with required oc_oid
  const result = await pool.query(`
    INSERT INTO study_subject (
      label, secondary_label, subject_id, study_id, status_id, enrollment_date, date_created, oc_oid, owner_id
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, 1)
    RETURNING study_subject_id
  `, [
    label,
    overrides?.secondaryLabel || null,
    subjectId,
    studyId,
    overrides?.statusId || 1,
    ocOid
  ]);

  return result.rows[0].study_subject_id;
};

/**
 * Create a test event definition
 */
export const createTestEventDefinition = async (
  pool: Pool,
  studyId: number,
  overrides?: {
    name?: string;
    description?: string;
    repeating?: boolean;
    type?: string;
    ordinal?: number;
  }
): Promise<number> => {
  const result = await pool.query(`
    INSERT INTO study_event_definition (
      study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), $7)
    RETURNING study_event_definition_id
  `, [
    studyId,
    overrides?.name || 'Test Event',
    overrides?.description || 'Test event description',
    overrides?.repeating || false,
    overrides?.type || 'scheduled',
    overrides?.ordinal || 1,
    `SE_${Date.now()}`
  ]);

  return result.rows[0].study_event_definition_id;
};

/**
 * Create a test CRF
 */
export const createTestCRF = async (
  pool: Pool,
  studyId: number,
  overrides?: {
    name?: string;
    description?: string;
  }
): Promise<number> => {
  const result = await pool.query(`
    INSERT INTO crf (
      study_id, name, description, owner_id, date_created, status_id, oc_oid
    ) VALUES ($1, $2, $3, 1, NOW(), 1, $4)
    RETURNING crf_id
  `, [
    studyId,
    overrides?.name || 'Test CRF',
    overrides?.description || 'Test CRF description',
    `F_${Date.now()}`
  ]);

  const crfId = result.rows[0].crf_id;

  // Create a default version
  await pool.query(`
    INSERT INTO crf_version (
      crf_id, name, description, date_created, owner_id, status_id, oc_oid
    ) VALUES ($1, 'v1.0', 'Initial version', NOW(), 1, 1, $2)
  `, [crfId, `FV_${Date.now()}`]);

  return crfId;
};

/**
 * Create a test item (question)
 */
export const createTestItem = async (
  pool: Pool,
  overrides?: {
    name?: string;
    description?: string;
    units?: string;
  }
): Promise<number> => {
  const result = await pool.query(`
    INSERT INTO item (
      name, description, units, phi_status, status_id, owner_id, date_created, oc_oid
    ) VALUES ($1, $2, $3, false, 1, 1, NOW(), $4)
    RETURNING item_id
  `, [
    overrides?.name || `item_${Date.now()}`,
    overrides?.description || 'Test item',
    overrides?.units || null,
    `I_${Date.now()}`
  ]);

  return result.rows[0].item_id;
};

/**
 * Create a test discrepancy note (query)
 */
export const createTestQuery = async (
  pool: Pool,
  studyId: number,
  userId: number,
  overrides?: {
    description?: string;
    detailedNotes?: string;
    typeId?: number;
  }
): Promise<number> => {
  const result = await pool.query(`
    INSERT INTO discrepancy_note (
      description, discrepancy_note_type_id, resolution_status_id,
      detailed_notes, date_created, owner_id, study_id
    ) VALUES ($1, $2, 1, $3, NOW(), $4, $5)
    RETURNING discrepancy_note_id
  `, [
    overrides?.description || 'Test query',
    overrides?.typeId || 3, // Query type
    overrides?.detailedNotes || 'Test query details',
    userId,
    studyId
  ]);

  return result.rows[0].discrepancy_note_id;
};

/**
 * Clean all test data
 */
export const cleanAllTestData = async (pool: Pool): Promise<void> => {
  const tables = [
    'item_data',
    'event_crf',
    'study_event',
    'study_subject',
    'subject',
    'discrepancy_note',
    'study_user_role',
    'crf_version',
    'crf',
    'study_event_definition',
    'study',
    'user_account',
    'audit_log_event',
    'audit_user_api_log'
  ];

  for (const table of tables) {
    try {
      await pool.query(`DELETE FROM ${table} WHERE 1=1`);
    } catch (error) {
      // Ignore errors for tables that might not exist or have dependencies
    }
  }
};

/**
 * Generate a test JWT token
 */
export const generateTestToken = (userId: number, username: string = 'testuser'): string => {
  // This is a simplified version - in real tests, use the actual JWT util
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { userId, username, userType: 'user' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
};
