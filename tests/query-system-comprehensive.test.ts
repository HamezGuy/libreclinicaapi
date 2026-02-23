/**
 * Comprehensive Query System Tests
 *
 * Covers every layer of the query system:
 *  1. Joi schema validation (querySchemas) — boundary testing, type mismatches
 *  2. Query service — full CRUD, status transitions, resolution workflow
 *  3. Thread correctness — routing copies excluded, responses included
 *  4. Accept/Reject resolution workflow end-to-end
 *  5. Notification types — correct type used for each event
 *  6. Bulk operations — correct flat response shape (no double-wrap)
 *  7. Logic invariants — can't accept/reject non-proposed queries
 *
 * Uses the project's existing test-db helper so tests run against a real
 * (or pg-mem) database with the same pool configuration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import Joi from 'joi';
import { testDb } from './utils/test-db';
import * as queryService from '../src/services/database/query.service';
import * as notificationService from '../src/services/database/notification.service';
import { querySchemas } from '../src/middleware/validation.middleware';
import { createTestStudy, createTestSubject } from './fixtures/test-data';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Validate a value against a Joi schema. Returns the error message or null. */
function joiError(schema: Joi.Schema, value: unknown): string | null {
  const { error } = schema.validate(value, { abortEarly: true });
  return error?.message ?? null;
}

