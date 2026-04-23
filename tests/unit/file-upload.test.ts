/**
 * File Upload Unit Tests
 *
 * Tests the file upload flow for eCRF forms including:
 * - file_uploads table schema and CRUD
 * - File data saved/retrieved via item_data (comma-separated file IDs)
 * - Event CRF and consent linkage columns
 * - File removal (clearing field value)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from '../utils/test-db';

describe('File Upload in eCRF Forms', () => {
  const userId = 1;
  let testStudyId: number;
  let testCrfId: number;
  let testCrfVersionId: number;
  let testSubjectId: number;
  let testStudySubjectId: number;
  let testEventDefId: number;
  let testStudyEventId: number;
  let testEventCrfId: number;
  let testFileItemId: number;

  beforeAll(async () => {
    // Ensure file_uploads table has the required columns
    await testDb.pool.query(`
      CREATE TABLE IF NOT EXISTS file_uploads (
        file_id VARCHAR(64) PRIMARY KEY,
        original_name VARCHAR(512) NOT NULL,
        stored_name VARCHAR(512) NOT NULL,
        file_path VARCHAR(1024) NOT NULL,
        mime_type VARCHAR(128) NOT NULL,
        file_size INTEGER NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        crf_version_id INTEGER,
        item_id INTEGER,
        crf_version_media_id INTEGER,
        event_crf_id INTEGER,
        study_subject_id INTEGER,
        consent_id INTEGER,
        uploaded_by INTEGER NOT NULL DEFAULT 1,
        uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP,
        deleted_by INTEGER
      )
    `);

    // Add columns if missing (idempotent)
    for (const col of ['event_crf_id INTEGER', 'study_subject_id INTEGER', 'consent_id INTEGER']) {
      const [name] = col.split(' ');
      await testDb.pool.query(`ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    // Create test study
    const studyResult = await testDb.pool.query(`
      INSERT INTO study (unique_identifier, name, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'File Upload Test Study', 1, $2, NOW(), $3)
      RETURNING study_id
    `, [`FILE-TEST-${Date.now()}`, userId, `S_FILE_${Date.now()}`]);
    testStudyId = studyResult.rows[0].studyId;

    // Create CRF with file field
    const crfResult = await testDb.pool.query(`
      INSERT INTO crf (status_id, name, description, owner_id, date_created, oc_oid, source_study_id)
      VALUES (1, 'File Upload CRF', 'CRF with file fields', $1, NOW(), $2, $3)
      RETURNING crf_id
    `, [userId, `F_FILE_${Date.now()}`, testStudyId]);
    testCrfId = crfResult.rows[0].crfId;

    // Create CRF version
    const versionResult = await testDb.pool.query(`
      INSERT INTO crf_version (crf_id, name, description, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, 'v1.0', 'Initial version', 1, $2, NOW(), $3)
      RETURNING crf_version_id
    `, [testCrfId, userId, `F_FILE_v10_${Date.now()}`]);
    testCrfVersionId = versionResult.rows[0].crfVersionId;

    // Create item for file upload field (response_type = 4)
    const itemResult = await testDb.pool.query(`
      INSERT INTO item (name, description, data_type_id, status_id, owner_id, date_created, oc_oid)
      VALUES ('lab_report_upload', 'Lab report file upload field', 9, 1, $1, NOW(), $2)
      RETURNING item_id
    `, [userId, `I_LAB_UPLOAD_${Date.now()}`]);
    testFileItemId = itemResult.rows[0].itemId;

    // Create subject
    const subjectResult = await testDb.pool.query(`
      INSERT INTO subject (date_of_birth, gender, unique_identifier, status_id, date_created, owner_id)
      VALUES ('1990-01-01', 'm', $1, 1, NOW(), $2)
      RETURNING subject_id
    `, [`FILE-SUBJ-${Date.now()}`, userId]);
    testSubjectId = subjectResult.rows[0].subjectId;

    // Create study_subject
    const ssResult = await testDb.pool.query(`
      INSERT INTO study_subject (label, study_id, subject_id, status_id, owner_id, date_created, oc_oid)
      VALUES ($1, $2, $3, 1, $4, NOW(), $5)
      RETURNING study_subject_id
    `, [`FILE-SS-001`, testStudyId, testSubjectId, userId, `SS_FILE_${Date.now()}`]);
    testStudySubjectId = ssResult.rows[0].studySubjectId;

    // Create event definition
    const eventDefResult = await testDb.pool.query(`
      INSERT INTO study_event_definition (study_id, name, description, repeating, type, ordinal, status_id, date_created, oc_oid)
      VALUES ($1, 'File Upload Visit', 'Visit with file uploads', false, 'scheduled', 1, 1, NOW(), $2)
      RETURNING study_event_definition_id
    `, [testStudyId, `SE_FILE_${Date.now()}`]);
    testEventDefId = eventDefResult.rows[0].studyEventDefinitionId;

    // Create study_event
    const seResult = await testDb.pool.query(`
      INSERT INTO study_event (study_event_definition_id, study_subject_id, location, sample_ordinal, date_start, owner_id, status_id, date_created, subject_event_status_id, start_time_flag, end_time_flag)
      VALUES ($1, $2, 'Site 1', 1, NOW(), $3, 1, NOW(), 1, false, false)
      RETURNING study_event_id
    `, [testEventDefId, testStudySubjectId, userId]);
    testStudyEventId = seResult.rows[0].studyEventId;

    // Create event_crf
    const ecResult = await testDb.pool.query(`
      INSERT INTO event_crf (study_event_id, crf_version_id, status_id, owner_id, date_created, date_interviewed, interviewer_name)
      VALUES ($1, $2, 1, $3, NOW(), NOW(), 'Test Interviewer')
      RETURNING event_crf_id
    `, [testStudyEventId, testCrfVersionId, userId]);
    testEventCrfId = ecResult.rows[0].eventCrfId;
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    await testDb.pool.query('DELETE FROM file_uploads WHERE uploaded_by = $1 AND file_id LIKE $2', [userId, 'test_%']);
    await testDb.pool.query('DELETE FROM item_data WHERE event_crf_id = $1', [testEventCrfId]);
    await testDb.pool.query('DELETE FROM event_crf WHERE event_crf_id = $1', [testEventCrfId]);
    await testDb.pool.query('DELETE FROM study_event WHERE study_event_id = $1', [testStudyEventId]);
    await testDb.pool.query('DELETE FROM study_event_definition WHERE study_event_definition_id = $1', [testEventDefId]);
    await testDb.pool.query('DELETE FROM study_subject WHERE study_subject_id = $1', [testStudySubjectId]);
    await testDb.pool.query('DELETE FROM subject WHERE subject_id = $1', [testSubjectId]);
    await testDb.pool.query('DELETE FROM item WHERE item_id = $1', [testFileItemId]);
    await testDb.pool.query('DELETE FROM crf_version WHERE crf_id = $1', [testCrfId]);
    await testDb.pool.query('DELETE FROM crf WHERE crf_id = $1', [testCrfId]);
    await testDb.pool.query('DELETE FROM study WHERE study_id = $1', [testStudyId]);
  });

  // ============================================================
  // file_uploads table schema
  // ============================================================
  describe('file_uploads table schema', () => {

    it('should have event_crf_id column', async () => {
      const result = await testDb.pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'file_uploads' AND column_name = 'event_crf_id'
      `);
      expect(result.rows.length).toBe(1);
    });

    it('should have study_subject_id column', async () => {
      const result = await testDb.pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'file_uploads' AND column_name = 'study_subject_id'
      `);
      expect(result.rows.length).toBe(1);
    });

    it('should have consent_id column', async () => {
      const result = await testDb.pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'file_uploads' AND column_name = 'consent_id'
      `);
      expect(result.rows.length).toBe(1);
    });
  });

  // ============================================================
  // File upload CRUD
  // ============================================================
  describe('File upload CRUD operations', () => {

    it('should insert a file upload record with event_crf_id', async () => {
      const result = await testDb.pool.query(`
        INSERT INTO file_uploads (
          file_id, original_name, stored_name, file_path, mime_type,
          file_size, checksum, crf_version_id, item_id,
          event_crf_id, study_subject_id,
          uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING file_id
      `, [
        'test_file_001', 'lab_report.pdf', 'abc123.pdf', '/uploads/abc123.pdf',
        'application/pdf', 102400, 'md5hash1',
        testCrfVersionId, testFileItemId,
        testEventCrfId, testStudySubjectId,
        userId
      ]);
      expect(result.rows[0].fileId).toBe('test_file_001');
    });

    it('should insert a second file upload for the same field', async () => {
      const result = await testDb.pool.query(`
        INSERT INTO file_uploads (
          file_id, original_name, stored_name, file_path, mime_type,
          file_size, checksum, crf_version_id, item_id,
          event_crf_id, study_subject_id,
          uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING file_id
      `, [
        'test_file_002', 'lab_report_page2.pdf', 'def456.pdf', '/uploads/def456.pdf',
        'application/pdf', 51200, 'md5hash2',
        testCrfVersionId, testFileItemId,
        testEventCrfId, testStudySubjectId,
        userId
      ]);
      expect(result.rows[0].fileId).toBe('test_file_002');
    });

    it('should query files by event_crf_id', async () => {
      const result = await testDb.pool.query(`
        SELECT file_id, original_name, event_crf_id
        FROM file_uploads
        WHERE event_crf_id = $1
        ORDER BY uploaded_at
      `, [testEventCrfId]);
      expect(result.rows.length).toBe(2);
      expect(result.rows[0].fileId).toBe('test_file_001');
      expect(result.rows[1].fileId).toBe('test_file_002');
    });

    it('should query files by item_id', async () => {
      const result = await testDb.pool.query(`
        SELECT file_id FROM file_uploads
        WHERE item_id = $1
        ORDER BY uploaded_at
      `, [testFileItemId]);
      expect(result.rows.length).toBe(2);
    });
  });

  // ============================================================
  // File IDs saved in item_data
  // ============================================================
  describe('File IDs saved as item_data values', () => {

    it('should save comma-separated file IDs as item_data value', async () => {
      const fileIds = 'test_file_001,test_file_002';
      const result = await testDb.pool.query(`
        INSERT INTO item_data (item_id, event_crf_id, value, status_id, owner_id, date_created, ordinal)
        VALUES ($1, $2, $3, 1, $4, NOW(), 1)
        RETURNING item_data_id, value
      `, [testFileItemId, testEventCrfId, fileIds, userId]);

      expect(result.rows[0].value).toBe('test_file_001,test_file_002');
    });

    it('should retrieve file IDs from item_data', async () => {
      const result = await testDb.pool.query(`
        SELECT id.value, i.name as item_name
        FROM item_data id
        JOIN item i ON id.item_id = i.item_id
        WHERE id.event_crf_id = $1 AND i.item_id = $2
      `, [testEventCrfId, testFileItemId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].value).toBe('test_file_001,test_file_002');
      expect(result.rows[0].itemName).toBe('lab_report_upload');

      // Verify the file IDs can be split and resolved
      const fileIds = result.rows[0].value.split(',');
      expect(fileIds).toEqual(['test_file_001', 'test_file_002']);
    });

    it('should resolve file IDs to actual file records', async () => {
      const itemResult = await testDb.pool.query(`
        SELECT value FROM item_data
        WHERE event_crf_id = $1 AND item_id = $2
      `, [testEventCrfId, testFileItemId]);

      const fileIds = itemResult.rows[0].value.split(',');
      
      const filesResult = await testDb.pool.query(`
        SELECT file_id, original_name, mime_type, file_size
        FROM file_uploads
        WHERE file_id = ANY($1)
      `, [fileIds]);

      expect(filesResult.rows.length).toBe(2);
      const names = filesResult.rows.map((r: any) => r.originalName).sort();
      expect(names).toEqual(['lab_report.pdf', 'lab_report_page2.pdf']);
    });

    it('should clear file field value when all files are removed', async () => {
      // This simulates what happens when the user removes all files
      await testDb.pool.query(`
        UPDATE item_data SET value = '', date_updated = NOW()
        WHERE event_crf_id = $1 AND item_id = $2
      `, [testEventCrfId, testFileItemId]);

      const result = await testDb.pool.query(`
        SELECT value FROM item_data
        WHERE event_crf_id = $1 AND item_id = $2
      `, [testEventCrfId, testFileItemId]);

      expect(result.rows[0].value).toBe('');
    });

    it('should update file field value when a file is removed', async () => {
      // Simulate: had two files, one removed, one remaining
      await testDb.pool.query(`
        UPDATE item_data SET value = 'test_file_001', date_updated = NOW()
        WHERE event_crf_id = $1 AND item_id = $2
      `, [testEventCrfId, testFileItemId]);

      const result = await testDb.pool.query(`
        SELECT value FROM item_data
        WHERE event_crf_id = $1 AND item_id = $2
      `, [testEventCrfId, testFileItemId]);

      expect(result.rows[0].value).toBe('test_file_001');

      // The value should have only one file ID now
      const fileIds = result.rows[0].value.split(',').filter((id: string) => id);
      expect(fileIds.length).toBe(1);
    });
  });

  // ============================================================
  // Consent file linkage
  // ============================================================
  describe('Consent file linkage', () => {

    it('should insert a file upload linked to a consent record', async () => {
      const consentId = 999; // Simulated consent ID
      const result = await testDb.pool.query(`
        INSERT INTO file_uploads (
          file_id, original_name, stored_name, file_path, mime_type,
          file_size, checksum, consent_id, study_subject_id,
          uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING file_id, consent_id
      `, [
        'test_consent_scan_001', 'consent_signed.pdf', 'scan001.pdf', '/uploads/scan001.pdf',
        'application/pdf', 204800, 'md5consent1',
        consentId, testStudySubjectId, userId
      ]);
      expect(result.rows[0].consentId).toBe(consentId);
    });

    it('should query files by consent_id', async () => {
      const result = await testDb.pool.query(`
        SELECT file_id, original_name FROM file_uploads
        WHERE consent_id = $1
      `, [999]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].originalName).toBe('consent_signed.pdf');
    });

    it('should update file_uploads to link to consent after creation', async () => {
      // Simulate the flow: upload first, then link to consent
      await testDb.pool.query(`
        INSERT INTO file_uploads (
          file_id, original_name, stored_name, file_path, mime_type,
          file_size, checksum, uploaded_by, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, ['test_unlinked_scan', 'unlinked.pdf', 'unlinked.pdf', '/uploads/unlinked.pdf',
          'application/pdf', 51200, 'md5unlinked', userId]);

      // Now link it to a consent
      await testDb.pool.query(`
        UPDATE file_uploads SET consent_id = $1, study_subject_id = $2
        WHERE file_id = $3
      `, [888, testStudySubjectId, 'test_unlinked_scan']);

      const result = await testDb.pool.query(`
        SELECT consent_id, study_subject_id FROM file_uploads
        WHERE file_id = $1
      `, ['test_unlinked_scan']);
      expect(result.rows[0].consentId).toBe(888);
      expect(result.rows[0].studySubjectId).toBe(testStudySubjectId);
    });
  });

  // ============================================================
  // Cleanup of test file records
  // ============================================================
  afterAll(async () => {
    await testDb.pool.query(
      `DELETE FROM file_uploads WHERE file_id IN ('test_file_001','test_file_002','test_consent_scan_001','test_unlinked_scan')`
    );
  });
});
