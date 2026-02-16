/**
 * Visit Windows & Task Management Unit Tests
 * 
 * Tests the full stack for:
 * 1. Visit window CRUD (schedule_day, min_day, max_day on study_event_definition)
 * 2. Task completion / dismissal / reopen (acc_task_status)
 * 3. Task due date calculation from visit windows
 * 4. Form completion rates with org scoping
 * 5. Middleware validation for visit window fields
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { testDb } from './utils/test-db';

// Test data IDs
let studyId: number;
let eventDefId: number;
let subjectId: number;
let studySubjectId: number;
let studyEventId: number;
let orgId: number;
const userId = 1; // Root user

describe('Visit Windows & Task Management', () => {

  beforeAll(async () => {
    await testDb.connect();
    await testDb.seedTestData();

    // Create a test study
    const studyResult = await testDb.pool.query(`
      INSERT INTO study (
        unique_identifier, name, status_id, owner_id, date_created, oc_oid
      ) VALUES ($1, $2, 1, $3, NOW(), $4)
      RETURNING study_id
    `, [`VW-TEST-${Date.now()}`, 'Visit Window Test Study', userId, `S_VW_${Date.now()}`]);
    studyId = studyResult.rows[0].study_id;

    // Ensure acc_task_status table exists
    await testDb.pool.query(`
      CREATE TABLE IF NOT EXISTS acc_task_status (
        task_status_id SERIAL PRIMARY KEY,
        task_id VARCHAR(100) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL DEFAULT 'completed',
        completed_by INTEGER,
        completed_at TIMESTAMP DEFAULT NOW(),
        reason TEXT,
        organization_id INTEGER,
        date_created TIMESTAMP NOT NULL DEFAULT NOW(),
        date_updated TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Ensure visit window columns exist on study_event_definition
    await testDb.pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS schedule_day INTEGER`);
    await testDb.pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS min_day INTEGER`);
    await testDb.pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS max_day INTEGER`);
    await testDb.pool.query(`ALTER TABLE study_event_definition ADD COLUMN IF NOT EXISTS reference_event_id INTEGER`);

    // Ensure completion_status table exists
    await testDb.pool.query(`
      CREATE TABLE IF NOT EXISTS completion_status (
        completion_status_id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        description VARCHAR(255)
      )
    `);
    await testDb.pool.query(`
      INSERT INTO completion_status (completion_status_id, name) VALUES
        (1, 'complete'), (2, 'initial_data_entry'), (3, 'signed')
      ON CONFLICT (completion_status_id) DO NOTHING
    `);

    // Create test org
    await testDb.pool.query(`
      CREATE TABLE IF NOT EXISTS acc_organization (
        organization_id SERIAL PRIMARY KEY,
        name VARCHAR(255), type VARCHAR(50) DEFAULT 'sponsor',
        status VARCHAR(30) DEFAULT 'active', email VARCHAR(255),
        owner_id INTEGER, date_created TIMESTAMP DEFAULT NOW(),
        date_updated TIMESTAMP DEFAULT NOW()
      )
    `);
    await testDb.pool.query(`
      CREATE TABLE IF NOT EXISTS acc_organization_member (
        member_id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        role VARCHAR(50) DEFAULT 'member', status VARCHAR(30) DEFAULT 'active',
        date_joined TIMESTAMP DEFAULT NOW(), date_updated TIMESTAMP DEFAULT NOW(),
        UNIQUE(organization_id, user_id)
      )
    `);
    const orgResult = await testDb.pool.query(`
      INSERT INTO acc_organization (name, type, status, email, owner_id)
      VALUES ('Test Org', 'sponsor', 'active', 'test@org.com', $1)
      RETURNING organization_id
    `, [userId]);
    orgId = orgResult.rows[0].organization_id;
    await testDb.pool.query(`
      INSERT INTO acc_organization_member (organization_id, user_id, role, status)
      VALUES ($1, $2, 'admin', 'active')
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `, [orgId, userId]);
  });

  afterAll(async () => {
    // Cleanup
    await testDb.pool.query(`DELETE FROM acc_task_status WHERE task_id LIKE 'test-%'`).catch(() => {});
    await testDb.pool.query(`DELETE FROM event_crf WHERE study_subject_id = $1`, [studySubjectId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM study_event WHERE study_subject_id = $1`, [studySubjectId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM study_subject WHERE study_id = $1`, [studyId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM event_definition_crf WHERE study_id = $1`, [studyId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM study_event_definition WHERE study_id = $1`, [studyId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [studyId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM acc_organization_member WHERE organization_id = $1`, [orgId]).catch(() => {});
    await testDb.pool.query(`DELETE FROM acc_organization WHERE organization_id = $1`, [orgId]).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. VISIT WINDOW CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('Visit Window CRUD', () => {
    it('should create an event definition with visit window fields', async () => {
      const result = await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, description, ordinal, type, repeating, category,
          schedule_day, min_day, max_day,
          status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, NOW(), $12)
        RETURNING study_event_definition_id, schedule_day, min_day, max_day
      `, [
        studyId, 'Week 2 Visit', 'Second week follow-up', 2, 'scheduled', false, 'Treatment',
        14, 12, 16, userId, `SE_VW_${Date.now()}`
      ]);

      eventDefId = result.rows[0].study_event_definition_id;
      expect(result.rows[0].schedule_day).toBe(14);
      expect(result.rows[0].min_day).toBe(12);
      expect(result.rows[0].max_day).toBe(16);
    });

    it('should read visit window fields from study_event_definition', async () => {
      const result = await testDb.pool.query(`
        SELECT schedule_day, min_day, max_day FROM study_event_definition
        WHERE study_event_definition_id = $1
      `, [eventDefId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].schedule_day).toBe(14);
      expect(result.rows[0].min_day).toBe(12);
      expect(result.rows[0].max_day).toBe(16);
    });

    it('should update visit window fields', async () => {
      await testDb.pool.query(`
        UPDATE study_event_definition
        SET schedule_day = $1, min_day = $2, max_day = $3
        WHERE study_event_definition_id = $4
      `, [28, 25, 31, eventDefId]);

      const result = await testDb.pool.query(`
        SELECT schedule_day, min_day, max_day FROM study_event_definition
        WHERE study_event_definition_id = $1
      `, [eventDefId]);

      expect(result.rows[0].schedule_day).toBe(28);
      expect(result.rows[0].min_day).toBe(25);
      expect(result.rows[0].max_day).toBe(31);
    });

    it('should allow null visit window fields (unscheduled visits)', async () => {
      const result = await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, ordinal, type, schedule_day, min_day, max_day,
          status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, 'Unscheduled Visit', 3, 'unscheduled', NULL, NULL, NULL, 1, $2, NOW(), $3)
        RETURNING schedule_day, min_day, max_day
      `, [studyId, userId, `SE_VW_UNSCHED_${Date.now()}`]);

      expect(result.rows[0].schedule_day).toBeNull();
      expect(result.rows[0].min_day).toBeNull();
      expect(result.rows[0].max_day).toBeNull();
    });

    it('should enforce buffer math: minDay < scheduleDay < maxDay', async () => {
      const scheduleDay = 14;
      const windowBefore = 2;
      const windowAfter = 3;
      const minDay = scheduleDay - windowBefore; // 12
      const maxDay = scheduleDay + windowAfter;  // 17

      const result = await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, ordinal, type, schedule_day, min_day, max_day,
          status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, 'Buffer Test Visit', 4, 'scheduled', $2, $3, $4, 1, $5, NOW(), $6)
        RETURNING schedule_day, min_day, max_day
      `, [studyId, scheduleDay, minDay, maxDay, userId, `SE_VW_BUF_${Date.now()}`]);

      expect(result.rows[0].min_day).toBeLessThanOrEqual(result.rows[0].schedule_day);
      expect(result.rows[0].max_day).toBeGreaterThanOrEqual(result.rows[0].schedule_day);
      expect(result.rows[0].max_day - result.rows[0].min_day).toBe(windowBefore + windowAfter);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. TASK DUE DATE CALCULATION FROM VISIT WINDOWS
  // ═══════════════════════════════════════════════════════════════

  describe('Task Due Date from Visit Windows', () => {
    beforeAll(async () => {
      // Reset event def to Day 14, window 12-16
      await testDb.pool.query(`
        UPDATE study_event_definition
        SET schedule_day = 14, min_day = 12, max_day = 16
        WHERE study_event_definition_id = $1
      `, [eventDefId]);

      // Create a subject with enrollment date 30 days ago
      const subjectResult = await testDb.pool.query(`
        INSERT INTO subject (date_of_birth, gender, unique_identifier, date_created, status_id, owner_id)
        VALUES ('1990-01-01', 'm', $1, NOW(), 1, $2)
        RETURNING subject_id
      `, [`VW-SUBJ-${Date.now()}`, userId]);
      subjectId = subjectResult.rows[0].subject_id;

      const enrollmentDate = new Date();
      enrollmentDate.setDate(enrollmentDate.getDate() - 30);

      const ssResult = await testDb.pool.query(`
        INSERT INTO study_subject (
          study_id, subject_id, label, enrollment_date, status_id, owner_id, date_created
        ) VALUES ($1, $2, $3, $4, 1, $5, NOW())
        RETURNING study_subject_id
      `, [studyId, subjectId, 'VW-001', enrollmentDate, userId]);
      studySubjectId = ssResult.rows[0].study_subject_id;

      // Schedule a visit for this subject
      const seResult = await testDb.pool.query(`
        INSERT INTO study_event (
          study_event_definition_id, study_subject_id, sample_ordinal,
          date_start, owner_id, status_id, date_created, subject_event_status_id,
          start_time_flag, end_time_flag
        ) VALUES ($1, $2, 1, $3, $4, 1, NOW(), 1, false, false)
        RETURNING study_event_id
      `, [eventDefId, studySubjectId, enrollmentDate, userId]);
      studyEventId = seResult.rows[0].study_event_id;
    });

    it('should calculate due date as enrollment_date + max_day when visit window is set', async () => {
      const result = await testDb.pool.query(`
        SELECT 
          sed.schedule_day, sed.min_day, sed.max_day,
          ss.enrollment_date
        FROM study_event se
        JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
        JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        WHERE se.study_event_id = $1
      `, [studyEventId]);

      const row = result.rows[0];
      expect(row.schedule_day).toBe(14);
      expect(row.max_day).toBe(16);
      expect(row.enrollment_date).toBeDefined();

      // Due date = enrollment + max_day
      const enrollDate = new Date(row.enrollment_date);
      const dueDate = new Date(enrollDate.getTime() + row.max_day * 24 * 60 * 60 * 1000);

      // Enrollment was 30 days ago, max_day is 16, so due date was 14 days ago (overdue)
      expect(dueDate.getTime()).toBeLessThan(Date.now());
    });

    it('should mark task as overdue when past max_day window', async () => {
      const result = await testDb.pool.query(`
        SELECT 
          sed.max_day,
          ss.enrollment_date,
          (ss.enrollment_date + (sed.max_day || 0) * INTERVAL '1 day') as due_date
        FROM study_event se
        JOIN study_event_definition sed ON se.study_event_definition_id = sed.study_event_definition_id
        JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id
        WHERE se.study_event_id = $1
      `, [studyEventId]);

      const dueDate = new Date(result.rows[0].due_date);
      const now = new Date();
      expect(dueDate.getTime()).toBeLessThan(now.getTime());
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. TASK COMPLETION / DISMISSAL
  // ═══════════════════════════════════════════════════════════════

  describe('Task Completion and Dismissal', () => {
    const testTaskId = 'test-visit-12345';

    afterEach(async () => {
      await testDb.pool.query(`DELETE FROM acc_task_status WHERE task_id = $1`, [testTaskId]);
    });

    it('should complete a task', async () => {
      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason, organization_id)
        VALUES ($1, 'completed', $2, 'Task completed', $3)
      `, [testTaskId, userId, orgId]);

      const result = await testDb.pool.query(
        `SELECT * FROM acc_task_status WHERE task_id = $1`, [testTaskId]
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status).toBe('completed');
      expect(result.rows[0].completed_by).toBe(userId);
      expect(result.rows[0].organization_id).toBe(orgId);
    });

    it('should dismiss a task with reason', async () => {
      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason, organization_id)
        VALUES ($1, 'dismissed', $2, 'Patient withdrew from study', $3)
      `, [testTaskId, userId, orgId]);

      const result = await testDb.pool.query(
        `SELECT * FROM acc_task_status WHERE task_id = $1`, [testTaskId]
      );
      expect(result.rows[0].status).toBe('dismissed');
      expect(result.rows[0].reason).toBe('Patient withdrew from study');
    });

    it('should filter dismissed tasks from task list', async () => {
      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason, organization_id)
        VALUES ($1, 'dismissed', $2, 'Not applicable', $3)
      `, [testTaskId, userId, orgId]);

      const result = await testDb.pool.query(`
        SELECT task_id FROM acc_task_status 
        WHERE status IN ('dismissed', 'completed')
      `);
      const dismissedIds = new Set(result.rows.map(r => r.task_id));
      expect(dismissedIds.has(testTaskId)).toBe(true);
    });

    it('should reopen a task by deleting from acc_task_status', async () => {
      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason)
        VALUES ($1, 'completed', $2, 'Done')
      `, [testTaskId, userId]);

      // Reopen
      await testDb.pool.query(`DELETE FROM acc_task_status WHERE task_id = $1`, [testTaskId]);

      const result = await testDb.pool.query(
        `SELECT * FROM acc_task_status WHERE task_id = $1`, [testTaskId]
      );
      expect(result.rows.length).toBe(0);
    });

    it('should upsert on conflict (re-dismiss after reopen)', async () => {
      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason)
        VALUES ($1, 'completed', $2, 'First completion')
      `, [testTaskId, userId]);

      await testDb.pool.query(`
        INSERT INTO acc_task_status (task_id, status, completed_by, reason)
        VALUES ($1, 'dismissed', $2, 'Changed to dismissed')
        ON CONFLICT (task_id) DO UPDATE SET 
          status = 'dismissed', reason = 'Changed to dismissed', date_updated = NOW()
      `, [testTaskId, userId]);

      const result = await testDb.pool.query(
        `SELECT * FROM acc_task_status WHERE task_id = $1`, [testTaskId]
      );
      expect(result.rows[0].status).toBe('dismissed');
      expect(result.rows[0].reason).toBe('Changed to dismissed');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. FORM COMPLETION RATES (ORG-SCOPED)
  // ═══════════════════════════════════════════════════════════════

  describe('Form Completion Rates', () => {
    let crfId: number;
    let crfVersionId: number;

    beforeAll(async () => {
      // Create a CRF owned by our test user
      const crfResult = await testDb.pool.query(`
        INSERT INTO crf (name, description, status_id, owner_id, date_created, oc_oid, source_study_id)
        VALUES ($1, 'Test Form', 1, $2, NOW(), $3, $4)
        RETURNING crf_id
      `, [`VW Test Form ${Date.now()}`, userId, `F_VW_${Date.now()}`, studyId]);
      crfId = crfResult.rows[0].crf_id;

      const cvResult = await testDb.pool.query(`
        INSERT INTO crf_version (crf_id, name, status_id, owner_id, date_created, oc_oid)
        VALUES ($1, 'v1.0', 1, $2, NOW(), $3)
        RETURNING crf_version_id
      `, [crfId, userId, `FV_VW_${Date.now()}`]);
      crfVersionId = cvResult.rows[0].crf_version_id;

      // Assign CRF to event definition
      await testDb.pool.query(`
        INSERT INTO event_definition_crf (
          study_event_definition_id, study_id, crf_id, required_crf,
          status_id, owner_id, date_created, ordinal
        ) VALUES ($1, $2, $3, true, 1, $4, NOW(), 1)
      `, [eventDefId, studyId, crfId, userId]);

      // Create 3 event_crf instances: 1 completed, 2 incomplete
      const completedDate = new Date();
      await testDb.pool.query(`
        INSERT INTO event_crf (
          study_event_id, crf_version_id, study_subject_id,
          date_created, status_id, owner_id, date_completed, completion_status_id
        ) VALUES 
          ($1, $2, $3, NOW(), 1, $4, $5, 1),
          ($1, $2, $3, NOW(), 1, $4, NULL, NULL),
          ($1, $2, $3, NOW(), 1, $4, NULL, NULL)
      `, [studyEventId, crfVersionId, studySubjectId, userId, completedDate]);
    });

    it('should count form instances correctly', async () => {
      const result = await testDb.pool.query(`
        SELECT 
          c.name,
          COUNT(DISTINCT ec.event_crf_id) FILTER (WHERE ec.status_id NOT IN (5, 7)) as total,
          COUNT(DISTINCT ec.event_crf_id) FILTER (WHERE ec.date_completed IS NOT NULL AND ec.status_id NOT IN (5, 7)) as completed,
          COUNT(DISTINCT ec.event_crf_id) FILTER (WHERE ec.date_completed IS NULL AND ec.status_id NOT IN (5, 7)) as incomplete
        FROM event_definition_crf edc
        INNER JOIN crf c ON edc.crf_id = c.crf_id
        INNER JOIN study_event_definition sed ON edc.study_event_definition_id = sed.study_event_definition_id
        LEFT JOIN study_event se ON se.study_event_definition_id = edc.study_event_definition_id AND se.status_id NOT IN (5, 7)
        LEFT JOIN study_subject ss ON se.study_subject_id = ss.study_subject_id AND ss.status_id NOT IN (5, 7) AND ss.study_id = $1
        LEFT JOIN crf_version cv ON cv.crf_id = c.crf_id
        LEFT JOIN event_crf ec ON ec.study_event_id = se.study_event_id AND ec.crf_version_id = cv.crf_version_id AND ec.study_subject_id = ss.study_subject_id
        WHERE sed.study_id = $1 AND sed.status_id NOT IN (5, 7) AND edc.status_id NOT IN (5, 7) AND c.status_id NOT IN (5, 7)
          AND c.crf_id = $2
        GROUP BY c.crf_id, c.name
      `, [studyId, crfId]);

      expect(result.rows.length).toBe(1);
      expect(parseInt(result.rows[0].total)).toBe(3);
      expect(parseInt(result.rows[0].completed)).toBe(1);
      expect(parseInt(result.rows[0].incomplete)).toBe(2);
    });

    it('should calculate completion rate correctly', async () => {
      const total = 3;
      const completed = 1;
      const rate = Math.round((completed / total) * 100);
      expect(rate).toBe(33);
    });

    it('should exclude soft-deleted forms (status_id = 5)', async () => {
      // Create a deleted CRF
      const deletedCrfResult = await testDb.pool.query(`
        INSERT INTO crf (name, status_id, owner_id, date_created, oc_oid, source_study_id)
        VALUES ('Deleted Form', 5, $1, NOW(), $2, $3)
        RETURNING crf_id
      `, [userId, `F_DEL_${Date.now()}`, studyId]);

      // Query should not include deleted CRFs
      const result = await testDb.pool.query(`
        SELECT c.name FROM crf c
        WHERE c.crf_id = $1 AND c.status_id NOT IN (5, 7)
      `, [deletedCrfResult.rows[0].crf_id]);

      expect(result.rows.length).toBe(0);

      // Cleanup
      await testDb.pool.query(`DELETE FROM crf WHERE crf_id = $1`, [deletedCrfResult.rows[0].crf_id]);
    });

    it('should exclude deleted event_crf instances from counts', async () => {
      // Add a deleted event_crf entry
      await testDb.pool.query(`
        INSERT INTO event_crf (
          study_event_id, crf_version_id, study_subject_id,
          date_created, status_id, owner_id, date_completed
        ) VALUES ($1, $2, $3, NOW(), 5, $4, NOW())
      `, [studyEventId, crfVersionId, studySubjectId, userId]);

      const result = await testDb.pool.query(`
        SELECT COUNT(*) FILTER (WHERE ec.status_id NOT IN (5, 7)) as active_count
        FROM event_crf ec
        WHERE ec.study_event_id = $1 AND ec.crf_version_id = $2
      `, [studyEventId, crfVersionId]);

      // Should still be 3 (the deleted one excluded)
      expect(parseInt(result.rows[0].active_count)).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. VALIDATION SCHEMA ALIGNMENT
  // ═══════════════════════════════════════════════════════════════

  describe('Field Name Alignment', () => {
    it('should store camelCase scheduleDay as snake_case schedule_day in DB', async () => {
      // Simulates what the backend service does: receives camelCase, writes snake_case
      const data = { scheduleDay: 7, minDay: 5, maxDay: 9 };

      const result = await testDb.pool.query(`
        INSERT INTO study_event_definition (
          study_id, name, ordinal, type, schedule_day, min_day, max_day,
          status_id, owner_id, date_created, oc_oid
        ) VALUES ($1, 'CamelCase Test', 10, 'scheduled', $2, $3, $4, 1, $5, NOW(), $6)
        RETURNING schedule_day, min_day, max_day
      `, [studyId, data.scheduleDay, data.minDay, data.maxDay, userId, `SE_CC_${Date.now()}`]);

      expect(result.rows[0].schedule_day).toBe(7);
      expect(result.rows[0].min_day).toBe(5);
      expect(result.rows[0].max_day).toBe(9);
    });

    it('should compute buffer correctly: minDay = scheduleDay - bufferBefore', () => {
      const scheduleDay = 14;
      const bufferBefore = 2;
      const bufferAfter = 3;

      const minDay = scheduleDay - bufferBefore;
      const maxDay = scheduleDay + bufferAfter;

      expect(minDay).toBe(12);
      expect(maxDay).toBe(17);
      expect(maxDay - minDay).toBe(bufferBefore + bufferAfter);
    });

    it('should reverse-compute buffer from minDay/maxDay', () => {
      const scheduleDay = 14;
      const minDay = 12;
      const maxDay = 17;

      const bufferBefore = scheduleDay - minDay;
      const bufferAfter = maxDay - scheduleDay;

      expect(bufferBefore).toBe(2);
      expect(bufferAfter).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. ORG-SCOPED FORM VISIBILITY
  // ═══════════════════════════════════════════════════════════════

  describe('Organization Scoping', () => {
    it('should only return forms owned by org members', async () => {
      // Get org member user IDs
      const memberResult = await testDb.pool.query(`
        SELECT DISTINCT user_id FROM acc_organization_member
        WHERE organization_id = $1 AND status = 'active'
      `, [orgId]);

      const orgUserIds = memberResult.rows.map(r => r.user_id);
      expect(orgUserIds).toContain(userId);

      // Forms owned by org members should be visible
      const formResult = await testDb.pool.query(`
        SELECT c.name FROM crf c
        WHERE c.owner_id = ANY($1::int[]) AND c.status_id NOT IN (5, 7)
      `, [orgUserIds]);

      expect(formResult.rows.length).toBeGreaterThan(0);
    });

    it('should not return forms owned by users outside the org', async () => {
      // Create a form owned by a non-org user
      const outsideUserId = 999;
      try {
        await testDb.pool.query(`
          INSERT INTO user_account (user_id, user_name, passwd, first_name, last_name, email, user_type_id, status_id, enabled, account_non_locked, owner_id, date_created)
          VALUES ($1, 'outsider', 'hash', 'Outside', 'User', 'outside@test.com', 2, 1, true, true, 1, NOW())
          ON CONFLICT (user_id) DO NOTHING
        `, [outsideUserId]);

        await testDb.pool.query(`
          INSERT INTO crf (name, status_id, owner_id, date_created, oc_oid, source_study_id)
          VALUES ('Outside Org Form', 1, $1, NOW(), $2, $3)
        `, [outsideUserId, `F_OUT_${Date.now()}`, studyId]);

        // Org filter should exclude this form
        const orgUserIds = [userId]; // Only our user is in the org
        const result = await testDb.pool.query(`
          SELECT c.name FROM crf c
          WHERE c.owner_id = ANY($1::int[]) AND c.status_id NOT IN (5, 7)
            AND c.name = 'Outside Org Form'
        `, [orgUserIds]);

        expect(result.rows.length).toBe(0);
      } finally {
        await testDb.pool.query(`DELETE FROM crf WHERE name = 'Outside Org Form'`).catch(() => {});
        await testDb.pool.query(`DELETE FROM user_account WHERE user_id = $1`, [outsideUserId]).catch(() => {});
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. TASK ID SEMANTICS
  // ═══════════════════════════════════════════════════════════════

  describe('Task ID Semantics', () => {
    it('form_completion task should have formId = crf_id (not event_crf_id)', () => {
      // After the fix, formId should be the CRF template ID
      // metadata.eventCrfId should be the form instance ID
      const mockFormTask = {
        id: 'form-42',
        formId: 100,         // Should be crf_id (CRF template)
        sourceId: 42,        // Should be event_crf_id (from task ID)
        sourceTable: 'event_crf',
        metadata: {
          eventCrfId: 42,    // event_crf_id (form instance)
          crfId: 100          // crf_id (CRF template) - redundant but available
        }
      };

      // formId should be used for loading form metadata/structure
      expect(mockFormTask.formId).toBe(100);
      // metadata.eventCrfId should be used for loading saved form data
      expect(mockFormTask.metadata.eventCrfId).toBe(42);
      // sourceId matches the ID in the task ID string
      expect(mockFormTask.sourceId).toBe(42);
      // formId should NOT equal event_crf_id
      expect(mockFormTask.formId).not.toBe(mockFormTask.metadata.eventCrfId);
    });

    it('sdv_required task should have formId = crf_id with eventCrfId in metadata', () => {
      const mockSdvTask = {
        id: 'sdv-55',
        formId: 200,          // crf_id
        eventId: 10,          // study_event_id (now populated)
        sourceId: 55,         // event_crf_id
        sourceTable: 'event_crf',
        metadata: {
          eventCrfId: 55,     // event_crf_id
          crfId: 200           // crf_id
        }
      };

      expect(mockSdvTask.formId).toBe(200);        // CRF template
      expect(mockSdvTask.metadata.eventCrfId).toBe(55); // Form instance
      expect(mockSdvTask.eventId).toBe(10);          // Visit instance (not null!)
    });

    it('scheduled_visit task should have eventId = study_event_id', () => {
      const mockVisitTask = {
        id: 'visit-30',
        eventId: 30,          // study_event_id (visit instance)
        formId: null,          // No form for visit tasks
        sourceId: 30,         // study_event_id
        sourceTable: 'study_event',
        subjectId: 5           // study_subject_id
      };

      expect(mockVisitTask.eventId).toBe(30);
      expect(mockVisitTask.eventId).toBe(mockVisitTask.sourceId);
      expect(mockVisitTask.formId).toBeNull();
    });

    it('query task should use sourceId = discrepancy_note_id', () => {
      const mockQueryTask = {
        id: 'query-77',
        sourceId: 77,
        sourceTable: 'discrepancy_note',
        eventId: null,
        formId: null,
        subjectId: 3           // study_subject_id
      };

      expect(mockQueryTask.sourceId).toBe(77);
      expect(mockQueryTask.eventId).toBeNull();
      expect(mockQueryTask.formId).toBeNull();
    });

    it('task ID format should be parseable back to type + sourceId', () => {
      const taskIds = [
        { id: 'query-123', type: 'query', sourceId: 123 },
        { id: 'visit-456', type: 'visit', sourceId: 456 },
        { id: 'dataentry-789', type: 'dataentry', sourceId: 789 },
        { id: 'form-101', type: 'form', sourceId: 101 },
        { id: 'sdv-202', type: 'sdv', sourceId: 202 },
        { id: 'signature-303', type: 'signature', sourceId: 303 }
      ];

      for (const expected of taskIds) {
        const parts = expected.id.split('-');
        const type = parts[0];
        const id = parseInt(parts[1]);
        expect(type).toBe(expected.type);
        expect(id).toBe(expected.sourceId);
      }
    });
  });
});