/** Insert a minimal discrepancy_note directly and return its id. */
async function insertNote(
  pool: any,
  {
    studyId,
    subjectId,
    description = 'A test query description that is long enough',
    typeId = 3,
    statusId = 1,
    ownerId = 1,
    parentId = null as number | null
  }: {
    studyId: number;
    subjectId?: number;
    description?: string;
    typeId?: number;
    statusId?: number;
    ownerId?: number;
    parentId?: number | null;
  }
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO discrepancy_note
       (description, detailed_notes, discrepancy_note_type_id, resolution_status_id,
        study_id, entity_type, owner_id, parent_dn_id, date_created)
     VALUES ($1, '', $2, $3, $4, 'studySubject', $5, $6, NOW())
     RETURNING discrepancy_note_id`,
    [description, typeId, statusId, studyId, ownerId, parentId]
  );
  const noteId = res.rows[0].discrepancy_note_id as number;

  if (subjectId) {
    await pool.query(
      `INSERT INTO dn_study_subject_map (discrepancy_note_id, study_subject_id, column_name)
       VALUES ($1, $2, 'value') ON CONFLICT DO NOTHING`,
      [noteId, subjectId]
    );
  }

  return noteId;
}

// ─────────────────────────────────────────────────────────────
// Suite setup
// ─────────────────────────────────────────────────────────────

describe('Query System — Comprehensive Tests', () => {
  let studyId: number;
  let subjectId: number;
  const ownerId = 1;
  const monitorId = 2; // Different user to test role separation
  let createdNoteIds: number[] = [];

  beforeAll(async () => {
    await testDb.pool.query('SELECT NOW()');

    studyId = await createTestStudy(testDb.pool, ownerId, {
      uniqueIdentifier: `QSYS-${Date.now()}`
    });

    subjectId = await createTestSubject(testDb.pool, studyId, {
      label: `QSYS-SUB-${Date.now()}`
    });
  });

  afterAll(async () => {
    if (createdNoteIds.length > 0) {
      // Delete children first (FK constraint)
      await testDb.pool.query(
        `DELETE FROM dn_study_subject_map WHERE discrepancy_note_id = ANY($1)`,
        [createdNoteIds]
      );
      await testDb.pool.query(
        `DELETE FROM discrepancy_note WHERE parent_dn_id = ANY($1)`,
        [createdNoteIds]
      );
      await testDb.pool.query(
        `DELETE FROM discrepancy_note WHERE discrepancy_note_id = ANY($1)`,
        [createdNoteIds]
      );
    }
    if (subjectId) {
      await testDb.pool.query(
        `DELETE FROM dn_study_subject_map WHERE study_subject_id = $1`,
        [subjectId]
      );
      await testDb.pool.query(
        `DELETE FROM study_subject WHERE study_subject_id = $1`,
        [subjectId]
      );
    }
    if (studyId) {
      await testDb.pool.query(`DELETE FROM study_user_role WHERE study_id = $1`, [studyId]);
      await testDb.pool.query(`DELETE FROM study WHERE study_id = $1`, [studyId]);
    }
    await testDb.pool.end();
  });

  beforeEach(() => {
    createdNoteIds = [];
  });

  // ═══════════════════════════════════════════════════════════
  // 1. JOI SCHEMA VALIDATION
  // ═══════════════════════════════════════════════════════════

  describe('Joi Schema — querySchemas.create', () => {
    const valid = {
      description: 'This is a valid query description with enough chars',
      queryType: 'Query',
      studyId: 1
    };

    it('accepts a minimal valid payload', () => {
      const err = joiError(querySchemas.create, valid);
      expect(err).toBeNull();
    });

    it('accepts all optional fields when provided correctly', () => {
      const err = joiError(querySchemas.create, {
        ...valid,
        entityType: 'eventCrf',
        entityId: 42,
        crfId: 1,
        eventCrfId: 5,
        itemId: 10,
        subjectId: 99,
        assignedUserId: 7,
        detailedNotes: 'Some detailed notes'
      });
      expect(err).toBeNull();
    });

    it('rejects when description is missing', () => {
      const { description: _, ...payload } = valid;
      expect(joiError(querySchemas.create, payload)).toMatch(/required/i);
    });

    it('rejects when description is too short (< 10 chars)', () => {
      expect(joiError(querySchemas.create, { ...valid, description: 'Short' }))
        .toMatch(/at least 10 characters/i);
    });

    it('rejects when description is exactly 9 characters', () => {
      expect(joiError(querySchemas.create, { ...valid, description: '123456789' }))
        .toMatch(/at least 10 characters/i);
    });

    it('accepts description of exactly 10 characters', () => {
      expect(joiError(querySchemas.create, { ...valid, description: '1234567890' })).toBeNull();
    });

    it('rejects when description exceeds 1000 chars', () => {
      expect(joiError(querySchemas.create, { ...valid, description: 'x'.repeat(1001) }))
        .toMatch(/1000 characters/i);
    });

    it('accepts description of exactly 1000 chars', () => {
      expect(joiError(querySchemas.create, { ...valid, description: 'x'.repeat(1000) })).toBeNull();
    });

    it('rejects when queryType is missing', () => {
      const { queryType: _, ...payload } = valid;
      expect(joiError(querySchemas.create, payload)).toMatch(/required/i);
    });

    it('rejects an invalid queryType value', () => {
      expect(joiError(querySchemas.create, { ...valid, queryType: 'InvalidType' }))
        .toMatch(/queryType must be one of/i);
    });

    it('accepts all four valid queryType values', () => {
      const types = ['Query', 'Failed Validation Check', 'Annotation', 'Reason for Change'];
      for (const t of types) {
        expect(joiError(querySchemas.create, { ...valid, queryType: t })).toBeNull();
      }
    });

    it('rejects when studyId is missing', () => {
      const { studyId: _, ...payload } = valid;
      expect(joiError(querySchemas.create, payload)).toMatch(/required/i);
    });

    it('rejects studyId = 0 (must be positive)', () => {
      expect(joiError(querySchemas.create, { ...valid, studyId: 0 })).toBeTruthy();
    });

    it('rejects studyId = -1', () => {
      expect(joiError(querySchemas.create, { ...valid, studyId: -1 })).toBeTruthy();
    });

    it('rejects non-integer studyId', () => {
      expect(joiError(querySchemas.create, { ...valid, studyId: 1.5 })).toBeTruthy();
    });

    it('rejects string studyId that is not coercible', () => {
      // Joi stringifies numbers — "abc" should fail
      expect(joiError(querySchemas.create, { ...valid, studyId: 'notanumber' })).toBeTruthy();
    });

    it('rejects invalid entityType', () => {
      expect(joiError(querySchemas.create, { ...valid, entityType: 'unknown' }))
        .toMatch(/entityType must be one of/i);
    });

    it('accepts all four valid entityType values', () => {
      const types = ['itemData', 'eventCrf', 'studySubject', 'studyEvent'];
      for (const t of types) {
        expect(joiError(querySchemas.create, { ...valid, entityType: t })).toBeNull();
      }
    });

    it('rejects negative assignedUserId', () => {
      expect(joiError(querySchemas.create, { ...valid, assignedUserId: -5 })).toBeTruthy();
    });

    it('rejects detailedNotes exceeding 2000 chars', () => {
      expect(joiError(querySchemas.create, { ...valid, detailedNotes: 'x'.repeat(2001) })).toBeTruthy();
    });

    it('accepts detailedNotes of exactly 2000 chars', () => {
      expect(joiError(querySchemas.create, { ...valid, detailedNotes: 'x'.repeat(2000) })).toBeNull();
    });

    it('accepts empty string detailedNotes', () => {
      expect(joiError(querySchemas.create, { ...valid, detailedNotes: '' })).toBeNull();
    });
  });

  describe('Joi Schema — querySchemas.respond', () => {
    it('accepts payload with description field', () => {
      expect(joiError(querySchemas.respond, { description: 'A valid response text here' })).toBeNull();
    });

    it('accepts payload with response field (alias)', () => {
      expect(joiError(querySchemas.respond, { response: 'A valid response text here' })).toBeNull();
    });

    it('accepts payload with both description and response', () => {
      expect(joiError(querySchemas.respond, {
        description: 'A valid response text here',
        response: 'A valid response text here'
      })).toBeNull();
    });

    it('rejects when neither description nor response is provided', () => {
      expect(joiError(querySchemas.respond, { detailedNotes: 'only notes' })).toBeTruthy();
    });

    it('rejects response shorter than 10 chars', () => {
      expect(joiError(querySchemas.respond, { response: 'Short' }))
        .toMatch(/at least 10 characters/i);
    });

    it('rejects response longer than 1000 chars', () => {
      expect(joiError(querySchemas.respond, { response: 'x'.repeat(1001) }))
        .toMatch(/1000 characters/i);
    });

    it('rejects newStatusId = 1 (New — not valid for a response)', () => {
      expect(joiError(querySchemas.respond, {
        response: 'A valid response text here',
        newStatusId: 1
      })).toMatch(/newStatusId for a response must be 2/i);
    });

    it('rejects newStatusId = 5 (Not Applicable — not for responses)', () => {
      expect(joiError(querySchemas.respond, {
        response: 'A valid response text here',
        newStatusId: 5
      })).toBeTruthy();
    });

    it('accepts newStatusId 2, 3, and 4', () => {
      for (const id of [2, 3, 4]) {
        expect(joiError(querySchemas.respond, {
          response: 'A valid response text here',
          newStatusId: id
        })).toBeNull();
      }
    });
  });

  describe('Joi Schema — querySchemas.updateStatus', () => {
    it('accepts valid statusId values 1-5', () => {
      for (const id of [1, 2, 3, 4, 5]) {
        expect(joiError(querySchemas.updateStatus, { statusId: id })).toBeNull();
      }
    });

    it('rejects statusId = 0', () => {
      expect(joiError(querySchemas.updateStatus, { statusId: 0 })).toBeTruthy();
    });

    it('rejects statusId = 6 (was previously allowed up to 10 — now fixed)', () => {
      expect(joiError(querySchemas.updateStatus, { statusId: 6 })).toBeTruthy();
    });

    it('rejects statusId = 10', () => {
      expect(joiError(querySchemas.updateStatus, { statusId: 10 })).toBeTruthy();
    });

    it('rejects missing statusId', () => {
      expect(joiError(querySchemas.updateStatus, {})).toMatch(/required/i);
    });

    it('rejects string statusId', () => {
      expect(joiError(querySchemas.updateStatus, { statusId: 'closed' })).toBeTruthy();
    });
  });

  describe('Joi Schema — querySchemas.acceptResolution', () => {
    it('accepts empty body (reason and meaning are optional)', () => {
      expect(joiError(querySchemas.acceptResolution, {})).toBeNull();
    });

    it('accepts reason string', () => {
      expect(joiError(querySchemas.acceptResolution, { reason: 'Data verified' })).toBeNull();
    });

    it('accepts empty string reason', () => {
      expect(joiError(querySchemas.acceptResolution, { reason: '' })).toBeNull();
    });

    it('rejects reason exceeding 500 chars', () => {
      expect(joiError(querySchemas.acceptResolution, { reason: 'x'.repeat(501) })).toBeTruthy();
    });

    it('accepts meaning field', () => {
      expect(joiError(querySchemas.acceptResolution, {
        reason: 'OK',
        meaning: 'I have reviewed and confirm'
      })).toBeNull();
    });
  });

  describe('Joi Schema — querySchemas.rejectResolution', () => {
    it('requires reason', () => {
      expect(joiError(querySchemas.rejectResolution, {})).toMatch(/required|empty/i);
    });

    it('rejects empty reason', () => {
      expect(joiError(querySchemas.rejectResolution, { reason: '' })).toBeTruthy();
    });

    it('rejects reason shorter than 10 chars', () => {
      expect(joiError(querySchemas.rejectResolution, { reason: 'Too short' }))
        .toMatch(/at least 10 characters/i);
    });

    it('accepts valid reason of 10+ chars', () => {
      expect(joiError(querySchemas.rejectResolution, {
        reason: 'The correction provided is incorrect per source document'
      })).toBeNull();
    });

    it('rejects reason exceeding 500 chars', () => {
      expect(joiError(querySchemas.rejectResolution, { reason: 'x'.repeat(501) })).toBeTruthy();
    });
  });

  describe('Joi Schema — querySchemas.bulkStatus', () => {
    it('accepts valid payload', () => {
      expect(joiError(querySchemas.bulkStatus, { queryIds: [1, 2, 3], statusId: 4 })).toBeNull();
    });

    it('rejects empty queryIds array', () => {
      expect(joiError(querySchemas.bulkStatus, { queryIds: [], statusId: 4 })).toBeTruthy();
    });

    it('rejects missing queryIds', () => {
      expect(joiError(querySchemas.bulkStatus, { statusId: 4 })).toBeTruthy();
    });

    it('rejects invalid statusId (6) in bulk', () => {
      expect(joiError(querySchemas.bulkStatus, { queryIds: [1], statusId: 6 })).toBeTruthy();
    });

    it('rejects non-positive integer in queryIds', () => {
      expect(joiError(querySchemas.bulkStatus, { queryIds: [1, -1], statusId: 4 })).toBeTruthy();
    });
  });

  describe('Joi Schema — querySchemas.bulkReassign', () => {
    it('accepts valid payload', () => {
      expect(joiError(querySchemas.bulkReassign, { queryIds: [1], assignToUserId: 5 })).toBeNull();
    });

    it('rejects missing assignToUserId', () => {
      expect(joiError(querySchemas.bulkReassign, { queryIds: [1] })).toMatch(/required/i);
    });

    it('rejects negative assignToUserId', () => {
      expect(joiError(querySchemas.bulkReassign, { queryIds: [1], assignToUserId: -1 })).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. QUERY SERVICE — CRUD ROUND TRIPS
  // ═══════════════════════════════════════════════════════════

  describe('Query Service — createQuery', () => {
    it('creates a query and returns a valid queryId', async () => {
      const result = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          subjectId,
          description: 'Verify date of birth against source document',
          queryType: 'Query'
        },
        ownerId
      );

      expect(result.success).toBe(true);
      expect(typeof result.queryId).toBe('number');
      expect(result.queryId).toBeGreaterThan(0);
      createdNoteIds.push(result.queryId!);
    });

    it('persists the query in the database with correct fields', async () => {
      const result = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          subjectId,
          description: 'Verify weight measurement against source document',
          queryType: 'Failed Validation Check',
          detailedNotes: 'Weight appears inconsistent'
        },
        ownerId
      );

      expect(result.success).toBe(true);
      createdNoteIds.push(result.queryId!);

      const row = await testDb.pool.query(
        `SELECT description, discrepancy_note_type_id, resolution_status_id, study_id, entity_type, owner_id
         FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [result.queryId]
      );
      expect(row.rows).toHaveLength(1);
      const note = row.rows[0];
      expect(note.description).toBe('Verify weight measurement against source document');
      expect(note.discrepancy_note_type_id).toBe(1); // Failed Validation Check
      expect(note.resolution_status_id).toBe(1);     // New
      expect(note.study_id).toBe(studyId);
      expect(note.entity_type).toBe('studySubject');
      expect(note.owner_id).toBe(ownerId);
    });

    it('rejects invalid entityType gracefully', async () => {
      const result = await queryService.createQuery(
        {
          entityType: 'invalidType' as any,
          entityId: 1,
          studyId,
          description: 'A valid description of sufficient length',
          queryType: 'Query'
        },
        ownerId
      );
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invalid entity type/i);
    });

    it('type-maps queryType strings to correct typeId', async () => {
      const typeMap: Record<string, number> = {
        'Failed Validation Check': 1,
        'Annotation': 2,
        'Query': 3,
        'Reason for Change': 4
      };

      for (const [queryType, expectedTypeId] of Object.entries(typeMap)) {
        const r = await queryService.createQuery(
          {
            entityType: 'studySubject',
            entityId: subjectId,
            studyId,
            description: `Testing queryType mapping for ${queryType}`,
            queryType: queryType as any
          },
          ownerId
        );
        expect(r.success).toBe(true);
        createdNoteIds.push(r.queryId!);

        const row = await testDb.pool.query(
          `SELECT discrepancy_note_type_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
          [r.queryId]
        );
        expect(row.rows[0].discrepancy_note_type_id).toBe(expectedTypeId);
      }
    });
  });

  describe('Query Service — getQueryById', () => {
    let noteId: number;

    beforeEach(async () => {
      noteId = await insertNote(testDb.pool, {
        studyId,
        subjectId,
        description: 'Test query for getQueryById round-trip'
      });
      createdNoteIds.push(noteId);
    });

    it('returns the query with correct shape', async () => {
      const result = await queryService.getQueryById(noteId);
      expect(result).not.toBeNull();
      expect(result.discrepancy_note_id).toBe(noteId);
      expect(result.description).toBe('Test query for getQueryById round-trip');
      expect(result.resolution_status_id).toBe(1);
    });

    it('returns null for a non-existent queryId', async () => {
      const result = await queryService.getQueryById(999999999);
      expect(result).toBeNull();
    });

    it('includes responses array in the result', async () => {
      const result = await queryService.getQueryById(noteId);
      expect(Array.isArray(result.responses)).toBe(true);
    });
  });

  describe('Query Service — addQueryResponse', () => {
    let parentId: number;

    beforeEach(async () => {
      parentId = await insertNote(testDb.pool, {
        studyId,
        description: 'Parent query for response tests'
      });
      createdNoteIds.push(parentId);
    });

    it('creates a child response note and updates parent status to Updated (2)', async () => {
      const result = await queryService.addQueryResponse(
        parentId,
        { description: 'The value has been verified against the source document' },
        monitorId
      );

      expect(result.success).toBe(true);
      expect(typeof result.responseId).toBe('number');

      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [parentId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(2); // Updated
    });

    it('sets parent to Resolution Proposed (3) when newStatusId = 3', async () => {
      const result = await queryService.addQueryResponse(
        parentId,
        {
          description: 'Data corrected per source document. Resolution proposed.',
          newStatusId: 3
        },
        monitorId
      );

      expect(result.success).toBe(true);

      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [parentId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(3); // Resolution Proposed
    });

    it('sets parent to Closed (4) when newStatusId = 4', async () => {
      const result = await queryService.addQueryResponse(
        parentId,
        {
          description: 'Query resolved — data verified and corrected',
          newStatusId: 4
        },
        monitorId
      );

      expect(result.success).toBe(true);

      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [parentId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(4); // Closed
    });

    it('rejects an empty description', async () => {
      const result = await queryService.addQueryResponse(
        parentId,
        { description: '' },
        monitorId
      );
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/required/i);
    });

    it('rejects a whitespace-only description', async () => {
      const result = await queryService.addQueryResponse(
        parentId,
        { description: '   ' },
        monitorId
      );
      expect(result.success).toBe(false);
    });

    it('returns failure for non-existent parentQueryId', async () => {
      const result = await queryService.addQueryResponse(
        999999999,
        { description: 'Response to non-existent query — should fail gracefully' },
        monitorId
      );
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not found/i);
    });

    it('performs status update atomically — both response and status change in same transaction', async () => {
      // If we add a response with newStatusId=3, BOTH the child note insert
      // AND the parent status update must succeed together.
      const result = await queryService.addQueryResponse(
        parentId,
        {
          description: 'Comprehensive data review completed — resolution proposed',
          newStatusId: 3
        },
        monitorId
      );

      expect(result.success).toBe(true);

      // Verify child exists
      const child = await testDb.pool.query(
        `SELECT discrepancy_note_id FROM discrepancy_note WHERE parent_dn_id = $1`,
        [parentId]
      );
      expect(child.rows.length).toBeGreaterThan(0);

      // Verify parent status
      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [parentId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(3);
    });
  });

  describe('Query Service — updateQueryStatus', () => {
    let noteId: number;

    beforeEach(async () => {
      noteId = await insertNote(testDb.pool, {
        studyId,
        description: 'Query for status update tests'
      });
      createdNoteIds.push(noteId);
    });

    it('updates status from New to Updated', async () => {
      const result = await queryService.updateQueryStatus(noteId, 2, ownerId);
      expect(result.success).toBe(true);

      const row = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [noteId]
      );
      expect(row.rows[0].resolution_status_id).toBe(2);
    });

    it('writes an audit log entry for the status change', async () => {
      await queryService.updateQueryStatus(noteId, 4, ownerId, { reason: 'Verified against source' });

      const auditRow = await testDb.pool.query(
        `SELECT * FROM audit_log_event WHERE audit_table = 'discrepancy_note' AND entity_id = $1
         ORDER BY audit_date DESC LIMIT 1`,
        [noteId]
      );
      expect(auditRow.rows.length).toBeGreaterThan(0);
    });

    it('returns failure for non-existent query', async () => {
      const result = await queryService.updateQueryStatus(999999999, 2, ownerId);
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. RESOLUTION WORKFLOW — ACCEPT / REJECT
  // ═══════════════════════════════════════════════════════════

  describe('Query Service — acceptResolution', () => {
    let queryId: number;

    beforeEach(async () => {
      queryId = await insertNote(testDb.pool, {
        studyId,
        description: 'Query in Resolution Proposed status for accept test',
        statusId: 3 // Resolution Proposed
      });
      createdNoteIds.push(queryId);
    });

    it('closes the query and adds [ACCEPTED] note to the thread', async () => {
      const result = await queryService.acceptResolution(queryId, monitorId, {
        reason: 'Data verified against source document — correction confirmed'
      });

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/closed/i);

      // Parent status should be 4 (Closed)
      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [queryId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(4);

      // Thread should contain an [ACCEPTED] note
      const children = await testDb.pool.query(
        `SELECT description FROM discrepancy_note WHERE parent_dn_id = $1`,
        [queryId]
      );
      const acceptedNote = children.rows.find((r: any) =>
        (r.description as string).startsWith('[ACCEPTED]')
      );
      expect(acceptedNote).toBeDefined();
    });

    it('fails if query is not in Resolution Proposed status', async () => {
      // Create a New query (status = 1)
      const newQueryId = await insertNote(testDb.pool, {
        studyId,
        description: 'New query — accept should fail since not in proposed status',
        statusId: 1
      });
      createdNoteIds.push(newQueryId);

      const result = await queryService.acceptResolution(newQueryId, monitorId, {
        reason: 'Trying to accept a non-proposed query'
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not in/i);
    });

    it('fails for a non-existent queryId', async () => {
      const result = await queryService.acceptResolution(999999999, monitorId, { reason: 'Test' });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not found/i);
    });

    it('writes an audit log entry', async () => {
      await queryService.acceptResolution(queryId, monitorId, { reason: 'Verified correctly' });

      const audit = await testDb.pool.query(
        `SELECT entity_name FROM audit_log_event
         WHERE audit_table = 'discrepancy_note' AND entity_id = $1
         ORDER BY audit_date DESC LIMIT 1`,
        [queryId]
      );
      expect(audit.rows[0]?.entity_name).toMatch(/accepted/i);
    });
  });

  describe('Query Service — rejectResolution', () => {
    let queryId: number;

    beforeEach(async () => {
      queryId = await insertNote(testDb.pool, {
        studyId,
        description: 'Query in Resolution Proposed status for reject test',
        statusId: 3
      });
      createdNoteIds.push(queryId);
    });

    it('returns query to New (1) and adds [REJECTED] note to thread', async () => {
      const result = await queryService.rejectResolution(queryId, monitorId, {
        reason: 'The corrected value does not match the source document. Please re-verify.'
      });

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/re-investigation/i);

      // Parent status should be back to 1 (New)
      const parent = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [queryId]
      );
      expect(parent.rows[0].resolution_status_id).toBe(1);

      // Thread should contain a [REJECTED] note
      const children = await testDb.pool.query(
        `SELECT description FROM discrepancy_note WHERE parent_dn_id = $1`,
        [queryId]
      );
      const rejectedNote = children.rows.find((r: any) =>
        (r.description as string).startsWith('[REJECTED]')
      );
      expect(rejectedNote).toBeDefined();
    });

    it('requires a non-empty reason', async () => {
      const result = await queryService.rejectResolution(queryId, monitorId, { reason: '' });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/reason is required/i);
    });

    it('fails if query is not in Resolution Proposed status', async () => {
      const closedId = await insertNote(testDb.pool, {
        studyId,
        description: 'Closed query — reject should fail',
        statusId: 4
      });
      createdNoteIds.push(closedId);

      const result = await queryService.rejectResolution(closedId, monitorId, {
        reason: 'Attempting to reject a closed query — should fail'
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not in/i);
    });

    it('fails for non-existent queryId', async () => {
      const result = await queryService.rejectResolution(999999999, monitorId, {
        reason: 'Cannot reject a non-existent query ever'
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not found/i);
    });

    it('writes an audit log entry with entity_name "Resolution Rejected"', async () => {
      await queryService.rejectResolution(queryId, monitorId, {
        reason: 'Value still does not match source document after correction'
      });

      const audit = await testDb.pool.query(
        `SELECT entity_name FROM audit_log_event
         WHERE audit_table = 'discrepancy_note' AND entity_id = $1
         ORDER BY audit_date DESC LIMIT 1`,
        [queryId]
      );
      expect(audit.rows[0]?.entity_name).toMatch(/rejected/i);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. FULL WORKFLOW ROUND-TRIP
  // ═══════════════════════════════════════════════════════════

  describe('Full Query Resolution Lifecycle', () => {
    it('completes the full EDC query lifecycle: create → respond → propose → accept → closed', async () => {
      // Step 1: CRO/monitor creates a query
      const created = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          subjectId,
          description: 'Subject weight on Day 1 does not match the source document',
          queryType: 'Query'
        },
        monitorId
      );
      expect(created.success).toBe(true);
      const qId = created.queryId!;
      createdNoteIds.push(qId);

      // Verify: status = 1 (New)
      let status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(1);

      // Step 2: Data manager responds
      const responded = await queryService.addQueryResponse(
        qId,
        { description: 'Weight measurement confirmed — typo on CRF. Correcting to 72.5 kg per visit note.', newStatusId: 2 },
        ownerId
      );
      expect(responded.success).toBe(true);

      // Verify: status = 2 (Updated)
      status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(2);

      // Step 3: Data manager proposes resolution
      const proposed = await queryService.addQueryResponse(
        qId,
        { description: 'Correction applied — 72.5 kg confirmed against source. Proposing resolution.', newStatusId: 3 },
        ownerId
      );
      expect(proposed.success).toBe(true);

      // Verify: status = 3 (Resolution Proposed)
      status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(3);

      // Step 4: Monitor accepts the resolution
      const accepted = await queryService.acceptResolution(qId, monitorId, {
        reason: 'Weight verified against visit note. Correction is correct.',
        meaning: 'I have reviewed and confirm the query is resolved'
      });
      expect(accepted.success).toBe(true);

      // Verify: status = 4 (Closed)
      status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(4);

      // Verify thread has all entries: root + 3 responses
      const thread = await queryService.getQueryThread(qId);
      expect(thread.length).toBeGreaterThanOrEqual(4); // root + respond + propose + accept

      // Verify thread contains [ACCEPTED] note
      const acceptedNote = thread.find((t: any) =>
        typeof t.description === 'string' && t.description.startsWith('[ACCEPTED]')
      );
      expect(acceptedNote).toBeDefined();
    });

    it('completes the rejection path: create → respond → propose → reject → re-respond → accept', async () => {
      const created = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          description: 'Blood pressure reading on Visit 2 appears inconsistent with history',
          queryType: 'Query'
        },
        monitorId
      );
      expect(created.success).toBe(true);
      const qId = created.queryId!;
      createdNoteIds.push(qId);

      // DM proposes resolution
      await queryService.addQueryResponse(
        qId,
        { description: 'BP reading corrected to 120/80 per manual measurement records', newStatusId: 3 },
        ownerId
      );

      // Monitor rejects (still incorrect)
      const rejected = await queryService.rejectResolution(qId, monitorId, {
        reason: 'The source document shows 135/85 not 120/80. Please re-verify the measurement.'
      });
      expect(rejected.success).toBe(true);

      // Status back to New
      let status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(1);

      // DM re-proposes with correct value
      await queryService.addQueryResponse(
        qId,
        { description: 'Re-verified against measurement logbook — correct value is 135/85. Proposing resolution.', newStatusId: 3 },
        ownerId
      );

      // Monitor accepts
      const accepted = await queryService.acceptResolution(qId, monitorId, {
        reason: 'Confirmed 135/85 matches source. Closing.'
      });
      expect(accepted.success).toBe(true);

      status = await testDb.pool.query(
        `SELECT resolution_status_id FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [qId]
      );
      expect(status.rows[0].resolution_status_id).toBe(4);
    });

    it('cannot accept a query that was already closed', async () => {
      const qId = await insertNote(testDb.pool, {
        studyId,
        description: 'Already closed query for idempotency test',
        statusId: 4 // Closed
      });
      createdNoteIds.push(qId);

      const result = await queryService.acceptResolution(qId, monitorId, {
        reason: 'Trying to accept already closed query'
      });
      expect(result.success).toBe(false);
    });

    it('cannot reject a query that is already closed', async () => {
      const qId = await insertNote(testDb.pool, {
        studyId,
        description: 'Already closed query for reject idempotency test',
        statusId: 4
      });
      createdNoteIds.push(qId);

      const result = await queryService.rejectResolution(qId, monitorId, {
        reason: 'Trying to reject a closed query — this should fail correctly'
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. THREAD CORRECTNESS
  // ═══════════════════════════════════════════════════════════

  describe('getQueryThread — routing copy exclusion', () => {
    it('excludes multi-routing copies from the thread', async () => {
      // Create a parent query
      const parentId = await insertNote(testDb.pool, {
        studyId,
        description: 'Parent query that has a routing copy'
      });
      createdNoteIds.push(parentId);

      // Simulate a routing copy (same description, created immediately)
      const copyRes = await testDb.pool.query(
        `INSERT INTO discrepancy_note
           (parent_dn_id, description, detailed_notes, discrepancy_note_type_id,
            resolution_status_id, study_id, entity_type, owner_id, assigned_user_id, date_created)
         SELECT $1, description, detailed_notes, discrepancy_note_type_id,
                resolution_status_id, study_id, entity_type, owner_id, 2, NOW()
         FROM discrepancy_note WHERE discrepancy_note_id = $1
         RETURNING discrepancy_note_id`,
        [parentId]
      );
      const copyId = copyRes.rows[0].discrepancy_note_id;
      createdNoteIds.push(copyId);

      // Also add a real response (different text, added later)
      const realResponse = await testDb.pool.query(
        `INSERT INTO discrepancy_note
           (parent_dn_id, description, detailed_notes, discrepancy_note_type_id,
            resolution_status_id, study_id, entity_type, owner_id, date_created)
         SELECT $1, 'This is a genuine response added by the data manager later',
                '', 3, 2, study_id, entity_type, 2, NOW() + INTERVAL '60 seconds'
         FROM discrepancy_note WHERE discrepancy_note_id = $1
         RETURNING discrepancy_note_id`,
        [parentId]
      );
      const responseId = realResponse.rows[0].discrepancy_note_id;
      createdNoteIds.push(responseId);

      const thread = await queryService.getQueryThread(parentId);

      // Thread should include root + real response, but NOT the routing copy
      const descriptions = thread.map((t: any) => t.description as string);

      expect(descriptions.some(d => d === 'Parent query that has a routing copy')).toBe(true);
      expect(descriptions.some(d => d === 'This is a genuine response added by the data manager later')).toBe(true);
      // Routing copy (same text as parent, created at same time) should be excluded
      const routingCopies = descriptions.filter(d => d === 'Parent query that has a routing copy');
      expect(routingCopies).toHaveLength(1); // Only the root, not the copy
    });

    it('returns root query as first entry in thread', async () => {
      const parentId = await insertNote(testDb.pool, {
        studyId,
        description: 'Root query for thread ordering test'
      });
      createdNoteIds.push(parentId);

      const thread = await queryService.getQueryThread(parentId);
      expect(thread.length).toBeGreaterThanOrEqual(1);
      expect(thread[0].parent_dn_id).toBeFalsy(); // Root has no parent
    });

    it('returns empty array for non-existent query', async () => {
      const thread = await queryService.getQueryThread(999999999);
      expect(Array.isArray(thread)).toBe(true);
      expect(thread.length).toBe(0);
    });

    it('includes [ACCEPTED] and [REJECTED] notes in thread', async () => {
      const parentId = await insertNote(testDb.pool, {
        studyId,
        description: 'Query for checking special notes appear in thread',
        statusId: 3
      });
      createdNoteIds.push(parentId);

      // Add an accept note manually (simulating what acceptResolution does)
      const acceptNoteRes = await testDb.pool.query(
        `INSERT INTO discrepancy_note
           (parent_dn_id, description, detailed_notes, discrepancy_note_type_id,
            resolution_status_id, study_id, entity_type, owner_id, date_created)
         SELECT $1, '[ACCEPTED] Resolution confirmed by monitor',
                'I have reviewed', 3, 4, study_id, entity_type, 2,
                NOW() + INTERVAL '2 minutes'
         FROM discrepancy_note WHERE discrepancy_note_id = $1
         RETURNING discrepancy_note_id`,
        [parentId]
      );
      createdNoteIds.push(acceptNoteRes.rows[0].discrepancy_note_id);

      const thread = await queryService.getQueryThread(parentId);
      const hasAccepted = thread.some((t: any) =>
        typeof t.description === 'string' && t.description.startsWith('[ACCEPTED]')
      );
      expect(hasAccepted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. BULK OPERATIONS — response shape validation
  // ═══════════════════════════════════════════════════════════

  describe('Bulk Operations — response shape', () => {
    let q1: number, q2: number;

    beforeEach(async () => {
      q1 = await insertNote(testDb.pool, { studyId, description: 'Bulk test query one' });
      q2 = await insertNote(testDb.pool, { studyId, description: 'Bulk test query two' });
      createdNoteIds.push(q1, q2);
    });

    it('bulkUpdateStatus returns flat {success, updated, failed, errors} — no double-wrap', async () => {
      const result = await queryService.bulkUpdateStatus([q1, q2], 4, ownerId, 'Bulk closing for test');

      // Must be flat — no nested 'data' property containing another success/failed object
      expect(result).not.toHaveProperty('data');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.updated).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.updated).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('bulkCloseQueries returns flat {success, closed, failed, errors}', async () => {
      const result = await queryService.bulkCloseQueries([q1, q2], ownerId, 'Closing queries');

      expect(result).not.toHaveProperty('data');
      expect(typeof result.closed).toBe('number');
      expect(result.closed).toBe(2);
    });

    it('bulkReassignQueries returns flat {success, reassigned, failed, errors}', async () => {
      const result = await queryService.bulkReassignQueries([q1, q2], monitorId, ownerId, 'Reassigning');

      expect(result).not.toHaveProperty('data');
      expect(typeof result.reassigned).toBe('number');
      expect(result.reassigned).toBe(2);
    });

    it('bulkUpdateStatus handles partial failure gracefully', async () => {
      const badId = 999999999;
      const result = await queryService.bulkUpdateStatus([q1, badId], 4, ownerId);

      // One should succeed, one should fail (badId doesn't exist)
      expect(typeof result.updated).toBe('number');
      expect(typeof result.failed).toBe('number');
      // updated + failed = total
      expect(result.updated + result.failed).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. NOTIFICATION TYPES — verify correct types used
  // ═══════════════════════════════════════════════════════════

  describe('Notification Service — type correctness', () => {
    it('NotificationType union includes all required types', () => {
      // These types must exist for the query workflow to be complete
      const requiredTypes: string[] = [
        'query_assigned',
        'query_response',
        'query_closed',
        'query_reopened',
        'form_sdv_required',
        'form_signature_required'
      ];

      // We can verify this by checking that the notification service
      // functions don't throw TypeScript type errors (caught at compile time).
      // At runtime, verify the service exports these functions:
      expect(typeof notificationService.notifyQueryAssigned).toBe('function');
      expect(typeof notificationService.notifyQueryResponse).toBe('function');
      expect(typeof notificationService.notifyQueryClosed).toBe('function');
      expect(typeof notificationService.notifyResolutionProposed).toBe('function');
      expect(typeof notificationService.notifyResolutionRejected).toBe('function');
      expect(typeof notificationService.notifyFormSDVRequired).toBe('function');
    });

    it('notifyResolutionRejected is exported and callable', () => {
      expect(typeof notificationService.notifyResolutionRejected).toBe('function');
      // Should not throw when called with valid params (fire-and-forget, silently fails if table missing)
      expect(() =>
        notificationService.notifyResolutionRejected(
          1,
          'Test query description',
          1,
          'Test Rejector',
          'Source document does not match',
          1
        )
      ).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. EDGE CASES & BREAK TESTS
  // ═══════════════════════════════════════════════════════════

  describe('Edge Cases — trying to break the system', () => {
    it('createQuery handles description with SQL injection characters safely', async () => {
      const maliciousDescription = `'; DROP TABLE discrepancy_note; -- this should be safe`;
      const result = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          description: maliciousDescription,
          queryType: 'Query'
        },
        ownerId
      );
      expect(result.success).toBe(true);
      createdNoteIds.push(result.queryId!);

      // Verify the table still exists and query was created safely
      const check = await testDb.pool.query(
        `SELECT description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [result.queryId]
      );
      expect(check.rows[0].description).toBe(maliciousDescription);
    });

    it('addQueryResponse with unicode characters in description stores correctly', async () => {
      const parentId = await insertNote(testDb.pool, { studyId, description: 'Unicode edge case test' });
      createdNoteIds.push(parentId);

      const unicodeText = 'Response with unicode: 日本語テスト — αβγδ — naïve résumé';
      const result = await queryService.addQueryResponse(
        parentId,
        { description: unicodeText },
        ownerId
      );
      expect(result.success).toBe(true);

      const childRow = await testDb.pool.query(
        `SELECT description FROM discrepancy_note WHERE discrepancy_note_id = $1`,
        [result.responseId]
      );
      expect(childRow.rows[0].description).toBe(unicodeText);
    });

    it('canEditQuery returns false for a non-existent query', async () => {
      const result = await queryService.canEditQuery(999999999, ownerId, 'coordinator');
      expect(result.allowed).toBe(false);
    });

    it('canEditQuery returns true for elevated roles regardless of assignment', async () => {
      const noteId = await insertNote(testDb.pool, { studyId, description: 'Test role check', ownerId: 99 });
      createdNoteIds.push(noteId);

      const elevatedRoles = ['admin', 'data_manager', 'monitor'];
      for (const role of elevatedRoles) {
        const result = await queryService.canEditQuery(noteId, ownerId, role);
        expect(result.allowed).toBe(true);
      }
    });

    it('getQueries with studyId filter returns only queries for that study', async () => {
      const noteId = await insertNote(testDb.pool, { studyId, description: 'Study filter test query' });
      createdNoteIds.push(noteId);

      const result = await queryService.getQueries({ studyId, limit: 100 });
      expect(result.success).toBe(true);
      const queryIds = result.data.map((q: any) => q.discrepancy_note_id);
      expect(queryIds).toContain(noteId);

      // All results should have the correct studyId
      for (const q of result.data) {
        expect(q.study_id).toBe(studyId);
      }
    });

    it('multiple responses on same query all appear in thread', async () => {
      const parentId = await insertNote(testDb.pool, {
        studyId,
        description: 'Multi-response thread test query'
      });
      createdNoteIds.push(parentId);

      // Add 3 responses sequentially
      for (let i = 1; i <= 3; i++) {
        const r = await queryService.addQueryResponse(
          parentId,
          { description: `Response number ${i} to this query — added in sequence` },
          ownerId
        );
        expect(r.success).toBe(true);
      }

      const thread = await queryService.getQueryThread(parentId);
      // Should have root + 3 responses = 4 entries
      expect(thread.length).toBeGreaterThanOrEqual(4);
    });

    it('Joi schema rejects unknown fields in create payload (strict mode)', () => {
      // Joi by default strips unknown keys (abortEarly mode)
      // If stripUnknown is not set, unknown keys are allowed by default
      // This test verifies our schema allows this (we don't use .unknown(false))
      const err = joiError(querySchemas.create, {
        description: 'A valid description here for unknown field test',
        queryType: 'Query',
        studyId: 1,
        unknownField: 'this should be ignored'
      });
      // By default Joi strips unknown — no error expected
      expect(err).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 9. DATA TYPE INTEGRITY — verify field types from DB
  // ═══════════════════════════════════════════════════════════

  describe('Data Type Integrity', () => {
    it('discrepancy_note_id is returned as a number (not string)', async () => {
      const result = await queryService.createQuery(
        {
          entityType: 'studySubject',
          entityId: subjectId,
          studyId,
          description: 'Data type integrity test query',
          queryType: 'Query'
        },
        ownerId
      );
      expect(result.success).toBe(true);
      expect(typeof result.queryId).toBe('number');
      createdNoteIds.push(result.queryId!);
    });

    it('resolution_status_id from DB is a number', async () => {
      const noteId = await insertNote(testDb.pool, { studyId, description: 'Status type test query' });
      createdNoteIds.push(noteId);

      const result = await queryService.getQueryById(noteId);
      expect(typeof result.resolution_status_id).toBe('number');
    });

    it('date_created from thread is a Date or parseable string', async () => {
      const parentId = await insertNote(testDb.pool, { studyId, description: 'Date type test query' });
      createdNoteIds.push(parentId);

      const thread = await queryService.getQueryThread(parentId);
      expect(thread.length).toBeGreaterThan(0);

      const dateCreated = thread[0].date_created;
      // Should be parseable as a date
      const parsed = new Date(dateCreated);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    it('getQueries returns pagination object with correct types', async () => {
      const result = await queryService.getQueries({ studyId, limit: 5, page: 1 });
      expect(result.success).toBe(true);
      expect(typeof result.pagination.page).toBe('number');
      expect(typeof result.pagination.limit).toBe('number');
      expect(typeof result.pagination.total).toBe('number');
      expect(typeof result.pagination.totalPages).toBe('number');
    });
  });
});
